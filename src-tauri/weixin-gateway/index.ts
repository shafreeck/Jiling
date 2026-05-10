import { isLoggedIn, login, logout, start, type Agent, type ChatRequest, type ChatResponse } from "weixin-agent-sdk";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

/**
 * Jiling Wechat Gateway
 * This process communicates with the Tauri app via JSON-RPC over Standard I/O.
 */

function sendEvent(method: string, params: any) {
  process.stdout.write(JSON.stringify({ type: "event", method, params }) + "\n");
}

let bot: any = null;

const jilingAgent: Agent = {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const requestId = `req-${Date.now()}`;
    sendEvent("message_received", { ...req, requestId });

    // We wait for the main app to provide a response via stdin
    return new Promise((resolve) => {
      const handler = (line: string) => {
        try {
          const msg = JSON.parse(line);
          if (msg.type === "response" && msg.requestId === requestId) {
            rl.off("line", handler);
            resolve(msg.payload);
          }
        } catch (e) {
          // ignore
        }
      };
      rl.on("line", handler);
    });
  },
};

async function main() {
  console.log("[Gateway] Starting Wechat Gateway...");
  
  // Hack: Intercept qrcode-terminal to get the raw URL
  try {
    const qrcodeterminal = await import("qrcode-terminal");
    const originalGenerate = qrcodeterminal.default.generate;
    qrcodeterminal.default.generate = (url: string, options: any, callback?: (qr: string) => void) => {
      console.log("[Gateway] Intercepted QR URL from qrcode-terminal:", url);
      sendEvent("qr_code_url", { url });
      // Still call original to show in terminal
      return originalGenerate.call(qrcodeterminal.default, url, options, callback);
    };
  } catch (e) {
    console.error("[Gateway] Failed to intercept qrcode-terminal", e);
  }

  sendEvent("status", { state: "starting" });

  try {
    // Intercept console.log to catch QR code or login messages
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      const str = args.join(" ");
      if (str.includes("https://login.weixin.qq.com/l/")) {
        const url = str.match(/https:\/\/login\.weixin\.qq\.com\/l\/[^\s]+/)?.[0];
        if (url) {
          sendEvent("qr_code_url", { url });
        }
      }
      originalLog.apply(console, args);
    };

    console.log("[Gateway] Checking login status...");
    if (!isLoggedIn()) {
      console.log("[Gateway] Not logged in. Calling login()...");
      await login();
      sendEvent("status", { state: "logged_in" });
    } else {
      console.log("[Gateway] Already logged in, resuming session...");
      sendEvent("status", { state: "logged_in" });
    }

    bot = start(jilingAgent);
    
    sendEvent("status", { state: "ready" });

    // Handle incoming commands from Tauri
    rl.on("line", (line: string) => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "command") {
          handleCommand(msg);
        }
      } catch (e) {
        // ignore
      }
    });

    await bot.wait();
  } catch (error: any) {
    sendEvent("status", { state: "error", error: error.message });
    process.exit(1);
  }
}

function handleCommand(msg: any) {
  switch (msg.method) {
    case "send_message":
      if (bot) {
        bot.sendMessage(msg.params.text, msg.params.media);
      }
      break;
    case "logout":
      console.log("[Gateway] Calling logout()...");
      logout();
      process.exit(0);
      break;
  }
}

main();
