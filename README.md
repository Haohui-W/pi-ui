# Pi UI

Desktop workbench for pi-agent.

This project uses an Electron shell and talks to pi through `pi --mode rpc`. The UI does not embed the pi SDK; pi remains the source of truth for sessions, tools, auth, models, skills, and extensions.

## Scripts

- `npm run dev` - start the Electron development app.
- `npm run build` - type-check and build the Electron app.
- `npm run dist` - build packaged desktop artifacts with Electron Builder.

## CI

GitHub Actions builds and publishes Electron bundles for Windows, macOS, and Linux when a `v*` tag is pushed.
