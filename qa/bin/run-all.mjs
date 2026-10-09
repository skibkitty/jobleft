// Runs every replay scenario in order against one running app and prints a summary.
//
// The verdict is fail-closed. Each scenario reports its failed checks through the side channel in ./checks.mjs (one
// JSON object per line, one file per scenario), because a failure's printed text is collapsed and truncated and so its
// name cannot be recovered from stdout. A failure is tolerated only when qa/known-failures.json lists that exact
// scenario and name; everything else fails the run. So does a scenario that could not start, was killed by its
// timeout, exited with an unexpected code, or left a result that does not add up - a broken runner must never read as
// "only the known failures again".
//
// Usage: node qa/bin/run-all.mjs [names...]   (env: JOBLEFT_QA_URL, JOBLEFT_QA_API, JOBLEFT_QA_TOKEN, optional
// JOBLEFT_QA_FIXTURES, JOBLEFT_QA_SHOTS, JOBLEFT_QA_EXTENSION, JOBLEFT_QA_STATE, JOBLEFT_CHROME)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { redact } from './redact.mjs';
const QA = fileURLToPath(new URL('../', import.meta.url));
const ORDER = ['onboarding', 'feed', 'tracker', 'resume', 'network', 'settings', 'extension'];
const names = process.argv.slice(2).length ? process.argv.slice(2) : ORDER;
const env = { ...process.env, JOBLEFT_QA_FIXTURES: process.env.JOBLEFT_QA_FIXTURES ?? join(QA, 'fixtures'), JOBLEFT_QA_SHOTS: process.env.JOBLEFT_QA_SHOTS ?? join(QA, 'shots'), JOBLEFT_QA_STATE: process.env.JOBLEFT_QA_STATE ?? 'golden' };
mkdirSync(env.JOBLEFT_QA_SHOTS, { recursive: true });

const BASELINE = JSON.parse(readFileSync(join(QA, 'known-failures.json'), 'utf8')).entries;
// A fresh directory per invocation: a record left by an earlier run must never reach this verdict.
const CHECKS = mkdtempSync(join(tmpdir(), 'jl-qa-checks-'));

/** A baseline name ending in * matches any check name with that prefix; otherwise it must match exactly. */
function baselineFor(scenario, name) {
  return BASELINE.find((e) => e.scenario === scenario && (e.name.endsWith('*') ? name.startsWith(e.name.slice(0, -1)) : name === e.name));
}

/** The failed check names one scenario reported. A line that will not parse is a fault, never a silent skip. */
function readRecords(file) {
  if (!existsSync(file)) return { names: [], malformed: false };
  const names = [];
  let malformed = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (typeof r?.name !== 'string' || r.name === '') malformed = true;
      else names.push(r.name);
    } catch { malformed = true; }
  }
  return { names, malformed };
}

const results = [];
const completed = new Set();
const broke = new Set();
const unexpected = [];
const tolerated = [];
const missingNames = new Set(names.filter((n) => !existsSync(join(QA, 'scenarios', `${n}.mjs`))));
try {
  for (const name of names) {
    const file = join(QA, 'scenarios', `${name}.mjs`);
    if (missingNames.has(name)) { console.log(`== ${name}: no scenario file`); results.push([name, 'missing']); broke.add(name); continue; }
    const checks = join(CHECKS, `${name}.jsonl`);
    console.log(`\n== ${name}`);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [file], { env: { ...env, JOBLEFT_QA_CHECKS: checks }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 12 * 60_000 });
    const out = redact((r.stdout ?? '') + (r.stderr ?? ''));
    process.stdout.write(out);
    const lines = out.split('\n').filter((l) => l.startsWith('CHECK '));
    const printed = lines.filter((l) => l.startsWith('CHECK FAIL')).length;
    const skips = lines.filter((l) => l.startsWith('CHECK skip')).length;
    const recorded = readRecords(checks);
    const ok = lines.length - printed - skips;

    // Fail closed. A scenario's contract is "exit 1 when a check failed, 0 otherwise", so anything outside that -
    // or any result that does not add up - is a fault in the runner, and a fault is never baselineable.
    let fault = null;
    if (r.error) fault = `could not start (${r.error.code ?? r.error.message})`;
    else if (r.signal) fault = `killed (${r.signal}) before it finished`;
    else if (![0, 1].includes(r.status)) fault = `exited ${r.status}`;
    else if (recorded.malformed) fault = 'a side-channel record could not be read';
    else if (printed !== recorded.names.length) fault = `${printed} CHECK FAIL lines but ${recorded.names.length} side-channel records`;
    else if (r.status === 0 && recorded.names.length) fault = `exited 0 but recorded ${recorded.names.length} failed checks`;
    else if (r.status === 1 && !recorded.names.length) fault = 'exited 1 but recorded no failed check (it probably crashed after the last check)';

    for (const failed of recorded.names) {
      const known = baselineFor(name, failed);
      if (fault || !known) unexpected.push([name, failed, fault, known]);
      else tolerated.push([name, failed, known]);
    }
    if (fault) { broke.add(name); results.push([name, `${fault}; ${ok} ok, ${printed} failed, ${skips} skipped`]); continue; }
    completed.add(name);
    const knownHere = tolerated.filter(([s]) => s === name).length;
    results.push([name, `ok; ${ok} ok, ${printed} failed (${knownHere} known), ${skips} skipped, ${((Date.now() - t0) / 1000).toFixed(0)} s`]);
  }
} finally {
  rmSync(CHECKS, { recursive: true, force: true });
}

if (tolerated.length) {
  console.log(`\n== known failures tolerated (${tolerated.length}) - each is listed in qa/known-failures.json`);
  for (const [s, n, e] of tolerated) console.log(`  ${s.padEnd(12)} ${n}\n      ${e.category}, ${e.ref}\n      ${e.reason}`);
}
if (unexpected.length) {
  console.log(`\n== NOT in qa/known-failures.json (${unexpected.length}) - these fail the run`);
  for (const [s, n, fault] of unexpected) console.log(`  ${s.padEnd(12)} ${n}${fault ? `\n      the scenario itself failed: ${fault}` : ''}`);
}
const stale = BASELINE.filter((e) => completed.has(e.scenario) && !tolerated.some(([s, n]) => s === e.scenario && (e.name.endsWith('*') ? n.startsWith(e.name.slice(0, -1)) : n === e.name)));
if (stale.length) {
  console.log(`\n== stale baseline entries (${stale.length}) - passed this run; remove the entry when you can`);
  for (const e of stale) console.log(`  ${e.scenario.padEnd(12)} ${e.name}`);
}
console.log('\n== summary');
for (const [n, s] of results) console.log(`${n.padEnd(12)} ${s}`);
const verdict = broke.size || unexpected.length ? `FAIL (${broke.size} scenario fault(s), ${unexpected.length} unlisted failure(s))` : 'PASS';
console.log(`\n== ${verdict}`);
process.exit(broke.size || unexpected.length ? 1 : 0);