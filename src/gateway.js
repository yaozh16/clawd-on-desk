// Gateway class - HTTP server and event routing
// Handles incoming events, routes to SessionManager, manages foreground抢占

const http = require("http");
const path = require("path");
const { ONESHOT_STATES, STATE_SVGS } = require("./constants");

// Events that should bring the session to foreground
const FOREGROUND_EVENTS = new Set([
  "UserPromptSubmit",
  "Stop",
  "PostToolUseFailure",
  "error",
]);

class Gateway {
  constructor(sessionManager, mainProcess) {
    this.manager = sessionManager;
    this.main = mainProcess;
    this.httpServer = null;

    // Permission requests (kept in gateway for now)
    this.pendingPermissions = [];
  }

  startHttpServer(port = 23333) {
    this.httpServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/state") {
        this.handleStateRequest(req, res);
      } else if (req.method === "POST" && req.url === "/permission") {
        this.handlePermissionRequest(req, res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.httpServer.listen(port, "127.0.0.1", () => {
      console.log(`Clawd state server listening on 127.0.0.1:${port}`);
    });

    this.httpServer.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`Port ${port} is in use — running in idle-only mode`);
      } else {
        console.error("HTTP server error:", err.message);
      }
    });
  }

  handleStateRequest(req, res) {
    let body = "";
    let bodySize = 0;
    let destroyed = false;

    req.on("data", (chunk) => {
      bodySize += chunk.length;
      if (bodySize > 1024) {
        destroyed = true;
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on("end", () => {
      if (destroyed) return;

      try {
        const data = JSON.parse(body);
        const { state, svg, event } = data;
        const sessionId = data.session_id || "default";

        // Parse metadata
        const payload = {
          sourcePid: Number.isFinite(data.source_pid) && data.source_pid > 0
            ? Math.floor(data.source_pid) : null,
          cwd: typeof data.cwd === "string" ? data.cwd : "",
          editor: (data.editor === "code" || data.editor === "cursor") ? data.editor : null,
          pidChain: Array.isArray(data.pid_chain)
            ? data.pid_chain.filter(n => Number.isFinite(n) && n > 0) : null,
          agentPid: Number.isFinite(data.agent_pid ?? data.claude_pid)
            ? Math.floor(data.agent_pid ?? data.claude_pid) : null,
          agentId: typeof data.agent_id === "string" ? data.agent_id : "claude-code",
        };

        // Validate state
        if (!STATE_SVGS[state]) {
          res.writeHead(400);
          res.end("unknown state");
          return;
        }

        // mini-* states require SVG override
        if (state.startsWith("mini-") && !svg) {
          res.writeHead(400);
          res.end("mini states require svg override");
          return;
        }

        // Handle SessionEnd
        if (event === "SessionEnd") {
          this.manager.removeSession(sessionId);
          res.writeHead(200);
          res.end("ok");
          return;
        }

        // Handle PermissionRequest separately
        if (event === "PermissionRequest") {
          // Just show notification on foreground pet, don't mutate session
          const fgId = this.manager.getForegroundSessionId() || sessionId;
          this.manager.sendToRenderer("pet-state-change", fgId, "notification", "clawd-notification.svg");
          res.writeHead(200);
          res.end("ok");
          return;
        }

        // Handle "user answered in terminal"
        if (event === "PostToolUse" || event === "PostToolUseFailure" || event === "Stop") {
          for (const perm of [...this.pendingPermissions]) {
            if (perm.sessionId === sessionId) {
              this.resolvePermission(perm, "deny", "User answered in terminal");
            }
          }
        }

        // Direct SVG override
        if (svg) {
          const safeSvg = path.basename(svg);
          this.manager.sendToRenderer("pet-state-change", sessionId, state, safeSvg);
          res.writeHead(200);
          res.end("ok");
          return;
        }

        // Route to session
        this.handleEvent(sessionId, state, event, payload);

        res.writeHead(200);
        res.end("ok");
      } catch {
        res.writeHead(400);
        res.end("bad json");
      }
    });
  }

  handleEvent(sessionId, state, event, payload) {
    // Wake from global sleep if needed
    this.manager.wakeFromGlobalSleep();

    // Check if this is a new session
    const isNewSession = !this.manager.hasSession(sessionId);

    // Get or create session
    const session = this.manager.getOrCreateSession(sessionId);

    // Check PID reachability (WSL2/remote) - only for new sessions
    if (isNewSession) {
      session.pidReachable = payload.agentPid
        ? this.isProcessAlive(payload.agentPid)
        : payload.sourcePid
          ? this.isProcessAlive(payload.sourcePid)
          : false;
    }

    // Bring to foreground for certain events
    if (FOREGROUND_EVENTS.has(event) || FOREGROUND_EVENTS.has(state)) {
      this.manager.bringToFront(sessionId);
    }

    // Handle event in session
    session.handleEvent(event, payload);
  }

  isProcessAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return e.code === "EPERM";
    }
  }

  // ── Permission Handling ──

  handlePermissionRequest(req, res) {
    let body = "";
    let bodySize = 0;
    let destroyed = false;

    req.on("data", (chunk) => {
      bodySize += chunk.length;
      if (bodySize > 8192) {
        destroyed = true;
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on("end", () => {
      if (destroyed) return;

      // DND mode: deny immediately
      if (this.main.isDND()) {
        this.sendPermissionResponse(res, "deny", "Clawd is in Do Not Disturb mode");
        return;
      }

      try {
        const data = JSON.parse(body);
        const toolName = typeof data.tool_name === "string" ? data.tool_name : "Unknown";
        const toolInput = data.tool_input && typeof data.tool_input === "object" ? data.tool_input : {};
        const sessionId = data.session_id || "default";
        const suggestions = Array.isArray(data.permission_suggestions) ? data.permission_suggestions : [];

        const permEntry = {
          res,
          abortHandler: null,
          suggestions,
          sessionId,
          bubble: null,
          hideTimer: null,
          toolName,
          toolInput,
          resolvedSuggestion: null,
          createdAt: Date.now(),
        };

        // Handle client disconnect
        const abortHandler = () => {
          if (res.writableFinished) return;
          this.resolvePermission(permEntry, "deny", "Client disconnected");
        };
        permEntry.abortHandler = abortHandler;
        res.on("close", abortHandler);

        this.pendingPermissions.push(permEntry);
        this.main.showPermissionBubble(permEntry);
      } catch {
        res.writeHead(400);
        res.end("bad json");
      }
    });
  }

  resolvePermission(permEntry, behavior, message) {
    const idx = this.pendingPermissions.indexOf(permEntry);
    if (idx === -1) return;
    this.pendingPermissions.splice(idx, 1);

    const { res, abortHandler, bubble } = permEntry;
    if (abortHandler) res.removeListener("close", abortHandler);

    // Hide bubble
    if (bubble && !bubble.isDestroyed()) {
      bubble.webContents.send("permission-hide");
      if (permEntry.hideTimer) clearTimeout(permEntry.hideTimer);
      permEntry.hideTimer = setTimeout(() => {
        if (bubble && !bubble.isDestroyed()) bubble.destroy();
      }, 250);
    }

    // Reposition remaining bubbles
    this.main.repositionBubbles();

    // Send response
    if (res.writableEnded || res.destroyed) return;

    const decision = { behavior: behavior === "deny" ? "deny" : "allow" };
    if (behavior === "deny" && message) decision.message = message;
    if (permEntry.resolvedSuggestion) {
      decision.updatedPermissions = [permEntry.resolvedSuggestion];
    }

    this.sendPermissionResponse(res, decision);
  }

  sendPermissionResponse(res, decisionOrBehavior, message) {
    let decision;
    if (typeof decisionOrBehavior === "string") {
      decision = { behavior: decisionOrBehavior };
      if (message) decision.message = message;
    } else {
      decision = decisionOrBehavior;
    }

    const responseBody = JSON.stringify({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision },
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(responseBody);
  }

  // ── Cleanup ──

  stop() {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }

    // Deny all pending permissions
    for (const perm of [...this.pendingPermissions]) {
      this.resolvePermission(perm, "deny", "Clawd is quitting");
    }
  }
}

module.exports = { Gateway };
