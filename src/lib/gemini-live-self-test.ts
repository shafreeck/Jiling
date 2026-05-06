import { GoogleGenAI, Modality } from "@google/genai";
import { invoke } from "@tauri-apps/api/core";
import { GeminiLiveClient } from "@/lib/gemini-live";

type LogFn = (message: string) => void;

type LiveHarness = {
  session: any;
  next: (timeoutMs?: number) => Promise<any>;
};

const MODEL = "gemini-3.1-flash-live-preview";
const EXPECTED_PHRASE = "青铜钥匙52741";

async function fetchPcm(path: string) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`读取测试音频失败: ${response.status} ${path}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function openLiveSession(ai: GoogleGenAI, handle: string | null, log: LogFn): Promise<LiveHarness> {
  const queue: any[] = [];
  let notify: (() => void) | null = null;

  const session = await ai.live.connect({
    model: MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Kore" },
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption: handle ? { handle } : {},
      systemInstruction: {
        parts: [{ text: "你是一个中文助手。必须准确记住用户给出的口令。回答尽量短。" }],
      },
    },
    callbacks: {
      onopen: () => log(`[自检] Live 已打开 (${handle ? "resume" : "new"})`),
      onmessage: (message: any) => {
        queue.push(message);
        notify?.();
        notify = null;
      },
      onerror: (error: any) => log(`[自检] Live 错误: ${error.message || error}`),
      onclose: (event: any) => log(`[自检] Live 关闭: ${event.code} ${event.reason || ""}`),
    },
  });

  const next = (timeoutMs = 15000) =>
    new Promise<any>((resolve, reject) => {
      if (queue.length > 0) {
        resolve(queue.shift());
        return;
      }

      const timer = window.setTimeout(() => {
        reject(new Error("等待 Live 消息超时"));
      }, timeoutMs);

      notify = () => {
        window.clearTimeout(timer);
        resolve(queue.shift());
      };
    });

  while (true) {
    const message = await next();
    if (message.setupComplete) {
      log("[自检] setupComplete");
      return { session, next };
    }
  }
}

function sendPcm(session: any, pcm: Uint8Array) {
  for (let offset = 0; offset < pcm.length; offset += 3200) {
    const chunk = pcm.subarray(offset, Math.min(offset + 3200, pcm.length));
    let binary = "";
    for (let i = 0; i < chunk.length; i += 8192) {
      binary += String.fromCharCode.apply(null, chunk.slice(i, i + 8192) as unknown as number[]);
    }
    session.sendRealtimeInput({
      audio: {
        data: btoa(binary),
        mimeType: "audio/pcm;rate=16000",
      },
    });
  }
  session.sendRealtimeInput({ audioStreamEnd: true });
}

function pcmChunkToBase64(chunk: Uint8Array) {
  let binary = "";
  for (let i = 0; i < chunk.length; i += 8192) {
    binary += String.fromCharCode.apply(null, chunk.slice(i, i + 8192) as unknown as number[]);
  }
  return btoa(binary);
}

function sendPcmToClient(client: GeminiLiveClient, pcm: Uint8Array) {
  for (let offset = 0; offset < pcm.length; offset += 3200) {
    const chunk = pcm.subarray(offset, Math.min(offset + 3200, pcm.length));
    client.sendAudio(pcmChunkToBase64(chunk));
  }
  client.markAudioStreamEnd();
}

async function runTurn(harness: LiveHarness, pcm: Uint8Array, log: LogFn) {
  sendPcm(harness.session, pcm);

  let input = "";
  let output = "";
  let latestHandle: string | null = null;
  const deadline = Date.now() + 45000;

  while (Date.now() < deadline) {
    const message = await harness.next(Math.max(1000, deadline - Date.now()));
    const update = message.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle) {
      latestHandle = update.newHandle;
      log(`[自检] newHandle: ${update.newHandle}`);
    }

    const inputText = message.serverContent?.inputTranscription?.text;
    if (inputText) {
      input += inputText;
      log(`[自检] 输入转写: ${inputText}`);
    }

    const outputText = message.serverContent?.outputTranscription?.text;
    if (outputText) {
      output += outputText;
      log(`[自检] 输出转写: ${outputText}`);
    }

    if (message.serverContent?.turnComplete) {
      log("[自检] turnComplete");
      break;
    }
  }

  return { input, output, latestHandle };
}

export async function runGeminiLiveSelfTest(log: LogFn) {
  log("[自检] 开始 WebView Live sessionResumption 自检...");
  const apiKey = await invoke<string>("get_api_key");
  if (!apiKey) throw new Error("API Key not found");

  const [rememberPcm, askPcm] = await Promise.all([
    fetchPcm("/gemini-live-self-test/remember.pcm"),
    fetchPcm("/gemini-live-self-test/ask.pcm"),
  ]);

  const ai = new GoogleGenAI({ apiKey });
  const first = await openLiveSession(ai, null, log);
  const firstResult = await runTurn(first, rememberPcm, log);
  first.session.close();

  if (!firstResult.latestHandle) {
    throw new Error("第一轮没有拿到 newHandle");
  }

  log(`[自检] 第一轮完成，handle=${firstResult.latestHandle}`);
  await new Promise((resolve) => window.setTimeout(resolve, 1200));

  const second = await openLiveSession(ai, firstResult.latestHandle, log);
  const secondResult = await runTurn(second, askPcm, log);
  second.session.close();

  if (!secondResult.output.includes(EXPECTED_PHRASE)) {
    throw new Error(`恢复失败：期望 ${EXPECTED_PHRASE}，实际输出 ${secondResult.output}`);
  }

  log(`[自检] PASS: WebView 恢复成功，输出=${secondResult.output}`);
  await runProductionClientSelfTest(rememberPcm, askPcm, log);
}

async function runProductionClientTurn(client: GeminiLiveClient, pcm: Uint8Array) {
  let input = "";
  let output = "";
  let turnComplete = false;

  const waitForTurn = new Promise<{ input: string; output: string }>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("生产客户端等待 turnComplete 超时"));
    }, 45000);

    (client as any).__selfTestResolveTurn = (message: any) => {
      const inputText = message.serverContent?.inputTranscription?.text;
      if (inputText) input += inputText;

      const outputText = message.serverContent?.outputTranscription?.text;
      if (outputText) output += outputText;

      if (message.serverContent?.turnComplete && !turnComplete) {
        turnComplete = true;
        window.clearTimeout(timeout);
        resolve({ input, output });
      }
    };
  });

  sendPcmToClient(client, pcm);
  return waitForTurn;
}

async function runProductionClientSelfTest(rememberPcm: Uint8Array, askPcm: Uint8Array, log: LogFn) {
  log("[生产自检] 开始 GeminiLiveClient 闭环自检...");
  GeminiLiveClient.clearStoredHandle();

  const makeClient = (label: string) => {
    const client = new GeminiLiveClient({
      onLog: (message) => log(`[生产自检:${label}] ${message}`),
      onError: (error) => log(`[生产自检:${label}] error ${error.message || error}`),
      onClose: () => log(`[生产自检:${label}] closed`),
      onMessage: (message) => {
        const inputText = message.serverContent?.inputTranscription?.text;
        if (inputText) log(`[生产自检:${label}] 输入转写: ${inputText}`);
        const outputText = message.serverContent?.outputTranscription?.text;
        if (outputText) log(`[生产自检:${label}] 输出转写: ${outputText}`);
        (client as any).__selfTestResolveTurn?.(message);
      },
    });
    return client;
  };

  const first = makeClient("first");
  await first.connect();
  const firstResult = await runProductionClientTurn(first, rememberPcm);
  await first.closeGracefully(5000);
  const handle = GeminiLiveClient.getStoredHandle();
  log(`[生产自检] 第一轮 output=${firstResult.output} handle=${handle || "<none>"}`);

  if (!handle) {
    throw new Error("生产客户端第一轮没有保存 handle");
  }

  await new Promise((resolve) => window.setTimeout(resolve, 1200));

  const second = makeClient("second");
  await second.connect();
  const secondResult = await runProductionClientTurn(second, askPcm);
  await second.closeGracefully(5000);

  if (!secondResult.output.includes(EXPECTED_PHRASE)) {
    throw new Error(`生产客户端恢复失败：期望 ${EXPECTED_PHRASE}，实际输出 ${secondResult.output}`);
  }

  log(`[生产自检] PASS: GeminiLiveClient 恢复成功，输出=${secondResult.output}`);
}
