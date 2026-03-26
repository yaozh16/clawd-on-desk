## 五、使用场景分析

### 5.1 目标用户画像

| 用户类型 | 特征 | 核心需求 |
|---------|------|---------|
| **独立开发者** | 长时间独自编程，使用 AI 辅助 | 情感陪伴、状态可视化 |
| **AI 原生开发者** | 高频使用 Claude Code/Codex | 权限审批效率、会话管理 |
| **多任务工作者** | 同时跑多个 AI 会话 | 会话状态总览、快速切换 |
| **桌面美化爱好者** | 追求桌面个性化 | 可爱动画、Mini 模式 |

### 5.2 典型使用流程

#### 场景 A：日常 AI 辅助编程

```
1. 开发者启动 Clawd，桌宠出现在桌面角落
2. 在终端输入 prompt，Clawd 进入「thinking」状态（思考气泡）
3. Claude 开始执行工具，Clawd 切换到「working」状态（打字动画）
4. Claude 请求 Bash 权限 → Clawd 弹出气泡
5. 开发者在气泡中点击「Allow」，继续工作
6. 任务完成，Clawd 播放「happy」动画
7. 开发者离开，60s 后 Clawd 开始睡眠序列
8. 开发者回来移动鼠标，Clawd 惊醒
```

#### 场景 B：多会话并行

```
1. 开发者同时打开 3 个终端，分别运行 Claude Code
2. 每个 session 被 Clawd 独立追踪
3. 右键 Clawd → Sessions 菜单，看到：
   🔨 project-A    Working    just now
   🤔 project-B    Thinking   2m ago
   💤 project-C    Idle       5m ago
4. 点击某个会话 → 自动跳转到对应终端窗口
5. 如果 2 个会话同时在执行工具 → Clawd 显示「juggling」动画
6. 如果 3 个会话同时在执行 → Clawd 显示「conducting」动画（指挥家）
```

#### 场景 C：Mini 模式办公

```
1. 开发者需要全屏工作空间
2. 拖动 Clawd 到屏幕右边缘 → 进入 Mini 模式
3. Clawd 隐藏在边缘，只有半身露出
4. Hover 时 Clawd 探头挥手
5. Claude 完成任务 → Mini 模式下显示小花庆祝
6. 点击 Clawd → 抛物线跳回普通模式
```

#### 场景 D：远程/WSL2 开发

```
1. 开发者在 Windows 上使用 WSL2 运行 Claude Code
2. Hook 脚本检测到 Linux PID 不可达
3. 标记 pidReachable = false
4. 跳过 PID 存活检测
5. 依赖纯超时机制管理会话
```

### 5.3 状态映射详解

| Agent 事件 | Clawd 状态 | 动画效果 | 场景说明 |
|-----------|-----------|---------|---------|
| SessionStart | idle | 眼球追踪 | 新会话开始 |
| UserPromptSubmit | thinking | 思考气泡 | AI 理解用户意图 |
| PreToolUse | working | 打字动画 | AI 执行工具 |
| PostToolUseFailure | error | ERROR 烟雾 | 工具执行失败 |
| Stop | attention | 开心弹跳 | 任务完成，等待用户 |
| SubagentStart (1个) | juggling | 杂耍 | 1 个子 Agent |
| SubagentStart (2+个) | conducting | 指挥 | 多个子 Agent 协同 |
| PreCompact | sweeping | 扫把清扫 | Context 压缩中 |
| PostCompact | attention | 开心弹跳 | 压缩完成 |
| Notification | notification | 警告跳 | 有通知需要处理 |
| PermissionRequest | notification | 警告跳 | 权限请求待审批 |
| WorktreeCreate | carrying | 搬箱子 | 创建工作树 |
| 60s 无活动 | sleeping | 睡眠序列 | 用户离开 |

### 5.4 效率提升功能

#### 5.4.1 权限审批气泡

**痛点**：每次 Claude Code 执行 Bash 命令需要切回终端批准

**解决方案**：
- 气泡直接显示在桌面
- 显示工具类型和命令预览
- 提供「Always allow」等建议规则
- 支持堆叠（多个请求同时显示）

**效率提升**：从 ~5s 切换 + 点击 → ~1s 点击

#### 5.4.2 会话 Dashboard

**痛点**：多会话时不知道哪个在跑，手动切换麻烦

**解决方案**：
- 右键菜单显示所有会话状态
- 快捷键 Ctrl+Shift+S 快速弹出
- 点击直接跳转到对应终端
- 支持状态排序（高优先级在前）

#### 5.4.3 终端焦点跳转

**痛点**：点击桌宠不知道会发生什么

**解决方案**：
- 单击立即跳转到最高优先级会话的终端
- 支持 Windows/macOS
- 支持多窗口终端（标题匹配）
- 支持 VS Code/Cursor 精确 Tab 跳转

### 5.5 与竞品对比

| 功能 | Clawd on Desk | Masko Code | Notchi |
|------|--------------|------------|--------|
| **眼球追踪** | ✅ | ❌ | ❌ |
| **点击反应** | ✅（4种） | ❌ | ❌ |
| **睡眠序列** | ✅（5阶段） | ❌ | ✅（简单） |
| **Mini 模式** | ✅ | ❌ | ❌ |
| **权限审批** | ✅（气泡） | ✅（完整面板） | ❌ |
| **终端跳转** | ✅（+Tab精确） | ✅（13种终端） | ❌ |
| **多 Agent** | ✅（3种） | ✅（3种） | ❌ |
| **跨平台** | Win + macOS | 仅 macOS | Win + macOS |
| **动画风格** | 像素风 SVG | HEVC 视频 | 像素风 GIF |

**Clawd 的差异化优势**：
1. **生命感最强**：眼球追踪 + 睡眠序列 + 点击反应
2. **不打扰工作**：透明穿透 + Mini 模式 + DND
3. **效率工具**：权限审批 + 会话管理 + 终端跳转
4. **跨平台**：Windows 和 macOS 功能一致
