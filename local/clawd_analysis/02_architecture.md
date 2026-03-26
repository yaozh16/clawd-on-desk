## 二、系统架构分析

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           AI Agent Layer                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │ Claude Code  │  │  Codex CLI   │  │ Copilot CLI  │                  │
│  │  (hooks)     │  │ (log poll)   │  │  (hooks)     │                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         │                 │                 │                           │
│         ▼                 ▼                 ▼                           │
├─────────────────────────────────────────────────────────────────────────┤
│                         Integration Layer                                │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐             │
│  │ clawd-hook.js│  │ codex-log-monitor│  │copilot-hook.js│             │
│  │ (HTTP POST)  │  │ (JSONL polling)  │  │ (HTTP POST)  │             │
│  └──────┬───────┘  └────────┬─────────┘  └──────┬───────┘             │
│         │                   │                   │                      │
│         └─────────────┬─────┴───────────────────┘                      │
│                       ▼                                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                        HTTP Server (port 23333)                         │
│  ┌─────────────────┐  ┌─────────────────┐                              │
│  │  POST /state    │  │ POST /permission│                              │
│  │  (状态更新)     │  │  (权限审批)     │                              │
│  └────────┬────────┘  └────────┬────────┘                              │
│           │                    │                                        │
├───────────┴────────────────────┴────────────────────────────────────────┤
│                         Core Engine (main.js)                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐      │
│  │Session Mgr  │ │State Machine│ │ Window Mgr  │ │Permission   │      │
│  │(多会话追踪) │ │(状态转换)   │ │(透明窗口)   │ │Bubble Stack │      │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘      │
│         │               │               │               │              │
│         └───────────────┴───────────────┴───────────────┘              │
│                                   │                                     │
├───────────────────────────────────┴─────────────────────────────────────┤
│                         Presentation Layer                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │
│  │ Main Window     │  │ Bubble Window   │  │ System Tray     │        │
│  │ (renderer.js)   │  │ (bubble.html)   │  │ (Menu)          │        │
│  │ SVG Animation   │  │ Permission Card │  │ Context Menu    │        │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块职责

#### 2.2.1 main.js - 主进程（~1200行）

主进程是整个应用的核心控制器，承担以下职责：

```javascript
// 核心职责矩阵
const MAIN_PROCESS_RESPONSIBILITIES = {
  // 1. HTTP Server - 接收 Agent 事件
  httpServer: {
    port: 23333,
    endpoints: {
      '/state': '状态更新（非阻塞）',
      '/permission': '权限审批（阻塞式 HTTP hook）'
    }
  },

  // 2. State Machine - 动画状态管理
  stateMachine: {
    states: ['idle', 'thinking', 'working', 'juggling', 'conducting',
             'error', 'attention', 'notification', 'sweeping', 'carrying',
             'yawning', 'dozing', 'collapsing', 'sleeping', 'waking',
             'mini-idle', 'mini-alert', 'mini-happy', 'mini-peek'],
    priority: 'error > notification > sweeping > attention > carrying > juggling > working > thinking > idle > sleeping',
    minDisplayTime: '防止状态闪烁，关键状态有最小展示时间'
  },

  // 3. Session Manager - 多会话追踪
  sessionManager: {
    tracking: '每个 Agent 会话的状态、PID、CWD、编辑器信息',
    staleDetection: '10分钟无活动清理会话',
    processLiveness: '检测 Agent 进程是否存活'
  },

  // 4. Window Manager - 窗口管理
  windowManager: {
    main: '透明、始终置顶、不可聚焦的主窗口',
    bubble: '权限审批气泡窗口（支持堆叠）',
    hitTest: '精确的 SVG 碰撞检测（透明区域点击穿透）'
  },

  // 5. Mini Mode - 极简模式
  miniMode: {
    trigger: '拖到屏幕右边缘或右键菜单',
    behavior: '隐藏在屏幕边缘，hover 时探头'
  },

  // 6. Sleep Sequence - 睡眠序列
  sleepSequence: {
    idle: '20s 无鼠标移动 → idle-look（东张西望）',
    yawn: '60s 无鼠标移动 → yawning → dozing',
    sleep: '10min 无鼠标移动 → collapsing → sleeping',
    wake: '鼠标移动 → waking → idle'
  }
};
```

#### 2.2.2 renderer.js - 渲染进程（~450行）

