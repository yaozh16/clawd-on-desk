## 三、核心功能与技术亮点

### 3.1 多 Agent 支持系统

这是项目的核心竞争力之一——**统一的抽象层**适配三种不同的事件源：

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Abstraction Layer                   │
│                                                              │
│  Claude Code          Codex CLI           Copilot CLI       │
│  ┌─────────┐         ┌─────────┐         ┌─────────┐       │
│  │ Hook    │         │ JSONL   │         │ Hook    │       │
│  │ System  │         │ Polling │         │ System  │       │
│  └────┬────┘         └────┬────┘         └────┬────┘       │
│       │                   │                   │             │
│       ▼                   ▼                   ▼             │
│  ┌─────────────────────────────────────────────────┐       │
│  │              Unified State Mapping               │       │
│  │   event → state (thinking/working/error/...)    │       │
│  └─────────────────────────────────────────────────┘       │
│                           │                                 │
└───────────────────────────┼─────────────────────────────────┘
                            ▼
                    Single State Machine
                    Single Animation System
```

#### 技术实现差异

| Agent | 事件来源 | 事件丰富度 | 权限审批 | 终端跳转 |
|-------|---------|-----------|---------|---------|
| Claude Code | Command Hook + HTTP Hook | 完整（16+ 事件） | 支持（阻塞式） | 完整支持 |
| Codex CLI | JSONL 日志轮询 | 有限（~10 事件） | 不支持 | 不支持（无 PID） |
| Copilot CLI | Command Hook | 中等（~10 事件） | 部分支持 | 完整支持 |

**Codex CLI 的特殊处理**：

```javascript
// Windows hooks 硬编码禁用，只能走日志轮询
// agents/codex-log-monitor.js
class CodexLogMonitor {
  // 增量读取 JSONL 文件尾部
  _pollFile(filePath) {
    // 从上次 offset 继续读取
    const readLen = stat.size - tracked.offset;
    // 解析 JSON 行
    for (const line of lines) {
      const obj = JSON.parse(line);
      const key = obj.type + ":" + obj.payload?.type;
      const state = this._config.logEventMap[key];
      this._onStateChange(sessionId, state, event, extra);
    }
  }
}
```

### 3.2 状态机设计

状态机是整个应用的核心逻辑引擎：

```javascript
// 状态优先级（数字越大优先级越高）
const STATE_PRIORITY = {
  error: 8,        // 错误状态最高优先级
  notification: 7, // 权限请求/通知
  sweeping: 6,     // Context 压缩中
  attention: 5,    // 任务完成
  carrying: 4,     // Worktree 创建
  juggling: 4,     // 子 Agent 运行
  working: 3,      // 工具执行中
  thinking: 2,     // AI 思考中
  idle: 1,         // 空闲
  sleeping: 0      // 睡眠
};

// 最小展示时间（防止状态闪烁）
const MIN_DISPLAY_MS = {
  attention: 4000,   // 完成动画至少 4s
  error: 5000,       // 错误动画至少 5s
  notification: 4000,
  sweeping: 2000,
  carrying: 3000
};

// 状态转换逻辑
function setState(newState) {
  // 1. DND 模式下忽略所有事件
  if (doNotDisturb) return;

  // 2. 当前状态未达最小展示时间 → 延迟切换
  const remaining = MIN_DISPLAY_MS[currentState] - elapsed;
  if (remaining > 0) {
    pendingState = newState;
    setTimeout(() => applyPendingState(), remaining);
    return;
  }

  // 3. 优先级比较（低优先级不能打断高优先级）
  if (PRIORITY[newState] < PRIORITY[currentState]) return;

  // 4. 应用新状态
  applyState(newState);
}
```

**状态分组**：

```javascript
// 一次性状态（展示后自动返回）
const ONESHOT_STATES = ['attention', 'error', 'sweeping', 'notification', 'carrying'];

// 睡眠序列状态（有特定转换规则）
const SLEEP_SEQUENCE = ['yawning', 'dozing', 'collapsing', 'sleeping', 'waking'];

