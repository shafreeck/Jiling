"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ListChecks, History, ChevronRight, ChevronDown, Terminal, Activity, CheckCircle2, XCircle, Clock, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AuraRenderer } from "./AuraRenderer";

export type AgentTaskPhase = "submitted" | "running" | "completed" | "failed" | "cancelled" | "lost";

export type AgentTaskView = {
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

interface TaskSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: AgentTaskView[];
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  isPinned: boolean;
  onTogglePin: () => void;
  onAbortTask: (runId: string) => void;
  onA2UIAction?: (runId: string, action: string, data: any) => void;
}

export function TaskSidePanel({
  isOpen,
  onClose,
  tasks,
  selectedTaskId,
  onSelectTask,
  isPinned,
  onTogglePin,
  onAbortTask,
  onA2UIAction
}: TaskSidePanelProps) {
  const selectedTask = tasks.find(t => t.runId === selectedTaskId);
  
  // Resizable state with persistence and responsiveness
  const [width, setWidth] = useState(768);
  const [isResizing, setIsResizing] = useState(false);

  // Initialize width on mount and load from localStorage
  useEffect(() => {
    const savedWidth = localStorage.getItem("task-panel-width");
    const initialWidth = savedWidth ? parseInt(savedWidth) : 768;
    // Ensure default doesn't exceed screen width
    setWidth(Math.min(initialWidth, window.innerWidth * 0.9));
  }, []);

  const startResizing = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    localStorage.setItem("task-panel-width", width.toString());
  }, [width]);

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth > 320 && newWidth < window.innerWidth * 0.98) {
        setWidth(newWidth);
      }
    }
  }, [isResizing]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
    } else {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    }
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  const cleanText = (text: string) => text;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            style={{ zIndex: 999 }}
          />
          <motion.div
            initial={{ right: -width }}
            animate={{ right: 0 }}
            exit={{ right: -width }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed top-0 h-full border-l border-white/10 bg-black/80 backdrop-blur-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ 
              zIndex: 1000, 
              width: `${width}px`,
              right: 0
            }}
          >
            <style dangerouslySetInnerHTML={{ __html: `
              .task-side-panel ::selection {
                background-color: rgba(59, 130, 246, 0.4) !important;
              }
              .task-side-panel *::selection {
                background-color: rgba(59, 130, 246, 0.4) !important;
              }
            ` }} />
            <div className="task-side-panel flex flex-col h-full w-full">
            {/* Resize Handle */}
            <div
              onMouseDown={startResizing}
              className={`absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-50 transition-colors ${
                isResizing ? "bg-primary/50" : "hover:bg-primary/20"
              }`}
            />
            <div className="flex items-center justify-between border-b border-white/10 p-4">
              <div className="flex items-center gap-2 font-semibold text-white">
                <ListChecks className="h-5 w-5 text-primary" />
                <span>任务管理</span>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onClose} 
                className="rounded-full text-white/60 hover:bg-white/10 hover:text-white transition-colors mr-2"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Task List */}
              <div className={`flex flex-col h-full border-r border-white/10 transition-all ${selectedTask ? "w-64" : "w-full"}`}>
                <ScrollArea className="h-full p-2">
                  <div className="space-y-2">
                    {tasks.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-12 text-center text-white/40">
                        <History className="mb-2 h-8 w-8 opacity-20" />
                        <p className="text-sm">暂无任务记录</p>
                      </div>
                    )}
                    {tasks.map((task) => (
                      <button
                        key={task.runId}
                        onClick={() => onSelectTask(task.runId)}
                        className={`group w-full rounded-xl p-3 text-left transition-all ${
                          selectedTaskId === task.runId 
                            ? "bg-primary/20 ring-1 ring-primary/50" 
                            : "hover:bg-white/5"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span 
                            title={task.title}
                            className={`text-[13px] font-semibold leading-tight line-clamp-2 ${selectedTaskId === task.runId ? "text-white" : "text-white/70"}`}
                          >
                            {task.title}
                          </span>
                          <TaskStatusIcon phase={task.phase} className="h-4 w-4 shrink-0" />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[10px] text-white/40">
                          <span>{task.providerName}</span>
                          <span>{new Date(task.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* Task Detail */}
              {selectedTask && (
                <div className="flex flex-1 flex-col h-full min-h-0 bg-white/2">
                  <ScrollArea className="h-full">
                    <div className="p-10 pb-32 space-y-8">
                      <div className="space-y-6">
                        <div>
                          <div className="flex items-center justify-between gap-4">
                            <h3 className="text-sm font-bold text-white leading-tight line-clamp-2 flex-1">{selectedTask.title}</h3>
                            <div className="flex items-center gap-2 shrink-0">
                              {(selectedTask.phase === "running" || selectedTask.phase === "submitted") && (
                                <button 
                                  onClick={() => onAbortTask(selectedTask.runId)}
                                  className="inline-flex items-center justify-center h-7 px-3 p-0 rounded-full text-[10px] font-bold bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive hover:text-white transition-all shadow-sm leading-none appearance-none outline-none"
                                >
                                  <XCircle className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                                  <span className="translate-y-[-0.5px]">终止任务</span>
                                </button>
                              )}
                              <Button 
                                variant="secondary" 
                                size="sm" 
                                onClick={onTogglePin}
                                className={`h-7 px-2.5 rounded-lg text-[10px] font-medium border transition-all ${
                                  isPinned 
                                    ? "bg-primary/20 text-primary border-primary/30 hover:bg-primary/30" 
                                    : "bg-white/5 text-white/70 border-white/10 hover:bg-white/15 hover:text-white"
                                }`}
                              >
                                {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                                <span className="ml-1">{isPinned ? "取消固定" : "固定显示"}</span>
                              </Button>
                            </div>
                          </div>

                          <details className="mt-3 group">
                            <summary className="flex items-center cursor-pointer text-[10px] text-white/50 hover:text-white/70 transition-colors list-none">
                              <ChevronDown className="h-3 w-3 mr-1 transition-transform group-open:rotate-180" />
                              <span>查看原始请求内容</span>
                            </summary>
                            <div className="mt-2 p-4 rounded-xl bg-white/3 border border-white/5 text-[11px] text-white/50 leading-relaxed italic whitespace-pre-wrap wrap-break-word overflow-hidden">
                              {selectedTask.title}
                            </div>
                          </details>
                          
                          <div className="mt-4 flex items-center gap-3">
                            <TaskStatusBadge phase={selectedTask.phase} />
                            <span className="text-xs text-white/60">{selectedTask.providerName}</span>
                          </div>
                        </div>
                      </div>

                      {selectedTask.output ? (
                        <AuraRenderer 
                          content={selectedTask.output} 
                          onAction={(action, data) => {
                            if (onA2UIAction) {
                              onA2UIAction(selectedTask.runId, action, data);
                            }
                          }}
                        />
                      ) : (selectedTask.error || selectedTask.phase === "cancelled" || selectedTask.phase === "lost") ? (
                        <div className={`rounded-lg p-4 text-sm border ${
                          selectedTask.phase === "cancelled" 
                            ? "bg-orange-500/10 text-orange-400 border-orange-500/20" 
                            : selectedTask.phase === "lost"
                            ? "bg-white/5 text-white/40 border-white/10"
                            : "bg-destructive/10 text-destructive border-destructive/20"
                        }`}>
                          <div className="flex items-center gap-2 font-semibold mb-1">
                            {selectedTask.phase === "lost" ? <History className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                            <span>{
                              selectedTask.phase === "cancelled" ? "任务已终止" : 
                              selectedTask.phase === "lost" ? "任务状态丢失" :
                              "执行失败"
                            }</span>
                          </div>
                          <p className="opacity-90">
                            {selectedTask.phase === "lost" ? "由于 Agent 连接异常中断，该任务已无法继续追踪。" : (selectedTask.error || "未知错误")}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-sm text-white/80 animate-pulse">
                            <Activity className="h-4 w-4 text-blue-400" />
                            <span>正在执行任务...</span>
                          </div>
                          <div className="space-y-1">
                            {selectedTask.progress.map((p, i) => (
                              <div key={i} className="flex gap-2 text-xs text-white/60">
                                <span className="text-white/40 select-none">{i+1}</span>
                                <span>{p}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function TaskStatusIcon({ phase, className }: { phase: AgentTaskPhase, className?: string }) {
  switch (phase) {
    case "completed": return <CheckCircle2 className={`${className} text-emerald-400`} />;
    case "failed": return <XCircle className={`${className} text-destructive`} />;
    case "running": return <Activity className={`${className} text-blue-400 animate-spin-slow`} />;
    case "submitted": return <Clock className={`${className} text-white/40`} />;
    case "cancelled": return <XCircle className={`${className} text-orange-400`} />;
    case "lost": return <History className={`${className} text-white/30`} />;
    default: return <Clock className={`${className} text-white/20`} />;
  }
}

function TaskStatusBadge({ phase }: { phase: AgentTaskPhase }) {
  const styles = {
    completed: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
    failed: "bg-destructive/10 text-destructive border-destructive/20",
    running: "bg-blue-400/10 text-blue-400 border-blue-400/20",
    submitted: "bg-white/5 text-white/60 border-white/10",
    cancelled: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    lost: "bg-white/5 text-white/30 border-white/10",
  } as const;
  
  const labels = {
    completed: "已完成",
    failed: "执行失败",
    running: "正在运行",
    submitted: "已提交",
    cancelled: "已终止",
    lost: "连接丢失",
  } as const;

  const style = (styles as any)[phase] || styles.submitted;
  const label = (labels as any)[phase] || "未知状态";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${style}`}>
      {label}
    </span>
  );
}
