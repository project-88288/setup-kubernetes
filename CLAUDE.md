# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Node.js manifest generator (no runtime service of its own). It emits Kubernetes
manifests that run the prebuilt image `chaiya0899223232/ftrade-mini-bot:latest` —
one Deployment + ConfigMap per **exchange × pair × timeframe** combination. Each
pod loads its combo's config via `envFrom` (ConfigMap for plain values, a shared
per-exchange Secret for credentials). There is no build step and no test suite;
the two scripts are the whole product.

## Commands

```bash
node generate.js                # generate manifests for the first 20 combinations (default)
node generate.js --limit 40     # first N combinations
node generate.js --all          # every combination
node generate.js --out ./out    # write manifests to a different directory
npm run generate                # == node generate.js
npm run clean                   # rm -rf manifests

node select-best-combo.js           # pick the single highest-ROA combo, write only its manifest
node select-best-combo.js --dry-run # rank/report only, write nothing
node select-best-combo.js --out ./out

kubectl apply -k manifests      # apply the whole generated set (kustomization.yaml ties it together)
```

Stop / tear down the deployed bots (every generated manifest carries the
`app: ftrade-minibot` label):

```bash
kubectl delete -k manifests                                   # remove the whole set (Deployments, ConfigMaps, Secrets)
kubectl scale deployment -l app=ftrade-minibot --replicas=0   # stop pods but keep Deployments (fast restart)
kubectl scale deployment -l app=ftrade-minibot --replicas=1   # bring them back
kubectl delete deployment ftrade-minibot-binance-btcusdt-1m   # stop a single combo
```

A local `node generate.js` / `select-best-combo.js` run is stopped with `Ctrl+C`
(or `pkill -f select-best-combo.js` if detached).

Requires Node with ESM (`"type": "module"`). No dependencies to install.

## Architecture

**`generate.js`** — the core library *and* a CLI. Key exports reused elsewhere:
- `buildAllCombinations()` — reads `config/` and returns the full combo set.
- `writeManifests(selected, outDir)` — wipes `outDir`, writes one Secret per used
  exchange, a numbered `NN-<slug>.yaml` (ConfigMap+Deployment) per combo, a
  `kustomization.yaml`, and records the resolved set back to `config/combinations.json`.

Env-splitting rule (in `generate.js`): keys matching `_KEY|_SECRET|_PASSPHRASE|_TOKEN|_PASSWORD`
go into the per-exchange **Secret**; everything else into the combo **ConfigMap**.
Keys prefixed `BINANCE_`/`KUCOIN_` are scoped to that exchange; unprefixed keys
apply to all. See `isSecret()` and `keyAppliesTo()`.

**`select-best-combo.js`** — a backtest-gated selector that imports from
`generate.js`. It reads optimizer output from a *sibling* repo
(`../ftrade-msi-optimizer-bot-p2p/` by default), computes each combo's annualized
ROA (`totalPnl × 365 / windowDays`, window sized from saved candle snapshots),
drops combos below `MIN_ROA_ALLOW`, and calls `writeManifests()` for the single
winner. Override paths via env: `OPTIMIZER_RESULTS_DIR`, `OPTIMIZER_CANDLES_DIR`,
`MIN_ROA_ALLOW` (default 250). Result files are looked up by the optimizer's
`safeKey` naming: `<exchange>_<pair>_<timeframe>.json`, reading `result.top20[0]`.

## Inputs

- **`config/exchanges.json`** drives everything. For each exchange it expects
  `config/<exchange>-pairs.json` and `config/<exchange>-timeframes.json`. Add a
  pair/timeframe/exchange by editing these files — combos are their cross product.
- **`.env`** (KEY=VALUE) is the source for all ConfigMap/Secret values. It holds
  live API credentials — **do not commit generated Secret manifests or `.env`
  contents**, and keep secrets out of anything you print.
- **`config/combinations.json`** and **`manifests/`** are generated outputs; don't
  hand-edit them (they're overwritten on the next generate).
