#!/bin/bash
set -e

ACTION="${1:-run}"

case "$ACTION" in
  run)
    echo "🚀 Starting crypto bot Kubernetes deployment pipeline..."
    echo ""

    # Verify optimizer connection
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Step 0/4: Verifying optimizer API connection"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    OPTIMIZER_URL="${OPTIMIZER_URL:-http://127.0.0.1:4500}"
    echo "Optimizer URL: $OPTIMIZER_URL"

    if ! curl -s -f -H "X-Optimizer-Key: ${REMOTE_OPTIMIZER_KEY}" "$OPTIMIZER_URL/candles/manifest" > /dev/null 2>&1; then
      echo "⚠️  Warning: Could not connect to optimizer at $OPTIMIZER_URL"
      echo "    Make sure OPTIMIZER_URL and REMOTE_OPTIMIZER_KEY are set correctly"
      echo "    Proceeding anyway..."
    else
      echo "✅ Optimizer API is reachable"
    fi
    echo ""

    # Step 1: Generate manifests
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Step 1/4: Generating Kubernetes manifests"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    node generate.js "${@:2}"
    echo ""

    # Step 2: Check if kubectl is available and cluster is accessible
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Step 2/4: Checking Kubernetes cluster connection"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if ! kubectl cluster-info &> /dev/null; then
      echo "⚠️  Warning: Cannot connect to Kubernetes cluster"
      echo "    Make sure your kubeconfig is properly configured"
      echo "    Manifests have been generated but not deployed"
      echo ""
      echo "To deploy manually when cluster is available, run:"
      echo "  kubectl apply -k manifests"
      exit 0
    fi

    CLUSTER_INFO=$(kubectl cluster-info | head -1)
    echo "✅ Connected to Kubernetes cluster: $CLUSTER_INFO"
    echo ""

    # Step 3: Apply manifests
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Step 3/4: Applying manifests to Kubernetes"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    kubectl apply -k manifests
    echo ""

    # Step 4: Restart deployments
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Step 4/4: Restarting deployments to pull latest image"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if kubectl get deployment -l app=ftrade-minibot &> /dev/null; then
      kubectl rollout restart deployment -l app=ftrade-minibot
      kubectl rollout status deployment -l app=ftrade-minibot --timeout=5m
    else
      echo "ℹ️  No existing deployments to restart (first run)"
    fi
    echo ""

    echo "✅ Deployment complete!"
    echo ""
    echo "Monitor pod status:"
    echo "  kubectl get pods -l app=ftrade-minibot -w"
    echo ""
    echo "View logs:"
    echo "  kubectl logs -l app=ftrade-minibot -f"
    ;;

  generate-only)
    echo "🔧 Generating manifests only (no deployment)"
    node generate.js "${@:2}"
    ;;

  dry-run)
    echo "🔍 Dry-run: gating combos without writing manifests"
    node generate.js --dry-run "${@:2}"
    ;;

  deploy-only)
    echo "📦 Deploying existing manifests to Kubernetes"
    kubectl apply -k manifests
    echo "✅ Deployment complete!"
    ;;

  shell)
    echo "💬 Opening interactive shell..."
    /bin/bash
    ;;

  *)
    echo "Usage: docker run <image> [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  run            Full pipeline: generate + deploy (default)"
    echo "  generate-only  Generate manifests only"
    echo "  dry-run        Gate combos without writing"
    echo "  deploy-only    Deploy existing manifests"
    echo "  shell          Open interactive shell"
    echo ""
    echo "Environment variables:"
    echo "  OPTIMIZER_URL           Optimizer API URL (default: http://127.0.0.1:4500)"
    echo "  REMOTE_OPTIMIZER_KEY    Shared secret for optimizer (required)"
    echo "  MIN_ALLOW_ROA           Minimum ROA % threshold (default: 250)"
    echo "  TOP_ROA_N               Number of top combos to deploy (default: 10)"
    echo "  KUBECONFIG              Path to kubeconfig file"
    echo ""
    echo "Examples:"
    echo "  docker run -e REMOTE_OPTIMIZER_KEY=your-secret <image> run"
    echo "  docker run -e REMOTE_OPTIMIZER_KEY=your-secret <image> generate-only"
    echo "  docker run -e REMOTE_OPTIMIZER_KEY=your-secret -v ~/.kube:/root/.kube <image> run"
    exit 1
    ;;
esac
