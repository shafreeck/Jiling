import { invoke } from "@tauri-apps/api/core";

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private url: string;
  private model: string;
  private onMessage: (msg: any) => void;
  private onError: (err: any) => void;
  private onLog: (msg: string) => void;

  constructor(
    onMessage: (msg: any) => void,
    onError: (err: any) => void,
    onLog: (msg: string) => void,
    model: string = "gemini-3.1-flash-live-preview"
  ) {
    this.onMessage = onMessage;
    this.onError = onError;
    this.onLog = onLog;
    this.model = model;
    this.url = ""; // Will be set in connect()
  }

  async connect() {
    try {
      const apiKey = await invoke<string>("get_api_key");
      if (!apiKey) throw new Error("API Key 为空");

      this.url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      
      this.onLog(`正在尝试连接 (API Key 已就绪)...`);
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.onLog("WebSocket 已连接");
        // 拨乱反正：根据服务器报错，顶级键名必须是 setup
        const configMessage = {
          setup: {
            model: `models/${this.model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
            },
            systemInstruction: {
              parts: [{ text: `你叫“机灵”(Jiling)，是一个运行在 macOS 上的超强 AI 助手。
你拥有以下核心技能：
1. 捕获屏幕 (capture_screen)：当你需要“看见”用户的屏幕内容来提供帮助时调用。
2. 执行本地代理 (execute_agent_acp_task)：处理复杂的网页操作、代码编写或长时间思考的任务。agent 始终设为 "main"。
3. 中止代理任务 (abort_agent_task)：当用户明确要求停止、取消或重做某个正在进行的后台任务时调用。

交互准则：
- 任务执行是异步的，提交后请告知用户“正在处理，结果出来后我会告诉你”。
- 你的播报应在任务完成后自然发生，或者在静默期插入。
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
        this.send(configMessage);
        this.onLog("配置消息已发送");
      };

      this.ws.onmessage = async (event) => {
        try {
          let data = event.data;
          if (data instanceof Blob) {
            data = await data.text();
          }
          const response = JSON.parse(data);
          this.onMessage(response);
        } catch (e) {
          this.onLog(`解析消息失败: ${e} (Data type: ${typeof event.data})`);
        }
      };

      this.ws.onerror = (error) => {
        this.onError(error);
      };

      this.ws.onclose = (event) => {
        this.onLog(`连接已关闭: Code=${event.code}, Reason=${event.reason || "无"}`);
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
    // 虽然文档 JS 示例没写，但 Bidi 参考提到了 clientContent 模式用于打断
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
