"use client";

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { FunctionResponse } from "@google/genai";
import { Mic, MicOff, RotateCw, Terminal, Eraser } from "lucide-react";
import { SmartOrb } from "@/components/SmartOrb";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GeminiLiveClient, type LiveMessage } from "@/lib/gemini-live";
import { runGeminiLiveSelfTest } from "@/lib/gemini-live-self-test";
import { AcpProviderAdapter } from "@/lib/providers/acp-provider";
import type { AgentProviderAdapter, AgentRuntimeProfile } from "@/lib/agent-provider";

type VoiceStatus = "idle" | "listening" | "thinking" | "speaking";
type ToolCall = NonNullable<LiveMessage["toolCall"]>;

export type ProviderOption = {
  id: string;
  name: string;
  adapter: AgentProviderAdapter;
};

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

class AudioStreamer {
  private context: AudioContext;
  private nextPlayTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  onDrained?: () => void;

  constructor(context: AudioContext) {
    this.context = context;
  }

  get active() {
    return this.sources.size > 0;
  }

  addPcm16(base64: string) {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const pcm16 = new Int16Array(bytes.buffer);
    const floats = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) floats[i] = pcm16[i] / 32768;

    const buffer = this.context.createBuffer(1, floats.length, 24000);
    buffer.getChannelData(0).set(floats);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    const now = this.context.currentTime;
    if (this.nextPlayTime < now) this.nextPlayTime = now + 0.08;
    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;

    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) {
        this.nextPlayTime = 0;
        this.onDrained?.();
      }
    };
  }

  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch { }
    }
    this.sources.clear();
    this.nextPlayTime = 0;
    this.onDrained?.();
  }
}

function pcm16ToBase64(samples: Int16Array) {
  const bytes = new Uint8Array(samples.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode.apply(null, bytes.slice(i, i + 8192) as unknown as number[]);
  }
  return btoa(binary);
}

function resampleTo16k(input: Float32Array, inputRate: number) {
  if (inputRate === 16000) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const value = Math.max(-1, Math.min(1, input[i]));
      output[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
    }
    return output;
  }

  const ratio = inputRate / 16000;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, input.length - 1);
    const weight = sourceIndex - left;
    const sample = input[left] * (1 - weight) + input[right] * weight;
    const value = Math.max(-1, Math.min(1, sample));
    output[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }

  return output;
}

