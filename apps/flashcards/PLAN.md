# Flashcards — plan

Milestone label: `flashcards`.
This doc is the scope statement; it is deleted when the milestone closes, after the graduation sweep (see "At close").
It supersedes `THOUGHTS.md` where the two differ; `THOUGHTS.md` stays as the pre-design record.
Settled on 2026-09-14 in discussion with Abhay; the items marked *inference* were pinned while authoring and are his to overrule.

## Why

The first app the family will actually use: arithmetic decks for the kid, notation decks for Abhay.
It exercises per-person data for the first time, on the platform the directory milestone finished (`apps/WORKFLOW.md`, "Every app works this way").
On the LAN everyone is the stub identity and shares one progress doc; that is accepted and goes away at deploy (`THOUGHTS.md`, "Why flashcards is sequenced where it is").
No dev-stub identity override: scripts exercise two handles directly.

## Decisions

**Three doc kinds, all under the `flashcards-` prefix.**
The Worker only accepts doc names matching `[A-Za-z0-9_-]+` (`bay/src/index.ts`, the `/doc/` route match), so a person is named by their `actors` handle, never by the raw identity string.
- `flashcards`: the app doc, opened with `openApp`, carrying the schema marker and the client stamp.
  It is the deck index: `decks` map, deck id → `{ name, createdBy, createdAt }`.
  *Inference:* THOUGHTS names deck docs and progress docs but nothing that lists decks; Yjs has no "list docs", so the index is a third doc kind, and it is the natural app doc.
- `flashcards-deck-<deckId>`: one per deck, `cards` map, card id → `{ front, back, createdAt }` where each side is `{ kind, text }` and `kind` is `plain` or `abc`.
  Card ids come from `uuid()` in `@garage/sync` (the same generator notes uses), so a copied deck's cards keep their ids and a person's progress on them stays meaningful.
  *Inference:* THOUGHTS says "the package `uuid`"; the repo has no npm `uuid` and already exports one, so that is the one.
  Card order is by `createdAt`; there is no ordering array.
- `flashcards-progress-<handle>`: one per person, covering every deck they study.
  `cards` map keyed `<deckId>/<cardId>` → SM-2 state `{ ease, interval, reps, due }`, plus `log`, a `Y.Array` of `{ deckId, cardId, at, grade }`, one entry per answer.
  The log is kept from the start (THOUGHTS recommended it; the cost is one append per answer, and it is what would let a fitted scheduler be trained later).
  An unmapped actor (`me.current` undefined) has no handle and therefore no progress doc: the app says so plainly and offers no study, matching the no-placeholder rule.

The exact field types and the plain functions over them are pinned by `apps/flashcards/src/model.ts` (`SCHEMA = 1`) and proven by `scripts/flashcards-converge.ts`, per `apps/WORKFLOW.md` ("The data model is the durable artifact").

**A studier holds three sockets: index, deck, progress.**
`openApp` opens one doc; the other two are opened with local persistence the same way (offline-first is unconditional).
That is a small addition to `@garage/sync`: a way to open a further doc with `y-indexeddb` attached, exported beside `openApp`, since apps do not depend on `y-indexeddb` directly.
The schema marker and the stale guard live on the app doc only; deck and progress docs carry no marker.
*Inference:* one guard per app is enough because one bundle writes all three shapes, and a stale bundle stops at the index before it can open a deck.

**Scheduling is SM-2, client-side, pure.**
`apps/flashcards/src/sm2.ts`: a function from (previous state, grade, now) to the next state, following the published SM-2 rules (ease floor 1.3; intervals 1, 6, then previous × ease; a failing grade resets repetitions).
Anki's four buttons map to SM-2 quality grades as Again → 1, Hard → 3, Good → 4, Easy → 5 (*inference:* THOUGHTS says "mapped", not how; this is the common mapping and the tests pin it).
"What is due" is computed at open: a card is due when it has no progress entry or its `due` is at or before now.
Again puts the card back into the current session's queue; nothing else re-queues.
Coupling to a platform primitive for reminders is an explicit decision, not a default (`CLAUDE.md`, "Coupling to a second Cloudflare primitive").

**ABC notation renders client-side with abcjs, and its bundle cost is measured before it is adopted.**
abcjs is a dependency of this app only.
The measurement (bundle size with and without it, and whether it must be loaded on demand so arithmetic decks never pay for it) is recorded in the abcjs card's close note and in the app's package or build comment, whichever the implementer finds; the number decides the loading strategy.
Nothing binary enters the platform; a third side kind is one more branch in the renderer.

**Two screens, no more.**
Decks: list, create, copy (a new deck id with the same cards and card ids), open a deck to edit its cards (both sides, each with kind and text; abc previews as it is typed).
Study: pick a deck, answer due cards front-then-back, grade with Again / Hard / Good / Easy (the screen may show only Again and Good), see the count remaining.
Rendering follows notes (`apps/notes/index.html`, `apps/notes/src/main.ts`): plain DOM, one bundle, the stale message as text.

**Promotion is the first-iteration loop, not the end.**
Abhay iterates on the UI on the family server under one identity (`THOUGHTS.md`, "First iteration"); doc names burn freely on the test server before that and the shape freezes at promotion (`apps/WORKFLOW.md`, "Promotion freezes the shape").

## Shape of the work

Seven cards, label `flashcards`:
1. Model module and converge script (the shape, proven headlessly, including a thousand-card deck).
2. SM-2 scheduler, pure and unit-tested.
3. Opening further persisted docs from `@garage/sync`.
4. abcjs bundle-cost measurement and loading decision.
5. Decks screen (index, deck editor, copy) and the build wiring.
6. Study screen (due queue, grading, progress writes, log).
7. Promotion to the family server, human check, graduation sweep; delete this file.

Cards 1–4 are independent; 5 waits on 1, 3, 4; 6 waits on 1, 2, 5; 7 waits on everything.

## Verification (milestone level)

- `bun scripts/flashcards-converge.ts` against `bun run dev:test` passes: two handles study one deck with separate progress, a copied deck keeps card ids, the thousand-card probe, `/debug/amnesia` survival, and a fresh client hydrating all three doc kinds.
- `bun test` passes, now including the SM-2 tests under `apps/flashcards/`.
- `bun run --cwd bay build:flashcards` succeeds; the notes, backup, and scratch builds still succeed; `.gitignore` covers `bay/public/flashcards/`.
- Every other script under `scripts/` still passes against the test server.
- On the family server: two devices open the same deck, a card edited on one appears on the other, a study session on one advances progress the other can see, and `bun scripts/doc.ts dump clients` (with explicit `GARAGE_URL`) shows both stamped for `flashcards`.

## At close

Graduate to committed docs, then delete this file:
- `brief.md`: move flashcards to "Done" with the date; the trial's clock starts, per "Next, in order" item 3.
- `apps/WORKFLOW.md`: whatever the multi-doc app taught that a later app needs (the further-docs helper, one marker per app), as a short addition to "Every app works this way".
- `CLAUDE.md` Verification: the converge script and the build.
- `THOUGHTS.md` stays; add one line at its top saying the milestone shipped and where the conventions went.
- Placeholders only in anything committed.
