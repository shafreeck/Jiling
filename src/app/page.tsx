"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { FunctionResponse } from "@google/genai";
import {
  Activity,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Clock,
  Eraser,
  ListChecks,
  Mic,
  Minimize2,
  PanelRight,
  Radio,
  Loader2,
  RotateCw,
  Sparkles,
  Terminal,
  Layers,
  VideoOff,
  X,
  AppWindow,
  ListTodo,
  LogOut,
  Maximize2,
  Languages,
  MessageCircle,
  XCircle,
  History as HistoryIcon,
  Pin,
  PinOff,
  Cpu,
  Settings,
} from "lucide-react";
import { AuraRenderer } from "@/components/AuraRenderer";
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
import { WechatLoginModal } from "@/components/WechatLoginModal";
import { SettingsModal } from "@/components/SettingsModal";

type VoiceStatus = "idle" | "listening" | "thinking" | "speaking";
type ToolCall = NonNullable<LiveMessage["toolCall"]>;
type AgentTaskPhase = "submitted" | "running" | "completed" | "failed" | "cancelled" | "lost";

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
  silent?: boolean;
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
  { id: "none", name: "Native (原生模型音色)" },
  { id: "Puck", name: "Puck (友好/热情 - 男中音)" },
  { id: "Charon", name: "Charon (冷静/权威 - 男低音)" },
  { id: "Kore", name: "Kore (温暖/专业 - 女中音)" },
  { id: "Fenrir", name: "Fenrir (活力/动感 - 男中音)" },
  { id: "Aoede", name: "Aoede (清晰/通透 - 女中音)" },
  { id: "Sadaltager", name: "Sadaltager (低沉/稳重 - 男声)" },
  { id: "Orus", name: "Orus (平实/自然 - 男声)" },
  { id: "Zephyr", name: "Zephyr (轻快/温润 - 男声)" },
  { id: "Iapetus", name: "Iapetus (浑厚/有力 - 男声)" },
  { id: "Umbriel", name: "Umbriel (沉稳/磁性 - 男声)" },
  { id: "Algieba", name: "Algieba (明亮/干练 - 男声)" },
  { id: "Achird", name: "Achird (随性/亲和 - 男声)" },
  { id: "Algenib", name: "Algenib (深邃/感性 - 男声)" },
];

