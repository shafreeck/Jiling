# Jiling / 机灵

Jiling is a local desktop voice shell for AI agents. It uses Gemini Live for real-time voice interaction and delegates longer-running work to local agent runtimes such as OpenClaw and AutoClaw through ACP.

## Requirements

- macOS
- Node.js and npm
- Rust toolchain
- Tauri CLI dependencies
- A Gemini API key in `.env`

```bash
GEMINI_API_KEY=your_key_here
```

`.env` is intentionally ignored by Git.

## Development

Start the desktop app with Tauri:

```bash
npm install
npm run tauri dev
```

Do not start Jiling with `npm run dev` as the main workflow. That command only starts the Next.js frontend server on port `3333`; the app depends on the Tauri shell for native APIs, local filesystem access, microphone/audio behavior, and ACP integration.

Tauri is configured to run the frontend dev server automatically:

```json
{
  "devUrl": "http://localhost:3333",
  "beforeDevCommand": "npm run dev"
}
```

## Local Agent Support

Jiling currently detects local provider directories:

- `~/.openclaw`
- `~/.openclaw-autoclaw`
- `~/.hermes`

OpenClaw is the primary supported provider. AutoClaw is supported through its OpenClaw-compatible ACP gateway, with compatibility handling for its older session and device-token layout.

## Useful Commands

```bash
npm run lint
npx tsc --noEmit
cd src-tauri && cargo check
```

## Build

```bash
npm run tauri build
```

The frontend is a Next.js app, but Jiling is shipped and tested as a Tauri desktop application.
