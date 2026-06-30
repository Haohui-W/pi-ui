# Pi UI

Desktop workbench for pi-agent.

This project uses a Tauri shell and talks to pi through `pi --mode rpc`. The UI does not embed the pi SDK; pi remains the source of truth for sessions, tools, auth, models, skills, and extensions.

## Scripts

- `npm run build` - type-check and build the React frontend.
- `npm run tauri:build` - build the native Tauri app. This is intended for GitHub Actions unless Rust and platform dependencies are installed locally.

## CI

GitHub Actions builds native bundles for Windows, macOS, and Linux.
