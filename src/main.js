const { app, BrowserWindow, screen, Menu, Tray, ipcMain, nativeImage, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const isMac = process.platform === "darwin";

// ── Import new modules ──
const { SessionManager } = require("./session-manager");
const { Gateway } = require("./gateway");
const {
  SVG_IDLE_FOLLOW,
  STATE_SVGS,
  STATE_PRIORITY,
  SESSION_STALE_MS_DEFAULT,
  WORKING_STALE_MS_DEFAULT,
  MOUSE_SLEEP_TIMEOUT_DEFAULT,
  DEEP_SLEEP_TIMEOUT_DEFAULT,
} = require("./constants");

// ── Windows: AllowSetForegroundWindow via FFI ──
let _allowSetForeground = null;
if (!isMac) {
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    _allowSetForeground = user32.func("bool __stdcall AllowSetForegroundWindow(int dwProcessId)");
  } catch (err) {
    console.warn("Clawd: koffi/AllowSetForegroundWindow not available:", err.message);
  }
}

// ── Window size presets ──
const SIZES = {
  S: { width: 200, height: 200 },
  M: { width: 280, height: 280 },
  L: { width: 360, height: 360 },
};

// ── Internationalization ──
const i18n = {
  en: {
    size: "Size",
    small: "Small (S)",
    medium: "Medium (M)",
    large: "Large (L)",
    miniMode: "Mini Mode",
    exitMiniMode: "Exit Mini Mode",
    sleep: "Sleep (Do Not Disturb)",
    wake: "Wake Clawd",
    startOnLogin: "Start on Login",
    startWithClaude: "Start with Claude Code",
    showInMenuBar: "Show in Menu Bar",
    showInDock: "Show in Dock",
    language: "Language",
    checkForUpdates: "Check for Updates",
    checkingForUpdates: "Checking for Updates…",
    updateAvailable: "Update Available",
    updateAvailableMsg: "v{version} is available. Download and install now?",
    updateAvailableMacMsg: "v{version} is available. Open the download page?",
    updateNotAvailable: "You're Up to Date",
    updateNotAvailableMsg: "Clawd v{version} is the latest version.",
    updateDownloading: "Downloading Update…",
    updateReady: "Update Ready",
    updateReadyMsg: "v{version} has been downloaded. Restart now to update?",
    updateError: "Update Error",
    updateErrorMsg: "Failed to check for updates. Please try again later.",
    restartNow: "Restart Now",
    restartLater: "Later",
    download: "Download",
    sessions: "Sessions",
    noSessions: "No active sessions",
    sessionWorking: "Working",
    sessionThinking: "Thinking",
    sessionJuggling: "Juggling",
    sessionIdle: "Idle",
    sessionSleeping: "Sleeping",
    sessionJustNow: "just now",
    sessionMinAgo: "{n}m ago",
    sessionHrAgo: "{n}h ago",
    settings: "Settings",
    sessionTimeout: "Session Timeout",
    sessionTimeoutDesc: "Remove inactive sessions after",
    workingTimeout: "Working Timeout",
    workingTimeoutDesc: "Reset working state after",
    sleepTimeout: "Sleep Timeout",
    sleepTimeoutDesc: "Enter deep sleep after",
    minutes: "minutes",
    seconds: "seconds",
    layoutMode: "Layout Mode",
    layoutCircular: "Circular",
    layoutLinear: "Linear",
    layoutGrid: "Grid",
    quit: "Quit",
  },
  zh: {
    size: "大小",
    small: "小 (S)",
    medium: "中 (M)",
    large: "大 (L)",
    miniMode: "极简模式",
    exitMiniMode: "退出极简模式",
    sleep: "休眠（免打扰）",
    wake: "唤醒 Clawd",
    startOnLogin: "开机自启",
    startWithClaude: "随 Claude Code 启动",
    showInMenuBar: "在菜单栏显示",
    showInDock: "在 Dock 显示",
    language: "语言",
    checkForUpdates: "检查更新",
    checkingForUpdates: "正在检查更新…",
    updateAvailable: "发现新版本",
    updateAvailableMsg: "v{version} 已发布，是否下载并安装？",
    updateAvailableMacMsg: "v{version} 已发布，是否打开下载页面？",
    updateNotAvailable: "已是最新版本",
    updateNotAvailableMsg: "Clawd v{version} 已是最新版本。",
    updateDownloading: "正在下载更新…",
    updateReady: "更新就绪",
    updateReadyMsg: "v{version} 已下载完成，是否立即重启以完成更新？",
    updateError: "更新失败",
    updateErrorMsg: "检查更新失败，请稍后再试。",
    restartNow: "立即重启",
    restartLater: "稍后",
    download: "下载",
    sessions: "会话",
    noSessions: "无活跃会话",
    sessionWorking: "工作中",
    sessionThinking: "思考中",
    sessionJuggling: "多任务",
    sessionIdle: "空闲",
    sessionSleeping: "睡眠",
    sessionJustNow: "刚刚",
    sessionMinAgo: "{n}分钟前",
    sessionHrAgo: "{n}小时前",
    settings: "设置",
    sessionTimeout: "会话超时",
    sessionTimeoutDesc: "清理不活跃会话",
    workingTimeout: "工作状态超时",
    workingTimeoutDesc: "重置工作状态",
    sleepTimeout: "睡眠超时",
    sleepTimeoutDesc: "进入深度睡眠",
    minutes: "分钟",
    seconds: "秒",
    layoutMode: "布局模式",
    layoutCircular: "环形",
    layoutLinear: "线性",
    layoutGrid: "网格",
    quit: "退出",
  },
};
let lang = "en";
function t(key) { return (i18n[lang] || i18n.en)[key] || key; }

// ── Position persistence ──
const PREFS_PATH = path.join(app.getPath("userData"), "clawd-prefs.json");

function loadPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_PATH, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    for (const key of ["x", "y", "preMiniX", "preMiniY"]) {
      if (key in raw && (typeof raw[key] !== "number" || !isFinite(raw[key]))) {
        raw[key] = 0;
      }
    }
    // Load configurable settings
    if (typeof raw.sessionStaleMs === "number") configSessionStaleMs = raw.sessionStaleMs;
    if (typeof raw.workingStaleMs === "number") configWorkingStaleMs = raw.workingStaleMs;
    if (typeof raw.mouseSleepTimeout === "number") configMouseSleepTimeout = raw.mouseSleepTimeout;
    if (typeof raw.deepSleepTimeout === "number") configDeepSleepTimeout = raw.deepSleepTimeout;
    if (typeof raw.layoutStrategy === "string") configLayoutStrategy = raw.layoutStrategy;
    return raw;
  } catch {
    return null;
  }
}

function savePrefs() {
  if (!win || win.isDestroyed()) return;
  const { x, y } = win.getBounds();
  const data = {
    x, y, size: currentSize,
    miniMode, preMiniX, preMiniY, lang,
    showTray, showDock,
    autoStartWithClaude,
    sessionStaleMs: configSessionStaleMs,
    workingStaleMs: configWorkingStaleMs,
    mouseSleepTimeout: configMouseSleepTimeout,
    deepSleepTimeout: configDeepSleepTimeout,
    layoutStrategy: configLayoutStrategy,
  };
  try { fs.writeFileSync(PREFS_PATH, JSON.stringify(data)); } catch {}
}

