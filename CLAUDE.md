# garage

A monorepo of small single-page apps for my family (three people, forever), backed by one Cloudflare Worker fronting a Durable Object.

Everything here is a personal project.
Scale is not a concern.
Simplicity, reproducibility, and keeping the eventual Cloudflare deploy cheap are.

## Architecture

- **Frontend:** static single-page apps.
  All application logic lives in the browser.
  The backend is storage plus identity, nothing more.
- **Backend:** one Worker, one Durable Object class.
  DO SQLite is the durable store.
  Yjs `Y.Doc`s live in DO memory as the working copy; SQLite holds the update log as the truth.
- **Sync:** Yjs for most apps.
  Datasets are small; CRDT merge is worth the cost.
- **Identity:** Cloudflare Access in production, stubbed locally.
- **Deploy target:** eventually `wrangler deploy` to Cloudflare.
  For now, `wrangler dev` locally.
  Never assume a Cloudflare account exists.

## Layout

```
garage/
  bay/              # the Worker + DO class + wrangler.toml
  packages/sync/    # Yjs client wiring, identity helper, fetch helpers
  apps/<name>/      # one directory per SPA
```

bun workspaces.
`apps/*` and `bay/` import `packages/*` by name; no publishing.

## Runtime rules (important)

- `bay/` runs on **workerd**, not Node and not Bun.
  No `Bun.*` APIs, no `bun:sqlite`, no `fs`, no `process`.
  DO storage is `this.ctx.storage.sql`.
- `bay/` gets its own tsconfig using `@cloudflare/workers-types`.
- `packages/sync/` is browser code and must avoid both Bun and Node APIs, since parts of it may be shared with `bay/`.
- bun is the package manager, bundler, and test runner.
  wrangler runs under **Node** — invoke it as `bun run dev` where the script is `wrangler dev`.
  Do not use `bunx --bun wrangler`.

## Decisions already made — do not relitigate

**One DO for everything.**
Not one per app, not one per document.
Docs are loaded lazily into a `Map` of name → `Y.Doc` on first touch, so wake cost is proportional to what's actually used.

**Identity lives behind exactly one function.**
`getUser(request)` returns the authenticated email.
In production it verifies the JWT in `Cf-Access-Jwt-Assertion` against the Access public keys.
Locally it returns a stub.
This is the only place either mechanism may appear.
Do not read `Cf-Access-Authenticated-User-Email` — it is a plain header and not independently trustworthy.

**Actor and subject are separate.**
My daughter has no account.
A parent authenticates, then an app-level affordance says "act as <person>".
So every stored mutation records both who authenticated and who it was on behalf of.
Build this into the storage shape from the first table, not later.

**Compaction fires on wake, not on a schedule.**
DOs hibernate; there is no nightly process.
After replaying a doc's log on wake, if the row count for that doc exceeds a threshold, write `Y.encodeStateAsUpdate(doc)` as a single row and delete the older rows.
Safe without locking because a DO is single-writer.

**The Worker serves the static assets** via the `assets` config in `wrangler.toml` — one origin, one deploy, one Access policy, no CORS.
Check the current binding syntax in Cloudflare's docs; this has changed recently.

**Schema evolution is ad hoc.**
We control every client.
No migration framework.

**Persist before you acknowledge.**
The in-memory `Y.Doc` is rebuilt from SQLite on every wake and is not a cache we can lose.
Apply, insert, then return.

## Verification

- `bun run dev` starts `wrangler dev`; `/health` responds.
- A real SQLite file appears under `.wrangler/state` after the DO is touched once.
- `bun test` for `packages/*`.
