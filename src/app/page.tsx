"use client";

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { FunctionResponse } from "@google/genai";
import { Mic, MicOff, RotateCw, Terminal } from "lucide-react";
import { SmartOrb } from "@/components/SmartOrb";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GeminiLiveClient, type LiveMessage } from "@/lib/gemini-live";
import { runGeminiLiveSelfTest } from "@/lib/gemini-live-self-test";

type VoiceStatus = "idle" | "listening" | "thinking" | "speaking";
type ToolCall = NonNullable<LiveMessage["toolCall"]>;
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

  const statusRef = useRef<VoiceStatus>("idle");
  const reconnectWantedRef = useRef(false);
  const startingRef = useRef(false);
  const clientRef = useRef<GeminiLiveClient | null>(null);
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

      if (statusRef.current !== "listening") return;

      const pcm16 = resampleTo16k(input, event.inputBuffer.sampleRate);
      clientRef.current?.sendAudio(pcm16ToBase64(pcm16));
    };

    source.connect(processor);
    processor.connect(context.destination);
  };

  const createClient = () =>
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
    });

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

      const client = createClient();
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
        addLog(`机灵: ${content.outputTranscription.text}`);
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
        const result = await invoke(call.name, args);
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
    let cleanup: (() => void) | undefined;

    const setupAcpListeners = async () => {
      const unlistenAcp = await listen("acp-event", async (event: AcpEvent) => {
        const { run_id, event_type, data } = event.payload;
        if (event_type === "assistant") {
          addLog(`[Agent] ${data.text}`);
          return;
        }

        if (event_type === "lifecycle") {
          addLog(`[任务状态] ${run_id}: ${data.phase}`);
          if (data.phase === "end") {
            try {
              const output = await invoke<string>("get_task_output", { runId: run_id });
              if (output) {
                clientRef.current?.sendSystemUpdate(
                  `背景任务执行完毕。runId: ${run_id}\n\n执行结果如下：\n${output}\n\n请向用户简要汇报上述结果。`
                );
              }
            } catch (error) {
              addLog(`[任务] 提取结果失败: ${error}`);
            }
          }
        }
      });

      const unlistenTick = await listen("acp-tick", () => {});
      return () => {
        unlistenAcp();
        unlistenTick();
      };
    };

    setupAcpListeners().then((fn) => {
      if (mounted) cleanup = fn;
      else fn();
    });

    return () => {
      mounted = false;
      reconnectWantedRef.current = false;
      cleanup?.();
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
        <div className={`h-2.5 w-2.5 rounded-full ${isConnected ? "bg-emerald-400" : "bg-slate-600"}`} />
      </header>

      <section className="flex-1 min-h-0 flex flex-col items-center justify-center gap-10">
        <SmartOrb volume={volume} status={status} />

        <div className="flex items-center gap-4 rounded-full border border-white/10 bg-white/[0.03] p-2">
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
