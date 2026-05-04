"use client";

import { useEffect, useRef, useState } from "react";
import { SmartOrb } from "@/components/SmartOrb";
import { GeminiLiveClient } from "@/lib/gemini-live";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, Mic, MicOff, Settings } from "lucide-react";

export default function JilingPage() {
  const [status, setStatus] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [logs, setLogs] = useState<string[]>(["系统就绪，等待语音指令..."]);
  const [volume, setVolume] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  
  const clientRef = useRef<GeminiLiveClient | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-50), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const startInteraction = async () => {
    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) {
        addLog("错误: 未配置 NEXT_PUBLIC_GEMINI_API_KEY");
        return;
      }

      clientRef.current = new GeminiLiveClient({ apiKey });
      await clientRef.current.connect();
      setIsConnected(true);
      setStatus("listening");
      addLog("已连接至 Gemini Live API");

      // 初始化音频采集
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      
      // 注意: 实际生产建议使用 AudioWorklet，这里为了快速演示使用 ScriptProcessor
      const processor = audioContextRef.current.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // 计算音量用于 UI
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        setVolume(Math.sqrt(sum / inputData.length));

        // 转换为 16-bit PCM Base64
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
        clientRef.current?.sendAudio(base64);
      };

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);

      // 处理接收到的消息
      clientRef.current.onMessage(async (msg) => {
        if (msg.server_content?.model_turn?.parts) {
          const part = msg.server_content.model_turn.parts[0];
          if (part.inline_data) {
            setStatus("speaking");
            // 播放来自 AI 的音频 (简化处理)
            playPcmBase64(part.inline_data.data);
          }
        }

        if (msg.server_content?.tool_call) {
          const calls = msg.server_content.tool_call.function_calls;
          for (const call of calls) {
            if (call.name === "execute_agent") {
              setStatus("thinking");
              addLog(`正在执行 Agent [${call.args.agent}]: ${call.args.task}`);
              try {
                const result = await invoke("execute_agent", { 
                  agent: call.args.agent, 
                  task: call.args.task 
                });
                addLog(`Agent 执行成功: ${result}`);
                clientRef.current?.sendToolResponse(call.id, result);
              } catch (err) {
                addLog(`Agent 执行失败: ${err}`);
                clientRef.current?.sendToolResponse(call.id, `Error: ${err}`);
              }
            }
          }
        }
      });

    } catch (err) {
      addLog(`连接失败: ${err}`);
    }
  };

  const playPcmBase64 = (base64: string) => {
    // 实际项目中需要更好的音频队列管理，防止爆音
    if (!audioContextRef.current) return;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 0x7FFF;

    const buffer = audioContextRef.current.createBuffer(1, float32.length, 16000);
    buffer.getChannelData(0).set(float32);
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.start();
    source.onended = () => setStatus("listening");
  };

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white flex flex-col items-center justify-between p-8 overflow-hidden">
      {/* Header */}
      <div className="w-full flex justify-between items-center z-20">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
          <h1 className="text-xl font-light tracking-widest uppercase">Jiling / 机灵</h1>
        </div>
        <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/10">
          <Settings className="w-5 h-5 text-slate-400" />
        </Button>
      </div>

      {/* Center Content */}
      <div className="flex-1 flex flex-col items-center justify-center gap-12 z-10">
        <SmartOrb volume={volume} status={status} />
        
        <div className="flex flex-col items-center gap-4">
          <div className="px-6 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md">
            <p className="text-sm font-medium text-blue-300">
              {status === "idle" ? "点击开始交互" : 
               status === "listening" ? "正在倾听..." : 
               status === "thinking" ? "机灵正在思考并执行任务..." : "正在为您解答"}
            </p>
          </div>
          
          <Button 
            onClick={isConnected ? () => window.location.reload() : startInteraction}
            className={`w-16 h-16 rounded-full transition-all duration-500 ${
              isConnected ? "bg-red-500/20 border-red-500/50 hover:bg-red-500/30" : "bg-blue-500 hover:bg-blue-600"
            }`}
          >
            {isConnected ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
          </Button>
        </div>
      </div>

      {/* Log Panel (Glassmorphism) */}
      <div className="w-full max-w-2xl h-48 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-4 flex flex-col gap-2 z-20">
        <div className="flex items-center gap-2 border-b border-white/10 pb-2 mb-2">
          <Terminal className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-mono uppercase tracking-tighter text-slate-400">Activity Log / Agent 执行记录</span>
        </div>
        <ScrollArea className="flex-1 font-mono text-[10px] leading-relaxed text-slate-300">
          {logs.map((log, i) => (
            <div key={i} className="mb-1">{log}</div>
          ))}
        </ScrollArea>
      </div>

      {/* Background Decoration */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-500/5 rounded-full blur-[120px] pointer-events-none" />
    </main>
  );
}
