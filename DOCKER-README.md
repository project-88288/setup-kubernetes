# Docker Deployment Guide

Complete setup for running the ftrade-minibot Kubernetes deployment pipeline in Docker containers.

## 📁 Files Created

| File | Purpose |
|------|---------|
| `Dockerfile` | Containerized environment with Node.js, kubectl, and the generator |
| `docker-compose.yml` | Orchestration for running generator + optimizer together |
| `docker-entrypoint.sh` | Main pipeline script (generate → gate → deploy) |
| `kubernetes-cronjob.yaml` | Run pipeline as a scheduled job inside Kubernetes |
| `DOCKER-QUICKSTART.md` | 3-step quick start guide |
| `DOCKER.md` | Comprehensive documentation with all options |

## 🚀 Quick Start (30 seconds)

```bash
# 1. Build
docker build -t ftrade-generator .

# 2. Run full pipeline
docker run \
  -e REMOTE_OPTIMIZER_KEY=your-secret \
  -e OPTIMIZER_URL=http://optimizer-host:4500 \
  -v ~/.kube:/root/.kube:ro \
  -v $(pwd)/manifests:/app/manifests \
  ftrade-generator run
```

That's it! The pipeline will:
1. ✅ Connect to optimizer API
2. ✅ Fetch trading combinations
3. ✅ Gate by ROA threshold
4. ✅ Generate Kubernetes manifests
5. ✅ Deploy to your cluster

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Container                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Node.js Environment                                         │
│  ├─ generate.js (manifest generator)                        │
│  ├─ docker-entrypoint.sh (orchestration)                    │
│  └─ kubectl (for K8s deployment)                            │
│                                                               │
│  Connections:                                                │
│  ├─→ Optimizer API (fetch combos)                           │
│  ├─→ Kubernetes Cluster (deploy manifests)                  │
│  └─→ Host volumes (read/write manifests)                    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 📋 Commands

### Basic Operations

| Command | What It Does |
|---------|-------------|
| `run` | Full pipeline (fetch → generate → deploy) |
| `generate-only` | Generate manifests without deploying |
| `dry-run` | Show what would be deployed without writing |
| `deploy-only` | Deploy already-generated manifests |
| `shell` | Open interactive shell for debugging |

### Examples

```bash
# Generate only
docker run -e REMOTE_OPTIMIZER_KEY=secret ftrade-generator generate-only

# Dry run (see what's selected)
docker run -e REMOTE_OPTIMIZER_KEY=secret ftrade-generator dry-run

# Deploy existing manifests
docker run -v ~/.kube:/root/.kube:ro ftrade-generator deploy-only

# Interactive debugging
docker run -it ftrade-generator shell
```

## 🔧 Environment Variables

Required:
- `REMOTE_OPTIMIZER_KEY` — Shared secret for optimizer authentication

Optional (defaults shown):
```bash
OPTIMIZER_URL=http://127.0.0.1:4500      # Optimizer API URL
MIN_ALLOW_ROA=250                         # ROA gate threshold (%)
TOP_ROA_N=10                              # Number of combos to deploy
KUBECONFIG=/root/.kube/config             # Path to kubeconfig
```

Exchange credentials (for deployment):
```bash
BINANCE_API_KEY=xxx
BINANCE_API_SECRET=yyy
KUCOIN_API_KEY=zzz
KUCOIN_API_SECRET=aaa
KUCOIN_PASSPHRASE=bbb
```

## 📦 Volume Mounts

| Mount | Purpose | Example |
|-------|---------|---------|
| Kubernetes config | Access your cluster | `-v ~/.kube:/root/.kube:ro` |
| Manifests output | Store generated YAML | `-v $(pwd)/manifests:/app/manifests` |
| Custom config | Override .env | `-v $(pwd)/custom.env:/app/.env:ro` |

## 🐳 Docker Compose

For a complete local stack (optimizer + generator running together):

```bash
export REMOTE_OPTIMIZER_KEY=your-secret

docker-compose --profile full-stack up
```

This runs:
- **optimizer** service on port 4500
- **ftrade-generator** service connected to it

See `docker-compose.yml` for configuration.

## ☸️ Kubernetes Integration

### Run inside cluster as CronJob

Deploy the generator as a scheduled job that runs every 6 hours:

```bash
# 1. Create secret with credentials
kubectl create secret generic ftrade-secrets \
  --from-literal=optimizer-key=your-key \
  --from-literal=binance-api-key=xxx \
  --from-literal=binance-api-secret=yyy \
  --from-literal=kucoin-api-key=zzz \
  --from-literal=kucoin-api-secret=aaa \
  --from-literal=kucoin-passphrase=bbb

# 2. Deploy CronJob
kubectl apply -f kubernetes-cronjob.yaml

# 3. Monitor
kubectl get cronjob ftrade-generator
kubectl get jobs -l app=ftrade-generator -w
```

See `kubernetes-cronjob.yaml` for full configuration.

### Run from Docker Desktop to cluster

If your Docker daemon has access to Kubernetes (e.g., Docker Desktop with K8s):

```bash
docker run \
  -e REMOTE_OPTIMIZER_KEY=secret \
  -v ~/.kube:/root/.kube:ro \
  ftrade-generator run
```

Automatically deploys to your cluster.

## 🔐 Security

