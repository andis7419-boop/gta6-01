// Solmar Bay — entry packager for the gta6-01 bounty.
//
// This program is the only thing the grader runs. It takes the finished
// game (the static files under game/ plus the captured screenshots under
// screenshots/), lays them out in the output directory, and asks the
// vendored make.fun library to build the dossier the judge reads.
//
// It is deliberately boring: standard library only, no clock, no random
// numbers, no network. Running it twice over the same repo therefore
// produces byte-identical output, which the grader checks.
//
// Usage:  MAKEFUN_OUTPUT_DIR=out node main.ts
// (without the variable the output goes to /output, the grader's folder.)

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The folder this file lives in is the repo root; game/ and screenshots/
// sit beside it. The output folder comes from the environment so the
// grader can point it at /output while a local run can use a scratch dir.
const repoRoot = dirname(fileURLToPath(import.meta.url));
const outputRoot = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's caps for this bounty. text_max_bytes is the one that
// shapes the dossier text; the rest make this program refuse an entry
// the scorer would refuse (too many or too large screenshots, a game/
// folder over 993 files or 48 MiB, or a game path over 1000 bytes).
const DOSSIER_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// Copy one top-level folder (game/ or screenshots/) into the output
// directory, creating the destination first. A missing source folder is
// skipped instead of crashing, so a repo without screenshots yet still
// produces a dossier; the screenshots folder itself is always created
// so the layout below is stable.
function mirrorFolder(name) {
  const from = join(repoRoot, name);
  const to = join(outputRoot, name);
  mkdirSync(to, { recursive: true });
  if (existsSync(from)) {
    cpSync(from, to, { recursive: true });
  }
}

mkdirSync(outputRoot, { recursive: true });
for (const folder of ['game', 'screenshots']) {
  mirrorFolder(folder);
}

writeFileSync(
  join(outputRoot, 'dossier.json'),
  buildDossier(outputRoot, DOSSIER_LIMITS),
);
