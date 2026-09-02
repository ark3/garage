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

Notes was the platform probe, not the trial vehicle: it proved the backend works, and the automated scripts carry that load from here.
The real-use trial attaches to whatever app the family actually wants — chat and flashcards, which involve everyone in a way notes never would.

1. **Deploy.**
   Cloudflare account, `wrangler deploy`, an Access application covering the whole origin, `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` vars.
   Order matters: create the Access application and set both vars *before* the first `wrangler deploy` — with the vars unset the Worker runs the `dev@localhost` stub, and the stub must never be reachable from the internet.
   (Vars set but Access misconfigured fails closed with "missing Access JWT", which is the safe direction.)
   Mint one Access service token for headless clients (backups, scripts).
   Decide how the kid's device authenticates — she has no account, so it's a shared device behind a parent's Access identity, a service-token device, or an email she does have.
   The `/debug/*` routes are already fenced (2026-09-01): stats/amnesia require an authenticated identity, and wipe does not exist when Access is configured — spot-check all three against production anyway.
   Add a `deploy` script without the XDG/LAN-bind overrides from `dev`, so `wrangler login` credentials land in the real `~/.config`.
   Success: `/whoami` returns the real email from a phone off the LAN, and `scripts/converge.ts` + `scripts/backup-cycle.ts` pass against production using the service token.

2. **`apps/flashcards` — the first family-involving app.**
   Primarily for the kid, also Abhay; the most straightforward way to get others using the platform.
   Small docs, no unbounded growth, no notifications — none of chat's open design questions apply, so it ships soonest.
   Scheduling starts client-side (due dates are data; "what's due" is computed at open); coupling to a platform primitive for reminders is an explicit decision per the coupling rule in `CLAUDE.md`.
   Exercises per-person data and multi-person real use.
   First milestone run under the card workflow.

3. **Six-week real-use trial; the clock starts when the first family-used app ships.**
   Criteria are written now and graded at the end, not retrofitted:
   family uses it unprompted; zero data loss and zero manual data repairs; ops silence (nothing to babysit); fixes stay evening-sized.
   During the trial, establish the off-machine backup habit: a scheduled fetch of `/api/backup` using the service token — also the first real exercise of the service-token identity path.

4. **Design spike before chat (a page of writing, not code).**
   Two questions: how do notifications work without the server reading doc contents (e.g. Web Push carrying only "doc X changed"), and what does an append-forever doc do to tombstones, snapshot size, and compaction.
   Web Push needs a secure context and a service worker, so notifications cannot even be prototyped on plain-http LAN — chat is deploy-gated twice over.
   The spike exists so chat validates answers instead of discovering problems mid-build.

5. **`apps/chat` — private family chat.**
   The deliberate stress test: unbounded doc growth, notifications, presence beyond cursors; possibly private channels, which would be the first real authorization test.

Later: shopping list (deferred — lots of fiddly domain details to design); notes polish, only if someone actually reaches for it.
