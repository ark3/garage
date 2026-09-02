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

## The y-indexeddb trap

Apps using `y-indexeddb` persist the doc in each browser keyed by doc name.
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
