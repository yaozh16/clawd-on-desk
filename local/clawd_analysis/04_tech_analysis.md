## 四、技术深度分析

### 4.1 Electron 透明窗口最佳实践

透明窗口是桌面宠物的基础，本项目采用了多项技术保证体验：

```javascript
// main.js - 窗口配置
const win = new BrowserWindow({
  width: 200,
  height: 200,
  frame: false,           // 无边框
  transparent: true,      // 透明背景
  alwaysOnTop: true,      // 始终置顶
  focusable: false,       // 不可聚焦（不抢焦点）
  skipTaskbar: true,      // 不显示在任务栏
  hasShadow: false,       // 无阴影
  resizable: false,

  // Windows 特定
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, "preload.js")
  }
});

// 关键：精确的点击穿透（透明区域穿透，角色区域响应）
function startMainTick() {
  setInterval(() => {
    const cursor = screen.getCursorScreenPoint();
    const hit = getHitRectScreen(bounds);

    // SVG 碰撞检测
    const over = cursor.x >= hit.left && cursor.x <= hit.right
              && cursor.y >= hit.top  && cursor.y <= hit.bottom;

    // 动态切换穿透模式
    win.setIgnoreMouseEvents(!over);
  }, 50);  // 20fps
}
```

**SVG 碰撞检测**：

```javascript
// SVG viewBox="-15 -25 45 45" 坐标系转换到屏幕坐标
function getHitRectScreen(bounds) {
  const obj = getObjRect(bounds);

  // viewBox → 屏幕缩放
  const scale = Math.min(obj.w, obj.h) / 45;
  const offsetX = obj.x + (obj.w - 45 * scale) / 2;
  const offsetY = obj.y + (obj.h - 45 * scale) / 2;

  // 命中框（站姿/睡姿/特效三种）
  const hb = currentHitBox;  // { x, y, w, h }
  return {
    left:   offsetX + (hb.x + 15) * scale,
    top:    offsetY + (hb.y + 25) * scale,
    right:  offsetX + (hb.x + 15 + hb.w) * scale,
    bottom: offsetY + (hb.y + 25 + hb.h) * scale,
  };
}
```

### 4.2 Hook 系统设计

Hook 是与 AI Agent 通信的核心机制：

#### 4.2.1 Command Hook（非阻塞）

```javascript
// hooks/clawd-hook.js
// 设计目标：零依赖、快冷启动、<1s 超时

const event = process.argv[2];  // 事件名称
const state = EVENT_TO_STATE[event];

// 1. 进程树遍历（同步，约 100ms/层）
const stablePid = getStablePid();  // 向上遍历找到终端

// 2. 读取 stdin（Claude Code 管道 JSON）
process.stdin.on("end", () => {
  const payload = JSON.parse(chunks.join());
  const sessionId = payload.session_id;

  // 3. HTTP POST（超时 500ms）
  http.request({
    hostname: "127.0.0.1",
    port: 23333,
    path: "/state",
    method: "POST",
    timeout: 500
  }).end(JSON.stringify({
    state,
    session_id: sessionId,
    source_pid: stablePid,
    cwd: payload.cwd,
    editor: detectedEditor,
    agent_pid: claudePid
  }));
});

// 安全：stdin 超时兜底
setTimeout(() => send("default", ""), 400);
```

#### 4.2.2 HTTP Hook（阻塞式）

```javascript
// 权限审批使用 HTTP hook（支持请求-响应）
// hooks/install.js
const HTTP_HOOKS = {
  PermissionRequest: {
    matcher: "",
    hook: {
      type: "http",
      url: "http://127.0.0.1:23333/permission",
      timeout: 600  // 10 分钟超时
    }
  }
};

// main.js - 处理阻塞请求
server.on("request", (req, res) => {
  if (url === "/permission") {
    // 不立即响应，创建气泡等待用户决策
    const perm = {
      res,  // 保存 response 对象
      bubble: createBubbleWindow()
    };
    pendingPermissions.push(perm);
  }
});

// 用户决策后响应
function resolvePermission(perm, decision) {
  perm.res.end(JSON.stringify({
    decision: decision,  // "allow" / "deny" / { behaveAsIf: "suggestion:N" }
    reason: "User approved"
  }));
  perm.bubble.close();
}
```

### 4.3 进程存活检测与会话管理

