#!/bin/bash
set -e

LABEL="app=ftrade-minibot"

# Detect image (in priority order):
# 1. IMAGE env var (explicit override)
# 2. .last-built-image file (from rebuild-image.sh)
# 3. Construct from REGISTRY_USER or Docker user
if [ -n "$IMAGE" ]; then
  # Already set via env var
  :
elif [ -f ".last-built-image" ]; then
  # Use the last built image
  IMAGE=$(cat .last-built-image)
else
  # Construct from Docker user
  DOCKER_USER=$(docker whoami 2>/dev/null) || {
    echo "❌ Docker not logged in or not running"
    echo "Please run: docker login"
    exit 1
  }
  IMAGE_NAME="${IMAGE_NAME:-ftrade-mini-bot}"
  IMAGE_TAG="${IMAGE_TAG:-latest}"
  REGISTRY_USER="${REGISTRY_USER:-$DOCKER_USER}"
  IMAGE="$REGISTRY_USER/$IMAGE_NAME:$IMAGE_TAG"
fi

echo "🔄 Updating $IMAGE"

# Pull the latest image
echo "📥 Pulling latest image..."
docker pull "$IMAGE"

# Get image digest
DIGEST=$(docker inspect --format='{{.RepoDigests}}' "$IMAGE" | grep -o 'sha256:[a-f0-9]\{64\}' | head -1)
echo "✓ Image digest: $DIGEST"

if ! kubectl get deployment -l "$LABEL" &>/dev/null; then
  echo "❌ No deployments found with label: $LABEL"
  exit 1
fi

DEPLOYMENT_COUNT=$(kubectl get deployment -l "$LABEL" --no-headers | wc -l)
echo "📋 Found $DEPLOYMENT_COUNT deployments"

# Restart all deployments to pull the new image
echo "🔁 Restarting deployments..."
kubectl rollout restart deployment -l "$LABEL"

# Wait for rollout to complete
echo "⏳ Waiting for rollout to complete..."
kubectl rollout status deployment -l "$LABEL" --timeout=5m

echo "✅ All pods updated to $IMAGE"
echo ""
echo "Monitor pod status:"
echo "  kubectl get pods -l $LABEL -w"
