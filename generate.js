#!/usr/bin/env node
/**
 * Generate Kubernetes ConfigMaps (each holding a distinct .env) that run the
 * prebuilt image `88288/ftrade-minibot`, one per combination
 * fetched from the optimizer API.
 *
 * Combinations are fetched from the optimizer's /candles/manifest endpoint,
 * where file paths (e.g., binance/BTCUSDT/5m.json) encode exchange, pair, and
 * timeframe. Only combos that clear a backtest gate are emitted: for every
 * combination we ask the optimizer service (over HTTP, using REMOTE_OPTIMIZER_KEY)
 * for its best saved result and annualize the ROA over the combo's candle window.
 * Combos with no saved result, or an annualized ROA that does not exceed
 * MIN_ALLOW_ROA, are dropped. The survivors are ranked by ROA and a
 * ConfigMap+Deployment is written for the top TOP_ROA_N of them.
 *
 * Optimizer connection + gate come from .env:
 *   REMOTE_OPTIMIZER_PORT   optimizer HTTP port on this host (default 4500)
 *   REMOTE_OPTIMIZER_KEY    shared secret sent as the X-Optimizer-Key header
 *   MIN_ALLOW_ROA           minimum annualized ROA %/yr to keep a combo (default 250)
 *   TOP_ROA_N               how many top-ROA survivors to generate (default 10)
 * Override the base URL with OPTIMIZER_URL (e.g. to hit a remote node).
 *
 * Usage:
 *   node generate.js                # gate every combo, write manifests for the top N
 *   node generate.js --top 5        # override TOP_ROA_N for this run
 *   node generate.js --dry-run      # gate + report only, write nothing
 *   node generate.js --out ./out    # write manifests elsewhere
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, "config");
const ENV_FILE = path.join(__dirname, ".env");
const LAST_BUILT_IMAGE_FILE = path.join(__dirname, ".last-built-image");

// Interval string → minutes, for turning a candle count into a time span.
const INTERVAL_MINUTES = {
  "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
  "1h": 60, "2h": 120, "4h": 240, "6h": 360, "8h": 480, "12h": 720,
  "1d": 1440, "3d": 4320, "1w": 10080,
};

// Keys that configure THIS generator (read from .env) and must not leak into
// the per-combo bot ConfigMaps/Secrets.
const GENERATOR_ONLY_KEYS = new Set(["MIN_ALLOW_ROA", "TOP_ROA_N"]);

// Keys whose value is fixed by the combo (exchange × pair × timeframe). Any
// same-named .env entry is a single-bot default and must NOT override the combo
// — otherwise every ConfigMap inherits .env's SYMBOL/INTERVAL/EXCHANGE.
const COMBO_KEYS = new Set(["EXCHANGE", "SYMBOL", "INTERVAL"]);

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { dryRun: false, top: undefined, out: path.join(__dirname, "manifests") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--top") opts.top = Number(argv[++i]);
    else if (a === "--out") opts.out = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

// ── loaders ──────────────────────────────────────────────────────────────────
/** Parse a KEY=VALUE .env file into an object (ignores comments/blank lines). */
function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// ── combinations ─────────────────────────────────────────────────────────────
/** Fetch all available combinations from the optimizer API.
 * Extracts combinations from /candles/manifest file paths (e.g., binance/BTCUSDT/5m.json).
 */
async function fetchCombinationsFromOptimizer(baseUrl, key) {
  const manifest = await getJson(`${baseUrl}/candles/manifest`, key);
  if (!Array.isArray(manifest?.files)) {
    throw new Error("optimizer /candles/manifest returned no files array");
  }

  const combos = [];
  const seen = new Set();
  for (const file of manifest.files) {
    // Parse "exchange/pair/timeframe.json" → { exchange, pair, timeframe }
    const match = file.match(/^([^/]+)\/([^/]+)\/([^.]+)\.json$/);
    if (!match) continue;
    const [, exchange, pair, timeframe] = match;
    const key = `${exchange}:${pair}:${timeframe}`;
    if (!seen.has(key)) {
      combos.push({ exchange, pair, timeframe });
      seen.add(key);
    }
  }
  return combos;
}

/** Fetch the full combination set from the optimizer API. */
export async function buildAllCombinations(baseUrl, key) {
  return fetchCombinationsFromOptimizer(baseUrl, key);
}

/** Sensitive keys go into a Secret; everything else into a ConfigMap. */
function isSecret(key) {
  return /(_KEY|_SECRET|_PASSPHRASE|_TOKEN|_PASSWORD)$/.test(key);
}

/** Does this env key belong to the given exchange (or apply to all)? */
function keyAppliesTo(key, exchange) {
  const isExchangeScoped = /^(BINANCE|KUCOIN)_/.test(key);
  return !isExchangeScoped || key.startsWith(exchange.toUpperCase() + "_");
}

