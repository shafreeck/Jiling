"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, QrCode, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface WechatLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  qrCodeUrl: string | null;
  status: "idle" | "logging_in" | "success" | "error";
  error?: string;
  onLogout?: () => void;
}

export function WechatLoginModal({
  isOpen,
  onClose,
  qrCodeUrl,
  status,
  error,
  onLogout
}: WechatLoginModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="relative w-full max-w-md overflow-y-auto max-h-[90vh] rounded-3xl border border-white/10 bg-zinc-900/90 p-6 shadow-2xl backdrop-blur-xl custom-scrollbar"
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="absolute right-4 top-4 h-8 w-8 rounded-full text-white/40 hover:bg-white/10 hover:text-white z-10"
            >
              <X className="h-4 w-4" />
            </Button>

            <div className="flex flex-col items-center text-center">
              <div className="mb-4 rounded-2xl bg-green-500/10 p-3 text-green-500">
                <QrCode className="h-6 w-6" />
              </div>
              <h2 className="mb-1 text-xl font-bold text-white">连接微信</h2>
              <p className="mb-4 text-xs text-white/60">
                扫描二维码登录微信，让机灵助手随时待命
              </p>

              <div className="relative mb-4 flex h-52 w-52 items-center justify-center rounded-2xl bg-white p-3 shadow-inner">
                {status === "success" ? (
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex flex-col items-center text-green-600"
                  >
                    <CheckCircle2 className="h-12 w-12 mb-2" />
                    <span className="text-sm font-medium">登录成功</span>
                  </motion.div>
                ) : qrCodeUrl ? (
                  <QRCodeSVG value={qrCodeUrl} size={180} level="H" />
                ) : (
                  <div className="flex flex-col items-center text-zinc-400">
                    <Loader2 className="h-6 w-6 animate-spin mb-2" />
                    <span className="text-xs">正在生成二维码...</span>
                  </div>
                )}
              </div>

              {error && (
                <div className="mb-4 flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              {status === "success" && onLogout && (
                <Button 
                  variant="outline" 
                  onClick={onLogout}
                  className="mt-2 border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white text-xs h-9 px-4"
                >
                  注销当前账号
                </Button>
              )}

              <div className="space-y-4 w-full mt-4">
                <div className="text-[10px] text-white/40 leading-relaxed">
                  提示：请使用微信扫描上方二维码。登录后，你可以直接在微信中发送指令给机灵，它会自动调用本地 Agent 处理并回复。
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
