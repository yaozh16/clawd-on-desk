// Session class - Per-pet state machine
// Each session manages its own pet's state independently

const {
  STATE_SVGS,
  MIN_DISPLAY_MS,
  AUTO_RETURN_MS,
  STATE_PRIORITY,
  SVG_IDLE_FOLLOW,
  SVG_IDLE_LIVING,
  ONESHOT_STATES,
  SLEEP_SEQUENCE,
} = require("./constants");

function getSvgForState(state) {
  const svgs = STATE_SVGS[state] || STATE_SVGS.idle;
  return svgs[Math.floor(Math.random() * svgs.length)];
}

class Session {
  constructor(sessionId, sessionManager) {
    this.id = sessionId;
    this.manager = sessionManager;

    // State machine
    this.state = "idle";
    this.svg = SVG_IDLE_FOLLOW;
    this.stateChangedAt = Date.now();

    // Timers
    this.autoReturnTimer = null;
    this.pendingTimer = null;
    this.pendingState = null;

    // Metadata
    this.sourcePid = null;
    this.cwd = "";
    this.editor = null;
    this.pidChain = null;
    this.agentPid = null;
    this.agentId = null;
    this.pidReachable = true;
    this.updatedAt = Date.now();

    // Send initial state to renderer so pet is created immediately
    this.manager.sendToRenderer("pet-state-change", this.id, this.state, this.svg);
  }

  handleEvent(event, payload) {
    // Clear previous timers
    this.clearTimers();

    // Map event to state
    const newState = this.mapEventToState(event, payload);

    // Update metadata
    if (payload.sourcePid) this.sourcePid = payload.sourcePid;
    if (payload.cwd) this.cwd = payload.cwd;
    if (payload.editor) this.editor = payload.editor;
    if (payload.pidChain) this.pidChain = payload.pidChain;
    if (payload.agentPid) this.agentPid = payload.agentPid;
    if (payload.agentId) this.agentId = payload.agentId;

    // Apply state
    this.setState(newState);

    // Handle oneshot auto-return
    if (AUTO_RETURN_MS[this.state]) {
      this.autoReturnTimer = setTimeout(() => {
        this.autoReturnTimer = null;
        this.setState("idle");
      }, AUTO_RETURN_MS[this.state]);
    }
  }

  mapEventToState(event, payload) {
    // Get event mapping from agent config
    const agentConfig = this.manager.getAgentConfig(this.agentId);
    const eventMap = agentConfig?.eventMap || {};

    // Special handling for certain events
    if (event === "SessionEnd") {
      return "sleeping"; // Will trigger session removal
    }

    if (event === "PermissionRequest") {
      return "notification";
    }

    // Use agent's event map
    return eventMap[event] || this.state;
  }

  setState(newState, svgOverride) {
    // Don't re-enter sleep sequence when already in it
    if (newState === "yawning" && SLEEP_SEQUENCE.has(this.state)) return;

    // Don't displace a pending higher-priority state
    if (this.pendingTimer && this.pendingState) {
      if ((STATE_PRIORITY[newState] || 0) < (STATE_PRIORITY[this.pendingState] || 0)) {
        return;
      }
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
      this.pendingState = null;
    }

    const sameState = newState === this.state;
    const sameSvg = !svgOverride || svgOverride === this.svg;
    if (sameState && sameSvg) return;

    const minTime = MIN_DISPLAY_MS[this.state] || 0;
    const elapsed = Date.now() - this.stateChangedAt;
    const remaining = minTime - elapsed;

    if (remaining > 0) {
      // Schedule state change after minimum display time
      this.pendingState = newState;
      const pendingSvgOverride = svgOverride;
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null;
        const queued = this.pendingState;
        const queuedSvg = pendingSvgOverride;
        this.pendingState = null;

        if (ONESHOT_STATES.has(queued)) {
          this.applyState(queued, queuedSvg);
        } else {
          // For persistent states, re-resolve
          this.applyState(queued, this.getSvgOverride(queued));
        }
      }, remaining);
    } else {
      this.applyState(newState, svgOverride);
    }
  }

  applyState(state, svgOverride) {
    this.state = state;
    this.stateChangedAt = Date.now();
    this.updatedAt = Date.now();

    const svgs = STATE_SVGS[state] || STATE_SVGS.idle;
    this.svg = svgOverride || svgs[Math.floor(Math.random() * svgs.length)];

    // Notify renderer
    this.manager.sendToRenderer("pet-state-change", this.id, this.state, this.svg);

    // Clear eyes when leaving idle
    if (state !== "idle") {
      this.manager.sendToRenderer("eye-move", this.id, 0, 0);
    }
  }

  getSvgOverride(state) {
    if (state === "idle") return SVG_IDLE_FOLLOW;
    if (state === "working") return this.manager.getWorkingSvg();
    if (state === "juggling") return this.manager.getJugglingSvg();
    return null;
  }

  clearTimers() {
    if (this.autoReturnTimer) {
      clearTimeout(this.autoReturnTimer);
      this.autoReturnTimer = null;
    }
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
      this.pendingState = null;
    }
  }

  destroy() {
    this.clearTimers();
    this.manager.sendToRenderer("pet-remove", this.id);
  }

  // Serialize for session menu
  toJSON() {
    return {
      id: this.id,
      state: this.state,
      svg: this.svg,
      updatedAt: this.updatedAt,
      sourcePid: this.sourcePid,
      cwd: this.cwd,
      editor: this.editor,
      agentId: this.agentId,
    };
  }
}

module.exports = { Session };
