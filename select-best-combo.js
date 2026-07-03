#!/usr/bin/env node
/**
 * Backtest-gated combo selector.
 *
 * Flow (per request):
 *   1. Build the FULL exchange × pair × timeframe combination set — the same
 *      source generate.js uses (./config).
 *   2. Shuffle it into a random order.
 *   3. Walk every combo. For each, read the best backtest result from the
 *      optimizer's saved result (result.top20[0]) and compute its ROA =
 *      annualized return: the top param set's totalPnl% scaled to a 365-day
 *      year over the backtest window. A combo is REMOVED from the running set
 *      when either:
 *        - no saved backtest result / candle window was received for it, or
 *        - its annualized ROA is below MIN_ROA_ALLOW.
 *      Keep going until all combinations have been tested.
 *   4. Select the single highest-ROA survivor and generate a manifest for just
 *      that one combo (ConfigMap + Deployment + its exchange Secret), ready to
 *      apply with kubectl.
 *
 * Env:
 *   MIN_ROA_ALLOW          minimum best-combo totalPnl% to keep a combo (default 250)
 *   OPTIMIZER_RESULTS_DIR  folder of <exchange>_<symbol>_<interval>.json saved
 *                          results (default ../ftrade-msi-optimizer-bot-p2p/optimizer-results)
 *
 * Usage:
 *   node select-best-combo.js                 # test all, generate the winner's manifest
 *   node select-best-combo.js --dry-run       # test + rank only, write nothing
 *   node select-best-combo.js --out ./out     # write the winner's manifest elsewhere
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAllCombinations, writeManifests } from "./generate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OPT_DIR = path.join(__dirname, "..", "ftrade-msi-optimizer-bot-p2p");
const MIN_ROA_ALLOW = Number(process.env.MIN_ROA_ALLOW ?? "250");
const RESULTS_DIR = path.resolve(
  process.env.OPTIMIZER_RESULTS_DIR || path.join(OPT_DIR, "optimizer-results")
);
// Candle snapshots the optimizer saved per job — used to size the backtest
// window (candle count × interval) so ROA can be annualized.
const CANDLES_DIR = path.resolve(
  process.env.OPTIMIZER_CANDLES_DIR || path.join(OPT_DIR, "candles")
);

// Interval string → minutes, for turning a candle count into a time span.
const INTERVAL_MINUTES = {
  "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
  "1h": 60, "2h": 120, "4h": 240, "6h": 360, "8h": 480, "12h": 720,
  "1d": 1440, "3d": 4320, "1w": 10080,
};

// ── args ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { dryRun: false, out: path.join(__dirname, "manifests") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--out") opts.out = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

// ── ROA lookup ─────────────────────────────────────────────────────────────────
// Mirrors safeKey + the result filename the optimizer's server.js writes.
function safeKey(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function resultFile(combo) {
  const name = `${safeKey(combo.exchange)}_${safeKey(combo.pair)}_${safeKey(combo.timeframe)}.json`;
  return path.join(RESULTS_DIR, name);
}

/**
 * Backtest window length in days, computed from candle length: the combo's
 * saved candle snapshot count × the interval duration. Returns null when no
 * snapshot or a known interval size is available.
 */
function windowDaysFor(combo) {
  const minutes = INTERVAL_MINUTES[combo.timeframe];
  if (!minutes) return null;

  const prefix = `${safeKey(combo.exchange)}_${safeKey(combo.pair)}_${safeKey(combo.timeframe)}_`;
  let files;
  try {
    files = fs.readdirSync(CANDLES_DIR);
  } catch {
    return null;
  }
  // Latest snapshot for this combo (filenames carry a sortable timestamp).
  const snaps = files.filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort();
  if (!snaps.length) return null;

  let candles;
  try {
    candles = JSON.parse(fs.readFileSync(path.join(CANDLES_DIR, snaps[snaps.length - 1]), "utf8"));
  } catch {
    return null;
  }
  const count = Array.isArray(candles) ? candles.length : 0;
  if (count < 2) return null;

  return (count * minutes) / (60 * 24);
}

/**
 * Read a combo's best-combo ROA = annualized return, from its saved optimizer
 * result. The top param set's totalPnl% is scaled to a 365-day year over the
 * backtest window (window sized from candle length):
 *   roa = totalPnl × 365 / windowDays
 * Returns { ok:true, roa, totalPnl, days, best } or { ok:false, reason } when
 * no usable backtest result / window was received.
 */
