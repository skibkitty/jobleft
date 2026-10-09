// The failure side channel. A scenario prints `CHECK FAIL <name>: <why>`, and the why is whitespace-collapsed and
// truncated to 400 or 600 characters, so run-all.mjs cannot recover a reliable name by reading stdout. Every failure is
// therefore also appended here, one JSON object per line, and run-all.mjs reads this file instead of guessing.
// The scenario is not recorded here: run-all.mjs attributes each line to the file it spawned, so attribution cannot
// drift. With JOBLEFT_QA_CHECKS unset this is a no-op, so running one scenario from a terminal changes nothing.
import { appendFileSync } from 'node:fs';

/** Records one failed check under its own name. Call this from fail(), the single funnel every scenario already has. */
export function recordFailure(name) {
  const file = process.env.JOBLEFT_QA_CHECKS;
  if (!file) return;
  appendFileSync(file, `${JSON.stringify({ name })}\n`);
}