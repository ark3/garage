# Roadmap

Durable project facts (architecture, runtime rules, settled decisions) live in `CLAUDE.md`.
This file is the task sequence; update or delete milestones as they complete.

## First task — scope strictly to this

Set up the scaffold and stop.
Do not build an app yet.

1. Root `package.json` with bun workspaces covering `bay`, `packages/*`, `apps/*`.
   `.gitignore` including `.wrangler/` and `node_modules/`.
2. `bay/` with `wrangler.toml`, one DO class, and a `/health` route returning something trivial.
   Get the `migrations` tag and `new_sqlite_classes` right — this is the most common source of confusing errors later.
3. `packages/sync/` with `getUser(request)` stubbed and nothing else.
4. A `dev` script such that `bun run dev` starts `wrangler dev`.

Success looks like: `bun run dev` responds on `/health`, and a real SQLite file appears under `.wrangler/state` after the DO is touched once.

Tell me what you're unsure about rather than guessing, especially anything where the Cloudflare API may have moved since your training data.
I would rather check the docs together than debug a plausible-looking config.

## After that, in order

1. ~~`packages/sync` — the Yjs client, the DO-side apply-and-persist path, and compaction.~~
   Done 2026-08-30; verified by `scripts/converge.ts` and `scripts/compaction.ts`.
2. ~~`apps/notes` — plain-text notes (Apple Notes / Simplenote shaped, no checklists).~~
   Done 2026-09-01: human two-tab check passed (convergence, cursors); verified headlessly by `scripts/notes-converge.ts`.
   The app itself is rough and expected to grow; the platform pattern it was probing holds.
3. ~~A backup app: routes that enumerate docs and return `encodeStateAsUpdate` for each, a browser page that saves/restores a file.~~
   Done 2026-08-30; restore is merge-semantics, full wipe-and-restore cycle proven by `scripts/backup-cycle.ts`.

Later apps: shopping list (deferred — lots of fiddly domain details to design), flashcards, private family chat.
