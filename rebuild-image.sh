#!/bin/bash
set -e

# Configuration
REGISTRY_USER="${REGISTRY_USER:-chaiya0899223232}"
IMAGE_NAME="${IMAGE_NAME:-ftrade-mini-bot}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
SOURCE_DIR="${SOURCE_DIR:-../ftrade-mini-bot}"
DOCKERFILE="${DOCKERFILE:-Dockerfile}"

FULL_IMAGE="$REGISTRY_USER/$IMAGE_NAME:$IMAGE_TAG"

# Validate source directory
if [ ! -d "$SOURCE_DIR" ]; then
  echo "❌ Source directory not found: $SOURCE_DIR"
  echo ""
  echo "Set SOURCE_DIR to the ftrade-mini-bot repo path:"
  echo "  SOURCE_DIR=../path/to/ftrade-mini-bot ./rebuild-image.sh"
  exit 1
fi

if [ ! -f "$SOURCE_DIR/$DOCKERFILE" ]; then
  echo "❌ Dockerfile not found: $SOURCE_DIR/$DOCKERFILE"
  exit 1
fi

echo "🔨 Building $FULL_IMAGE"
echo "   Source: $SOURCE_DIR"
echo "   Dockerfile: $SOURCE_DIR/$DOCKERFILE"
echo ""

# Build the image
cd "$SOURCE_DIR"
docker build -t "$FULL_IMAGE" -f "$DOCKERFILE" .
cd - > /dev/null

echo "✓ Image built: $FULL_IMAGE"
echo ""

# Optional: push to registry
read -p "Push to Docker Hub? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "🚀 Pushing $FULL_IMAGE..."
  docker push "$FULL_IMAGE"
  echo "✅ Pushed successfully"
  echo ""
  echo "Next: update running pods with ./update-image.sh"
else
  echo "⏭️  Skipped push. To push manually:"
  echo "   docker push $FULL_IMAGE"
fi
