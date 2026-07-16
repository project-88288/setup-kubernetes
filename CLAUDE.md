# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Node.js manifest generator (no runtime service of its own). It emits Kubernetes
manifests that run the prebuilt image `chaiya0899223232/ftrade-mini-bot:latest` —
one Deployment + ConfigMap per **exchange × pair × timeframe** combination. Each
pod loads its combo's config via `envFrom` (ConfigMap for plain values, a shared
per-exchange Secret for credentials). The image also **requires a writable
`/app/.env` file** (it persists backtest results there); env vars alone are not
enough, so each pod runs a `seed-dotenv` init container that writes the combo's
config into an `emptyDir` mounted at `/app/.env`. There is no build step and no
test suite; `generate.js` is the whole product.

**A combo is only emitted if it clears a backtest gate.** For every combination
`generate.js` asks the optimizer service (over HTTP, `X-Optimizer-Key`) for its
best saved result, annualizes the ROA over the combo's candle window, and drops
combos with no result or an annualized ROA that does not **exceed**
`MIN_ALLOW_ROA` (default 250 %/yr). Survivors are ranked by ROA and manifests are
written for the **top `TOP_ROA_N`** (default 10). This requires the optimizer
(`../ftrade-msi-optimizer-bot-p2p`) to be running and reachable — by default at
`http://127.0.0.1:${REMOTE_OPTIMIZER_PORT}`.

## Commands

```bash
node generate.js                # gate every combo, write manifests for the top TOP_ROA_N
node generate.js --top 5        # override TOP_ROA_N for this run
node generate.js --dry-run      # gate + report full ROA ranking only, write nothing
node generate.js --out ./out    # write manifests to a different directory
npm run generate                # == node generate.js
npm run clean                   # rm -rf manifests

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

A local `node generate.js` run is stopped with `Ctrl+C`.

Requires Node with ESM (`"type": "module"`). No dependencies to install.

## Architecture

**`generate.js`** — the manifest generator: a CLI over a small core.
- `buildAllCombinations(baseUrl, key)` — fetches combinations from the optimizer's
  `/candles/manifest` endpoint and parses file paths (e.g., `binance/BTCUSDT/5m.json`)
  to extract exchange, pair, and timeframe. Returns the full combo set.
- `gateCombo(combo, {baseUrl, key, candleFiles})` — fetches the combo's best
  backtest from the optimizer (`GET /results`), sizes the window from its latest
  candle snapshot (candle manifest is fetched once per run and reused for every combo),
  and returns the annualized ROA (`totalPnl × 365 / windowDays`).
- `writeManifests(selected, outDir)` — wipes `outDir`, writes one Secret per used
  exchange, a numbered `NN-<slug>.yaml` (ConfigMap+Deployment) per combo, a
  `kustomization.yaml`, and records the resolved set back to `config/combinations.json`.

Each combo's Deployment mounts an `emptyDir` at `/app/.env` and a `seed-dotenv`
init container (`printenv > /app/.env`, `chmod 666`) materializes it from the
same ConfigMap+Secret, so the image has both env vars and the writable `.env`
file it needs.

Env-splitting rule (in `generate.js`): keys matching `_KEY|_SECRET|_PASSPHRASE|_TOKEN|_PASSWORD`
go into the per-exchange **Secret**; everything else into the combo **ConfigMap**.
Keys prefixed `BINANCE_`/`KUCOIN_` are scoped to that exchange; unprefixed keys
apply to all. See `isSecret()` and `keyAppliesTo()`. Keys in `GENERATOR_ONLY_KEYS`
(`MIN_ALLOW_ROA`, `TOP_ROA_N`) configure the generator and are kept out of both.
Keys in `COMBO_KEYS` (`EXCHANGE`, `SYMBOL`, `INTERVAL`) are fixed by the combo and
always override any same-named `.env` default — otherwise every ConfigMap would
inherit `.env`'s single-bot `SYMBOL`/`INTERVAL`/`EXCHANGE`. See `configForCombo()`.

## Inputs

- **Optimizer API** (`GET /candles/manifest`) provides all available combinations.
  The manifest returns file paths like `exchange/pair/timeframe.json` which
  `generate.js` parses to build the combo set. Add combinations by ensuring they
  exist in the optimizer's candle storage.
- **`.env`** (KEY=VALUE) is the source for all ConfigMap/Secret values **and** for
  the gate: `REMOTE_OPTIMIZER_PORT` + `REMOTE_OPTIMIZER_KEY` locate/authenticate
  the optimizer, `MIN_ALLOW_ROA` (default 250) is the ROA threshold, and
  `TOP_ROA_N` (default 10) caps how many top survivors are generated. It holds
  live API credentials — **do not commit generated Secret manifests or `.env`
  contents**, and keep secrets out of anything you print. Override the optimizer
  base URL with `OPTIMIZER_URL` (e.g. to gate against a remote node).
- **`config/combinations.json`** and **`manifests/`** are generated outputs; don't
  hand-edit them (they're overwritten on the next generate).
