#!/bin/bash
set -e

IMAGE="chaiya0899223232/ftrade-mini-bot:latest"
LABEL="app=ftrade-minibot"

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
