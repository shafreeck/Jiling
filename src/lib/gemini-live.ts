import { GoogleGenAI, Modality, Type } from "@google/genai";
import { invoke } from "@tauri-apps/api/core";

type LiveCallbacks = {
  onMessage: (message: any) => void;
  onError: (error: any) => void;
  onLog: (message: string) => void;
  onClose: (event: any) => void;
};

const MODEL = "gemini-3.1-flash-live-preview";
const HANDLE_KEY = "gemini_resumption_token";

function handleLabel(handle: string | null) {
  if (!handle) return "<none>";
  return `${handle.slice(0, 8)}...${handle.slice(-8)}`;
}

export class GeminiLiveClient {
  private static ai: GoogleGenAI | null = null;
  private session: any = null;
  private callbacks: LiveCallbacks;
  private lastAudioAt = 0;
  private lastHandleAt = 0;
  private latestHandle: string | null = null;
  private handleWaiters: Array<() => void> = [];

  constructor(callbacks: LiveCallbacks) {
    this.callbacks = callbacks;
  }

  static getStoredHandle() {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(HANDLE_KEY);
  }

  static setStoredHandle(handle: string | null) {
    if (typeof window === "undefined") return;
    if (handle) {
      localStorage.setItem(HANDLE_KEY, handle);
    } else {
      localStorage.removeItem(HANDLE_KEY);
    }
  }

  static clearStoredHandle() {
    GeminiLiveClient.setStoredHandle(null);
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
    const handle = GeminiLiveClient.getStoredHandle();

    this.callbacks.onLog(
      handle
        ? `[Live] resume with handle ${handleLabel(handle)}`
        : "[Live] start new resumable session"
    );

    this.session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: handle ? { handle } : {},
        systemInstruction: {
          parts: [
            {
              text: `你叫“机灵”(Jiling)，是一个运行在 macOS 上的中文语音助手。
你需要准确记住本轮对话里用户刚刚说过的事实、口令和偏好。
任务执行是异步的。调用 execute_agent_acp_task 后，只告知用户已提交后台处理，不要编造结果。
任务完成后，系统会发来结果，再自然简要地播报。`,
            },
          ],
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
        onmessage: (message: any) => this.handleMessage(message),
        onerror: (error: any) => {
          this.callbacks.onLog(`[Live] error: ${error.message || error}`);
          this.callbacks.onError(error);
        },
        onclose: (event: any) => {
          this.callbacks.onLog(`[Live] close: ${event.code} ${event.reason || ""}`);
          this.session = null;
          if (event.code === 1008) {
            GeminiLiveClient.clearStoredHandle();
            this.callbacks.onLog("[Live] handle rejected, cleared stored handle");
          }
          this.callbacks.onClose(event);
        },
      },
    });
  }

  private handleMessage(message: any) {
    const update = message.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle) {
      this.latestHandle = update.newHandle;
      this.lastHandleAt = Date.now();
      GeminiLiveClient.setStoredHandle(update.newHandle);
      this.callbacks.onLog(`[Live] newHandle ${handleLabel(update.newHandle)}`);
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

  sendToolResponse(functionResponses: any[]) {
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
      let timeout: number;
      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timeout);
        this.handleWaiters = this.handleWaiters.filter((waiter) => waiter !== finish);
        resolve();
      };

      timeout = window.setTimeout(finish, timeoutMs);
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
    } catch (error: any) {
      this.callbacks.onLog(`[Live] graceful close skipped: ${error.message || error}`);
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
