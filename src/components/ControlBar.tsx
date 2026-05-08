"use client";

import { motion } from "framer-motion";
import { 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  MonitorUp, 
  MessageSquare, 
  MessageSquareOff,
  LogOut,
  Phone,
  PhoneOff,
  MoreVertical
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ControlBarProps {
  isMuted: boolean;
  onToggleMute: () => void;
  isVideoOn: boolean;
  onToggleVideo: () => void;
  isSharing: boolean;
  onToggleShare: () => void;
  showTranscript: boolean;
  onToggleTranscript: () => void;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  isBusy?: boolean;
}

export function ControlBar({
  isMuted,
  onToggleMute,
  isVideoOn,
  onToggleVideo,
  isSharing,
  onToggleShare,
  showTranscript,
  onToggleTranscript,
  isConnected,
  onConnect,
  onDisconnect,
  isBusy
}: ControlBarProps) {
  return (
    <TooltipProvider>
      <motion.div 
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="fixed bottom-8 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/40 p-2 backdrop-blur-2xl shadow-2xl"
      >
        <Tooltip>
          <TooltipTrigger 
            render={
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleMute}
                className={`h-12 w-12 rounded-full transition-all ${
                  isMuted ? "bg-destructive/20 text-destructive hover:bg-destructive/30" : "hover:bg-white/10 text-white"
                }`}
              >
                {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </Button>
            }
          />
          <TooltipContent><p>{isMuted ? "取消静音" : "静音"}</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger 
            render={
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleVideo}
                className={`h-12 w-12 rounded-full transition-all ${
                  !isVideoOn ? "bg-destructive/20 text-destructive hover:bg-destructive/30" : "hover:bg-white/10 text-white"
                }`}
              >
                {isVideoOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              </Button>
            }
          />
          <TooltipContent><p>{isVideoOn ? "关闭视频" : "开启视频"}</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger 
            render={
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleShare}
                className={`h-12 w-12 rounded-full transition-all ${
                  isSharing ? "bg-primary/20 text-primary" : "hover:bg-white/10 text-white"
                }`}
              >
                <MonitorUp className="h-5 w-5" />
              </Button>
            }
          />
          <TooltipContent><p>{isSharing ? "停止共享" : "屏幕共享"}</p></TooltipContent>
        </Tooltip>

        <div className="mx-1 h-8 w-px bg-white/10" />

        <Tooltip>
          <TooltipTrigger 
            render={
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleTranscript}
                className={`h-12 w-12 rounded-full transition-all ${
                  showTranscript ? "bg-white/20 text-white" : "hover:bg-white/10 text-white/60"
                }`}
              >
                {showTranscript ? <MessageSquare className="h-5 w-5" /> : <MessageSquareOff className="h-5 w-5" />}
              </Button>
            }
          />
          <TooltipContent><p>{showTranscript ? "隐藏字幕" : "显示字幕"}</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger 
            render={
              <Button
                variant={isConnected ? "destructive" : "default"}
                size="icon"
                disabled={isBusy}
                onClick={isConnected ? onDisconnect : onConnect}
                className={`h-12 w-12 rounded-full shadow-lg transition-all hover:scale-105 active:scale-95 ${
                  !isConnected ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""
                }`}
              >
                {isConnected ? (
                  <PhoneOff className="h-5 w-5" />
                ) : (
                  <Phone className={`h-5 w-5 ${isBusy ? "animate-pulse" : ""}`} />
                )}
              </Button>
            }
          />
          <TooltipContent><p>{isConnected ? "结束通话" : "开始通话"}</p></TooltipContent>
        </Tooltip>
      </motion.div>
    </TooltipProvider>
  );
}