/** Detect the Docker registry user from local images. */
function detectDockerUser() {
  try {
    // Try to extract username from local docker images matching ftrade-mini-bot
    const images = execSync('docker images --format "table {{.Repository}}"', { encoding: "utf8" });
    const match = images.split("\n").find(line => line.includes("ftrade-mini-bot"));
    if (match) {
      const repo = match.trim();
      if (repo && repo.includes("/")) {
        return repo.split("/")[0];
      }
    }
  } catch (err) {
    // ignore docker images error, fall through to error message
  }

  console.error("❌ Cannot detect Docker username from local images");
  console.error("Please build an image first with: ./rebuild-image.sh");
  console.error("Or set REGISTRY_USER in .env or IMAGE environment variable");
  process.exit(1);
}

/** Detect the last built image from .last-built-image file. */
function detectLastBuiltImage() {
  try {
    if (fs.existsSync(LAST_BUILT_IMAGE_FILE)) {
      return fs.readFileSync(LAST_BUILT_IMAGE_FILE, "utf8").trim();
    }
  } catch (err) {
    // ignore read errors, fall through to None
  }
  return null;
}

/** Non-sensitive ConfigMap values for a combo. */
function configForCombo(baseEnv, combo) {
  const { exchange, pair, timeframe } = combo;
  const config = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (GENERATOR_ONLY_KEYS.has(k) || COMBO_KEYS.has(k)) continue;
    if (!isSecret(k) && keyAppliesTo(k, exchange)) config[k] = v;
  }
  // Combo-controlled values always win over any .env default of the same name.
  config.EXCHANGE = exchange;
  config.SYMBOL = pair;
  config.INTERVAL = timeframe;
  return config;
}

/** Sensitive Secret values shared by every combo of an exchange. */
function secretForExchange(baseEnv, exchange) {
  const secret = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (GENERATOR_ONLY_KEYS.has(k)) continue;
    if (isSecret(k) && keyAppliesTo(k, exchange)) secret[k] = v;
  }
  return secret;
}

// ── YAML rendering (values are controlled, quoted as JSON strings) ────────────
function q(s) {
  return JSON.stringify(String(s));
}

function slug(combo) {
  return `${combo.exchange}-${combo.pair}-${combo.timeframe}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Shared Secret for an exchange (one per exchange, referenced by every combo). */
function secretName(exchange) {
  return `ftrade-minibot-${exchange}-secret`;
}

function renderSecret(exchange, secret) {
  const data = Object.entries(secret)
    .map(([k, v]) => `  ${k}: ${q(v)}`)
    .join("\n");
  return `apiVersion: v1
kind: Secret
metadata:
  name: ${secretName(exchange)}
  labels:
    app: ftrade-minibot
    exchange: ${q(exchange)}
type: Opaque
stringData:
${data}
`;
}

function renderManifest(combo, config, image) {
  const name = `ftrade-minibot-${slug(combo)}`;
  const labels = [
    `    app: ftrade-minibot`,
    `    exchange: ${q(combo.exchange)}`,
    `    pair: ${q(combo.pair)}`,
    `    timeframe: ${q(combo.timeframe)}`,
  ].join("\n");

  const configData = Object.entries(config)
    .map(([k, v]) => `  ${k}: ${q(v)}`)
    .join("\n");

  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${name}-env
  labels:
${labels}
data:
${configData}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  labels:
${labels}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ftrade-minibot
      instance: ${q(name)}
  template:
    metadata:
      labels:
        app: ftrade-minibot
        instance: ${q(name)}
    spec:
      # The image reads config from env vars but also requires a WRITABLE
      # /app/.env file (it persists backtest results there). envFrom alone never
      # creates that file, so an init container seeds a writable copy from the
      # same ConfigMap+Secret into an emptyDir that the bot mounts at /app/.env.
      initContainers:
        - name: seed-dotenv
          image: ${q(image)}
          imagePullPolicy: IfNotPresent
          command: ["sh", "-c", "printenv > /seed/.env && chmod 666 /seed/.env"]
          envFrom:
            - configMapRef:
                name: ${name}-env
            - secretRef:
                name: ${secretName(combo.exchange)}
          volumeMounts:
            - name: dotenv
              mountPath: /seed
      containers:
        - name: minibot
          image: ${q(image)}
          imagePullPolicy: IfNotPresent
          envFrom:
            - configMapRef:
                name: ${name}-env
            - secretRef:
                name: ${secretName(combo.exchange)}
          volumeMounts:
            - name: dotenv
              mountPath: /app/.env
              subPath: .env
      volumes:
        - name: dotenv
          emptyDir: {}
`;
}

