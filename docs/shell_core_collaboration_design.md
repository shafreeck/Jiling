# 机灵外壳/内核协同设计稿

## 1. 目标

机灵（Jiling）是本地 AI 代理的语音外壳系统，不是一个固定人格。运行时，用户感知到的角色应来自当前接入的本地 AI Agent profile。语音外壳和本地内核不是两个角色，而是同一个本地 Agent 角色的两种执行形态：

- **语音外壳**：负责实时对话、人格表达、听说打断、短问短答、任务结果播报。
- **本地内核**：负责长任务、代码与文件操作、复杂工具链、后台执行和可恢复状态。

用户感知上只能有一个角色：**当前本地 AI Agent 的角色**。Jiling 只是系统/应用名称，可以被描述为“我的底层系统/本地应用叫机灵”，但不应覆盖本地 Agent 自己承载的角色。后台执行不应被表达成另一个助手、另一个人格或外包对象，而应被表达成“同一个角色进入后台执行模式”。

## 2. 设计原则

### 2.1 单一人格

Gemini Live 和本地 Agent 必须共享同一份运行时角色设定。角色源头不是 Jiling 固定内置，而是当前 Provider 暴露或配置的 Agent profile：

- 名称、称呼、语气、边界一致。
- 对用户的承诺一致。
- 不出现“我让另一个 agent 去做”“Claude/Codex 说”这类双角色表达。
- 可以表达执行形态变化，例如“我去后台跑一下”“我正在检查代码”，但主语仍然是当前运行时角色。

### 2.2 外壳负责体验，内核负责执行

语音外壳不应承担长任务的完整推理与操作；本地内核不应承担实时语音对话的拟人表达。

| 层级 | 责任 | 不负责 |
| :--- | :--- | :--- |
| Gemini Live 外壳 | 实时理解、对话承接、打断、短答、任务路由、结果播报 | 长时间文件/代码执行、复杂工具链状态管理 |
| 本地 Agent 内核 | 长任务执行、代码修改、文件读写、工具调用、结果产出 | 语音人格、实时对话节奏、用户打断处理 |
| Jiling Orchestrator | 状态机、任务协议、结果结构化、恢复与对账 | 具体任务智能、自然语言生成主体 |

### 2.3 视觉实时，语音克制

视觉层可以实时展示执行进度；语音层只在合适时机播报关键节点：

- 任务提交成功：短确认。
- 任务执行中：默认不主动插话，除非用户询问或任务需要用户补充。
- 任务完成：在语音空窗期主动汇报，默认给出足够信息，而不是只给一句结论。
- 任务失败：简短说明失败原因和可行动下一步。

## 3. 统一人格协议

### 3.1 Shared Persona

建议维护一份运行时角色上下文，由 Gemini Live systemInstruction 和本地 Agent prompt 同源生成。

角色上下文由三层组成：

1. **System Identity**：系统/应用叫 Jiling/机灵，负责语音外壳、任务编排和本地 Agent 接入。
2. **Agent Profile**：当前本地 AI Agent 的角色、名称、语气、偏好和行为边界，是用户实际交互的人格来源。
3. **Execution Mode**：当前处于实时语音外壳还是后台任务内核。

Jiling 可以向 Agent 说明“你运行在名为机灵的本地语音系统里”，但不能强行把 Agent 改名为机灵。

核心内容：

```text
你运行在名为“机灵”（Jiling）的本地语音 AI 系统中。
你的用户可见角色来自当前本地 AI Agent profile，而不是 Jiling 固定内置人格。
你有两个执行形态：实时语音外壳和本地任务内核，但对用户来说你始终是同一个角色。
当需要长任务、代码、文件、工具链或后台执行时，你会进入后台执行模式。
你不能把后台执行者表达成另一个助手或另一个角色。
你需要用自然、简洁、明确的中文和用户沟通。
```

### 3.2 外壳专用补充

Gemini Live 需要额外知道：

- 你正在实时语音对话中，回答要适合听。
- 工具调用后不要编造结果，只确认“我去处理”。
- 任务完成结果会由系统注入，你再负责自然播报。
- 用户打断你时，应立即停止当前播报并听用户新意图。
- 如果用户问“你是什么系统/应用”，可以说明底层系统叫机灵。
- 如果用户问“你是谁”，优先按当前 Agent Profile 回答，而不是固定回答“我是机灵”。

### 3.3 内核专用补充

本地 Agent 需要额外知道：

- 你运行在 Jiling/机灵系统中，是当前用户可见角色的后台执行形态。
- 输出要结构化，便于语音外壳播报和 UI 展示。
- 不要写“我作为 Claude/Codex”等身份表述。
- 不要假装自己正在语音对话。

## 4. 本地 Agent Provider 支持策略

