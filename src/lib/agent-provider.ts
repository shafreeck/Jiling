export type AgentProviderCapabilities = {
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

export type AgentRuntimeProfile = {
  providerId: string;
  displayName?: string;
  roleDescription?: string;
  identityContext?: string;
  soulContext?: string;
  userContext?: string;
  speakingStyle?: string;
  boundaries?: string[];
  memoryPolicy?: "session_only" | "provider_memory" | "hybrid";
  source: "provider" | "user_config" | "default";
};

export type AgentProviderHealth = {
  status: "ok" | "unreachable" | "degraded";
  message?: string;
};

export type JilingTaskOutputContract = {
  format: "structured_json" | "markdown_with_titles";
  requireSpeakableSummary: boolean;
  requireSpokenReport: boolean;
};

export type JilingTaskEnvelope = {
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
  attachments?: {
    type: "image" | "audio" | "video" | "file";
    filePath: string;
    mimeType: string;
    fileName?: string;
  }[];
  conversationContext: {
    recentUserIntent: string;
    relevantVoiceContext?: string;
    locale: string;
  };
  executionPolicy: {
    askBeforeRiskyChanges: boolean;
    preferConciseProgress: boolean;
    produceSpeakableSummary: boolean;
  };
  outputContract: JilingTaskOutputContract;
};

export type JilingTaskOutput = {
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

export type AgentTaskEvent =
  | { type: "accepted"; runId: string }
  | { type: "progress"; text: string; channel?: "assistant" | "tool" | "system" }
  | { type: "needs_user_input"; question: string; options?: string[] }
  | { type: "completed"; output: JilingTaskOutput | string }
  | { type: "failed"; error: string; recoverable: boolean }
  | { type: "cancelled"; reason?: string };

export type AgentTaskRef = {
  runId: string;
  providerId: string;
};

export type AgentTaskSnapshot = {
  status: string;
  output?: string;
};

export type AgentAbortResult = {
  success: boolean;
  message?: string;
};

export type AgentTaskEventHandlers = {
  onProgress?: (event: { text: string; channel?: "assistant" | "tool" | "system" }) => void;
  onNeedsUserInput?: (event: { question: string; options?: string[] }) => void;
  onCompleted?: (event: { output: JilingTaskOutput | string }) => void;
  onFailed?: (event: { error: string; recoverable: boolean }) => void;
  onCancelled?: (event: { reason?: string }) => void;
};

export interface AgentProviderAdapter {
  id: string;
  capabilities(): Promise<AgentProviderCapabilities>;
  agentProfile(): Promise<AgentRuntimeProfile>;
  healthCheck(): Promise<AgentProviderHealth>;
  submitTask(task: JilingTaskEnvelope): Promise<AgentTaskRef>;
  subscribeTask(ref: AgentTaskRef, handlers: AgentTaskEventHandlers): Promise<() => void>;
  waitTask(ref: AgentTaskRef, timeoutMs?: number): Promise<AgentTaskSnapshot>;
  abortTask(ref: AgentTaskRef): Promise<AgentAbortResult>;
}
