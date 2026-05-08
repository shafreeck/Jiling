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
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const displayMessages = pinned ? messages.slice(-2) : messages.slice(-8);

  return (
    <div className={`pointer-events-none z-10 flex flex-col transition-all duration-500 ${
      pinned ? "relative bottom-0 top-auto items-start px-0" : "absolute inset-x-0 top-1/4 bottom-1/5 items-center justify-end px-8"
    }`}>
      <div 
        ref={scrollRef}
        className={`transcript-fade-mask flex w-full flex-col gap-1 overflow-hidden transition-all ${
          pinned ? "max-w-none" : "max-w-2xl py-4"
        }`}
        style={{ 
          maskImage: 'linear-gradient(to top, black 30%, rgba(0,0,0,0.4) 65%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to top, black 30%, rgba(0,0,0,0.4) 65%, transparent 100%)'
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
                      : "max-w-[85%] px-4 py-2 text-base border border-white/10 shadow-md bg-white/15"
                  } ${
                    msg.role === "user" ? "text-white" : "text-white/95"
                  }`}
                  style={{ textShadow: msg.role === "ai" ? "0 0 8px rgba(255,255,255,0.2)" : "none" }}
                >
                  <span className={pinned ? "opacity-40 mr-2" : "hidden"}>
                    {msg.role === "user" ? "你:" : "AI:"}
                  </span>
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