// Mini 模式状态（独立的状态分支）
const MINI_STATES = ['mini-idle', 'mini-alert', 'mini-happy', 'mini-peek', 'mini-sleep'];
```

### 3.3 生命感系统

这是让桌宠「活起来」的关键设计：

#### 3.3.1 眼球追踪

```javascript
// 核心算法：光标位置 → 眼球偏移
function calculateEyeOffset(cursorX, cursorY, windowBounds) {
  // 1. 计算眼球屏幕坐标
  const eyeScreenX = bounds.x + bounds.width * (22 / 45);
  const eyeScreenY = bounds.y + bounds.height * (34 / 45);

  // 2. 计算相对偏移
  const relX = cursor.x - eyeScreenX;
  const relY = cursor.y - eyeScreenY;

  // 3. 归一化到最大偏移量（3px）
  const dist = Math.sqrt(relX * relX + relY * relY);
  const scale = Math.min(1, dist / 300);  // 300px 达到最大偏移

  let eyeDx = (relX / dist) * 3 * scale;
  let eyeDy = (relY / dist) * 3 * scale;

  // 4. 限制 Y 方向偏移（螃蟹眼睛不太能上下移动）
  eyeDy = Math.max(-1.5, Math.min(1.5, eyeDy));

  return { eyeDx, eyeDy };
}

// 身体倾斜 + 阴影拉伸
function applyEyeMove(dx, dy) {
  // 眼球移动
  eyes.style.transform = `translate(${dx}px, ${dy}px)`;

  // 身体倾斜（1/3 跟随）
  const bdx = dx * 0.33;
  const bdy = dy * 0.33;
  body.style.transform = `translate(${bdx}px, ${bdy}px)`;

  // 阴影拉伸（脚部固定，身体倾斜时阴影拉伸）
  const scaleX = 1 + Math.abs(bdx) * 0.15;
  shadow.style.transform = `translateX(${bdx * 0.3}) scaleX(${scaleX})`;
}
```

#### 3.3.2 睡眠序列

```
Timeline: 用户停止交互后的状态演变

0s ─────────── 20s ─────────── 60s ─────────── 10min ────────┐
│               │               │               │            │
▼               ▼               ▼               ▼            │
idle      →  idle-look    →  yawning    →  collapsing       │
(跟随光标)   (东张西望)      (打哈欠)      (倒下)              │
                                                │            │
                                            800ms▼           │
                                          sleeping           │
                                          (睡眠)              │
                                                │            │
                                         鼠标移动│            │
                                                ▼            │
                                              waking ←────────┘
                                              (惊醒)
                                                │
                                            1.5s▼
                                              idle
```

#### 3.3.3 点击反应系统

```javascript
// 点击序列检测
const CLICK_WINDOW_MS = 400;  // 连续点击最大间隔

function handleClick(clientX) {
  clickCount++;

  if (clickCount >= 4) {
    // 四击：东张西望动画
    playReaction(REACT_DOUBLE_SVG, 3500);
  } else if (clickCount >= 2) {
    // 双击：戳一戳动画（方向根据点击位置）
    const svg = clientX < center ? REACT_LEFT_SVG : REACT_RIGHT_SVG;
    playReaction(svg, 2500);
  } else {
    // 单击：立即聚焦终端（不等 400ms）
    focusTerminal();
  }
}
```

### 3.4 权限审批气泡

这是一个**效率工具**功能，让用户不必切回终端就能审批工具调用：

```javascript
// HTTP hook 阻塞式请求-响应
// Claude Code → POST /permission → 等待响应
// 用户点击 Allow → HTTP Response → Claude Code 继续执行

// 气泡堆叠设计（多个权限请求同时到达）
const pendingPermissions = [];  // 栈结构

