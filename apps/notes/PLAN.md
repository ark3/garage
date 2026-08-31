# apps/notes — implementation plan

Temporary document; delete when the milestone is verified and brief.md is updated.
Read CLAUDE.md first — it holds the settled decisions this plan assumes.

## Goal

A plain-text collaborative notes app (Apple Notes / Simplenote shaped, no checklists) for a three-person family.
It is the probe for the whole platform: if collaborative text editing holds up here — concurrent edits, offline, reconnect — every later app is easier.
Useful-to-Abhay-immediately beats feature-complete.

## Shape

- A note list (sidebar or simple list view) and one editor pane.
- Create note, delete note, pick a note to edit.
- A note's title is its first line, Apple Notes style — no separate title field to sync.
- Plain text only. No rich text, no checklists, no search, no folders.
- Authorship is ephemeral presence: colored remote cursors/selections while others edit.
  No durable per-character attribution (deliberate — see CLAUDE.md attribution decision).

## Data model

One Y.Doc named `notes` holds everything (family scale; lazy-load-per-doc buys nothing at 3 users).
Suggested structure — adjust if the editor binding pushes back, but keep it one doc:

- Top-level `Y.Map` keyed by note id (crypto.randomUUID()).
- Each note: a nested `Y.Map` with a `Y.Text` for the body plus plain fields:
  `createdBy`, `createdAt`, `updatedAt`.
- `createdBy` comes from `/whoami` (below) — in-doc attribution per the CLAUDE.md decision.
- `updatedAt` orders the note list; debounce its writes (per-keystroke meta churn is pointless update-log noise).
- Deleting a note deletes the map entry.
  Concurrent edit-vs-delete must not wedge either client — whatever the CRDT does (note stays deleted) is fine, but both tabs must remain usable.

## Pieces

**Client identity (`/whoami`).**
The browser needs to know who it is for `createdBy` and for the awareness user name/color.
Add a `/whoami` route: Worker forwards to the DO (or answers directly — either is fine), body is the result of `getUser(request)`.
This is the only bay change the app should need.
Follow the existing route pattern in `bay/src/index.ts`.

**Editor.**
CodeMirror 6 + `y-codemirror.next` (official Yjs binding), bound to the selected note's `Y.Text`.
`yCollab(ytext, provider.awareness)` gives remote cursors/selections.
Set the local awareness user field: `{ name, color }` where name comes from `/whoami` and color is derived deterministically from the name (hash → palette), so a person is the same color on every device.
These dependencies belong to the app package only — nothing editor-related may appear in `bay/` or `packages/sync`.

**Sync + offline.**
`openDoc("notes")` from `@garage/sync` (see `bay/scratch/main.ts` for existing usage).
Add `y-indexeddb` persistence on the same doc so the app opens instantly and works offline; y-websocket reconciles on reconnect.
If wiring y-indexeddb reveals a natural home in `packages/sync` (e.g. an option on `openDoc`), extend `openDoc` — that package exists to absorb exactly this kind of wiring.

**Build + serving.**
Source lives in `apps/notes/` (its own package.json with the editor deps; html + `src/main.ts`).
Serve at `/notes/` via the existing assets setup: bundle with `bun build` into `bay/public/notes/`, mirroring the `build:scratch` script in `bay/package.json`.
Built output is gitignored (see `.gitignore` — follow the `bay/public/main.js` precedent).
Keep the scratch page working; don't repurpose it.

## Style

Minimal, honest CSS — readable on a phone, no framework, no build-time CSS tooling.
This is a family tool, not a product.

## Verification

Work goal-first: get each check passing before polishing.

1. **Headless convergence on Y.Text.**
   Extend the existing pattern in `scripts/converge.ts` (run it to see the harness style): a `scripts/notes-converge.ts` where two headless clients edit the same note's `Y.Text` concurrently (interleaved inserts), converge to identical strings, survive `/debug/amnesia`, and a fresh third client hydrates the full note set from SQLite.
   This proves the sync path for text without a browser.
2. **Build + serve.**
   `bun run dev` up; `/notes/` returns the page; the bundle loads (curl the html and the js, check 200s).
3. **Human two-tab check (Abhay does this part).**
   Two tabs: notes list syncs, concurrent typing in one note converges, remote cursor visible and colored, offline tab (DevTools offline) keeps editing and reconciles on reconnect.
   The app must be left in a state where this works with just `bun run dev` + `bun run --cwd bay build:notes`.
4. Existing checks still pass: `scripts/converge.ts`, `scripts/compaction.ts`, `/health`.

## Constraints and cautions

- Respect every runtime rule in CLAUDE.md (workerd vs browser boundaries; wrangler invocation).
- Check current docs/READMEs for `y-codemirror.next` and `y-indexeddb` API shape rather than trusting memory; both are small but have moved before.
- Commit as you go per CLAUDE.md workflow: separate logical commits (e.g. /whoami; app scaffold; editor wiring; offline; verification script), each staging only its own files.
- Every file ends with a newline.
- If something in this plan fights reality (binding API, assets routing), prefer reality, keep the goal, and note the deviation in the final report.

## Non-goals

Durable authorship coloring, rich text, search, note organization, auth changes beyond `/whoami`, any `bay/` schema change, LAN binding, deploy config.
