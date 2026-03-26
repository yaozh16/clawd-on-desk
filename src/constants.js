// Shared constants for Clawd
// Used by main.js, session.js, gateway.js

// ── SVG filename constants ──
const SVG_IDLE_FOLLOW = "clawd-idle-follow.svg";
const SVG_IDLE_LOOK = "clawd-idle-look.svg";
const SVG_IDLE_LIVING = "clawd-idle-living.svg";

// ── State → SVG mapping ──
const STATE_SVGS = {
  idle: [SVG_IDLE_FOLLOW, SVG_IDLE_LIVING],
  yawning: ["clawd-idle-yawn.svg"],
  dozing: ["clawd-idle-doze.svg"],
  collapsing: ["clawd-collapse-sleep.svg"],
  thinking: ["clawd-working-thinking.svg"],
  working: ["clawd-working-typing.svg"],
  juggling: ["clawd-working-juggling.svg"],
  sweeping: ["clawd-working-sweeping.svg"],
  error: ["clawd-error.svg"],
  attention: ["clawd-happy.svg"],
  notification: ["clawd-notification.svg"],
  carrying: ["clawd-working-carrying.svg"],
  sleeping: ["clawd-sleeping.svg"],
  waking: ["clawd-wake.svg"],
};

// Mini mode SVG mappings
STATE_SVGS["mini-idle"] = ["clawd-mini-idle.svg"];
STATE_SVGS["mini-alert"] = ["clawd-mini-alert.svg"];
STATE_SVGS["mini-happy"] = ["clawd-mini-happy.svg"];
STATE_SVGS["mini-enter"] = ["clawd-mini-enter.svg"];
STATE_SVGS["mini-peek"] = ["clawd-mini-peek.svg"];
STATE_SVGS["mini-crabwalk"] = ["clawd-mini-crabwalk.svg"];
STATE_SVGS["mini-enter-sleep"] = ["clawd-mini-enter-sleep.svg"];
STATE_SVGS["mini-sleep"] = ["clawd-mini-sleep.svg"];

// ── Minimum display time for states ──
const MIN_DISPLAY_MS = {
  attention: 4000,
  error: 5000,
  sweeping: 2000,
  notification: 4000,
  carrying: 3000,
  working: 1000,
  thinking: 1000,
  "mini-alert": 4000,
  "mini-happy": 4000,
};

// ── Oneshot states that auto-return to idle ──
const AUTO_RETURN_MS = {
  attention: 4000,
  error: 5000,
  sweeping: 300000, // 5min safety
  notification: 4000,
  carrying: 3000,
  "mini-alert": 4000,
  "mini-happy": 4000,
};

const ONESHOT_STATES = new Set(["attention", "error", "sweeping", "notification", "carrying"]);

// ── State priority for resolution ──
const STATE_PRIORITY = {
  error: 8,
  notification: 7,
  sweeping: 6,
  attention: 5,
  carrying: 4,
  juggling: 4,
  working: 3,
  thinking: 2,
  idle: 1,
  sleeping: 0,
};

// ── Sleep sequence states ──
const SLEEP_SEQUENCE = new Set(["yawning", "dozing", "collapsing", "sleeping", "waking"]);

// ── Sleep sequence timings ──
const MOUSE_IDLE_TIMEOUT = 20000;   // 20s → idle-look
const MOUSE_SLEEP_TIMEOUT_DEFAULT = 60000;  // 60s → yawning → dozing
const DEEP_SLEEP_TIMEOUT_DEFAULT = 600000;  // 10min → collapsing → sleeping
const YAWN_DURATION = 3000;
const COLLAPSE_DURATION = 800;
const WAKE_DURATION = 1500;
const IDLE_LOOK_DURATION = 10000;

// ── Session staleness thresholds (defaults, can be customized) ──
const SESSION_STALE_MS_DEFAULT = 600000;  // 10 min
const WORKING_STALE_MS_DEFAULT = 300000;  // 5 min

// Expose configurable constants for prefs
const CONFIGURABLE_DEFAULTS = {
  sessionStaleMs: SESSION_STALE_MS_DEFAULT,
  workingStaleMs: WORKING_STALE_MS_DEFAULT,
  mouseSleepTimeout: MOUSE_SLEEP_TIMEOUT_DEFAULT,
  deepSleepTimeout: DEEP_SLEEP_TIMEOUT_DEFAULT,
};

// ── Ring layout config ──
const RING_CONFIG = {
  maxPets: 5,
  radius: 100,  // Base radius for positioning (increased for better spacing)
  animationDuration: 300,
};

module.exports = {
  SVG_IDLE_FOLLOW,
  SVG_IDLE_LOOK,
  SVG_IDLE_LIVING,
  STATE_SVGS,
  MIN_DISPLAY_MS,
  AUTO_RETURN_MS,
  ONESHOT_STATES,
  STATE_PRIORITY,
  SLEEP_SEQUENCE,
  MOUSE_IDLE_TIMEOUT,
  MOUSE_SLEEP_TIMEOUT_DEFAULT,
  DEEP_SLEEP_TIMEOUT_DEFAULT,
  YAWN_DURATION,
  COLLAPSE_DURATION,
  WAKE_DURATION,
  IDLE_LOOK_DURATION,
  SESSION_STALE_MS_DEFAULT,
  WORKING_STALE_MS_DEFAULT,
  CONFIGURABLE_DEFAULTS,
  RING_CONFIG,
};
