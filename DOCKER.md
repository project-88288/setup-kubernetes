# Docker-Based Deployment

Run the entire manifest generation and Kubernetes deployment pipeline in Docker containers.

## Quick Start

### Option 1: Generate Only (No Kubernetes Deployment)

```bash
docker build -t ftrade-generator .

docker run \
  -e REMOTE_OPTIMIZER_KEY=your-optimizer-secret \
  -e OPTIMIZER_URL=http://optimizer-host:4500 \
  -v $(pwd)/manifests:/app/manifests \
  ftrade-generator generate-only
```

### Option 2: Full Pipeline (Generate + Deploy to Kubernetes)

```bash
docker run \
  -e REMOTE_OPTIMIZER_KEY=your-optimizer-secret \
  -e OPTIMIZER_URL=http://optimizer-host:4500 \
  -v $(pwd)/manifests:/app/manifests \
  -v ~/.kube:/root/.kube:ro \
  ftrade-generator run
```

### Option 3: Using docker-compose (With Local Optimizer)

```bash
# Set your secrets in .env
export REMOTE_OPTIMIZER_KEY=your-optimizer-secret
export BINANCE_API_KEY=your-binance-key
export BINANCE_API_SECRET=your-binance-secret
export KUCOIN_API_KEY=your-kucoin-key
export KUCOIN_API_SECRET=your-kucoin-secret
export KUCOIN_PASSPHRASE=your-kucoin-passphrase

# Full stack with optimizer running in a container
docker-compose --profile full-stack up

# Or just the generator (requires external optimizer)
docker-compose up ftrade-generator
```

## Docker Commands

### Build the image

```bash
docker build -t ftrade-generator .
```

### Available commands

| Command | Purpose |
|---------|---------|
| `run` | Full pipeline: fetch combos → generate manifests → deploy to Kubernetes (default) |
| `generate-only` | Generate manifests without deploying |
| `dry-run` | Gate combos and report without writing manifests |
| `deploy-only` | Deploy existing manifests to Kubernetes |
| `shell` | Open interactive shell for debugging |

### Run specific command

```bash
docker run ftrade-generator generate-only --top 5
docker run ftrade-generator dry-run
docker run ftrade-generator deploy-only
docker run ftrade-generator shell
```

## Environment Variables

Required:
- `REMOTE_OPTIMIZER_KEY` — Shared secret for optimizer API authentication

Optional:
- `OPTIMIZER_URL` — Optimizer API URL (default: `http://127.0.0.1:4500`)
- `MIN_ALLOW_ROA` — Minimum annualized ROA % (default: `250`)
- `TOP_ROA_N` — Number of top combos to deploy (default: `10`)
- `BINANCE_API_KEY`, `BINANCE_API_SECRET` — Binance credentials
- `KUCOIN_API_KEY`, `KUCOIN_API_SECRET`, `KUCOIN_PASSPHRASE` — KuCoin credentials

## Volume Mounts

### For Manifest Output

Mount where you want generated manifests written:

```bash
-v $(pwd)/manifests:/app/manifests
```

### For Kubernetes Access

Mount your kubeconfig for cluster deployment:

```bash
-v ~/.kube:/root/.kube:ro
```

You can also set `KUBECONFIG` environment variable:

```bash
-e KUBECONFIG=/root/.kube/config
```

### For Configuration

To override `.env` from outside the image:

```bash
-v $(pwd)/.env:/app/.env:ro
```

## Examples

### 1. Generate manifests, connect to remote optimizer

```bash
docker run \
  -e REMOTE_OPTIMIZER_KEY=abc123 \
  -e OPTIMIZER_URL=https://optimizer.example.com \
  -v $(pwd)/manifests:/app/manifests \
  ftrade-generator generate-only
```

### 2. Full pipeline with local kubeconfig

```bash
docker run \
  -e REMOTE_OPTIMIZER_KEY=abc123 \
  -e MIN_ALLOW_ROA=300 \
  -e TOP_ROA_N=20 \
  -v $(pwd)/manifests:/app/manifests \
  -v ~/.kube:/root/.kube:ro \
  ftrade-generator run
```

### 3. Dry-run to see what would be deployed

```bash
docker run \
  -e REMOTE_OPTIMIZER_KEY=abc123 \
  ftrade-generator dry-run
```

### 4. Deploy pre-generated manifests