export default function JilingPage() {
  const [status, setStatusState] = useState<VoiceStatus>("idle");
  const [isConnected, setIsConnected] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [volume, setVolume] = useState(0);
  const [logs, setLogs] = useState<string[]>(["系统就绪，等待语音指令..."]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("openclaw");

  const statusRef = useRef<VoiceStatus>("idle");
  const reconnectWantedRef = useRef(false);
  const startingRef = useRef(false);
  const clientRef = useRef<GeminiLiveClient | null>(null);
  const adapterRef = useRef<AgentProviderAdapter | null>(null);
  const profileRef = useRef<AgentRuntimeProfile | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamerRef = useRef<AudioStreamer | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const setStatus = (next: VoiceStatus) => {
    statusRef.current = next;
    setStatusState(next);
  };

  const addLog = (message: string) => {
    setLogs((previous) => [...previous.slice(-80), `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const stopMic = () => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setVolume(0);
  };

  const closeAudioContext = async () => {
    streamerRef.current?.stop();
    streamerRef.current = null;

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => {});
    }
  };

  const cleanupAudio = async () => {
    stopMic();
    await closeAudioContext();
  };

  const startMic = async (context: AudioContext) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    mediaStreamRef.current = stream;

    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 1, 1);
    sourceRef.current = source;
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      setVolume(Math.sqrt(sum / input.length));

      if (statusRef.current === "idle") return;

      const pcm16 = resampleTo16k(input, event.inputBuffer.sampleRate);
      clientRef.current?.sendAudio(pcm16ToBase64(pcm16));
    };

    source.connect(processor);
    processor.connect(context.destination);
  };

  const createClient = (profile?: AgentRuntimeProfile) =>
    new GeminiLiveClient({
      onLog: addLog,
      onError: (error) => addLog(`[Live] 通信异常: ${errorMessage(error)}`),
      onClose: () => {
        setIsConnected(false);
        clientRef.current = null;
        if (reconnectWantedRef.current && statusRef.current !== "idle") {
          addLog("[系统] 连接断开，准备重连...");
          window.setTimeout(() => {
            startConversation().catch((error) => addLog(`[系统] 重连失败: ${errorMessage(error)}`));
          }, 350);
        }
      },
      onMessage: (message) => handleLiveMessage(message),
    }, profile);

  useEffect(() => {
    const probeProviders = async () => {
      try {
        const home = await import("@tauri-apps/api/path").then(m => m.homeDir());
        const { exists } = await import("@tauri-apps/plugin-fs");
        const detected: ProviderOption[] = [];
        
        if (await exists(home + "/.openclaw")) {
          detected.push({ id: "openclaw", name: "OpenClaw", adapter: new AcpProviderAdapter("openclaw", "OpenClaw", ".openclaw") });
        }
        if (await exists(home + "/.openclaw-autoclaw")) {
          detected.push({ id: "autoclaw", name: "AutoClaw", adapter: new AcpProviderAdapter("autoclaw", "AutoClaw", ".openclaw-autoclaw") });
        }
        if (await exists(home + "/.hermes")) {
          detected.push({ id: "hermes", name: "Hermes", adapter: new AcpProviderAdapter("hermes", "Hermes", ".hermes") });
        }
        
        if (detected.length > 0) {
          setProviders(detected);
          setSelectedProviderId(detected[0].id);
        }
      } catch (e) {
        console.error("Provider detection failed", e);
      }
    };
    probeProviders();
  }, []);

  const startConversation = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setIsBusy(true);

    try {
      await cleanupAudio();
      const context = new AudioContext();
      audioContextRef.current = context;

      const streamer = new AudioStreamer(context);
      streamer.onDrained = () => {
        if (statusRef.current === "speaking") setStatus("listening");
      };
      streamerRef.current = streamer;

      let profile: AgentRuntimeProfile | undefined;
      const selected = providers.find(p => p.id === selectedProviderId);
      if (selected) {
        adapterRef.current = selected.adapter;
        profile = await selected.adapter.agentProfile();
        profileRef.current = profile;
        addLog(`[系统] 使用 Provider: ${selected.name}`);
      }

      const client = createClient(profile);
      clientRef.current = client;
      reconnectWantedRef.current = true;
      await client.connect();
      await startMic(context);

      setIsConnected(true);
      setStatus("listening");
      addLog("[系统] 语音会话已就绪");
    } finally {
      startingRef.current = false;
      setIsBusy(false);
    }
  };

  const stopConversation = async () => {
    reconnectWantedRef.current = false;
    setIsBusy(true);
    setStatus("idle");
    setIsConnected(false);

    try {
      stopMic();
      await clientRef.current?.closeGracefully(3000);
      clientRef.current = null;
      await closeAudioContext();
      addLog("[系统] 交互已停止");
    } finally {
      setIsBusy(false);
    }
  };

  const forceReconnect = async () => {
    if (!clientRef.current || isBusy) return;
    setIsBusy(true);
    reconnectWantedRef.current = true;
    addLog("[测试] 强制断开并走 sessionResumption 重连...");

    try {
      stopMic();
      await clientRef.current.closeGracefully(5000);
    } finally {
      setIsBusy(false);
    }
  };

  const clearContext = () => {
    if (!selectedProviderId) return;
    GeminiLiveClient.clearStoredHandle(selectedProviderId);
    addLog(`[系统] 已清除 ${selectedProviderId} 的上下文记忆。下次对话将重新开始。`);
  };

  const runSelfTest = async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await runGeminiLiveSelfTest(addLog);
    } catch (error: unknown) {
      addLog(`[自检] FAIL: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleLiveMessage = (message: LiveMessage) => {
    const content = message.serverContent;
    if (content) {
      if (content.interrupted) {
        streamerRef.current?.stop();
        setStatus("listening");
        addLog("[Live] AI 被打断");
      }

      const parts = content.modelTurn?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          setStatus("speaking");
          streamerRef.current?.addPcm16(part.inlineData.data);
        }
      }

      if (content.inputTranscription?.text) {
        addLog(`用户: ${content.inputTranscription.text}`);
      }

      if (content.outputTranscription?.text) {
        addLog(`${profileRef.current?.displayName || "Agent"}: ${content.outputTranscription.text}`);
      }

      if (content.turnComplete && !streamerRef.current?.active && statusRef.current === "speaking") {
        setStatus("listening");
      }
    }

    if (message.toolCall) {
      setStatus("thinking");
      handleToolCall(message.toolCall).catch((error) => addLog(`[工具] 异常: ${errorMessage(error)}`));
    }

    if (message.setupComplete) {
      addLog("[Live] setupComplete");
    }
  };

  const handleToolCall = async (toolCall: ToolCall) => {
    const functionResponses: FunctionResponse[] = [];

    for (const call of toolCall.functionCalls || []) {
      if (!call.name) continue;
      addLog(`[工具] 执行 ${call.name}`);
      try {
        const args: Record<string, unknown> = {};
        const callArgs = call.args || {};
        for (const key of Object.keys(callArgs)) {
          args[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] = callArgs[key];
        }
        let result;
        if (call.name === "execute_agent_acp_task" && adapterRef.current) {
          const runId = await adapterRef.current.submitTask({
            identity: { systemName: "机灵", runtimeRoleDescription: profileRef.current?.roleDescription || "", mode: "background_core", userFacingRole: "same_assistant" },
            userRequest: String(callArgs.task),
            conversationContext: { recentUserIntent: String(callArgs.task), locale: "zh-CN" },
            executionPolicy: { askBeforeRiskyChanges: true, preferConciseProgress: false, produceSpeakableSummary: true },
            outputContract: { format: "markdown_with_titles", requireSpeakableSummary: true, requireSpokenReport: true },
          });
          result = runId.runId;
          
          adapterRef.current.subscribeTask(runId, {
            onProgress: (e) => addLog(`[Agent] ${e.text}`),
            onCompleted: (e) => {
              clientRef.current?.sendSystemUpdate(
                `背景任务执行完毕。runId: ${runId.runId}\n\n执行结果如下：\n${typeof e.output === 'string' ? e.output : e.output.detailSummary}\n\n请向用户简要汇报上述结果。`
              );
            },
            onFailed: (e) => addLog(`[任务] 失败: ${e.error}`)
          });
        } else {
          result = await invoke(call.name, args);
        }
        functionResponses.push({ name: call.name, id: call.id, response: { result } });
      } catch (error) {
        functionResponses.push({ name: call.name, id: call.id, response: { error: String(error) } });
      }
    }

    clientRef.current?.sendToolResponse(functionResponses);
    setStatus("listening");
  };

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [logs]);

  useEffect(() => {
    let mounted = true;

    return () => {
      mounted = false;
      reconnectWantedRef.current = false;
      stopMic();
      clientRef.current?.closeNow();
      audioContextRef.current?.close().catch(() => {});
    };
  }, []);

  const statusText =
    status === "idle" ? "准备就绪" :
    status === "listening" ? "正在倾听" :
    status === "thinking" ? "正在执行" :
    "正在回答";

  return (
    <main className="h-screen w-full bg-[#0b0b0f] text-white flex flex-col p-6 overflow-hidden">
      <header className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg tracking-[0.28em] uppercase text-white/90">Jiling / 机灵</h1>
          <p className="text-xs text-slate-500 mt-1">{statusText}</p>
        </div>
        <div className="flex items-center gap-4">
          {providers.length > 0 && (
            <select
              disabled={isBusy || isConnected}
              value={selectedProviderId}
              onChange={(e) => setSelectedProviderId(e.target.value)}
              className="bg-black/50 border border-white/10 text-white/80 text-sm rounded-md px-2 py-1 outline-none focus:border-white/30"
            >
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <div className={`h-2.5 w-2.5 rounded-full ${isConnected ? "bg-emerald-400" : "bg-slate-600"}`} />
        </div>
      </header>

      <section className="flex-1 min-h-0 flex flex-col items-center justify-center gap-10">
        <SmartOrb volume={volume} status={status} />

        <div className="flex items-center gap-4 rounded-full border border-white/10 bg-white/3 p-2">
          <Button
            onClick={clearContext}
            title="清除记忆 (清空上下文)"
            className="h-12 w-12 rounded-full bg-slate-500/10 text-slate-300 border border-slate-500/20 hover:bg-slate-500/20"
          >
            <Eraser className="h-5 w-5" />
          </Button>

          <Button
            disabled={isBusy}
            onClick={isConnected ? forceReconnect : runSelfTest}
            title={isConnected ? "强制重连" : "Live 恢复自检"}
            className="h-12 w-12 rounded-full bg-yellow-500/10 text-yellow-300 border border-yellow-500/20 hover:bg-yellow-500/20"
          >
            {isConnected ? <RotateCw className="h-5 w-5" /> : <Terminal className="h-5 w-5" />}
          </Button>

          <Button
            disabled={isBusy}
            onClick={isConnected ? stopConversation : startConversation}
            className={`h-16 w-16 rounded-full ${
              isConnected
                ? "bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30"
                : "bg-blue-600 hover:bg-blue-500"
            }`}
          >
            {isConnected ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
          </Button>
        </div>
      </section>

      <footer className="shrink-0">
        <div className="mx-auto max-w-4xl overflow-hidden rounded-lg border border-white/10 bg-black/50">
          <div className="border-b border-white/10 px-4 py-2 text-[10px] uppercase tracking-widest text-slate-500">
            Console Output
          </div>
          <ScrollArea className="h-36 px-4 py-3 font-mono text-[11px] leading-relaxed text-slate-400">
            {logs.map((log, index) => (
              <div key={`${index}-${log}`} className="mb-1">
                <span className="mr-2 text-blue-500/60">›</span>
                {log}
              </div>
            ))}
            <div ref={logEndRef} />
          </ScrollArea>
        </div>
      </footer>
    </main>
  );
}
