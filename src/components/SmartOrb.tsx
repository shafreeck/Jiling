"use client";

import { motion } from "framer-motion";

interface SmartOrbProps {
  volume?: number;
  isListening?: boolean;
  status?: "idle" | "listening" | "thinking" | "speaking";
}

export function SmartOrb({ volume = 0, isListening = false, status = "idle" }: SmartOrbProps) {
  const getOrbGradient = () => {
    switch (status) {
      case "listening": return "from-blue-400 to-cyan-500";
      case "thinking": return "from-purple-500 to-pink-500";
      case "speaking": return "from-green-400 to-emerald-500";
      default: return "from-slate-400 to-slate-600";
    }
  };

  return (
    <div className="relative flex items-center justify-center w-64 h-64">
      {/* Background glow */}
      <motion.div
        className={`absolute w-full h-full rounded-full blur-3xl opacity-20 bg-gradient-to-r ${getOrbGradient()}`}
        animate={{
          scale: status !== "idle" ? [1, 1.3, 1] : 1,
          opacity: status !== "idle" ? [0.2, 0.5, 0.2] : 0.1,
        }}
        transition={{ repeat: Infinity, duration: 3 }}
      />
      
      {/* Core Orb */}
      <motion.div
        className={`relative w-32 h-32 rounded-full bg-gradient-to-br shadow-2xl z-10 ${getOrbGradient()}`}
        animate={{
          scale: 1 + volume * 0.6,
          boxShadow: `0 0 ${30 + volume * 60}px rgba(59, 130, 246, 0.6)`,
        }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      />
      
      {/* Dynamic Rings */}
      {[...Array(3)].map((_, i) => (
        <motion.div
          key={i}
          className={`absolute border rounded-full border-white/20`}
          style={{ width: 140 + i * 20, height: 140 + i * 20 }}
          animate={{
            scale: 1 + volume * (0.2 * (i + 1)),
            rotate: i % 2 === 0 ? 360 : -360,
            opacity: status !== "idle" ? 0.3 : 0.1,
          }}
          transition={{ 
            rotate: { repeat: Infinity, duration: 8 + i * 2, ease: "linear" },
            scale: { type: "spring", stiffness: 100, damping: 10 }
          }}
        />
      ))}
    </div>
  );
}