// 气泡 UI
┌──────────────────────────────────────┐
│  Permission Request    [Bash]        │  ← 彩色工具标签
│  ┌────────────────────────────────┐  │
│  │ npm install some-package       │  │  ← 命令预览
│  └────────────────────────────────┘  │
│  ┌────────┐ ┌────────┐               │
│  │ Allow  │ │  Deny  │               │  ← 操作按钮
│  └────────┘ └────────┘               │
│  ┌────────────────────────────────┐  │
│  │ Always allow `npm install`     │→ │  ← Claude Code 建议规则
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

**技术要点**：

1. **阻塞式 HTTP**：请求不立即响应，等待用户决策
2. **超时处理**：600s 超时，Claude Code 会 fallback 到终端
3. **动态高度测量**：气泡高度根据建议数量动态计算，用于堆叠定位
4. **深/浅双主题**：CSS 变量 + `prefers-color-scheme`

### 3.5 终端焦点跳转

这是一个复杂度很高的功能，需要处理：

1. **进程树遍历**：Hook 脚本 PID 是临时 shell，需要向上遍历找到稳定终端
2. **多窗口终端**：Windows Terminal 等多标签终端需要窗口标题匹配
3. **跨进程权限**：Windows 的 `SetForegroundWindow` 需要特殊权限

```javascript
// Windows 终端跳转架构
// 1. 预热 PowerShell 进程（避免冷启动延迟）
psProc = spawn("powershell.exe", ["-NoProfile", "-Command", "-"]);

// 2. 预编译 C# 类型（一次性 ~500ms）
psProc.stdin.write(`
  Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class WinFocus {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    // ... EnumWindows, GetWindowText 等
  }
  "@
`);

// 3. 焦点请求时复用进程（~50ms）
function focusTerminalWindow(sourcePid, cwd) {
  // 关键：授予 PowerShell 前台窗口权限
  AllowSetForegroundWindow(psProc.pid);

  // 发送命令
  psProc.stdin.write(`
    $curPid = ${sourcePid}
    for ($i = 0; $i -lt 8; $i++) {
      $proc = Get-Process -Id $curPid
      if ($proc.MainWindowHandle -ne 0) {
        [WinFocus]::Focus($proc.MainWindowHandle)
        break
      }
      $curPid = (Get-CimInstance Win32_Process -Filter "ProcessId=$curPid").ParentProcessId
    }
  `);
}
```

**VS Code/Cursor 精确 Tab 跳转**：

```javascript
// 扩展通过 URI scheme 注册
// vscode://clawd.clawd-terminal-focus?pids=<PID_CHAIN>

// extension.js
vscode.window.registerUriHandler({
  handleUri(uri) {
    const pids = new URLSearchParams(uri.query).get('pids').split(',');
    for (const terminal of vscode.window.terminals) {
      if (pids.includes(await terminal.processId)) {
        terminal.show(false);  // 精确切换到对应 tab
        return;
      }
    }
  }
});
```

### 3.6 Mini Mode（极简模式）

当用户需要全屏工作空间时，桌宠可以隐藏在屏幕边缘：

```
普通模式                          Mini 模式
┌──────────────────┐              ┌──────────────────┐
│                  │              │                  │
│    ┌─────┐       │              │                  │
│    │Clawd│       │              │           ┌──┐  │ ← 半身露出
│    └─────┘       │   拖到边缘    │           │插│  │
│                  │ ──────────→  │           │槽│  │
│                  │              │           └──┘  │
└──────────────────┘              └──────────────────┘

Mini 模式交互：
- Hover：探头 + 挥手
- Alert：感叹号 + >< 眼睛
- Happy：小花 + ^^ 眼睛
- Click：退出 Mini 模式（抛物线跳回）
```

### 3.7 国际化与本地化

```javascript
const i18n = {
  en: {
    size: "Size",
    miniMode: "Mini Mode",
    sleep: "Sleep (Do Not Disturb)",
    sessions: "Sessions",
    // ...
  },
  zh: {
    size: "大小",
    miniMode: "极简模式",
    sleep: "休眠（免打扰）",
    sessions: "会话",
    // ...
  }
};
```

语言切换通过右键菜单或托盘菜单，设置持久化到 `clawd-prefs.json`。
