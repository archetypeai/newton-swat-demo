# newton-swat-demo

Feasibility demo: a water treatment plant paved with sensors, using Newton Machine State Lens to detect per-stage anomalies in real time and surface suggested upstream/downstream actions to an operator.

## Concept

Six process stages in sequence:

1. **P1** — Raw water intake and storage
2. **P2** — Chemical dosing (pre-treatment)
3. **P3** — Ultrafiltration (UF)
4. **P4** — UV dechlorination
5. **P5** — Reverse osmosis (RO)
6. **P6** — Backwash / cleaning

One Newton Machine State Lens session per stage, each trained on that stage's own sensors (n-shot normal vs attack). When a stage flags anomalous, the UI surfaces suggested actions on the adjacent stages ("reduce flow from P2", "isolate P4") — framed as suggestions for a human operator, not autonomous control.

## Stack

Svelte 5 + SvelteKit · Tailwind v4 · `@archetypeai/ds-lib-tokens` · bits-ui · layerchart.

## Data

### Attribution

The SWaT (Secure Water Treatment) dataset was created by [iTrust, Centre for Research in Cyber Security](https://itrust.sutd.edu.sg/) at the Singapore University of Technology and Design (SUTD). For published work, request the dataset through [iTrust's official channels](https://itrust.sutd.edu.sg/itrust-labs_datasets/).

11 consecutive days of 1-second readings from a scaled-down but fully operational six-stage water treatment plant — 7 days of normal operation followed by 4 days with 36 cyber-physical attack scenarios.

### Download (Kaggle mirror)

The fastest way to get started is the [Kaggle mirror of SWaT](https://www.kaggle.com/datasets/vishala28/swat-dataset-secure-water-treatment-system). Download the normal and attack CSVs and drop them in `data/`.

### Prep

The repo tracks the pre-processed outputs in `data/` via Git LFS:

- `swat_raw_labeled.csv` — full labeled timeline used for streaming replay
- `swat_normal.csv` / `swat_attack.csv` — n-shot training examples (normal vs attack)
- `swat_quick_test_200.csv` — 200-row smoke test
- `swat_inference.csv` — inference subset

If you want to regenerate these from a fresh Kaggle download, see `scripts/` — those scripts are ported verbatim from [`archetypeai/archetypeai-batch-examples-swat`](https://github.com/archetypeai/archetypeai-batch-examples-swat) and forward-fill missing SCADA readings before labeling and splitting.

## Setup

```bash
cp .env.example .env
# edit .env with your ATAI_API_KEY and ATAI_API_ENDPOINT

npm install
npm run dev
```

Open http://localhost:5173, press **Start analysis** to spin up the 6 per-stage Newton sessions (n-shot upload + lens register), then **Play** to replay the SWaT timeline at 10× real time and watch classifications arrive on each stage.

## Architecture

```
Browser
 │
 │  EventSource × 6 (one per stage) ──────────────────────┐
 │                                                        │
 │  POST /api/stream  {sessionMap, rows, counter}         │
 │                                                        │
 ▼                                                        ▼
SvelteKit server                              Newton Machine State Lens
 ├─ /api/session   create / destroy 6 sessions in parallel
 ├─ /api/chunk     serve rows from data/swat_raw_labeled.csv
 ├─ /api/stream    fan each window to all 6 per-stage sessions
 └─ /api/sse-proxy authenticated passthrough of lens SSE
```

The `src/lib/server/newton.js` module owns the stage → sensor mapping and creates one `lens_timeseries_state_processor` per stage. Each lens is configured with that stage's `data_columns` but the same shared n-shot uploads (one normal file, one attack file) — 51 columns in the n-shot file, only the stage's subset used per lens.

## Scope caveats

- Anomaly labels in SWaT are plant-wide, not per-stage. Each per-stage Newton session is a best-effort inference based on *that stage's own sensors* — we're explicitly *not* looking at labels to decide which stage saw the attack.
- The Suggested Actions panel is strictly Reason-layer: it surfaces operator guidance, never takes control actions. For any real deployment, actuation would require a separate safety-reviewed control path.
