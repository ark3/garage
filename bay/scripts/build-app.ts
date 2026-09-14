// Build one app bundle into bay/public so the Worker can serve it.
//   bun run --cwd bay build:<app>   (package.json maps each name to this script)
//
// Every bundle gets a GARAGE_BUILD global: the git short sha of the tree it
// was built from, with a `-dirty` suffix when the working tree has
// uncommitted changes. It answers "which code is running". The other version
// number — the per-app schema integer that answers "which shape does this
// code write" — is not a build input; each app declares it as a constant in
// its own code and hands it to the sync helper.
//
// "scratch" is the two-tab check page: its entry is bay/scratch/main.ts and
// it lands directly in public/ next to the hand-written index.html there.
// Every other app lives in apps/<name>/ and lands in public/<name>/ with its
// index.html copied alongside the bundle.

import { copyFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const app = process.argv[2];
if (!app) {
  console.error("usage: bun scripts/build-app.ts <app>");
  process.exit(1);
}

const git = (cmd: string) => execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
const build = git("rev-parse --short HEAD") + (git("status --porcelain") ? "-dirty" : "");

let entry: string;
let outdir: string;
if (app === "scratch") {
  entry = "scratch/main.ts";
  outdir = "public";
} else {
  entry = `../apps/${app}/src/main.ts`;
  outdir = `public/${app}`;
  mkdirSync(outdir, { recursive: true });
  copyFileSync(`../apps/${app}/index.html`, `${outdir}/index.html`);
}

const result = await Bun.build({
  entrypoints: [entry],
  outdir,
  define: { GARAGE_BUILD: JSON.stringify(build) },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`${app}: built ${build} -> ${outdir}`);
