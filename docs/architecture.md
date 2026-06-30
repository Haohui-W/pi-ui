# Architecture

Pi UI is an RPC-first desktop shell for `pi-agent`.

The desktop app does not embed `@earendil-works/pi-coding-agent` or call the SDK directly. Instead, it starts a local pi process in RPC mode:

```text
Electron desktop app
  React renderer
  Preload bridge
  Main process manager
        |
        | stdin/stdout JSONL
        v
pi --mode rpc
```

## Responsibilities

- React renders messages, tool activity, session state, and extension UI requests.
- Electron IPC starts/stops the pi process and writes JSON RPC commands to stdin.
- The Electron main process forwards parsed JSON lines from pi stdout to the renderer.
- pi owns model selection, auth, settings, sessions, tools, skills, prompt templates, extensions, and compaction.

## RPC Framing

pi RPC uses strict JSONL framing. The Electron main process reads stdout by LF-delimited lines, parses each line as JSON, and emits the parsed value through the preload bridge.

Renderer-to-agent commands use `window.pi.sendRpc` and are written to pi stdin as one JSON object per line.

## Build Strategy

Local development can run the Electron app with `npm run dev`.

Release bundles are built by GitHub Actions on Windows, macOS, and Linux using Electron Builder.
