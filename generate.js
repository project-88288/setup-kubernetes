#!/usr/bin/env node
/**
 * Generate Kubernetes ConfigMaps (each holding a distinct .env) that run the
 * prebuilt image `chaiya0899223232/ftrade-minibot`, one per
 * exchange × pair × timeframe combination taken from ./config.
 *
 * For each ConfigMap a matching Deployment is emitted so the combo is runnable
 * out of the box (the pod loads the ConfigMap via envFrom).
 *
 * Usage:
 *   node generate.js                # first 20 combinations (default)
 *   node generate.js --limit 40     # first 40
 *   node generate.js --all          # every combination
 *   node generate.js --out ./out    # write manifests elsewhere
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, "config");
const ENV_FILE = path.join(__dirname, ".env");
const IMAGE = "chaiya0899223232/ftrade-mini-bot:latest";

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { limit: 20, all: false, out: path.join(__dirname, "manifests") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") opts.all = true;
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--out") opts.out = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!opts.all && (!Number.isInteger(opts.limit) || opts.limit <= 0)) {
    throw new Error(`--limit must be a positive integer, got ${opts.limit}`);
  }
  return opts;
}

// ── loaders ──────────────────────────────────────────────────────────────────
function readJson(file) {
  const p = path.join(CONFIG_DIR, file);
  const raw = fs.readFileSync(p, "utf8").trim();
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${file}: ${err.message}`);
  }
}

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
function buildCombinations(exchanges) {
  const combos = [];
  for (const exchange of exchanges) {
    const pairs = readJson(`${exchange}-pairs.json`);
    const timeframes = readJson(`${exchange}-timeframes.json`);
    for (const pair of pairs) {
      for (const timeframe of timeframes) {
        combos.push({ exchange, pair, timeframe });
      }
    }
  }
  return combos;
}

/** The full exchange × pair × timeframe combination set from ./config. */
export function buildAllCombinations() {
  return buildCombinations(readJson("exchanges.json"));
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

/** Non-sensitive ConfigMap values for a combo. */
function configForCombo(baseEnv, combo) {
  const { exchange, pair, timeframe } = combo;
  const config = {
    EXCHANGE: exchange,
    SYMBOL: pair,
    INTERVAL: timeframe,
  };
  for (const [k, v] of Object.entries(baseEnv)) {
    if (!isSecret(k) && keyAppliesTo(k, exchange)) config[k] = v;
  }
  return config;
}

/** Sensitive Secret values shared by every combo of an exchange. */
function secretForExchange(baseEnv, exchange) {
  const secret = {};
  for (const [k, v] of Object.entries(baseEnv)) {
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

function renderManifest(combo, config) {
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
      containers:
        - name: minibot
          image: ${q(IMAGE)}
          imagePullPolicy: IfNotPresent
          envFrom:
            - configMapRef:
                name: ${name}-env
            - secretRef:
                name: ${secretName(combo.exchange)}
`;
}

/**
 * Emit a ConfigMap+Deployment manifest for each combo in `selected` (plus one
 * shared Secret per exchange and a kustomization.yaml), and record the resolved
 * set to config/combinations.json. Returns the written combos. Used both by the
 * CLI here and by select-best-combo.js for the single ROA-winning combo.
 */
export function writeManifests(selected, outDir) {
  const baseEnv = parseEnv(ENV_FILE);

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
    fs.writeFileSync(path.join(outDir, file), renderManifest(combo, config));
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

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv.slice(2));

  const all = buildAllCombinations();
  const selected = opts.all ? all : all.slice(0, opts.limit);

  if (selected.length < opts.limit && !opts.all) {
    console.warn(
      `Warning: only ${all.length} combinations available (requested ${opts.limit}).`
    );
  }

  const written = writeManifests(selected, opts.out);
  const exchanges = readJson("exchanges.json");

  console.log(
    `Generated ${written.length} ConfigMap+Deployment manifests in ${path.relative(process.cwd(), opts.out) || "."}`
  );
  console.log(`  (${all.length} total combinations available across ${exchanges.length} exchanges)`);
  console.log(`Apply all:   kubectl apply -k ${path.relative(process.cwd(), opts.out) || "."}`);
  console.log(`Combos saved to config/combinations.json`);
}

// Only run the CLI when invoked directly (not when imported for its exports).
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
