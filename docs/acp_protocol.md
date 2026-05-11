# OpenClaw Agent Communication Protocol (ACP) 权威指南

本协议定义了 Jiling 客户端与 OpenClaw 网关之间的通信标准。所有交互必须严格遵循以下规范。

## 1. 认证与连接 (Authentication)

### 1.1 初始握手 (Handshake)
- **Method**: `connect`
- **Id**: `auth`
- **Params**:
  - `auth`: 包含 token 或 secret 的对象。
  - `device`: `{ id, name, platform }`
  - `client`: `{ name, version }`
- **Note**: 必须是 WebSocket 建立后的第一条消息。

## 2. 配置与元数据管理 (Config & Metadata)

### 2.1 模型列表 (Models)
- **Method**: `models.list`
- **Params**:
  - `view`: 可选 `"default"`, `"configured"`, `"all"` (默认: `"default"`)。
- **Result**: `{ models: Array<ModelEntry> }`
- **ModelEntry**: 包含 `id`, `provider`, `name`, `capabilities` 等字段。

### 2.2 配置管理 (Config)
- **Method**: `config.get`
- **Result**: 返回经过脱敏的网关配置对象。
- **Method**: `config.patch` / `config.set`
- **Params**: `raw` (JSON 字符串), `baseHash` (用于冲突检测)。

## 3. Agent 资产管理 (Agent Assets)

### 3.1 Agent 列表 (List)
- **Method**: `agents.list`
- **Result**: `{ agents: Array<AgentEntry> }`

### 3.2 工作区文件操作 (Files)
- **Method**: `agents.files.list`: 获取工作区文件清单。
- **Method**: `agents.files.get`: 读取文件内容。
- **Method**: `agents.files.set`: 写入文件内容。

## 4. 任务执行与状态流 (Task Lifecycle)

### 4.1 启动交互任务 (Execute)
- **Method**: `agent`
- **Params**:
  - `agentId`: 目标 Agent 的 ID。
  - `message`: 用户指令内容。
  - `systemInstruction`: 可选的系统提示词。
  - `sessionKey`: 关联会话（如果是继续会话，此项必填）。
  - `idempotencyKey`: 幂等键。

### 4.2 任务中止 (Abort)
- **Method**: `sessions.abort`
- **Params**: `{ runId: string }`

### 4.3 状态恢复 (Wait/Track)
- **Method**: `agent.wait`
- **Params**: `{ runId: string }`
- **Note**: 用于重连后找回进行中任务的后续推送。

### 4.4 后台任务管理 (Background Tasks)
- **Method**: `tasks.list`, `tasks.get`, `tasks.cancel`
- **Identifier**: 使用 `taskId` 而非 `runId`。

## 5. 消息格式规范

### 5.1 请求 (Request)
```json
{
  "type": "req",
  "method": "METHOD_NAME",
  "id": "UNIQUE_ID",
  "params": { ... }
}
```

### 5.2 响应 (Response)
```json
{
  "type": "res",
  "id": "CORRESPONDING_ID",
  "ok": true,
  "payload": { ... }
}
```

### 5.3 事件推送 (Event)
```json
{
  "type": "event",
  "method": "agent",
  "params": {
    "runId": "RUN_ID",
    "stream": "assistant",
    "data": { "text": "..." }
  }
}
```

## 6. 核心注意事项
- **命名规范**: 协议参数严格使用 **camelCase**。
- **错误处理**: `ok: false` 时，响应中包含 `error: { code, message, details }`。
- **会话持久化**: `autoclaw` 提供商需要自动管理 `sessionKey` 以维持上下文连贯性。
