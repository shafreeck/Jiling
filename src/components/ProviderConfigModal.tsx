"use client";

import { motion, AnimatePresence } from "framer-motion";
import { 
  X, 
  Save, 
  FolderOpen, 
  Check, 
  AlertCircle,
  Loader2,
  Puzzle,
  Cpu,
  Layout
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ScrollArea } from "@/components/ui/scroll-area";

// Simple custom Switch component to avoid missing shadcn component error
const CustomSwitch = ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) => (
  <button
    onClick={() => onCheckedChange(!checked)}
    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-blue-500" : "bg-white/10"}`}
  >
    <span
      className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${checked ? "translate-x-4.5" : "translate-x-0.5"}`}
    />
  </button>
);

interface ProviderConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  providerName: string;
}

export function ProviderConfigModal({
  isOpen,
  onClose,
  providerId,
  providerName
}: ProviderConfigModalProps) {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen, providerId]);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<any>("read_acp_config", { providerId });
      setConfig(data);
    } catch (e) {
      setError("无法加载配置文件");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke("write_acp_config", { providerId, config });
      onClose();
    } catch (e) {
      setError("保存配置失败");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const updatePlugin = (pluginId: string, enabled: boolean) => {
    setConfig((prev: any) => {
      const newConfig = { ...prev };
      if (!newConfig.plugins) newConfig.plugins = { entries: {} };
      if (!newConfig.plugins.entries) newConfig.plugins.entries = {};
      
      newConfig.plugins.entries[pluginId] = {
        ...newConfig.plugins.entries[pluginId],
        enabled
      };
      
      // Update allow list if it exists
      if (Array.isArray(newConfig.plugins.allow)) {
        if (enabled && !newConfig.plugins.allow.includes(pluginId)) {
          newConfig.plugins.allow.push(pluginId);
        } else if (!enabled) {
          newConfig.plugins.allow = newConfig.plugins.allow.filter((id: string) => id !== pluginId);
        }
      }
      
      return newConfig;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="relative flex h-[500px] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#16161a]/95 shadow-2xl backdrop-blur-2xl"
      >
        <header className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div className="flex items-center gap-3">
             <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400">
                <Layout className="h-4 w-4" />
             </div>
             <div>
                <h3 className="text-sm font-bold text-white">配置 {providerName}</h3>
                <p className="text-[10px] text-white/30 uppercase tracking-wider">{providerId} agent settings</p>
             </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-full text-white/40 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-white/20" />
            </div>
          ) : (
            <ScrollArea className="h-full w-full">
              <div className="p-6 space-y-8">
                {error && (
                  <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive border border-destructive/20">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                  </div>
                )}

                {/* Workspace Section */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-emerald-400" />
                    <h4 className="text-xs font-bold text-white/70 uppercase tracking-widest">工作空间路径</h4>
                  </div>
                  <div className="space-y-2">
                     <p className="text-[11px] text-white/40">Agent 执行任务时存放文件的根目录</p>
                     <input
                       type="text"
                       value={config?.agents?.defaults?.workspace || ""}
                       onChange={(e) => {
                         const val = e.target.value;
                         setConfig((prev: any) => {
                            const next = { ...prev };
                            if (!next.agents) next.agents = { defaults: {} };
                            if (!next.agents.defaults) next.agents.defaults = {};
                            next.agents.defaults.workspace = val;
                            return next;
                         });
                       }}
                       className="w-full rounded-xl border border-white/5 bg-white/2 px-4 py-2.5 text-sm text-white/80 outline-none transition focus:border-blue-500/30 focus:bg-white/5"
                     />
                  </div>
                </section>

                {/* Plugins Section */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Puzzle className="h-4 w-4 text-purple-400" />
                    <h4 className="text-xs font-bold text-white/70 uppercase tracking-widest">插件与能力开关</h4>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(config?.plugins?.entries || {}).map(([id, p]: [string, any]) => (
                      <div key={id || `plugin-${p.name || ""}`} className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/2 p-3.5 transition-colors hover:bg-white/3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[13px] font-medium text-white/90">{id}</span>
                          <span className="text-[10px] text-white/30 uppercase">Plugin</span>
                        </div>
                        <CustomSwitch 
                          checked={p.enabled} 
                          onCheckedChange={(checked: boolean) => updatePlugin(id, checked)}
                        />
                      </div>
                    ))}
                  </div>
                </section>

                {/* Models Section */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-amber-400" />
                    <h4 className="text-xs font-bold text-white/70 uppercase tracking-widest">模型别名设置</h4>
                  </div>
                  <div className="space-y-3">
                    {Object.entries(config?.agents?.defaults?.models || {}).map(([id, m]: [string, any]) => (
                      <div key={id || `model-${m.alias || ""}`} className="flex items-center gap-4 rounded-2xl border border-white/5 bg-white/2 p-3.5">
                         <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-white/20 truncate">{id}</p>
                            <input 
                              type="text"
                              value={m.alias || ""}
                              placeholder="设置显示别名..."
                              onChange={(e) => {
                                const val = e.target.value;
                                setConfig((prev: any) => {
                                  const next = { ...prev };
                                  next.agents.defaults.models[id].alias = val;
                                  return next;
                                });
                              }}
                              className="mt-1 w-full bg-transparent text-sm text-white/70 outline-none placeholder:text-white/10"
                            />
                         </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </ScrollArea>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-white/5 bg-white/2 px-6 py-4">
          <Button
            variant="ghost"
            onClick={onClose}
            className="rounded-xl text-xs text-white/40 hover:text-white hover:bg-white/5 px-6"
          >
            取消
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || loading}
            className="rounded-xl bg-blue-500 text-white hover:bg-blue-600 px-6 font-bold shadow-lg shadow-blue-500/20 gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存配置
          </Button>
        </footer>
      </motion.div>
    </div>
  );
}
