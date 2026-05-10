# IMACP: Anywhere, Any IM, Control Any Agent

## 1. 愿景 (Vision)

**IMACP** 旨在打破地理空间与交互终端的限制。用户可以通过日常使用的即时通讯软件 (WeChat, Telegram, Discord 等)，通过统一的 **ACP (Agent Client Protocol)** 协议，随时随地驱动、监控并审批位于任何位置的 AI Agent 任务。

## 2. 核心理念：IM 驱动架构

与传统“在 Agent 中集成 IM 插件”的模式不同，IMACP 采用 **“IM 控制总线”** 模式：

*   **解耦**：IM 网关是一个独立的控制器，它不属于任何特定的 Agent。
*   **双向通信**：
    *   **Uplink (IM -> Agent)**: 将 IM 消息转换为 ACP 任务指令。
    *   **Downlink (Agent -> IM)**: 将 Agent 的进度、输出及 A2UI 交互降级为 IM 友好的富媒体消息。

## 3. 系统架构

### 3.1 分层设计 (Layered Architecture)

1.  **Interaction Adapter Layer (接入层)**:
    *   负责不同交互平台的长连接管理、流式通信与身份校验。
    *   **Text/IM Adapters**: WeChat, Telegram, Discord (处理文本与异步媒体)。
    *   **Voice/Live Adapters**: Gemini Live, ChatGPT Voice, 豆包 Live (处理实时音频流与多模态感知)。
2.  **Protocol Bridge Layer (协议转换层)**:
    *   **Session Manager**: 管理不同 IM 用户与 Agent 之间的会话绑定及 Token 持久化，支持自动重连，解决重复扫码问题。
    *   **Command Mapper**: 解析自然语言指令，包装为 ACP `JilingTaskEnvelope`。
3.  **ACP Controller Layer (调度层)**:
    *   维护与 Jiling 或其他 ACP 服务器的连接。
    *   实现任务的分发逻辑（例如：微信群 A 指向 Agent X，微信群 B 指向 Agent Y）。

### 3.2 Session 持久化方案

为了解决用户提到的“启动即扫码”的问题，IMACP 将引入：
*   **Encrypted Storage**: 将加密后的 Session Token 存储在本地（如 `~/.jiling/imacp/session.json`）。
*   **Hot Resume**: 进程启动时优先尝试载入 Token，通过热启动恢复连接，只有在授权过期时才触发二维码事件。

## 4. 关键特性

### 4.1 A2UI 交互降级 (UI Degradation)

Agent 在执行任务时产生的富交互（如文件差异对比、审批按钮）在 IM 端需要进行降级处理：
*   **进度反馈**: 将 ACP 的 `progress` 流聚合为简洁的 Markdown 文本块定时推送。
*   **审批交互**: 
    *   **WeChat**: 利用微信模板消息或简单的“回复 1 确认 / 2 拒绝”指令。
    *   **Telegram**: 利用 Inline Buttons 实现原生点击交互。
*   **结果呈现**: 将富文本报告转换为适合手机阅读的长图或 Markdown 片段。

### 4.2 路由规则 (Routing Rules)

支持灵活的映射逻辑：
*   **User-to-Agent**: 私聊消息自动路由到该用户的默认 Agent。
*   **Group-to-Agent**: 微信群内的 @ 消息可以映射到特定的开发 Agent。

## 5. 演进路径

1.  **Phase 1 (Current)**: 作为 Jiling 的 Sidecar 运行，解决微信基础收发。
2.  **Phase 2 (Robustness)**: 实现 Session 持久化，引入 Telegram 支持，完善 A2UI 降级。
3.  **Phase 3 (Independence)**: 剥离为独立的 `imacp` 项目，提供标准的 API 和插件系统，支持 Docker 部署在 VPS 上。

---

*“让 Agent 触手可及，让控制无处不在。”*
