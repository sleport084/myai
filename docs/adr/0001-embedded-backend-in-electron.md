# ADR-0001: Embedded Backend in Electron

## Status

Accepted

## Context

XiaoBaiLong needs both a desktop UI and a persistent backend server. The backend handles the consciousness loop, LLM calls, memory, tools, and social connectors. The frontend renders the Brain UI.

## Decision

The backend runs **inside the Electron main process** via dynamic import of `src/index.js`. It is not a separate process. The Electron main finds a free port (preferring 3721), imports the backend, waits for the health endpoint, then creates the BrowserWindow pointing at `http://127.0.0.1:<port>/`.

The backend is a plain Node.js HTTP server (`http.createServer`) serving both the API and static frontend files. No framework (Express, Fastify) is used.

## Consequences

- Single process = simpler deployment and IPC, but the backend and frontend share the same lifecycle
- No hot-reload for backend changes — requires full Electron restart
- The backend can be run standalone via `npm run dev` (node-only, no Electron)
- Port 3721 is hardcoded as the preferred port; conflicts are resolved by finding a free port
- The frontend has no build step — vanilla JS served directly by the HTTP server