function readBacktest(combo) {
  const file = resultFile(combo);
  if (!fs.existsSync(file)) return { ok: false, reason: "no saved backtest result" };

  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { ok: false, reason: "corrupt result file" };
  }

  const best = saved?.result?.top20?.[0];
  if (!best || typeof best.totalPnl !== "number") {
    return { ok: false, reason: "result has no ranked combo" };
  }

  const days = windowDaysFor(combo);
  if (!days) return { ok: false, reason: "no candle window to annualize" };

  const roa = Math.round((best.totalPnl * 365 / days) * 100) / 100;
  return { ok: true, roa, totalPnl: best.totalPnl, days, best };
}

// Fisher–Yates in place.
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function comboLabel(c) {
  return `${c.exchange} ${c.pair} ${c.timeframe}`;
}

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv.slice(2));

  const combos = shuffle(buildAllCombinations());
  console.log(
    `Testing ${combos.length} combinations against MIN_ROA_ALLOW=${MIN_ROA_ALLOW}%/yr (annualized)`
  );
  console.log(`Results dir: ${path.relative(process.cwd(), RESULTS_DIR) || "."}\n`);

  const kept = [];
  let removed = 0;

  for (const combo of combos) {
    const r = readBacktest(combo);
    if (!r.ok) {
      removed++;
      console.log(`  ✗ ${comboLabel(combo).padEnd(28)} removed — ${r.reason}`);
      continue;
    }
    if (r.roa < MIN_ROA_ALLOW) {
      removed++;
      console.log(
        `  ✗ ${comboLabel(combo).padEnd(28)} removed — ROA ${r.roa}%/yr < ${MIN_ROA_ALLOW}%` +
          `  (${r.totalPnl}% over ${r.days.toFixed(1)}d)`
      );
      continue;
    }
    kept.push({ ...combo, roa: r.roa, totalPnl: r.totalPnl, days: r.days, best: r.best });
    console.log(
      `  ✓ ${comboLabel(combo).padEnd(28)} kept   — ROA ${r.roa}%/yr` +
        `  (${r.totalPnl}% over ${r.days.toFixed(1)}d)`
    );
  }

  // Highest ROA wins.
  kept.sort((a, b) => b.roa - a.roa);

  console.log(
    `\nTested ${combos.length} · kept ${kept.length} · removed ${removed}`
  );

  if (kept.length === 0) {
    console.log(
      `\nNo combination has an annualized ROA ≥ ${MIN_ROA_ALLOW}%/yr — nothing to run.`
    );
    return;
  }

  console.log(`\nSurvivors ranked by annualized ROA:`);
  kept.forEach((c, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${comboLabel(c).padEnd(28)} ROA ${c.roa}%/yr` +
        `  (${c.totalPnl}% over ${c.days.toFixed(1)}d)`
    );
  });

  const winner = kept[0];
  const b = winner.best;
  console.log(`\n=== Winner (highest annualized ROA) ===`);
  console.log(
    `  ${comboLabel(winner)}  ROA=${winner.roa}%/yr  (${winner.totalPnl}% over ${winner.days.toFixed(1)}d)` +
      `  winRate=${Math.round(b.winRate * 1000) / 10}%  trades=${b.trades}  maxDD=${b.maxDD}%`
  );
  console.log(
    `  params: fast=${b.fast} slow=${b.slow} rsiP=${b.rsiP} rsiTh=${b.rsiTh} sl=${b.sl}% tp=${b.tp}% trail=${b.trailing}%`
  );

  if (opts.dryRun) {
    console.log(`\nDry run — no manifest written.`);
    return;
  }

  const [written] = writeManifests(
    [{ exchange: winner.exchange, pair: winner.pair, timeframe: winner.timeframe }],
    opts.out
  );
  console.log(
    `\nGenerated manifest for the winning combo: ${path.join(path.relative(process.cwd(), opts.out) || ".", written.file)}`
  );
  console.log(`Run it:   kubectl apply -k ${path.relative(process.cwd(), opts.out) || "."}`);
  console.log(`Winner saved to config/combinations.json`);
}

main();
