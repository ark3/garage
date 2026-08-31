// Identity lives behind exactly this one function.
//
// With no AccessConfig (local dev), it returns a stub. With one, it verifies
// the Cf-Access-Jwt-Assertion JWT against the Access public keys and returns
// the authenticated identity: a person's email, or a service token's
// common_name. Config presence is the explicit prod/local switch — never
// fall back to the stub because a header is missing.

export type AccessConfig = { teamDomain: string; aud: string };

export class AuthError extends Error {}

export async function getUser(
  request: Request,
  config?: AccessConfig,
): Promise<string> {
  if (!config) return "dev@localhost";
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) throw new AuthError("missing Access JWT");
  const opts = { iss: `https://${config.teamDomain}`, aud: config.aud };
  try {
    return await verifyAccessJwt(jwt, await accessKeys(config.teamDomain), opts);
  } catch (e) {
    // Unknown kid usually means Access rotated its keys; refetch once.
    if (e instanceof UnknownKeyError) {
      const keys = await accessKeys(config.teamDomain, true);
      return await verifyAccessJwt(jwt, keys, opts);
    }
    throw e;
  }
}

class UnknownKeyError extends AuthError {}

type AccessJwk = JsonWebKey & { kid: string };

const LEEWAY_S = 30;

// Exported for tests, which supply their own keys; production goes through
// getUser and the JWKS cache.
export async function verifyAccessJwt(
  jwt: string,
  keys: AccessJwk[],
  opts: { iss: string; aud: string; now?: number },
): Promise<string> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new AuthError("malformed JWT");
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(textFromB64url(parts[0]));
    payload = JSON.parse(textFromB64url(parts[1]));
  } catch {
    throw new AuthError("malformed JWT");
  }
  if (header.alg !== "RS256") throw new AuthError(`unexpected alg ${header.alg}`);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new UnknownKeyError(`no key for kid ${header.kid}`);
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    bytesFromB64url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new AuthError("bad signature");

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || now > payload.exp + LEEWAY_S) {
    throw new AuthError("expired");
  }
  if (typeof payload.nbf === "number" && now < payload.nbf - LEEWAY_S) {
    throw new AuthError("not yet valid");
  }
  if (payload.iss !== opts.iss) throw new AuthError("wrong issuer");
  const aud = payload.aud;
  const audOk = Array.isArray(aud) ? aud.includes(opts.aud) : aud === opts.aud;
  if (!audOk) throw new AuthError("wrong audience");

  const who = payload.email ?? payload.common_name;
  if (typeof who !== "string" || who === "") {
    throw new AuthError("no identity claim");
  }
  return who;
}

const KEYS_TTL_MS = 60 * 60 * 1000;
const keysCache = new Map<string, { keys: AccessJwk[]; at: number }>();

async function accessKeys(teamDomain: string, force = false): Promise<AccessJwk[]> {
  const cached = keysCache.get(teamDomain);
  if (!force && cached && Date.now() - cached.at < KEYS_TTL_MS) return cached.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new AuthError(`certs fetch failed: ${res.status}`);
  const { keys } = (await res.json()) as { keys: AccessJwk[] };
  keysCache.set(teamDomain, { keys, at: Date.now() });
  return keys;
}

function bytesFromB64url(s: string): Uint8Array {
  const b64 = s.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function textFromB64url(s: string): string {
  return new TextDecoder().decode(bytesFromB64url(s));
}