```bash
docker run \
  -v $(pwd)/manifests:/app/manifests \
  -v ~/.kube:/root/.kube:ro \
  ftrade-generator deploy-only
```

### 5. Interactive shell for debugging

```bash
docker run -it \
  -e REMOTE_OPTIMIZER_KEY=abc123 \
  -v ~/.kube:/root/.kube:ro \
  ftrade-generator shell
```

## Docker Compose Full Stack

When using `docker-compose --profile full-stack`, you get:

1. **optimizer** service — Runs the optimizer API on port 4500
2. **ftrade-generator** service — Connected to optimizer, generates and deploys manifests

### Setup

Create `.env` file:

```bash
REMOTE_OPTIMIZER_KEY=your-secret-here
MIN_ALLOW_ROA=250
TOP_ROA_N=10
BINANCE_API_KEY=your-key
BINANCE_API_SECRET=your-secret
KUCOIN_API_KEY=your-key
KUCOIN_API_SECRET=your-secret
KUCOIN_PASSPHRASE=your-pass
```

### Run

```bash
# Start full stack (optimizer + generator)
docker-compose --profile full-stack up

# Logs
docker-compose logs -f ftrade-generator

# Stop
docker-compose down
```

## Kubernetes Integration

### Mount kubeconfig from host

The Docker container needs access to your Kubernetes cluster. Mount your kubeconfig:

```bash
docker run \
  -v ~/.kube:/root/.kube:ro \
  ftrade-generator run
```

### Use with Docker Compose and Kubernetes

If your Docker daemon has access to Kubernetes (e.g., Docker Desktop with K8s enabled):

```bash
docker-compose --profile full-stack up
```

The generator will automatically detect and deploy to your cluster.

### Use with remote Kubernetes

If Kubernetes is remote, ensure your kubeconfig points to the right cluster:

```bash
docker run \
  -v ~/.kube:/root/.kube:ro \
  -e KUBECONFIG=/root/.kube/config \
  ftrade-generator run
```

## Troubleshooting

### Cannot connect to optimizer

```
⚠️ Warning: Could not connect to optimizer at http://127.0.0.1:4500
```

**Solution:** Make sure optimizer is running and reachable:

```bash
# Check optimizer is running
docker ps | grep optimizer

# Check network connectivity (from inside container)
docker run -it ftrade-generator shell
curl -H "X-Optimizer-Key: $REMOTE_OPTIMIZER_KEY" http://optimizer-host:4500/candles/manifest
```

### Cannot connect to Kubernetes

```
⚠️ Warning: Cannot connect to Kubernetes cluster
```

**Solution:** Ensure kubeconfig is properly mounted:

```bash
# Verify kubeconfig exists
ls -la ~/.kube/config

# Run with kubeconfig mount
docker run \
  -v ~/.kube:/root/.kube:ro \
  ftrade-generator run
```

### Permission denied when accessing kubeconfig

**Solution:** Make sure kubeconfig file is readable:

```bash
chmod 600 ~/.kube/config
```

### Image pull failures in Kubernetes

Make sure the image specified in `.env` (`IMAGE` variable) is available in your Docker registry and the ServiceAccount has pull permissions.

## Performance

- **Build time:** ~30 seconds (downloads Node.js + kubectl)
- **Generation time:** Depends on number of combos and optimizer response time (typically 30 seconds - 2 minutes)
- **Deployment time:** Depends on cluster size (typically 1-5 minutes)

## Security

- Secrets (API keys, passphrases) are passed via environment variables, not stored in the image
- Kubeconfig is mounted read-only
- The container runs with minimal privileges
- No secrets are logged to stdout

## Advanced Usage

### Custom optimizer URL with credentials

```bash
docker run \
  -e REMOTE_OPTIMIZER_KEY=abc123 \
  -e OPTIMIZER_URL=https://user:pass@optimizer.example.com \
  ftrade-generator generate-only
```

### Override .env file

```bash
docker run \
  -v $(pwd)/custom.env:/app/.env:ro \
  ftrade-generator generate-only
```

### Limit to specific timeframe

Modify generate.js before building, or mount a custom config:

```bash
docker run \
  -v $(pwd)/config/custom-combos.json:/app/config/combinations.json:ro \
  ftrade-generator deploy-only
```

### Pipeline as a Kubernetes CronJob

See `kubernetes-cronjob.yaml` for running this pipeline on a schedule inside your cluster.
