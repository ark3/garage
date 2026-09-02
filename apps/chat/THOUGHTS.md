# Chat — initial thoughts

Pre-design notes gathered before any spike or plan exists (2026-09-01).
This is not a plan doc; when the design spike and then `PLAN.md` happen, they supersede this file.

## Why chat is sequenced where it is

Chat is the deliberate stress test of the architecture (see `brief.md`).
It contains three of the stressors the earlier apps never touched: unbounded doc growth, notifications, and possibly differentiated authorization (private channels).
A chat nobody is notified about is a dead app, so notifications are near-mandatory, not polish.

## Questions the design spike must answer first (writing, not code)

Notifications without server-side doc reading: can Web Push work with a payload of only "doc X changed", keeping update blobs opaque and the exit portable?
Whatever the answer, coupling to a new platform primitive falls under the CLAUDE.md rule: write down the portable alternative and consciously reject it.
Append-forever growth: what do tombstones and snapshot size do to a doc that only grows — does compaction stay effective, and at what message count does hydrate-on-wake hurt?
Probe this with a thousand-plus fake messages in `scripts/chat-converge.ts` before there is any UI.

## Doc-shape questions (open)

One doc per channel seems natural — it matches one-doc-per-socket transport and makes a private channel a doc-level concern.
Messages are plausibly a `Y.Array` of maps; messages are effectively immutable after send, which may matter for growth behavior.
Growth may eventually want history split from "live tail" (e.g. a rolling doc plus archived docs), but do not design that speculatively — let the spike's numbers decide.

## Identity and attribution

Decide whether sender identity comes from the doc (client-claimed, like notes' `createdBy`) or from the socket (server-stamped).
The sync layer deliberately has no subject concept and compaction deletes the log's actor column, so durable "who sent this" must live in the doc either way.
The kid has no account, so client-side claims are unavoidable for her regardless.
The dev stub is single-user (`dev@localhost`), so if the design hinges on socket-derived identity, that is the moment to consider a dev-only stub override — not before.

## Authorization

Private channels would be the first real authorization test of the platform.
The banked decision: scope checks belong in the DO, keyed on the actor string — all-or-nothing until a channel actually needs otherwise.

## Presence

Chat wants presence beyond cursors (who is online, maybe typing indicators).
Awareness already carries this shape of data ephemerally; no new machinery is expected, but verify awareness relay behaves sensibly across hibernation.
