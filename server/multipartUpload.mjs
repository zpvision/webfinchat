// Standard Tinode upload for backends which reject an empty direct-upload
// preparation request as malformed. Never retry after sending bytes to storage.
export async function tryMultipartUpload({ presignStatus, presignBody, host, apiKey,
  token, mime, extension, fileBody, diagnostics }) {
  if (presignStatus !== 400) return null;
  let rejection;
  try { rejection = JSON.parse(presignBody).ctrl; } catch { return null; }
  if (Number(rejection?.code) !== 400 || String(rejection?.text).trim().toLowerCase() !== 'malformed') return null;

  diagnostics.setStage('multipart');
  const form = new FormData();
  const suffix = String(extension || '').replace(/[^a-z0-9]/gi, '').slice(0, 20);
  form.append('file', new Blob([fileBody], { type: mime }), suffix ? `attachment.${suffix}` : 'attachment');
  const result = await fetch(new URL('/v0/file/u', `https://${host}`), {
    method: 'POST',
    headers: {
      ...(apiKey ? { 'X-Finchat-APIKey': apiKey } : {}),
      'X-Finchat-Auth': `Token ${token}`,
    },
    // fetch sets the multipart boundary and length. Raw-file Content-Type and
    // Content-Length must not be copied onto the multipart envelope.
    body: form,
  });
  const text = await result.text();
  if (!result.ok) {
    diagnostics.failure(result.status, text);
    return { status: result.status, body: text };
  }
  let packet;
  try { packet = JSON.parse(text); } catch { /* Invalid upstream response. */ }
  const params = packet?.ctrl?.params;
  if (packet?.ctrl?.code !== 200 || typeof params?.url !== 'string' || !params.url || params.upload_url) {
    diagnostics.failure(502, text);
    return { status: 502, body: 'Invalid multipart upload response' };
  }
  diagnostics.setStage('complete');
  return { status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({
    url: params.url, content_type: params.content_type || mime, cache_control: params.cache_control || '',
  }) };
}