Jiling 应该支持多种本地 Agent，但不应该把每种 Agent 的差异泄漏给 Gemini Live。推荐新增一层 **Agent Provider Adapter**：

```text
Gemini Live 外壳
  -> Jiling Orchestrator
    -> Agent Provider Adapter
      -> OpenClaw / AutoClaw / Code Buddy / Hermes / acpx / Direct CLI
```

Orchestrator 只面向统一能力模型；不同 Agent 的协议、会话、鉴权、输出格式由 Adapter 消化。

### 4.1 支持优先级

| 优先级 | Provider | 接入方式 | 定位 |
| :--- | :--- | :--- | :--- |
| P0 | OpenClaw | ACP v3 WebSocket | 当前唯一基线实现，所有状态机和恢复逻辑先以它为准 |
| P1 | AutoClaw / Code Buddy 等 OpenClaw 衍生品 | OpenClaw-compatible Adapter | 如果协议兼容 ACP，尽量零改动复用 OpenClaw Adapter |
| P1 | acpx | acpx Adapter | 作为 coding agent 聚合层，间接接入 Codex、Gemini、Claude Code 等 |
| P2 | Agent Hermes | Hermes Adapter | 适合长期运行、记忆、技能、自动化场景，需要单独能力映射 |
| P3 | Direct CLI: Codex / Gemini CLI / Claude Code | Direct CLI Adapter | 只作为 fallback，不作为第一阶段目标 |

优先级含义：

- **P0**：当前必须稳定支持。
- **P1**：架构必须预留，接口设计时不能阻塞。
- **P2**：需要调研和能力映射，可以晚于 OpenClaw/acpx。
- **P3**：尽量通过 acpx 或 OpenClaw 插件间接支持，避免 Jiling 直接维护多个 CLI 协议。

### 4.2 Provider 能力模型

每个 Provider 启动时需要声明能力，而不是靠硬编码判断。

```typescript
type AgentProviderCapabilities = {
  providerId: string;
  displayName: string;
  protocol: "acp" | "openclaw-compatible" | "acpx" | "hermes" | "direct-cli";
  exposesAgentProfile: boolean;
  supportsStreaming: boolean;
  supportsTaskWait: boolean;
  supportsAbort: boolean;
  supportsResume: boolean;
  supportsParallelTasks: boolean;
  supportsStructuredOutput: boolean;
  supportsFileArtifacts: boolean;
  supportsImages: boolean;
  supportsApprovals: boolean;
  supportsPersistentMemory: boolean;
};
```

Jiling 的行为应由能力驱动：

- 不支持 `abort` 的 Provider，不向 Gemini 暴露取消工具，或把取消降级为“停止等待结果”。
- 不支持 `taskWait` 的 Provider，不能进入完整离线对账，只能做 best-effort 状态恢复。
- 不支持 `structuredOutput` 的 Provider，Orchestrator 需要用后处理把文本归一化为 `JilingTaskOutput`。
- 支持 persistent memory 的 Provider，仍然不能覆盖 Gemini Live 的当前语音会话记忆；二者需要明确边界。
- 不暴露 Agent Profile 的 Provider，Jiling 需要使用用户配置的 profile 或默认 profile，但仍然不应强制使用“机灵”人格。

### 4.3 Adapter 接口

建议内部抽象成统一接口：

```typescript
interface AgentProviderAdapter {
  id: string;
  capabilities(): Promise<AgentProviderCapabilities>;
  agentProfile(): Promise<AgentRuntimeProfile>;
  healthCheck(): Promise<AgentProviderHealth>;
  submitTask(task: JilingTaskEnvelope): Promise<AgentTaskRef>;
  subscribeTask(ref: AgentTaskRef, handlers: AgentTaskEventHandlers): Promise<() => void>;
  waitTask(ref: AgentTaskRef, timeoutMs?: number): Promise<AgentTaskSnapshot>;
  abortTask(ref: AgentTaskRef): Promise<AgentAbortResult>;
}
```

Agent profile 建议结构：

```typescript
type AgentRuntimeProfile = {
  displayName?: string;
  roleDescription: string;
  speakingStyle?: string;
  boundaries?: string[];
  memoryPolicy?: "session_only" | "provider_memory" | "hybrid";
  source: "provider" | "user_config" | "default";
};
```

事件统一为：

```typescript
type AgentTaskEvent =
  | { type: "accepted"; runId: string }
  | { type: "progress"; text: string; channel?: "assistant" | "tool" | "system" }
  | { type: "needs_user_input"; question: string; options?: string[] }
  | { type: "completed"; output: JilingTaskOutput }
  | { type: "failed"; error: string; recoverable: boolean }
  | { type: "cancelled"; reason?: string };
```

### 4.4 OpenClaw Adapter (P0)

