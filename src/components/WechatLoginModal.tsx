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
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/90 p-8 shadow-2xl backdrop-blur-xl"
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="absolute right-4 top-4 h-8 w-8 rounded-full text-white/40 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </Button>

            <div className="flex flex-col items-center text-center">
              <div className="mb-6 rounded-2xl bg-green-500/10 p-4 text-green-500">
                <QrCode className="h-8 w-8" />
              </div>
              <h2 className="mb-2 text-2xl font-bold text-white">连接微信</h2>
              <p className="mb-8 text-sm text-white/60">
                扫描二维码登录微信，让机灵助手随时待命
              </p>

              <div className="relative mb-8 flex h-64 w-64 items-center justify-center rounded-2xl bg-white p-4 shadow-inner">
                {status === "success" ? (
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex flex-col items-center text-green-600"
                  >
                    <CheckCircle2 className="h-16 w-16 mb-4" />
                    <span className="font-medium">登录成功</span>
                  </motion.div>
                ) : qrCodeUrl ? (
                  <QRCodeSVG value={qrCodeUrl} size={220} level="H" />
                ) : (
                  <div className="flex flex-col items-center text-zinc-400">
                    <Loader2 className="h-8 w-8 animate-spin mb-4" />
                    <span className="text-sm">正在生成二维码...</span>
                  </div>
                )}
              </div>

              {error && (
                <div className="mb-6 flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              {status === "success" && onLogout && (
                <Button 
                  variant="outline" 
                  onClick={onLogout}
                  className="mt-4 border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                >
                  注销当前账号
                </Button>
              )}

              <div className="space-y-4 w-full mt-8">
                <div className="text-xs text-white/40 leading-relaxed">
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
