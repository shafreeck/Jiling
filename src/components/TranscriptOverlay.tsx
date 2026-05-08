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
}

export function TranscriptOverlay({ messages, visible }: TranscriptOverlayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/4 bottom-1/5 z-10 flex flex-col items-center justify-end px-8">
      <div 
        ref={scrollRef}
        className="transcript-fade-mask flex w-full max-w-2xl flex-col gap-1.5 overflow-hidden py-4"
        style={{ 
          maskImage: 'linear-gradient(to top, black 30%, rgba(0,0,0,0.4) 65%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to top, black 30%, rgba(0,0,0,0.4) 65%, transparent 100%)'
        }}
      >
        <AnimatePresence>
          {visible && messages.slice(-8).map((msg, idx) => {
            const displayMessages = messages.slice(-8);
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
                  className={`max-w-[85%] rounded-2xl px-4 py-2 text-base font-medium leading-relaxed tracking-tight transition-all duration-500 ${
                    msg.role === "user" 
                      ? "bg-white/15 text-white border border-white/10 shadow-md" 
                      : "text-white/95"
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
