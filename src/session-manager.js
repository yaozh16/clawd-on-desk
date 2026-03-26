// SessionManager class - Manages all sessions and ring order
// Handles session lifecycle, foreground switching, and global sleep

const { Session } = require("./session");
const { Layout } = require("./layout");
const {
  STATE_SVGS,
  STATE_PRIORITY,
  SLEEP_SEQUENCE,
  SVG_IDLE_FOLLOW,
  YAWN_DURATION,
  COLLAPSE_DURATION,
  WAKE_DURATION,
} = require("./constants");

class SessionManager {
  constructor(mainProcess, config = {}) {
    this.main = mainProcess; // Reference to main process for sendToRenderer, etc.
    this.sessions = new Map(); // sessionId → Session
    this.ringOrder = []; // [sessionId1, sessionId2, ...] - first is foreground
    this.globalState = "idle"; // Used when no sessions
    this.layout = new Layout(this, config.layoutStrategy || "circular");

    // Configurable timeouts (can be updated at runtime)
    this.sessionStaleMs = config.sessionStaleMs || 600000;  // 10 min default
    this.workingStaleMs = config.workingStaleMs || 300000;  // 5 min default
    this.deepSleepTimeout = config.deepSleepTimeout || 600000;  // 10 min default

    // Global sleep sequence timers
    this.globalSleepTimer = null;
    this.wakePollTimer = null;

    // Stale cleanup
    this.staleCleanupTimer = null;
  }

  // ── Session Lifecycle ──

  getOrCreateSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      const session = new Session(sessionId, this);
      this.sessions.set(sessionId, session);
      this.addToRing(sessionId);
    }
    return this.sessions.get(sessionId);
  }

  removeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.destroy();
      this.sessions.delete(sessionId);
      this.removeFromRing(sessionId);
    }

    // Update layout
    this.layout.updatePositions(this.ringOrder);

    // No sessions → start global sleep sequence
    if (this.sessions.size === 0) {
      this.startGlobalSleepSequence();
    }
  }

  hasSession(sessionId) {
    return this.sessions.has(sessionId);
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  // ── Ring Order Management ──

  addToRing(sessionId) {
    if (!this.ringOrder.includes(sessionId)) {
      this.ringOrder.push(sessionId);
      console.log("[SessionManager] Added to ring:", sessionId, "ringOrder now:", this.ringOrder);
      this.layout.updatePositions(this.ringOrder);
    }
  }

  removeFromRing(sessionId) {
    const index = this.ringOrder.indexOf(sessionId);
    if (index !== -1) {
      this.ringOrder.splice(index, 1);
      this.layout.updatePositions(this.ringOrder);
    }
  }

  bringToFront(sessionId) {
    const index = this.ringOrder.indexOf(sessionId);
    console.log("[SessionManager] bringToFront:", sessionId, "currentIndex:", index, "ringOrder:", this.ringOrder);
    if (index > 0) {
      const before = [...this.ringOrder];
      this.ringOrder.splice(index, 1);
      this.ringOrder.unshift(sessionId);
      console.log("[SessionManager] bringToFront result:", before, "->", this.ringOrder);
      this.layout.updatePositions(this.ringOrder);
    }
  }

  rotateLeft() {
    if (this.ringOrder.length > 1) {
      const before = [...this.ringOrder];
      this.ringOrder.push(this.ringOrder.shift());
      console.log("[SessionManager] rotateLeft:", before, "->", this.ringOrder);
      this.layout.updatePositions(this.ringOrder);
    }
  }

  rotateRight() {
    if (this.ringOrder.length > 1) {
      const before = [...this.ringOrder];
      this.ringOrder.unshift(this.ringOrder.pop());
      console.log("[SessionManager] rotateRight:", before, "->", this.ringOrder);
      this.layout.updatePositions(this.ringOrder);
    }
  }

  getForegroundSessionId() {
    return this.ringOrder[0] || null;
  }

  getForegroundSession() {
    const id = this.getForegroundSessionId();
    return id ? this.sessions.get(id) : null;
  }

  // ── Agent Config ──

  getAgentConfig(agentId) {
    return this.main.getAgentConfig(agentId);
  }

  // ── Renderer Communication ──

  sendToRenderer(channel, ...args) {
    this.main.sendToRenderer(channel, ...args);
  }

  // ── SVG Helpers ──

  getWorkingSvg() {
    let n = 0;
    for (const [, s] of this.sessions) {
      if (s.state === "working" || s.state === "thinking" || s.state === "juggling") n++;
    }
    if (n >= 3) return "clawd-working-building.svg";
    if (n >= 2) return "clawd-working-juggling.svg";
    return "clawd-working-typing.svg";
  }

  getJugglingSvg() {
    let n = 0;
    for (const [, s] of this.sessions) {
      if (s.state === "juggling") n++;
    }
    return n >= 2 ? "clawd-working-conducting.svg" : "clawd-working-juggling.svg";
  }

  // ── Global Sleep Sequence ──

  startGlobalSleepSequence() {
    if (this.globalSleepTimer) {
      clearTimeout(this.globalSleepTimer);
      this.globalSleepTimer = null;
    }

    // Only start if no sessions and not in mini mode or DND
    if (this.sessions.size > 0 || this.main.isMiniMode() || this.main.isDND()) {
      return;
    }

    this.globalState = "idle";
    this.sendToRenderer("pet-state-change", "__global__", "idle", SVG_IDLE_FOLLOW);

    // Wait for mouse idle timeout, then yawn
    this.globalSleepTimer = setTimeout(() => {
      this.globalSleepTimer = null;
      if (this.sessions.size === 0 && !this.main.isMiniMode() && !this.main.isDND()) {
        this.transitionToYawning();
      }
    }, 60000); // MOUSE_SLEEP_TIMEOUT
  }

  transitionToYawning() {
    this.globalState = "yawning";
    this.sendToRenderer("pet-state-change", "__global__", "yawning", "clawd-idle-yawn.svg");

    this.globalSleepTimer = setTimeout(() => {
      this.globalSleepTimer = null;
      if (this.sessions.size === 0) {
        this.transitionToDozing();
      }
    }, YAWN_DURATION);
  }

  transitionToDozing() {
    this.globalState = "dozing";
    this.sendToRenderer("pet-state-change", "__global__", "dozing", "clawd-idle-doze.svg");

    // Start wake poll
    this.startWakePoll();

    // Deep sleep timeout
    this.globalSleepTimer = setTimeout(() => {
      this.globalSleepTimer = null;
      if (this.sessions.size === 0) {
        this.transitionToCollapsing();
      }
    }, this.deepSleepTimeout);
  }

  transitionToCollapsing() {
    this.globalState = "collapsing";
    this.sendToRenderer("pet-state-change", "__global__", "collapsing", "clawd-collapse-sleep.svg");

    this.globalSleepTimer = setTimeout(() => {
      this.globalSleepTimer = null;
      if (this.sessions.size === 0) {
        this.transitionToSleeping();
      }
    }, COLLAPSE_DURATION);
  }

  transitionToSleeping() {
    this.globalState = "sleeping";
    this.sendToRenderer("pet-state-change", "__global__", "sleeping", "clawd-sleeping.svg");
  }

  wakeFromGlobalSleep() {
    if (!SLEEP_SEQUENCE.has(this.globalState)) return;

    if (this.globalSleepTimer) {
      clearTimeout(this.globalSleepTimer);
      this.globalSleepTimer = null;
    }
    this.stopWakePoll();

    if (this.globalState === "sleeping" || this.globalState === "collapsing") {
      this.globalState = "waking";
      this.sendToRenderer("pet-state-change", "__global__", "waking", "clawd-wake.svg");

      this.globalSleepTimer = setTimeout(() => {
        this.globalSleepTimer = null;
        this.globalState = "idle";
        this.sendToRenderer("pet-state-change", "__global__", "idle", SVG_IDLE_FOLLOW);
      }, WAKE_DURATION);
    } else {
      this.globalState = "idle";
      this.sendToRenderer("pet-state-change", "__global__", "idle", SVG_IDLE_FOLLOW);
    }
  }

  // ── Wake Poll ──

  startWakePoll() {
    if (this.wakePollTimer) return;

    const { screen } = require("electron");
    let lastX = null, lastY = null;

    this.wakePollTimer = setInterval(() => {
      const cursor = screen.getCursorScreenPoint();
      if (lastX !== null && (cursor.x !== lastX || cursor.y !== lastY)) {
        this.wakeFromGlobalSleep();
      }
      lastX = cursor.x;
      lastY = cursor.y;
    }, 200);
  }

  stopWakePoll() {
    if (this.wakePollTimer) {
      clearInterval(this.wakePollTimer);
      this.wakePollTimer = null;
    }
  }

  // ── Stale Session Cleanup ──

  startStaleCleanup() {
    if (this.staleCleanupTimer) return;
    this.staleCleanupTimer = setInterval(() => this.cleanStaleSessions(), 10000);
  }

  stopStaleCleanup() {
    if (this.staleCleanupTimer) {
      clearInterval(this.staleCleanupTimer);
      this.staleCleanupTimer = null;
    }
  }

  cleanStaleSessions() {
    const now = Date.now();
    let changed = false;

    for (const [id, s] of this.sessions) {
      const age = now - s.updatedAt;

      // Skip newly created sessions (less than 30s old)
      if (age < 30000) continue;

      // Check if agent process is still alive
      if (s.pidReachable && s.agentPid) {
        try {
          process.kill(s.agentPid, 0);
        } catch (e) {
          // Agent process dead, remove session
          this.removeSession(id);
          changed = true;
          continue;
        }
      }

      if (age > this.sessionStaleMs) {
        // Very stale: check source PID
        if (s.pidReachable && s.sourcePid) {
          try {
            process.kill(s.sourcePid, 0);
            // Process alive, set idle
            if (s.state !== "idle") {
              s.state = "idle";
              s.svg = SVG_IDLE_FOLLOW;
              changed = true;
            }
          } catch (e) {
            // Source process dead
            this.removeSession(id);
            changed = true;
          }
        } else if (!s.pidReachable) {
          // Remote session (WSL2): rely purely on timeout
          this.removeSession(id);
          changed = true;
        }
        // If pidReachable but no sourcePid, keep session (may have only agentPid)
      } else if (age > this.workingStaleMs) {
        // Moderately stale (5 min): check if terminal was closed
        if (s.pidReachable && s.sourcePid) {
          try {
            process.kill(s.sourcePid, 0);
          } catch (e) {
            this.removeSession(id);
            changed = true;
            continue;
          }
        }
        if (s.state === "working" || s.state === "juggling" || s.state === "thinking") {
          s.state = "idle";
          s.svg = SVG_IDLE_FOLLOW;
          s.updatedAt = now;
          changed = true;
        }
      }
    }

    if (changed && this.sessions.size === 0) {
      this.startGlobalSleepSequence();
    }
  }

  // ── Session Menu ──

  buildSessionSubmenu(lang, t) {
    const entries = [];
    for (const [id, s] of this.sessions) {
      entries.push({
        id,
        state: s.state,
        updatedAt: s.updatedAt,
        sourcePid: s.sourcePid,
        cwd: s.cwd,
        editor: s.editor,
        pidChain: s.pidChain,
      });
    }

    if (entries.length === 0) {
      return [{ label: t("noSessions"), enabled: false }];
    }

    // Sort by priority desc, then updatedAt desc
    entries.sort((a, b) => {
      const pa = STATE_PRIORITY[a.state] || 0;
      const pb = STATE_PRIORITY[b.state] || 0;
      if (pb !== pa) return pb - pa;
      return b.updatedAt - a.updatedAt;
    });

    const now = Date.now();
    const path = require("path");

    return entries.map((e) => {
      const emoji = { working: "🔨", thinking: "🤔", juggling: "🤹", idle: "💤", sleeping: "💤" }[e.state] || "";
      const stateText = t(`session${e.state.charAt(0).toUpperCase() + e.state.slice(1)}`);
      const name = e.cwd ? path.basename(e.cwd) : (e.id.length > 6 ? e.id.slice(0, 6) + ".." : e.id);
      const elapsed = this.formatElapsed(now - e.updatedAt, t);
      const hasPid = !!e.sourcePid;

      return {
        label: `${emoji} ${name}  ${stateText}  ${elapsed}`,
        enabled: hasPid,
        click: hasPid ? () => {
          this.bringToFront(e.id);
          this.main.focusTerminal(e.sourcePid, e.cwd, e.editor, e.pidChain);
        } : undefined,
      };
    });
  }

  formatElapsed(ms, t) {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return t("sessionJustNow");
    const min = Math.floor(sec / 60);
    if (min < 60) return t("sessionMinAgo").replace("{n}", min);
    const hr = Math.floor(min / 60);
    return t("sessionHrAgo").replace("{n}", hr);
  }

  // ── Cleanup ──

  destroy() {
    this.stopStaleCleanup();
    this.stopWakePoll();
    if (this.globalSleepTimer) {
      clearTimeout(this.globalSleepTimer);
      this.globalSleepTimer = null;
    }
    for (const [, session] of this.sessions) {
      session.destroy();
    }
    this.sessions.clear();
    this.ringOrder = [];
  }
}

module.exports = { SessionManager };