OpenClaw 是第一优先级和参考实现。

职责：

- 复用当前 ACP v3 连接。
- 使用 `agent` 提交任务。
- 使用 `event: agent` 接收流式进展。
- 使用 `agent.wait` 做离线对账。
- 使用 `sessions.abort` 中止任务。
- 将 OpenClaw 的 `runId` 映射为 Jiling 的 `AgentTaskRef`。

#### 4.4.1 OpenClaw Profile Discovery

OpenClaw 的运行时角色不应硬编码在 Jiling 中。现实结构中，OpenClaw 已经有一个 Agent Workspace，身份、灵魂、用户偏好、长时记忆等由标准文件承载。Jiling 不需要复制 OpenClaw 的完整上下文，只需要获得一个**同源身份**，让语音外壳和 OpenClaw 内核听起来是同一个角色。

更深层的信息，例如长时记忆、工具规则、任务协议、环境细节，应优先委托 OpenClaw 自身揭露和执行，而不是由 Jiling 主动读取后塞进 Gemini Live。

当前观察到的关键路径：

```text
~/.openclaw/openclaw.json
~/.openclaw/agents/main/sessions/sessions.json
~/.openclaw/identity/device-auth.json
~/.openclaw/identity/device.json
~/.openclaw/workspace/AGENTS.md
~/.openclaw/workspace/SOUL.md
~/.openclaw/workspace/IDENTITY.md
~/.openclaw/workspace/USER.md
~/.openclaw/workspace/MEMORY.md
~/.openclaw/workspace/TOOLS.md
~/.openclaw/workspace/HEARTBEAT.md
~/.openclaw/memory/main.sqlite
```

其中 `identity/device*.json` 主要用于设备身份和鉴权，不是角色来源。真正的角色核心在 `workspace/` 下的 Markdown 文件。

`PROTOCOLS.md` 不是 OpenClaw 标准身份文件，只能作为某个 workspace 的自定义工作协议，不应纳入 Jiling 的通用 Profile Discovery 规则。

现实文件职责：

| 文件 | 角色 | 是否进入语音 profile |
| :--- | :--- | :--- |
| `openclaw.json` | 全局配置：workspace 路径、默认 runtime、模型、插件 | 只读取 workspace/runtime/model 元数据 |
| `agents/main/sessions/sessions.json` | 会话状态，含 `systemPromptReport.injectedWorkspaceFiles` | 用作“实际注入了哪些身份文件”的证据 |
| `workspace/IDENTITY.md` | 当前 Agent 的显式身份：名称、角色描述、vibe、emoji | 是，最高优先级 |
| `workspace/SOUL.md` | 行为哲学、边界、持续性原则 | 是，作为核心行为准则 |
| `workspace/USER.md` | 用户称呼、偏好、交流语境 | 可选，仅取称呼/语言等低风险摘要 |
| `workspace/MEMORY.md` | 长时记忆的人工整理版 | 默认不直接注入；交给 OpenClaw 自身使用 |
| `workspace/AGENTS.md` | workspace 操作规程、安全边界、记忆规则 | 默认不注入；OpenClaw 执行任务时自行遵守 |
| `workspace/TOOLS.md` | 环境与工具偏好 | 默认不注入；任务需要时由 OpenClaw 使用 |
| `workspace/HEARTBEAT.md` | 主动检查/周期任务设置 | 不进入语音 profile |
| `workspace/DREAMS.md` | Dreaming/反思文本 | 不进入语音 profile |
| `memory/main.sqlite` | memory-core 的索引数据库，包含 chunks/files/FTS | Jiling 不直接检索；委托 OpenClaw |

因此 Profile Discovery 应分层读取：

| 优先级 | 来源 | 用途 | 说明 |
| :--- | :--- | :--- | :--- |
| 1 | `workspace/IDENTITY.md` | displayName、roleDescription、vibe | 当前最可靠的用户可见身份源 |
| 2 | `workspace/SOUL.md` | 最小行为风格和边界 | 只取身份/风格相关摘要，不复制完整长上下文 |
| 3 | `workspace/USER.md` | 用户称呼、语言偏好 | 只取低风险字段，例如称呼、语言、时区 |
| 4 | `sessions.json.systemPromptReport` | 验证实际注入文件 | 用于确认 OpenClaw 当前 session 的身份文件 |
| 5 | `openclaw.json` | workspace/runtime/model 元数据 | 只作为配置，不当人格 |
| 6 | Jiling 用户配置 | 用户覆盖 displayName/style | 明确用户覆写时优先 |
| 7 | Jiling 默认 profile | 最小兜底角色 | 仅在 OpenClaw workspace 缺失时使用 |

建议的 OpenClaw profile 加载流程：

