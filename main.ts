// Solmar Bay — make.fun gta6-01 entrypoint.
// Copies game/ and screenshots/ beside this file into the output directory
// and writes the dossier that buildDossier computes from them.
// Node 22, standard library only. Deterministic: no timestamps, no random
// values, files copied in sorted order, so two runs write identical bytes.
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

if (outDir === '/' || outDir === repoRoot) {
  throw new Error(`refusing unsafe output directory: ${outDir}`);
}

// Copy one directory tree in sorted entry order. Plain files only: a
// symlink or special file fails the run instead of sneaking into /output.
function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
    else throw new Error(`refusing non-file entry: ${from}`);
  }
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const name of ['game', 'screenshots']) {
  const src = join(repoRoot, name);
  if (!statSync(src, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`missing ${name}/ beside main.ts`);
  }
  copyTree(src, join(outDir, name));
}

const dossierPath = join(outDir, 'dossier.json');
const dossier = buildDossier(outDir, CAPS);
writeFileSync(dossierPath, dossier);

// Small operator summary (stdout only — never written into /output, so the
// run stays byte-identical): how many files the entry carries and how big
// the dossier is. Counts are computed from the copied tree, not the repo,
// so a stale file in the repo cannot inflate the numbers.
function countTree(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = countTree(path);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += statSync(path).size;
    }
  }
  return { files, bytes };
}
const game = countTree(join(outDir, 'game'));
const shots = countTree(join(outDir, 'screenshots'));
console.log(`wrote ${dossierPath} (${dossier.length} bytes): ` +
  `game ${game.files} files / ${game.bytes} bytes, ` +
  `screenshots ${shots.files} files / ${shots.bytes} bytes`);
