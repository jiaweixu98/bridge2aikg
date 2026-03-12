# bridge2aikg

Interactive talent knowledge graph for Bridge2AI, integrated with the CM4AI recommender (`/matrix`) on the same OCI host.

## What This Project Does

- Visualizes a large author graph (typically tens of thousands of nodes; size depends on current seed build) in an interactive canvas.
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
- `work/data/author_metadata.json`
- `work/data/author_collab_dataset.json`
- `work/data/layout_manifest.json`

Notes:

- Large data files are intentionally ignored in git.
- APIs load collaborators on-demand to reduce initial payload.

## Correct Pipeline Integration (local)

Data source pipeline (example):

- `PIPELINE_ROOT=/home/ubuntu/correct_pipline_code`
- `DATA_ROOT=/home/ubuntu`

```bash
export PIPELINE_ROOT=/home/ubuntu/correct_pipline_code
export DATA_ROOT=/home/ubuntu
```

Runtime data path for this app (example):

- `$DATA_ROOT/bridge2aikg/work/data`

Sync command:

```bash
python "$PIPELINE_ROOT/08_sync_to_apps.py"
```

Gate check:

```bash
python "$PIPELINE_ROOT/09_smoke_test_apps.py"
```

Canonical release path:

1. `python "$PIPELINE_ROOT/run_pipeline.py" --embedding-model specter2 --layout-method umap`
2. `python "$PIPELINE_ROOT/08_sync_to_apps.py"`
3. `python "$PIPELINE_ROOT/09_smoke_test_apps.py"`

Fast rebuild path used on this host:

1. `python "$PIPELINE_ROOT/05_build_embeddings.py" --embedding-model specter2 --author-agg-mode paper_weighted --devices cuda:1,cuda:2,cuda:3 --batch-size 32 --max-papers-per-author 12 --layout-method umap`
2. `python "$PIPELINE_ROOT/06_export_bridge2aikg.py"`
3. `python "$PIPELINE_ROOT/07_export_cm4ai_bot.py"`
4. `python "$PIPELINE_ROOT/08_sync_to_apps.py"`
5. `python "$PIPELINE_ROOT/09_smoke_test_apps.py"`

Snapshot rollback:

```bash
python "$PIPELINE_ROOT/08_sync_to_apps.py" --snapshot-id <snapshot_id> --no-snapshot
```

Paper embedding cache note:

- Step 05 in pipeline reuses cached paper embedding shards under  
  `$DATA_ROOT/correct_bridge2aikg_full_web/intermediate/paper_embeddings_cache/`  
  when PMID lists match.

## Git / Repo Notes

- Directory renamed from `knowledge_graph_viz` to `bridge2aikg`.
- This repo is intended to track code and deployment config, not large datasets or caches.
- `.gitignore` is configured to exclude `node_modules`, build artifacts, and large local data.

## Known Operational Notes

- First request after service restart may be slower while dev server warms up.
- If public site briefly shows `502` right after restart, recheck after a few seconds.
- If UI changes do not appear immediately, hard refresh the browser (`Ctrl/Cmd + Shift + R`).