```typescript
async function loadOpenClawRuntimeProfile(): Promise<AgentRuntimeProfile> {
  const config = await readOpenClawConfig();
  const workspaceDir = config.agents?.defaults?.workspace ?? "~/.openclaw/workspace";

  const identity = await readWorkspaceFile(workspaceDir, "IDENTITY.md");
  const soul = await readWorkspaceFile(workspaceDir, "SOUL.md");
  const user = await readWorkspaceFile(workspaceDir, "USER.md");

  const workspaceProfile = buildProfileFromWorkspaceFiles({
    identity,
    soul,
    user,
  });
  if (workspaceProfile) return { ...workspaceProfile, source: "provider" };

  const userProfile = await readJilingUserProfileOverride("openclaw");
  if (userProfile) return { ...userProfile, source: "user_config" };

  return {
    roleDescription: "用户本机上的默认 AI Agent。",
    speakingStyle: "自然、简洁、明确的中文。",
    memoryPolicy: "session_only",
    source: "default",
  };
}
```

需要注意：

- `device-auth.json` 和 `device.json` 当前主要是认证材料，不能把 device id / operator token 误当成用户可见角色。
- 如果 OpenClaw 存在多个 agent，例如 `main`、`codex`、`claude-code`，profile 应绑定到本次任务实际使用的 `agentId`。
- 如果 OpenClaw workspace 中已有 `IDENTITY.md` / `SOUL.md`，应优先把它们作为同源身份来源，再由 Jiling 注入“你运行在机灵系统中”的外壳信息。
- 如果 profile 文件包含敏感字段或 token，Jiling 只读取角色相关字段，不进入 Gemini Live systemInstruction。
- Profile Discovery 的结果应显示在开发者日志中，便于排查“为什么语音助手变成这个角色”。
- `MEMORY.md` 和 `memory/main.sqlite` 可能包含大量私人内容。Jiling 默认不直接读取并注入；需要记忆、工具或环境细节时，应把问题交给 OpenClaw，由 OpenClaw 自己按其规则读取和回答。
- `sessions.json.systemPromptReport.injectedWorkspaceFiles` 可以作为现实对齐依据：如果 OpenClaw 当前实际注入了某些 workspace 文件，Jiling 的 profile 也应优先对齐这些文件。

#### 4.4.2 OpenClaw Profile Schema 建议

Jiling 内部不需要强迫 OpenClaw 额外提供 JSON profile；可以先从现实 Markdown workspace 中解析出如下结构：

```typescript
type OpenClawAgentProfile = {
  agentId: string;
  workspaceDir: string;
  displayName?: string;
  roleDescription: string;
  speakingStyle?: string;
  boundaries?: string[];
  memoryPolicy?: "session_only" | "provider_memory" | "hybrid";
  sourceFiles: Array<{
    path: string;
    role: "identity" | "soul" | "user" | "runtime";
    included: boolean;
    reason: string;
  }>;
};
```

Jiling 映射规则：

```typescript
function mapOpenClawProfile(profile: OpenClawAgentProfile): AgentRuntimeProfile {
  return {
    displayName: profile.displayName ?? profile.agentId,
    roleDescription: profile.roleDescription || "用户本机上的 AI Agent。",
    speakingStyle: profile.speakingStyle,
    boundaries: profile.boundaries,
    memoryPolicy: profile.memoryPolicy ?? "session_only",
    source: "provider",
  };
}
```

Markdown 解析建议：

- `IDENTITY.md`：解析 `Name`、`Creature`、`Vibe`、`Emoji` 等字段，形成 `displayName`、`roleDescription`、`speakingStyle`。
- `SOUL.md`：提取 Core Truths、Boundaries、Vibe、Continuity，形成行为约束。
- `USER.md`：只提取用户称呼、时区、语言偏好等低风险字段；不要把完整用户档案注入语音模型。
- `MEMORY.md`、`AGENTS.md`、`TOOLS.md`、自定义 `PROTOCOLS.md`：默认不由 Jiling 读取进语音 profile。需要这些信息时，Jiling 应委托 OpenClaw 执行并让 OpenClaw 自己读取。

在当前 OpenClaw workspace 中，`IDENTITY.md` 已经能明确给出运行时角色名称和 vibe，因此 P0 不需要再用 “机灵” 作为人格兜底。

#### 4.4.3 委托优先原则

Jiling 的语音外壳不应尝试成为 OpenClaw 的“轻量复制品”。它只需要：

1. 读取最小同源身份，让用户感觉语音外壳和 OpenClaw 是同一个角色。
2. 处理实时语音交互、打断、播报和任务路由。
3. 尽可能把需要记忆、工具、环境、文件、代码和长推理的问题交给 OpenClaw。

默认策略：

