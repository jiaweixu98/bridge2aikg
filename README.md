# bridge2aikg

Interactive talent knowledge graph for Bridge2AI, integrated with the CM4AI recommender (`/matrix`) on the same OCI host.

## What This Project Does

- Visualizes a large author graph (about 89k nodes) in an interactive canvas.
- Supports search, highlighting collaborators, and author detail exploration.
- Links into the teammate recommendation app (`cm4ai-bot`) with `aid` handoff.
- Uses staged loading (small first payload, then background sync) for faster first interaction.

## Current Deployment Topology (OCI)

- Graph app: `bridge2aikg` (this repo), served by SvelteKit/Vite on `127.0.0.1:5173`
- Recommender app: `/home/ubuntu/cm4ai-bot`
  - Frontend: Next.js on `127.0.0.1:3000`
  - Backend: FastAPI on `127.0.0.1:8000`
- Public domain: `https://bridge2ai.labs-app.com`
  - `/` -> graph app (`5173`)
  - `/matrix/` -> recommender frontend (`3000`)
  - `/matrix/api/*` -> recommender backend (`8000`)
  - `/api/*` -> graph app APIs

## Runtime Services

Systemd unit for this app:

- `knowledge-graph-viz.service`

Useful commands:

```bash
sudo systemctl status knowledge-graph-viz
sudo systemctl restart knowledge-graph-viz
journalctl -u knowledge-graph-viz -f
```

## Local Development

Requirements:

- Node.js >= 20
- npm

Install and run:

```bash
cd /home/ubuntu/bridge2aikg
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open:

- `http://127.0.0.1:5173`

## Data Layout

Expected local data path:

- `work/data/`

Main files used at runtime:

- `work/data/tkg_ebd_89k_dataset.json`
- `work/data/author_dataset_added_citations.csv`
- (optional for static fallback) `static/data/*`

Notes:

- Large data files are intentionally ignored in git.
- APIs load collaborators on-demand to reduce initial payload.

## Git / Repo Notes

- Directory renamed from `knowledge_graph_viz` to `bridge2aikg`.
- This repo is intended to track code and deployment config, not large datasets or caches.
- `.gitignore` is configured to exclude `node_modules`, build artifacts, and large local data.

## Known Operational Notes

- First request after service restart may be slower while dev server warms up.
- If public site briefly shows `502` right after restart, recheck after a few seconds.
- If UI changes do not appear immediately, hard refresh the browser (`Ctrl/Cmd + Shift + R`).
