"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FunctionResponse } from "@google/genai";
import {
  Activity,
  Bot,
  ChevronDown,
  CircleStop,
  Eraser,
  ListChecks,
  Mic,
  Minimize2,
  PanelRight,
  Radio,
  RotateCw,
  Sparkles,
  Terminal,
} from "lucide-react";
import { SmartOrb } from "@/components/SmartOrb";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GeminiLiveClient, type LiveMessage } from "@/lib/gemini-live";
import { runGeminiLiveSelfTest } from "@/lib/gemini-live-self-test";
import { AcpProviderAdapter } from "@/lib/providers/acp-provider";
import type { AgentProviderAdapter, AgentRuntimeProfile, JilingTaskOutput } from "@/lib/agent-provider";

type VoiceStatus = "idle" | "listening" | "thinking" | "speaking";
type ToolCall = NonNullable<LiveMessage["toolCall"]>;
type AgentTaskPhase = "submitted" | "running" | "completed" | "failed" | "cancelled";

type AgentTaskView = {
  runId: string;
  title: string;
  providerName: string;
  phase: AgentTaskPhase;
  startedAt: number;
  updatedAt: number;
  progress: string[];
  output?: string;
  error?: string;
};

export type AudioFeatures = {
  energy: number;
  bass: number;
  mid: number;
  treble: number;
  centroid: number;
  onset: number;
};

export type ProviderOption = {
  id: string;
  name: string;
  adapter: AgentProviderAdapter;
};