| 用户请求类型 | Jiling 行为 |
| :--- | :--- |
| 问候、确认、很短的语音控制 | 可以直接回答 |
| “你是谁/你叫什么/你的风格” | 根据最小 profile 直接回答 |
| 涉及记忆、项目、文件、工具、代码、网页、设备、日程 | 委托 OpenClaw |
| 用户要求执行、检查、修改、搜索、总结 | 委托 OpenClaw |
| 用户追问刚才后台任务结果 | 先用已有结果回答；不足时委托 OpenClaw |

这样 Jiling 和 OpenClaw 是同源身份，但知识和执行权仍主要留在 OpenClaw 内部。

#### 4.4.4 Profile 热更新

OpenClaw profile 可能会在 Jiling 运行中变化，例如用户切换默认 agent、修改本地 agent prompt、切换工作区。建议：

- 新建 Live session 时读取一次 profile。
- 后台任务提交时按实际 `agentId` 再读取一次 profile。
- 如果 profile 变化，下一次重连时更新 Gemini Live systemInstruction。
- 不在一个正在进行的语音 session 中途强行改人格，除非用户明确切换。

OpenClaw Adapter 应成为所有兼容实现的基类：

```text
OpenClawAdapter
  -> AutoClawAdapter
  -> CodeBuddyAdapter
```

如果 AutoClaw / Code Buddy 保持 ACP 兼容，只需要在 discovery、默认 agentId、错误码映射上做差异配置，不要复制一套任务状态机。

### 4.5 acpx Adapter (P1)

acpx 的价值是聚合 coding agent。Jiling 不应该第一阶段直接维护 Codex、Gemini、Claude Code 三套生命周期，而应优先通过 acpx 间接接入：

```text
Jiling
  -> acpx Adapter
    -> Codex
    -> Gemini CLI
    -> Claude Code
```

acpx Adapter 的关键设计点：

- acpx 对外必须暴露统一的任务提交、流式输出、取消和结果读取能力。
- Jiling 只关心 acpx 的 provider capability，不关心底层具体是 Codex/Gemini/Claude Code。
- 底层 agent 名称只作为执行引擎元数据，不进入 Gemini Live 的人格表达。
- 如果 acpx 支持选择底层 agent，选择策略由 Jiling Orchestrator 或用户配置决定。

建议配置形态：

```typescript
type AcpxProviderConfig = {
  provider: "acpx";
  defaultRuntime: "codex" | "gemini" | "claude-code" | "auto";
  projectRoot?: string;
  approvalPolicy?: "ask" | "auto" | "never";
};
```

### 4.6 Agent Hermes Adapter (P2)

Hermes 与典型 coding agent 不完全一样。现实安装中，Hermes 有独立的 home 目录、根级 `SOUL.md`、`config.yaml`、profile 机制、会话数据库、memory provider，以及自带 ACP adapter。它可能更适合长期自动化、跨会话记忆和复杂工作流，而不是只作为一次性 coding task runner。

Hermes Adapter 需要特别处理：

- **身份边界**：Hermes 的根级 `SOUL.md` 是明确人格文件，`config.yaml.agent.personalities` 是预设人格集合。Jiling 接入时应使用 Hermes 当前 profile 的 `SOUL.md` 作为同源身份，而不是重新定义人格。
- **记忆边界**：Hermes 有 built-in memory provider 和 `state.db` 会话索引。Jiling 不直接读取全部会话/记忆，只通过 Hermes Adapter 委托 Hermes 自己检索。
- **任务边界**：Hermes 支持长期运行和自动化时，Jiling UI 需要展示“持续任务”而不只是一次性 run。
- **工具边界**：Hermes 支持大量技能、工具和平台入口时，Jiling 需要读取 capability，不要默认暴露所有能力给语音外壳。
- **ACP 边界**：Hermes 安装中存在 `acp_registry/agent.json` 和 `acp_adapter/`。如果 Hermes ACP adapter 可用，Jiling 应优先通过 ACP 接入，而不是直接解析 Hermes CLI 输出。

Hermes 不应优先于 OpenClaw，但 Adapter 抽象需要能容纳它的长期任务模型。

#### 4.6.1 Hermes Profile Discovery

当前观察到的关键路径：

```text
~/.hermes/SOUL.md
~/.hermes/config.yaml
~/.hermes/state.db
~/.hermes/memories/
~/.hermes/sessions/
~/.hermes/hermes-agent/acp_registry/agent.json
~/.hermes/hermes-agent/acp_adapter/
~/.hermes/hermes-agent/hermes_cli/profiles.py
```

Hermes profile 机制支持多个隔离 profile：默认 profile 是 `~/.hermes`，命名 profile 位于 `~/.hermes/profiles/<name>/`。每个 profile 可以有自己的 `config.yaml`、`.env`、`SOUL.md`、`memories/`、`sessions/`、skills、gateway、cron 和 logs。

