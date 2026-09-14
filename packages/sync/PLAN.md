# Directory — plan

Milestone label: `directory`.
This doc is the scope statement; it is deleted when the milestone closes, after the graduation sweep (see "At close").
Settled on 2026-09-14 in discussion with Abhay; nothing here is speculative.

## Why

Every app needs to answer "who is this?" and "who has seen this?", and today notes answers the first inline (`apps/notes/src/main.ts`, the block under "Identity: name from /whoami") and nothing answers the second.
Flashcards is next and wants per-person data, so the shared pieces get built first, on notes, where they can be rehearsed on real devices before any data that matters exists.

Admission is Cloudflare's job (`CLAUDE.md`, identity paragraph: "Who is *allowed in* is decided entirely by Cloudflare").
Everything below assumes any identity the app receives is allowed, and treats "which person, which docs" as app data.

## Decisions

**Two directory docs, both ordinary Yjs docs in the same DO.**
- `actors`: keyed by the identity string `getUser` returns (an email, or a service token's `common_name`).
  Robots are entries too — they edit docs and will speak in chat.
  Entry is a `Y.Map` with, initially: `handle` (short, hand-chosen, lowercase; what later apps use in doc names), `name` (display), `fg`, `bg` (colors).
  Fields grow ad hoc per the schema policy; avatar and a light/dark preference are expected.
  Caution recorded: a light/dark preference is the first *preference* rather than *identity* field, and may one day want to be per-client; do not split it out until that day.
- `clients`: keyed by a per-browser client id (random UUID generated once, kept in `localStorage`).
  Scope note: `localStorage` and IndexedDB are both per origin per browser profile, so Safari and Firefox on one phone are two clients, and all apps on our one origin share the id.
  When a browser evicts the site's storage, the id and the stale IndexedDB doc copy vanish together — the hazard leaves with the id.
  Entry: `actor`, `label` (hand-edited, e.g. "Someone's phone, Safari"), `firstSeen`, and per app `{ build, schema, syncedAt }`.
- Separate docs because `actors` is rare and hand-edited while `clients` is stamped on every reconnect.

**Every app opens its doc through one helper in `@garage/sync`**, replacing the bare `openDoc` + `IndexeddbPersistence` + `/whoami` fetch that notes does by hand.
Call it `openApp(name, schema)` or similar; it: opens the app doc, attaches local persistence unconditionally (every app is offline-first), resolves the actor (fetch `/whoami`, cache in `localStorage` for offline starts, look up in `actors`), and stamps `clients` after the app doc's `synced` event.
The stamp is written only after sync completes, so its presence on the server means that client has both the new bundle and the current state.
Backup stays outside: it opens no doc.
Offline-first means the *data*: a loaded app keeps working and reloads its docs from IndexedDB while the server is unreachable.
The app shell (HTML, bundle) is still served by the Worker, so a reload with the server down fails; caching the shell is a service worker, which needs a secure context and is a separate decision (verified on the scratch page 2026-09-14).

**Two version numbers.**
- Build identity: the git short sha, baked in at build time (`bun build --define`), monorepo-wide.
  Answers "which code is running".
- Schema: a small integer per app, bumped by hand when the doc shape changes.
  Answers "which shape does this code write".
  A migration check compares this one; a sha has no ordering.

**Migrations are idempotent scripts, and the store holds one shape at a time.**
Rehearsed here on notes' `createdBy`, which currently holds whatever `/whoami` returned and migrates to the actor's `handle`.
Hazard: a client running an old bundle while disconnected can create a record in the old shape and sync it later.
Guard: the script maps any recognized value and leaves migrated ones alone, so it is safe to rerun after stragglers reconnect.
A migration closes only when `clients` shows every entry at the target schema with `syncedAt` after the migration ran, and a rerun changes nothing.
Migration scripts are deleted once run; the commit message records the clean run.

**One generic doc tool instead of per-app admin scripts.**
`scripts/doc.ts`: dump any named doc as JSON; set or delete a value at a path for maps and arrays; refuse to overwrite `Y.Text` (text has edit semantics; a path-set would destroy history).
This is how the directories are edited: Abhay asks, the agent runs it, shows the result.
Targeting follows `scripts/target.ts` exactly: test server by default, family server by explicit `GARAGE_URL`, production by URL plus service token.
Where an app has invariants, that logic lives in a model module beside the app, imported by the web client and by scripts alike; the converge script imports the model rather than restating the shape.

**Production starts empty.**
Nothing on the family server carries real identity (every write is stamped with the stub), so nothing is transferred at cutover.
The directories are created on production directly with the doc tool.
On the family server the only `actors` entry that resolves is the stub's; everyone shares it until deploy, which is no worse than today.

**Deferred, deliberately.**
A local identity override for the dev stub waits for flashcards, where two actors must differ on one server.
An app-based directory editor waits until someone wants it.

## Shape of the work

Seven cards, label `directory`, in dependency order:
1. `actors` shape + converge script.
2. `clients` shape + stamp semantics + converge script.
3. Versions: sha baked into every bundle, schema constant per app; one shared build script replacing the three copies in `bay/package.json`.
4. `openApp` helper composing 1–3.
5. `scripts/doc.ts`, the generic doc tool.
6. Notes onto the helper + model module + `createdBy` migration + straggler check.
7. Graduation sweep; delete this file.

## Verification (milestone level)

- Notes on every family device runs on the helper: `clients` shows one entry per browser in use, each with a `build` matching the deployed bundle and a `notes.syncedAt` after promotion.
- The `createdBy` migration reports zero stragglers and a rerun is a no-op.
- `bun scripts/doc.ts dump actors` against the family server prints the stub entry; the same against the test server after the converge scripts prints what they wrote.
- `bun scripts/converge.ts`, `bun scripts/notes-converge.ts`, `bun scripts/compaction.ts`, `bun scripts/backup-cycle.ts` all still pass against the test server.
- `bun test` passes.

## At close

Graduate to committed docs, then delete this file:
- `apps/WORKFLOW.md`: an "every app works this way" section — the helper call, offline-first, the model-module convention, the two version numbers, the migration procedure (idempotent script, everyone reloads, straggler check, delete the script).
  Rewrite "apps using `y-indexeddb`" as a statement that all apps do.
- `CLAUDE.md`: the two directory docs and their keys, beside the identity paragraph; "backend is storage plus identity" gains the note that directories are ordinary docs, not an admin API.
- Placeholders only in anything committed; real entries live in the data.