const VOICES = [
  { id: "none", name: "官方原生" },
  { id: "Aoede", name: "缪斯女声" },
  { id: "Leda", name: "青春女声" },
  { id: "Kore", name: "坚定女声" },
  { id: "Achernar", name: "温柔女声" },
  { id: "Autonoe", name: "阳光女声" },
  { id: "Despina", name: "友好女声" },
  { id: "Erinome", name: "清晰女声" },
  { id: "Laomedeia", name: "活泼女声" },
  { id: "Pulcherrima", name: "华丽女声" },
  { id: "Sadachbia", name: "生动女声" },
  { id: "Schedar", name: "平稳女声" },
  { id: "Sulafat", name: "宁静女声" },
  { id: "Vindemiatrix", name: "明亮女声" },
  { id: "Callirrhoe", name: "随性女声" },
  { id: "Enceladus", name: "柔和女声" },
  { id: "Charon", name: "博学男声" },
  { id: "Sadaltager", name: "深沉男声" },
  { id: "Puck", name: "活力男声" },
  { id: "Fenrir", name: "稳重男声" },
  { id: "Orus", name: "成熟男声" },
  { id: "Zephyr", name: "阳光男声" },
  { id: "Iapetus", name: "清晰男声" },
  { id: "Umbriel", name: "沉稳男声" },
  { id: "Algieba", name: "流畅男声" },
  { id: "Achird", name: "友好男声" },
  { id: "Algenib", name: "浑厚男声" },
  { id: "Gacrux", name: "成熟男声" },
  { id: "Zubenelgenubi", name: "随性男声" },
  { id: "Alnilam", name: "深邃男声" },
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatTaskOutput(output: JilingTaskOutput | string) {
  if (typeof output === "string") return output;

  const parts = [
    output.spokenReport,
    output.detailSummary,
    output.changedFiles?.length
      ? `变更文件\n${output.changedFiles.map((file) => `- ${file.path}: ${file.summary}`).join("\n")}`
      : "",
    output.verification?.length
      ? `验证\n${output.verification.map((item) => `- ${item.command}: ${item.result}${item.note ? ` (${item.note})` : ""}`).join("\n")}`
      : "",
    output.nextActions?.length
      ? `后续建议\n${output.nextActions.map((item) => `- ${item}`).join("\n")}`
      : "",
  ].filter(Boolean);

  return parts.join("\n\n") || output.speakableSummary || output.title;
}

function taskTitleFromRequest(request: string) {
  const compact = request.replace(/\s+/g, " ").trim();
  if (!compact) return "本地代理任务";
  return compact.length > 34 ? `${compact.slice(0, 34)}...` : compact;
}

function phaseLabel(phase?: AgentTaskPhase) {
  switch (phase) {
    case "submitted":
      return "已提交";
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return "待命";
  }
}

function providerLabel(providerId?: string, fallback?: string) {
  if (providerId === "openclaw" || fallback === "OpenClaw") return "OpenClaw";
  if (providerId === "autoclaw" || fallback === "AutoClaw") return "AutoClaw";
  if (providerId === "hermes" || fallback === "Hermes") return "Hermes";
  return fallback || "本地代理";
}

function isTerminalTaskStatus(status: string) {
  return ["completed", "complete", "success", "succeeded", "end"].includes(status.toLowerCase());
}

function parseLiveDurationMs(value?: string) {
  if (!value) return 3000;
  const secondsMatch = value.match(/^(\d+(?:\.\d+)?)s$/);
  if (secondsMatch) return Number(secondsMatch[1]) * 1000;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric * 1000;
  return 3000;
}

const DEFAULT_AUDIO_FEATURES: AudioFeatures = {
  energy: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  centroid: 0.35,
  onset: 0,
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothAudioFeatures(previous: AudioFeatures, next: AudioFeatures): AudioFeatures {
  const smooth = (oldValue: number, nextValue: number, attack = 0.42, release = 0.12) => {
    const rate = nextValue > oldValue ? attack : release;
    return oldValue + (nextValue - oldValue) * rate;
  };

  return {
    energy: smooth(previous.energy, next.energy, 0.25, 0.075),
    bass: smooth(previous.bass, next.bass, 0.2, 0.06),
    mid: smooth(previous.mid, next.mid, 0.24, 0.065),
    treble: smooth(previous.treble, next.treble, 0.28, 0.09),
    centroid: smooth(previous.centroid, next.centroid, 0.12, 0.07),
    onset: smooth(previous.onset, next.onset, 0.42, 0.1),
  };
}

function analyzeAudioFeatures(samples: Float32Array, sampleRate: number, previous: AudioFeatures): AudioFeatures {
  if (samples.length === 0) return DEFAULT_AUDIO_FEATURES;

  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }

  const rms = Math.sqrt(sum / samples.length);
  const size = Math.min(512, samples.length);
  const offset = Math.max(0, Math.floor((samples.length - size) / 2));
  let bassEnergy = 0;
  let midEnergy = 0;
  let trebleEnergy = 0;
  let weighted = 0;
  let total = 0;

  for (let bin = 2; bin <= 128; bin++) {
    let real = 0;
    let imag = 0;
    for (let i = 0; i < size; i++) {
      const sample = samples[offset + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
      const angle = (2 * Math.PI * bin * i) / size;
      real += sample * Math.cos(angle);
      imag -= sample * Math.sin(angle);
    }
    const magnitude = Math.sqrt(real * real + imag * imag) / size;
    const frequency = (bin * sampleRate) / size;
    const weightedMagnitude = magnitude * Math.log2(2 + frequency / 80);

    if (frequency < 260) bassEnergy += weightedMagnitude;
    else if (frequency < 2200) midEnergy += weightedMagnitude;
    else trebleEnergy += weightedMagnitude;

    weighted += weightedMagnitude * frequency;
    total += weightedMagnitude;
  }

  const energy = clamp01(Math.pow(clamp01(rms * 6.2 + peak * 0.42), 0.72) * 0.84);
  const bass = clamp01(Math.pow(clamp01(bassEnergy * 10.2), 0.78) * 0.78);
  const mid = clamp01(Math.pow(clamp01(midEnergy * 6.8), 0.82) * 0.78);
  const treble = clamp01(Math.pow(clamp01(trebleEnergy * 5.1), 0.88) * 0.64);
  const centroid = total > 0 ? clamp01((weighted / total) / 8000) : previous.centroid;
  const onset = clamp01(Math.max(0, energy - previous.energy * 1.03) * 2.15);

  return smoothAudioFeatures(previous, {
    energy,
    bass,
    mid,
    treble,
    centroid,
    onset,
  });
}

class AudioStreamer {
  private context: AudioContext;
  private nextPlayTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  onDrained?: () => void;
  onSamples?: (samples: Float32Array, sampleRate: number) => void;

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
    this.onSamples?.(floats, 24000);

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
  const [audioFeatures, setAudioFeatures] = useState<AudioFeatures>(DEFAULT_AUDIO_FEATURES);
  const [logs, setLogs] = useState<string[]>(["系统就绪，等待语音指令..."]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("openclaw");
  const [selectedVoice, setSelectedVoice] = useState<string>("none");
  const [focusMode, setFocusMode] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [agentTasks, setAgentTasks] = useState<AgentTaskView[]>([]);

  const selectedVoiceRef = useRef(selectedVoice);
  const selectedProviderIdRef = useRef(selectedProviderId);
  useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => { selectedProviderIdRef.current = selectedProviderId; }, [selectedProviderId]);

  const statusRef = useRef<VoiceStatus>("idle");
  const reconnectWantedRef = useRef(false);
  const serverReconnectRef = useRef(false);
  const goAwayTimerRef = useRef<number | null>(null);
  const startingRef = useRef(false);
  const clientRef = useRef<GeminiLiveClient | null>(null);
  const adapterRef = useRef<AgentProviderAdapter | null>(null);
  const profileRef = useRef<AgentRuntimeProfile | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamerRef = useRef<AudioStreamer | null>(null);
  const audioFeaturesRef = useRef<AudioFeatures>(DEFAULT_AUDIO_FEATURES);
  const lastFeatureUpdateRef = useRef(0);
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

  const clearGoAwayTimer = () => {
    if (goAwayTimerRef.current !== null) {
      window.clearTimeout(goAwayTimerRef.current);
      goAwayTimerRef.current = null;
    }
  };

  const scheduleServerReconnect = (timeLeft?: string) => {
    if (serverReconnectRef.current) return;
    serverReconnectRef.current = true;

    const timeLeftMs = parseLiveDurationMs(timeLeft);
    const delayMs = Math.max(0, Math.min(timeLeftMs - 1500, 8000));
    addLog(`[Live] 收到服务端 goAway，${Math.round(timeLeftMs / 1000)} 秒内预重连`);

    clearGoAwayTimer();
    goAwayTimerRef.current = window.setTimeout(async () => {
      goAwayTimerRef.current = null;
      const client = clientRef.current;
      if (!client || statusRef.current === "idle") {
        serverReconnectRef.current = false;
        return;
      }

      setIsBusy(true);
      reconnectWantedRef.current = true;
      addLog("[系统] 服务端连接即将到期，正在无感续接...");
      try {
        stopMic();
        await client.closeGracefully(5000);
      } catch (error: unknown) {
        addLog(`[系统] 预重连失败: ${errorMessage(error)}`);
        serverReconnectRef.current = false;
      } finally {
        setIsBusy(false);
      }
    }, delayMs);
  };

  const updateAudioFeatures = (samples: Float32Array, sampleRate: number) => {
    const now = performance.now();
    if (now - lastFeatureUpdateRef.current < 32) return;
    lastFeatureUpdateRef.current = now;

    const next = analyzeAudioFeatures(samples, sampleRate, audioFeaturesRef.current);
    audioFeaturesRef.current = next;
    setAudioFeatures(next);
    setVolume(next.energy);
  };

  const upsertTask = (task: AgentTaskView) => {
    setAgentTasks((previous) => [task, ...previous.filter((item) => item.runId !== task.runId)].slice(0, 12));
    setSelectedTaskId(task.runId);
    setFocusMode(false);
  };

  const updateTask = (runId: string, patch: Partial<AgentTaskView>) => {
    setAgentTasks((previous) =>
      previous.map((task) =>
        task.runId === runId
          ? { ...task, ...patch, updatedAt: Date.now() }
          : task
      )
    );
  };

  const appendTaskProgress = (runId: string, text: string) => {
    setAgentTasks((previous) =>
      previous.map((task) =>
        task.runId === runId
          ? {
              ...task,
              phase: task.phase === "submitted" ? "running" : task.phase,
              progress: [...task.progress, text].slice(-24),
              updatedAt: Date.now(),
            }
          : task
      )
    );
  };

  const stopMic = () => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setVolume(0);
    audioFeaturesRef.current = DEFAULT_AUDIO_FEATURES;
    setAudioFeatures(DEFAULT_AUDIO_FEATURES);
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
      updateAudioFeatures(input, event.inputBuffer.sampleRate);

      if (statusRef.current === "idle") return;

      const pcm16 = resampleTo16k(input, event.inputBuffer.sampleRate);
      clientRef.current?.sendAudio(pcm16ToBase64(pcm16));
    };

    source.connect(processor);
    processor.connect(context.destination);
  };

  const createClient = (profile?: AgentRuntimeProfile) => {
    const client = new GeminiLiveClient({
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
    client.voiceName = selectedVoiceRef.current;
    return client;
  };

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
      clearGoAwayTimer();
      serverReconnectRef.current = false;
      await cleanupAudio();
      const context = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = context;

      const streamer = new AudioStreamer(context);
      streamer.onDrained = () => {
        if (statusRef.current === "speaking") setStatus("listening");
      };
      streamer.onSamples = updateAudioFeatures;
      streamerRef.current = streamer;

      let profile: AgentRuntimeProfile | undefined;
      const selected = providers.find(p => p.id === selectedProviderIdRef.current);
      if (selected) {
        adapterRef.current = selected.adapter;
        profile = await selected.adapter.agentProfile();
        profileRef.current = profile;
        addLog(`[系统] 使用代理：${providerLabel(selected.id, selected.name)}`);
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
    serverReconnectRef.current = false;
    clearGoAwayTimer();
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
    const pId = selectedProviderIdRef.current;
    if (!pId) return;
    GeminiLiveClient.clearStoredHandle(pId);
    addLog(`[系统] 已清除 ${pId} 的上下文记忆。下次对话将重新开始。`);
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
    if (message.goAway) {
      scheduleServerReconnect(message.goAway.timeLeft);
    }

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
        addLog(`${profileRef.current?.displayName || "代理"}: ${content.outputTranscription.text}`);
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
          const adapter = adapterRef.current;
          const selectedProvider = providers.find((provider) => provider.id === selectedProviderIdRef.current);
          const taskText = String(callArgs.task || "");
          const taskRef = await adapter.submitTask({
            identity: { systemName: "机灵", runtimeRoleDescription: profileRef.current?.roleDescription || "", mode: "background_core", userFacingRole: "same_assistant" },
            userRequest: taskText,
            conversationContext: { recentUserIntent: taskText, locale: "zh-CN" },
            executionPolicy: { askBeforeRiskyChanges: true, preferConciseProgress: false, produceSpeakableSummary: true },
            outputContract: { format: "markdown_with_titles", requireSpeakableSummary: true, requireSpokenReport: true },
          });
          result = {
            status: "submitted",
            completed: false,
            runId: taskRef.runId,
            message: "后台任务已提交，但尚未完成。你只能告诉用户任务正在后台处理中，不能声称任务已完成，也不能编造执行结果。只有收到系统注入的“背景任务执行完毕”事件后，才可以汇报完成结果。",
          };

          upsertTask({
            runId: taskRef.runId,
            title: taskTitleFromRequest(taskText),
            providerName: providerLabel(selectedProvider?.id, selectedProvider?.name || profileRef.current?.displayName || taskRef.providerId),
            phase: "submitted",
            startedAt: Date.now(),
            updatedAt: Date.now(),
            progress: [],
          });

          void adapter.subscribeTask(taskRef, {
            onProgress: (e) => {
              addLog(`[代理] ${e.text}`);
              appendTaskProgress(taskRef.runId, e.text);
            },
            onCompleted: (e) => {
              const outputText = formatTaskOutput(e.output);
              updateTask(taskRef.runId, {
                phase: "completed",
                output: outputText,
              });
              clientRef.current?.sendSystemUpdate(
                `背景任务执行完毕。runId: ${taskRef.runId}\n\n执行结果如下：\n${outputText}\n\n请在用户空闲时，用第一人称、语音友好的方式主动完整汇报这次任务结果。不要只做一句话简略总结，保留关键细节、结论、文件变更、验证结果和后续建议。`
              );
            },
            onFailed: (e) => {
              addLog(`[任务] 失败: ${e.error}`);
              updateTask(taskRef.runId, { phase: "failed", error: e.error });
            },
            onCancelled: (e) => {
              updateTask(taskRef.runId, { phase: "cancelled", error: e.reason });
            },
          });
        } else if (call.name === "get_agent_task_status") {
          const runId = String(callArgs.run_id || callArgs.runId || selectedTaskId || "");
          if (!runId) {
            result = {
              found: false,
              completed: false,
              message: "没有可查询的后台任务 runId。请告诉用户当前没有可确认的任务状态，不能声称任务完成。",
            };
          } else if (adapterRef.current) {
            const snapshot = await adapterRef.current.waitTask({ runId, providerId: selectedProviderIdRef.current });
            const completed = isTerminalTaskStatus(snapshot.status);
            result = {
              found: true,
              runId,
              status: snapshot.status,
              completed,
              output: completed ? snapshot.output || "" : "",
              message: completed
                ? "任务已完成，可以基于 output 汇报结果。"
                : "任务尚未完成。请如实告诉用户仍在后台处理中，不要编造结果，不要说已经完成。",
            };
          } else {
            result = {
              found: false,
              completed: false,
              message: "当前没有可用的本地代理适配器，无法确认任务状态。不能声称任务完成。",
            };
          }
        } else if (call.name === "abort_agent_task" && adapterRef.current) {
          const runId = String(callArgs.run_id || callArgs.runId || selectedTaskId || "");
          if (!runId) {
            result = {
              requested: false,
              completed: false,
              message: "没有可终止的后台任务 runId。",
            };
          } else {
            const abortResult = await adapterRef.current.abortTask({ runId, providerId: selectedProviderIdRef.current });
            updateTask(runId, { phase: "cancelled", error: abortResult.message || "已请求终止" });
            result = {
              requested: abortResult.success,
              runId,
              completed: false,
              message: abortResult.success
                ? "已发出终止请求，但这不代表任务已经停止。请告诉用户正在请求终止，并建议稍后查询状态确认。"
                : abortResult.message || "终止请求失败。",
            };
          }
        } else {
          result = await invoke(call.name, args);
        }
        functionResponses.push({ name: call.name, id: call.id, response: { result } });
      } catch (error) {
        const message = errorMessage(error);
        addLog(`[工具] 执行失败: ${message}`);
        functionResponses.push({ name: call.name, id: call.id, response: { error: message } });
      }
    }

    clientRef.current?.sendToolResponse(functionResponses);
    setStatus("listening");
  };

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [logs]);

  useEffect(() => {
    return () => {
      reconnectWantedRef.current = false;
      serverReconnectRef.current = false;
      clearGoAwayTimer();
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

  const selectedTask = useMemo(() => {
    if (!agentTasks.length) return null;
    return agentTasks.find((task) => task.runId === selectedTaskId) || agentTasks[0];
  }, [agentTasks, selectedTaskId]);

  const runningTasks = agentTasks.filter((task) => task.phase === "submitted" || task.phase === "running");
  const latestOutput = selectedTask?.output || selectedTask?.progress.at(-1) || "本地代理的完整输出会显示在这里。";
  const currentProviderName = providerLabel(selectedProviderId, providers.find((provider) => provider.id === selectedProviderId)?.name);

  return (
    <main className="h-screen w-full overflow-hidden bg-[#050506] text-white">
      <div className="relative flex h-full flex-col overflow-hidden px-7 py-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_43%,rgba(72,255,222,0.11),transparent_24%),radial-gradient(circle_at_56%_39%,rgba(255,93,184,0.08),transparent_22%),linear-gradient(180deg,#09090b_0%,#050506_68%,#030304_100%)]" />

        <header className="relative z-10 flex shrink-0 items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="brand-word text-[28px] leading-none text-white/92">机灵</div>
            <div className="mt-3 flex items-center gap-2 text-[13px] text-white/48">
              <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-200 shadow-[0_0_18px_rgba(167,243,208,0.92)]" : "bg-white/20"}`} />
              <span>{statusText}</span>
              {runningTasks.length > 0 && (
                <span className="rounded-full bg-white/6 px-2 py-0.5 text-white/54">
                  {runningTasks.length} 个任务
                </span>
              )}
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <label className="relative hidden md:block">
              <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/42" />
              <select
                disabled={isBusy || isConnected}
                value={selectedVoice}
                onChange={(event) => setSelectedVoice(event.target.value)}
                className="h-10 w-40 appearance-none rounded-full border border-white/8 bg-white/[0.045] pl-9 pr-9 text-sm text-white/64 outline-none backdrop-blur-xl transition focus:border-white/20 disabled:opacity-45"
              >
                {VOICES.map((voice) => (
                  <option key={voice.id} value={voice.id}>{voice.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            </label>

            {providers.length > 0 && (
              <label className="relative hidden md:block">
                <Bot className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/42" />
                <select
                  disabled={isBusy || isConnected}
                  value={selectedProviderId}
                  onChange={(event) => setSelectedProviderId(event.target.value)}
                  className="h-10 w-36 appearance-none rounded-full border border-white/8 bg-white/[0.045] pl-9 pr-9 text-sm text-white/64 outline-none backdrop-blur-xl transition focus:border-white/20 disabled:opacity-45"
                >
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{providerLabel(provider.id, provider.name)}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              </label>
            )}

            <Button
              type="button"
              title={focusMode ? "展开工作层" : "收起工作层"}
              onClick={() => setFocusMode((value) => !value)}
              className="h-10 w-10 rounded-full border border-white/8 bg-white/[0.045] p-0 text-white/62 hover:bg-white/10"
            >
              {focusMode ? <PanelRight className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        <section className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-5 pt-4 lg:grid-cols-[1fr_auto]">
          <div className="voice-surface relative flex min-h-0 flex-col items-center justify-center overflow-hidden">
            <div className="absolute left-1/2 top-[14%] flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/[0.045] px-4 py-2 text-xs text-white/48 backdrop-blur-2xl">
              <Radio className="h-3.5 w-3.5 text-cyan-100/64" />
              <span>{currentProviderName}</span>
            </div>

            <SmartOrb volume={volume} features={audioFeatures} status={status} compact />

            <div className="absolute bottom-[8%] left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-full border border-white/8 bg-black/34 p-2 shadow-[0_22px_80px_rgba(0,0,0,0.48)] backdrop-blur-2xl">
              <Button
                onClick={clearContext}
                title="清除会话"
                className="h-12 w-12 rounded-full border border-white/8 bg-white/[0.045] p-0 text-white/48 hover:bg-white/10"
              >
                <Eraser className="h-5 w-5" />
              </Button>

              <Button
                disabled={isBusy}
                onClick={isConnected ? stopConversation : startConversation}
                title={isConnected ? "停止语音" : "开始语音"}
                className={`h-[68px] w-[68px] rounded-full p-0 ${
                  isConnected
                    ? "border border-rose-200/24 bg-rose-300/12 text-rose-100 shadow-[0_0_44px_rgba(244,114,182,0.22)] hover:bg-rose-300/18"
                    : "bg-white text-black shadow-[0_0_54px_rgba(255,255,255,0.22)] hover:bg-cyan-100"
                }`}
              >
                {isConnected ? <CircleStop className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
              </Button>

              <Button
                disabled={isBusy}
                onClick={isConnected ? forceReconnect : runSelfTest}
                title={isConnected ? "重新连接" : "恢复自检"}
                className="h-12 w-12 rounded-full border border-white/8 bg-white/[0.045] p-0 text-white/48 hover:bg-white/10"
              >
                {isConnected ? <RotateCw className="h-5 w-5" /> : <Activity className="h-5 w-5" />}
              </Button>
            </div>
          </div>

          {!focusMode && (
            <aside className="flex h-full w-[340px] min-h-0 flex-col gap-3 rounded-md border border-white/8 bg-white/[0.035] p-3 backdrop-blur-2xl">
              <div className="flex items-center justify-between px-1 py-1 text-sm text-white/76">
                <div className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-emerald-100/66" />
                  <span>任务</span>
                </div>
                <span className="text-xs text-white/34">共 {agentTasks.length} 个</span>
              </div>

              <div className="min-h-[112px] shrink-0 space-y-2 overflow-y-auto">
                {agentTasks.length === 0 ? (
                  <div className="flex h-28 items-center justify-center text-sm text-white/34">暂无后台任务</div>
                ) : (
                  agentTasks.map((task) => (
                    <button
                      key={task.runId}
                      type="button"
                      onClick={() => setSelectedTaskId(task.runId)}
                      className={`w-full rounded-md px-3 py-3 text-left transition ${
                        selectedTask?.runId === task.runId
                          ? "bg-white/[0.075]"
                          : "bg-transparent hover:bg-white/[0.045]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${
                          task.phase === "completed" ? "bg-emerald-200" :
                          task.phase === "failed" ? "bg-rose-200" :
                          task.phase === "cancelled" ? "bg-white/28" :
                          "bg-amber-200"
                        }`} />
                        <span className="min-w-0 flex-1 truncate text-sm text-white/78">{task.title}</span>
                        <span className="text-xs text-white/38">{phaseLabel(task.phase)}</span>
                      </div>
                      <div className="mt-2 truncate pl-4 text-xs text-white/36">
                        {task.progress.at(-1) || task.output || task.runId}
                      </div>
                    </button>
                  ))
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col rounded-md bg-black/22">
                <div className="flex items-center justify-between px-4 py-3 text-sm text-white/76">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-cyan-100/66" />
                    <span>完整输出</span>
                  </div>
                  <span className="max-w-[130px] truncate text-xs text-white/30">{selectedTask?.runId || "等待任务"}</span>
                </div>
                <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
                  <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-6 text-white/62">{latestOutput}</pre>
                </ScrollArea>
              </div>

              <div className="shrink-0">
                <Button
                  type="button"
                  title={showLogs ? "隐藏调试记录" : "显示调试记录"}
                  onClick={() => setShowLogs((value) => !value)}
                  className="h-8 w-full rounded-md bg-white/[0.035] text-xs text-white/42 hover:bg-white/[0.07]"
                >
                  <Terminal className="mr-2 h-3.5 w-3.5" />
                  调试记录
                </Button>

                {showLogs && (
                  <ScrollArea className="mt-2 h-32 rounded-md bg-black/24 px-3 py-2 font-mono text-[10px] leading-5 text-white/34">
                    {logs.map((log, index) => (
                      <div key={`${index}-${log}`} className="truncate">
                        <span className="mr-1 text-cyan-200/42">›</span>
                        {log}
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </ScrollArea>
                )}
              </div>
            </aside>
          )}
        </section>
      </div>
    </main>
  );
}
