"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, ListChecks, History, ChevronRight, Terminal, Activity, CheckCircle2, XCircle, Clock, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type AgentTaskPhase = "submitted" | "running" | "completed" | "failed" | "cancelled";

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
}

export function TaskSidePanel({
  isOpen,
  onClose,
  tasks,
  selectedTaskId,
  onSelectTask,
  isPinned,
  onTogglePin,
  onAbortTask
}: TaskSidePanelProps) {
  const selectedTask = tasks.find(t => t.runId === selectedTaskId);

  const cleanText = (text: string) => {
    if (!text) return text;
    return text
      .replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "")
      .replace(/(?<=[\u4e00-\u9fa5])\s+(?=[，。？！；：、“”『』「」])|(?<=[，。？！；：、“”『』「」])\s+(?=[\u4e00-\u9fa5])/g, "");
  };

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
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-full max-w-3xl border-l border-white/10 bg-black/80 backdrop-blur-2xl shadow-2xl flex flex-col"
            style={{ zIndex: 1000 }}
          >
            <div className="flex items-center justify-between border-b border-white/10 p-4">
              <div className="flex items-center gap-2 font-semibold text-white">
                <ListChecks className="h-5 w-5 text-primary" />
                <span>任务管理</span>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full text-white/60 hover:text-white">
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Task List */}
              <div className={`flex flex-col border-r border-white/10 transition-all ${selectedTask ? "w-64" : "w-full"}`}>
                <ScrollArea className="flex-1 p-2">
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
                          <span className={`text-sm font-medium line-clamp-1 ${selectedTaskId === task.runId ? "text-white" : "text-white/70"}`}>
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
                <div className="flex flex-1 flex-col min-h-0 bg-white/2">
                  <ScrollArea className="flex-1">
                    <div className="p-6 space-y-6">
                      <div>
                        <h3 className="text-lg font-semibold text-white leading-tight">{selectedTask.title}</h3>
                        <div className="mt-2 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <TaskStatusBadge phase={selectedTask.phase} />
                            <span className="text-xs text-white/40">{selectedTask.providerName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {(selectedTask.phase === "running" || selectedTask.phase === "submitted") && (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => onAbortTask(selectedTask.runId)}
                                className="h-7 px-2.5 rounded-lg text-[10px] font-medium text-destructive hover:bg-destructive/10 hover:text-destructive border border-transparent hover:border-destructive/20 transition-all"
                              >
                                <XCircle className="h-3 w-3 mr-1" />
                                终止任务
                              </Button>
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
                              {isPinned ? "取消固定" : "固定显示"}
                            </Button>
                          </div>
                        </div>
                      </div>

                      {selectedTask.output ? (
                        <div className="prose prose-invert prose-sm max-w-none 
                          prose-headings:text-white prose-p:text-white/80 prose-strong:text-white
                          prose-table:border prose-table:border-white/10 prose-th:bg-white/5 prose-th:p-2 prose-td:p-2 prose-td:border-t prose-td:border-white/10"
                        >
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanText(selectedTask.output)}</ReactMarkdown>
                        </div>
                      ) : selectedTask.error ? (
                        <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive border border-destructive/20">
                          <div className="flex items-center gap-2 font-semibold mb-1">
                            <XCircle className="h-4 w-4" />
                            <span>执行失败</span>
                          </div>
                          <p className="opacity-90">{selectedTask.error}</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-sm text-primary animate-pulse">
                            <Activity className="h-4 w-4" />
                            <span>正在执行任务...</span>
                          </div>
                          <div className="space-y-1">
                            {selectedTask.progress.map((p, i) => (
                              <div key={i} className="flex gap-2 text-xs text-white/60">
                                <span className="text-white/20 select-none">{i+1}</span>
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
    case "running": return <Activity className={`${className} text-primary animate-spin-slow`} />;
    case "submitted": return <Clock className={`${className} text-white/40`} />;
    case "cancelled": return <X className={`${className} text-white/20`} />;
  }
}

function TaskStatusBadge({ phase }: { phase: AgentTaskPhase }) {
  const styles = {
    completed: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
    failed: "bg-destructive/10 text-destructive border-destructive/20",
    running: "bg-primary/10 text-primary border-primary/20",
    submitted: "bg-white/5 text-white/60 border-white/10",
    cancelled: "bg-white/5 text-white/40 border-white/10",
  };
  
  const labels = {
    completed: "已完成",
    failed: "执行失败",
    running: "正在运行",
    submitted: "已提交",
    cancelled: "已取消",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles[phase]}`}>
      {labels[phase]}
    </span>
  );
}
