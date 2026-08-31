// Backup envelope shared by the bay routes, the browser page, and headless
// scripts. Pure data: base64 codec plus the envelope shape, nothing else.

export type BackupEnvelope = {
  version: 1;
  createdAt: string; // ISO 8601
  docs: Record<string, string>; // doc name -> base64 of Y.encodeStateAsUpdate
};

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000; // avoid arg-spread limits on large arrays
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
