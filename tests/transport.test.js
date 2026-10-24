'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const {request, listModels, normalizeBaseUrl} = require('../extension/lib/transport');

async function server(t, handler) {
  const instance = http.createServer(handler);
  const sockets = new Set();
  instance.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); instance.close(); });
  return 'http://127.0.0.1:' + instance.address().port;
}
const options = baseUrl => ({baseUrl, token: 'synthetic-test-token', path: '/api/chat/completions', body: {model: 'test', messages: [], stream: true}, timeoutMs: 1000, idleMs: 500});

test('URL rejects embedded credentials and unsupported schemes', () => {
  assert.equal(normalizeBaseUrl('https://studio.example/webui/'), 'https://studio.example/webui');
  for (const input of ['file:///tmp/test', 'https://user:pass@studio.example', 'https://studio.example?key=a', 'https://studio.example/#x', 'https://studio.example/\r\n']) {
    assert.throws(() => normalizeBaseUrl(input), {code: 'invalid_url'});
  }
});

test('posts JSON, preserves base path and reports bounded progress', async t => {
  let actual;
  const base = await server(t, (req, res) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { actual = {url: req.url, auth: req.headers.authorization, data: JSON.parse(data)}; res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); });
  });
  const progress = [];
  const result = await request({...options(base + '/webui'), onProgress: event => progress.push(event.phase)});
  assert.equal(result.status, 200);
  assert.equal(result.body, '{"ok":true}');
  assert.equal(actual.url, '/webui/api/chat/completions');
  assert.equal(actual.auth, 'Bearer synthetic-test-token');
  assert.equal(actual.data.model, 'test');
  assert.ok(progress.includes('uploaded') && progress.includes('headers') && progress.includes('receiving'));
});

test('DONE completes a streaming reply even when gateway keeps connection open', async t => {
  const base = await server(t, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write('data: {"choices":[{"index":0,"delta":{"content":"Ready"}}]}\n\n');
    res.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
    res.write('data: [DONE]\n\n');
  });
  const result = await request(options(base));
  assert.match(result.body, /\[DONE\]/);
});

test('all redirect statuses are rejected without a request to destination', async t => {
  let destinationCalls = 0;
  const destination = await server(t, (_req, res) => { destinationCalls++; res.end('wrong'); });
  for (const status of [301, 302, 303, 307, 308]) {
    let sourceCalls = 0;
    const source = await server(t, (_req, res) => { sourceCalls++; res.writeHead(status, {Location: destination + '/api/chat/completions'}); res.end(); });
    await assert.rejects(request(options(source)), {code: 'redirect_rejected'});
    assert.equal(sourceCalls, 1);
  }
  assert.equal(destinationCalls, 0);
});

test('timeouts and cancellation reject once without retry', async t => {
  let calls = 0;
  const base = await server(t, () => { calls++; });
  await assert.rejects(request({...options(base), idleMs: 30}), {code: 'response_idle_timeout'});
  await assert.rejects(request({...options(base), timeoutMs: 30}), {code: 'response_timeout'});
  const controller = new AbortController();
  const pending = request({...options(base), signal: controller.signal});
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending, {code: 'cancelled'});
  assert.equal(calls, 3);
});

test('abort before connection sends nothing', async t => {
  let calls = 0;
  const base = await server(t, () => { calls++; });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(request({...options(base), signal: controller.signal}), {code: 'cancelled'});
  assert.equal(calls, 0);
});

test('oversized and truncated responses do not resolve', async t => {
  const big = await server(t, (_req, res) => res.end('x'.repeat(512)));
  await assert.rejects(request({...options(big), maxBytes: 100}), {code: 'response_too_large'});
  const truncated = await server(t, (_req, res) => { res.writeHead(200, {'Content-Length': '100'}); res.write('partial'); setImmediate(() => res.destroy()); });
  await assert.rejects(request(options(truncated)), error => ['response_truncated', 'connection_failed'].includes(error.code));
});

test('HTTP errors and upstream text are not leaked', async t => {
  const base = await server(t, (_req, res) => { res.writeHead(500); res.end('secret upstream diagnostic'); });
  await assert.rejects(request(options(base)), error => error.code === 'http_500' && !error.message.includes('secret'));
});

test('model list retains IDs, handles names and removes duplicate entries', async t => {
  const base = await server(t, (_req, res) => res.end(JSON.stringify({data: [{id: 'one', name: 'First'}, {id: 'one'}, {id: 'two'}, {wrong: true}]})));
  assert.deepEqual(await listModels(options(base)), [{id: 'one', name: 'First'}, {id: 'two', name: 'two'}]);
});

test('invalid UTF-8 never reaches the model parser', async t => {
  const base = await server(t, (_req, res) => res.end(Buffer.from([0xc3, 0x28])));
  await assert.rejects(request(options(base)), {code: 'invalid_text'});
});