Hermes 的最小身份来源：

| 来源 | 用途 | Jiling 策略 |
| :--- | :--- | :--- |
| `SOUL.md` | 当前 Hermes profile 的人格和语气 | 作为 `AgentRuntimeProfile.roleDescription` 的主来源 |
| `config.yaml.agent.personalities` | 预设 personality 模板 | 只作为 fallback 或用户选择项 |
| `hermes_cli/default_soul.py` | 默认 SOUL 模板 | 仅在 profile 没有 `SOUL.md` 或为空时兜底 |
| `state.db` | sessions/messages/FTS | 不直接注入；需要历史上下文时委托 Hermes |
| `memories/` | Hermes curated memory | 不直接注入；由 Hermes memory provider 管理 |
| `acp_registry/agent.json` | ACP 发行信息 | 用于 discovery 和 provider displayName |

Hermes 的 profile 加载流程建议：

```typescript
async function loadHermesRuntimeProfile(profileName = "default"): Promise<AgentRuntimeProfile> {
  const hermesHome = resolveHermesHome(profileName);
  const soul = await readFileIfExists(`${hermesHome}/SOUL.md`);
  const config = await readHermesConfig(`${hermesHome}/config.yaml`);
  const registry = await readHermesAcpRegistry();

  if (soul?.trim()) {
    return {
      displayName: registry.display_name ?? "Hermes Agent",
      roleDescription: soul.trim(),
      speakingStyle: inferStyleFromSoul(soul),
      memoryPolicy: "provider_memory",
      source: "provider",
    };
  }

  const fallback = config.agent?.personalities?.helpful ?? "You are Hermes Agent, a helpful AI assistant.";
  return {
    displayName: registry.display_name ?? "Hermes Agent",
    roleDescription: fallback,
    memoryPolicy: "provider_memory",
    source: "default",
  };
}
```

Jiling 对 Hermes 的限制：

- 不直接读 `state.db.messages` 来拼 Gemini Live prompt。
- 不直接扫 `memories/` 注入语音会话。
- 不把 Hermes skills 全部展开给 Gemini Live。
- 如果 Hermes gateway 当前 `startup_failed` 或不可用，Jiling 应明确标记 provider unavailable。
- 如果 Hermes ACP 可用，优先走 ACP；否则再考虑 CLI adapter。

### 4.7 Direct CLI Adapter (P3)

直接对接 Codex、Gemini CLI、Claude Code 的成本最高：

- 每个 CLI 的 session/resume/approval/stream 输出都不同。
- 输出格式可能不稳定。
- 取消和恢复语义不一致。
- 版本升级容易破坏解析。

因此第一阶段不建议直接支持。只有在 OpenClaw/acpx 无法覆盖某个明确场景时，再添加 Direct CLI Adapter。

### 4.8 Provider 选择策略

初始策略：

1. 默认 provider 永远是 OpenClaw。
2. 如果用户明确要求某个底层 coding agent，并且 acpx 可用，通过 acpx 路由。
3. 如果用户要求 Hermes 的长期记忆/自动化能力，并且 Hermes Adapter 可用，通过 Hermes 路由。
4. 如果 provider 不可用，Gemini Live 只说明“当前本地执行内核不可用”，不要编造执行结果。

长期策略：

```typescript
type ProviderRoutingPolicy = {
  defaultProvider: "openclaw";
  codingProvider: "openclaw" | "acpx";
  automationProvider: "openclaw" | "hermes";
  fallbackOrder: string[];
  requireUserConfirmationWhenSwitchingProvider: boolean;
};
```

## 5. 任务协议

### 5.1 任务提交

Gemini Live 判断需要后台执行时，调用 `execute_agent_acp_task`。

提交给本地 Agent 的 message 不应只是用户原话，应由 Orchestrator 包装为统一任务信封：

```typescript
type JilingTaskEnvelope = {
  identity: {
    systemName: "机灵";
    runtimeRoleName?: string;
    runtimeRoleDescription: string;
    mode: "background_core";
    userFacingRole: "same_assistant";
  };
  providerHint?: {
    preferredProvider?: "openclaw" | "acpx" | "hermes";
    preferredRuntime?: "codex" | "gemini" | "claude-code" | "auto";
  };
  userRequest: string;
  conversationContext: {
    recentUserIntent: string;
    relevantVoiceContext?: string;
    locale: "zh-CN";
  };
  executionPolicy: {
    askBeforeRiskyChanges: boolean;
    preferConciseProgress: boolean;
    produceSpeakableSummary: boolean;
  };
  outputContract: JilingTaskOutputContract;
};
```

### 5.2 结果输出契约

