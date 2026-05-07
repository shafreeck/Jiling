import {
  GoogleGenAI,
  Modality,
  Type,
  type FunctionResponse,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import { invoke } from "@tauri-apps/api/core";
import type { AgentRuntimeProfile } from "./agent-provider";

type LiveCallbacks = {
  onMessage: (message: LiveMessage) => void;
  onError: (error: unknown) => void;
  onLog: (message: string) => void;
  onClose: (event: LiveCloseEvent) => void;
};

export type LiveCloseEvent = {
  code?: number;
  reason?: string;
};

export type LiveMessage = LiveServerMessage;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const MODEL = "gemini-3.1-flash-live-preview";

function handleLabel(handle: string | null) {
  if (!handle) return "<none>";
  return `${handle.slice(0, 8)}...${handle.slice(-8)}`;
}

export class GeminiLiveClient {
  private static ai: GoogleGenAI | null = null;
  private session: Session | null = null;
  public voiceName: string = "Kore";
  private callbacks: LiveCallbacks;
  private lastAudioAt = 0;
  private lastHandleAt = 0;
  private latestHandle: string | null = null;
  private handleWaiters: Array<() => void> = [];

  private profile: AgentRuntimeProfile;

  constructor(callbacks: LiveCallbacks, profile?: AgentRuntimeProfile) {
    this.callbacks = callbacks;
    this.profile = profile || {
      providerId: "default",
      roleDescription: "用户本机上的默认 AI Agent。",
      speakingStyle: "自然、简洁、明确的中文。",
      source: "default",
    };
  }

  static getStoredHandle(providerId: string) {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(`jiling_gemini_live_handle_${providerId}`);
  }

  static setStoredHandle(providerId: string, handle: string | null) {
    if (typeof window === "undefined") return;
    if (handle) {
      localStorage.setItem(`jiling_gemini_live_handle_${providerId}`, handle);
    } else {
      localStorage.removeItem(`jiling_gemini_live_handle_${providerId}`);
    }
  }

  static clearStoredHandle(providerId: string) {
    GeminiLiveClient.setStoredHandle(providerId, null);
  }

  private async getAi() {
    if (!GeminiLiveClient.ai) {
      const apiKey = await invoke<string>("get_api_key");
      if (!apiKey) throw new Error("API Key not found");
      GeminiLiveClient.ai = new GoogleGenAI({ apiKey });
    }
    return GeminiLiveClient.ai;
  }

  async connect() {
    const ai = await this.getAi();
    const handle = GeminiLiveClient.getStoredHandle(this.profile.providerId);

    this.callbacks.onLog(
      handle
        ? `[Live] resume with handle ${handleLabel(handle)}`
        : "[Live] start new resumable session"
    );

    const displayName = this.profile.displayName ? `名为“${this.profile.displayName}”` : "运行在 macOS 上";
    
    const maleVoices = ["Puck", "Charon", "Fenrir", "Sadaltager", "Orus", "Zephyr", "Iapetus", "Umbriel", "Algieba", "Achird", "Algenib", "Gacrux", "Zubenelgenubi", "Alnilam"];
    const isMale = maleVoices.includes(this.voiceName);
    const genderText = isMale ? "男性" : "女性";
    const isNone = this.voiceName === "none";

    const systemInstructionText = `你是一个本地 AI Agent。
请务必使用标准、纯正、地道的中文普通话进行语音对话。你的发音应当自然、流畅，表现得像一个土生土长的中国${genderText}，严禁带有任何不自然的“外国口音”或机械感。

你应当始终遵循 <IDENTITY> 和 <SOUL> 设定的角色身份与用户对话。
如果用户问“你是谁”，请按 <IDENTITY> 的设定回答。

${this.profile.identityContext ? `<IDENTITY>\n${this.profile.identityContext}\n</IDENTITY>\n` : ""}
${this.profile.soulContext ? `<SOUL>\n${this.profile.soulContext}\n</SOUL>\n` : ""}
${this.profile.userContext ? `<USER>\n${this.profile.userContext}\n</USER>\n` : ""}

你有两个执行形态：实时语音外壳（即现在的你）和后台任务内核。
当需要长任务、代码、文件操作时，调用 execute_agent_acp_task 进入后台模式。
你不能把后台执行者表达成另一个助手，那是你的后台形态。
调用 execute_agent_acp_task 后，只告知用户已提交后台处理，不要编造结果。
任务完成后，系统会注入结果，你再自然简要地播报。`;

    this.callbacks.onLog("=== 注入的身份上下文 ===");
    this.callbacks.onLog(systemInstructionText);
    this.callbacks.onLog("========================");

    this.session = await ai.live.connect({
      model: MODEL,
      config: {
        generationConfig: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            languageCode: "cmn-CN",
            ...(!isNone ? {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: this.voiceName },
              },
            } : {}),
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: handle ? { handle } : {},
        systemInstruction: {
          parts: [{ text: systemInstructionText }],
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: "execute_agent_acp_task",
                description: "执行本地 AI 代理处理复杂任务。",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    agent: { type: Type.STRING, description: "代理 ID，必须设为 main" },
                    task: { type: Type.STRING, description: "需要代理执行的任务描述" },
                  },
                  required: ["agent", "task"],
                },
              },
              {
                name: "abort_agent_task",
                description: "中止正在运行的本地代理任务。",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    run_id: { type: Type.STRING, description: "任务 runId" },
                  },
                  required: ["run_id"],
                },
              },
              {
                name: "capture_screen",
                description: "捕获当前屏幕截图。",
                parameters: { type: Type.OBJECT, properties: {} },
              },
            ],
          },
        ],
      },
      callbacks: {
        onopen: () => this.callbacks.onLog("[Live] websocket open"),
        onmessage: (message: LiveMessage) => this.handleMessage(message),
        onerror: (error: unknown) => {
          this.callbacks.onLog(`[Live] error: ${errorMessage(error)}`);
          this.callbacks.onError(error);
        },
        onclose: (event: LiveCloseEvent) => {
          this.callbacks.onLog(`[Live] close: ${event.code} ${event.reason || ""}`);
          this.session = null;
          if (event.code === 1008) {
            GeminiLiveClient.clearStoredHandle(this.profile.providerId);
            this.callbacks.onLog("[Live] handle rejected, cleared stored handle");
          }
          this.callbacks.onClose(event);
        },
      },
    });
  }

  private handleMessage(message: LiveMessage) {
    const update = message.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle) {
      this.latestHandle = update.newHandle;
      this.lastHandleAt = Date.now();
      GeminiLiveClient.setStoredHandle(this.profile.providerId, update.newHandle);
      this.resolveHandleWaiters();
    }

    this.callbacks.onMessage(message);
  }

  sendAudio(base64Pcm16: string) {
    if (!this.session) return;
    this.lastAudioAt = Date.now();
    this.session.sendRealtimeInput({
      audio: {
        data: base64Pcm16,
        mimeType: "audio/pcm;rate=16000",
      },
    });
  }

  sendToolResponse(functionResponses: FunctionResponse[]) {
    this.session?.sendToolResponse({ functionResponses });
  }

  sendSystemUpdate(text: string) {
    this.session?.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true,
    });
  }

  private endAudioStream() {
    this.session?.sendRealtimeInput({ audioStreamEnd: true });
  }

  markAudioStreamEnd() {
    this.endAudioStream();
  }

  private resolveHandleWaiters() {
    const waiters = this.handleWaiters.splice(0);
    for (const waiter of waiters) waiter();
  }

  private waitForHandleAfter(timestamp: number, timeoutMs: number) {
    if (timestamp === 0 || this.lastHandleAt >= timestamp) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timeout);
        this.handleWaiters = this.handleWaiters.filter((waiter) => waiter !== finish);
        resolve();
      };
      const timeout = window.setTimeout(finish, timeoutMs);

      this.handleWaiters.push(finish);
    });
  }

  async closeGracefully(timeoutMs = 5000) {
    if (!this.session) return;
    const audioCutoff = this.lastAudioAt;
    try {
      this.callbacks.onLog("[Live] ending audio stream before close");
      this.endAudioStream();
      await this.waitForHandleAfter(audioCutoff, timeoutMs);
      this.callbacks.onLog(`[Live] close with stored handle ${handleLabel(this.latestHandle)}`);
    } catch (error: unknown) {
      this.callbacks.onLog(`[Live] graceful close skipped: ${errorMessage(error)}`);
    }
    try {
      this.session.close();
    } catch {
      this.session = null;
    }
  }

  closeNow() {
    if (!this.session) return;
    try {
      this.session.close();
    } catch {
      this.session = null;
    }
  }
}
