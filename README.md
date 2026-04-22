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

## Data

Uses the [SWaT (Secure Water Treatment) dataset](https://itrust.sutd.edu.sg/itrust-labs_datasets/) from iTrust/SUTD — 11 days of 1-second readings from a real six-stage water treatment testbed, including 36 labeled cyber-physical attack scenarios.

CSVs live in `data/` (gitignored). Processed files from [`archetypeai-batch-examples-swat`](https://github.com/archetypeai/archetypeai-batch-examples-swat):

- `swat_raw_labeled.csv` — full labeled timeline for streaming replay
- `swat_normal.csv` / `swat_attack.csv` — n-shot training examples
- `swat_quick_test_200.csv` — 200-row smoke test

## Stack

Svelte 5 + SvelteKit · Tailwind v4 · `@archetypeai/ds-lib-tokens` · bits-ui · layerchart.

## Setup

```bash
cp .env.example .env
# edit .env with your ATAI_API_KEY and ATAI_API_ENDPOINT

npm install
npm run dev
```
