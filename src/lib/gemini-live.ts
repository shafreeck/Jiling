import { GoogleGenAI, Modality } from "@google/genai";
import { invoke } from "@tauri-apps/api/core";

/**
 * GeminiLiveClient - 稳健版 (基于突破性实验成功经验)
 */
export class GeminiLiveClient {
  private static aiInstance: any = null;
  private session: any;
  private model: string;
  private onMessage: (message: any) => void;
  private onError: (error: any) => void;
  private onLog: (log: string) => void;
  private onClose: () => void;

  private static resumptionToken: string | null = null;

  constructor(
    onMessage: (message: any) => void,
    onError: (error: any) => void,
    onLog: (log: string) => void,
    onClose: () => void,
    model: string = "gemini-3.1-flash-live-preview"
  ) {
    this.onMessage = onMessage;
    this.onError = onError;
    this.onLog = onLog;
    this.onClose = onClose;
    this.model = model;
  }

  static getResumptionToken(): string | null {
    if (typeof window !== 'undefined' && !GeminiLiveClient.resumptionToken) {
      GeminiLiveClient.resumptionToken = localStorage.getItem("gemini_resumption_token");
    }
    return GeminiLiveClient.resumptionToken;
  }

  static setResumptionToken(token: string | null) {
    GeminiLiveClient.resumptionToken = token;
    if (typeof window !== 'undefined') {
      if (token) localStorage.setItem("gemini_resumption_token", token);
      else localStorage.removeItem("gemini_resumption_token");
    }
  }

  private async getAiClient() {
    if (!GeminiLiveClient.aiInstance) {
      const apiKey = await invoke<string>("get_api_key");
      if (!apiKey) throw new Error("API Key not found");
      GeminiLiveClient.aiInstance = new GoogleGenAI({ apiKey });
    }
    return GeminiLiveClient.aiInstance;
  }

  async connect() {
    this.onLog("[SDK] 执行 connect()...");

    try {
      if (this.session) {
        try { this.session.close(); } catch (e) { }
        this.session = null;
      }

      const ai = await this.getAiClient();
      const handle = GeminiLiveClient.getResumptionToken();

      // 核心修正：
      // 1. 无 handle 时传入 {} 明确开启续接
      // 2. 无论何时都传入完整的 systemInstruction 和 tools，确保会话被视为“活跃且有意义”的。
      const config: any = {
        responseModalities: [Modality.AUDIO],
        sessionResumption: handle ? { handle: handle } : {},
        systemInstruction: {
          parts: [{ text: "你是一个助手，请务必用中文回答。" }]
        },
        tools: [{
          functionDeclarations: [
            {
              name: "execute_agent_acp_task",
              description: "执行代理任务",
              parameters: { type: "OBJECT", properties: { agent: { type: "STRING" }, task: { type: "STRING" } } }
            }
          ]
        }]
      };

      if (handle) {
        this.onLog(`[SDK] 携带句柄重连: ${handle.substring(0, 10)}...`);
      } else {
        this.onLog("[SDK] 启动新会话 (Resumption: Enabled)");
      }

      this.session = await ai.live.connect({
        model: this.model,
        callbacks: {
          onopen: () => this.onLog("[SDK] 已连接"),
          onmessage: (msg: any) => {
            // 抓取并保存句柄
            if (msg.sessionResumptionUpdate) {
              const update = msg.sessionResumptionUpdate;
              if (update.resumable && update.newHandle) {
                GeminiLiveClient.setResumptionToken(update.newHandle);
                this.onLog(`[SDK] 句柄更新: ${update.newHandle.substring(0, 10)}...`);
              }
            }
            this.onMessage(msg);
          },
          onerror: (e: any) => {
            this.onLog(`[SDK] 错误: ${e.message}`);
            this.onError(e);
          },
          onclose: (e: any) => {
            this.onLog(`[SDK] 关闭: ${e.code}`);
            
            // 🚨 核心逻辑：如果是因为 1008 (Policy Violation) 关闭，说明 Handle 失效了
            if (e.code === 1008) {
              this.onLog("[SDK] 检测到 Handle 失效 (1008)，正在重置并尝试全新连接...");
              GeminiLiveClient.setResumptionToken(null); 
            }

            this.session = null;
            this.onClose();
          }
        },
        config: config
      });

    } catch (error: any) {
      this.onLog(`[SDK] 异常: ${error.message}`);
      this.session = null;
      this.onError(error);
    }
  }

  sendAudio(base64Data: string) {
    if (!this.session) return;
    this.session.sendRealtimeInput({
      audio: { data: base64Data, mimeType: "audio/pcm;rate=16000" }
    });
  }

  sendToolResponse(responses: any[]) {
    if (!this.session) return;
    this.session.sendToolResponse({ functionResponses: responses });
  }

  sendInterruption() { }

  sendSystemUpdate(text: string) {
    if (!this.session) return;
    this.session.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true
    });
  }

  disconnect() {
    if (this.session) {
      try { this.session.close(); } catch (e) { }
      this.session = null;
    }
  }

  testForceClose() {
    if (this.session) {
      this.onLog("[SDK Debug] 手动触发强制断开...");
      try { this.session.close(); } catch (e) { }
    }
  }
}