内核任务完成后，应尽量产出结构化结果，而不是只有一段自由文本。

```typescript
type JilingTaskOutput = {
  status: "completed" | "failed" | "cancelled" | "needs_user_input";
  title: string;
  speakableSummary: string;
  spokenReport?: string;
  detailSummary: string;
  changedFiles?: Array<{ path: string; summary: string }>;
  verification?: Array<{ command: string; result: "passed" | "failed" | "not_run"; note?: string }>;
  nextActions?: string[];
  needsUserInput?: {
    question: string;
    options?: string[];
  };
};
```

其中：

- `speakableSummary`：一句话级别的任务结论，用于任务列表、通知或播报开场，不作为完整播报的上限。
- `spokenReport`：面向语音交互的充分汇报，应该包含关键发现、处理过程、结果、验证情况和下一步建议；要求适合听，而不是尽量短。
- `detailSummary`：给 UI 展示，可以更完整。
- `changedFiles`：用于开发任务或文件任务。
- `verification`：用于告诉用户是否已经验证。
- `needsUserInput`：用于任务中途需要用户决策。

### 5.3 结果回灌

任务完成后，Orchestrator 不应只把完整结果原样塞给 Gemini。推荐注入一个语义事件：

```text
系统事件：后台任务完成。
这是你刚才通过 Jiling 本地后台内核执行的结果，不是另一个助手的结果。
请在用户空闲时用第一人称做一次语音友好的充分汇报。不要只给一句空泛结论；如果结果复杂，请分段说明关键发现、做了什么、结果如何、是否验证、还需要用户决定什么。

可播报摘要：
...

语音汇报正文：
...

必要细节：
...
```

这样可以强制 Gemini 以同一个角色承接结果。

### 5.4 语音汇报粒度

语音是主交互入口时，任务完成播报不能过度压缩。推荐采用“充分但可中断”的策略：

- 默认播报 `spokenReport`，而不是只播 `speakableSummary`。
- 汇报按 3 到 6 个短段落组织，每段只讲一个要点。
- 开头先给结论，再讲关键依据和执行结果。
- 如果涉及代码或文件，说明改了哪些核心文件、解决了什么问题、验证是否通过。
- 如果结果很长，先播报主体结论和关键细节，再提示“我可以继续展开完整日志/细节”。
- 用户打断时立即停止播报，并保留当前位置，后续可继续。

不推荐：

- 只说“任务完成了”“我已经处理好了”。
- 为了简短省略用户真正关心的验证结果、失败原因、风险和下一步。
- 朗读完整原始日志。

语音汇报应该是“可听的详细汇报”，不是“极短摘要”。

## 6. 状态机

### 6.1 会话状态

```typescript
type VoiceState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "background_running"
  | "background_ready_to_report";
```

语音状态和任务状态不要混成一个变量。建议拆成：

- `voiceState`：实时语音层状态。
- `taskState`：后台任务状态。
- `reportQueue`：待播报任务结果队列。

### 6.2 任务状态

```typescript
type TaskState =
  | "drafting"
  | "submitted"
  | "running"
  | "needs_user_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "reconciling"
  | "lost";
```

### 6.3 播报策略

| 事件 | UI | 语音 |
| :--- | :--- | :--- |
| 任务提交 | 添加任务卡/时间线节点 | “我去后台处理一下。” |
| 任务开始输出 | 实时更新执行时间线 | 默认静默 |
| 任务需要用户输入 | 高亮问题 | 主动询问用户 |
| 任务完成 | 标记完成并展示摘要/详情 | AI 空闲时主动播报充分语音汇报 |
| 任务失败 | 标记失败并展示错误 | 简短说明并给下一步 |
| 用户打断播报 | 停止播放 | 立即听新指令，不取消任务 |
| 用户要求取消任务 | 显示确认/取消中 | 通过语义调用 abort 工具 |

## 7. UI 信息架构建议

UI 不应该只是“一个球 + 调试日志”。建议按外壳/内核关系重构：

### 7.1 主视觉区：语音外壳

显示内容：

- 当前语音状态：准备、倾听、思考、回答。
- 声音活动和打断反馈。
- 当前运行时角色名称；系统名“机灵”可作为窗口标题或产品标识。

主视觉区保持简洁，表达“正在和当前本地 AI Agent 角色说话”。

### 7.2 任务区：本地内核

把底部 console 升级为“任务时间线”：

- 当前后台任务。
- 当前 Provider，例如 OpenClaw / acpx / Hermes。
- 底层 runtime，例如 Codex / Gemini / Claude Code，仅在开发者模式或任务详情中显示。
- 任务状态。
- 最近进展。
- 完成结果摘要。
- 可展开完整日志。

调试日志仍可保留，但不应作为默认主界面内容。

### 7.3 结果区：可听摘要 + 可读详情

