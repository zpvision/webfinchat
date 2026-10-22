import test from 'node:test';
import assert from 'node:assert/strict';
import { createUploadDiagnostics } from '../server/uploadDiagnostics.mjs';
import { uploadAttachmentFile } from '../src/api/finchat.js';

test('upload failure log contains stage and status without request/response credentials', () => {
  const headers = {}, logs = [];
  const diagnostics = createUploadDiagnostics({ setHeader: (key, value) => { headers[key] = value; } },
    { backend: 'files.test', apiKeyConfigured: true }, (line) => logs.push(line));
  diagnostics.setStage('presign');
  diagnostics.failure(400, JSON.stringify({ ctrl: { code: 400, text: 'secret-token-must-not-be-logged' }, upload_url: 'https://files.test?secret=test' }));
  const record = JSON.parse(logs[0].slice('[finchat-upload] '.length));
  assert.equal(record.stage, 'presign');
  assert.equal(record.status, 400);
  assert.equal(record.backendCode, 400);
  assert.equal(record.apiKeyConfigured, true);
  assert.equal(record.requestId, headers['X-Finchat-Upload-Request-Id']);
  assert.ok(!logs[0].includes('secret'));
  assert.ok(!logs[0].includes('upload_url'));
});

for (const stage of ['presign', 'storage', 'multipart']) test(`client identifies ${stage} error and exposes safe diagnostic code`, async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ctrl: { code: 400, text: 'malformed' } }), {
    status: 400, headers: { 'X-Finchat-Upload-Stage': stage, 'X-Finchat-Upload-Request-Id': 'test-request-id' },
  }));
  await assert.rejects(uploadAttachmentFile({ token: 'test-user-token', file: new File(['test'], 'test.txt', { type: 'text/plain' }) }), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.apiCode, 400);
    assert.equal(error.uploadStage, stage);
    assert.equal(error.requestId, 'test-request-id');
    assert.match(error.message, /malformed/);
    assert.match(error.message, /test-request-id/);
    assert.ok(!error.message.includes('{"ctrl"'));
    return true;
  });
});