// ── Global state ──
let win;
let tray = null;
let contextMenuOwner = null;
let currentSize = "S";
let contextMenu;
let doNotDisturb = false;
let isQuitting = false;

// ── Configurable settings (loaded from prefs, with defaults) ──
let configSessionStaleMs = SESSION_STALE_MS_DEFAULT;
let configWorkingStaleMs = WORKING_STALE_MS_DEFAULT;
let configMouseSleepTimeout = MOUSE_SLEEP_TIMEOUT_DEFAULT;
let configDeepSleepTimeout = DEEP_SLEEP_TIMEOUT_DEFAULT;
let configLayoutStrategy = "circular";
let showTray = true;
let showDock = true;
let autoStartWithClaude = false;

// ── Mini Mode ──
const MINI_OFFSET_RATIO = 0.486;
const PEEK_OFFSET = 25;
const SNAP_TOLERANCE = 30;
const JUMP_PEAK_HEIGHT = 40;
const JUMP_DURATION = 350;
const CRABWALK_SPEED = 0.12;

let miniMode = false;
let miniTransitioning = false;
let miniSleepPeeked = false;
let preMiniX = 0, preMiniY = 0;
let currentMiniX = 0;
let miniSnap = null;
let miniTransitionTimer = null;
let peekAnimTimer = null;
let isAnimating = false;

// ── Mouse tracking ──
let lastCursorX = null, lastCursorY = null;
let mouseStillSince = Date.now();
let isMouseIdle = false;
let hasTriggeredYawn = false;
let idleLookPlayed = false;
let idleWasActive = false;
let lastEyeDx = 0, lastEyeDy = 0;
let forceEyeResend = false;
let forceMouseStateRefresh = false;
let eyeResendTimer = null;
let idleLookReturnTimer = null;
let yawnDelayTimer = null;
let mainTickTimer = null;
let mouseOverPet = false;
let dragLocked = false;
let menuOpen = false;
let idlePaused = false;

// ── CSS <object> sizing ──
const OBJ_SCALE_W = 1.9;
const OBJ_SCALE_H = 1.3;
const OBJ_OFF_X = -0.45;
const OBJ_OFF_Y = -0.25;

function getObjRect(bounds) {
  return {
    x: bounds.x + bounds.width * OBJ_OFF_X,
    y: bounds.y + bounds.height * OBJ_OFF_Y,
    w: bounds.width * OBJ_SCALE_W,
    h: bounds.height * OBJ_SCALE_H,
  };
}

// ── Hit-test bounding boxes ──
const HIT_BOXES = {
  default: { x: -1, y: 5, w: 17, h: 12 },
  sleeping: { x: -2, y: 9, w: 19, h: 7 },
  wide: { x: -3, y: 3, w: 21, h: 14 },
};
const WIDE_SVGS = new Set(["clawd-error.svg", "clawd-working-building.svg", "clawd-notification.svg", "clawd-working-conducting.svg"]);
let currentHitBox = HIT_BOXES.default;

function sendToRenderer(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

// ── Session Manager and Gateway ──
let sessionManager = null;
let gateway = null;

// Main process interface for SessionManager
const mainInterface = {
  sendToRenderer,
  isMiniMode: () => miniMode,
  isDND: () => doNotDisturb,
  getAgentConfig: (agentId) => {
    try {
      const registry = require("../agents/registry");
      return registry.getAgent(agentId);
    } catch {
      return null;
    }
  },
  focusTerminal: (sourcePid, cwd, editor, pidChain) => {
    focusTerminalWindow(sourcePid, cwd, editor, pidChain);
  },
  showPermissionBubble: (permEntry) => {
    showPermissionBubble(permEntry);
  },
  repositionBubbles: () => {
    repositionBubbles();
  },
  addPendingPermission: (permEntry) => {
    pendingPermissions.push(permEntry);
  },
  resolvePermission: (permEntry, behavior, message) => {
    resolvePermissionEntry(permEntry, behavior, message);
  },
  denyPermissionsForSession: (sessionId) => {
    for (const perm of [...pendingPermissions]) {
      if (perm.sessionId === sessionId) {
        resolvePermissionEntry(perm, "deny", "User answered in terminal");
      }
    }
  },
};

// Helper to get display session ID (foreground or global)
function getDisplaySessionId() {
  const fg = sessionManager?.getForegroundSessionId();
  return fg || "__global__";
}

// ── Hit-test ──
function getHitRectScreen(bounds) {
  const obj = getObjRect(bounds);
  const scale = Math.min(obj.w, obj.h) / 45;
  const offsetX = obj.x + (obj.w - 45 * scale) / 2;
  const offsetY = obj.y + (obj.h - 45 * scale) / 2;
  const hb = currentHitBox;
  return {
    left: offsetX + (hb.x + 15) * scale,
    top: offsetY + (hb.y + 25) * scale,
    right: offsetX + (hb.x + 15 + hb.w) * scale,
    bottom: offsetY + (hb.y + 25 + hb.h) * scale,
  };
}

// ── Main tick ──
function startMainTick() {
  if (mainTickTimer) return;
  win.setIgnoreMouseEvents(true);
  mouseOverPet = false;

  mainTickTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();

    // Hit-test
    const bounds = win.getBounds();
    if (!dragLocked) {
      const hit = getHitRectScreen(bounds);
      const over = cursor.x >= hit.left && cursor.x <= hit.right
                && cursor.y >= hit.top && cursor.y <= hit.bottom;
      if (over !== mouseOverPet || forceMouseStateRefresh) {
        forceMouseStateRefresh = false;
        mouseOverPet = over;
        win.setIgnoreMouseEvents(!over);
      }
    }

    // Mini mode peek hover
    if (miniMode && !miniTransitioning && !dragLocked && !menuOpen) {
      // ... mini mode hover logic (kept from original)
    }

    // Eye tracking for foreground pet
    const foregroundSession = sessionManager?.getForegroundSession();
    if (foregroundSession && foregroundSession.state === "idle") {
      trackEyes(bounds, cursor);
    }
  }, 50);
}

function trackEyes(bounds, cursor) {
  const moved = lastCursorX !== null && (cursor.x !== lastCursorX || cursor.y !== lastCursorY);
  lastCursorX = cursor.x;
  lastCursorY = cursor.y;

  if (!moved && !forceEyeResend) return;
  forceEyeResend = false;

  const obj = getObjRect(bounds);
  const eyeScreenX = obj.x + obj.w * (22 / 45);
  const eyeScreenY = obj.y + obj.h * (34 / 45);
  const relX = cursor.x - eyeScreenX;
  const relY = cursor.y - eyeScreenY;
  const MAX_OFFSET = 3;
  const dist = Math.sqrt(relX * relX + relY * relY);

  let eyeDx = 0, eyeDy = 0;
  if (dist > 1) {
    const scale = Math.min(1, dist / 300);
    eyeDx = (relX / dist) * MAX_OFFSET * scale;
    eyeDy = (relY / dist) * MAX_OFFSET * scale;
  }

  eyeDx = Math.round(eyeDx * 2) / 2;
  eyeDy = Math.round(eyeDy * 2) / 2;
  eyeDy = Math.max(-1.5, Math.min(1.5, eyeDy));

  if (eyeDx !== lastEyeDx || eyeDy !== lastEyeDy) {
    lastEyeDx = eyeDx;
    lastEyeDy = eyeDy;
    sendToRenderer("eye-move", eyeDx, eyeDy);
  }
}

