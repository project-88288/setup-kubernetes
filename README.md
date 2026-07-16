# setup-kubernetes

Kubernetes manifest generator for running **ftrade-mini-bot** trading bots at scale. Reads exchange/pair/timeframe combinations from config, validates them against backtest ROA thresholds, and generates optimized Kubernetes deployments.

## Quick Start

```bash
# Generate manifests for the top 10 performing combos
npm run generate

# Apply to cluster
kubectl apply -k manifests

# Stop all bots (keep Deployments)
kubectl scale deployment -l app=ftrade-minibot --replicas=0

# Remove everything
kubectl delete -k manifests
```

## How It Works

1. **Fetch Combinations** → `generate.js` queries optimizer's `/candles/manifest` endpoint to get all available combinations
2. **Gate Combos** → For each combination, fetch backtest ROA from the optimizer service
3. **Filter** → Only combos with annualized ROA > 250% (configurable) are selected; top 10 (configurable) proceed
4. **Manifests** → Per-exchange Secrets (credentials) and per-combo ConfigMaps + Deployments are written
5. **Deploy** → `kubectl apply -k manifests` spins up the pods
6. **Runtime** → Each pod runs `ftrade-mini-bot:latest` with its combo's config injected via ConfigMap/Secret

## Configuration

### `.env` file (not committed)

```bash
# Optimizer service location & credentials
REMOTE_OPTIMIZER_PORT=3000
REMOTE_OPTIMIZER_KEY=your-api-key
OPTIMIZER_URL=http://127.0.0.1:3000  # Optional: override base URL for remote optimizer

# Generation thresholds
MIN_ALLOW_ROA=250        # Min annualized ROA (%) to pass the gate
TOP_ROA_N=10            # How many top combos to generate manifests for

# Exchange credentials (split into Secrets)
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
KUCOIN_API_KEY=...
KUCOIN_API_SECRET=...

# Bot config (goes into ConfigMaps)
RISK_PER_TRADE=0.01
LEVERAGE=2
# ... other combo-agnostic settings
```

**Important:** `.env` and generated `manifests/` should never be committed — they contain live credentials.

## Commands

```bash
node generate.js                  # Gate every combo, generate top TOP_ROA_N
node generate.js --top 5          # Override TOP_ROA_N for this run
node generate.js --dry-run        # Report full ROA ranking, write nothing
node generate.js --out ./out      # Write manifests to custom directory

npm run generate                  # Alias for: node generate.js
npm run clean                     # Alias for: rm -rf manifests
```

## Deployment

### Apply generated manifests

```bash
kubectl apply -k manifests
```

This applies:
- Per-exchange Secrets (e.g., `binance-secret`, `kucoin-secret`)
- Per-combo ConfigMaps (e.g., `ftrade-minibot-binance-btcusdt-1m`)
- Per-combo Deployments with pod specs

### Monitor pods

```bash
# Watch all mini-bot pods
kubectl get pods -l app=ftrade-minibot -w

# View logs for a specific combo
kubectl logs -l combo=binance-btcusdt-1m -f

# Describe a deployment
kubectl describe deployment ftrade-minibot-binance-btcusdt-1m
```

### Scale operations

```bash
# Pause all bots (scale to 0, keep Deployments)
kubectl scale deployment -l app=ftrade-minibot --replicas=0

# Resume all bots
kubectl scale deployment -l app=ftrade-minibot --replicas=1

# Stop a single combo
kubectl delete deployment ftrade-minibot-binance-btcusdt-1m

# Restart all bots
kubectl rollout restart deployment -l app=ftrade-minibot
```

## Generated Manifests

Each run produces:

- **Secrets** (per exchange)
  - `binance-secret.yaml` — API keys, secrets, passphrases
  - `kucoin-secret.yaml`

- **ConfigMaps + Deployments** (per combo, numbered)
  - `01-binance-btcusdt-1m.yaml` — Top ROA combo
  - `02-binance-ethusdt-1m.yaml`
  - ... up to `TOP_ROA_N`

- **kustomization.yaml** — Ties all above together for `kubectl apply -k`

