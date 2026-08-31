import { describe, expect, test, beforeAll } from "bun:test";
import { AuthError, getUser, verifyAccessJwt } from "./identity";

const ISS = "https://family.cloudflareaccess.com";
const AUD = "test-aud-tag";
const NOW = 1_800_000_000;

let keyPair: CryptoKeyPair;
let otherPair: CryptoKeyPair;
let jwks: (JsonWebKey & { kid: string })[];

async function generate(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  );
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function mint(
  claims: Record<string, unknown>,
  opts: { kid?: string; alg?: string; key?: CryptoKey } = {},
): Promise<string> {
  const header = { alg: opts.alg ?? "RS256", kid: opts.kid ?? "kid-1" };
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(claims)}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    opts.key ?? keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: "mom@example.com",
    iss: ISS,
    aud: [AUD],
    exp: NOW + 3600,
    nbf: NOW - 60,
    ...overrides,
  };
}

const verify = (jwt: string, now = NOW) =>
  verifyAccessJwt(jwt, jwks, { iss: ISS, aud: AUD, now });

beforeAll(async () => {
  keyPair = await generate();
  otherPair = await generate();
  const jwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey;
  jwks = [{ ...jwk, kid: "kid-1" }];
});

describe("verifyAccessJwt", () => {
  test("valid email token", async () => {
    expect(await verify(await mint(claims()))).toBe("mom@example.com");
  });

  test("service token identified by common_name", async () => {
    const jwt = await mint(claims({ email: undefined, common_name: "backup-bot" }));
    expect(await verify(jwt)).toBe("backup-bot");
  });

  test("string audience accepted", async () => {
    expect(await verify(await mint(claims({ aud: AUD })))).toBe("mom@example.com");
  });

  test("expired token rejected", async () => {
    const jwt = await mint(claims({ exp: NOW - 3600 }));
    expect(verify(jwt)).rejects.toThrow("expired");
  });

  test("missing exp rejected", async () => {
    expect(verify(await mint(claims({ exp: undefined })))).rejects.toThrow("expired");
  });

  test("not-yet-valid token rejected", async () => {
    const jwt = await mint(claims({ nbf: NOW + 3600 }));
    expect(verify(jwt)).rejects.toThrow("not yet valid");
  });

  test("wrong audience rejected", async () => {
    const jwt = await mint(claims({ aud: ["some-other-app"] }));
    expect(verify(jwt)).rejects.toThrow("wrong audience");
  });

  test("wrong issuer rejected", async () => {
    const jwt = await mint(claims({ iss: "https://evil.example.com" }));
    expect(verify(jwt)).rejects.toThrow("wrong issuer");
  });

  test("signature from another key rejected", async () => {
    const jwt = await mint(claims(), { key: otherPair.privateKey });
    expect(verify(jwt)).rejects.toThrow("bad signature");
  });

  test("unknown kid rejected", async () => {
    const jwt = await mint(claims(), { kid: "kid-unknown" });
    expect(verify(jwt)).rejects.toThrow("no key");
  });

  test("alg other than RS256 rejected, even if correctly signed", async () => {
    const jwt = await mint(claims(), { alg: "none" });
    expect(verify(jwt)).rejects.toThrow("unexpected alg");
  });

  test("garbage rejected", async () => {
    expect(verify("not-a-jwt")).rejects.toThrow("malformed");
    expect(verify("a.b.c")).rejects.toThrow("malformed");
  });

  test("no identity claim rejected", async () => {
    const jwt = await mint(claims({ email: undefined }));
    expect(verify(jwt)).rejects.toThrow("no identity claim");
  });
});

describe("getUser", () => {
  test("no config returns the local stub", async () => {
    expect(await getUser(new Request("http://x/"))).toBe("dev@localhost");
  });

  test("config + missing header rejects instead of falling back", async () => {
    const req = new Request("http://x/");
    expect(
      getUser(req, { teamDomain: "family.cloudflareaccess.com", aud: AUD }),
    ).rejects.toThrow(AuthError);
  });
});
