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
   Auth decisions (2026-09-02):
   - Identity provider is One-time PIN, policy includes the three family emails — the kid uses her own Gmail (PIN fetched via private window when needed), so no acting-as affordance exists app-side. Session duration 1 month.
   - Logout, when an app wants it, is a plain link to `/cdn-cgi/access/logout` — no conditional rendering; under `wrangler dev` it just 404s, and the apps carry no notion of Access.
   - Service tokens are per-client, minted as clients appear (test scripts first, backup job when the trial's backup habit starts), never speculatively — so the actor column distinguishes clients and revocation is per-device. Not a plan limit (free tier allows 50); the Service Auth policy is separate from the family Allow policy.
   - Each token lives in a file outside the repo, default `~/.config/garage/tokens/<client>`, env-var override; scripts read it at use time (read-only home in the sandbox is fine). If `GARAGE_URL` is non-local and the token file is missing, fail with a clear message before touching the network.
   - Scripts must send `CF-Access-Client-Id`/`CF-Access-Client-Secret` on plain fetches *and* WebSocket handshakes — Access checks the WS upgrade at the edge. Local runs send nothing.
   - Domain: registration stays at Hover; delegate nameservers to Cloudflare (free plan needs the full zone — subdomain delegation is enterprise-only). Recreate existing DNS records in Cloudflare.
   Sequence (A blocks B blocks D; C can run in parallel with A/B and needs no sandbox escape):
   - A. Account + domain (Abhay): Cloudflare account; add the chosen Hover domain as a zone; switch nameservers at Hover; wait for activation (minutes to a day); pick the app hostname.
   - B. Zero Trust (Abhay, dashboard): create the team (fixes `ACCESS_TEAM_DOMAIN`); enable One-time PIN; create the Access app on the hostname at `/*` per the decisions above (its audience tag is `ACCESS_AUD`); mint the first service token + Service Auth policy.
   - C. Repo (agent): `deploy` script without the XDG/LAN-bind overrides from `dev`, so `wrangler login` credentials land in the real `~/.config` (those credentials are consumed only by wrangler itself; deploys never touch service tokens); `[vars]` + custom-domain config in `wrangler.toml`; scripts learn the token-file/header behavior above.
   - D. First deploy (Abhay's terminal, outside the sandbox): `wrangler login`, then `bun run deploy` — only once B and C are done, per the ordering rule above.
   - E. Verify: the success criteria below, plus the `/debug/*` spot-checks, plus the kid's device logging in with her Gmail and holding its month-long session.
   The `/debug/*` routes are already fenced (2026-09-01): stats/amnesia require an authenticated identity, and wipe does not exist when Access is configured — spot-check all three against production anyway.
   Success: `/whoami` returns the real email from a phone off the LAN, and `scripts/converge.ts` + `scripts/backup-cycle.ts` pass against production using a service token — noting `backup-cycle.ts` wipes its target, so run it against production only before real data exists.

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
