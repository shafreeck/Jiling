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

  static resetApiClient() {
    GeminiLiveClient.ai = null;
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

    const maleVoices = ["Puck", "Charon", "Fenrir", "Sadaltager", "Orus", "Zephyr", "Iapetus", "Umbriel", "Algieba", "Achird", "Algenib", "Gacrux", "Zubenelgenubi", "Alnilam"];
    const isMale = maleVoices.includes(this.voiceName);
    const isNone = this.voiceName === "none";

    const systemInstructionText = `## Persona
${this.profile.identityContext ? this.profile.identityContext : "You are Jiling, a professional, witty, and highly capable local AI assistant."}
${this.profile.soulContext ? `\n### Soul and Style\n${this.profile.soulContext}` : ""}

## Your Role as a Voice Shell
You are the multimodal voice interface (shell) for the user's local computing environment. Your primary goal is to provide a seamless, natural, and helpful voice experience. 

## The Delegation Principle (CRITICAL)
Your background reasoning core (Agent) is far more powerful than your current voice shell.
- **NEVER** attempt to solve complex reasoning, file operations, coding tasks, or deep knowledge queries using only your voice shell's internal knowledge.
- **ALWAYS** delegate these tasks immediately to the background agent via \`execute_agent_acp_task\`.
- If the user asks about your capabilities, refer to the capabilities of your background agent.
- You are a single entity with two forms: the voice you are using now (shell) and your background execution form (core).

## Conversational Rules
1. **Language Policy**: Always respond in the same language the user is speaking. YOU MUST RESPOND UNMISTAKABLY in the detected language (e.g., if the user speaks Chinese, respond in natural Mandarin Chinese).
2. **Native Prosody**: Use natural, native accents and intonation.
3. **Ignore Symbols**: Do NOT read out loud any emojis, decorative symbols (e.g., 🔮, 💨), or stage directions (e.g., [thinking]). Use your tone and pauses to convey the emotion instead.
4. **No Platitudes**: Be concise and avoid repeating back what the user said unless necessary for confirmation.
5. **Context Awareness**: You have access to a real-time video stream (if enabled). Use it to understand what the user is referring to (e.g., "this file", "this window").

## Guardrails
- If a background task is running, tell the user it is being processed. NEVER fake or guess the result. 
- You can only report results once you receive the explicit system event "Background task completed".
- When interrupted, stop speaking immediately and listen.`;

    this.callbacks.onLog("=== Injected English System Instruction ===");
    this.callbacks.onLog(systemInstructionText);
    this.callbacks.onLog("========================");

    this.session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          languageCode: "cmn-CN", // Primary hint, but SI handles adaptation
          ...(!isNone ? {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: this.voiceName },
            },
          } : {}),
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: handle ? { handle } : {},
        systemInstruction: {
          parts: [{ text: systemInstructionText }],
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: "execute_agent_acp_task",
                description: "Submit a background task for the AI agent to execute. **Invocation Condition:** Use this tool for ANY task involving reasoning, coding, file operations, long-running processes, or when user's intent requires more than a simple verbal answer. It is preferred to use this tool over answering directly for domain-specific queries.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    agent: { type: Type.STRING, description: "Agent ID, MUST be set to 'main'" },
                    task: { type: Type.STRING, description: "Description of the task to be executed in the background" },
                  },
                  required: ["agent", "task"],
                },
              },
              {
                name: "get_agent_task_status",
                description: "Query the status and output of a background task. **Invocation Condition:** Invoke this tool when the user asks about progress, completion, or results of a previously submitted task. Do NOT guess the status.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    run_id: { type: Type.STRING, description: "The runId of the task" },
                  },
                  required: ["run_id"],
                },
              },
              {
                name: "abort_agent_task",
                description: "Request to terminate a running background task. **Invocation Condition:** Invoke this tool ONLY when the user explicitly asks to stop, cancel, or abort a specific background task.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    run_id: { type: Type.STRING, description: "The runId of the task" },
                  },
                  required: ["run_id"],
                },
              },
              {
                name: "capture_screen",
                description: "Capture a high-resolution screenshot of the current screen. **Invocation Condition:** Invoke this tool when you need precise visual confirmation of UI details, text on screen, or when the user refers to something specific that isn't clear from the video stream (e.g., 'look at this line of code').",
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

  sendVideo(base64Image: string) {
    if (!this.session) return;
    // Note: Multimodal Live API expects frames as image/jpeg or image/png media chunks
    // The SDK might call it 'mediaChunks' or 'video' depending on version, 
    // Note: Multimodal Live API expects frames as image/jpeg or image/png media chunks
    // In the JS SDK, this is passed via the 'video' property.
    this.session.sendRealtimeInput({
      video: {
        data: base64Image,
        mimeType: "image/jpeg",
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