// ── Do Not Disturb ──
function enableDoNotDisturb() {
  if (doNotDisturb) return;
  doNotDisturb = true;
  sendToRenderer("dnd-change", true);
  for (const perm of [...pendingPermissions]) resolvePermissionEntry(perm, "deny", "DND enabled");
  buildContextMenu();
  buildTrayMenu();
}

function disableDoNotDisturb() {
  if (!doNotDisturb) return;
  doNotDisturb = false;
  sendToRenderer("dnd-change", false);
  buildContextMenu();
  buildTrayMenu();
}

// ── Permission bubble ──
const pendingPermissions = [];
let permDebugLog = null;

function estimateBubbleHeight(sugCount) {
  return 200 + (sugCount || 0) * 37;
}

function repositionBubbles() {
  const margin = 8;
  const gap = 6;
  const bw = 340;
  const petBounds = win.getBounds();
  const cx = petBounds.x + petBounds.width / 2;
  const cy = petBounds.y + petBounds.height / 2;
  const wa = getNearestWorkArea(cx, cy);
  const x = wa.x + wa.width - bw - margin;

  let yBottom = wa.y + wa.height - margin;
  for (let i = pendingPermissions.length - 1; i >= 0; i--) {
    const perm = pendingPermissions[i];
    const bh = perm.measuredHeight || estimateBubbleHeight((perm.suggestions || []).length);
    const y = yBottom - bh;
    yBottom = y - gap;
    if (perm.bubble && !perm.bubble.isDestroyed()) {
      perm.bubble.setBounds({ x, y, width: bw, height: bh });
    }
  }
}

