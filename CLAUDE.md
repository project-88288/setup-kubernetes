# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository generates Kubernetes manifests for running the `88288/ftrade-minibot` image. The minibot is a crypto trading bot that trades on different exchanges (Binance, KuCoin), pairs (BTCUSDT, ETHUSDT, etc.), and timeframes (1m, 5m, 3m, etc.).

Rather than manually creating a Kubernetes Deployment for each combination, this generator:
1. Queries an **optimizer API** to fetch available trading combinations (exchange/pair/timeframe triplets)
2. **Gates** each combination by fetching its best backtest result and annualizing the ROA (Return on Asset)
3. Filters out combos with ROA below a threshold (default 250%/year)
4. Generates Kubernetes manifests (ConfigMap + Secret + Deployment) for the top N survivors by ROA
5. Writes all manifests to `manifests/` and manages them with Kustomize

## Architecture

### Main Components

**generate.js** — The core generator script. It:
- Reads configuration from `.env` (optimizer connection, ROA gate, top-N selection)
- Fetches all available combinations from the optimizer's `/candles/manifest` endpoint
- For each combo, calls the optimizer's `/results` endpoint to get the best backtest
- Calculates annualized ROA using the formula: `(totalPnl × 365) / windowDays`
- Ranks survivors by ROA and selects the top `TOP_ROA_N`
- Generates YAML manifests and persists the resolved combo list to `config/combinations.json`

**deploy.sh** — Full deployment pipeline that:
1. Generates manifests by running `node generate.js`
2. Applies them to Kubernetes with `kubectl apply -k manifests`
3. Restarts deployments to pull the latest image

### Key Data Flows

1. **Combination Fetching**: `/candles/manifest` returns file paths like `binance/BTCUSDT/5m.json`. The generator parses these to extract exchange, pair, and timeframe.

2. **ROA Gating**: For each combo, fetch `/results?exchange=X&symbol=Y&interval=Z` to get the best backtest. Annualize the ROA using candle count and interval length.

3. **Manifest Generation**: Each combo gets one YAML file containing:
   - A **ConfigMap** named `ftrade-minibot-{slug}-env` with non-sensitive env vars (EXCHANGE, SYMBOL, INTERVAL, and bot-specific config)
   - A **Deployment** with an init container that seeds a writable `.env` file (bots require a persistent `/app/.env`)
   - References to a shared **Secret** (one per exchange) holding sensitive keys (API_KEY, API_SECRET, PASSPHRASE, etc.)

4. **Kustomize Integration**: `kustomization.yaml` lists all generated manifests so `kubectl apply -k manifests` applies them atomically.

### Configuration Hierarchy

- **Generator-only keys** (from .env, not passed to bots): `MIN_ALLOW_ROA`, `TOP_ROA_N`
- **Combo-controlled keys** (always overridden per-combo): `EXCHANGE`, `SYMBOL`, `INTERVAL`
- **Exchange-scoped keys**: `BINANCE_*` or `KUCOIN_*` are only passed to combos on that exchange
- **Shared keys**: Apply to all combos; exchange-scoped variants take precedence
- **Sensitive keys**: Detected by suffix pattern (`_KEY`, `_SECRET`, `_PASSPHRASE`, `_TOKEN`, `_PASSWORD`) and moved into Secrets

## Common Commands

### Generate manifests (with gating)
```bash
npm run generate
# or
node generate.js
```

### Generate with custom TOP_ROA_N
```bash
node generate.js --top 5
```

### Dry-run: gate and report without writing
```bash
node generate.js --dry-run
```

### Write manifests to a different directory
```bash
node generate.js --out ./my-manifests
```

### Full deployment (generate + apply to k8s + restart)
```bash
./deploy.sh
```

### Apply pre-generated manifests
```bash
kubectl apply -k manifests
```

### Monitor deployed bots
```bash
kubectl get pods -l app=ftrade-minibot -w
kubectl logs -l app=ftrade-minibot -f
kubectl describe deployment -l app=ftrade-minibot
```

### Clean generated manifests (keeps config)
```bash
npm run clean
```

## Configuration (.env)

Key variables (all optional except `REMOTE_OPTIMIZER_KEY`):

- **REMOTE_OPTIMIZER_KEY** (required): Shared secret for authenticating with the optimizer API
- **REMOTE_OPTIMIZER_PORT** (default: 4500): Port where optimizer listens on localhost
- **OPTIMIZER_URL** (default: `http://127.0.0.1:{port}`): Override to hit a remote optimizer
- **MIN_ALLOW_ROA** (default: 250): Minimum annualized ROA % to keep a combo
- **TOP_ROA_N** (default: 10): Number of top-ROA survivors to generate manifests for
- **IMAGE** (default: auto-detect): Docker image to use; if not set, auto-detects from `.last-built-image` or local Docker images
- **REGISTRY_USER**: Docker registry user for building image names (e.g., `88288`)
- **BINANCE_API_KEY**, **BINANCE_API_SECRET**: Binance credentials (go into Secrets)
- **KUCOIN_API_KEY**, **KUCOIN_API_SECRET**, **KUCOIN_PASSPHRASE**: KuCoin credentials (go into Secrets)
- **Any other variables** starting with `BINANCE_` or `KUCOIN_` will be exchange-scoped

## Key Concepts

**Annualized ROA**: The generator annualizes a backtest's total PnL over its candle window to estimate yearly ROA:
```
roa = (totalPnl × 365) / windowDays
```
This is rounded to 2 decimal places. ROA below `MIN_ALLOW_ROA` are dropped.

**Combination Slug**: Combos are slugified for use in Kubernetes names and file names:
```
{exchange}-{pair}-{timeframe} → lowercase, alphanumerics only, hyphens
Example: Binance BTCUSDT 5m → binance-btcusdt-5m
```

**Secret Sharing**: One Secret per exchange (e.g., `ftrade-minibot-binance-secret`) is created and shared by all combos on that exchange. This keeps secrets out of ConfigMaps and reduces duplication.

**Init Container Pattern**: Each Deployment includes an init container that:
1. Inherits env vars from ConfigMap + Secret
2. Runs `printenv > /seed/.env` to create a writable `.env` file
3. Mounts it at `/app/.env` so the bot can persist backtest results

**Resolved Combinations**: After gating, the generator writes `config/combinations.json` with the exact set of combos that were generated. This serves as the source of truth for deployed combos.

## Troubleshooting

**"Cannot detect Docker username"**: The image auto-detection failed. Either set `IMAGE` in .env or run a build first to create a local image. See the error message for details.

**"optimizer rejected REMOTE_OPTIMIZER_KEY (401)"**: The shared secret is wrong or missing.

**No combos pass the ROA gate**: Either lower `MIN_ALLOW_ROA` in .env, or the optimizer has no results with high enough returns. Use `--dry-run` to see why each combo is dropped.

**Deployment pod not starting**: Check logs with `kubectl logs <pod>`. Common issues:
- Missing Secret (verify `secret-{exchange}.yaml` exists in manifests)
- Wrong image tag (verify `IMAGE` resolves in your registry)
- Missing env vars (check that .env has all required `BINANCE_*` or `KUCOIN_*` vars)

**Image pull failures**: If using a private registry, ensure ImagePullSecrets are configured in the Deployment spec or in kustomization.yaml.
