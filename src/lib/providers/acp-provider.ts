import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";
import type {
  AgentAbortResult,
  AgentProviderAdapter,
  AgentProviderCapabilities,
  AgentProviderHealth,
  AgentRuntimeProfile,
  AgentTaskEventHandlers,
  AgentTaskRef,
  AgentTaskSnapshot,
  JilingTaskEnvelope,
} from "../agent-provider";

type AcpEvent = {
  payload: {
    run_id: string;
    event_type: string;
    data: {
      text?: string;
      phase?: string;
      error?: string;
      message?: string;
    };
  };
};

export class AcpProviderAdapter implements AgentProviderAdapter {
  id: string;
  displayName: string;
  private dotDir: string;

  constructor(id: string, displayName: string, dotDir: string) {
    this.id = id;
    this.displayName = displayName;
    this.dotDir = dotDir;
  }

  async capabilities(): Promise<AgentProviderCapabilities> {
    return {
      providerId: this.id,
      displayName: this.displayName,
      protocol: "acp",
      exposesAgentProfile: true,
      supportsStreaming: true,
      supportsTaskWait: true,
      supportsAbort: true,
      supportsResume: true,
      supportsParallelTasks: false,
      supportsStructuredOutput: false,
      supportsFileArtifacts: true,
      supportsImages: false,
      supportsApprovals: true,
      supportsPersistentMemory: true,
    };
  }

  private async readFileIfExists(path: string): Promise<string | null> {
    try {
      const fileExists = await exists(path);
      if (fileExists) {
        return await readTextFile(path);
      }
    } catch (e) {
      console.error(`[AcpProvider] Error reading file ${path}:`, e);
    }
    return null;
  }

  async agentProfile(): Promise<AgentRuntimeProfile> {
    try {
      const home = await homeDir();
      const workspaceDir = await join(home, this.dotDir, "workspace");

      const identity = await this.readFileIfExists(await join(workspaceDir, "IDENTITY.md"));
      const soul = await this.readFileIfExists(await join(workspaceDir, "SOUL.md"));
      const user = await this.readFileIfExists(await join(workspaceDir, "USER.md"));

      if (identity || soul || user) {
        let displayName = this.displayName;
        if (identity) {
          const nameMatch = identity.match(/Name:[\s\*]*(.+?)[\s\*]*$/im);
          if (nameMatch) {
            displayName = nameMatch[1].trim();
          }
        }

        return {
          providerId: this.id,
          displayName,
          identityContext: identity || undefined,
          soulContext: soul || undefined,
          userContext: user || undefined,
          roleDescription: [identity, soul].filter(Boolean).join("\n\n"),
          memoryPolicy: "session_only",
          source: "provider",
        };
      }
    } catch (e) {
      console.error("Error reading agent profile", e);
    }

    return {
      providerId: this.id,
      roleDescription: "本地代理 Agent",
      speakingStyle: "自然、简洁、明确的中文。",
      memoryPolicy: "session_only",
      source: "default",
    };
  }

  async healthCheck(): Promise<AgentProviderHealth> {
    // Basic implementation, assumes reachable if we can instantiate it, 
    // ideally ping via WS
    return { status: "ok" };
  }

  async listModels(): Promise<Array<{ id: string; name: string }>> {
    try {
      return await invoke<Array<{ id: string; name: string }>>("get_acp_models", {
        providerDir: this.dotDir,
      });
    } catch (e) {
      console.error("[AcpProvider] Error listing models:", e);
      return [];
    }
  }

  async switchModel(modelId: string): Promise<void> {
    try {
      await invoke("switch_agent_model", {
        providerId: this.id,
        providerDir: this.dotDir,
        agent: "main",
        model: modelId,
      });
    } catch (e) {
      console.error("[AcpProvider] Error switching model:", e);
    }
  }

  async submitTask(task: JilingTaskEnvelope): Promise<AgentTaskRef> {
    // Currently, our ACP backend expects `agent` and `task`
    // We pass `main` as the default agent for now, or read from config

    const systemInstruction = task.identity.runtimeRoleDescription || "";
    const attachments = (task.attachments?.map(a => a.filePath).filter(Boolean) as string[]) || [];

    const runId = await invoke<string>("execute_agent_acp_task", {
      providerId: this.id,
      providerDir: this.dotDir,
      agent: "main",
      task: task.userRequest,
      model: task.model || null,
      systemInstruction: systemInstruction,
      attachments: attachments.length > 0 ? attachments : null,
      silent: task.silent || false,
    });

    return { runId, providerId: this.id };
  }

  async subscribeTask(ref: AgentTaskRef, handlers: AgentTaskEventHandlers): Promise<UnlistenFn> {
    const unlisten = await listen("acp-event", async (event: AcpEvent) => {
      const { run_id, event_type, data } = event.payload;
      if (run_id !== ref.runId) return;

      if (event_type === "assistant") {
        if (handlers.onProgress && data.text) {
          handlers.onProgress({ text: data.text, channel: "assistant" });
        }
        if (handlers.onOutputUpdate && data.text) {
          handlers.onOutputUpdate({ output: data.text, incremental: true });
        }
      } else if (event_type === "lifecycle") {
        if (data.phase === "end" || data.phase === "completed" || data.phase === "success") {
          console.log(`[ACP] 收到结束信号: phase=${data.phase}, run_id=${run_id}`);
          if (handlers.onProgress) handlers.onProgress({ text: `[DEBUG] 收到前端结束信号! phase=${data.phase}, 准备获取 output...`, channel: "system" });
          try {
            const output = await invoke<string>("get_task_output", { runId: run_id });
            console.log(`[ACP] 获取到任务输出长度: ${output?.length || 0}`);
            if (handlers.onProgress) handlers.onProgress({ text: `[DEBUG] 成功获取 output, 长度=${output?.length || 0}`, channel: "system" });
            if (handlers.onCompleted) {
              handlers.onCompleted({ output: output || "任务执行完毕，无返回输出。" });
            }
          } catch (error) {
            console.error("[ACP] get_task_output 失败:", error);
            if (handlers.onFailed) {
              handlers.onFailed({ error: String(error), recoverable: false });
            }
          }
        } else if (data.phase === "error") {
          if (handlers.onFailed) {
            handlers.onFailed({ error: data.error || data.message || "任务执行失败。", recoverable: false });
          }
        }
      }
    });
    return unlisten;
  }

  async waitTask(ref: AgentTaskRef, timeoutMs?: number): Promise<AgentTaskSnapshot> {
    void ref;
    void timeoutMs;
    const snapshot = await invoke<{
      status: string;
      output: string;
    }>("get_agent_task_status", { runId: ref.runId });
    return { status: snapshot.status, output: snapshot.output || undefined };
  }

  async abortTask(ref: AgentTaskRef): Promise<AgentAbortResult> {
    try {
      await invoke("abort_agent_task", { runId: ref.runId });
      return { success: true };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  }
}
