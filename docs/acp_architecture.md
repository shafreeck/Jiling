# 机灵 (Jiling) AI 语音助手核心架构设计

## 1. 架构愿景：强共生外壳 (Symbiotic Shell)
机灵 (Jiling) 定位为本地智能体（Agent）的**语音交互外壳**。其架构核心在于：语音助手与本地网关（OpenClaw）在生命周期与逻辑状态上实现**深度共生**。

---

## 2. 核心架构：脉冲传导机制 (Pulse Propagation)

### 2.1 强耦合心跳 (Strict Coupling)
*   **脉冲逻辑**：Jiling 监听 OpenClaw 的 `{"event": "tick"}` 信号。只有在隧道健康的情况下，Jiling 才驱动 Gemini Live 的 `keep-alive` 脉冲。
*   **失效保护**：一旦隧道连续 60 秒无脉冲，语音层自动进入“挂起/重连”状态。

### 2.2 任务托管中心 (Task Persistence Center)
*   **事实来源**：利用 SQLite 记录任务全生命周期。
*   **状态补齐**：系统重启后通过 `agent.wait` 接口实现离线期间任务状态的“全速追回”。

---

## 3. 交互规约：视觉即时，语音延迟 (Visual-First, Audio-Deferred)

### 3.1 视觉路径
*   **流式回馈**：UI 实时渲染任务进度，不阻塞对话。

### 3.2 语音路径
*   **静默窗播报**：任务结果的语音反馈仅在对话空窗期触发。
*   **语义注入**：结果以 Text Part 形式静默推给 Gemini，由 Gemini 负责自然的转场转述。

---

## 4. 任务状态机与转移表

### 4.1 状态转移表 (Task Transition Table)

| 当前状态 | 触发事件 | 目标状态 | 动作描述 |
| :--- | :--- | :--- | :--- |
| `PENDING` | 调用 `agent.run` 成功 | `SUBMITTED` | 记录 `runId` 到本地 DB |
| `PENDING` | 调用 `agent.run` 失败 | `FAILED` | 记录错误信息 |
| `SUBMITTED` | 收到首个流式内容/信号 | `RUNNING` | 开始累积数据缓冲区 |
| `RUNNING` | 收到 `phase: "end"` | `COMPLETED` | 标记完成，推入播报队列 |
| `RUNNING` | 收到 `phase: "error"` | `FAILED` | 记录错误，停止推流 |
| `RUNNING` | 调用 `abort_task` 成功 | `CANCELLED` | 发送 abort 信号并清理 |
| `(Any)` | 应用异常退出/崩溃 | `RECONCILING` | 启动时加载所有非终结态任务 |
| `RECONCILING`| `agent.wait` 返回结果 | `COMPLETED` | 补全数据并对账 |
| `RECONCILING`| `agent.wait` 返回 not_found| `LOST` | 标记记录已失效 |

---

## 5. 语义化取消机制 (Semantic Cancellation)
*   **物理打断**：用户插话仅触发播放器的 Mute 操作，不影响后台任务执行。
*   **工具驱动**：Gemini 拥有 `abort_task` 工具。只有通过语义理解确认用户意图后，才会向网关发送中止指令。

---

## 6. 设计准则
*   **意图驱动**：所有核心动作（如取消、重试）必须经过 LLM 语义识别。
*   **协议中立**：通过标准 ACP v3 屏蔽后端 Agent 的差异性。
*   **状态自愈**：依靠本地数据库与 `agent.wait` 机制实现极端环境下的任务流恢复。