- **combinations.json** — Records which combos were selected and their ROA scores (for reference)

## Architecture

### Manifest Generator (`generate.js`)

```javascript
buildAllCombinations()  // Query optimizer /candles/manifest, extract combos from file paths
  ↓
gateCombo()             // For each combo:
                        //   1. Fetch optimizer's best backtest result
                        //   2. Calculate annualized ROA (totalPnl × 365 / windowDays)
                        //   3. Keep if ROA > MIN_ALLOW_ROA
  ↓
Ranking                 // Sort survivors by ROA descending
  ↓
writeManifests()        // Write top TOP_ROA_N combos to manifests/
                        //   - Per-exchange Secrets
                        //   - Per-combo ConfigMaps + Deployments
```

### Environment Splitting

Keys are split between Secrets and ConfigMaps based on content:

- **→ Secret** (per-exchange): Keys matching `_KEY|_SECRET|_PASSPHRASE|_TOKEN|_PASSWORD`
  - `BINANCE_API_KEY`, `BINANCE_API_SECRET`
  - `KUCOIN_API_KEY`, `KUCOIN_API_SECRET`

- **→ ConfigMap** (per-combo): Everything else
  - `RISK_PER_TRADE`, `LEVERAGE`, `COOLDOWN_MINS`, etc.

- **→ Generator only** (not in either): `MIN_ALLOW_ROA`, `TOP_ROA_N` (these configure the generator itself)

### Pod Initialization

Each combo's Deployment includes:

1. **Init container** (`seed-dotenv`)
   - Reads ConfigMap + Secret env vars
   - Writes them to `/app/.env` in an `emptyDir`
   - Makes it world-writable so the bot can persist backtest results

2. **Main container** (`ftrade-mini-bot:latest`)
   - Image: `chaiya0899223232/ftrade-mini-bot:latest`
   - Mounts: ConfigMap (env vars), Secret (credentials), emptyDir (writable `/app/.env`)
   - Runs the bot with all config injected

## Troubleshooting

### Generation fails: "Optimizer unreachable"

Check that the optimizer service is running and the `.env` variables are correct:
```bash
curl -H "X-Optimizer-Key: $REMOTE_OPTIMIZER_KEY" \
  http://127.0.0.1:$REMOTE_OPTIMIZER_PORT/results
```

### No combos pass the ROA gate

All combos were filtered out (no ROA > 250%). Run with `--dry-run` to see all ROA scores:
```bash
node generate.js --dry-run
```

Lower `MIN_ALLOW_ROA` in `.env` if needed.

### Pod can't access credentials

Verify the Secret was created:
```bash
kubectl get secrets
kubectl describe secret binance-secret
```

Verify the Deployment references it (check `envFrom.secretRef` in the manifest).

### Bot logs show "env file not writable"

Verify the init container ran successfully:
```bash
kubectl describe pod <pod-name>  # Check init container status
kubectl logs <pod-name> -c seed-dotenv  # View init logs
```

### Manifests not synced with combo ROA scores

Regenerate after a backtest batch completes:
```bash
npm run generate
kubectl apply -k manifests
```

The optimizer's `/results` endpoint should reflect the latest backtests.

## Project Structure

```
.
├── generate.js                    # Main generator script (no dependencies)
├── package.json                   # Node.js metadata
├── .env                          # Credentials & gate thresholds (NOT committed)
├── .gitignore                    # Excludes .env and manifests/
├── config/
│   └── combinations.json          # Generated: selected combos (for reference)
├── manifests/                     # Generated Kubernetes YAML
│   ├── {exchange}-secret.yaml
│   ├── NN-{slug}.yaml            # ConfigMap + Deployment per combo
│   └── kustomization.yaml
└── CLAUDE.md                      # Developer guidance

```

## Notes

- **No build step**: Uses prebuilt image `chaiya0899223232/ftrade-mini-bot:latest`
- **No test suite**: The optimizer service is the source of truth for backtest validation
- **Stateless generator**: Each run is independent; old manifests are wiped before new ones are written
- **Writable `/app/.env` is required**: The bot persists backtest results; the emptyDir + init container pattern lets each pod write to its own copy
