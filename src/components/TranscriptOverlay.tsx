"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef } from "react";

export type TranscriptMessage = {
  id: string;
  role: "user" | "ai";
  text: string;
  timestamp: number;
};

interface TranscriptOverlayProps {
  messages: TranscriptMessage[];
  visible: boolean;
  pinned?: boolean;
}

export function TranscriptOverlay({ messages, visible, pinned }: TranscriptOverlayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // Only auto-scroll if user is already near the bottom (within 100px)
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      
      if (isNearBottom || messages.length <= 1) {
        scrollRef.current.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: messages.length <= 1 ? "auto" : "smooth"
        });
      }
    }
  }, [messages]);

  const displayMessages = pinned ? messages.slice(-2) : messages.slice(-8);

  return (
    <div className={`pointer-events-none flex flex-col transition-all duration-500 ${
      pinned ? "relative bottom-0 top-auto items-start px-0" : "relative items-center justify-end px-8"
    }`}>
      <div 
        ref={scrollRef}
        className={`transcript-fade-mask flex w-full flex-col gap-1 overflow-y-auto pointer-events-auto transition-all ${
          pinned ? "max-w-none max-h-40" : "max-w-2xl max-h-[60vh] py-4"
        } scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent hover:scrollbar-thumb-white/20`}
        style={{ 
          maskImage: 'linear-gradient(to top, black 85%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to top, black 85%, transparent 100%)',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.1) transparent'
        }}
      >
        <AnimatePresence>
          {visible && displayMessages.map((msg, idx) => {
            const isLast = idx === displayMessages.length - 1;
            const isVeryRecent = idx >= displayMessages.length - 2;
            const isRecent = idx >= displayMessages.length - 4;
            
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10, filter: "blur(5px)" }}
                animate={{ 
                  opacity: isVeryRecent ? 1.0 : (isRecent ? 0.7 : 0.2), 
                  y: 0, 
                  filter: isRecent ? "blur(0px)" : "blur(4px)",
                  scale: isLast ? 1 : 0.98
                }}
                exit={{ opacity: 0, y: -10, filter: "blur(5px)" }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div 
                  className={`rounded-2xl transition-all duration-500 ${
                    pinned 
                      ? "max-w-[95%] px-0 py-0.5 text-sm" 
                      : "max-w-[85%] px-4 py-2 text-base border border-white/5 shadow-xl bg-black/20 backdrop-blur-md"
                  } ${
                    msg.role === "user" ? "text-white/90" : "text-white/80"
                  }`}
                  style={{ textShadow: msg.role === "ai" ? "0 0 8px rgba(255,255,255,0.2)" : "none" }}
                >
                  {msg.text}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};
