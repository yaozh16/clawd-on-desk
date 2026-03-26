## 六、代码质量与工程实践

### 6.1 代码组织

```
clawd-on-desk/
├── src/                      # 主应用代码
│   ├── main.js              # 主进程（~1200行，状态机核心）
│   ├── renderer.js          # 渲染进程（~450行，UI交互）
│   ├── preload.js           # IPC 桥接（~20行）
│   ├── index.html           # 主窗口 HTML
│   ├── bubble.html          # 权限气泡 HTML（内联 CSS/JS）
│   ├── preload-bubble.js    # 气泡 IPC 桥接
│   └── styles.css           # 主窗口样式
├── agents/                   # Agent 配置（插件式架构）
│   ├── claude-code.js       # Claude Code 配置
│   ├── codex.js             # Codex CLI 配置
│   ├── copilot-cli.js       # Copilot CLI 配置
│   ├── registry.js          # Agent 注册中心
│   └── codex-log-monitor.js # Codex 日志轮询器
├── hooks/                    # Hook 脚本（与 Agent 通信）
│   ├── clawd-hook.js        # Claude Code hook
│   ├── copilot-hook.js      # Copilot CLI hook
│   ├── install.js           # Hook 安装/卸载
│   └── auto-start.js        # 自动启动脚本
├── extensions/               # VS Code 扩展
│   └── vscode/
│       ├── extension.js     # URI handler
│       └── package.json
├── assets/                   # 静态资源
│   ├── svg/                 # 40+ 动画 SVG
│   └── gif/                 # 文档用 GIF
├── test/                     # 单元测试
│   ├── agents.test.js
│   └── codex-log-monitor.test.js
├── docs/                     # 设计文档
├── PLAN.md                   # 开发计划（重要决策记录）
└── package.json              # 项目配置
```

### 6.2 设计模式应用

#### 6.2.1 状态模式（State Pattern）

状态机是核心设计模式：

```javascript
// 状态转换逻辑封装
function applyState(state, svgOverride) {
  currentState = state;
  stateChangedAt = Date.now();

  // 状态特定的行为
  switch (state) {
    case 'yawning':
      autoReturnTimer = setTimeout(() => applyState('dozing'), 3000);
      break;
    case 'waking':
      autoReturnTimer = setTimeout(() => applyState(resolveDisplayState()), 1500);
      break;
    case 'error':
      autoReturnTimer = setTimeout(() => applyState(resolveDisplayState()), 5000);
      break;
    // ...
  }
}
```

#### 6.2.2 观察者模式（Observer Pattern）

IPC 通信实现发布-订阅：

```javascript
// main.js（发布者）
function sendToRenderer(channel, ...args) {
  win.webContents.send(channel, ...args);
}

// preload.js（桥接）
contextBridge.exposeInMainWorld("electronAPI", {
  onStateChange: (callback) =>
    ipcRenderer.on("state-change", (_, state, svg) => callback(state, svg)),
  onEyeMove: (callback) =>
    ipcRenderer.on("eye-move", (_, dx, dy) => callback(dx, dy)),
});

// renderer.js（订阅者）
window.electronAPI.onStateChange((state, svg) => {
  // 更新 UI
});
```

#### 6.2.3 策略模式（Strategy Pattern）

Agent 适配层使用策略模式：

```javascript
// agents/registry.js
const AGENTS = [claudeCode, codex, copilotCli];

module.exports = {
  getAllAgents: () => AGENTS,
  getAgent: (id) => AGENT_MAP.get(id),
  getAllProcessNames: () => { /* 聚合所有进程名 */ }
};

// 不同 Agent 有不同的事件获取策略
if (agent.eventSource === "hook") {
  // 使用 command hook
} else if (agent.eventSource === "log-poll") {
  // 使用日志轮询
}
```

#### 6.2.4 工厂模式（Factory Pattern）

动态创建气泡窗口：

```javascript
function createBubbleWindow(permData, yPosition) {
  const bubble = new BrowserWindow({
    width: 320,
    height: 200,  // 初始高度，后续动态调整
    x: screenX - 340,
    y: yPosition,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    // ...
  });
  bubble.loadFile("src/bubble.html");
  return bubble;
}
```

### 6.3 错误处理与健壮性

```javascript
// 1. Hook 脚本的超时保护
setTimeout(() => send("default", ""), 400);  // stdin 超时
httpRequest.setTimeout(500);                  // HTTP 超时

// 2. 进程存活检测的异常处理
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';  // 权限错误意味着进程存在
  }
}

// 3. SVG 加载失败处理
next.addEventListener("load", swap, { once: true });
setTimeout(() => {
  if (!next.contentDocument) {
    next.remove();  // 加载失败，清理
  }
}, 3000);

// 4. JSON 解析防御
try {
  const payload = JSON.parse(raw);
} catch {
  // 静默失败，使用默认值
}

// 5. 文件操作的 try-catch
function loadPrefs() {
  try {
    return JSON.parse(fs.readFileSync(PREFS_PATH, "utf8"));
  } catch {
    return null;
  }
}
```

### 6.4 测试覆盖

```javascript
// test/agents.test.js
const assert = require("node:assert");
const { describe, it } = require("node:test");

describe("agents/claude-code.js", () => {
  it("should have correct id", () => {
    assert.strictEqual(claudeCode.id, "claude-code");
  });

  it("should map events to states", () => {
    assert.strictEqual(claudeCode.eventMap.UserPromptSubmit, "thinking");
  });
});

// test/codex-log-monitor.test.js
describe("CodexLogMonitor", () => {
  it("should parse JSONL lines", () => {
    // 测试 JSONL 解析
  });

  it("should extract session ID from filename", () => {
    // 测试 session ID 提取
  });
});
```

**测试盲点**：
- Electron 主进程（窗口、托盘、状态机）没有自动化测试
- 渲染进程交互（拖拽、点击）需要手动测试
- 跨平台差异需要真机验证

### 6.5 文档与注释

代码中使用了丰富的注释：

```javascript
// ── Section 标题 ──
// 使用 Unicode 横线标记重要区域

// 详细解释复杂逻辑
// Claude Code spawns hooks through multiple transient layers (workers, shells).
// We walk up until we find a known terminal app...

// 行内注释说明意图
const remaining = minTime - elapsed;  // 计算剩余展示时间

// TODO 和 FIXME 标记
// TODO: Codex terminal focus via process tree lookup
// FIXME: macOS auto-update blocked by code signing
```

`PLAN.md` 记录了重要的技术决策和演进历史。

### 6.6 依赖管理

```json
{
  "dependencies": {
    "electron-updater": "^6.8.3",  // 自动更新
    "koffi": "^2.15.2"             // FFI（Windows 窗口权限）
  },
  "devDependencies": {
    "electron": "^41.0.2",
    "electron-builder": "^26.8.1"
  }
}
```

**极简依赖原则**：
- Hook 脚本零依赖（原生 Node.js）
- 主应用仅 2 个运行时依赖
- 总依赖树小，安装快，安全风险低

### 6.7 发布与分发

```json
{
  "build": {
    "appId": "com.clawd.on-desk",
    "mac": {
      "target": [{ "target": "dmg", "arch": ["x64", "arm64"] }],
      "extendInfo": { "LSUIElement": true }  // 不显示在 Dock（默认）
    },
    "win": {
      "target": [{ "target": "nsis", "arch": ["x64"] }]
    },
    "asarUnpack": [
      "hooks/**/*",      // Hook 脚本需要解包（spawn 执行）
      "extensions/**/*"  // 扩展需要解包（复制安装）
    ],
    "publish": [{ "provider": "github" }]
  }
}
```
