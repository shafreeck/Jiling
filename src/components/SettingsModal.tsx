"use client";

import { motion, AnimatePresence } from "framer-motion";
import { 
  X, 
  Key, 
  Bot, 
  Cpu, 
  ShieldCheck, 
  Globe, 
  Settings,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  Fingerprint
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ScrollArea } from "@/components/ui/scroll-area";

import { ProviderConfigModal } from "./ProviderConfigModal";

interface ProviderInfo {
  id: string;
  name: string;
  status: "online" | "offline";
  models: Array<{ id: string; name: string }>;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKeyConfigured: boolean;
  apiKeySource: string | null;
  onSaveApiKey: (key: string) => Promise<void>;
  onRunSelfTest: () => Promise<void>;
}

export function SettingsModal({
  isOpen,
  onClose,
  apiKeyConfigured,
  apiKeySource,
  onSaveApiKey,
  onRunSelfTest
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"general" | "providers" | "identity">("general");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [identity, setIdentity] = useState<{ device_id?: string; public_key?: string } | null>(null);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [selectedProviderConfigId, setSelectedProviderConfigId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadProviders();
      loadIdentity();

      let unlistenFn: (() => void) | null = null;
      const setup = async () => {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen("acp-models-updated", (event: any) => {
          const payload = event.payload as any;
          setProviders(prev => prev.map(p => 
            p.id === payload.provider_id 
              ? { ...p, models: payload.models } 
              : p
          ));
        });
        unlistenFn = unlisten;
      };
      setup();
      return () => { if (unlistenFn) unlistenFn(); };
    }
  }, [isOpen]);

  const loadProviders = async () => {
    setLoadingProviders(true);
    try {
      // 简单探测
      const home = await import("@tauri-apps/api/path").then(m => m.homeDir());
      const { exists } = await import("@tauri-apps/plugin-fs");
      
      const detected: ProviderInfo[] = [];
      const checkList = [
        { id: "openclaw", name: "OpenClaw", path: "/.openclaw" },
        { id: "autoclaw", name: "AutoClaw", path: "/.openclaw-autoclaw" },
        { id: "hermes", name: "Hermes", path: "/.hermes" }
      ];

      for (const p of checkList) {
        if (await exists(home + p.path)) {
          const models = await invoke<any[]>("get_acp_models", { providerId: p.id }).catch(() => []);
          detected.push({
            id: p.id,
            name: p.name,
            status: "online", // 简化处理，实际上需要更复杂的检测
            models: models.map(m => ({ id: m.id, name: m.name }))
          });
        }
      }
      setProviders(detected);
    } catch (e) {
      console.error("Failed to load providers in settings:", e);
    } finally {
      setLoadingProviders(false);
    }
  };

  const loadIdentity = async () => {
    try {
      const data = await invoke<any>("get_device_identity");
      setIdentity(data);
    } catch (e) {
      console.error("Failed to load identity:", e);
    }
  };

  const handleSaveKey = async () => {
    setIsSaving(true);
    try {
      await onSaveApiKey(apiKeyInput);
      setApiKeyInput("");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelfTest = async () => {
    setIsTesting(true);
    try {
      await onRunSelfTest();
    } finally {
      setIsTesting(false);
    }
  };

  const handleConfigureProvider = async (id: string) => {
    setSelectedProviderConfigId(id);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div key="settings-backdrop" className="fixed inset-0 z-500 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />
          <motion.div
            key="settings-content"
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="relative flex h-[600px] w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-[#0c0c0e]/95 shadow-2xl backdrop-blur-2xl"
          >
            {/* Sidebar Tabs */}
            <div className="w-64 border-r border-white/5 bg-white/2 p-6">
              <div className="mb-8 flex items-center gap-3 px-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/20 text-primary">
                  <Settings className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-bold text-white">机灵设置</h2>
              </div>

              <nav className="space-y-1">
                <TabButton 
                  active={activeTab === "general"} 
                  onClick={() => setActiveTab("general")}
                  icon={<Globe className="h-4 w-4" />}
                  label="通用与会话"
                />
                <TabButton 
                  active={activeTab === "providers"} 
                  onClick={() => setActiveTab("providers")}
                  icon={<Bot className="h-4 w-4" />}
                  label="本地代理 (ACP)"
                />
                <TabButton 
                  active={activeTab === "identity"} 
                  onClick={() => setActiveTab("identity")}
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="安全与身份"
                />
              </nav>

              <div className="mt-auto pt-4 border-t border-white/5 absolute bottom-6 w-52">
                 <div className="flex items-center gap-2 px-2 text-[10px] text-white/30 uppercase tracking-widest">
                    <Fingerprint className="h-3 w-3" />
                    <span>v0.3.0 Stable</span>
                 </div>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 flex flex-col min-w-0">
              <header className="flex items-center justify-between border-b border-white/5 px-8 py-5">
                <h3 className="text-sm font-bold text-white/90 uppercase tracking-widest">
                  {activeTab === "general" ? "通用设置" : activeTab === "providers" ? "ACP 代理管理" : "安全凭证"}
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="h-8 w-8 rounded-full text-white/40 hover:bg-white/10 hover:text-white border border-transparent hover:border-white/10"
                >
                  <X className="h-4 w-4" />
                </Button>
              </header>

              <div className="flex-1 overflow-hidden">
                <ScrollArea className="h-full w-full">
                  <div className="p-8">
                    {activeTab === "general" && (
                      <div className="space-y-8">
                        <section className="space-y-4">
                          <div className="flex items-center gap-2">
                            <Key className="h-4 w-4 text-primary" />
                            <h4 className="text-sm font-bold text-white">Gemini API 配置</h4>
                          </div>
                          <div className="space-y-3">
                            <p className="text-[12px] text-white/50 leading-relaxed">
                              机灵使用 Gemini Multimodal Live API 提供低延迟语音交互。你的 API Key 将被安全地存储在本地密钥库中。
                            </p>
                            <div className="flex gap-2">
                              <input
                                type="password"
                                value={apiKeyInput}
                                onChange={(e) => setApiKeyInput(e.target.value)}
                                placeholder={apiKeyConfigured ? `已配置 (${apiKeySource || "Local"})` : "输入你的 Gemini API Key"}
                                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none transition focus:border-primary/50 focus:bg-white/10 placeholder:text-white/20"
                              />
                              <Button 
                                onClick={handleSaveKey}
                                disabled={isSaving || !apiKeyInput}
                                className="rounded-xl bg-white text-black hover:bg-white/90 px-6 font-bold"
                              >
                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "更新"}
                              </Button>
                            </div>
                            <div className="flex items-center gap-4 pt-2">
                               <Button 
                                 variant="outline" 
                                 onClick={handleSelfTest}
                                 disabled={isTesting}
                                 className="h-9 rounded-xl border-white/10 bg-white/5 text-white/70 hover:bg-white/10 text-xs gap-2"
                               >
                                 {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                 运行连通性测试
                               </Button>
                               {apiKeyConfigured && (
                                 <span className="flex items-center gap-1.5 text-[11px] text-emerald-400/80">
                                   <CheckCircle2 className="h-3 w-3" />
                                   API 连接正常
                                 </span>
                               )}
                            </div>
                          </div>
                        </section>

                        <section className="space-y-4 pt-4">
                           <div className="flex items-center gap-2">
                            <Globe className="h-4 w-4 text-sky-400" />
                            <h4 className="text-sm font-bold text-white">区域与语言</h4>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                             <div className="space-y-2">
                               <label className="text-[11px] text-white/40 uppercase tracking-wider">系统语言</label>
                               <div className="rounded-xl border border-white/5 bg-white/2 p-3 text-[13px] text-white/80">
                                  跟随系统 (简体中文)
                               </div>
                             </div>
                             <div className="space-y-2">
                               <label className="text-[11px] text-white/40 uppercase tracking-wider">交互时区</label>
                               <div className="rounded-xl border border-white/5 bg-white/2 p-3 text-[13px] text-white/80">
                                  Asia/Shanghai (GMT+8)
                               </div>
                             </div>
                          </div>
                        </section>
                      </div>
                    )}

                    {activeTab === "providers" && (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <p className="text-[12px] text-white/50 max-w-md">
                            Agent Client Protocol (ACP) 允许机灵调用本地运行的各种 AI Agent。机灵会自动扫描 ~/.openclaw 等标准目录。
                          </p>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={loadProviders}
                            disabled={loadingProviders}
                            className="text-white/80 hover:text-white hover:bg-white/15 gap-2 px-3 border border-transparent hover:border-white/20 transition-all"
                          >
                            <RefreshCw className={`h-3 w-3 ${loadingProviders ? "animate-spin" : ""}`} />
                            刷新列表
                          </Button>
                        </div>
 
                        <div className="space-y-3">
                          {providers.length > 0 ? (
                            providers.map(p => (
                              <div key={p.id} className="group relative rounded-2xl border border-white/5 bg-white/2 p-5 transition-all hover:bg-white/3 hover:border-white/10">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center text-white/70">
                                      <Bot className="h-5 w-5" />
                                    </div>
                                    <div>
                                      <h5 className="text-sm font-bold text-white">{p.name}</h5>
                                      <div className="mt-1 flex items-center gap-2">
                                        <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                        <span className="text-[10px] text-white/40 uppercase tracking-tighter">Ready • {p.models.length} Models Found</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                      <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        onClick={() => handleConfigureProvider(p.id)}
                                        className="h-8 rounded-lg text-[11px] text-white/70 hover:text-white hover:bg-white/15 border border-white/5 hover:border-white/20 transition-all px-4"
                                      >
                                        配置
                                      </Button>
                                      <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        onClick={() => {
                                          // TODO: Stop provider process
                                          console.log("Stop provider:", p.id);
                                        }}
                                        className="h-8 rounded-lg text-[11px] text-destructive/80 hover:text-destructive hover:bg-destructive/15 border border-destructive/10 hover:border-destructive/30 transition-all px-4"
                                      >
                                        停止
                                      </Button>
                                  </div>
                                </div>
                                
                                {p.models.length > 0 && (
                                  <div className="mt-4 flex flex-wrap gap-2">
                                    {p.models.slice(0, 5).map(m => (
                                      <span key={m.id || m.name} className="rounded-lg bg-white/5 px-2 py-1 text-[10px] text-white/60 border border-white/5">
                                        {m.name}
                                      </span>
                                    ))}
                                    {p.models.length > 5 && <span className="text-[10px] text-white/20 px-1">+ {p.models.length - 5} more</span>}
                                  </div>
                                )}
                              </div>
                            ))
                          ) : (
                            <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-white/10 rounded-3xl bg-white/2">
                               <Bot className="h-10 w-10 text-white/10 mb-4" />
                               <p className="text-sm text-white/40">未发现正在运行的 ACP Provider</p>
                               <p className="text-[11px] text-white/20 mt-1 max-w-xs">
                                 请确保已在本地启动 OpenClaw 或 AutoClaw，并正确配置了 ACP 服务。
                               </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {activeTab === "identity" && (
                      <div className="space-y-8">
                         <section className="space-y-4">
                          <div className="flex items-center gap-2">
                            <Fingerprint className="h-4 w-4 text-orange-400" />
                            <h4 className="text-sm font-bold text-white">设备数字身份</h4>
                          </div>
                          <div className="space-y-4">
                            <p className="text-[12px] text-white/50 leading-relaxed">
                              这是机灵在与远程 Agent 或 Gateway 通信时使用的唯一身份标识。它用于 challenge-response 签名验证。
                            </p>
                            
                            <div className="space-y-4 rounded-2xl border border-white/5 bg-white/2 p-6">
                               <div className="space-y-1.5">
                                 <label className="text-[10px] text-white/30 uppercase tracking-widest flex items-center justify-between">
                                    <span>Device Token (UID)</span>
                                    <span className="text-primary hover:underline cursor-pointer">复制</span>
                                 </label>
                                 <div className="font-mono text-[12px] text-white/90 break-all p-3 rounded-xl bg-black/40 border border-white/5">
                                    {identity?.device_id || "加载中..."}
                                 </div>
                               </div>

                               <div className="space-y-1.5">
                                 <label className="text-[10px] text-white/30 uppercase tracking-widest flex items-center justify-between">
                                    <span>ED25519 Public Key</span>
                                    <span className="text-primary hover:underline cursor-pointer">导出证书</span>
                                 </label>
                                 <div className="font-mono text-[10px] text-white/50 break-all p-3 rounded-xl bg-black/40 border border-white/5 line-clamp-2">
                                    {identity?.public_key || "未生成密钥对"}
                                 </div>
                               </div>
                            </div>

                             <div className="flex gap-4">
                               <Button variant="ghost" className="text-[11px] text-white/40 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 gap-2">
                                  <RefreshCw className="h-3 w-3" /> 重新生成密钥对
                               </Button>
                               <Button variant="ghost" className="text-[11px] text-destructive/50 hover:text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 gap-2">
                                  <Trash2 className="h-3 w-3" /> 重置所有本地身份
                                </Button>
                             </div>
                          </div>
                        </section>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      {selectedProviderConfigId && (
        <ProviderConfigModal 
          key={`config-${selectedProviderConfigId}`}
          isOpen={!!selectedProviderConfigId}
          onClose={() => setSelectedProviderConfigId(null)}
          providerId={selectedProviderConfigId}
          providerName={providers.find(p => p.id === selectedProviderConfigId)?.name || ""}
        />
      )}
    </AnimatePresence>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
        active 
          ? "bg-white/10 text-white shadow-inner shadow-white/5" 
          : "text-white/40 hover:bg-white/5 hover:text-white"
      }`}
    >
      <span className={active ? "text-primary" : "text-inherit opacity-70"}>{icon}</span>
      {label}
    </button>
  );
}
