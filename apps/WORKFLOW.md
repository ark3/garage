# Building and iterating on an app

Conventions for app work, learned during notes/backup.
Read this when starting or resuming work on anything under `apps/`.

## The data model is the durable artifact

An app here is almost pure client code; the code can be rewritten freely, but data in a Y.Doc outlives every version of the code that wrote it.
So pin the doc shape headlessly before building UI: write `scripts/<app>-converge.ts` against the shape first.
That script doubles as the design document for the data model and is where scale questions get probed (a thousand fake entries) before there is any UI.

## Iterate against the test server, burn doc names freely

All pre-promotion iteration happens on the disposable 8788 instance (`bun run dev:test`).
When the doc shape changes, wipe the test server or just start using a fresh doc name (`chat-dev2`).
No migration thinking is owed until real family data exists.

## Promotion freezes the shape (roughly)

Promoting an app to the family server is the moment its doc shape starts accumulating real data.
After that, shape changes mean writing a small one-off migration script through the sync client (`@garage/sync`), because data outlives code.
So promote when real usage feedback is wanted, not merely because it works.

## Every app works this way

An app opens its doc with one call, `openApp(name, SCHEMA)` from `@garage/sync`, and that call does everything the platform expects of a browser client:
it attaches `y-indexeddb` persistence to the app doc and to both directory docs (offline-first is unconditional), resolves the actor from `/whoami` with a `localStorage` cache for offline starts, exposes `me` (a live view of the actor's `actors` entry, `undefined` when unmapped — show that plainly, never invent a placeholder), stamps `clients` after every sync, guards the doc's schema marker, and reloads when the served build moves.
Headless scripts use `open()` from `scripts/target.ts` instead, which never touches IndexedDB and cuts BroadcastChannel so "another client sees it" always means the server has it.

The doc shape lives in a model module beside the app (`apps/<name>/src/model.ts`), as plain functions over `Y.Doc`, exporting `SCHEMA`.
The web client and every script import it; the converge script imports the model rather than restating the shape.

Offline-first means the data: a loaded app keeps working and rehydrates from IndexedDB while the server is unreachable.
The shell (HTML, bundle) is still served by the Worker, so a reload with the server down fails; caching the shell would be a service worker, which needs a secure context and is a separate decision.

Two version numbers, never one: `GARAGE_BUILD` is the git short sha baked into every bundle by `bay/scripts/build-app.ts` (`-dirty` when the tree is) and answers "which code is running"; `SCHEMA` is a hand-bumped integer per app and answers "which shape does this code write".

## Migrations: one shape in the store at a time

A shape change is: bump `SCHEMA`, write an idempotent script through the sync client that maps old values and leaves everything else alone (report anything unrecognized, never guess), rebuild, run the script, then run it again.
The store never holds two shapes on purpose.
The first bundle at the new `SCHEMA` to sync writes it into the doc's `meta.schema`; any older bundle that sees the doc ahead disconnects, reloads once, and if still behind shows itself as out of date — so a device left on an old bundle cannot write the old shape after the store moved on.
The script's closing condition is a rerun that migrates nothing plus every `clients` entry for the app at the target schema; that is what proves no old-shape write arrived and every device runs the new bundle.
Nobody needs to be gathered for it: open tabs pick up a rebuilt bundle on their next focus or reconnect.
Delete the migration script once it has run clean, in its own commit whose message records the run.

## The y-indexeddb trap

Every app persists its docs in each browser via `openApp`, keyed by doc name.
If the doc shape changes but the name is reused, a stale IndexedDB copy on some tab or phone will merge old-shape data back in — it presents as haunted or impossible data.
Bumping the doc name sidesteps this entirely; the alternative is clearing site data on every device that ever loaded the app.

## The edit loop is lighter than it looks

Client-only changes never touch wrangler: run the app's bundle in watch mode (`bun build ... --watch` into `bay/public/<app>/`) and refresh the browser; wrangler serves assets from disk, so even the family server picks up a rebuild without a restart.
Backend changes restart wrangler and drop sockets, but `y-websocket` reconnects on its own; open tabs heal.
Promotion to phones is just `bun run --cwd bay build:<app>` — the LAN family server is a free staging environment.

## Plan doc + subagent, then re-verify

The proven pattern: settle the design in discussion, write `apps/<name>/PLAN.md` conveying goals and verification (not steps), have a subagent implement it, independently re-verify its claims, delete the plan when the milestone closes.
For a multi-day iteration the plan doc can live longer as the running scope statement.

## Known limitation: the dev stub is single-user

Locally, `getUser` always returns `dev@localhost`, so two test clients are indistinguishable at the identity layer.
Awareness names are client-set (cursors can differ), but server-stamped attribution cannot be exercised multi-person until deploy.
If an app's design hinges on socket-derived identity, decide then whether the dev stub should accept an override — do not build it speculatively.