/**
 * Emit a ConfigMap+Deployment manifest for each combo in `selected` (plus one
 * shared Secret per exchange and a kustomization.yaml), and record the resolved
 * set to config/combinations.json. Returns the written combos.
 */
export function writeManifests(selected, outDir) {
  const baseEnv = parseEnv(ENV_FILE);

  let image;
  if (baseEnv.IMAGE) {
    image = baseEnv.IMAGE;
  } else {
    const lastBuiltImage = detectLastBuiltImage();
    if (lastBuiltImage) {
      image = lastBuiltImage;
    } else {
      const registryUser = baseEnv.REGISTRY_USER || detectDockerUser();
      image = `${registryUser}/ftrade-mini-bot:latest`;
    }
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const written = [];
  const kustomizeResources = [];

  // One shared Secret per exchange actually used by the selected combos.
  const usedExchanges = [...new Set(selected.map((c) => c.exchange))];
  for (const exchange of usedExchanges) {
    const file = `secret-${exchange}.yaml`;
    fs.writeFileSync(
      path.join(outDir, file),
      renderSecret(exchange, secretForExchange(baseEnv, exchange))
    );
    kustomizeResources.push(`  - ${file}`);
  }

  for (const combo of selected) {
    const config = configForCombo(baseEnv, combo);
    const file = `${String(written.length + 1).padStart(2, "0")}-${slug(combo)}.yaml`;
    fs.writeFileSync(path.join(outDir, file), renderManifest(combo, config, image));
    written.push({ ...combo, file });
    kustomizeResources.push(`  - ${file}`);
  }

  // kustomization.yaml so the whole set applies with one command.
  fs.writeFileSync(
    path.join(outDir, "kustomization.yaml"),
    `apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n${kustomizeResources.join("\n")}\n`
  );

  // Record the resolved combinations back into config/combinations.json.
  fs.writeFileSync(
    path.join(CONFIG_DIR, "combinations.json"),
    JSON.stringify(
      written.map(({ exchange, pair, timeframe, file }) => ({
        exchange,
        pair,
        timeframe,
        file,
      })),
      null,
      2
    ) + "\n"
  );

  return written;
}

// ── optimizer HTTP client + backtest gate ─────────────────────────────────────
// safeKey mirrors the naming the optimizer uses for its result/candle files and
// its /results query params.
function safeKey(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Authenticated GET against the optimizer. Returns parsed JSON, or null on 404. */
async function getJson(url, key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(url, { headers: { "X-Optimizer-Key": key }, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) return null; // no saved result / candle file for this combo
  if (res.status === 401) throw new Error("optimizer rejected REMOTE_OPTIMIZER_KEY (401)");
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch a combo's best backtest from the optimizer and annualize its ROA:
 *   roa = top.totalPnl × 365 / windowDays
 * with windowDays sized from the latest candle snapshot the optimizer holds for
 * this combo (candle count × interval). Returns { ok:true, roa, totalPnl, days,
 * best } or { ok:false, reason } when there's nothing usable to gate on.
 */
async function gateCombo(combo, { baseUrl, key, candleFiles }) {
  const minutes = INTERVAL_MINUTES[combo.timeframe];
  if (!minutes) return { ok: false, reason: `unknown interval ${combo.timeframe}` };

  const q = new URLSearchParams({
    exchange: combo.exchange,
    symbol: combo.pair,
    interval: combo.timeframe,
  });
  const saved = await getJson(`${baseUrl}/results?${q}`, key);
  if (!saved) return { ok: false, reason: "no optimizer result" };

  const best = saved?.result?.top20?.[0];
  if (!best || typeof best.totalPnl !== "number") {
    return { ok: false, reason: "result has no ranked combo" };
  }

  // Latest candle snapshot for this combo (filenames carry a sortable stamp).
  const prefix = `${combo.exchange}/${combo.pair}/${combo.timeframe}`;
  const snaps = candleFiles.filter((f) => f.startsWith(prefix)).sort();

  let candles = null;
  if (snaps.length > 0) {
    // Try to fetch the latest candle file from the manifest
    candles = await getJson(
      `${baseUrl}/candles/file?name=${encodeURIComponent(snaps[snaps.length - 1])}`,
      key
    );
  } else {
    // If candle not found in manifest, try to fetch it directly from the optimizer API
    // by constructing a filename pattern and trying to fetch the latest available
    const candleQuery = new URLSearchParams({
      exchange: combo.exchange,
      symbol: combo.pair,
      interval: combo.timeframe,
    });
    candles = await getJson(`${baseUrl}/candles/latest?${candleQuery}`, key);
  }

  const count = Array.isArray(candles) ? candles.length : 0;
  if (count < 2) return { ok: false, reason: "candle snapshot too short" };

  const days = (count * minutes) / (60 * 24);
  const roa = Math.round((best.totalPnl * 365 / days) * 100) / 100;
  return { ok: true, roa, totalPnl: best.totalPnl, days, best };
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const baseEnv = parseEnv(ENV_FILE);

  const key = baseEnv.REMOTE_OPTIMIZER_KEY;
  if (!key) {
    throw new Error("REMOTE_OPTIMIZER_KEY missing from .env — cannot query the optimizer.");
  }
  const port = baseEnv.REMOTE_OPTIMIZER_PORT || "4500";
  const baseUrl = process.env.OPTIMIZER_URL || `http://127.0.0.1:${port}`;
  const minRoa = Number(baseEnv.MIN_ALLOW_ROA ?? "250");
  if (!Number.isFinite(minRoa)) {
    throw new Error(`MIN_ALLOW_ROA in .env is not a number: ${baseEnv.MIN_ALLOW_ROA}`);
  }
  const topN = opts.top ?? Number(baseEnv.TOP_ROA_N ?? "10");
  if (!Number.isInteger(topN) || topN <= 0) {
    throw new Error(`TOP_ROA_N (or --top) must be a positive integer, got ${topN}`);
  }

  let combos;
  try {
    combos = await buildAllCombinations(baseUrl, key);
  } catch (err) {
    throw new Error(`Cannot fetch combinations from optimizer: ${err.message}`);
  }
  console.log(
    `Gating ${combos.length} combinations at ${baseUrl} — keep annualized ROA > MIN_ALLOW_ROA=${minRoa}%/yr, generate top ${topN}\n`
  );

  // One candle manifest for the whole run (used to size each combo's window).
  let candleFiles;
  try {
    const manifest = await getJson(`${baseUrl}/candles/manifest`, key);
    candleFiles = Array.isArray(manifest?.files) ? manifest.files : [];
  } catch (err) {
    throw new Error(`Cannot reach optimizer at ${baseUrl}: ${err.message}`);
  }

  const kept = [];
  let removed = 0;
  for (const combo of combos) {
    const label = `${combo.exchange} ${combo.pair} ${combo.timeframe}`;
    let r;
    try {
      r = await gateCombo(combo, { baseUrl, key, candleFiles });
    } catch (err) {
      removed++;
      console.log(`  ✗ ${label.padEnd(28)} error   — ${err.message}`);
      continue;
    }
    if (!r.ok) {
      removed++;
      console.log(`  ✗ ${label.padEnd(28)} removed — ${r.reason}`);
      continue;
    }
    if (!(r.roa > minRoa)) {
      removed++;
      console.log(
        `  ✗ ${label.padEnd(28)} removed — ROA ${r.roa}%/yr ≤ ${minRoa}%  (${r.totalPnl}% over ${r.days.toFixed(1)}d)`
      );
      continue;
    }
    kept.push({ ...combo, roa: r.roa, totalPnl: r.totalPnl, days: r.days });
    console.log(
      `  ✓ ${label.padEnd(28)} kept    — ROA ${r.roa}%/yr  (${r.totalPnl}% over ${r.days.toFixed(1)}d)`
    );
  }

  kept.sort((a, b) => b.roa - a.roa);
  console.log(`\nGated ${combos.length} · kept ${kept.length} · removed ${removed}`);

  if (kept.length === 0) {
    console.log(`\nNo combination has an annualized ROA > ${minRoa}%/yr — nothing to generate.`);
    return;
  }

  // Only the top-ROA survivors are generated.
  const selected = kept.slice(0, topN);
  console.log(
    `\nSurvivors ranked by annualized ROA (generating top ${selected.length} of ${kept.length}):`
  );
  kept.forEach((c, i) => {
    const mark = i < selected.length ? "✓" : " ";
    console.log(
      `  ${mark} ${String(i + 1).padStart(2)}. ${`${c.exchange} ${c.pair} ${c.timeframe}`.padEnd(28)} ROA ${c.roa}%/yr` +
        `  (${c.totalPnl}% over ${c.days.toFixed(1)}d)`
    );
  });

  if (opts.dryRun) {
    console.log(`\nDry run — no manifests written.`);
    return;
  }

  const written = writeManifests(selected, opts.out);
  const rel = path.relative(process.cwd(), opts.out) || ".";
  console.log(`\nGenerated ${written.length} ConfigMap+Deployment manifests in ${rel}`);
  console.log(`Apply all:   kubectl apply -k ${rel}`);
  console.log(`Combos saved to config/combinations.json`);
}

// Only run the CLI when invoked directly (not when imported for its exports).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
