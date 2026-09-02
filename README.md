# garage

A monorepo of small single-page apps for my family (three people, forever), backed by one Cloudflare Worker fronting a Durable Object.

Apps sync through [Yjs](https://yjs.dev); the backend is storage plus identity, nothing more.
Durable Object SQLite holds the update log as the truth; identity is Cloudflare Access in production and a stub locally.

This is a personal project.
It is public to read, but it is built for exactly one household — expect decisions that only make sense at that scale.

## Layout

```
bay/              # the Worker + Durable Object class + wrangler.toml
packages/sync/    # Yjs client wiring, identity helper
apps/<name>/      # one directory per app
scripts/          # headless integration checks
```

Architecture and settled decisions live in `CLAUDE.md`; the roadmap lives in `brief.md`.

## Running it

```
bun install
bun run dev        # wrangler dev, LAN-exposed, port 8787
bun run dev:test   # disposable instance for the integration scripts, port 8788
bun test           # unit tests (packages/*)
bun scripts/converge.ts   # and friends, against the test instance
```

## License

[MIT](LICENSE).
