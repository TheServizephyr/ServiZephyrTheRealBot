# Desktop Foundation

This folder contains the first Electron desktop shell for ServiZephyr.

## What it does today

- launches the app inside an Electron window during development
- packages the Next standalone build as a Windows installer
- exposes a small secure preload bridge for future desktop-only features

## Current scripts

- `npm run desktop:dev`
- `npm run desktop:start`
- `npm run desktop:build`

## Next implementation steps

1. Add SQLite for offline owner/admin dashboard data
2. Add repository abstraction for online vs offline reads/writes
3. Make `manual-order` and dine-in store local offline orders
4. Add sync queue for reconnect upload/download
5. Expand offline support across owner dashboard and admin dashboard
