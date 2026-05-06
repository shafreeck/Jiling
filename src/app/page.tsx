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

  const startInteraction = async () => {
    if (isStarting) return;
    setIsStarting(true);

    try {
      // 清理
      if (globalClient) globalClient.disconnect();
      if (globalProcessor) globalProcessor.disconnect();
      if (globalStreamer) globalStreamer.stopAll();
      if (globalContext) await globalContext.close().catch(() => {});
      
      globalContext = new AudioContext({ sampleRate: 24000 });
      globalStreamer = new AudioStreamer(globalContext);
      globalStreamer.onAllEnded = () => {
        setStatus(prev => prev === "speaking" ? "listening" : prev);
      };

      globalClient = new GeminiLiveClient(
        (msg) => handleGeminiMessage(msg),
        (err) => addLog(`通信异常: ${err.message || err}`),
        (log) => addLog(log),
        () => {
          // 只要不是手动点“停止”导致的关闭，且处于连接状态，就尝试重连
          if (statusRef.current !== "idle") {
            addLog(`[系统] 连接断开，正在尝试自动续接...`);
            setTimeout(() => startInteraction(), 1000);
          }
        }
      );

      await globalClient.connect();
      globalClient.sendInterruption(); 
      setIsConnected(true);
      setStatus("listening");
      setIsStarting(false);

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } 
      });
      const source = globalContext.createMediaStreamSource(stream);
      const processor = globalContext.createScriptProcessor(1024, 1, 1); // 文档建议的小切片
      globalProcessor = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
        setVolume(Math.sqrt(sum / inputData.length));

        // 🚨 核心修复：移除 speaking 拦截，允许语音打断信号上传
        if (statusRef.current === "thinking") return;

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
      processor.connect(globalContext.destination);

    } catch (err) {
      addLog(`失败: ${err}`);
      setIsStarting(false);
    }
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
    <main className="h-screen w-full bg-[#0a0a0c] bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent text-white flex flex-col p-6 overflow-hidden font-sans">
      
      {/* 顶栏：状态与名称 */}
      <header className="flex justify-between items-center z-30 mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500" : "bg-blue-600"} shadow-[0_0_15px_rgba(59,130,246,0.5)]`} />
            {isConnected && <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-400 animate-ping" />}
          </div>
          <h1 className="text-lg font-light tracking-[0.3em] uppercase bg-clip-text text-transparent bg-gradient-to-r from-white to-white/40">
            Jiling / 机灵
          </h1>
        </div>
        <div className="flex gap-2">
           <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/5 text-slate-400">
             <Settings className="w-4 h-4" />
           </Button>
        </div>
      </header>

      {/* 核心内容区：Orb 与控制 */}
      <div className="flex-1 relative flex flex-col items-center justify-center gap-10 min-h-0 pb-12">
        {/* 背景光晕 */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="relative z-10 transform scale-110">
          <SmartOrb volume={volume} status={status} />
        </div>

        {/* 状态指示器与控制条 */}
        <div className="z-20 flex flex-col items-center gap-6">
          <div className="px-6 py-1.5 rounded-full border border-white/5 bg-white/[0.03] backdrop-blur-md shadow-inner">
            <span className="text-xs font-medium tracking-wider text-blue-200/80 uppercase">
              {status === "idle" ? "准备就绪" : 
               status === "listening" ? "正在倾听" : 
               status === "thinking" ? "正在执行" : "正在为您解答"}
            </span>
          </div>

          {/* 控制条 */}
          <div className="flex items-center gap-6 p-2 rounded-full border border-white/10 bg-white/[0.02] backdrop-blur-2xl shadow-2xl">
            <Button 
              disabled={!isConnected}
              onClick={() => {
                if (globalClient?.ws) {
                  addLog("[测试] 模拟连接中断，触发续接...");
                  globalClient.ws.close();
                }
              }}
              className="w-12 h-12 rounded-full bg-yellow-500/10 border border-yellow-500/20 hover:bg-yellow-500/20 text-yellow-500 transition-all active:scale-95 flex items-center justify-center"
              title="强制重连测试"
            >
              <Terminal className="w-5 h-5" />
            </Button>

            <Button 
              disabled={isStarting}
              onClick={isConnected ? () => {
                setIsConnected(false);
                setStatus("idle");
                globalClient?.disconnect();
                addLog("交互已停止");
              } : startInteraction}
              className={`w-16 h-16 rounded-full transition-all duration-500 shadow-lg active:scale-90 flex items-center justify-center ${
                isConnected 
                ? "bg-red-500/20 border-2 border-red-500/40 hover:bg-red-500/30 text-red-400" 
                : "bg-gradient-to-tr from-blue-600 to-indigo-500 hover:shadow-blue-500/20 border-none"
              }`}
            >
              {isConnected ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
            </Button>

            <div className="w-12 h-12 rounded-full flex items-center justify-center text-slate-500">
               <div className="w-1 h-1 rounded-full bg-current" />
            </div>
          </div>
        </div>
      </div>

      {/* 日志面板 */}
      <footer className="mt-auto z-30 shrink-0 pb-4">
        <div className="w-full max-w-4xl mx-auto rounded-2xl border border-white/5 bg-black/40 backdrop-blur-xl overflow-hidden shadow-2xl">
          <div className="px-4 py-2 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Console Output</span>
            <div className="flex gap-1.5">
              <div className="w-2 h-2 rounded-full bg-slate-700" />
              <div className="w-2 h-2 rounded-full bg-slate-700" />
            </div>
          </div>
          <ScrollArea className="h-32 px-4 py-3 font-mono text-[11px] leading-relaxed text-slate-400 scrollbar-hide">
            {logs.map((log, i) => (
              <div key={i} className="mb-1 opacity-80 hover:opacity-100 transition-opacity">
                <span className="text-blue-500/50 mr-2">›</span>
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
