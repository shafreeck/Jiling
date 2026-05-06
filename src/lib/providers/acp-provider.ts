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
      roleDescription: "用户本机上的默认 AI Agent。",
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

  async submitTask(task: JilingTaskEnvelope): Promise<AgentTaskRef> {
    // Currently, our ACP backend expects `agent` and `task`
    // We pass `main` as the default agent for now, or read from config
    const runId = await invoke<string>("execute_agent_acp_task", {
      agent: "main",
      task: task.userRequest,
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
      } else if (event_type === "lifecycle") {
        if (data.phase === "end") {
          try {
            const output = await invoke<string>("get_task_output", { runId: run_id });
            if (handlers.onCompleted) {
              handlers.onCompleted({ output: output || "任务执行完毕，无返回输出。" });
            }
          } catch (error) {
            if (handlers.onFailed) {
              handlers.onFailed({ error: String(error), recoverable: false });
            }
          }
        }
      }
    });
    return unlisten;
  }

  async waitTask(ref: AgentTaskRef, timeoutMs?: number): Promise<AgentTaskSnapshot> {
    // For now, rely on events. `waitTask` could wrap a timeout logic over events.
    return { status: "running" };
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
