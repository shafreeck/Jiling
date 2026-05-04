export interface ToolCall {
  function_calls: Array<{
    name: string;
    args: any;
    id: string;
  }>;
}

export interface LiveAPIConfig {
  apiKey: string;
  model?: string;
}

export class GeminiLiveClient {
  private socket: WebSocket | null = null;
  private apiKey: string;
  private model: string;
  private onMessageCallback?: (msg: any) => void;

  constructor(config: LiveAPIConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || "gemini-2.0-flash-exp";
  }

  async connect() {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenericService/BidiGenerateContent?key=${this.apiKey}`;
    this.socket = new WebSocket(url);

    return new Promise((resolve, reject) => {
      this.socket!.onopen = () => {
        console.log("Gemini Live Connected");
        this.sendSetup();
        resolve(true);
      };
      this.socket!.onerror = (err) => reject(err);
      this.socket!.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (this.onMessageCallback) this.onMessageCallback(data);
      };
    });
  }

  private sendSetup() {
    const setupMsg = {
      setup: {
        model: `models/${this.model}`,
        generation_config: {
          response_modalities: ["AUDIO"],
        },
        tools: [
          {
            function_declarations: [
              {
                name: "execute_agent",
                description: "在电脑上执行本地 AI Agent 指令（如 openclaw, codex）来完成复杂任务。",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    agent: { type: "STRING", description: "Agent 名称，例如 'openclaw' 或 'codex'" },
                    task: { type: "STRING", description: "要执行的具体任务描述" },
                  },
                  required: ["agent", "task"],
                },
              },
            ],
          },
        ],
      },
    };
    this.socket?.send(JSON.stringify(setupMsg));
  }

  sendAudio(base64Audio: string) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        realtime_input: {
          media_chunks: [{
            mime_type: "audio/pcm",
            data: base64Audio,
          }]
        }
      }));
    }
  }

  sendToolResponse(callId: string, result: any) {
    const response = {
      tool_response: {
        function_responses: [{
          id: callId,
          response: { result },
        }]
      }
    };
    this.socket?.send(JSON.stringify(response));
  }

  onMessage(callback: (msg: any) => void) {
    this.onMessageCallback = callback;
  }

  disconnect() {
    this.socket?.close();
  }
}
