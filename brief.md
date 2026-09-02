# Roadmap

Durable project facts (architecture, runtime rules, settled decisions) live in `CLAUDE.md`.
This file is the task sequence; update or delete milestones as they complete.

## Done

1. Scaffold: workspaces, `bay/` with the DO class, `/health`, dev script.
2. `packages/sync` + the DO apply-and-persist path and compaction (2026-08-30; `scripts/converge.ts`, `scripts/compaction.ts`).
3. `apps/notes` (2026-09-01; human two-tab check, `scripts/notes-converge.ts`).
4. Backup app with merge-semantics restore (2026-08-30; `scripts/backup-cycle.ts`).
5. Real Access JWT verification behind `getUser`, config-gated (`bun test`).

## Next, in order

1. **Deploy.**
   Cloudflare account, `wrangler deploy`, an Access application covering the whole origin, `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` vars.
   Mint one Access service token for headless clients (backups, scripts).
   The `/debug/*` routes are already fenced (2026-09-01): stats/amnesia require an authenticated identity, and wipe does not exist when Access is configured — spot-check all three against production anyway.
   Add a `deploy` script without the XDG/LAN-bind overrides from `dev`, so `wrangler login` credentials land in the real `~/.config`.
   Success: `/whoami` returns the real email from a phone off the LAN, and `scripts/converge.ts` + `scripts/backup-cycle.ts` pass against production using the service token.

2. **Six-week real-use trial of notes.**
   Criteria are written now and graded at the end, not retrofitted:
   family uses it unprompted; zero data loss and zero manual data repairs; ops silence (nothing to babysit); fixes stay evening-sized.
   During the trial, establish the off-machine backup habit: a scheduled fetch of `/api/backup` using the service token — also the first real exercise of the service-token identity path.
   Notes polish happens here too, driven by what use reveals, not speculation.

3. **Design spike before chat (a page of writing, not code).**
   Two questions: how do notifications work without the server reading doc contents (e.g. Web Push carrying only "doc X changed"), and what does an append-forever doc do to tombstones, snapshot size, and compaction.
   The spike exists so chat validates answers instead of discovering problems mid-build.

4. **`apps/chat` — private family chat.**
   The deliberate stress test: unbounded doc growth, notifications, presence beyond cursors; possibly private channels, which would be the first real authorization test.

5. **`apps/flashcards`.**
   Stresses per-person data and timed events (spaced-repetition scheduling) — the case where cron triggers tempt.
   Whether scheduling lives client-side or couples to a platform primitive is an explicit decision per the coupling rule in `CLAUDE.md`.

Later: shopping list (deferred — lots of fiddly domain details to design).