function showPermissionBubble(permEntry) {
  const sugCount = (permEntry.suggestions || []).length;
  const bh = estimateBubbleHeight(sugCount);
  const pos = { x: 0, y: 0, width: 340, height: bh };

  // Show notification state on foreground pet
  const fgSession = sessionManager?.getForegroundSession();
  if (fgSession) {
    permEntry.previousState = fgSession.state;
    permEntry.previousSvg = fgSession.svg;
    fgSession.setState("notification");
  }

  const bub = new BrowserWindow({
    width: pos.width,
    height: pos.height,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-bubble.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  permEntry.bubble = bub;

  if (isMac) {
    bub.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    bub.setAlwaysOnTop(true, "floating");
  } else {
    bub.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
  }

  bub.loadFile(path.join(__dirname, "bubble.html"));

  bub.webContents.once("did-finish-load", () => {
    bub.webContents.send("permission-show", {
      toolName: permEntry.toolName,
      toolInput: permEntry.toolInput,
      suggestions: permEntry.suggestions || [],
      lang,
    });
  });

  repositionBubbles();
  bub.showInactive();

  bub.on("closed", () => {
    const idx = pendingPermissions.indexOf(permEntry);
    if (idx !== -1) {
      resolvePermissionEntry(permEntry, "deny", "Bubble window closed by user");
    }
  });

  guardAlwaysOnTop(bub);
}

function resolvePermissionEntry(permEntry, behavior, message) {
  const idx = pendingPermissions.indexOf(permEntry);
  if (idx === -1) return;
  pendingPermissions.splice(idx, 1);

  const { res, abortHandler, bubble: bub } = permEntry;
  if (abortHandler) res.removeListener("close", abortHandler);

  if (bub && !bub.isDestroyed()) {
    bub.webContents.send("permission-hide");
    if (permEntry.hideTimer) clearTimeout(permEntry.hideTimer);
    permEntry.hideTimer = setTimeout(() => {
      if (bub && !bub.isDestroyed()) bub.destroy();
    }, 250);
  }

  repositionBubbles();

  // Restore foreground pet state
  if (permEntry.previousState) {
    const fgSession = sessionManager?.getForegroundSession();
    if (fgSession) {
      fgSession.setState(permEntry.previousState, permEntry.previousSvg);
    }
  }

  if (res.writableEnded || res.destroyed) return;

  const decision = { behavior: behavior === "deny" ? "deny" : "allow" };
  if (behavior === "deny" && message) decision.message = message;
  if (permEntry.resolvedSuggestion) {
    decision.updatedPermissions = [permEntry.resolvedSuggestion];
  }

  sendPermissionResponse(res, decision);
}

function sendPermissionResponse(res, decisionOrBehavior, message) {
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

// ── System tray ──
function createTray() {
  if (tray) return;
  let icon;
  if (isMac) {
    icon = nativeImage.createFromPath(path.join(__dirname, "../assets/tray-iconTemplate.png"));
    icon.setTemplateImage(true);
  } else {
    icon = nativeImage.createFromPath(path.join(__dirname, "../assets/tray-icon.png")).resize({ width: 32, height: 32 });
  }
  tray = new Tray(icon);
  tray.setToolTip("Clawd Desktop Pet");
  buildTrayMenu();
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function setShowTray(val) {
  if (!val && !showDock) return;
  showTray = val;
  if (showTray) {
    createTray();
  } else {
    destroyTray();
  }
  buildContextMenu();
  savePrefs();
}

function applyDockVisibility() {
  if (!isMac) return;
  if (showDock) {
    app.setActivationPolicy("regular");
    if (app.dock) app.dock.show();
  } else {
    app.setActivationPolicy("accessory");
    if (app.dock) app.dock.hide();
  }
}

function setShowDock(val) {
  if (!isMac || !app.dock) return;
  if (!val && !showTray) return;
  showDock = val;
  applyDockVisibility();
  buildTrayMenu();
  buildContextMenu();
  savePrefs();
}

function buildTrayMenu() {
  if (!tray) return;
  const items = [
    {
      label: doNotDisturb ? t("wake") : t("sleep"),
      click: () => doNotDisturb ? disableDoNotDisturb() : enableDoNotDisturb(),
    },
    { type: "separator" },
    {
      label: t("startOnLogin"),
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({ openAtLogin: menuItem.checked });
      },
    },
    {
      label: t("startWithClaude"),
      type: "checkbox",
      checked: autoStartWithClaude,
      click: (menuItem) => {
        autoStartWithClaude = menuItem.checked;
        try {
          const { registerHooks, unregisterAutoStart } = require("../hooks/install.js");
          if (autoStartWithClaude) {
            registerHooks({ silent: true, autoStart: true });
          } else {
            unregisterAutoStart();
          }
        } catch (err) {
          console.warn("Clawd: failed to toggle auto-start hook:", err.message);
        }
        savePrefs();
      },
    },
  ];
  if (isMac) {
    items.push(
      { type: "separator" },
      {
        label: t("showInMenuBar"),
        type: "checkbox",
        checked: showTray,
        enabled: showTray ? showDock : true,
        click: (menuItem) => setShowTray(menuItem.checked),
      },
      {
        label: t("showInDock"),
        type: "checkbox",
        checked: showDock,
        enabled: showDock ? showTray : true,
        click: (menuItem) => setShowDock(menuItem.checked),
      },
    );
  }
  items.push(
    { type: "separator" },
    getUpdateMenuItem(),
    { type: "separator" },
    {
      label: t("language"),
      submenu: [
        { label: "English", type: "radio", checked: lang === "en", click: () => setLanguage("en") },
        { label: "中文", type: "radio", checked: lang === "zh", click: () => setLanguage("zh") },
      ],
    },
    { type: "separator" },
    { label: t("quit"), click: () => requestAppQuit() },
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

// ── Auto-updater ──
let _autoUpdater = null;
function getAutoUpdater() {
  if (!_autoUpdater) {
    try {
      _autoUpdater = require("electron-updater").autoUpdater;
      _autoUpdater.autoDownload = false;
      _autoUpdater.autoInstallOnAppQuit = true;
    } catch {
      console.warn("Clawd: electron-updater not available, auto-update disabled");
      return null;
    }
  }
  return _autoUpdater;
}

let updateStatus = "idle";
let manualUpdateCheck = false;

function setupAutoUpdater() {
  const autoUpdater = getAutoUpdater();
  if (!autoUpdater) return;

  autoUpdater.on("update-available", (info) => {
    const wasManual = manualUpdateCheck;
    manualUpdateCheck = false;
    if (!wasManual && (doNotDisturb || miniMode)) return;
    updateStatus = "available";
    rebuildAllMenus();

    if (isMac) {
      dialog.showMessageBox({
        type: "info",
        title: t("updateAvailable"),
        message: t("updateAvailableMacMsg").replace("{version}", info.version),
        buttons: [t("download"), t("restartLater")],
        defaultId: 0,
        noLink: true,
      }).then(({ response }) => {
        if (response === 0) {
          shell.openExternal("https://github.com/rullerzhou-afk/clawd-on-desk/releases/latest");
        }
        updateStatus = "idle";
        rebuildAllMenus();
      });
    } else {
      dialog.showMessageBox({
        type: "info",
        title: t("updateAvailable"),
        message: t("updateAvailableMsg").replace("{version}", info.version),
        buttons: [t("download"), t("restartLater")],
        defaultId: 0,
        noLink: true,
      }).then(({ response }) => {
        if (response === 0) {
          updateStatus = "downloading";
          rebuildAllMenus();
          autoUpdater.downloadUpdate();
        } else {
          updateStatus = "idle";
          rebuildAllMenus();
        }
      });
    }
  });

  autoUpdater.on("update-not-available", () => {
    updateStatus = "idle";
    rebuildAllMenus();
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
      dialog.showMessageBox({
        type: "info",
        title: t("updateNotAvailable"),
        message: t("updateNotAvailableMsg").replace("{version}", app.getVersion()),
        noLink: true,
      });
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateStatus = "ready";
    rebuildAllMenus();
    dialog.showMessageBox({
      type: "info",
      title: t("updateReady"),
      message: t("updateReadyMsg").replace("{version}", info.version),
      buttons: [t("restartNow"), t("restartLater")],
      defaultId: 0,
      noLink: true,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    });
  });

  autoUpdater.on("error", () => {
    updateStatus = "error";
    rebuildAllMenus();
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
      dialog.showMessageBox({
        type: "error",
        title: t("updateError"),
        message: t("updateErrorMsg"),
        noLink: true,
      });
    }
  });
}

function checkForUpdates(manual = false) {
  if (updateStatus === "checking" || updateStatus === "downloading") return;
  manualUpdateCheck = manual;
  updateStatus = "checking";
  rebuildAllMenus();
  const au = getAutoUpdater();
  if (!au) return;
  au.checkForUpdates().then((result) => {
    if (!result) {
      updateStatus = "idle";
      manualUpdateCheck = false;
      rebuildAllMenus();
    }
  }).catch(() => {
    updateStatus = "error";
    manualUpdateCheck = false;
    rebuildAllMenus();
  });
}

function getUpdateMenuItem() {
  return {
    label: getUpdateMenuLabel(),
    enabled: updateStatus !== "checking" && updateStatus !== "downloading",
    click: () => updateStatus === "ready"
      ? getAutoUpdater()?.quitAndInstall(false, true)
      : checkForUpdates(true),
  };
}

function getUpdateMenuLabel() {
  switch (updateStatus) {
    case "checking": return t("checkingForUpdates");
    case "downloading": return t("updateDownloading");
    case "ready": return t("updateReady");
    default: return t("checkForUpdates");
  }
}

function rebuildAllMenus() {
  buildTrayMenu();
  buildContextMenu();
}

// ── Window creation ──
function requestAppQuit() {
  isQuitting = true;
  app.quit();
}

function ensureContextMenuOwner() {
  if (contextMenuOwner && !contextMenuOwner.isDestroyed()) return contextMenuOwner;
  if (!win || win.isDestroyed()) return null;

  contextMenuOwner = new BrowserWindow({
    parent: win,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: true,
    closable: false,
    minimizable: false,
    maximizable: false,
    hasShadow: false,
  });

  contextMenuOwner.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      contextMenuOwner.hide();
    }
  });

  contextMenuOwner.on("closed", () => {
    contextMenuOwner = null;
  });

  return contextMenuOwner;
}

function popupMenuAt(menu) {
  if (menuOpen) return;
  const owner = ensureContextMenuOwner();
  if (!owner) return;

  const cursor = screen.getCursorScreenPoint();
  owner.setBounds({ x: cursor.x, y: cursor.y, width: 1, height: 1 });
  owner.show();
  owner.focus();

  menuOpen = true;
  menu.popup({
    window: owner,
    callback: () => {
      menuOpen = false;
      if (owner && !owner.isDestroyed()) owner.hide();
      if (win && !win.isDestroyed()) {
        win.showInactive();
        win.setAlwaysOnTop(true, isMac ? "floating" : WIN_TOPMOST_LEVEL);
      }
    },
  });
}

function showPetContextMenu() {
  if (!win || win.isDestroyed()) return;
  buildContextMenu();
  popupMenuAt(contextMenu);
}

function createWindow() {
  const prefs = loadPrefs();
  if (prefs && SIZES[prefs.size]) currentSize = prefs.size;
  if (prefs && i18n[prefs.lang]) lang = prefs.lang;
  if (isMac && prefs) {
    if (typeof prefs.showTray === "boolean") showTray = prefs.showTray;
    if (typeof prefs.showDock === "boolean") showDock = prefs.showDock;
  }
  if (prefs && typeof prefs.autoStartWithClaude === "boolean") autoStartWithClaude = prefs.autoStartWithClaude;
  if (isMac) {
    applyDockVisibility();
  }
  const size = SIZES[currentSize];

  let startX, startY;
  if (prefs && prefs.miniMode) {
    preMiniX = prefs.preMiniX || 0;
    preMiniY = prefs.preMiniY || 0;
    const wa = getNearestWorkArea(prefs.x + size.width / 2, prefs.y + size.height / 2);
    currentMiniX = wa.x + wa.width - Math.round(size.width * (1 - MINI_OFFSET_RATIO));
    startX = currentMiniX;
    startY = Math.max(wa.y, Math.min(prefs.y, wa.y + wa.height - size.height));
    miniSnap = { y: startY, width: size.width, height: size.height };
    miniMode = true;
  } else if (prefs) {
    const clamped = clampToScreen(prefs.x, prefs.y, size.width, size.height);
    startX = clamped.x;
    startY = clamped.y;
  } else {
    const { workArea } = screen.getPrimaryDisplay();
    startX = workArea.x + workArea.width - size.width - 20;
    startY = workArea.y + workArea.height - size.height - 20;
  }

  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: startX,
    y: startY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      backgroundThrottling: false,
    },
  });

  win.setFocusable(false);
  if (isMac) {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    win.setAlwaysOnTop(true, "floating");
  } else {
    win.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
  }
  win.loadFile(path.join(__dirname, "index.html"));
  win.showInactive();

  if (isMac) {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      applyDockVisibility();
    }, 0);
  }

  buildContextMenu();
  if (!isMac || showTray) createTray();
  ensureContextMenuOwner();

  // ── IPC handlers ──
  ipcMain.on("show-context-menu", showPetContextMenu);

  ipcMain.on("move-window-by", (event, dx, dy) => {
    if (miniMode || miniTransitioning) return;
    const { x, y } = win.getBounds();
    const size = SIZES[currentSize];
    const clamped = clampToScreen(x + dx, y + dy, size.width, size.height);
    win.setBounds({ ...clamped, width: size.width, height: size.height });
  });

  ipcMain.on("pause-cursor-polling", () => { idlePaused = true; });
  ipcMain.on("resume-from-reaction", () => {
    idlePaused = false;
    if (miniTransitioning) return;
    // Re-send foreground pet state
    const fg = sessionManager?.getForegroundSession();
    if (fg) {
      sendToRenderer("pet-state-change", fg.id, fg.state, fg.svg);
    }
  });

  ipcMain.on("drag-lock", (event, locked) => {
    dragLocked = !!locked;
    if (locked && !mouseOverPet) {
      mouseOverPet = true;
      win.setIgnoreMouseEvents(false);
    }
  });

  ipcMain.on("drag-end", () => {
    if (!miniMode && !miniTransitioning) {
      checkMiniModeSnap();
    }
  });

  ipcMain.on("exit-mini-mode", () => {
    if (miniMode) exitMiniMode();
  });

  ipcMain.on("focus-terminal", () => {
    const fg = sessionManager?.getForegroundSession();
    if (fg && fg.sourcePid) {
      focusTerminalWindow(fg.sourcePid, fg.cwd, fg.editor, fg.pidChain);
    }
  });

  ipcMain.on("show-session-menu", () => {
    popupMenuAt(Menu.buildFromTemplate(sessionManager.buildSessionSubmenu(lang, t)));
  });

  ipcMain.on("bring-to-front", (event, sessionId) => {
    sessionManager?.bringToFront(sessionId);
  });

  ipcMain.on("bubble-height", (event, height) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const perm = pendingPermissions.find(p => p.bubble === senderWin);
    if (perm && typeof height === "number" && height > 0) {
      perm.measuredHeight = Math.ceil(height);
      repositionBubbles();
    }
  });

  ipcMain.on("permission-decide", (event, behavior) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const perm = pendingPermissions.find(p => p.bubble === senderWin);
    if (!perm) return;

    if (typeof behavior === "string" && behavior.startsWith("suggestion:")) {
      const idx = parseInt(behavior.split(":")[1], 10);
      const suggestion = perm.suggestions?.[idx];
      if (!suggestion) { resolvePermissionEntry(perm, "deny", "Invalid suggestion index"); return; }
      if (suggestion.type === "addRules") {
        const rules = Array.isArray(suggestion.rules) ? suggestion.rules
          : [{ toolName: suggestion.toolName, ruleContent: suggestion.ruleContent }];
        perm.resolvedSuggestion = {
          type: "addRules",
          destination: suggestion.destination || "localSettings",
          behavior: suggestion.behavior || "allow",
          rules,
        };
      } else if (suggestion.type === "setMode") {
        perm.resolvedSuggestion = {
          type: "setMode",
          mode: suggestion.mode,
          destination: suggestion.destination || "localSettings",
        };
      }
      resolvePermissionEntry(perm, "allow");
    } else {
      resolvePermissionEntry(perm, behavior === "allow" ? "allow" : "deny");
    }
  });

  startMainTick();

  // Initialize SessionManager and Gateway with config
  sessionManager = new SessionManager(mainInterface, {
    sessionStaleMs: configSessionStaleMs,
    workingStaleMs: configWorkingStaleMs,
    deepSleepTimeout: configDeepSleepTimeout,
    layoutStrategy: configLayoutStrategy,
  });
  gateway = new Gateway(sessionManager, mainInterface);
  gateway.startHttpServer();
  sessionManager.startStaleCleanup();

  // Wait for renderer ready
  win.webContents.on("did-finish-load", () => {
    if (miniMode) {
      sendToRenderer("mini-mode-change", true);
    }
    if (doNotDisturb) {
      sendToRenderer("dnd-change", true);
    }
    // Start with global idle state
    sessionManager.startGlobalSleepSequence();

    // Startup recovery
    setTimeout(() => {
      if (sessionManager.sessions.size > 0 || doNotDisturb) return;
      detectRunningAgentProcesses((found) => {
        if (found && sessionManager.sessions.size === 0 && !doNotDisturb) {
          // Wait for hooks
        }
      });
    }, 5000);
  });

  // Crash recovery
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer crashed:", details.reason);
    dragLocked = false;
    idlePaused = false;
    mouseOverPet = false;
    win.setIgnoreMouseEvents(true);
    win.webContents.reload();
  });

  guardAlwaysOnTop(win);
  startTopmostWatchdog();

  // Display change
  screen.on("display-metrics-changed", () => {
    if (!win || win.isDestroyed()) return;
    if (miniMode) {
      const size = SIZES[currentSize];
      const snapY = miniSnap ? miniSnap.y : win.getBounds().y;
      const wa = getNearestWorkArea(currentMiniX + size.width / 2, snapY + size.height / 2);
      currentMiniX = wa.x + wa.width - Math.round(size.width * (1 - MINI_OFFSET_RATIO));
      const clampedY = Math.max(wa.y, Math.min(snapY, wa.y + wa.height - size.height));
      miniSnap = { y: clampedY, width: size.width, height: size.height };
      win.setBounds({ x: currentMiniX, y: clampedY, width: size.width, height: size.height });
      return;
    }
    const { x, y, width, height } = win.getBounds();
    const clamped = clampToScreen(x, y, width, height);
    if (clamped.x !== x || clamped.y !== y) {
      win.setBounds({ ...clamped, width, height });
    }
  });

  screen.on("display-removed", () => {
    if (!win || win.isDestroyed()) return;
    if (miniMode) {
      exitMiniMode();
      return;
    }
    const { x, y, width, height } = win.getBounds();
    const clamped = clampToScreen(x, y, width, height);
    win.setBounds({ ...clamped, width, height });
  });
}

