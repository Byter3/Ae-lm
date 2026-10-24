'use strict';

const http = require('http');
const https = require('https');
const {TextDecoder} = require('util');
const {URL} = require('url');

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) {
    throw failure('invalid_url', 'Enter a valid studio service URL.');
  }
  let url;
  try { url = new URL(value); } catch (_) { throw failure('invalid_url', 'Enter a valid studio service URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw failure('invalid_url', 'Use an HTTP or HTTPS service URL without credentials, query or fragment.');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

// Authentication stays in memory. This transport never follows a redirect or
// retries a request: either action could send credentials or duplicate work.
function request(options) {
  return new Promise((resolve, reject) => {
    let url, data;
    try {
      const base = normalizeBaseUrl(options.baseUrl);
      if (typeof options.path !== 'string' || !/^\/api\/[a-zA-Z0-9/_-]+$/.test(options.path)) {
        throw failure('invalid_path', 'The requested service endpoint is invalid.');
      }
      if (typeof options.token !== 'string' || !options.token.trim() || /[^\x21-\x7e]/.test(options.token) || options.token.length > 16384) {
        throw failure('invalid_token', 'Enter a valid Open WebUI user API key or session token.');
      }
      url = new URL(base + options.path);
      data = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body), 'utf8');
      if (data && data.length > 4 * 1024 * 1024) throw failure('request_too_large', 'The model request exceeds the local request limit.');
    } catch (error) {
      reject(error.code ? error : failure('invalid_request', 'The service request is invalid.'));
      return;
    }

    const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
    const timeoutMs = positive(options.timeoutMs, 180000);
    const idleMs = positive(options.idleMs, 60000);
    const maxBytes = Math.min(positive(options.maxBytes, 4 * 1024 * 1024), 4 * 1024 * 1024);
    const started = Date.now();
    let finished = false, bytes = 0, req, res, totalTimer, idleTimer;
    const chunks = [];
    const notify = (phase, status) => {
      if (typeof options.onProgress === 'function') {
        try { options.onProgress({phase, bytes, elapsedMs: Date.now() - started, status}); } catch (_) { /* UI callbacks cannot break transport cleanup. */ }
      }
    };
    const cleanup = () => {
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
    };
    const fail = (code, message) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (res) res.destroy();
      if (req) req.destroy();
      reject(failure(code, message));
    };
    const onAbort = () => fail('cancelled', 'Request cancelled. Completed host commands were not undone or replayed.');
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fail('response_idle_timeout', 'The service stopped sending data. This request was not retried.'), idleMs);
    };
    if (options.signal && options.signal.aborted) { onAbort(); return; }
    if (options.signal) options.signal.addEventListener('abort', onAbort, {once: true});
    totalTimer = setTimeout(() => fail('response_timeout', 'The service request reached its time limit. This request was not retried.'), timeoutMs);
    resetIdle();
    notify('connecting');
    const headers = {Accept: 'text/event-stream, application/json', Authorization: 'Bearer ' + options.token, 'Accept-Encoding': 'identity'};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    try {
      // CEP has browser and Node URL constructors. Node 17 misinterprets a
      // browser URL object as request options; use a string at this boundary.
      req = (url.protocol === 'https:' ? https : http).request(url.href, {
        method: data ? 'POST' : 'GET', headers, agent: false
      }, incoming => {
        res = incoming;
        if (finished) { incoming.destroy(); return; }
        resetIdle();
        notify('headers', incoming.statusCode);
        if (incoming.statusCode >= 300 && incoming.statusCode < 400) {
          fail('redirect_rejected', 'The service redirected this request. Use its final base URL; credentials were not forwarded.');
          return;
        }
        if (incoming.statusCode < 200 || incoming.statusCode >= 300) {
          fail('http_' + incoming.statusCode, 'The service returned HTTP ' + incoming.statusCode + '. Check the connection and account settings.');
          return;
        }
        if (incoming.headers['content-encoding'] && incoming.headers['content-encoding'] !== 'identity') {
          fail('unsupported_encoding', 'The service returned an unsupported compressed response.');
          return;
        }
        const declared = Number(incoming.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) { fail('response_too_large', 'The service response exceeds the local size limit.'); return; }
        const succeed = () => {
          if (finished) return;
          let body;
          try { body = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)); }
          catch (_) { fail('invalid_text', 'The service returned invalid UTF-8 data. No tools from it were executed.'); return; }
          finished = true;
          cleanup();
          resolve({status: incoming.statusCode, headers: incoming.headers, body});
        };
        let eventTail = '';
        incoming.on('data', chunk => {
          if (finished) return;
          bytes += chunk.length;
          if (bytes > maxBytes) { fail('response_too_large', 'The service response exceeds the local size limit.'); return; }
          chunks.push(chunk);
          resetIdle();
          notify('receiving', incoming.statusCode);
          // SSE has its own terminal marker. Some gateways keep the HTTP
          // connection open after it; do not wait for EOF once DONE arrives.
          // The protocol parser still validates the terminal reason and tools.
          if (/text\/event-stream/i.test(incoming.headers['content-type'] || '')) {
            const scan = eventTail + chunk.toString('utf8');
            eventTail = scan.slice(-64);
            if (/(?:^|\n)data: ?\[DONE\]\s*(?:\n|$)/.test(scan)) {
              succeed();
              incoming.destroy();
            }
          }
        });
        incoming.on('aborted', () => fail('response_truncated', 'The service connection ended before the response was complete.'));
        incoming.on('error', () => fail('response_failed', 'The service response could not be read.'));
        incoming.on('end', () => {
          if (finished) return;
          if (!incoming.complete) { fail('response_truncated', 'The service connection ended before the response was complete.'); return; }
          succeed();
        });
      });
      req.on('error', () => fail('connection_failed', 'Could not complete the studio service connection. Check the URL, certificate and service availability.'));
      req.on('finish', () => { if (!finished) notify('uploaded'); });
      req.end(data);
    } catch (_) { fail('connection_failed', 'Could not start the studio service connection.'); }
  });
}

async function listModels(options) {
  const response = await request(Object.assign({}, options, {path: '/api/models', body: undefined}));
  let value;
  try { value = JSON.parse(response.body); } catch (_) { throw failure('invalid_models', 'The service did not return a valid model list.'); }
  const data = Array.isArray(value) ? value : value && value.data;
  if (!Array.isArray(data) || data.length > 5000) throw failure('invalid_models', 'The service did not return a valid model list.');
  const ids = new Set();
  const models = [];
  for (const item of data) {
    if (item && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 256 && !ids.has(item.id)) {
      ids.add(item.id);
      models.push({id: item.id, name: typeof item.name === 'string' ? item.name.slice(0, 256) : item.id});
    }
  }
  return models;
}

module.exports = {request, listModels, normalizeBaseUrl};
