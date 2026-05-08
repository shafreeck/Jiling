"use client";

import { motion, AnimatePresence } from "framer-motion";
import { PinOff, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface TaskOutputOverlayProps {
  title: string;
  output: string;
  isPinned: boolean;
  onTogglePin: () => void;
}

export function TaskOutputOverlay({
  title,
  output,
  isPinned,
  onTogglePin
}: TaskOutputOverlayProps) {
  if (!isPinned) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="fixed left-8 top-1/4 z-30 flex h-[50vh] w-full max-w-sm flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/40 shadow-2xl backdrop-blur-2xl"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 bg-white/5">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span className="truncate text-xs font-semibold text-white/80">{title}</span>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={onTogglePin}
          className="h-7 w-7 rounded-full text-white/40 hover:bg-white/10 hover:text-white"
        >
          <PinOff className="h-3.5 w-3.5" />
        </Button>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-5">
          <div className="prose prose-invert prose-xs max-w-none
            prose-headings:text-white prose-p:text-white/80 prose-strong:text-white
            prose-table:border prose-table:border-white/10 prose-th:bg-white/5 prose-th:p-1.5 prose-td:p-1.5 prose-td:border-t prose-td:border-white/10 text-xs"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
          </div>
        </div>
      </ScrollArea>
    </motion.div>
  );
}
