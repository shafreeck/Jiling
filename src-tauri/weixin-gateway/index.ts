import { isLoggedIn, login, logout, start, type Agent, type ChatRequest, type ChatResponse } from "weixin-agent-sdk";
import * as readline from "readline";
import fs from "fs";
import path from "path";

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
    log(`Received chat request: ${requestId}, text: ${req.text}`);
    sendEvent("message_received", { ...req, requestId });

    // We wait for the main app to provide a response via stdin
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        rl.off("line", handler);
        log(`Chat request ${requestId} timed out after 60s`);
        resolve({ text: "抱歉，任务处理超时，请稍后再试。" });
      }, 60000);

      const handler = (line: string) => {
        log(`Gateway STDIN received: ${line.substring(0, 100)}${line.length > 100 ? "..." : ""}`);
        try {
          const msg = JSON.parse(line);
          if (msg.type === "response" && msg.requestId === requestId) {
            clearTimeout(timeout);
            rl.off("line", handler);
            log(`Matching response found for ${requestId}, resolving chat Promise`);
            resolve(msg.payload);
          }
        } catch (e) {
          log(`Failed to parse STDIN line: ${e}`);
        }
      };
      rl.on("line", handler);
    });
  },
};

let logStream: fs.WriteStream | null = null;
const log = (msg: string) => {
  const timestamp = new Date().toISOString();
  const formattedMsg = `[${timestamp}] ${msg}`;
  if (logStream) {
    logStream.write(`${formattedMsg}\n`);
  }
  // Use originalLog if defined, or console.log
  console.log(`[Gateway] ${msg}`);
};



async function main() {
  const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || ".", ".openclaw", "openclaw-weixin");
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  logStream = fs.createWriteStream(path.join(stateDir, "gateway.log"), { flags: "a" });

  log(`Starting Wechat Gateway with state directory: ${stateDir}`);
  sendEvent("status", { state: "starting" });
  
  // Hack: Intercept qrcode-terminal to get the raw URL
  try {
    const qrcodeterminal = await import("qrcode-terminal");
    const originalGenerate = qrcodeterminal.default.generate;
    qrcodeterminal.default.generate = (url: string, options: any, callback?: (qr: string) => void) => {
      log(`Intercepted QR URL from qrcode-terminal: ${url}`);
      sendEvent("qr_code_url", { url });
      // Still call original to show in terminal
      return originalGenerate.call(qrcodeterminal.default, url, options, callback);
    };
  } catch (e) {
    log(`Failed to intercept qrcode-terminal: ${e}`);
  }

  const originalLog = console.log;
  try {
    // Intercept console.log to catch QR code or login messages
    console.log = (...args: any[]) => {
      const str = args.join(" ");
      if (logStream) {
        logStream.write(`[${new Date().toISOString()}] [LOG] ${str}\n`);
      }
      
      if (str.includes("https://login.weixin.qq.com/l/")) {
        const url = str.match(/https:\/\/login\.weixin\.qq\.com\/l\/[^\s]+/)?.[0];
        if (url) {
          sendEvent("qr_code_url", { url });
        }
      }
      originalLog.apply(console, args);
    };

    log("Checking login status...");
    if (!isLoggedIn()) {
      log("Not logged in. Calling login()...");
      await login();
      log("login() completed");
    } else {
      log("Already logged in, resuming session...");
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

    rl.on("close", () => {
      log("STDIN closed, process exiting...");
      process.exit(0);
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
      log("Calling logout() and cleaning up accounts directory...");
      logout();
      try {
        const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || ".", ".openclaw", "openclaw-weixin");
        const accountsDir = path.join(stateDir, "accounts");
        if (fs.existsSync(accountsDir)) {
          fs.rmSync(accountsDir, { recursive: true, force: true });
          log("Accounts directory cleaned up.");
        }
      } catch (e) {
        log(`Failed to clean up accounts directory: ${e}`);
      }
      process.exit(0);
      break;
  }
}

main();
