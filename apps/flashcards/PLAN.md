# Flashcards — study sessions

Milestone label: `flashcards-study`.
This doc is the scope statement; it is deleted when the work is done.
It is a rewrite of an older design brief for a kid's daily fact drill, settled with Abhay on 2026-09-14 into one implementation for every deck: there is no kid deck and no grown-up deck, only decks.
Items marked *inference* were pinned while authoring and are his to overrule; ask before changing pedagogy.

## Why

The shipped study screen is a due queue: front, reveal, four buttons, next.
That is enough to test the platform and not enough to learn from.
The morning drill it has to become: a few minutes at the keyboard, prompt-first, self-graded, with brand-new facts learned in the same session they first appear, a short session even when the review queue has backed up, and a satisfying ending.
The scheduler already exists (`src/sm2.ts`); this layer sits on top of it and bends it toward the session.

## Pedagogy (settled)

**Retrieval, not reading.**
Cards are prompt-first: front shown, the studier says the answer aloud, reveals, then self-grades.
A failed attempt followed at once by the answer is itself a strong learning event, so there is no separate study phase.

**Interleave.**
Session order is shuffled so nothing can be chained off position.

**Two outcomes: got it, missed it.**
Self-graded, never machine-graded: a machine wrongly rejecting a right answer teaches that the game is unfair, which is far worse than an occasional generous self-grade.
Honesty is social, not technical.
*Inference:* "got it" is the scheduler's Good and "missed it" is Again; the model keeps all four buttons (`Button` in `src/sm2.ts`) for scripts and for any later screen, and the study screen shows two.

**Card lifecycle, Anki-style, on top of SM-2.**

    new → intro → learning(step 1..N) → review
                             review → relearning → review   (on a miss)

- *intro*: the first time a card appears, both sides are shown together and read aloud; advancing is not a grade.
- *learning*: the card comes back a few cards later, prompt-first, and must be produced correctly N times (N = 2 to start) before it graduates. A miss resets it to step 1. This is how a brand-new fact is learned in its first session with no prior teaching.
- *review*: graduated cards belong to SM-2, unchanged.
- *relearning*: a review miss puts the card back into this session once more; producing it correctly rejoins review with whatever penalty SM-2 applied.

Anything in the learning or relearning pool comes back in the same session, never tomorrow.

*Inference, the main design choice:* learning state is session-local and never stored.
A card graduates from learning by receiving its first SM-2 grade, Good.
A card that has not graduated when the session ends is still new tomorrow and gets its intro again, which is what the brief's "never defer to tomorrow" already implies.
A review miss writes Again; the relearning pass that follows writes nothing, so the ease penalty stands and one miss is one log entry.
The alternative, a stored per-card phase, buys only "skip the intro on a half-learned card" and is not worth a shape change.

**Session composition.**
In this order, then shuffled within each group:
1. A couple of well-known review cards as a warm-up: not due, longest interval. A hit on one writes nothing, since the scheduler had not asked; a miss on one is real information and is graded like a review miss. Skipped when nothing is due and nothing is new: a deck with nothing to study today is not a session.
2. Due review cards, most overdue first.
3. New cards up to the daily cap, each going through intro and learning.

Two caps, and they win over the scheduler:
- **New cards per day** (start at 5). The deck may hold hundreds of facts; the cap is what keeps the session short.
- **Session length** (start at 20 review cards). When the queue has backed up, show the most overdue and defer the rest rather than lengthen the session; the habit is worth more than any card.

Never skip review to fit more new cards.
*Inference:* both caps are constants in the model, the same for every deck; "new cards introduced today" is derived from the review log (first log entry for the card is today), so an introduced-but-not-graduated card does not count and comes back tomorrow.

## Controls

Keyboard only; the studier drives.
- **Space**: reveal the answer, or advance an intro card.
- **Right arrow**: got it.
- **Left arrow**: missed it.

Reveal and "got it" are separate keys on purpose: a false miss costs one extra review, a false hit buries an unknown card for weeks.
Grade keys are ignored for about 300 ms after a reveal so a bounced or held space cannot fall through into a grade.
The existing on-screen buttons stay for phones, and the phone is not the target.

## Reward

- A guaranteed session-complete moment: confetti, fanfare, or a silly animation, with the flavour varying day to day. Surprising decoration, predictable reward, not a slot machine.
- A total-sessions count that only goes up, derived from the review log as distinct days with entries. **No streak counters**: a broken streak on a sick day can end the habit.
- No collection mechanic and no shared visual universe with anything else; the load-bearing reward is a parent being visibly pleased, and the software's job is to produce a moment worth running to show someone.

## Shape in code

- `src/model.ts` gains one pure planner beside `dueCards`: from (progress, deck id, deck, now) to `{ warmup, review, fresh }` card-id lists, with the caps and the log-derived "introduced today" inside it. `dueCards` stays for the converge script until the planner replaces it there.
- A new pure module, `src/session.ts`, is the lifecycle: a state machine over the planner's lists that hands out the next card and its phase (intro, prompt, relearn), takes an outcome, and says which grade to write, if any. No Yjs, no DOM, unit-tested like `src/sm2.ts`.
- `src/main.ts` and `index.html` drive that machine: intro layout, keyboard handling with the lockout, the count of what is left, the completion screen with the sessions total. Rendering stays plain DOM, as it is now.
- Doc shapes do not change; `SCHEMA` stays 1.

## Verification

- `bun test` covers `src/session.ts`: a new card takes intro then two correct prompts to graduate and one grade lands; a learning miss resets to step 1; a review miss writes Again once and the relearn pass writes nothing; the re-insert distance is a few cards, not the end of the queue; the caps hold with a backed-up queue.
- `bun scripts/flashcards-converge.ts` still passes, and gains one probe: a deck of thirty new cards yields a plan of five fresh cards, and after they graduate, a second plan the same day yields none.
- The two-tab human check on the family server: a session from start to the completion screen with the keyboard alone, one deck, and the other tab showing the progress it wrote.

## Not in scope

Per-deck settings, a stored learning phase, notifications, any second screen for grown-ups.
