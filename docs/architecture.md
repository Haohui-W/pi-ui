# Architecture

Pi UI is an RPC-first desktop shell for `pi-agent`.

The desktop app does not embed `@earendil-works/pi-coding-agent` or call the SDK directly. Instead, it starts a local pi process in RPC mode:

```text
Tauri desktop app
  React renderer
  Tauri commands/events
  Rust process manager
        |
        | stdin/stdout JSONL
        v
pi --mode rpc
```

## Responsibilities

- React renders messages, tool activity, session state, and extension UI requests.
- Tauri commands start/stop the pi process and write JSON RPC commands to stdin.
- Tauri events forward parsed JSON lines from pi stdout to the renderer.
- pi owns model selection, auth, settings, sessions, tools, skills, prompt templates, extensions, and compaction.

## RPC Framing

pi RPC uses strict JSONL framing. The Rust backend reads stdout by LF-delimited lines, parses each line as JSON, and emits the parsed value as a `pi-rpc` event.

Renderer-to-agent commands use `send_rpc` and are written to pi stdin as one JSON object per line.

## Build Strategy

Local development can run the web build with `npm run build`.

Native Tauri bundles require Rust and platform system dependencies, so release bundles are built by GitHub Actions on Windows, macOS, and Linux.
