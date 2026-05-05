import { invoke } from "@tauri-apps/api/core";

export class GeminiLiveClient {
  public ws: WebSocket | null = null;
  private url: string;
  private model: string;
  private onMessage: (msg: any) => void;
  private onError: (err: any) => void;
  private onLog: (msg: string) => void;
  private onClose: () => void;

  constructor(
    onMessage: (msg: any) => void,
    onError: (err: any) => void,
    onLog: (msg: string) => void,
    onClose: () => void,
    model: string = "gemini-3.1-flash-live-preview"
  ) {
    this.onMessage = onMessage;
    this.onError = onError;
    this.onLog = onLog;
    this.onClose = onClose;
    this.model = model;
    this.url = ""; // Will be set in connect()
  }

  // 静态 Token 存储，优先从本地存储恢复 (兼容原有命名)
  private static getResumptionToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gemini_resumption_token');
    }
    return null;
  }

  private static setResumptionToken(token: string | null) {
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('gemini_resumption_token', token);
      } else {
        localStorage.removeItem('gemini_resumption_token');
      }
    }
  }

  async connect() {
    try {
      const apiKey = await invoke<string>("get_api_key");
      if (!apiKey) throw new Error("API Key 为空");

      // 锁定原有的 v1beta URL
      this.url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      
      this.onLog(`正在尝试连接 (API Key 已就绪)...`);
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.onLog("WebSocket 已连接");
        
        const currentToken = GeminiLiveClient.getResumptionToken();
        const configMessage = {
          setup: {
            model: `models/${this.model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
            },
            contextWindowCompression: {
              slidingWindow: {}
            },
            // 🚨 回归原有字段 sessionResumption / sessionToken，因为 3.1 仅识别此格式
            sessionResumption: currentToken ? {
              sessionToken: currentToken
            } : {},
            systemInstruction: {
              parts: [{ text: `你叫“机灵”(Jiling)，是一个运行在 macOS 上的超强 AI 助手。
交互准则：
- 任务执行是异步的。当你调用 execute_agent_acp_task 后，请仅告知用户“已提交后台处理，请稍等”，**绝对禁止**编造结果。
- 任务完成后，系统会向你发送一条包含结果的系统更新消息。届时请你根据该消息内容自然地向用户播报。
请保持口语化、简洁且高效。` }]
            },
            tools: [{
              function_declarations: [
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
                },
                {
                  name: "capture_screen",
                  description: "捕获当前屏幕截图。",
                  parameters: { type: "OBJECT", properties: {} }
                }
              ]
            }]
          }
        };

        if (currentToken) {
          this.onLog(`[协议] 尝试携带 Token 续接会话: ${currentToken.substring(0, 15)}...`);
        } else {
          this.onLog("正在初始化全新会话...");
        }

        this.send(configMessage);
        this.onLog("配置消息已发送 (Stability Mode)");
      };

      this.ws.onmessage = async (event) => {
        try {
          let data = event.data;
          if (data instanceof Blob) {
            data = await data.text();
          }
          const response = JSON.parse(data);
          
          // 3. 精准捕获 Token (定死为 sessionToken)
          const update = response.sessionResumptionUpdate;
          if (update && update.sessionToken) {
            const token = update.sessionToken;
            const oldToken = GeminiLiveClient.getResumptionToken();
            if (token !== oldToken) {
              GeminiLiveClient.setResumptionToken(token);
              this.onLog(`[协议] ✅ 已更新会话记忆锚点 (Token Saved)`);
            }
          }

          // 4. 监听 GoAway 信号
          if (response.serverContent?.goAway) {
            this.onLog("[协议] 收到服务器 GoAway 信号，主动触发续接...");
            this.ws?.close(); 
          }

          this.onMessage(response);
        } catch (e) {
          this.onLog(`解析消息失败: ${e}`);
        }
      };

      this.ws.onerror = (error) => {
        this.onError(error);
      };

      this.ws.onclose = (event) => {
        this.onLog(`连接已关闭: Code=${event.code}, Reason=${event.reason || "无"}`);
        this.onClose();
        this.onError(new Error(`WebSocket Closed: ${event.code}`));
      };

    } catch (err) {
      this.onError(err);
    }
  }

  private send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  sendAudio(base64Data: string) {
    this.send({
      realtimeInput: {
        audio: {
          data: base64Data,
          mimeType: "audio/pcm;rate=16000"
        }
      }
    });
  }

  sendInterruption() {
    this.send({
      clientContent: {
        turns: [],
        turnComplete: false
      }
    });
  }

  sendToolResponse(functionResponses: any[]) {
    this.send({
      toolResponse: {
        functionResponses: functionResponses
      }
    });
  }

  sendSystemUpdate(text: string) {
    this.send({
      clientContent: {
        turns: [{
          role: "user",
          parts: [{ text: `【重要任务反馈】${text}\n请根据结果向用户播报。` }]
        }],
        turnComplete: true
      }
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
