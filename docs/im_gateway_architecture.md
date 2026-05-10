# Jiling IM 网关架构设计稿

## 1. 背景与目标

目前机灵（Jiling）主要被定义为 **Voice Shell**。但在实际场景中，用户需要更精准、更安静、或者跨终端的交互方式。

**目标**：将 Jiling 升级为 **ACP Agent 的通用 IM 网关**。它不仅支持本地键盘输入（已部分实现），还能作为外部 IM 生态（如微信、Telegram）进入本地 ACP Agent 集群的唯一入口。

## 2. 核心价值

*   **统一协议驱动**：利用 Jiling 现有的 `AcpProviderAdapter`，通过 IM 驱动 Codex, Claude Code, Gemini CLI 等所有支持 ACP 的 Agent。
*   **富交互能力 (A2UI)**：突破传统 IM 仅限文本/图片的限制，利用 Jiling 的 `AuraRenderer` 展示拓扑图、图表、代码对比等富组件。
*   **多模态接力 (Multi-modal Hand-off)**：
    *   在家通过语音发起任务。
    *   出门后通过手机 IM 查看进度、进行审批或输入微调指令。
    *   回到电脑前，在 Jiling UI 上看到完整的任务输出卡片。

## 3. 逻辑架构

```text
[ 用户端 (Shells) ]          [ 编排层 (Orchestrator) ]       [ 执行层 (Cores) ]
       |                            |                           |
Voice Shell (Gemini Live) --------> |                           |
       |                            |                           |
Local IM Shell (ChatInput) -------> |      Jiling Core          |      ACP Agent
       |                            |   (Task Management) <===> | (OpenClaw / Hermes /
External IM Gateway --------------> |   (A2UI Formatting)       |  Codex / Claude Code)
(WeChat/Telegram/etc.)              |                           |
                                    |                           |
```

## 4. 关键特性设计

### 4.1 异步任务网关 (Async Task Gateway)
外部 IM 请求通常是瞬时的，而 ACP 任务是长时运行的。Jiling 作为网关需具备：
*   **状态保持**：即使 IM 客户端断开，Jiling 仍保持与 ACP Agent 的连接。
*   **主动回调 (Webhooks/Push)**：当 Agent 产生阶段性进展或 `completed` 时，Jiling 通过 IM 网关主动向用户推送消息。

### 4.2 A2UI 渲染降级与增强
*   **增强体验**：在本地 Jiling UI 上，展示完整的 React 组件卡片。
*   **降级适配**：在微信等外部 IM 上，Jiling 将 A2UI 组件自动转化为：
    *   Markdown 文本摘要。
    *   静态图片（由 Puppeteer 或原生截图生成）。
    *   交互式按钮（转化为斜杠命令，如 `/approve_task_123`）。

### 4.3 跨端状态同步
Jiling 作为一个 Tauri 应用，维护一份本地任务数据库。IM Gateway 接入后，所有的 IM 交互记录将同步更新到：
1.  本地 `transcript` 消息流。
2.  `agentTasks` 任务状态列表。
3.  Gemini Live 的上下文（以便语音能感知到刚刚发生的 IM 操作）。

## 5. 技术实现参考 (以微信为例)

通过集成或参考 `weixin-agent-sdk`，Jiling 可以实现如下链路：

1.  **接入**：Jiling 启动一个轻量级的 HTTP/WebSocket 服务作为外部 Gateway 入口。
2.  **指令转换**：
    *   用户发消息：`帮我改一下 src/lib 下的 bug`。
    *   Gateway 转换：将其包装为 `JilingTaskEnvelope`，调用 `adapter.submitTask`。
3.  **实时反馈**：
    *   ACP 产生 `progress` -> Jiling 推送文字进度到微信。
    *   ACP 产生 `A2UI Approval` -> Jiling 发送包含“批准/拒绝”按钮的模板消息（或图片）。
    *   用户点击“批准” -> Gateway 调用 `respond_agent_task_action`。

## 6. 演进路径

*   **Phase 1 (已完成)**：本地 `ChatInput` 驱动 ACP 任务，支持 `handleSubmitText`。
*   **Phase 2**：完善 IM 消息在 UI 上的呈现，将 `transcript` 与 `agentTasks` 深度绑定。
*   **Phase 3**：定义 Gateway 接口协议，支持外部程序（如 Python 脚本、微信机器人）通过简单的 API 向 Jiling 派发 ACP 任务。
*   **Phase 4**：实现 A2UI 的“媒体化降级”，让外部 IM 也能感知富交互的结果。
