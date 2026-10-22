import { randomUUID } from 'node:crypto';

export function createUploadDiagnostics(response, { backend, apiKeyConfigured }, log = console.warn) {
  const requestId = randomUUID();
  let stage = 'request';
  response.setHeader('X-Finchat-Upload-Request-Id', requestId);
  const setStage = (next) => {
    stage = next;
    response.setHeader('X-Finchat-Upload-Stage', stage);
  };
  setStage(stage);
  return { setStage, failure(status, body = '') {
    let backendCode;
    try { backendCode = Number(JSON.parse(body).ctrl?.code) || undefined; } catch { /* e.g. storage XML */ }
    // Never log request headers, token, API key, response body, or signed URL.
    log('[finchat-upload] ' + JSON.stringify({ requestId, stage, status, backendCode,
      backend, apiKeyConfigured, time: new Date().toISOString() }));
  } };
}