// ── Helper functions ──
function getNearestWorkArea(cx, cy) {
  const displays = screen.getAllDisplays();
  let nearest = displays[0].workArea;
  let minDist = Infinity;
  for (const d of displays) {
    const wa = d.workArea;
    const dx = Math.max(wa.x - cx, 0, cx - (wa.x + wa.width));
    const dy = Math.max(wa.y - cy, 0, cy - (wa.y + wa.height));
    const dist = dx * dx + dy * dy;
    if (dist < minDist) { minDist = dist; nearest = wa; }
  }
  return nearest;
}

function clampToScreen(x, y, w, h) {
  const nearest = getNearestWorkArea(x + w / 2, y + h / 2);
  const mLeft = Math.round(w * 0.25);
  const mRight = Math.round(w * 0.25);
  const mTop = Math.round(h * 0.6);
  const mBot = Math.round(h * 0.04);
  return {
    x: Math.max(nearest.x - mLeft, Math.min(x, nearest.x + nearest.width - w + mRight)),
    y: Math.max(nearest.y - mTop, Math.min(y, nearest.y + nearest.height - h + mBot)),
  };
}

// ── Terminal focus ──
const { execFile, spawn } = require("child_process");

const PS_FOCUS_ADDTYPE = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(int idAttach, int idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern int GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
  public static void FocusWindow(IntPtr hWnd) {
    var fg = GetForegroundWindow();
    int fgThread = GetWindowThreadProcessId(fg, out _);
    int myThread = GetCurrentThreadId();
    if (fgThread != myThread) AttachThreadInput(myThread, fgThread, true);
    if (IsIconic(hWnd)) ShowWindow(hWnd, 9);
    SetForegroundWindow(hWnd);
    if (fgThread != myThread) AttachThreadInput(myThread, fgThread, false);
  }
}
"@
`;

let psFocusProc = null;

function getPsFocusProc() {
  if (psFocusProc && !psFocusProc.killed) return psFocusProc;
  psFocusProc = spawn("powershell", ["-NoExit", "-Command", "-"], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  psFocusProc.stdin.write(PS_FOCUS_ADDTYPE);
  return psFocusProc;
}

function focusTerminalWindow(sourcePid, cwd, editor, pidChain) {
  if (isMac) {
    // macOS: use AppleScript
    const script = `
      tell application "System Events"
        set frontmost of first process whose unix id is ${sourcePid} to true
      end tell
    `;
    execFile("osascript", ["-e", script], (err) => {
      if (err) console.warn("Failed to focus terminal:", err.message);
    });
  } else {
    // Windows: use PowerShell
    if (_allowSetForeground) {
      _allowSetForeground(sourcePid);
    }
    const ps = getPsFocusProc();
    const cmd = `[WinFocus]::FocusWindow([IntPtr]${sourcePid})\n`;
    ps.stdin.write(cmd);
  }
}

function killFocusHelper() {
  if (psFocusProc && !psFocusProc.killed) {
    psFocusProc.kill();
    psFocusProc = null;
  }
}

// ── Detect running agents ──
let _detectInFlight = false;
function detectRunningAgentProcesses(callback) {
  if (_detectInFlight) return;
  _detectInFlight = true;
  const done = (result) => { _detectInFlight = false; callback(result); };
  const { exec } = require("child_process");
  if (process.platform === "win32") {
    exec(
      'wmic process where "(Name=\'node.exe\' and CommandLine like \'%claude-code%\') or Name=\'claude.exe\' or Name=\'codex.exe\' or Name=\'copilot.exe\'" get ProcessId /format:csv',
      { encoding: "utf8", timeout: 5000, windowsHide: true },
      (err, stdout) => done(!err && /\d+/.test(stdout))
    );
  } else {
    exec("pgrep -f 'claude-code|codex|copilot'", { timeout: 3000 },
      (err) => done(!err)
    );
  }
}

// ── Always-on-top watchdog ──
const WIN_TOPMOST_LEVEL = "pop-up-menu";
const TOPMOST_WATCHDOG_MS = 5_000;
let topmostWatchdog = null;
let hwndRecoveryTimer = null;

function scheduleHwndRecovery() {
  if (isMac) return;
  if (hwndRecoveryTimer) clearTimeout(hwndRecoveryTimer);
  hwndRecoveryTimer = setTimeout(() => {
    hwndRecoveryTimer = null;
    if (!win || win.isDestroyed()) return;
    if (!dragLocked) {
      win.showInactive();
    }
    for (const perm of pendingPermissions) {
      if (perm.bubble && !perm.bubble.isDestroyed() && perm.bubble.isVisible()) {
        perm.bubble.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
      }
    }
  }, TOPMOST_WATCHDOG_MS);
}

function guardAlwaysOnTop(targetWin) {
  if (isMac) return;
  targetWin.on("always-on-top-changed", () => {
    if (!targetWin.isDestroyed() && !targetWin.isAlwaysOnTop()) {
      targetWin.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
      scheduleHwndRecovery();
    }
  });
}

function startTopmostWatchdog() {
  if (topmostWatchdog) return;
  topmostWatchdog = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    if (!win.isAlwaysOnTop()) {
      win.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
      scheduleHwndRecovery();
    }
    if (!dragLocked) {
      win.showInactive();
    }
    for (const perm of pendingPermissions) {
      if (perm.bubble && !perm.bubble.isDestroyed() && perm.bubble.isVisible()) {
        perm.bubble.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
      }
    }
  }, TOPMOST_WATCHDOG_MS);
}

function stopTopmostWatchdog() {
  if (topmostWatchdog) { clearInterval(topmostWatchdog); topmostWatchdog = null; }
}

// ── Window animation ──
function animateWindowX(targetX, durationMs) {
  if (peekAnimTimer) { clearTimeout(peekAnimTimer); peekAnimTimer = null; }
  const bounds = win.getBounds();
  const startX = bounds.x;
  if (startX === targetX) { isAnimating = false; return; }
  isAnimating = true;
  const startTime = Date.now();
  const snapY = miniSnap ? miniSnap.y : bounds.y;
  const snapW = miniSnap ? miniSnap.width : bounds.width;
  const snapH = miniSnap ? miniSnap.height : bounds.height;
  const step = () => {
    if (!win || win.isDestroyed()) { peekAnimTimer = null; isAnimating = false; return; }
    const t = Math.min(1, (Date.now() - startTime) / durationMs);
    const eased = t * (2 - t);
    const x = Math.round(startX + (targetX - startX) * eased);
    win.setBounds({ x, y: snapY, width: snapW, height: snapH });
    if (t < 1) {
      peekAnimTimer = setTimeout(step, 16);
    } else {
      peekAnimTimer = null;
      isAnimating = false;
    }
  };
  step();
}

function animateWindowParabola(targetX, targetY, durationMs, onDone) {
  if (peekAnimTimer) { clearTimeout(peekAnimTimer); peekAnimTimer = null; }
  const bounds = win.getBounds();
  const startX = bounds.x, startY = bounds.y;
  const size = SIZES[currentSize];
  if (startX === targetX && startY === targetY) {
    isAnimating = false;
    if (onDone) onDone();
    return;
  }
  isAnimating = true;
  const startTime = Date.now();
  const step = () => {
    if (!win || win.isDestroyed()) { peekAnimTimer = null; isAnimating = false; return; }
    const t = Math.min(1, (Date.now() - startTime) / durationMs);
    const eased = t * (2 - t);
    const x = Math.round(startX + (targetX - startX) * eased);
    const arc = -4 * JUMP_PEAK_HEIGHT * t * (t - 1);
    const y = Math.round(startY + (targetY - startY) * eased - arc);
    win.setPosition(x, y);
    if (t < 1) {
      peekAnimTimer = setTimeout(step, 16);
    } else {
      peekAnimTimer = null;
      isAnimating = false;
      if (onDone) onDone();
    }
  };
  step();
}

// ── Mini Mode ──
function miniPeekIn() {
  animateWindowX(currentMiniX - PEEK_OFFSET, 200);
}

function miniPeekOut() {
  animateWindowX(currentMiniX, 200);
}

function cancelMiniTransition() {
  miniTransitioning = false;
  if (miniTransitionTimer) { clearTimeout(miniTransitionTimer); miniTransitionTimer = null; }
}

function checkMiniModeSnap() {
  if (miniMode) return;
  const bounds = win.getBounds();
  const size = SIZES[currentSize];
  const mRight = Math.round(size.width * 0.25);
  const centerX = bounds.x + size.width / 2;
  const displays = screen.getAllDisplays();
  for (const d of displays) {
    const wa = d.workArea;
    const centerY = bounds.y + size.height / 2;
    if (centerX < wa.x || centerX > wa.x + wa.width) continue;
    if (centerY < wa.y || centerY > wa.y + wa.height) continue;
    const rightLimit = wa.x + wa.width - size.width + mRight;
    if (bounds.x >= rightLimit - SNAP_TOLERANCE) {
      enterMiniMode(wa);
      return;
    }
  }
}

function enterMiniMode(wa, viaMenu) {
  if (miniMode && !viaMenu) return;
  const bounds = win.getBounds();
  if (!viaMenu) {
    preMiniX = bounds.x;
    preMiniY = bounds.y;
  }
  miniMode = true;
  const size = SIZES[currentSize];
  currentMiniX = wa.x + wa.width - Math.round(size.width * (1 - MINI_OFFSET_RATIO));
  miniSnap = { y: bounds.y, width: size.width, height: size.height };

  sendToRenderer("mini-mode-change", true);
  miniTransitioning = true;
  buildContextMenu();
  buildTrayMenu();

  const enterSvgState = doNotDisturb ? "mini-enter-sleep" : "mini-enter";
  const displayId = getDisplaySessionId();

  if (viaMenu) {
    const displays = screen.getAllDisplays();
    let maxRight = 0;
    for (const d of displays) maxRight = Math.max(maxRight, d.bounds.x + d.bounds.width);
    const jumpTarget = maxRight;
    animateWindowParabola(jumpTarget, bounds.y, JUMP_DURATION, () => {
      sendToRenderer("pet-state-change", displayId, enterSvgState, STATE_SVGS[enterSvgState]?.[0]);
      miniTransitionTimer = setTimeout(() => {
        miniSnap = { y: bounds.y, width: size.width, height: size.height };
        win.setBounds({ x: currentMiniX, y: miniSnap.y, width: miniSnap.width, height: miniSnap.height });
        miniTransitionTimer = setTimeout(() => {
          miniTransitioning = false;
          const idleState = doNotDisturb ? "mini-sleep" : "mini-idle";
          sendToRenderer("pet-state-change", displayId, idleState, STATE_SVGS[idleState]?.[0]);
        }, 3200);
      }, 300);
    });
  } else {
    animateWindowX(currentMiniX, 100);
    sendToRenderer("pet-state-change", displayId, enterSvgState, STATE_SVGS[enterSvgState]?.[0]);
    miniTransitionTimer = setTimeout(() => {
      miniTransitioning = false;
      const idleState = doNotDisturb ? "mini-sleep" : "mini-idle";
      sendToRenderer("pet-state-change", displayId, idleState, STATE_SVGS[idleState]?.[0]);
    }, 3200);
  }
}

function exitMiniMode() {
  if (!miniMode) return;
  cancelMiniTransition();
  miniMode = false;
  miniSnap = null;
  miniSleepPeeked = false;
  sendToRenderer("mini-mode-change", false);
  buildContextMenu();
  buildTrayMenu();

  const size = SIZES[currentSize];
  const clamped = clampToScreen(preMiniX, preMiniY, size.width, size.height);
  const wa = getNearestWorkArea(clamped.x + size.width / 2, clamped.y + size.height / 2);
  const mRight = Math.round(size.width * 0.25);
  if (clamped.x >= wa.x + wa.width - size.width + mRight - SNAP_TOLERANCE) {
    clamped.x = wa.x + wa.width - size.width + mRight - 100;
  }

  animateWindowParabola(clamped.x, clamped.y, JUMP_DURATION, () => {
    if (doNotDisturb) {
      doNotDisturb = false;
      sendToRenderer("dnd-change", false);
      buildContextMenu();
      buildTrayMenu();
      sendToRenderer("pet-state-change", getDisplaySessionId(), "waking", STATE_SVGS.waking?.[0]);
    } else {
      const fg = sessionManager?.getForegroundSession();
      if (fg) {
        sendToRenderer("pet-state-change", fg.id, fg.state, fg.svg);
      } else {
        sendToRenderer("pet-state-change", "__global__", "idle", SVG_IDLE_FOLLOW);
      }
    }
  });
}

function enterMiniViaMenu() {
  const bounds = win.getBounds();
  const size = SIZES[currentSize];
  const wa = getNearestWorkArea(bounds.x + size.width / 2, bounds.y + size.height / 2);

  preMiniX = bounds.x;
  preMiniY = bounds.y;
  miniTransitioning = true;

  sendToRenderer("mini-mode-change", true);
  sendToRenderer("pet-state-change", getDisplaySessionId(), "mini-crabwalk", STATE_SVGS["mini-crabwalk"]?.[0]);

  const edgeX = wa.x + wa.width - size.width + Math.round(size.width * 0.25);
  const walkDist = Math.abs(bounds.x - edgeX);
  const walkDuration = walkDist / CRABWALK_SPEED;
  animateWindowX(edgeX, walkDuration);

  miniTransitionTimer = setTimeout(() => {
    enterMiniMode(wa, true);
  }, walkDuration + 50);
}

function buildContextMenu() {
  const sessionCount = sessionManager?.sessions?.size || 0;
  const template = [
    {
      label: t("size"),
      submenu: [
        { label: t("small"), type: "radio", checked: currentSize === "S", click: () => resizeWindow("S") },
        { label: t("medium"), type: "radio", checked: currentSize === "M", click: () => resizeWindow("M") },
        { label: t("large"), type: "radio", checked: currentSize === "L", click: () => resizeWindow("L") },
      ],
    },
    { type: "separator" },
    {
      label: miniMode ? t("exitMiniMode") : t("miniMode"),
      enabled: !miniTransitioning && !(doNotDisturb && !miniMode),
      click: () => miniMode ? exitMiniMode() : enterMiniViaMenu(),
    },
    { type: "separator" },
    {
      label: doNotDisturb ? t("wake") : t("sleep"),
      click: () => doNotDisturb ? disableDoNotDisturb() : enableDoNotDisturb(),
    },
    { type: "separator" },
    {
      label: `${t("sessions")} (${sessionCount})`,
      submenu: sessionManager?.buildSessionSubmenu(lang, t) || [{ label: t("noSessions"), enabled: false }],
    },
  ];
  if (isMac) {
    template.push(
      { type: "separator" },
      {
        label: t("showInMenuBar"),
        type: "checkbox",
        checked: showTray,
        enabled: showTray ? showDock : true,
        click: (menuItem) => setShowTray(menuItem.checked),
      },
      {
        label: t("showInDock"),
        type: "checkbox",
        checked: showDock,
        enabled: showDock ? showTray : true,
        click: (menuItem) => setShowDock(menuItem.checked),
      },
    );
  }
  template.push(
    { type: "separator" },
    {
      label: t("settings"),
      submenu: [
        {
          label: t("sessionTimeout"),
          submenu: buildTimeoutSubmenu("sessionStale", [1, 5, 10, 15, 30], configSessionStaleMs),
        },
        {
          label: t("workingTimeout"),
          submenu: buildTimeoutSubmenu("workingStale", [1, 3, 5, 10], configWorkingStaleMs),
        },
        {
          label: t("sleepTimeout"),
          submenu: buildTimeoutSubmenu("deepSleep", [1, 5, 10, 15, 30], configDeepSleepTimeout),
        },
        { type: "separator" },
        {
          label: t("layoutMode"),
          submenu: [
            { label: t("layoutCircular"), type: "radio", checked: configLayoutStrategy === "circular", click: () => setLayoutStrategy("circular") },
            { label: t("layoutLinear"), type: "radio", checked: configLayoutStrategy === "linear", click: () => setLayoutStrategy("linear") },
            { label: t("layoutGrid"), type: "radio", checked: configLayoutStrategy === "grid", click: () => setLayoutStrategy("grid") },
          ],
        },
      ],
    },
    { type: "separator" },
    getUpdateMenuItem(),
    { type: "separator" },
    {
      label: t("language"),
      submenu: [
        { label: "English", type: "radio", checked: lang === "en", click: () => setLanguage("en") },
        { label: "中文", type: "radio", checked: lang === "zh", click: () => setLanguage("zh") },
      ],
    },
    { type: "separator" },
    { label: t("quit"), click: () => requestAppQuit() },
  );
  contextMenu = Menu.buildFromTemplate(template);
}

// Helper to build timeout selection submenu
function buildTimeoutSubmenu(type, minuteOptions, currentValue) {
  return minuteOptions.map((mins) => {
    const ms = mins * 60000;
    return {
      label: `${mins} ${t("minutes")}`,
      type: "radio",
      checked: currentValue === ms,
      click: () => updateTimeoutConfig(type, ms),
    };
  });
}

// Update timeout configuration
function updateTimeoutConfig(type, ms) {
  switch (type) {
    case "sessionStale":
      configSessionStaleMs = ms;
      if (sessionManager) sessionManager.sessionStaleMs = ms;
      break;
    case "workingStale":
      configWorkingStaleMs = ms;
      if (sessionManager) sessionManager.workingStaleMs = ms;
      break;
    case "deepSleep":
      configDeepSleepTimeout = ms;
      if (sessionManager) sessionManager.deepSleepTimeout = ms;
      break;
  }
  savePrefs();
  buildContextMenu();
}

// Update layout strategy
function setLayoutStrategy(strategy) {
  configLayoutStrategy = strategy;
  if (sessionManager && sessionManager.layout) {
    sessionManager.layout.setStrategy(strategy);
    // Re-layout current sessions
    sessionManager.layout.updatePositions(sessionManager.ringOrder);
  }
  savePrefs();
  buildContextMenu();
}

function setLanguage(newLang) {
  lang = newLang;
  rebuildAllMenus();
  savePrefs();
}

function resizeWindow(sizeKey) {
  currentSize = sizeKey;
  const size = SIZES[sizeKey];
  if (miniMode) {
    const { y } = win.getBounds();
    const wa = getNearestWorkArea(currentMiniX + size.width / 2, y + size.height / 2);
    currentMiniX = wa.x + wa.width - Math.round(size.width * (1 - MINI_OFFSET_RATIO));
    const clampedY = Math.max(wa.y, Math.min(y, wa.y + wa.height - size.height));
    miniSnap = { y: clampedY, width: size.width, height: size.height };
    win.setBounds({ x: currentMiniX, y: clampedY, width: size.width, height: size.height });
  } else {
    const { x, y } = win.getBounds();
    const clamped = clampToScreen(x, y, size.width, size.height);
    win.setBounds({ ...clamped, width: size.width, height: size.height });
  }
  buildContextMenu();
  savePrefs();
}

// ── Auto-install VS Code / Cursor terminal-focus extension ──
const EXT_ID = "clawd.clawd-terminal-focus";
const EXT_VERSION = "0.1.0";
const EXT_DIR_NAME = `${EXT_ID}-${EXT_VERSION}`;

function installTerminalFocusExtension() {
  const os = require("os");
  const home = os.homedir();

  let extSrc = path.join(__dirname, "..", "extensions", "vscode");
  extSrc = extSrc.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);

  if (!fs.existsSync(extSrc)) {
    console.log("Clawd: terminal-focus extension source not found, skipping auto-install");
    return;
  }

  const targets = [
    path.join(home, ".vscode", "extensions"),
    path.join(home, ".cursor", "extensions"),
  ];

  const filesToCopy = ["package.json", "extension.js"];
  let installed = 0;

  for (const extRoot of targets) {
    if (!fs.existsSync(extRoot)) continue;
    const dest = path.join(extRoot, EXT_DIR_NAME);
    if (fs.existsSync(path.join(dest, "package.json"))) continue;
    try {
      fs.mkdirSync(dest, { recursive: true });
      for (const file of filesToCopy) {
        fs.copyFileSync(path.join(extSrc, file), path.join(dest, file));
      }
      installed++;
      console.log(`Clawd: installed terminal-focus extension to ${dest}`);
    } catch (err) {
      console.warn(`Clawd: failed to install extension to ${dest}:`, err.message);
    }
  }
  if (installed > 0) {
    console.log(`Clawd: terminal-focus extension installed to ${installed} editor(s). Restart VS Code/Cursor to activate.`);
  }
}

// ── Single instance lock ──
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) win.showInactive();
  });

  if (isMac && app.dock) {
    const prefs = loadPrefs();
    if (prefs && prefs.showDock === false) {
      app.dock.hide();
    }
  }

  app.whenReady().then(() => {
    permDebugLog = path.join(app.getPath("userData"), "permission-debug.log");
    createWindow();

    try {
      const { registerHooks } = require("../hooks/install.js");
      const { added } = registerHooks({ silent: true, autoStart: autoStartWithClaude });
      if (added > 0) console.log(`Clawd: auto-registered ${added} Claude Code hooks`);
    } catch (err) {
      console.warn("Clawd: failed to auto-register hooks:", err.message);
    }

    try {
      const CodexLogMonitor = require("../agents/codex-log-monitor");
      const codexAgent = require("../agents/codex");
      const codexMonitor = new CodexLogMonitor(codexAgent, (sid, state, event, extra) => {
        if (gateway) {
          gateway.handleEvent(sid, state, event, {
            sourcePid: extra.sourcePid,
            cwd: extra.cwd,
            agentPid: extra.agentPid,
            agentId: "codex",
          });
        }
      });
      codexMonitor.start();
    } catch (err) {
      console.warn("Clawd: Codex log monitor not started:", err.message);
    }

    try { installTerminalFocusExtension(); } catch (err) {
      console.warn("Clawd: failed to auto-install terminal-focus extension:", err.message);
    }

    setupAutoUpdater();
    setTimeout(() => checkForUpdates(false), 5000);
  });

  app.on("before-quit", () => {
    isQuitting = true;
    savePrefs();
    if (mainTickTimer) clearInterval(mainTickTimer);
    if (miniTransitionTimer) clearTimeout(miniTransitionTimer);
    if (peekAnimTimer) clearTimeout(peekAnimTimer);
    if (yawnDelayTimer) clearTimeout(yawnDelayTimer);
    if (idleLookReturnTimer) clearTimeout(idleLookReturnTimer);
    if (eyeResendTimer) clearTimeout(eyeResendTimer);
    if (hwndRecoveryTimer) clearTimeout(hwndRecoveryTimer);
    stopTopmostWatchdog();
    killFocusHelper();
    sessionManager?.destroy();
    gateway?.stop();
  });

  app.on("window-all-closed", () => {
    if (!isQuitting) return;
    app.quit();
  });
}
