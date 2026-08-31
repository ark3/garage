# apps/backup — implementation plan

Temporary document; delete when the milestone is verified and brief.md is updated.
Read CLAUDE.md first — settled decisions and runtime rules apply.

## Goal

Roadmap item 3: a backup of every doc that leaves the Cloudflare universe (a file on a family machine), and a restore path written and proven at the same time.
A backup that hasn't been restored is a rumor — the verification below is the point of this milestone.

## Shape

**Export API.**
A route that enumerates all docs (`SELECT DISTINCT doc` over the update log) and returns, for each, `Y.encodeStateAsUpdate` of the hydrated doc.
Hydration must go through the existing `getDoc` chokepoint in `bay/src/index.ts` — no second replay path.
One response containing everything: a JSON envelope `{version, createdAt, docs: {name: base64}}` is fine at family scale; pick something a future headless cron job with an Access service token can fetch with plain `curl` (see the identity decision in CLAUDE.md — that consumer is expected).

**Restore API.**
Accepts the same envelope.
Semantics are **merge, not replace**: each doc's snapshot is applied through the normal persist path (insert row with the authenticated actor, apply to the in-memory doc, broadcast to connected clients).
CRDT merge makes this safe and roughly idempotent: restoring an old backup can never destroy newer edits, and re-restoring adds redundant log rows that compaction later squashes.
Replace/rollback semantics are explicitly out of scope.

**Browser page.**
A minimal page (source in `apps/backup/`, served via the existing assets setup like the notes app): one button that downloads the backup as a dated file, one file picker that restores.
Show doc names and byte counts after each operation — enough to eyeball that a backup isn't empty.
Route naming is yours to choose; avoid collisions between the API routes and the static page path, and follow the existing route patterns in `bay/src/index.ts`.

**Authorization** is the current all-or-nothing (see CLAUDE.md): any authenticated identity may back up and restore.
Do not invent an admin concept.

## Verification

Headless proof of the full cycle, in the style of `scripts/converge.ts` (run it to see the harness style):

1. Create a few docs with known content through real sync clients (including at least one doc that has been compacted, so backup-of-a-snapshot is covered).
2. Fetch a backup; assert every doc is present and non-empty.
3. Destroy server state and prove restore recovers it.
   Two acceptable mechanisms — pick one:
   a. The script stops nothing: add a `/debug/wipe` route (delete all rows + drop the doc Map) alongside the existing debug routes, wipe, restore, assert fresh clients see the original content.
   b. Restart-based: the harness manages its own `wrangler dev` lifecycle and deletes `.wrangler/state` between runs. More faithful, more fiddly; only if (a) fights you.
4. Merge safety: back up, make a *new* edit, restore the older backup, assert the new edit survives.
5. Existing checks still pass: `scripts/converge.ts`, `scripts/compaction.ts`, `scripts/notes-converge.ts`, `/health`.

If you add `/debug/wipe`, it shares the existing caveat (debug routes are local-dev-only and unauthenticated; fencing them is a known pre-deploy task, not yours).

## Constraints

- All runtime rules in CLAUDE.md (workerd vs browser; wrangler invocation; every file ends with a newline).
- Backup/restore logic that is pure (envelope encode/decode, base64) is a candidate for `packages/sync` if the browser page and any future headless script would share it; don't force it if the page is the only consumer today.
- Commit as you go per CLAUDE.md workflow; stage only your own files.
- Do not modify PLAN.md files, brief.md, or CLAUDE.md.

## Non-goals

Scheduled/cron backups, service-token wiring, replace/rollback semantics, per-doc selective restore, encryption of the backup file, retention policy, authorization changes.
