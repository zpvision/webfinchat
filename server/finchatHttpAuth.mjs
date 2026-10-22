// HTTP auth decodes standard Base64. Some clients/session stores retain base64url
// or omit padding; normalize the representation without changing token bytes.
export function normalizeHttpToken(value) {
  const token = String(value || '').trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(token)) return token;
  const unpadded = token.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (unpadded.length % 4 === 1) return token;
  return unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '=');
}
