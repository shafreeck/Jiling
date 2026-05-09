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
  KeyRound,
  ListChecks,
  Mic,
  Minimize2,
  PanelRight,
  Radio,
  RotateCw,
  Sparkles,
  Terminal,
  VideoOff,
  X,
  AppWindow,
  ListTodo,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { SmartOrb } from "@/components/SmartOrb";
import { Button } from "@/components/ui/button";
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GeminiLiveClient, type LiveMessage } from "@/lib/gemini-live";
import { runGeminiLiveSelfTest } from "@/lib/gemini-live-self-test";
import { AcpProviderAdapter } from "@/lib/providers/acp-provider";
import type { AgentProviderAdapter, AgentRuntimeProfile, JilingTaskOutput } from "@/lib/agent-provider";
import { TranscriptOverlay, type TranscriptMessage } from "@/components/TranscriptOverlay";
import { ControlBar } from "@/components/ControlBar";
import { TaskSidePanel } from "@/components/TaskSidePanel";
import { TaskOutputOverlay } from "@/components/TaskOutputOverlay";

type VoiceStatus = "idle" | "listening" | "thinking" | "speaking";
type ToolCall = NonNullable<LiveMessage["toolCall"]>;
type AgentTaskPhase = "submitted" | "running" | "completed" | "failed" | "cancelled";

type ApiKeyStatus = {
  configured: boolean;
  source?: string | null;
};

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

