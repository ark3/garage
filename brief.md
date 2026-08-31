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
2. `apps/shopping` — the shopping list.
   This is the real probe.
   It is the most demanding of the planned apps (concurrent edits, offline use), so if the pattern holds here the rest are downhill.
3. A backup app: an admin-only route that enumerates docs, returns `encodeStateAsUpdate` for each, and saves a file from the browser.
   Write the restore path at the same time.

Later apps: flashcards, private family chat.
