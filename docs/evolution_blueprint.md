# Jiling 架构演进蓝图 (Evolution Blueprint)

本文档旨在规划 Jiling 从单机工具向系统化 Agent 枢纽演进的架构设计。

## 1. Agent 接入标准化与 ACP v3

### 1.1 技术事实 (2026年生态现状)
*   **ACP (Agent Client Protocol) v3**：已成为 Agent 与客户端通讯的标准协议。
*   **标杆实现 (Benchmark)**：
    *   **Hermes Agent (NousResearch/hermes-agent)**：于 **2026 年 3 月** 正式发布，是 OpenClaw 的进化版本。其内置 `acp_adapter` 提供了标准的 ACP v3 接口，支持通过 WebSocket 进行 JSON-RPC 通讯。
    *   **Claude Code**：Anthropic 官方 Agent，同样遵循 ACP/MCP 协议栈。
*   **Codex CLI / Aider**：通过社区适配器接入 ACP 生态。

### 1.2 设计方案：标准 ACP v3 宿主架构
*   **从桥接转向标准 (Standardization)**：
    *   Jiling 不再开发特定的“桥接层”，而是实现一套完整的 **ACP v3 客户端规范 (Client Spec)**。
    *   **自动发现 (Agent Discovery)**：Jiling 启动时扫描系统路径下的 ACP 配置文件（通常位于 `~/Library/Application Support/acp/agents` 或各 Provider 自定义目录）。
*   **生命周期管理**：
    *   Jiling 后端 (`acp.rs`) 负责启动 Agent 进程（作为子进程或远程连接）。
    *   通过标准 ACP 握手进行 `capabilities` 交换，识别 Agent 是否支持 `file_editing`、`terminal_access` 或 `memory_search`。

---

## 2. 全链路上下文感知 (Context Bus)

### 2.1 技术事实
*   **Gemini Live API**：
    *   通过 `client_content` 消息支持 `user` 和 `model` 角色。
    *   `turnComplete: true` 会强制模型生成响应。
    *   `systemInstruction` 仅在 `setup` 阶段设置一次，不可动态更新。
*   **OpenAI Realtime API**：
    *   通过 `conversation.item.create` 支持静默添加历史记录。
    *   只有在显式发送 `response.create` 或启用 `server_vad` 且用户发言后才会触发响应。

### 2.2 设计方案
*   **上下文快照 (Context Snapshot)**：
    *   在启动语音 Live 瞬间，Jiling 生成一个包含 IM 往返对话、当前屏幕 OCR、活跃文件名的 `Snapshot`。
*   **注入路径**：
    *   **Gemini 适配器**：
        1.  **强制闭合注入 (Closed Injection)**：连接建立后，立即发送包含 `Snapshot` 的 `client_content`，并设置 `turnComplete: true`。
        2.  **技术事实依据**：调研显示 `turnComplete: false` 在某些 Bidi 实例下会导致 Session 挂起，直到下一个文本包到达。使用 `true` 可确保模型状态机立即完成上下文索引并进入“就绪”状态。
        3.  **静默策略 (First Response Discard)**：客户端（Jiling）标记此次发送为“Context Seeding”。对于模型紧接着产生的第一个 `serverContent` 响应，客户端在 UI 层和音频播放层尝试静默丢弃。
        4.  **风险与控制 (Risk Control)**：考虑到拦截首包可能导致状态机不同步或丢失重要开场白，此功能应提供设置开关：
            *   `enable_context_seeding`: 总开关，控制是否注入 IM 历史。
            *   `silent_seeding`: 实验性开关，控制是否执行首包丢弃。若关闭，模型会对历史记录进行口头确认。
    *   **OpenAI 适配器**：
        1.  通过 `conversation.item.create` 逐条压入 IM 对话历史。
        2.  不手动发送 `response.create`，等待用户语音触发 VAD。

---

## 3. 分布式与远程网关 (Remote ACP)

### 3.1 技术事实
*   **连接模型**：目前的 `GlobalAcpManager` 基于本地文件系统（`provider_dir`）。
*   **安全性**：远程连接需要处理网络不稳定性、数据加密（TLS）和更复杂的鉴权（OAuth2/JWT）。

### 3.2 设计方案
*   **配置解耦**：
    *   引入 `ProviderDescriptor`：
        ```rust
        struct ProviderDescriptor {
            id: String,
            endpoint: String, // ws://localhost:port 或 wss://remote:port
            auth_type: AuthType, // LocalFile, StaticToken, JWT
            identity: Option<Identity>,
        }
        ```
*   **身份漫游**：支持将网关认证信息存储在 Jiling 的安全数据库中，而非强依赖本地 `.openclaw` 目录。

---

## 4. 多模态 Live 适配层

### 4.1 技术事实
*   **协议差异**：Gemini 使用特定的 `GoogleGenAI` SDK 封装，OpenAI 使用原始 WebSocket 消息。音频格式、VAD 策略、工具调用返回格式均不一致。

### 4.2 设计方案
*   **适配器模式 (Adapter Pattern)**：
    *   定义 TypeScript 接口 `ILiveAdapter`：
        ```typescript
        interface ILiveAdapter {
          connect(): Promise<void>;
          sendAudio(chunk: Int16Array): void;
          sendVideo(frame: string): void; // base64
          onMessage(callback: (msg: CommonLiveMessage) => void): void;
        }
        ```
*   **多厂商支持清单**：
    *   **GeminiAdapter**: 采样率 16kHz/24kHz，使用 `client_content` 管理上下文。
    *   **OpenAIAdapter**: 采样率 24kHz (PCM16)，通过 `conversation.item.create` 注入历史，支持 `server_vad` 自动切换。
    *   **DoubaoAdapter (火山引擎)**：采用自定义二进制帧协议（Header + Payload），需在适配器层进行二进制编解码封装，采样率通常为 16kHz/24kHz。

---

## 5. 远端网关连接与身份认证 (Remote Auth)

### 5.1 技术事实
*   **安全连接**：必须采用 `wss://` 加密传输。
*   **鉴权模式**：
    *   **Static Token**: 适用于受控内网或个人私有部署，在 WebSocket Header 中携带密钥。
    *   **mTLS (双向证书)**：适用于高安全场景，Jiling 需管理客户端证书。
    *   **ACP v3 挑战响应**：通过 `auth.challenge` 消息流进行设备身份二次确认。

### 5.2 设计方案
*   **身份存储 (Secure Vault)**：
    *   在 Jiling 本地数据库中为每个 `Remote Provider` 存储其 `Endpoint`、`AuthToken` 及 `ServerPublicKey`。
*   **重连策略**：
    *   由于语音会话对延迟敏感，需实现指数退避重连，并在重连后立即通过 `Context Snapshot` 恢复会话上下文。

---

## 6. 演进路线图

1.  **阶段一 (标准化)**：将 `acp.rs` 重构为支持配置化的 Provider 管理，移除硬编码路径。
2.  **阶段二 (上下文)**：实现 IM 到语音 Live 的 `systemInstruction` 注入。
3.  **阶段三 (多厂商)**：抽象 `ILiveAdapter` 并接入 OpenAI Realtime。
4.  **阶段四 (分布式)**：支持远程 WSS 网关连接。
