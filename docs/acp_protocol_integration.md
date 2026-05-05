# Agent Client Protocol (ACP) 深度集成规范 (v3)

> [!IMPORTANT]
> **验证声明**：本规范中涉及的所有 Endpoint、方法名 (`agent`, `agent.wait`, `sessions.abort`) 以及事件结构 (`tick`, `event: agent`) 均已通过 OpenClaw Gateway (v3) 实测验证。

## 1. 协议定义与连接
Jiling 通过 **Agent Client Protocol (ACP) v3** 协议与 OpenClaw 网关通信。

*   **Endpoint**: `ws://127.0.0.1:18789/acp`
*   **连接模型**: 应用级全局单例 WebSocket。
*   **心跳机制**: 监听 `event: "tick"` (周期 30s)，并将其转发为 Gemini 会话的保活信号。

---

## 2. 身份认证 (Auth Handshake)
采用 Ed25519 挑战-应答模式。

*   **身份源**: 默认复用 `~/.openclaw/identity/` 下的 `device.json`。
*   **流程**:
    1. 接收 `connect.challenge` 事件，提取 `nonce` 和 `ts`。
    2. 使用私钥对载体签名。
    3. 发送 `connect` 请求，获取身份权限。

---

## 3. 核心接口 Schema (JSON Frame)

### 3.1 任务提交 (agent)
```typescript
{
  "type": "req",
  "method": "agent",
  "id": "run-req-id",
  "params": {
    "agentId": string,      // 默认 "claude-code" 或 "codex"
    "message": string,      // 语音转文字后的任务指令
    "idempotencyKey": string // 格式: jiling-<nanos>
  }
}
```

### 3.2 任务监听 (event: agent)
网关实时推送的事件流：
```typescript
{
  "event": "agent",
  "payload": {
    "runId": string,
    "stream": "assistant" | "lifecycle" | "tool",
    "data": {
      "text"?: string,     // 助手回复片段
      "phase"?: "start" | "end" | "error",
      "error"?: string     // 错误描述
    }
  }
}
```

### 3.3 任务中止 (sessions.abort)
用于响应 Gemini 的 `abort_task` 工具调用。
```typescript
{
  "type": "req",
  "method": "sessions.abort",
  "id": "abort-req-id",
  "params": {
    "runId": string // 或对应的 sessionKey
  }
}
```

---

## 4. 离线对账逻辑 (Reconciliation)

系统启动时执行以下流程：
1. **Load**: 从本地 SQLite 加载所有非终结态任务（`SUBMITTED` | `RUNNING` | `RECONCILING`）。
2. **Sync**: 针对每个任务发送 `agent.wait` 请求：
   ```typescript
   {
     "type": "req",
     "method": "agent.wait",
     "id": "wait-req-id",
     "params": { "runId": "..." }
   }
   ```
3. **Resolve**: 
   * 若返回成功且 `phase: "end"` -> 更新本地状态为 `COMPLETED`。
   * 若返回 `not_found` -> 标记为 `LOST`。
   * 若返回错误 -> 标记为 `FAILED`。

---

## 5. 错误代码与异常处理
*   `AUTH_FAILED`: 身份文件缺失或签名错误。
*   `GATEWAY_UNAVAILABLE`: 网关未启动或端口冲突。
*   `TASK_REJECTED`: 任务参数非法或 Agent 无法加载。
*   `TIMEOUT`: 任务执行超过预设阈值。