const LANGUAGES = [
  { id: "auto", name: "自动识别" },
  { id: "zh-CN", name: "中文 (简体)" },
  { id: "en-US", name: "English (US)" },
  { id: "ja-JP", name: "日本語" },
  { id: "ko-KR", name: "한국어" },
  { id: "fr-FR", name: "Français" },
  { id: "de-DE", name: "Deutsch" },
  { id: "es-ES", name: "Español" },
  { id: "pt-BR", name: "Português" },
  { id: "it-IT", name: "Italiano" },
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
  return compact;
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

  async addPcm16(base64: string) {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
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

async function playReadySound(context: AudioContext) {
  if (context.state === "suspended") {
    await context.resume();
  }
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

const JILING_SKILLS = `\n\n## Jiling A2UI
Standard Markdown responses are first-class citizens and have the same status as A2UI cards. For natural reading content like literature, poems, and long articles, you are encouraged to use standard Markdown directly if no structured interaction is needed.

For tasks requiring structured visualization or approval (like lists, charts, approvals), you can return the standard A2UI JSON. Do not use cards unnecessarily.

Available components:
- "ApprovalCard": For task approvals or confirmations. Props: { "title": string, "description": string, "severity": "info"|"warning"|"critical", "actionLabel": string }. Note: "description" supports Markdown (tables, formatting).
- "CodeReviewCard": For code reviews. Props: { "files": Array<{ "filename": string, "content": string, "language": string }> }
- "NoteCard": For displaying markdown notes or summaries. Props: { "content": string }
- "ChartCard": For displaying charts. Props: { "title": string, "type": "line"|"bar", "data": Array<{ "label": string, "value": number }>, "color"?: string }
- "TaskListCard": For displaying lists of tasks. Props: { "title": string, "tasks": Array<{ "id": string, "title": string, "completed": boolean, "description"?: string, "cancelled"?: boolean }> }
- "CanvasCard": For displaying topology graphs (mind maps, task flows). Props: { "nodes": Array<{ "id": string, "label": string, "color": "red"|"green"|"blue"|"yellow"|"orange", "size"?: "small"|"medium"|"large" }>, "links": Array<{ "source": string, "target": string, "label"?: string }> }

Output format: { "type": "a2ui", "requestId": "unique_id", "summary": "A human-readable summary of the card (for logs and voice fallback)", "payload": { "component": "ComponentName", "props": {...} } }
Note: If you output A2UI, return ONLY the JSON without any other text.`;

export default function JilingPage() {
  const [status, setStatusState] = useState<VoiceStatus>("idle");
  const [isConnected, setIsConnected] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [volume, setVolume] = useState(0);
  const [audioFeatures, setAudioFeatures] = useState<AudioFeatures>(DEFAULT_AUDIO_FEATURES);
  const [logs, setLogs] = useState<string[]>(["系统就绪，等待语音指令..."]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const providersRef = useRef<ProviderOption[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("openclaw");
  const [selectedVoice, setSelectedVoice] = useState<string>("none");
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const isHydratedRef = useRef(false);

  const [focusMode, setFocusMode] = useState(true);
  const [enableA2UI, setEnableA2UI] = useState(true);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInputValue, setTextInputValue] = useState("");
  const [isSubmittingText, setIsSubmittingText] = useState(false);
  const isComposingRef = useRef(false);
  const [isTextInputPinned, setIsTextInputPinned] = useState(false);
  const textInputRef = useRef<HTMLDivElement>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [isWechatConnected, setIsWechatConnected] = useState<boolean>(false);
  const [wechatQrCodeUrl, setWechatQrCodeUrl] = useState<string | null>(null);
  const [isWechatModalOpen, setIsWechatModalOpen] = useState(false);
  const [wechatLoginStatus, setWechatLoginStatus] = useState<"idle" | "logging_in" | "success" | "error">("idle");
  const [wechatError, setWechatError] = useState<string | undefined>(undefined);
  const tickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-connect Wechat on startup if it was previously enabled
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("jiling_wechat_enabled") === "true";
      console.log("[Wechat] Initialized from localStorage:", saved);
      if (saved) {
        setIsWechatConnected(true);
        console.log("[Wechat] Auto-connecting previously enabled WeChat service...");
        invoke("wechat_login").catch(e => {
          console.error("[Wechat] Auto-connection failed:", e);
          setIsWechatConnected(false);
          localStorage.setItem("jiling_wechat_enabled", "false");
        });
      }
    }
  }, []);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen("acp-tick", () => {
        setIsOnline(true);
        if (tickTimeoutRef.current) {
          clearTimeout(tickTimeoutRef.current);
        }
        tickTimeoutRef.current = setTimeout(() => setIsOnline(false), 15000);
      });
      unlistenFn = unlisten;
    };

    setup();

    return () => {
      if (unlistenFn) unlistenFn();
      if (tickTimeoutRef.current) clearTimeout(tickTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen("acp-models-updated", (event: any) => {
        const payload = event.payload as any;
        console.log(`[ACP] Models updated for provider ${payload.provider_id}`, payload.models);
        
        // 如果当前选中的正是这个 Provider，刷新模型列表
        if (payload.provider_id === selectedProviderIdRef.current) {
          setAvailableModels(payload.models);
          if (payload.models.length > 0 && !selectedModelRef.current) {
             setSelectedModel(payload.models[0].id);
          }
        }
      });
      unlistenFn = unlisten;
    };
    setup();
    return () => { if (unlistenFn) unlistenFn(); };
  }, []);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen("wechat-event", (event: any) => {
        const payload = event.payload as any;
        if (payload.method === "qr_code_url") {
          setWechatQrCodeUrl(payload.params.url);
          setWechatLoginStatus("logging_in");
        } else if (payload.method === "status") {
          console.log("[Wechat] Status change:", payload.params.state);
          if (payload.params.state === "ready") {
            setIsWechatConnected(true);
            localStorage.setItem("jiling_wechat_enabled", "true");
            setWechatLoginStatus("success");
            setTimeout(() => setIsWechatModalOpen(false), 5000);
          } else if (payload.params.state === "error") {
            console.error("[Wechat] Gateway error:", payload.params.error);
            setWechatError(payload.params.error);
            setWechatLoginStatus("error");
            setIsWechatConnected(false);
            localStorage.setItem("jiling_wechat_enabled", "false");
          }
        } else if (payload.method === "message_received") {
          handleWechatMessage(payload.params);
        }
      });
      unlistenFn = unlisten;
    };
    setup();
    return () => { if (unlistenFn) unlistenFn(); };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowTextInput((prev) => {
          const next = !prev;
          if (next) {
            setIsTaskPinned(true);
          }
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 当选择的 Provider 改变时，同步更新 adapterRef，无需等待语音启动
  useEffect(() => {
    providersRef.current = providers;
    const selected = providers.find(p => p.id === selectedProviderId);
    if (selected) {
      adapterRef.current = selected.adapter;
      
      if (selected.adapter.listModels) {
        selected.adapter.listModels().then(models => {
          setAvailableModels(models);
          if (models.length > 0) {
            setSelectedModel(prev => {
              const currentValid = models.find(m => m.id === prev);
              const nextModelId = currentValid ? prev : models[0].id;
              
              // 自动对齐模型状态到后端
              if (selected.adapter.switchModel && nextModelId) {
                selected.adapter.switchModel(nextModelId);
              }
              
              return nextModelId;
            });
          } else {
            setSelectedModel(null);
          }
        });
      } else {
        setAvailableModels([]);
        setSelectedModel(null);
      }
    }
  }, [selectedProviderId, providers]);

  const handleModelChange = (modelId: string) => {
    if (modelId === selectedModel) return;
    setSelectedModel(modelId);
    if (adapterRef.current?.switchModel) {
      adapterRef.current.switchModel(modelId);
    }
  };
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" } | null>(null);

  const showToast = (message: string, type: "info" | "error" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("jiling_selected_language");
      if (saved) return saved;
      // Auto-detect from system environment
      const sysLang = navigator.language;
      if (sysLang.startsWith("zh")) return "zh-CN";
      if (sysLang.startsWith("en")) return "en-US";
      if (sysLang.startsWith("ja")) return "ja-JP";
      if (sysLang.startsWith("ko")) return "ko-KR";
      if (sysLang.startsWith("fr")) return "fr-FR";
      if (sysLang.startsWith("de")) return "de-DE";
      if (sysLang.startsWith("es")) return "es-ES";
      return "auto";
    }
    return "auto";
  });
  const [agentTasks, setAgentTasks] = useState<AgentTaskView[]>([]);
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(null);
  const [apiKeySource, setApiKeySource] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const activeTask = useMemo(() => {
    return agentTasks.find((task) => task.runId === selectedTaskId) || agentTasks[0];
  }, [agentTasks, selectedTaskId]);
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

  // Load initial tasks from database
  useEffect(() => {
    const loadTasks = async () => {
      try {
        const history = await invoke<any[]>("list_agent_tasks");
        const mappedTasks: AgentTaskView[] = history.map(t => ({
          runId: t.run_id,
          title: t.message,
          providerName: t.provider_id,
          phase: (t.status === "end" || t.status === "completed") ? "completed" : t.status as AgentTaskPhase,
          startedAt: new Date(t.created_at).getTime(),
          updatedAt: new Date(t.updated_at).getTime(),
          progress: [], // Progress is not persisted individually for now
          output: t.output,
          silent: t.silent,
          error: t.status === "failed" ? t.message : undefined
        }));
        setAgentTasks(mappedTasks);
      } catch (e) {
        console.error("Failed to load task history:", e);
      }
    };
    loadTasks();
  }, []);

  const selectedVoiceRef = useRef(selectedVoice);
  const selectedProviderIdRef = useRef(selectedProviderId);
  const selectedModelRef = useRef(selectedModel);
  const selectedLanguageRef = useRef(selectedLanguage);
  const isMutedRef = useRef(isMuted);
  useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => { selectedProviderIdRef.current = selectedProviderId; }, [selectedProviderId]);
  useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);
  useEffect(() => { selectedLanguageRef.current = selectedLanguage; }, [selectedLanguage]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  
  // Auto-hide text input when clicking away (if not pinned)
  useEffect(() => {
    const handleClickAway = (e: MouseEvent) => {
      if (showTextInput && !isTextInputPinned && textInputRef.current && !textInputRef.current.contains(e.target as Node)) {
        // Check if the click was on the keyboard toggle button in the control bar to avoid immediate closing when opening
        const controlBarKeyboardBtn = document.querySelector('[data-keyboard-toggle="true"]');
        if (controlBarKeyboardBtn && controlBarKeyboardBtn.contains(e.target as Node)) {
          return;
        }
        setShowTextInput(false);
      }
    };

    document.addEventListener("mousedown", handleClickAway);
    return () => document.removeEventListener("mousedown", handleClickAway);
  }, [showTextInput, isTextInputPinned]);

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
    const savedLang = localStorage.getItem("jiling_selected_language");
    const savedModel = localStorage.getItem("jiling_selected_model");
    if (savedVoice) setSelectedVoice(savedVoice);
    if (savedProvider) setSelectedProviderId(savedProvider);
    if (savedLogs === "true") setShowLogs(true);
    if (savedLang) setSelectedLanguage(savedLang);
    if (savedModel) setSelectedModel(savedModel);
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
    localStorage.setItem("jiling_selected_model", selectedModel || "");
  }, [selectedModel]);

  useEffect(() => {
    if (!isHydratedRef.current) return;
    localStorage.setItem("jiling_show_logs", String(showLogs));
  }, [showLogs]);

  useEffect(() => {
    if (!isHydratedRef.current) return;
    localStorage.setItem("jiling_selected_language", selectedLanguage);
  }, [selectedLanguage]);

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

  const handleWechatMessage = async (params: any) => {
    const { text, media, requestId } = params;

    let targetProviderId = selectedProviderIdRef.current;
    let cleanText = text;

    // Route based on @ mention
    if (text.toLowerCase().startsWith("@openclaw")) {
      targetProviderId = "openclaw";
      cleanText = text.substring(9).trim();
      console.log("[Wechat] Routing to OpenClaw:", cleanText);
    } else if (text.toLowerCase().startsWith("@autoclaw")) {
      targetProviderId = "autoclaw";
      cleanText = text.substring(9).trim();
      console.log("[Wechat] Routing to AutoClaw:", cleanText);
    }

    // Find the adapter for the target provider
    console.log("[Wechat] Attempting to route to:", targetProviderId);
    console.log("[Wechat] Available providers:", providersRef.current.map(p => p.id));

    const provider = providersRef.current.find(p => p.id === targetProviderId);
    const adapter = provider?.adapter;

    if (!adapter) {
      console.error("[Wechat] No adapter found for provider:", targetProviderId);
      invoke("wechat_respond", {
        requestId,
        payload: { text: "抱歉，微信服务尚未准备就绪，请稍后再试。" }
      });
      return;
    }

    try {
      const taskRef = await adapter.submitTask({
        identity: {
          systemName: "机灵",
          runtimeRoleDescription: "你正在通过微信与用户交流，请保持回复简洁且适合移动端阅读。",
          mode: "background_core",
          userFacingRole: "same_assistant"
        },
        userRequest: cleanText,
        model: selectedModelRef.current || undefined,
        attachments: media ? [media] : undefined,
        conversationContext: { recentUserIntent: cleanText, locale: selectedLanguageRef.current },
        executionPolicy: { askBeforeRiskyChanges: true, preferConciseProgress: true, produceSpeakableSummary: true },
        outputContract: { format: "markdown_with_titles", requireSpeakableSummary: true, requireSpokenReport: false },
        silent: true,
      });

      upsertTask({
        runId: taskRef.runId,
        title: `[微信] ${taskTitleFromRequest(cleanText)}`,
        providerName: provider?.name || providerLabel(targetProviderId),
        phase: "submitted",
        startedAt: Date.now(),
        updatedAt: Date.now(),
        progress: [],
        silent: true,
      });

      void adapter.subscribeTask(taskRef, {
        onProgress: (e) => {
          appendTaskProgress(taskRef.runId, e.text);
        },
        onOutputUpdate: (e) => {
          appendTaskOutput(taskRef.runId, e.output);
        },
        onCompleted: (e) => {
          let outputText = formatTaskOutput(e.output);

          // Strip A2UI JSON blocks for Wechat
          outputText = outputText.replace(/```json\s*\{[\s\S]*?"type":\s*"a2ui"[\s\S]*?\}\s*```/g, '').trim();

          if (!outputText && typeof e.output !== "string") {
            outputText = e.output.speakableSummary || e.output.title;
          }

          updateTask(taskRef.runId, { phase: "completed", output: outputText });

          // Reply back to Wechat
          invoke("wechat_respond", {
            requestId,
            payload: { text: outputText }
          });

          if (clientRef.current) {
            clientRef.current.sendSystemUpdate(
              `Wechat task completed. Result has been sent back to the user.\nResult: ${outputText}`
            );
          }
        },
        onFailed: (e) => {
          updateTask(taskRef.runId, { phase: "failed", error: e.error });
          invoke("wechat_respond", {
            requestId,
            payload: { text: `抱歉，执行失败：${e.error}` }
          });
        }
      });
    } catch (error) {
      console.error("Failed to handle wechat message:", error);
      invoke("wechat_respond", {
        requestId,
        payload: { text: `抱歉，系统处理出错：${error instanceof Error ? error.message : String(error)}` }
      });
    }
  };

  const handleTextInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 如果正在使用输入法组词，不触发发送
    if (isComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (e.key === 'Enter' || e.keyCode === 13) {
      if (!e.shiftKey) {
        e.preventDefault();
        handleSubmitText();
      }
    }
  };

  const handleSubmitText = async () => {
    if (!textInputValue.trim() || isSubmittingText) return;
    setIsSubmittingText(true);

    const adapter = adapterRef.current;
    if (!adapter) {
      showToast("后台代理未就绪，请稍后再试", "error");
      return;
    }

    try {
      const taskRef = await adapter.submitTask({
        identity: {
          systemName: "机灵",
          runtimeRoleDescription: enableA2UI ? JILING_SKILLS : "",
          mode: "background_core",
          userFacingRole: "same_assistant"
        },
        userRequest: textInputValue,
        conversationContext: { recentUserIntent: textInputValue, locale: selectedLanguageRef.current },
        executionPolicy: { askBeforeRiskyChanges: true, preferConciseProgress: false, produceSpeakableSummary: true },
        outputContract: { format: "markdown_with_titles", requireSpeakableSummary: true, requireSpokenReport: true },
        silent: true,
      });

      upsertTask({
        runId: taskRef.runId,
        title: taskTitleFromRequest(textInputValue),
        providerName: providersRef.current.find(p => p.id === selectedProviderIdRef.current)?.name || providerLabel(selectedProviderIdRef.current),
        phase: "submitted",
        startedAt: Date.now(),
        updatedAt: Date.now(),
        progress: [],
        silent: true,
      });

      void adapter.subscribeTask(taskRef, {
        onProgress: (e) => {
          addLog(`[代理] ${e.text}`);
          appendTaskProgress(taskRef.runId, e.text);
        },
        onOutputUpdate: (e) => {
          appendTaskOutput(taskRef.runId, e.output);
        },
        onCompleted: (e) => {
          const outputText = formatTaskOutput(e.output);
          updateTask(taskRef.runId, {
            phase: "completed",
            output: outputText,
          });
          if (clientRef.current) {
            clientRef.current.sendSystemUpdate(
              `Background task completed. runId: ${taskRef.runId}\n\nExecution results are as follows:\n${outputText}\n\nPlease actively and completely report this task result in the first person and a voice-friendly manner when the user is idle.`
            );
          }
        },
        onFailed: (e) => {
          addLog(`[任务] 失败: ${e.error}`);
          updateTask(taskRef.runId, { phase: "failed", error: e.error });
        },
        onCancelled: (e) => {
          updateTask(taskRef.runId, { phase: "cancelled", error: e.reason });
        },
      });

      setTextInputValue("");
      if (!isTextInputPinned) {
        setShowTextInput(false);
      }
      showToast("任务已提交至后台");
    } catch (error) {
      console.error("Failed to submit text task:", error);
      showToast("提交任务失败", "error");
    } finally {
      setIsSubmittingText(false);
    }
  };

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

  const saveApiKey = async (apiKey: string) => {
    setIsSavingSettings(true);
    setSettingsError(null);

    try {
      await invoke("set_api_key", { apiKey });
      GeminiLiveClient.resetApiClient();
      const status = await refreshApiKeyStatus();
      setShowSettings(false);
      addLog(status.configured ? "[设置] Gemini API Key 已保存" : "[设置] Gemini API Key 已清除");
    } catch (error: unknown) {
      setSettingsError(errorMessage(error));
      throw error;
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

  const appendTaskOutput = (runId: string, text: string) => {
    setAgentTasks((prev) =>
      prev.map((t) => {
        if (t.runId !== runId) return t;

        let newOutput = t.output || "";
        // 如果新到的文本包含了已有的内容（说明是快照模式），则直接替换
        if (text.length > newOutput.length && text.startsWith(newOutput)) {
          newOutput = text;
        } else {
          // 否则按增量拼接
          newOutput += text;
        }

        return { ...t, output: newOutput, updatedAt: Date.now() };
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
      await context.close().catch(() => { });
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
    const client = new GeminiLiveClient(profile, {
      voiceName: selectedVoice,
      languageCode: selectedLanguage,
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
    client.voiceName = selectedVoiceRef.current;
    return client;
  };

  useEffect(() => {
    const probeProviders = async () => {
      console.log("[Provider] Probing for providers...");
      try {
        const home = await import("@tauri-apps/api/path").then(m => m.homeDir());
        const { exists } = await import("@tauri-apps/plugin-fs");
        const detected: ProviderOption[] = [];

        console.log("[Provider] Home dir:", home);

        if (await exists(home + "/.openclaw")) {
          console.log("[Provider] Found .openclaw");
          detected.push({ id: "openclaw", name: "OpenClaw", adapter: new AcpProviderAdapter("openclaw", "OpenClaw", ".openclaw") });
        }
        if (await exists(home + "/.openclaw-autoclaw")) {
          console.log("[Provider] Found .openclaw-autoclaw");
          detected.push({ id: "autoclaw", name: "AutoClaw", adapter: new AcpProviderAdapter("autoclaw", "AutoClaw", ".openclaw-autoclaw") });
        }
        if (await exists(home + "/.hermes")) {
          console.log("[Provider] Found .hermes");
          detected.push({ id: "hermes", name: "Hermes", adapter: new AcpProviderAdapter("hermes", "Hermes", ".hermes") });
        }

        console.log("[Provider] Detected providers:", detected.map(p => p.id));

        if (detected.length > 0) {
          setProviders(detected);
          providersRef.current = detected; // Immediate update for ref
          const savedProvider = localStorage.getItem("jiling_provider");
          if (!savedProvider || !detected.find(p => p.id === savedProvider)) {
            console.log("[Provider] Setting default provider:", detected[0].id);
            setSelectedProviderId(detected[0].id);
          } else {
            console.log("[Provider] Using saved provider:", savedProvider);
            setSelectedProviderId(savedProvider);
          }
        } else {
          console.warn("[Provider] No providers detected!");
        }
      } catch (e) {
        console.error("[Provider] Detection failed:", e);
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
      if (context.state === "suspended") await context.resume();
      audioContextRef.current = context;

      const streamer = new AudioStreamer(context);
      streamer.onDrained = () => {
        if (statusRef.current === "speaking") setStatus("listening");
      };
      streamer.onSamples = updateAudioFeatures;
      streamerRef.current = streamer;

      let profile: AgentRuntimeProfile | undefined;
      const selected = providersRef.current.find(p => p.id === selectedProviderIdRef.current);
      if (selected) {
        adapterRef.current = selected.adapter;
        profile = await selected.adapter.agentProfile();
        profileRef.current = profile;
        addLog(`[系统] 使用代理：${providerLabel(selected.id, selected.name)}`);
      }

      const client = createClient(profile);
      client.voiceName = selectedVoice; // 同步当前选中的声音
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
    if (!text) return "";
    const cjkRegex = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;
    return Array.from(text).reduce((acc, char, i, arr) => {
      if (char === ' ' || char === '\u00A0' || char === '\u3000') {
        const prev = arr[i - 1];
        const next = arr[i + 1];
        if ((prev && cjkRegex.test(prev)) || (next && cjkRegex.test(next))) {
          return acc;
        }
      }
      return acc + char;
    }, "");
  };

  const handleLiveMessage = async (message: LiveMessage) => {
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
          await streamerRef.current?.addPcm16(part.inlineData.data);
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
            text: cleanTranscriptText(text),
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
        await playReadySound(audioContextRef.current);
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
          const selectedProvider = providersRef.current.find((provider) => provider.id === selectedProviderIdRef.current);
          const taskText = String(callArgs.task || "");
          const useCards = Boolean(callArgs.use_cards) && enableA2UI;
          const taskRef = await adapter.submitTask({
            identity: {
              systemName: "机灵",
              runtimeRoleDescription: useCards ? JILING_SKILLS : "",
              mode: "background_core",
              userFacingRole: "same_assistant"
            },
            userRequest: taskText,
            conversationContext: { recentUserIntent: taskText, locale: selectedLanguage },
            executionPolicy: { askBeforeRiskyChanges: true, preferConciseProgress: false, produceSpeakableSummary: true },
            outputContract: { format: "markdown_with_titles", requireSpeakableSummary: true, requireSpokenReport: true },
          });
          result = {
            status: "submitted",
            completed: false,
            runId: taskRef.runId,
            message: "Background task submitted but not yet complete. Inform the user that the task is processing in the background. DO NOT claim the task is finished or hallucinate results. You may only report the final outcome once you receive a 'Background task completed' system event.",
          };

          upsertTask({
            runId: taskRef.runId,
            title: taskTitleFromRequest(taskText),
            providerName: selectedProvider?.id || taskRef.providerId,
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
            onOutputUpdate: (e) => {
              appendTaskOutput(taskRef.runId, e.output);
            },
            onCompleted: (e) => {
              const outputText = formatTaskOutput(e.output);
              updateTask(taskRef.runId, {
                phase: "completed",
                output: outputText,
              });
              clientRef.current?.sendSystemUpdate(
                `Background task completed. runId: ${taskRef.runId}\n\nExecution results are as follows:\n${outputText}\n\nPlease actively and completely report this task result in the first person and a voice-friendly manner when the user is idle. Do not just give a one-sentence brief summary; keep key details, conclusions, file changes, verification results, and follow-up suggestions.`
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
    const pId = selectedProviderIdRef.current;
    if (!pId) return;
    GeminiLiveClient.clearStoredHandle(pId);
    addLog(`[系统] 已擦除 ${pId} 的会话记忆。下次连接将开始新对话。`);
  };

  const handleAbortTask = async (runId: string) => {
    try {
      await invoke("abort_agent_task", { runId });
      addLog(`[任务] 已发送终止请求: ${runId}`);
      setAgentTasks(prev => prev.map(t =>
        t.runId === runId ? { ...t, phase: "cancelled", error: "已手动终止" } : t
      ));
    } catch (error: unknown) {
      addLog(`[任务] 终止失败: ${errorMessage(error)}`);
    }
  };

  const handleTaskA2UIAction = async (runId: string, action: string, data: any) => {
    const task = agentTasks.find(t => t.runId === runId);
    if (!task || typeof task.output !== "string") return;

    try {
      // 1. Update the output string to persist the state using a robust scanner
      let updatedOutput: string = task.output;
      const status = action === "approve" ? "approved" :
        action === "reject" ? "rejected" : "dismissed";

      const sections = updatedOutput.split('\n\n___JILING_STEP_SEPARATOR___\n\n');
      const lastSectionIdx = sections.length - 1;
      let targetSection = sections[lastSectionIdx];

      let patched = false;
      // Robust scanning for JSON blocks in the LAST section only
      let startIndex = 0;
      while (true) {
        const keywordIndex = targetSection.indexOf('"type"', startIndex);
        if (keywordIndex === -1) break;

        // Move to next search starting point to avoid infinite loop
        startIndex = keywordIndex + 6;

        // Find the start of the object {
        const objectStart = targetSection.lastIndexOf('{', keywordIndex);
        if (objectStart === -1) continue;

        // Find the matching } using bracket balancing
        let braceCount = 0;
        let objectEnd = -1;
        for (let i = objectStart; i < targetSection.length; i++) {
          if (targetSection[i] === '{') braceCount++;
          else if (targetSection[i] === '}') braceCount--;

          if (braceCount === 0) {
            objectEnd = i + 1;
            break;
          }
        }

        if (objectEnd !== -1) {
          const rawJson = targetSection.substring(objectStart, objectEnd);
          try {
            const payload = JSON.parse(rawJson);
            if (payload.type === "a2ui" && payload.payload) {
              // Defensive patching: support both nested props and flattened structure
              if (payload.payload.props) {
                payload.payload.props.status = status;
              } else {
                payload.payload.status = status;
              }

              const newJson = JSON.stringify(payload, null, 2);
              targetSection = targetSection.substring(0, objectStart) + newJson + targetSection.substring(objectEnd);
              sections[lastSectionIdx] = targetSection;
              updatedOutput = sections.join('\n\n___JILING_STEP_SEPARATOR___\n\n');
              patched = true;
              break; // Found and patched the block
            }
          } catch (e) {
            // Not a valid JSON block, continue searching
          }
        }
      }

      if (!patched) {
        // Fallback for NoteCards or plain text payloads that lack a valid A2UI JSON block.
        // We append a hidden HTML comment to persist the status, which `activeA2UITask` will detect.
        targetSection += `\n\n<!-- "status": "${status}" -->`;
        sections[lastSectionIdx] = targetSection;
        updatedOutput = sections.join('\n\n___JILING_STEP_SEPARATOR___\n\n');
      }

      // 2. Update local state
      setAgentTasks(prev => prev.map(t =>
        t.runId === runId ? { ...t, output: updatedOutput } : t
      ));

      // 3. Persistent to DB
      await invoke("update_agent_task_output", { runId, output: updatedOutput });

      // 4. Send feedback to Agent
      // We try to extract requestId from the data or props
      const requestId = data?.requestId || "default";
      const agentId = task.providerName || "main";

      const adapter = providersRef.current.find(p => p.id === selectedProviderId)?.adapter;

      if (!adapter) {
        throw new Error(`找不到对应的 Provider: ${selectedProviderId}`);
      }

      if (action === "dismiss") {
        addLog(`[A2UI] 忽略单纯的 dismiss 动作 (requestId: ${requestId})`);
        return;
      }

      const feedbackData = {
        type: "a2ui_feedback",
        requestId,
        action,
        data: data || {}
      };

      const message = `[A2UI Feedback] This is the approval result for the previous task, please continue execution based on this result:\n\n${JSON.stringify(feedbackData)}\n\nIMPORTANT: You MUST wrap any further A2UI output strictly in \`\`\`json blocks!`;

      // 将原任务重新置为 running 状态，视觉上继续执行
      updateTask(runId, { phase: "running" });

      const taskView = agentTasks.find(t => t.runId === runId);
      await invoke("execute_agent_acp_task", {
        providerId: taskView?.providerName || selectedProviderId,
        agent: "main", 
        task: message,
        systemInstruction: "",
        attachments: [],
        silent: true
      });

      addLog(`[A2UI] 审批结果已沿用原链路下发: ${action === "approve" ? "允许" : "拒绝"} (Task: ${runId})`);
    } catch (error: unknown) {
      addLog(`[A2UI] 操作处理失败: ${errorMessage(error)}`);
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
      audioContextRef.current?.close().catch(() => { });
    };
  }, []);


  const runningTasks = agentTasks.filter((task) => task.phase === "submitted" || task.phase === "running");

  // Detect if any task has an active A2UI payload that needs attention
  const [dismissedA2UIs, setDismissedA2UIs] = useState<Map<string, string>>(new Map());
  const activeA2UITask = useMemo(() => {
    // Find the most recent task that has an A2UI payload in its output
    const a2uiTask = [...agentTasks]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .find(t => {
        if (t.silent) return false;
        if (t.phase !== "running" && t.phase !== "submitted" && t.phase !== "completed") return false;
        if (!t.output) return false;
        if (dismissedA2UIs.get(t.runId) === t.output) return false;
        const sections = t.output.split('\n\n___JILING_STEP_SEPARATOR___\n\n');
        const lastSection = sections[sections.length - 1].trim();

        // Simple check for A2UI JSON structure in the LAST section only
        const hasA2UI = lastSection.includes('"type": "a2ui"') && lastSection.includes('"payload"');
        if (!hasA2UI) return false;

        // If it's already approved, rejected or dismissed, don't show the popup
        const isHandled = lastSection.includes('"status": "approved"') ||
          lastSection.includes('"status": "rejected"') ||
          lastSection.includes('"status": "dismissed"');
        return !isHandled;
      });
    return a2uiTask;
  }, [agentTasks, dismissedA2UIs]);

  const readingModeContent = (isTaskPinned && !isSharing && !isVideoOn) ? (
    <div className="flex h-full w-full flex-col overflow-hidden bg-black selection:bg-blue-600/40">
      <style dangerouslySetInnerHTML={{
        __html: `
        .reading-mode-content ::selection {
          background-color: rgba(59, 130, 246, 0.4) !important;
        }
        .reading-mode-content *::selection {
          background-color: rgba(59, 130, 246, 0.4) !important;
        }
      ` }} />

      {/* Floating Close Button */}
      <div className="absolute right-6 top-6 z-50">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsTaskPinned(false)}
          className="h-10 w-10 rounded-full bg-white/5 text-white/40 hover:bg-white/10 hover:text-white transition-all backdrop-blur-md border border-white/5 shadow-2xl"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden reading-mode-content">
        <ScrollArea className="h-full w-full">
          <div className="p-10 pt-6 pb-40 max-w-4xl mx-auto">
            {activeTask ? (
              <div className="space-y-2">
                {/* Unified Header Block */}
                <div>
                  <h3 className="text-sm font-bold text-white leading-tight line-clamp-2">{activeTask.title}</h3>

                  <details className="mt-3 group">
                    <summary className="flex items-center cursor-pointer text-[10px] text-white/30 hover:text-white/50 transition-colors list-none">
                      <ChevronDown className="h-3 w-3 mr-1 transition-transform group-open:rotate-180" />
                      <span>查看原始请求内容</span>
                    </summary>
                    <div className="mt-2 p-4 rounded-xl bg-white/3 border border-white/5 text-[11px] text-white/50 leading-relaxed italic whitespace-pre-wrap wrap-break-word overflow-hidden">
                      {activeTask.title}
                    </div>
                  </details>

                  <div className="mt-4 flex items-center gap-3">
                    <div className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${activeTask.phase === "completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                      activeTask.phase === "running" ? "bg-primary/10 text-primary border border-primary/20 animate-pulse" :
                        "bg-white/5 text-white/40 border border-white/10"
                      }`}>
                      {activeTask.phase === "completed" ? "已完成" : activeTask.phase === "running" ? "正在执行" : "等待中"}
                    </div>
                    <span className="text-[10px] text-white/30 font-mono uppercase tracking-widest">{activeTask.providerName}</span>
                  </div>
                </div>

                <div className="h-px w-full bg-linear-to-r from-transparent via-white/10 to-transparent" />

                {/* Output Content */}
                {activeTask.output ? (
                  <div className="w-full max-w-none wrap-break-word overflow-x-hidden font-sans">
                    <AuraRenderer
                      content={activeTask.output}
                      onAction={(action, data) => handleTaskA2UIAction(activeTask.runId, action, data)}
                    />
                  </div>
                ) : (activeTask.error || activeTask.phase === "cancelled" || activeTask.phase === "lost") ? (
                  <div className={`rounded-lg p-6 border ${activeTask.phase === "cancelled"
                    ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                    : activeTask.phase === "lost"
                      ? "bg-white/5 text-white/40 border-white/10"
                      : "bg-destructive/10 text-destructive border-destructive/20"
                    }`}>
                    <div className="flex items-center gap-3 font-bold mb-2">
                      {activeTask.phase === "lost" ? <HistoryIcon className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                      <span>{
                        activeTask.phase === "cancelled" ? "任务已终止" :
                          activeTask.phase === "lost" ? "任务状态丢失" :
                            "执行失败"
                      }</span>
                    </div>
                    <p className="opacity-90">
                      {activeTask.phase === "lost" ? "由于 Agent 连接异常中断，该任务已无法继续追踪。" : (activeTask.error || "未知错误")}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-40 text-center">
                    <motion.div 
                      animate={{ 
                        scale: [1, 1.1, 1],
                        rotate: [0, 5, -5, 0]
                      }}
                      transition={{ 
                        duration: 5, 
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                      className="relative h-20 w-20 rounded-3xl bg-linear-to-br from-primary/40 to-primary/10 flex items-center justify-center mb-10 border border-white/20 shadow-[0_0_30px_rgba(var(--primary),0.3)]"
                    >
                      <div className="absolute inset-0 blur-2xl bg-primary/30 rounded-full animate-pulse" />
                      <Sparkles className="h-10 w-10 text-white relative z-10 drop-shadow-[0_0_15px_rgba(255,255,255,0.8)]" />
                    </motion.div>
                    <motion.p 
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                      className="text-sm font-bold text-white/80 tracking-[0.4em] uppercase pl-[0.4em]"
                    >
                      正在等待任务内容输出...
                    </motion.p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-32 text-center text-white/20">
                <Clock className="mb-4 h-12 w-12 opacity-50" />
                <p className="text-sm tracking-widest uppercase">暂无活动任务</p>
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
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
        ::selection {
          background-color: rgba(59, 130, 246, 0.4) !important;
        }
      ` }} />
      <main className="relative h-screen w-full overflow-hidden bg-black text-white">
        <AnimatePresence>
          {status !== "idle" && (
            <motion.div
              key="aura-background"
              initial={{ opacity: 0 }}
              animate={{
                opacity: status === "speaking" ? 0.3 + (volume * 0.7) : 0.2,
                boxShadow: status === "thinking"
                  ? "inset 0 0 80px rgba(168, 85, 247, 0.5)"
                  : status === "listening"
                    ? "inset 0 0 60px rgba(0, 230, 255, 0.4)"
                    : `inset 0 0 ${60 + (volume * 100)}px rgba(0, 210, 255, 0.6)`,
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

        <AnimatePresence>
          {toast && (
            <motion.div
              key="toast-message"
              initial={{ y: 50, opacity: 0, x: "-50%" }}
              animate={{ y: -90, opacity: 1, x: "-50%" }}
              exit={{ y: 50, opacity: 0, x: "-50%" }}
              className={`fixed left-1/2 bottom-4 z-4000 flex items-center gap-3 rounded-2xl border px-6 py-3 shadow-2xl backdrop-blur-xl ${toast.type === "error"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-white/10 bg-white/5 text-white"
                }`}
            >
              <div className={`h-2 w-2 rounded-full ${toast.type === "error" ? "bg-destructive animate-pulse" : "bg-primary animate-pulse"}`} />
              <span className="text-sm font-medium tracking-wide">{toast.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

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
                  className={`relative z-10 flex h-full max-h-[82vh] w-[94%] max-w-6xl items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0a]/80 shadow-2xl ${(isSharing || isTaskPinned || isVideoOn) ? "" : "glass-panel backdrop-blur-3xl"
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

        <header data-tauri-drag-region className="relative flex items-center justify-between px-4 pt-10 pb-6 select-none" style={{ zIndex: 600 }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="relative">
                <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" />
                <select
                  disabled={isBusy || isConnected}
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  className="h-9 w-36 appearance-none rounded-full border border-white/10 bg-white/5 pl-9 pr-8 text-xs text-white/80 outline-none backdrop-blur-xl transition hover:bg-white/15 hover:border-white/20 focus:border-primary/50 disabled:opacity-50 [app-region:no-drag]"
                >
                  {VOICES.map(v => <option key={v.id} value={v.id} className="bg-[#1a1a1a] font-sans">{v.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-white/40" />
              </label>

              <label className="relative">
                <Languages className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" />
                <select
                  disabled={isBusy || isConnected}
                  value={selectedLanguage}
                  onChange={(e) => {
                    setSelectedLanguage(e.target.value);
                    localStorage.setItem("jiling_selected_language", e.target.value);
                  }}
                  className="h-9 w-28 appearance-none rounded-full border border-white/10 bg-white/5 pl-9 pr-8 text-xs text-white/80 outline-none backdrop-blur-xl transition hover:bg-white/15 hover:border-white/20 focus:border-primary/50 disabled:opacity-50 [app-region:no-drag]"
                >
                  <option value="auto" className="bg-[#1a1a1a]">Auto</option>
                  <option value="zh-CN" className="bg-[#1a1a1a]">中文</option>
                  <option value="en-US" className="bg-[#1a1a1a]">English</option>
                  <option value="ja-JP" className="bg-[#1a1a1a]">日本語</option>
                  <option value="ko-KR" className="bg-[#1a1a1a]">한국어</option>
                  <option value="fr-FR" className="bg-[#1a1a1a]">Français</option>
                  <option value="de-DE" className="bg-[#1a1a1a]">Deutsch</option>
                  <option value="es-ES" className="bg-[#1a1a1a]">Español</option>
                  <option value="pt-BR" className="bg-[#1a1a1a]">Português</option>
                  <option value="it-IT" className="bg-[#1a1a1a]">Italiano</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-white/40" />
              </label>

              {providers.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <label className="relative">
                    {isOnline ? (
                      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse z-10" />
                    ) : (
                      <Bot className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50 z-10" />
                    )}
                    <select
                      disabled={isBusy || isConnected}
                      value={selectedProviderId}
                      onChange={(e) => setSelectedProviderId(e.target.value)}
                      className="h-9 w-32 appearance-none rounded-full border border-white/10 bg-white/5 pl-9 pr-8 text-xs text-white/80 outline-none backdrop-blur-xl transition hover:bg-white/15 hover:border-white/20 focus:border-primary/50 disabled:opacity-50 [app-region:no-drag]"
                    >
                      {providers.map(p => <option key={p.id} value={p.id} className="bg-[#1a1a1a]">{providerLabel(p.id, p.name)}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-white/40" />
                  </label>

                  {availableModels.length > 0 && (
                    <label className="relative">
                      <Cpu className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50 z-10" />
                      <select
                        disabled={isBusy || isConnected}
                        value={selectedModel || ""}
                        onChange={(e) => handleModelChange(e.target.value)}
                        className="h-9 min-w-[120px] appearance-none rounded-full border border-white/10 bg-white/5 pl-9 pr-8 text-xs text-white/80 outline-none backdrop-blur-xl transition hover:bg-white/15 hover:border-white/20 focus:border-primary/50 disabled:opacity-50 [app-region:no-drag]"
                      >
                        {availableModels.map(m => <option key={m.id} value={m.id} className="bg-[#1a1a1a] font-sans">{m.name}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-white/40" />
                    </label>
                  )}

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={isBusy || isConnected}
                            onClick={clearSessionHandle}
                            className="h-9 w-9 rounded-full bg-white/5 text-white/50 hover:bg-destructive/15 hover:text-destructive transition-colors [app-region:no-drag] border border-transparent hover:border-destructive/20"
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
                  LIVE
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
              className={`relative h-10 w-10 rounded-full border border-white/10 backdrop-blur-md transition-all duration-500 ${isTaskPinned
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
              className={`h-10 w-10 rounded-full border backdrop-blur-md transition-all duration-300 [app-region:no-drag] ${showLogs
                ? "bg-white! text-black! border-white shadow-[0_0_20px_rgba(255,255,255,0.3)] scale-110"
                : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white"
                }`}
            >
              <Terminal className="h-5 w-5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={isWechatConnected ? () => invoke("wechat_logout").then(() => {
                setIsWechatConnected(false);
                localStorage.setItem("jiling_wechat_enabled", "false");
              }) : () => {
                setIsWechatModalOpen(true);
                setWechatLoginStatus("idle");
                setWechatQrCodeUrl(null);
                invoke("wechat_login");
              }}
              className={`h-10 w-10 rounded-full border backdrop-blur-md transition-all duration-300 [app-region:no-drag] ${isWechatConnected
                ? "bg-green-500/20 text-green-500 border-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.1)]"
                : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white"
                }`}
              title={isWechatConnected ? "断开微信" : "连接微信"}
            >
              <MessageCircle className="h-5 w-5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(true)}
              className="h-10 w-10 rounded-full border border-white/10 bg-white/5 backdrop-blur-md text-white/70 hover:bg-white/15 hover:text-white transition-all [app-region:no-drag] hover:border-white/20"
            >
              <Settings className="h-5 w-5" />
            </Button>

          </div>
        </header>

        <AnimatePresence>
          {showTextInput && (
            <motion.div
              key="text-input-field"
              ref={textInputRef}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="fixed bottom-24 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 p-4"
            >
              <div className={`rounded-2xl border pt-6 px-4 pb-2 backdrop-blur-xl shadow-2xl transition-all duration-150 relative ${
                isSubmittingText 
                  ? "border-blue-500/60 bg-[#19191e]/95 shadow-[0_0_30px_rgba(59,130,246,0.2)]" 
                  : "border-white/10 bg-[#19191e]/80 shadow-black/50"
              }`}>
                <div className="absolute top-0 right-2 flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isSubmittingText}
                    onClick={() => setEnableA2UI(!enableA2UI)}
                    className={`h-6 w-6 rounded-full transition-all ${enableA2UI ? "text-blue-400 bg-blue-500/10 hover:bg-blue-500/20" : "text-white/40 hover:text-white hover:bg-white/5"}`}
                    title={enableA2UI ? "已启用 A2UI 卡片" : "已禁用 A2UI 卡片"}
                  >
                    <Layers className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isSubmittingText}
                    onClick={() => setIsTextInputPinned(!isTextInputPinned)}
                    className={`h-6 w-6 rounded-full transition-colors ${isTextInputPinned ? "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20" : "text-white/40 hover:text-white hover:bg-white/5"}`}
                  >
                    {isTextInputPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <textarea
                  value={textInputValue}
                  onChange={(e) => setTextInputValue(e.target.value)}
                  onKeyDown={handleTextInputKeyDown}
                  onCompositionStart={() => { isComposingRef.current = true; }}
                  onCompositionEnd={() => { isComposingRef.current = false; }}
                  disabled={isSubmittingText}
                  placeholder={isSubmittingText ? "正在派发任务..." : "键入指令，按 Enter 直接派发给 Agent，Shift+Enter 换行..."}
                  className={`w-full h-24 bg-transparent text-white placeholder-white/30 outline-none resize-none text-sm leading-relaxed transition-opacity duration-300 ${isSubmittingText ? "opacity-50" : "opacity-100"}`}
                  autoFocus
                />
                
                {isSubmittingText && (
                  <div className="absolute bottom-0 left-0 h-0.5 w-full overflow-hidden rounded-b-2xl">
                    <motion.div 
                      className="h-full bg-blue-500"
                      initial={{ x: "-100%" }}
                      animate={{ x: "100%" }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                    />
                  </div>
                )}

                <div className="mt-1.5 flex justify-between items-center text-[10px] text-white/30 uppercase tracking-widest">
                  <span>{isSubmittingText ? "任务处理中..." : "Shift+↵ 换行"}</span>
                  <span>{isSubmittingText ? <Loader2 className="h-3 w-3 animate-spin" /> : "↵ 发送"}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
          showTextInput={showTextInput}
          onToggleTextInput={() => {
            const next = !showTextInput;
            setShowTextInput(next);
            if (next) {
              setIsTaskPinned(true);
            }
          }}
        />

        <WechatLoginModal
          isOpen={isWechatModalOpen}
          onClose={() => setIsWechatModalOpen(false)}
          qrCodeUrl={wechatQrCodeUrl}
          status={wechatLoginStatus}
          error={wechatError}
          onLogout={async () => {
            await invoke("wechat_destroy_session");
            setIsWechatConnected(false);
            localStorage.setItem("jiling_wechat_enabled", "false");
            setWechatLoginStatus("idle");
            setWechatQrCodeUrl(null);
            // Now start login process again
            invoke("wechat_login");
          }}
        />


        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      </main>

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
        onAbortTask={handleAbortTask}
        onA2UIAction={handleTaskA2UIAction}
      />

      <div className={`pointer-events-none fixed z-200 transition-all duration-500 ${(isSharing || isTaskPinned || isVideoOn)
        ? "bottom-24 right-8 w-full max-w-sm"
        : "bottom-24 left-1/2 w-full max-w-4xl -translate-x-1/2 px-8"
        }`}>
        <TranscriptOverlay
          messages={transcript}
          visible={showTranscript && isConnected && status !== "idle"}
          pinned={isSharing || isTaskPinned || isVideoOn}
        />
      </div>

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

      <AnimatePresence>
        {showSettings && (
          <SettingsModal
            key="settings-modal"
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
            apiKeyConfigured={!!apiKeyConfigured}
            apiKeySource={apiKeySource}
            onSaveApiKey={saveApiKey}
            onRunSelfTest={runSelfTest}
          />
        )}
      </AnimatePresence>

      {/* Progressive Log Area - Outside main */}
      <AnimatePresence>
        {showLogs && (
          <motion.div
            key="system-logs"
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
      <AnimatePresence>
        {activeA2UITask && !(isSidePanelOpen && selectedTaskId === activeA2UITask.runId) && (
          <motion.div 
            key={`a2ui-overlay-${activeA2UITask.runId}`}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-2999"
              onClick={() => {
                // Optional: dismiss or do nothing
              }}
            />
            <motion.div
              initial={{ opacity: 0, y: -50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -50, scale: 0.9 }}
              className="fixed top-24 left-1/2 -translate-x-1/2 z-3000 w-full max-w-lg px-4"
            >
              <div className="relative group overflow-hidden rounded-3xl border border-white/10 bg-black/80 p-1 shadow-2xl backdrop-blur-2xl ring-1 ring-white/20">
                <div className="absolute inset-0 bg-linear-to-b from-white/5 to-transparent pointer-events-none" />

                <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">待处理交互请求</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-white/20 hover:text-white"
                    onClick={() => {
                      handleTaskA2UIAction(activeA2UITask.runId, "dismiss", {});
                      setDismissedA2UIs(prev => new Map(prev).set(activeA2UITask.runId, activeA2UITask.output!));
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>

                <div className="max-h-[60vh] overflow-y-auto p-2 custom-scrollbar">
                  <AuraRenderer
                    content={activeA2UITask.output!}
                    latestOnly={true}
                    onAction={(action, data) => {
                      handleTaskA2UIAction(activeA2UITask.runId, action, data);
                      setDismissedA2UIs(prev => new Map(prev).set(activeA2UITask.runId, activeA2UITask.output!));
                    }}
                  />
                </div>

                <div className="p-3 bg-white/2 border-t border-white/5 flex items-center justify-between">
                  <span className="text-[10px] text-white/50 truncate max-w-[200px]">来自: {activeA2UITask.title}</span>
                  <Button
                    variant="link"
                    className="h-auto p-0 text-[10px] text-emerald-500 hover:text-emerald-400 transition-colors"
                    onClick={() => {
                      setSelectedTaskId(activeA2UITask.runId);
                      setIsSidePanelOpen(true);
                    }}
                  >
                    查看任务详情 <ChevronRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
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