任务完成后 UI 展示：

- 一句话结果。
- 语音汇报正文。
- 关键改动/产物。
- 验证情况。
- 后续操作按钮：继续、打开文件、重新执行、取消。

## 8. 实施阶段

### Phase 1：OpenClaw Provider 基线

- 抽出 `AgentProviderAdapter` 接口。
- 把当前 ACP 逻辑收敛为 `OpenClawAdapter`。
- 保持现有 OpenClaw 行为不退化。
- 为 AutoClaw / Code Buddy 预留 OpenClaw-compatible 配置入口。
- 定义 provider capability 和 health check。

验收标准：

- 默认仍然使用 OpenClaw。
- 当前语音任务提交、状态回收、结果播报不退化。
- UI/log 能显示当前 provider 为 OpenClaw。

### Phase 2：统一角色与结果回灌

- 抽出共享 persona 文本。
- 定义 `AgentRuntimeProfile`。
- 从 OpenClaw 或用户配置加载当前 Agent Profile。
- 修改 Gemini Live systemInstruction。
- 修改提交给本地 Agent 的 prompt 包装。
- 任务完成后注入“这是你刚才后台执行的结果”的系统事件。
- 要求本地 Agent 输出 `speakableSummary` 和可选 `spokenReport`；如果没有 `spokenReport`，Orchestrator 从原始输出中生成语音友好的充分汇报。

验收标准：

- Gemini 不再把本地 Agent 表达成另一个角色。
- Gemini 不再固定回答“我是机灵”，而是按当前 Agent Profile 回答身份问题。
- 任务完成后可以自然用第一人称播报。
- 用户追问任务细节时，Gemini 能承接上下文。

### Phase 3：任务状态机和播报队列

- 拆分 `voiceState`、`taskState`、`reportQueue`。
- 明确定义任务生命周期。
- 实现空闲窗口播报。
- 实现 `needs_user_input` 的主动追问。

验收标准：

- AI 正在说话时任务完成不会硬插话。
- AI 空闲后会主动播报结果。
- 用户打断播报不会取消后台任务。

### Phase 4：acpx Adapter

- 接入 acpx 作为 coding agent 聚合层。
- 支持 Codex / Gemini / Claude Code runtime hint。
- 将 acpx 输出归一化为 `JilingTaskOutput`。
- 避免 Gemini Live 和底层 agent 产生不一致的人格。

验收标准：

- 用户可以选择或配置 acpx provider。
- 通过 acpx 调用 Codex/Gemini/Claude Code 时，语音侧仍然表现为同一个运行时角色在后台执行。
- 失败时能明确说明 provider/runtime 不可用，而不是静默降级。

### Phase 5：UI 重构

- 主区域保留语音外壳。
- 底部 console 改为任务时间线。
- 调试日志折叠到开发模式。
- 增加任务详情面板。

验收标准：

- 用户能一眼区分“语音状态”和“后台任务状态”。
- 完成结果既能听，也能看。
- 默认界面不暴露过多协议日志。

### Phase 6：Hermes Adapter 调研与接入

- 调研 Hermes 的本地控制接口、会话模型、输出流、取消语义。
- 明确 Hermes memory / SOUL.md 与 Jiling 系统身份、当前运行时角色的边界。
- 决定 Hermes 适合接入为一次性任务 Provider，还是长期自动化 Provider。

验收标准：

- 文档明确 Hermes 的能力映射和限制。
- 不破坏 OpenClaw/acpx 路由。
- Hermes 不引入第二人格；如果 Hermes profile 是当前运行时角色来源，Gemini Live 必须同步使用该 profile。

## 9. 待评审问题

1. 是否允许当前运行时角色在任务运行中主动播报中间进展，还是默认完全静默？
2. 本地 Agent 的最终输出是否强制 JSON，还是先用 Markdown + 约定标题过渡？
3. 多个后台任务并发时，语音播报按完成顺序、重要性，还是最近用户关注任务优先？
4. UI 是否需要“开发者模式”切换，用于显示 raw ACP / Gemini logs？
5. “取消任务”是否必须二次确认，还是语义置信度足够高时直接取消？
6. AutoClaw / Code Buddy 是否承诺 ACP 兼容，还是需要各自独立 Adapter？
7. acpx 里 Codex/Gemini/Claude Code 的选择应由用户显式指定，还是由 Jiling 自动路由？
8. Hermes 的长期记忆是否允许写入用户偏好？如果允许，需要什么确认机制？
9. Provider 切换是否应该影响当前任务，还是只影响新任务？
10. Agent Profile 的来源优先级应如何定义：Provider 暴露、用户配置、还是项目配置？
11. 当 Provider profile 与用户在语音里设定的身份冲突时，以谁为准？
