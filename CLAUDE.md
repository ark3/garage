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
- The `dev` script sets `XDG_CONFIG_HOME` and `WRANGLER_LOG_PATH` to keep all wrangler state under `bay/.wrangler/`, because `$HOME` may be read-only when an agent runs it.
  An eventual `deploy` script should omit that override so `wrangler login` credentials land in the real `~/.config`.

## Decisions already made — do not relitigate

**One DO for everything.**
Not one per app, not one per document.
Docs are loaded lazily into a `Map` of name → `Y.Doc` on first touch, so wake cost is proportional to what's actually used.

**Identity lives behind exactly one function.**
`getUser(request)` returns the authenticated identity: a person's email, or for headless clients the name of a Cloudflare Access service token (`common_name` claim).
In production it verifies the JWT in `Cf-Access-Jwt-Assertion` against the Access public keys; both flows produce that same JWT, so this stays one verification path.
Locally it returns a stub.
This is the only place either mechanism may appear.
Do not read `Cf-Access-Authenticated-User-Email` — it is a plain header and not independently trustworthy.
Non-human clients (backup job, kitchen display, automations) are just service tokens; the actor column records the token name.
Authorization is deliberately all-or-nothing for now: any authenticated identity can read/write every doc.
Scope checks, if ever needed, belong in the DO keyed on the actor string — do not build them speculatively.

**Transport is hibernating WebSockets, wire format is the standard y-protocols sync protocol.**
The DO uses the WebSocket Hibernation API so left-open tabs don't bill wall-clock.
Consequences: no in-memory state is trustworthy (every handler hydrates docs from SQLite via one chokepoint), and per-socket facts live in `serializeAttachment`, never closures.
One doc per socket, doc name in the URL path, stock `y-websocket` provider on the client.
No custom envelope: nothing app-specific rides the wire.

**Attribution: actor in the log, everything else in the doc.**
Every stored update row records the actor — the authenticated email, stamped server-side from the socket's identity, never sent by the client.
This is short-window forensics only; compaction deletes it along with the rows.
App-facing attribution ("added by Maya") is app data inside the doc, defined per app — my daughter has no account, so acting-as is a client-side claim either way.
There is no subject concept at the sync layer.

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

## Workflow

Commit as you go: once a logical change is verified, commit it without asking — one logical change per commit, staging only the files that belong to it.
Never push.

## Verification

- `bun run dev` starts `wrangler dev`; `/health` responds.
- A real SQLite file appears under `.wrangler/state` after the DO is touched once.
- With the dev server up: `bun scripts/converge.ts` proves two clients converge, including across a simulated hibernation eviction (`/debug/amnesia`); `bun scripts/compaction.ts` proves the log compacts to one row with no data loss.
- The scratch page at `/` (build with `bun run --cwd bay build:scratch`) is the human two-tab check.
- `bun test` for `packages/*` (covers Access JWT verification with locally minted keys).
