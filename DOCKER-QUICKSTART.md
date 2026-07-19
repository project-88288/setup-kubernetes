# Docker Quick Start

Run the entire crypto bot deployment pipeline in Docker in 3 steps.

## Step 1: Build the Docker image

```bash
docker build -t ftrade-generator .
```

This creates an image with Node.js, kubectl, and the generator script.

## Step 2: Set your secrets

```bash
export REMOTE_OPTIMIZER_KEY=your-optimizer-secret
export BINANCE_API_KEY=your-binance-key
export BINANCE_API_SECRET=your-binance-secret
export KUCOIN_API_KEY=your-kucoin-key
export KUCOIN_API_SECRET=your-kucoin-secret
export KUCOIN_PASSPHRASE=your-kucoin-passphrase
```

## Step 3: Run the pipeline

### Option A: Generate manifests only (no Kubernetes deployment)

```bash
docker run \
  -e REMOTE_OPTIMIZER_KEY=$REMOTE_OPTIMIZER_KEY \
  -e OPTIMIZER_URL=http://optimizer-host:4500 \
  -v $(pwd)/manifests:/app/manifests \
  ftrade-generator generate-only
```

**Output:** Generated manifests in `./manifests/`

### Option B: Full pipeline (generate + deploy to Kubernetes)

```bash
docker run \
  -e REMOTE_OPTIMIZER_KEY=$REMOTE_OPTIMIZER_KEY \
  -e BINANCE_API_KEY=$BINANCE_API_KEY \
  -e BINANCE_API_SECRET=$BINANCE_API_SECRET \
  -e KUCOIN_API_KEY=$KUCOIN_API_KEY \
  -e KUCOIN_API_SECRET=$KUCOIN_API_SECRET \
  -e KUCOIN_PASSPHRASE=$KUCOIN_PASSPHRASE \
  -e OPTIMIZER_URL=http://optimizer-host:4500 \
  -v $(pwd)/manifests:/app/manifests \
  -v ~/.kube:/root/.kube:ro \
  ftrade-generator run
```

**Output:** Manifests deployed to your Kubernetes cluster

### Option C: Using docker-compose (with local optimizer)

```bash
docker-compose --profile full-stack up
```

This spins up both the optimizer and generator in Docker, configured to talk to each other.

## How It Works

1. **Optimizer Connection** → Connects to optimizer API at `$OPTIMIZER_URL`
2. **Combination Fetching** → Queries `/candles/manifest` for all trading combos
3. **ROA Gating** → Filters combos by annualized ROA % (default 250%)
4. **Manifest Generation** → Creates ConfigMap + Secret + Deployment YAML files
5. **Kubernetes Deploy** → Applies manifests to your cluster with `kubectl apply -k`
6. **Pod Restart** → Restarts bot deployments to pull latest image

## Common Commands

| Command | Purpose |
|---------|---------|
| `generate-only` | Generate manifests, don't deploy |
| `dry-run` | Gate combos without writing output |
| `deploy-only` | Deploy pre-generated manifests |
| `shell` | Open interactive shell for debugging |

```bash
docker run -e REMOTE_OPTIMIZER_KEY=$REMOTE_OPTIMIZER_KEY ftrade-generator [COMMAND]
```

## Troubleshooting

### "Cannot connect to Kubernetes cluster"

Make sure kubeconfig is mounted:

```bash
docker run -v ~/.kube:/root/.kube:ro ftrade-generator run
```

### "Could not connect to optimizer"

Verify optimizer is running and reachable:

```bash
docker run -it ftrade-generator shell
# Inside container:
curl -H "X-Optimizer-Key: $REMOTE_OPTIMIZER_KEY" http://optimizer-host:4500/candles/manifest
```

### "Permission denied" for kubeconfig

Make file readable:

```bash
chmod 600 ~/.kube/config
```

## More Info

See `DOCKER.md` for complete documentation, environment variables, volume mounts, and advanced usage.

## Example: Real-world deployment flow

```bash
# 1. Build once
docker build -t ftrade-generator .

# 2. Set secrets
export REMOTE_OPTIMIZER_KEY=abc123def456
export BINANCE_API_KEY=xxx
export BINANCE_API_SECRET=yyy
export KUCOIN_API_KEY=zzz
export KUCOIN_API_SECRET=aaa
export KUCOIN_PASSPHRASE=bbb

# 3. Run full pipeline (every 6 hours via cron)
docker run \
  -e REMOTE_OPTIMIZER_KEY=$REMOTE_OPTIMIZER_KEY \
  -e BINANCE_API_KEY=$BINANCE_API_KEY \
  -e BINANCE_API_SECRET=$BINANCE_API_SECRET \
  -e KUCOIN_API_KEY=$KUCOIN_API_KEY \
  -e KUCOIN_API_SECRET=$KUCOIN_API_SECRET \
  -e KUCOIN_PASSPHRASE=$KUCOIN_PASSPHRASE \
  -e OPTIMIZER_URL=http://optimizer-host:4500 \
  -v $(pwd)/manifests:/app/manifests \
  -v ~/.kube:/root/.kube:ro \
  ftrade-generator run

# 4. Monitor deployed bots
kubectl get pods -l app=ftrade-minibot -w
kubectl logs -l app=ftrade-minibot -f
```

## Schedule with Kubernetes CronJob

To run this as a scheduled job inside your Kubernetes cluster:

```bash
kubectl apply -f kubernetes-cronjob.yaml

# Edit the secret with real credentials
kubectl edit secret ftrade-secrets

# Check CronJob status
kubectl get cronjob ftrade-generator
kubectl get jobs -l app=ftrade-generator -w
```