- ✅ Secrets passed via environment variables (not in image)
- ✅ Kubeconfig mounted read-only
- ✅ Minimal image footprint (Alpine Node.js)
- ✅ No secrets logged to stdout
- ✅ RBAC-scoped permissions in CronJob

## 🐛 Troubleshooting

### "Cannot connect to Kubernetes"

```bash
# Mount kubeconfig
docker run -v ~/.kube:/root/.kube:ro ftrade-generator run

# Or set explicitly
docker run -e KUBECONFIG=/root/.kube/config -v ~/.kube:/root/.kube:ro ftrade-generator run
```

### "Cannot connect to optimizer"

```bash
# Test connectivity from container
docker run -it ftrade-generator shell
curl -H "X-Optimizer-Key: $REMOTE_OPTIMIZER_KEY" http://optimizer-host:4500/candles/manifest
```

### "No combos pass ROA gate"

Combos are filtered by ROA ≥ `MIN_ALLOW_ROA` (default 250%). Lower it:

```bash
docker run -e MIN_ALLOW_ROA=200 ftrade-generator generate-only
```

### "Permission denied" for kubeconfig

```bash
chmod 600 ~/.kube/config
```

## 📊 What Gets Deployed

For each combo that passes the ROA gate:

```
manifests/
├── 01-binance-btcusdt-5m.yaml       # ConfigMap + Secret + Deployment
├── 02-binance-ethusdt-5m.yaml
├── 03-kucoin-xrpusdt-1m.yaml
└── ...
```

Each manifest contains:
- **ConfigMap** — Environment variables (EXCHANGE, SYMBOL, INTERVAL)
- **Secret** — API keys (shared per exchange)
- **Deployment** — Pod spec with init container seeding .env

## 📈 Performance

| Operation | Time |
|-----------|------|
| Docker build | ~30s |
| Fetching combos | ~10s |
| ROA gating | ~30s - 2m (depends on optimizer) |
| Generating manifests | ~5s |
| Kubectl apply | ~10s |
| Pod startup | ~30s - 5m (depends on cluster) |
| **Total** | ~2-10 minutes |

## 📚 Documentation

- **DOCKER-QUICKSTART.md** — Fast 3-step start
- **DOCKER.md** — Complete reference with all options
- **kubernetes-cronjob.yaml** — Scheduled execution in cluster

## 💡 Workflow Examples

### Daily deployment updates

```bash
#!/bin/bash
# Update bot deployments every 6 hours

while true; do
  docker run \
    -e REMOTE_OPTIMIZER_KEY=$REMOTE_OPTIMIZER_KEY \
    -e BINANCE_API_KEY=$BINANCE_API_KEY \
    -e BINANCE_API_SECRET=$BINANCE_API_SECRET \
    -e KUCOIN_API_KEY=$KUCOIN_API_KEY \
    -e KUCOIN_API_SECRET=$KUCOIN_API_SECRET \
    -e KUCOIN_PASSPHRASE=$KUCOIN_PASSPHRASE \
    -v ~/.kube:/root/.kube:ro \
    -v $(pwd)/manifests:/app/manifests \
    ftrade-generator run

  echo "Next update in 6 hours..."
  sleep 6h
done
```

### CI/CD pipeline integration

```yaml
# GitHub Actions example
- name: Deploy crypto bots
  run: |
    docker run \
      -e REMOTE_OPTIMIZER_KEY=${{ secrets.OPTIMIZER_KEY }} \
      -e BINANCE_API_KEY=${{ secrets.BINANCE_KEY }} \
      -e BINANCE_API_SECRET=${{ secrets.BINANCE_SECRET }} \
      -e KUCOIN_API_KEY=${{ secrets.KUCOIN_KEY }} \
      -e KUCOIN_API_SECRET=${{ secrets.KUCOIN_SECRET }} \
      -e KUCOIN_PASSPHRASE=${{ secrets.KUCOIN_PASS }} \
      -v ~/.kube:/root/.kube:ro \
      -v ./manifests:/app/manifests \
      ftrade-generator run
```

### Local development with docker-compose

```bash
# Start full stack locally
docker-compose --profile full-stack up

# In another terminal, check logs
docker-compose logs -f ftrade-generator

# Stop
docker-compose down
```

## 🎯 Next Steps

1. **Build the image:**
   ```bash
   docker build -t ftrade-generator .
   ```

2. **Test with dry-run:**
   ```bash
   docker run -e REMOTE_OPTIMIZER_KEY=secret ftrade-generator dry-run
   ```

3. **Generate manifests:**
   ```bash
   docker run -e REMOTE_OPTIMIZER_KEY=secret -v $(pwd)/manifests:/app/manifests ftrade-generator generate-only
   ```

4. **Deploy to Kubernetes:**
   ```bash
   docker run \
     -e REMOTE_OPTIMIZER_KEY=secret \
     -v ~/.kube:/root/.kube:ro \
     -v $(pwd)/manifests:/app/manifests \
     ftrade-generator run
   ```

5. **Monitor:**
   ```bash
   kubectl get pods -l app=ftrade-minibot -w
   kubectl logs -l app=ftrade-minibot -f
   ```

## 📞 Support

- Check `DOCKER.md` for detailed troubleshooting
- See `CLAUDE.md` for generator configuration details
- Run `docker run ftrade-generator` for command help