```javascript
// 会话数据结构
const sessions = new Map();  // session_id → SessionData
// SessionData: {
//   state: "working",
//   updatedAt: timestamp,
//   sourcePid: 12345,     // 终端 PID
//   cwd: "/path/to/project",
//   editor: "cursor",     // 检测到的编辑器
//   pidChain: [...],      // 进程链（用于 VS Code tab 跳转）
//   agentPid: 67890,      // Agent 进程 PID
//   agentId: "claude-code",
//   pidReachable: true    // WSL2/远程会话 PID 可能不可达
// }

// 过期策略
const SESSION_STALE_MS = 600000;   // 10 分钟无活动 → 删除会话
const WORKING_STALE_MS = 300000;   // 5 分钟无新事件 → 工作状态衰减为 idle

function cleanStaleSessions() {
  for (const [id, s] of sessions) {
    const age = Date.now() - s.updatedAt;

    // 1. Agent 进程死亡 → 立即删除孤儿会话
    if (s.pidReachable && s.agentPid && !isProcessAlive(s.agentPid)) {
      sessions.delete(id);
      continue;
    }

    // 2. 超过 10 分钟 → 检查终端是否存活
    if (age > SESSION_STALE_MS) {
      if (s.pidReachable && s.sourcePid && !isProcessAlive(s.sourcePid)) {
        sessions.delete(id);
      }
    }

    // 3. 超过 5 分钟且还在工作状态 → 衰减为 idle
    if (age > WORKING_STALE_MS && ['working', 'thinking', 'juggling'].includes(s.state)) {
      s.state = 'idle';
    }
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);  // 发送信号 0（不实际杀死进程）
    return true;
  } catch (e) {
    return e.code === 'EPERM';  // EPERM = 进程存在但无权限
  }
}
```

### 4.4 启动恢复机制

当 Clawd 在 Agent 运行中重启时，需要检测是否应该保持活跃：

```javascript
let startupRecoveryActive = false;

// 启动时检测 Agent 进程
function detectRunningAgentProcesses(callback) {
  const isWin = process.platform === "win32";

  if (isWin) {
    // Windows: wmic 查询
    exec(
      'wmic process where "(Name=\'node.exe\' and CommandLine like \'%claude-code%\') ' +
      'or Name=\'claude.exe\' or Name=\'codex.exe\' or Name=\'copilot.exe\'" ' +
      'get ProcessId /format:csv',
      (err, stdout) => callback(!err && /\d+/.test(stdout))
    );
  } else {
    // macOS/Linux: pgrep
    exec("pgrep -f 'claude-code|codex|copilot'", (err) => callback(!err));
  }
}

// 如果 Agent 正在运行，保持活跃状态
detectRunningAgentProcesses((found) => {
  if (found) {
    startupRecoveryActive = true;
    // 5 分钟后无论如何取消恢复状态
    setTimeout(() => { startupRecoveryActive = false; }, 300000);
  }
});
```

### 4.5 自动更新机制

```javascript
const { autoUpdater } = require("electron-updater");

// 启动时静默检查
autoUpdater.setFeedURL({
  provider: "github",
  owner: "rullerzhou-afk",
  repo: "clawd-on-desk"
});

autoUpdater.on("update-downloaded", (info) => {
  // 提示用户重启安装
  dialog.showMessageBox({
    type: "info",
    message: `v${info.version} ready. Restart to update?`
  }).then(({ response }) => {
    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

// macOS 特殊处理（无 Apple 签名）
if (isMac) {
  autoUpdater.on("update-available", (info) => {
    // 打开 GitHub Releases 页面手动下载
    shell.openExternal(`https://github.com/.../releases/tag/v${info.version}`);
  });
}
```

### 4.6 性能优化策略

| 优化点 | 策略 | 效果 |
|--------|------|------|
| Hook 脚本 | 零依赖、预计算 PID | 冷启动 <500ms |
| PowerShell | 预热进程 + 预编译类型 | 终端跳转 <100ms |
| SVG 切换 | 预加载 + 渐变切换 | 无白屏闪烁 |
| 眼球追踪 | 50ms 轮询 + 增量更新 | ~20fps，CPU <1% |
| JSONL 轮询 | 增量读取 + 部分行缓冲 | 1.5s 延迟，内存稳定 |
| 状态防抖 | 最小展示时间 + 优先级 | 防止动画闪烁 |

### 4.7 跨平台兼容性

```javascript
// 平台差异处理
const isMac = process.platform === "darwin";

// 1. 终端跳转
if (isMac) {
  // macOS: AppleScript + System Events
  execFile("osascript", ["-e", `
    tell application "System Events"
      set frontmost of process "${processName}" to true
    end tell
  `]);
} else {
  // Windows: PowerShell + Win32 API
  psProc.stdin.write(focusCommand);
}

// 2. 托盘图标
if (isMac) {
  // macOS: Template 图标（自动适配深色模式）
  tray = new Tray(nativeImage.createFromPath("tray-iconTemplate.png"));
} else {
  // Windows: 普通图标
  tray = new Tray(nativeImage.createFromPath("tray-icon.png"));
}

// 3. Dock 显示
if (isMac) {
  app.dock.show();  // 或 app.dock.hide()
}

// 4. 前台窗口权限
if (!isMac) {
  // Windows: 需要特殊权限让其他进程置前
  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  const AllowSetForegroundWindow = user32.func("bool __stdcall AllowSetForegroundWindow(int)");
}
```
