# GitHub Actions Workflows

Automated CI/CD workflows for building and pushing the ftrade-generator Docker image.

## Workflows

### 1. Build and Push (`build-and-push.yml`)

**Automatically builds and pushes the Docker image to Docker Hub.**

Triggers:
- On push to `main` branch (when Dockerfile or related files change)
- Manual trigger via `workflow_dispatch`

What it does:
1. ✅ Builds Docker image using `docker/build-push-action`
2. ✅ Tags with: `latest`, version from `package.json`, git SHA
3. ✅ Pushes to Docker Hub
4. ✅ Tests the pushed image

Tags created:
- `88288/ftrade-generator:latest` — Latest version
- `88288/ftrade-generator:X.Y.Z` — Semantic version (from package.json)
- `88288/ftrade-generator:abc123...` — Git commit SHA

### 2. Docker Tests (`docker-test.yml`)

**Tests Docker image on pull requests and pushes.**

Triggers:
- On pull requests affecting Dockerfile
- On push to `main` (when Dockerfile changes)

What it tests:
- ✅ Image builds successfully
- ✅ All commands work (help, dry-run, etc.)
- ✅ Required tools are present (Node.js, kubectl, curl)
- ✅ Image size is reasonable
- ✅ Dockerfile best practices

## Setup

### 1. Create Docker Hub Credentials

Create a Personal Access Token on Docker Hub:
1. Go to https://hub.docker.com/settings/security
2. Click "New Access Token"
3. Give it a name: `github-actions`
4. Grant "Read & Write" permissions
5. Copy the token

### 2. Add GitHub Secrets

Add the following secrets to your GitHub repository:

**Settings → Secrets and variables → Actions**

```
DOCKER_USERNAME = your-docker-hub-username (e.g., 88288)
DOCKER_PASSWORD = your-personal-access-token
```

### 3. Verify Setup

Push a change to any workflow-tracked file:
```bash
git push origin main
```

The workflow should automatically trigger. Check **Actions** tab in GitHub.

## Manual Trigger

To manually push an image without changing code:

1. Go to **Actions** tab
2. Click **Build and Push Docker Image**
3. Click **Run workflow**
4. Select branch (main)
5. Click **Run workflow**

## Image Tags

Each build creates three tags:

| Tag | Used For | Example |
|-----|----------|---------|
| `latest` | Latest release | `88288/ftrade-generator:latest` |
| `X.Y.Z` | Specific version | `88288/ftrade-generator:1.0.5` |
| `SHA` | Commit tracking | `88288/ftrade-generator:1d78352...` |

## Pulling Images

After push completes, pull from Docker Hub:

```bash
# Latest version
docker pull 88288/ftrade-generator:latest

# Specific version
docker pull 88288/ftrade-generator:1.0.5

# Specific commit
docker pull 88288/ftrade-generator:1d78352abc...
```

## Troubleshooting

### Workflow doesn't trigger

Check:
- [ ] Changes include tracked files (Dockerfile, generate.js, etc.)
- [ ] Pushing to `main` branch (not feature branch)
- [ ] Workflow file syntax is valid

### Docker Hub login fails

Check:
- [ ] `DOCKER_USERNAME` secret is set correctly
- [ ] `DOCKER_PASSWORD` is a valid Personal Access Token (not password)
- [ ] Token has "Read & Write" permissions
- [ ] Token is not expired

### Image test fails

Check:
- [ ] Dockerfile syntax is valid
- [ ] All referenced files exist (generate.js, .env, etc.)
- [ ] Required tools install successfully (Node.js, kubectl, curl)

## Workflow Files

```
.github/workflows/
├── build-and-push.yml   (Main build + push + test)
├── docker-test.yml      (PR tests)
└── README.md           (This file)
```

## Optimization Tips

### 1. Cache layers

Workflows use GitHub Actions cache to speed up builds:
```yaml
cache-from: type=gha
cache-to: type=gha,mode=max
```

### 2. Path filtering

Only rebuild when relevant files change:
```yaml
paths:
  - 'Dockerfile'
  - 'docker-entrypoint.sh'
  - 'generate.js'
```

### 3. Matrix builds (optional)

To build for multiple architectures (amd64, arm64):
```yaml
strategy:
  matrix:
    platform: [linux/amd64, linux/arm64]
```

## Sample: Full Workflow Output

```
✅ Build and Push Docker Image

✅ build job
  ✓ Checkout code
  ✓ Set up Docker Buildx
  ✓ Log in to Docker Hub
  ✓ Extract version (1.0.5)
  ✓ Build and push Docker image
    - 88288/ftrade-generator:latest
    - 88288/ftrade-generator:1.0.5
    - 88288/ftrade-generator:1d78352

✅ test-image job
  ✓ Pull and test image
  ✓ Verify tools
    - Node.js v20.20.2
    - kubectl v1.36.2
    - curl v8.20.0
```

## Next Steps

1. **Add secrets** to GitHub repository
2. **Push a test change** to trigger the workflow
3. **Monitor** the build in Actions tab
4. **Pull the image** and verify it works locally

## Reference

- [Docker Build Push Action](https://github.com/docker/build-push-action)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Hub Personal Access Tokens](https://docs.docker.com/docker-hub/access-tokens/)
