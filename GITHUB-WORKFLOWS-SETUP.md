# GitHub Actions Setup Guide

Automated Docker image building and pushing to Docker Hub.

## 🚀 Quick Setup (5 minutes)

### Step 1: Create Docker Hub Token

1. Go to https://hub.docker.com/settings/security
2. Click **New Access Token**
3. Name: `github-actions`
4. Permissions: **Read & Write**
5. Click **Generate**
6. **Copy the token** (you'll need it next)

### Step 2: Add GitHub Secrets

1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

Add two secrets:

**Secret 1:**
- Name: `DOCKER_USERNAME`
- Value: Your Docker Hub username (e.g., `88288`)
- Click **Add secret**

**Secret 2:**
- Name: `DOCKER_PASSWORD`
- Value: Paste the token from Step 1
- Click **Add secret**

### Step 3: Test It

Push a change to trigger the workflow:
```bash
# Make a small change
echo "# Test" >> README.md
git add README.md
git commit -m "Test workflow trigger"
git push origin main
```

Go to **Actions** tab in GitHub and watch the build!

---

## 📋 What You Get

### 1. **Automatic Builds on Push**
When you push to `main` with changes to:
- `Dockerfile`
- `docker-entrypoint.sh`
- `generate.js`
- `package.json`

The image is automatically built and pushed to Docker Hub with tags:
- `latest` — Latest version
- `X.Y.Z` — Semantic version (from package.json)
- `SHA` — Commit hash

### 2. **Pull Request Tests**
When you open a PR affecting Docker files:
- ✅ Image builds successfully
- ✅ Tools are available (Node, kubectl, curl)
- ✅ Commands work (help, dry-run, etc.)
- ✅ Best practices checked

### 3. **Release Builds**
When you create a GitHub Release or push a tag:
- Image built with release version
- Tagged as `stable` and version number
- Fully tested before push

---

## 🔄 Workflows Included

### `build-and-push.yml`
**Main workflow** - Builds and pushes on every push to main.

Triggers:
- Push to `main` with changes to Dockerfile or related files
- Manual trigger (workflow_dispatch)

### `docker-test.yml`
**PR workflow** - Tests image on pull requests.

Triggers:
- Pull request with changes to Dockerfile
- Push to `main` with Dockerfile changes

### `release.yml`
**Release workflow** - Builds and tags release versions.

Triggers:
- GitHub Release created
- Git tag pushed (v*)

---

## 💻 Using the Workflows

### Monitor Build Progress

1. Go to GitHub **Actions** tab
2. Click the workflow run
3. Click **build** or **test** job to see details

### Manual Trigger

To push image without code changes:

1. Go to **Actions** tab
2. Click **Build and Push Docker Image**
3. Click **Run workflow** dropdown
4. Click **Run workflow**

Watch the build in real-time!

### View Built Images

After build completes:
```bash
# Pull latest
docker pull 88288/ftrade-generator:latest

# Pull specific version
docker pull 88288/ftrade-generator:1.0.5
```

---

## 🏷️ Versioning Strategy

### Automatic Version Detection

Version comes from `package.json`:
```json
{
  "version": "1.0.5"
}
```

Tags created:
- `88288/ftrade-generator:1.0.5`
- `88288/ftrade-generator:latest`

### Semantic Versioning

When you bump version in `package.json`, the next push creates tags for both new and old versions.

Example:
```bash
# Edit package.json: 1.0.5 → 1.0.6
git add package.json
git commit -m "Bump version to 1.0.6"
git push origin main
```

Workflow creates:
- `88288/ftrade-generator:1.0.6`
- `88288/ftrade-generator:latest`

### Release Tags

To create a release version:
```bash
git tag v1.0.6
git push origin v1.0.6
```

Workflow creates:
- `88288/ftrade-generator:1.0.6`
- `88288/ftrade-generator:stable`
- `88288/ftrade-generator:latest`

---

## 🐛 Troubleshooting

### Workflow doesn't start

**Check:**
- [ ] Files changed are in the `paths:` list (Dockerfile, generate.js, etc.)
- [ ] Pushing to `main` branch (not feature branch)
- [ ] Secrets are set (`DOCKER_USERNAME`, `DOCKER_PASSWORD`)

**Fix:**
Force rebuild by manually triggering:
1. Go to **Actions**
2. Click **Build and Push Docker Image**
3. Click **Run workflow**

### Docker Hub login fails

**Error:** `denied: requested access to the resource is denied`

**Check:**
- [ ] `DOCKER_USERNAME` is correct (usually lowercase)
- [ ] `DOCKER_PASSWORD` is a Personal Access Token (not your password)
- [ ] Token has "Read & Write" permissions
- [ ] Token is not expired

**Fix:**
1. Create new token on Docker Hub
2. Update `DOCKER_PASSWORD` secret in GitHub

### Image size is too large

**Current:** ~285MB (Alpine Node.js + kubectl)

**To optimize:**
- Remove unused dependencies
- Use multi-stage builds in Dockerfile
- Strip debug symbols

### Test fails

**Check workflow output:**
1. Go to **Actions** → failed workflow
2. Click **test** job
3. Scroll to failed step for details

**Common issues:**
- Dockerfile syntax error
- Missing file (generate.js, .env, etc.)
- Tools don't install (Node, kubectl)

---

## 📊 Monitoring Builds

### View Build History
**Actions** tab → Filter by workflow → Click run

### View Build Logs
Click workflow run → Click job → Scroll down

### Check Docker Hub
https://hub.docker.com/r/88288/ftrade-generator/tags

---

## 🔐 Security Best Practices

✅ **What's secure:**
- Token is stored as a secret (not visible in logs)
- Token has limited scope (Docker Hub only)
- Token has limited permissions (Read & Write)
- Token can be rotated anytime

⚠️ **What to remember:**
- Never commit secrets to git
- Rotate tokens periodically
- Review workflow logs for sensitive data
- Use separate tokens per CI/CD system

---

## 📈 Next Steps

1. ✅ Add Docker secrets to GitHub
2. ✅ Create a test commit to trigger build
3. ✅ Verify image appears on Docker Hub
4. ✅ Update deployment to use new image tag
5. ✅ Monitor first production use

---

## 📚 Reference

- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [Docker Build Push Action](https://github.com/docker/build-push-action)
- [Docker Hub Personal Access Tokens](https://docs.docker.com/docker-hub/access-tokens/)

---

## Example: Complete Workflow

```bash
# 1. Make a change
echo "feature: add thing" >> CHANGELOG.md

# 2. Bump version
# Edit package.json: 1.0.5 → 1.0.6

# 3. Commit
git add CHANGELOG.md package.json
git commit -m "Release v1.0.6: add feature"
git push origin main

# 4. GitHub Actions automatically:
#    ✓ Builds image
#    ✓ Tags: latest, 1.0.6, sha
#    ✓ Pushes to Docker Hub
#    ✓ Runs tests
#    ✓ Creates summary

# 5. Pull new image
docker pull 88288/ftrade-generator:1.0.6

# 6. Deploy
# Update your deployment to use new image tag
```

---

## Workflow Diagram

```
Code Change
    ↓
Push to main
    ↓
Trigger build-and-push.yml
    ├─ Build Docker image
    ├─ Tag: latest, version, SHA
    ├─ Push to Docker Hub
    └─ Run tests
         ├─ Pull image
         ├─ Verify tools
         ├─ Test commands
         └─ Report results
```

All automatic! No manual steps needed after initial setup. 🚀