渲染进程负责 UI 层的交互和动画：

```javascript
// 渲染进程职责
const RENDERER_RESPONSIBILITIES = {
  // 1. 拖拽系统（Pointer Capture 保证可靠性）
  drag: {
    mechanism: 'Pointer Events + Pointer Capture',
    threshold: '3px（区分点击和拖拽）',
    safety: '窗口失焦、系统弹窗时自动停止拖拽'
  },

  // 2. 点击反应系统
  clickReaction: {
    single: '单击 → 聚焦终端',
    double: '双击 → poke 动画（左/右方向根据点击位置）',
    quad: '四击 → flail 动画（东张西望）'
  },

  // 3. SVG 动画切换
  svgSwitch: {
    method: '预加载 + 透明度渐变切换',
    timing: 'CSS transition 控制平滑过渡'
  },

  // 4. 眼球追踪
  eyeTracking: {
    trigger: 'idle 状态 + idle-follow.svg',
    calculation: '光标位置 → 眼球偏移量（最大 3px）',
    bodyLean: '身体跟随眼球轻微倾斜',
    shadowStretch: '阴影根据倾斜方向拉伸'
  }
};
```

#### 2.2.3 agents/ - Agent 适配层

采用**配置驱动**的轻量级适配器模式：

```javascript
// agents/claude-code.js
module.exports = {
  id: "claude-code",
  name: "Claude Code",
  processNames: { win: ["claude.exe"], mac: ["claude"] },
  eventSource: "hook",  // 通过 hook 接收事件

  // 事件 → 状态映射
  eventMap: {
    SessionStart: "idle",
    UserPromptSubmit: "thinking",
    PreToolUse: "working",
    PostToolUse: "working",
    PostToolUseFailure: "error",
    Stop: "attention",
    SubagentStart: "juggling",
    // ... 完整映射
  },

  // 能力声明
  capabilities: {
    httpHook: true,           // 支持 HTTP hook（阻塞式）
    permissionApproval: true, // 支持权限审批
    sessionEnd: true,         // 有 SessionEnd 事件
    subagent: true            // 支持子 Agent
  }
};

// agents/codex.js - 不同的数据源策略
module.exports = {
  id: "codex",
  eventSource: "log-poll",  // 日志轮询，非 hook
  logConfig: {
    sessionDir: "~/.codex/sessions",
    pollIntervalMs: 1500
  },
  // JSONL record type:subtype → state mapping
  logEventMap: {
    "session_meta": "idle",
    "event_msg:task_started": "thinking",
    // ...
  }
};
```

### 2.3 数据流

#### 2.3.1 状态更新流（非阻塞）

```
Claude Code Hook 触发
    ↓
hooks/clawd-hook.js 读取 stdin (session_id, cwd)
    ↓
进程树遍历获取稳定 PID（终端、编辑器、Agent PID）
    ↓
HTTP POST → 127.0.0.1:23333/state
    ↓
main.js: updateSession(sessionId, state, event, ...)
    ↓
状态优先级解析 → setState(newState)
    ↓
IPC: sendToRenderer("state-change", state, svg)
    ↓
renderer.js: SVG 预加载 + 切换动画
```

#### 2.3.2 权限审批流（阻塞式）

```
Claude Code PermissionRequest 事件
    ↓
HTTP hook → POST 127.0.0.1:23333/permission (阻塞等待响应)
    ↓
main.js: 创建 Bubble 窗口 + 渲染审批卡片
    ↓
用户点击 Allow/Deny/Suggestion
    ↓
HTTP Response 返回决策 JSON
    ↓
Claude Code 执行或拒绝工具调用
```

### 2.4 关键技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 桌面框架 | Electron | 跨平台、Node.js 生态、透明窗口原生支持 |
| 动画格式 | SVG + CSS Keyframes | 可操作内部 DOM（眼球追踪）、无损缩放、文件小 |
| 进程间通信 | 本地 HTTP Server | 零延迟、无文件并发问题、hook 脚本极简 |
| 权限审批 | HTTP hook（非 command hook） | 支持请求-响应模式，command hook 只能 fire-and-forget |
| Codex 事件源 | 日志轮询 | Windows hooks 禁用，JSONL 包含完整事件信息 |
| 终端跳转 | PowerShell 进程复用 | 避免冷启动延迟，预编译 C# 类型 |
