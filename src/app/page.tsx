"use client";

import { useEffect, useRef, useState } from "react";
import { SmartOrb } from "@/components/SmartOrb";
import { GeminiLiveClient } from "@/lib/gemini-live";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, Mic, MicOff, Settings } from "lucide-react";

// 官方 GitHub 风格的流式播放器
class AudioStreamer {
  private context: AudioContext;
  private nextPlayTime: number = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  public onAllEnded?: () => void;

  constructor(context: AudioContext) {
    this.context = context;
  }

  addChunk(base64: string) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

    const buffer = this.context.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    const now = this.context.currentTime;
    if (this.nextPlayTime < now) {
      this.nextPlayTime = now + 0.1; // 100ms 初始缓冲
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      if (this.activeSources.size === 0 && this.onAllEnded) {
        this.onAllEnded();
      }
    };
  }

  stopAll() {
    this.activeSources.forEach(s => {
      try { s.stop(); } catch (e) {}
    });
    this.activeSources.clear();
    this.nextPlayTime = 0;
  }
}

// 全局单例
let globalClient: GeminiLiveClient | null = null;
let globalStreamer: AudioStreamer | null = null;
let globalContext: AudioContext | null = null;
let globalProcessor: ScriptProcessorNode | null = null;

export default function JilingPage() {
  const [status, _setStatus] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [logs, setLogs] = useState<string[]>(["系统就绪，等待语音指令..."]);
  const [volume, setVolume] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  
  const statusRef = useRef<string>("idle");
  const logEndRef = useRef<HTMLDivElement>(null);

  const setStatus = (s: "idle" | "listening" | "thinking" | "speaking" | ((prev: any) => "idle" | "listening" | "thinking" | "speaking")) => {
    if (typeof s === "function") {
      _setStatus((prev: any) => {
        const next = s(prev);
        statusRef.current = next;
        return next;
      });
    } else {
      _setStatus(s);
      statusRef.current = s;
    }
  };

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-50), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const startInteraction = async (isReconnect = false) => {
    if (isStarting && !isReconnect) return;
    if (!isReconnect) setIsStarting(true);

    try {
      // 彻底清理旧实例
      if (globalClient) globalClient.disconnect();
      
      // 如果是重连，我们不关闭 AudioContext 以避免杂音
      if (!isReconnect) {
        if (globalProcessor) globalProcessor.disconnect();
        if (globalStreamer) globalStreamer.stopAll();
        if (globalContext) await globalContext.close().catch(() => {});
        globalContext = new AudioContext({ sampleRate: 24000 });
        globalStreamer = new AudioStreamer(globalContext);
        globalStreamer.onAllEnded = () => {
          setStatus(prev => prev === "speaking" ? "listening" : prev);
        };
      }

      globalClient = new GeminiLiveClient(
        (msg) => handleGeminiMessage(msg),
        (err) => {
          addLog(`错误: ${err.message || err}`);
          // 如果连接在开启状态下报错，尝试触发重连逻辑
          if (isConnected) handleDisconnect();
        },
        (log) => addLog(log)
      );

      // 劫持 onclose 实现自动重连
      const originalConnect = globalClient.connect.bind(globalClient);
      await originalConnect();
      
      // 获取内部 ws 引用以监听关闭
      const ws = (globalClient as any).ws as WebSocket;
      if (ws) {
        ws.addEventListener("close", (e) => {
          if (e.code === 1008 || e.code === 1001) {
            addLog(`[系统] 会话达到时长限制或连接异常 (Code ${e.code})，准备自动重连...`);
            handleDisconnect();
          }
        });
      }

      if (!isReconnect) {
        globalClient.sendInterruption();
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } 
        });
        const source = globalContext!.createMediaStreamSource(stream);
        const processor = globalContext!.createScriptProcessor(1024, 1, 1);
        globalProcessor = processor;

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
          setVolume(Math.sqrt(sum / inputData.length));
          if (statusRef.current === "speaking" || statusRef.current === "thinking") return;
          const pcm16 = new Int16Array(Math.floor(inputData.length * 16000 / 24000));
          for (let i = 0, j = 0; i < inputData.length && j < pcm16.length; i += 1.5, j++) {
            pcm16[j] = inputData[Math.floor(i)] * 0x7FFF;
          }
          const bytes = new Uint8Array(pcm16.buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 8192) {
            binary += String.fromCharCode.apply(null, bytes.slice(i, i + 8192) as unknown as number[]);
          }
          globalClient?.sendAudio(btoa(binary));
        };

        source.connect(processor);
        processor.connect(globalContext!.destination);
      }

      setIsConnected(true);
      setStatus("listening");
      setIsStarting(false);

    } catch (err) {
      addLog(`失败: ${err}`);
      setIsStarting(false);
      setIsConnected(false);
    }
  };

  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const handleDisconnect = () => {
    if (reconnectTimerRef.current) return;
    
    setIsConnected(false);
    setStatus("idle");
    addLog("[系统] 正在尝试自动恢复会话...");
    
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      startInteraction(true);
    }, 2000); // 2秒后重连
  };

  const handleGeminiMessage = (msg: any) => {
    if (msg.serverContent) {
      const serverContent = msg.serverContent;
      
      if (serverContent.modelTurn?.parts) {
        for (const part of serverContent.modelTurn.parts) {
          if (part.inlineData) {
            setStatus("speaking");
            globalStreamer?.addChunk(part.inlineData.data);
          }
        }
      }

      if (serverContent.turnComplete) {
        addLog("AI 回答完毕，等待用户...");
        setStatus("listening");
      }

      if (serverContent.interrupted) {
        addLog("AI 被用户打断");
        globalStreamer?.stopAll();
        setStatus("listening");
      }

      if (serverContent.inputTranscription) {
        addLog(`用户: ${serverContent.inputTranscription.text}`);
      }
    }

    if (msg.toolCall) {
      setStatus("thinking");
      handleToolCall(msg.toolCall);
    }

    if (msg.setupComplete) {
      addLog("会话初始化完成");
    }
  };

  const handleToolCall = async (toolCall: any) => {
    const functionResponses = [];
    const { invoke } = await import("@tauri-apps/api/core");
    
    for (const fc of toolCall.functionCalls) {
      addLog(`执行工具: ${fc.name}`);
      try {
        // 关键修复：将 Gemini 的 snake_case 参数映射为 Tauri 的 camelCase
        const args: any = {};
        if (fc.args) {
          for (const key in fc.args) {
            const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
            args[camelKey] = fc.args[key];
          }
        }

        const result = await invoke(fc.name, args);
        functionResponses.push({
          name: fc.name,
          id: fc.id,
          response: { result }
        });
      } catch (e) {
        functionResponses.push({
          name: fc.name,
          id: fc.id,
          response: { error: String(e) }
        });
      }
    }
    globalClient?.sendToolResponse(functionResponses);
    setStatus("listening");
  };

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [logs]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    
    const setupListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const { invoke } = await import("@tauri-apps/api/core");
      
      unlisten = await listen("acp-event", async (event: any) => {
        const { run_id, event_type, data } = event.payload;
        
        if (event_type === "assistant") {
          // 实时日志展示
          addLog(`[Agent] ${data.text}`);
        } else if (event_type === "lifecycle") {
          addLog(`[任务状态] ${run_id}: ${data.phase}`);
          
          if (data.phase === "end") {
            addLog(`[对账] 任务已完成，正在提取最终结果...`);
            try {
              const output = await invoke<string>("get_task_output", { runId: run_id });
              if (output && globalClient) {
                addLog(`[语音上报] 正在将结果反馈给 Gemini...`);
                globalClient.sendSystemUpdate(`背景任务执行完毕。runId: ${run_id}\n\n执行结果如下：\n${output}\n\n请向用户简要汇报上述结果。`);
              }
            } catch (e) {
              addLog(`[错误] 提取结果失败: ${e}`);
            }
          }
        }
      });

      // 监听 Tick
      const unlistenTick = await listen("acp-tick", () => {
        // 心跳可视化或静默维持（此处仅记日志或忽略）
        // console.log("ACP Tick received");
      });

      return () => {
        if (unlisten) unlisten();
        unlistenTick();
      };
    };

    const cleanup = setupListener();
    return () => {
      cleanup.then(fn => fn && fn());
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white flex flex-col items-center justify-between p-8 overflow-hidden">
      <div className="w-full flex justify-between items-center z-20">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500" : "bg-blue-500"} animate-pulse`} />
          <h1 className="text-xl font-light tracking-widest uppercase text-white">Jiling / 机灵</h1>
        </div>
        <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/10">
          <Settings className="w-5 h-5 text-slate-400" />
        </Button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-12 z-10">
        <SmartOrb volume={volume} status={status} />
        
        <div className="flex flex-col items-center gap-4">
          <div className="px-6 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md">
            <p className="text-sm font-medium text-blue-300">
              {status === "idle" ? "点击开始交互" : 
               status === "listening" ? "正在倾听..." : 
               status === "thinking" ? "正在执行任务..." : "正在为您解答"}
            </p>
          </div>
          
          <Button 
            disabled={isStarting}
            onClick={isConnected ? () => window.location.reload() : startInteraction}
            className={`w-16 h-16 rounded-full transition-all duration-500 ${
              isConnected ? "bg-red-500/20 border-red-500/50 hover:bg-red-500/30" : "bg-blue-500 hover:bg-blue-600"
            }`}
          >
            {isConnected ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
          </Button>
        </div>
      </div>

      <div className="w-full max-w-2xl h-48 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-4 flex flex-col gap-2 z-20">
        <ScrollArea className="flex-1 font-mono text-[10px] leading-relaxed text-slate-300">
          {logs.map((log, i) => <div key={i}>{log}</div>)}
          <div ref={logEndRef} />
        </ScrollArea>
      </div>
    </main>
  );
}
