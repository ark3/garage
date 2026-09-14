# Flashcards — initial thoughts

Pre-design notes settled in discussion on 2026-09-14, before any plan doc exists.
The app shipped 2026-09-14; the plan doc that followed this is gone, and its decisions live in `src/model.ts` and `src/sm2.ts`.
Everything an app is expected to do at startup is in `apps/WORKFLOW.md` ("Every app works this way") and is not repeated here.

## Why flashcards is sequenced where it is

Flashcards wants identity: different people have different progress.
Deploy was ordered first because the app was designed to read who is studying from the server, and that path exists only behind Access.
Two refinements from the 2026-09-14 discussion:
identity is a label, not a wall (authorization is all-or-nothing, so any device can open any doc; per-person separation is data organization), and the Cloudflare phases A and B are mostly waiting, so app work can proceed in parallel.
On the LAN everyone is the stub identity, and that is accepted: one person's progress until deploy, no dev-stub override (declined as unnecessary complexity; it would only serve testing, and scripts can exercise two handles directly).
The problem goes away at deploy.

## What a card is

Each side (front, back) is text with a kind: `plain` or `abc`.
`plain` renders as text; `abc` is ABC music notation rendered client-side to SVG by abcjs (check bundle size before committing to it; it is a dependency of this app only).
"Treble B" is the one-line ABC `B` on the front and the words on the back.
Nothing binary enters the platform; a third kind later is one more branch in the renderer.

## Ownership shape

Decks are shared: anyone can create, copy, or edit any deck.
Studying is a per-person choice: anyone can study any deck, with their own progress.
So there are two doc kinds: one doc per deck (cards, keyed by globally unique card id — the package `uuid` — so a copied deck keeps progress meaningful), and one progress doc per person covering every deck they study, keyed by deck id and card id.
A studier opens two sockets: their progress and the deck.
Doc naming and the exact shapes are the plan doc's to pin, via `scripts/flashcards-converge.ts` importing `apps/flashcards/src/model.ts`, per the workflow doc.

## Scheduling

SM-2, client-side, "what is due" computed at open (roadmap: coupling to a platform primitive for reminders is an explicit decision, not a default).
Grading is Anki's four buttons (Again, Hard, Good, Easy) mapped to SM-2 grades; the review screen may show only Again and Good where that suits the studier.
Per-card progress: ease factor, interval, repetition count, due date.
Recommendation, not a commitment: also keep the raw review log (one entry per answer) in the progress doc, so a fitted scheduler such as FSRS could be trained from real data later.

## First iteration

Abhay iterates on the UI with arithmetic decks for the kid and notation decks for himself, on the family server, under one identity.
Per-person progress is exercised for real after deploy.