function playReadySound(context: AudioContext) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  
  osc.type = "sine";
  osc.frequency.setValueAtTime(523.25, context.currentTime); // C5
  osc.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.12); // A5
  
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(0.2, context.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.3);
  
  osc.connect(gain);
  gain.connect(context.destination);
  
  osc.start();
  osc.stop(context.currentTime + 0.3);
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

  const isHydratedRef = useRef(false);

  const [focusMode, setFocusMode] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" } | null>(null);

  const showToast = (message: string, type: "info" | "error" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [agentTasks, setAgentTasks] = useState<AgentTaskView[]>([]);
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(null);
  const [apiKeySource, setApiKeySource] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  
  const activeTask = useMemo(() => {
    return agentTasks.find((task) => task.runId === selectedTaskId) || agentTasks[0];
  }, [agentTasks, selectedTaskId]);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  
  // New UI states
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [showTranscript, setShowTranscript] = useState(true);
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
  const [isTaskPinned, setIsTaskPinned] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const selectedVoiceRef = useRef(selectedVoice);
  const selectedProviderIdRef = useRef(selectedProviderId);
  const isMutedRef = useRef(isMuted);
  useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => { selectedProviderIdRef.current = selectedProviderId; }, [selectedProviderId]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const captureTimerRef = useRef<number | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (showLogs) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, showLogs]);

  // Reset busy state on mount to prevent stale locks from HMR
  useEffect(() => {
    setIsBusy(false);
    startingRef.current = false;
  }, []);

  // Load persistence on mount
  useEffect(() => {
    const savedVoice = localStorage.getItem("jiling_voice");
    const savedProvider = localStorage.getItem("jiling_provider");
    const savedLogs = localStorage.getItem("jiling_show_logs");
    if (savedVoice) setSelectedVoice(savedVoice);
    if (savedProvider) setSelectedProviderId(savedProvider);
    if (savedLogs === "true") setShowLogs(true);
    isHydratedRef.current = true;
  }, []);

  // Save changes after hydration
  useEffect(() => {
    if (!isHydratedRef.current) return;
    localStorage.setItem("jiling_voice", selectedVoice);
  }, [selectedVoice]);

  useEffect(() => {
    if (!isHydratedRef.current) return;
    localStorage.setItem("jiling_provider", selectedProviderId);
  }, [selectedProviderId]);

  useEffect(() => {
    if (!isHydratedRef.current) return;
    localStorage.setItem("jiling_show_logs", String(showLogs));
  }, [showLogs]);

  // Global hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setShowLogs(prev => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const stopVideoStream = () => {
    if (captureTimerRef.current) {
      window.clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
      videoStreamRef.current = null;
    }
  };

  // Sync video stream to element when it appears in DOM

  // Automate frame capture when connected and video/sharing is active
  useEffect(() => {
    let timer: any = null;

    if (isConnected && (isVideoOn || isSharing)) {
      timer = setInterval(() => {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        const client = clientRef.current;

        if (!canvas || !video || !client) return;
        
        // Ensure video is actually playing and has dimensions
        if (video.paused || video.ended || video.readyState < 2) return;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        // Force standard vision resolution (Gemini likes 640x480 or similar)
        if (canvas.width !== 640 || canvas.height !== 480) {
          canvas.width = 640;
          canvas.height = 480;
        }
        
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const base64 = canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
          if (base64 && base64.length > 100) {
            client.sendVideo(base64);
          }
        } catch (e) {
          console.error("Vision capture error:", e);
        }
      }, 1000); // 1 FPS is usually enough for live vision
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isConnected, isVideoOn, isSharing]);

  const handleToggleVideo = async () => {
    if (isVideoOn) {
      stopVideoStream();
      setIsVideoOn(false);
    } else {
      try {
        if (isSharing) stopVideoStream(); // Stop sharing if active
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 1280, height: 720 }, 
          audio: false 
        });
        videoStreamRef.current = stream;
        videoStreamRef.current = stream;
        setIsVideoOn(true);
        setIsSharing(false);
      } catch (error) {
        addLog(`[视频] 无法开启摄像头: ${errorMessage(error)}`);
      }
    }
  };

  const handleToggleShare = async () => {
    if (isSharing) {
      stopVideoStream();
      setIsSharing(false);
    } else {
      try {
        if (isVideoOn) stopVideoStream(); // Stop camera if active
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: true, 
          audio: false 
        });
        videoStreamRef.current = stream;
        videoStreamRef.current = stream;
        
        // Handle stream stop via browser UI
        stream.getVideoTracks()[0].onended = () => {
          stopVideoStream();
          setIsSharing(false);
        };

        setIsSharing(true);
        setIsVideoOn(false);
      } catch (error) {
        addLog(`[屏幕] 无法开启共享: ${errorMessage(error)}`);
      }
    }
  };

  const setStatus = (next: VoiceStatus) => {
    statusRef.current = next;
    setStatusState(next);
  };

  const addLog = (message: string) => {
    setLogs((previous) => [...previous.slice(-80), `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const refreshApiKeyStatus = async () => {
    const status = await invoke<ApiKeyStatus>("get_api_key_status");
    setApiKeyConfigured(status.configured);
    setApiKeySource(status.source || null);
    return status;
  };

  const saveApiKey = async () => {
    setIsSavingSettings(true);
    setSettingsError(null);

    try {
      await invoke("set_api_key", { apiKey: apiKeyInput });
      GeminiLiveClient.resetApiClient();
      const status = await refreshApiKeyStatus();
      setApiKeyInput("");
      setShowSettings(false);
      addLog(status.configured ? "[设置] Gemini API Key 已保存" : "[设置] Gemini API Key 已清除");
    } catch (error: unknown) {
      setSettingsError(errorMessage(error));
    } finally {
      setIsSavingSettings(false);
    }
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
      previous.map((task) => {
        if (task.runId !== runId) return task;

        const newProgress = [...task.progress];
        const lastIndex = newProgress.length - 1;
        const lastText = newProgress[lastIndex];

        // If the new text is a continuation of the last progress item, replace it
        // This handles streaming providers like openclaw that send full snapshots
        if (lastText && text.startsWith(lastText)) {
          newProgress[lastIndex] = text;
        } else {
          newProgress.push(text);
        }

        return {
          ...task,
          phase: task.phase === "submitted" ? "running" : task.phase,
          progress: newProgress.slice(-24),
          updatedAt: Date.now(),
        };
      })
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
    try {
      if (context.state === "suspended") {
        await context.resume();
      }
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
    const processor = context.createScriptProcessor(1024, 1, 1);
    sourceRef.current = source;
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      updateAudioFeatures(input, event.inputBuffer.sampleRate);

      if (statusRef.current === "idle" || isMutedRef.current) return;

      const pcm16 = resampleTo16k(input, event.inputBuffer.sampleRate);
      clientRef.current?.sendAudio(pcm16ToBase64(pcm16));
    };

    source.connect(processor);
    processor.connect(context.destination);
    } catch (error: unknown) {
      addLog(`[系统] 麦克风启动失败: ${errorMessage(error)}`);
      throw error;
    }
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
          // Only set default if no saved provider exists in localStorage
          const savedProvider = localStorage.getItem("jiling_provider");
          if (!savedProvider || !detected.find(p => p.id === savedProvider)) {
            setSelectedProviderId(detected[0].id);
          }
        }
      } catch (e) {
        console.error("Provider detection failed", e);
      }
    };
    probeProviders();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void invoke<ApiKeyStatus>("get_api_key_status")
      .then((keyStatus) => {
        if (cancelled) return;
        setApiKeyConfigured(keyStatus.configured);
        setApiKeySource(keyStatus.source || null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setApiKeyConfigured(false);
        addLog(`[设置] 读取 API Key 状态失败: ${errorMessage(error)}`);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const startConversation = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setIsBusy(true);

    try {
      const keyStatus = await refreshApiKeyStatus();
      if (!keyStatus.configured) {
        setShowSettings(true);
        setStatus("idle");
        addLog("[设置] 请先在应用设置中填写 Gemini API Key");
        return;
      }

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
    } catch (error: unknown) {
      setStatus("idle");
      setIsConnected(false);
      addLog(`[系统] 启动失败: ${errorMessage(error)}`);
      if (errorMessage(error).includes("GEMINI_API_KEY")) {
        setShowSettings(true);
      }
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

  const cleanTranscriptText = (text: string) => {
    if (!text) return text;
    // Remove spaces between Chinese characters
    let cleaned = text.replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "");
    // Remove spaces between Chinese character and punctuation
    cleaned = cleaned.replace(/(?<=[\u4e00-\u9fa5])\s+(?=[，。？！；：、“”『』「」])|(?<=[，。？！；：、“”『』「」])\s+(?=[\u4e00-\u9fa5])/g, "");
    return cleaned;
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
        const text = content.inputTranscription.text;
        addLog(`用户: ${text}`);
        setTranscript(prev => {
          const last = prev[prev.length - 1];
          // If the last message was also user and was added very recently, append to it
          // Note: Gemini Live inputTranscription is often partial but not necessarily cumulative deltas
          // If it's a new thought, we might want a new bubble. 
          // But for "one sentence", we append.
          if (last && last.role === "user" && Date.now() - last.timestamp < 3000) {
            const updated = [...prev];
            const merged = cleanTranscriptText(last.text + text);
            updated[updated.length - 1] = { ...last, text: merged, timestamp: Date.now() };
            return updated;
          }
          return [...prev, {
            id: Math.random().toString(36).slice(2),
            role: "user",
            text: cleanTranscriptText(text),
            timestamp: Date.now()
          }];
        });
      }

      if (content.outputTranscription?.text) {
        const text = content.outputTranscription.text;
        addLog(`AI: ${text}`);
        setTranscript(prev => {
          const last = prev[prev.length - 1];
          // AI output transcription usually comes in chunks as it speaks
          if (last && last.role === "ai" && Date.now() - last.timestamp < 5000) {
            const updated = [...prev];
            const merged = cleanTranscriptText(last.text + text);
            updated[updated.length - 1] = { ...last, text: merged, timestamp: Date.now() };
            return updated;
          }
          return [...prev, {
            id: Math.random().toString(36).slice(2),
            role: "ai",
            text: text,
            timestamp: Date.now()
          }];
        });
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
      addLog("[Live] 会话就绪");
      if (audioContextRef.current) {
        playReadySound(audioContextRef.current);
      }
    }

    if (message.serverContent?.modelTurn?.parts?.some(p => p.executableCode)) {
      // Logic for executable code if needed
    }

    if (message.serverContent?.generationComplete) {
      if (!streamerRef.current?.active && statusRef.current === "speaking") {
        setStatus("listening");
      }
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
        } else if (call.name === "capture_screen") {
          const b64 = await invoke<string>("capture_screen");
          clientRef.current?.sendVideo(b64);
          result = {
            success: true,
            message: "屏幕截图已捕获并发送到你的视觉输入流。你现在应该能看到用户的屏幕了。",
          };
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

  const clearSessionHandle = () => {
    if (confirm("确定要擦除当前智能体的记忆（Session Handle）吗？这会导致下一次连接变为全新会话。")) {
      GeminiLiveClient.clearStoredHandle(selectedProviderId);
      addLog(`[系统] 已擦除 ${selectedProviderId} 的记忆 Handle`);
    }
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

  const readingModeContent = (isTaskPinned && !isSharing && !isVideoOn) ? (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Header Strip */}
      <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-6 py-2 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
            <ListChecks className="h-3.5 w-3.5 text-primary" />
          </div>
          <h3 className="text-base font-bold text-white">{activeTask?.title || "等待任务中..."}</h3>
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setIsTaskPinned(false)}
          className="h-7 rounded-full bg-white/5 px-3 text-[10px] text-white/60 hover:bg-white/10 hover:text-white transition-all"
        >
          <AppWindow className="mr-1.5 h-3 w-3" />
          退出阅读模式
        </Button>
      </div>

      {/* Main Content Area */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full w-full">
          <div className="prose max-w-none px-6 py-4 pb-32">
            {activeTask?.output ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {cleanTranscriptText(activeTask.output)}
              </ReactMarkdown>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center text-white/20">
                <Sparkles className="mb-4 h-12 w-12 animate-pulse" />
                <p className="text-sm tracking-widest">正在等待任务内容输出...</p>
              </div>
            )}
          </div>
        </ScrollArea>

      </div>
    </div>
  ) : null;

  const mainDisplayContent = useMemo(() => {
    if (isSharing || isVideoOn) {
      return (
        <video
          autoPlay
          playsInline
          muted
          ref={(node) => {
            if (node) {
              videoRef.current = node;
              if (videoStreamRef.current && node.srcObject !== videoStreamRef.current) {
                node.srcObject = videoStreamRef.current;
              }
            }
          }}
          className="h-full w-full object-contain"
        />
      );
    }
    return readingModeContent;
  }, [isVideoOn, isSharing, readingModeContent]);

  return (
    <main className="relative h-screen w-full overflow-hidden bg-black text-white selection:bg-primary/30">
      {/* Window Breathing Edge Glow */}
      <AnimatePresence>
        {status !== "idle" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ 
              opacity: status === "speaking" ? 0.3 + (volume * 0.7) : 0.2,
              boxShadow: status === "thinking" 
                ? "inset 0 0 80px rgba(168, 85, 247, 0.4)" // Purple for thinking
                : status === "listening"
                ? "inset 0 0 60px rgba(72, 255, 222, 0.3)"  // Cyan for listening
                : `inset 0 0 ${60 + (volume * 100)}px rgba(16, 185, 129, 0.5)`, // Dynamic pulse for speaking
            }}
            exit={{ opacity: 0 }}
            transition={{ 
              duration: (status === "thinking" || status === "listening") ? 1.5 : 0.15,
              repeat: (status === "thinking" || status === "listening") ? Infinity : 0,
              repeatType: "reverse"
            }}
            className="pointer-events-none fixed inset-0 z-400 border border-white/5"
          />
        )}
      </AnimatePresence>

      {/* Dynamic Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: -50, opacity: 0, x: "-50%" }}
            animate={{ y: 20, opacity: 1, x: "-50%" }}
            exit={{ y: -50, opacity: 0, x: "-50%" }}
            className={`fixed left-1/2 top-4 z-300 flex items-center gap-3 rounded-2xl border px-6 py-3 shadow-2xl backdrop-blur-xl ${
              toast.type === "error" 
                ? "border-destructive/40 bg-destructive/10 text-destructive" 
                : "border-white/10 bg-white/5 text-white"
            }`}
          >
            <div className={`h-2 w-2 rounded-full ${toast.type === "error" ? "bg-destructive animate-pulse" : "bg-primary animate-pulse"}`} />
            <span className="text-sm font-medium tracking-wide">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Stage */}
      <div className="absolute inset-0 z-0">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_43%,rgba(72,255,222,0.08),transparent_24%),radial-gradient(circle_at_56%_39%,rgba(255,93,184,0.05),transparent_22%)]" />
        
        <div className="flex h-full w-full items-center justify-center px-4 pb-20 pt-24">
          <AnimatePresence mode="wait">
            {mainDisplayContent ? (
              <motion.div
                key="main-display"
                initial={{ opacity: 0, scale: 0.98, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: 10 }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
                className={`relative z-10 flex h-full max-h-[82vh] w-[94%] max-w-6xl items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0a]/80 shadow-2xl ${
                  (isSharing || isTaskPinned || isVideoOn) ? "" : "glass-panel backdrop-blur-3xl"
                }`}
              >
                {mainDisplayContent}
              </motion.div>
            ) : (
              <motion.div
                key="orb-display"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="relative flex flex-col items-center"
              >
                <SmartOrb
                  volume={volume}
                  features={audioFeatures}
                  status={status}
                  compact={false}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>


      <header data-tauri-drag-region className="relative flex items-center justify-between px-8 pt-10 pb-6 select-none" style={{ zIndex: 600 }}>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="relative">
              <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
              <select
                disabled={isBusy || isConnected}
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="h-9 w-36 appearance-none rounded-full border border-white/10 bg-white/5 pl-9 pr-8 text-xs text-white/60 outline-none backdrop-blur-xl transition hover:bg-white/10 focus:border-primary/50 disabled:opacity-50 [app-region:no-drag]"
              >
                {VOICES.map(v => <option key={v.id} value={v.id} className="bg-[#1a1a1a] font-sans">{v.name}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-white/30" />
            </label>
            
            {providers.length > 0 && (
              <div className="flex items-center gap-1.5">
                <label className="relative">
                  <Bot className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
                  <select
                    disabled={isBusy || isConnected}
                    value={selectedProviderId}
                    onChange={(e) => setSelectedProviderId(e.target.value)}
                    className="h-9 w-32 appearance-none rounded-full border border-white/10 bg-white/5 pl-9 pr-8 text-xs text-white/60 outline-none backdrop-blur-xl transition hover:bg-white/10 focus:border-primary/50 disabled:opacity-50 [app-region:no-drag]"
                  >
                    {providers.map(p => <option key={p.id} value={p.id} className="bg-[#1a1a1a]">{providerLabel(p.id, p.name)}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-white/30" />
                </label>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger 
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isBusy || isConnected}
                          onClick={clearSessionHandle}
                          className="h-9 w-9 rounded-full bg-white/5 text-white/30 hover:bg-destructive/10 hover:text-destructive transition-colors [app-region:no-drag]"
                        >
                          <Eraser className="h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                    <TooltipContent><p>擦除记忆 (Handle)</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}

            {isConnected && (
              <div className="ml-2 flex items-center gap-2 rounded-full bg-emerald-500/5 px-2.5 py-1 text-[10px] font-medium text-emerald-400/80 border border-emerald-500/10 backdrop-blur-md">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400/50 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                LIVE • {statusText}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (isSharing || isVideoOn) {
                showToast("正在共享屏幕或视频，请先停止后再进入阅读模式", "error");
                return;
              }
              setIsTaskPinned(!isTaskPinned);
            }}
            className={`relative h-10 w-10 rounded-full border border-white/10 backdrop-blur-md transition-all duration-500 ${
              isTaskPinned 
                ? "bg-primary/20 text-primary border-primary/40 shadow-[0_0_15px_rgba(72,255,222,0.2)]" 
                : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
            }`}
          >
            <AppWindow className="h-5 w-5" />
            {isTaskPinned && (
              <span className="absolute -right-1 -top-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
              </span>
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSidePanelOpen(true)}
            className="relative h-10 w-10 rounded-full border border-white/10 bg-white/5 backdrop-blur-md text-white/60 hover:bg-white/10 hover:text-white"
          >
            <ListChecks className="h-5 w-5" />
            {runningTasks.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white shadow-lg">
                {runningTasks.length}
              </span>
            )}
          </Button>

          <Button
            variant={showLogs ? "default" : "ghost"}
            size="icon"
            onClick={() => setShowLogs(!showLogs)}
            className={`h-10 w-10 rounded-full border backdrop-blur-md transition-all duration-300 [app-region:no-drag] ${
              showLogs 
                ? "bg-white! text-black! border-white shadow-[0_0_20px_rgba(255,255,255,0.3)] scale-110" 
                : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Terminal className="h-5 w-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(true)}
            className="h-10 w-10 rounded-full border border-white/10 bg-white/5 backdrop-blur-md text-white/60 hover:bg-white/10 hover:text-white transition-all [app-region:no-drag]"
          >
            <KeyRound className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Main Control Bar */}
      <ControlBar 
        isMuted={isMuted}
        onToggleMute={() => setIsMuted(!isMuted)}
        isVideoOn={isVideoOn}
        onToggleVideo={handleToggleVideo}
        isSharing={isSharing}
        onToggleShare={handleToggleShare}
        showTranscript={showTranscript}
        onToggleTranscript={() => setShowTranscript(!showTranscript)}
        isConnected={isConnected}
        onConnect={startConversation}
        onDisconnect={stopConversation}
        isBusy={isBusy}
      />

      {/* Task Side Panel */}
      <TaskSidePanel 
        isOpen={isSidePanelOpen}
        onClose={() => setIsSidePanelOpen(false)}
        tasks={agentTasks}
        selectedTaskId={selectedTaskId}
        onSelectTask={setSelectedTaskId}
        isPinned={isTaskPinned}
        onTogglePin={() => {
          if (isSharing || isVideoOn) {
            showToast("正在共享屏幕或视频，请先停止后再进入阅读模式", "error");
            return;
          }
          setIsTaskPinned(!isTaskPinned);
        }}
      />

      {/* Settings Dialog */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-panel w-full max-w-md rounded-3xl p-8"
              style={{ zIndex: 800 }}
            >
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-xl font-bold">应用设置</h2>
                <Button variant="ghost" size="icon" onClick={() => setShowSettings(false)} className="rounded-full">
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white/60">Gemini API Key</label>
                  <input 
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={apiKeyConfigured ? "已配置 (留空保留当前密钥)" : "输入你的 Gemini API Key"}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none transition focus:border-primary/50 focus:bg-white/10"
                  />
                  {settingsError && <p className="text-xs text-destructive">{settingsError}</p>}
                </div>

                <div className="flex gap-3 pt-4">
                  <Button 
                    className="flex-1 rounded-xl h-12 bg-emerald-500 text-black hover:bg-emerald-400 font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)]" 
                    onClick={saveApiKey}
                    disabled={isSavingSettings}
                  >
                    {isSavingSettings ? "正在保存..." : "保存设置"}
                  </Button>
                  <Button 
                    variant="outline" 
                    className="flex-1 rounded-xl h-12 border-white/10 bg-white/5 text-white hover:bg-white/10 hover:border-white/20 transition-all" 
                    onClick={runSelfTest}
                    disabled={isBusy}
                  >
                    运行自检
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Progressive Log Area */}
      <AnimatePresence>
        {showLogs && (
          <motion.div 
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
            className="fixed glass-panel rounded-3xl p-6 overflow-hidden flex flex-col shadow-2xl backdrop-blur-3xl border-white/20"
            style={{ 
              width: 'min(550px, 90vw)', 
              height: 'min(700px, 75vh)', 
              right: 'max(16px, 2vw)', 
              top: '128px',
              zIndex: 2000 
            }}
          >
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-white" />
                <h3 className="text-[11px] font-bold text-white uppercase tracking-wider">系统调试控制台</h3>
              </div>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setShowLogs(false)}
                  className="text-white/40 hover:text-white transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <div className="space-y-0.5 font-mono leading-tight">
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-2 group border-b border-white/5 py-0.5 last:border-0 hover:bg-white/5 transition-colors">
                    <span className="text-[9px] text-white/10 select-none w-6 shrink-0 text-right">{i + 1}</span>
                    <span className="text-[10px] text-white/80 group-hover:text-white break-all whitespace-pre-wrap">{log}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Smart Positioning Status Overlay - TOP LAYER */}
      <div className={`pointer-events-none fixed z-200 transition-all duration-500 ${
        (isSharing || isTaskPinned || isVideoOn) 
          ? "bottom-24 right-8 w-full max-w-sm" 
          : "bottom-24 left-1/2 w-full max-w-4xl -translate-x-1/2 px-8"
      }`}>
        <TranscriptOverlay 
          messages={transcript} 
          visible={showTranscript && isConnected && status !== "idle"} 
          pinned={isSharing || isTaskPinned || isVideoOn}
        />
      </div>

      {/* Compact Orb (Only in content modes) - TOP LAYER */}
      {(isSharing || isTaskPinned || isVideoOn) && (
        <div className="pointer-events-none fixed bottom-8 right-8 z-200 scale-75 transform origin-right">
          <SmartOrb
            volume={volume}
            features={audioFeatures}
            status={status}
            compact={true}
          />
        </div>
      )}

      {/* Hidden canvas for vision sampling - ALWAYS MOUNTED */}
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </main>
  );
}

function TaskStatusIcon({ phase }: { phase?: AgentTaskPhase }) {
  switch (phase) {
    case "completed":
      return <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />;
    case "failed":
      return <div className="h-1.5 w-1.5 rounded-full bg-rose-400" />;
    case "running":
      return <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />;
    default:
      return <div className="h-1.5 w-1.5 rounded-full bg-white/20" />;
  }
}
