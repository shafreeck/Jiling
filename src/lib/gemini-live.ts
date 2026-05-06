import { GoogleGenAI } from "@google/genai";
import { invoke } from "@tauri-apps/api/core";

export class GeminiLiveClient {
  private ai: any;
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
    this.ai = null;
  }

  static getResumptionToken(): string | null {
    if (typeof window !== 'undefined' && !GeminiLiveClient.resumptionToken) {
      GeminiLiveClient.resumptionToken = localStorage.getItem("gemini_resumption_token");
    }
    return GeminiLiveClient.resumptionToken;
  }

  static setResumptionToken(token: string) {
    GeminiLiveClient.resumptionToken = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem("gemini_resumption_token", token);
    }
  }

  async connect() {
    try {
      this.onLog("[SDK] 正在建立连接...");
      const apiKey = await invoke<string>("get_api_key");
      
      if (!apiKey) {
        throw new Error("未能从后端获取到有效的 GEMINI_API_KEY");
      }
      
      this.ai = new GoogleGenAI({ apiKey });

      const currentToken = GeminiLiveClient.getResumptionToken();
      if (currentToken) {
        this.onLog(`[SDK] 携带续接令牌 (Token: ${currentToken.substring(0, 10)}...)`);
      }

      const config: any = {
        model: this.model,
        config: {
          responseModalities: ["AUDIO"],
          systemInstruction: {
            parts: [{ text: `你叫“机灵”(Jiling)，是一个运行在 macOS 上的超强 AI 助手。
交互准则：
- 任务执行是异步的。当你调用 execute_agent_acp_task 后，请仅告知用户“已提交后台处理，请稍等”，**绝对禁止**编造结果。
- 任务完成后，系统会向你发送一条包含结果的系统更新消息。届时请你根据该消息内容自然地向用户播报。
请保持口语化、简洁且高效。` }]
          },
          tools: [{
            functionDeclarations: [
              {
                name: "execute_agent_acp_task",
                description: "执行本地 AI 代理处理复杂任务。",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    agent: { type: "STRING", description: "代理 ID，必须设为 'main'" },
                    task: { type: "STRING", description: "需要代理执行的具体任务描述" }
                  },
                  required: ["agent", "task"]
                }
              },
              {
                name: "abort_agent_task",
                description: "中止正在运行的本地代理任务。",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    run_id: { type: "STRING", description: "任务的 runId" }
                  },
                  required: ["run_id"]
                }
              }
            ]
          }],
          sessionResumption: currentToken ? {
            handle: currentToken
          } : {}
        }
      };

      this.session = await this.ai.live.connect({
        ...config,
        callbacks: {
          onopen: () => {
            this.onLog("[SDK] 会话已就绪");
          },
          onmessage: (message: any) => {
            this.handleServerMessage(message);
          },
          onerror: (error: any) => {
            this.onLog(`[SDK] 通信异常: ${error.message || error}`);
            this.onError(error);
          },
          onclose: (event: any) => {
            this.onLog(`[SDK] 会话已关闭: Code=${event.code}`);
            this.onClose();
          }
        }
      });

    } catch (error: any) {
      this.onLog(`[SDK] 连接失败: ${error.message || error}`);
      this.onError(error);
      throw error;
    }
  }

  private handleServerMessage(message: any) {
    if (message.sessionResumptionUpdate) {
      const handle = message.sessionResumptionUpdate.newHandle;
      if (handle) {
        GeminiLiveClient.setResumptionToken(handle);
        // 静音更新日志
      }
    }

    if (message.serverContent?.goAway) {
      this.onLog("[SDK] 收到服务器重定向信号 (GoAway)");
    }

    this.onMessage(message);
  }

  sendAudio(base64Data: string) {
    if (!this.session) return;
    try {
      this.session.sendRealtimeInput({
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: base64Data
        }
      });
    } catch (e) {
      console.error("[SDK] 发送音频失败:", e);
    }
  }

  sendToolResponse(responses: any[]) {
    if (!this.session) return;
    this.session.sendToolResponse({
      functionResponses: responses
    });
  }

  sendInterruption() {
    // 打断当前生成：SDK 会在发送新输入时自动处理大部分情况
  }

  sendSystemUpdate(text: string) {
    if (!this.session) return;
    this.session.sendClientContent({
      turns: [{
        role: "user",
        parts: [{ text }]
      }],
      turnComplete: true
    });
  }

  disconnect() {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
  }
}
