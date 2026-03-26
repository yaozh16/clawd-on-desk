const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Existing
  showContextMenu: () => ipcRenderer.send("show-context-menu"),
  moveWindowBy: (dx, dy) => ipcRenderer.send("move-window-by", dx, dy),
  onStateChange: (callback) => ipcRenderer.on("state-change", (_, state, svg) => callback(state, svg)),
  onEyeMove: (callback) => ipcRenderer.on("eye-move", (_, dx, dy) => callback(dx, dy)),
  onWakeFromDoze: (callback) => ipcRenderer.on("wake-from-doze", () => callback()),
  pauseCursorPolling: () => ipcRenderer.send("pause-cursor-polling"),
  resumeFromReaction: () => ipcRenderer.send("resume-from-reaction"),
  onDndChange: (callback) => ipcRenderer.on("dnd-change", (_, enabled) => callback(enabled)),
  dragLock: (locked) => ipcRenderer.send("drag-lock", locked),
  onMiniModeChange: (cb) => ipcRenderer.on("mini-mode-change", (_, enabled) => cb(enabled)),
  exitMiniMode: () => ipcRenderer.send("exit-mini-mode"),
  dragEnd: () => ipcRenderer.send("drag-end"),
  focusTerminal: () => ipcRenderer.send("focus-terminal"),
  showSessionMenu: () => ipcRenderer.send("show-session-menu"),

  // Multi-pet IPC
  onPetStateChange: (callback) => ipcRenderer.on("pet-state-change", (_, sessionId, state, svg) => callback(sessionId, state, svg)),
  onLayoutUpdate: (callback) => ipcRenderer.on("layout-update", (_, ringOrder, positions) => callback(ringOrder, positions)),
  onPetRemove: (callback) => ipcRenderer.on("pet-remove", (_, sessionId) => callback(sessionId)),
  bringToFront: (sessionId) => ipcRenderer.send("bring-to-front", sessionId),
  rotateRing: (direction) => ipcRenderer.send("rotate-ring", direction),
});
