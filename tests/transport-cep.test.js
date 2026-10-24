'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {EventEmitter} = require('node:events');
const {URL: NodeURL} = require('node:url');

// CEP supplies browser and Node globals in the same extension. A browser URL
// exposes the web properties but lacks Node's private URL identity. This test
// exercises the real transport/HTTP client, not the UI's mocked transport.
class BrowserURL {
  constructor(value) { this._url = new NodeURL(value); }
  toString() { return this.href; }
}
for (const name of ['origin','protocol','hostname','port','pathname','username','password','search','hash','href']) {
  Object.defineProperty(BrowserURL.prototype, name, {get() { return this._url[name]; }});
}

function transportInBrowserContext() {
  const module = {exports:{}};
  const source = fs.readFileSync(path.join(__dirname, '../extension/lib/transport.js'), 'utf8');
  // Node 24 accepts foreign URL-like objects; CEP 12's Node 17.7.1 does not.
  // Preserve its overload + listener failure here before using real loopback
  // HTTP, so upgrading the test runner cannot hide the CEP regression again.
  // https://github.com/nodejs/node/blob/v17.7.1/lib/_http_client.js#L101-L121
  function legacyRequest(input, options, callback) {
    if (typeof input !== 'string' && !(input instanceof NodeURL)) {
      new EventEmitter().once('response', options);
    }
    return http.request(input, options, callback);
  }
  const compatibleRequire = name => name === 'http' ? {request:legacyRequest} : require(name);
  vm.runInNewContext(source, {module, exports:module.exports, require:compatibleRequire, URL:BrowserURL, Buffer, setTimeout, clearTimeout}, {filename:'transport-in-cep-context.js'});
  return module.exports;
}

test('model discovery and chat requests work with a browser URL global', async t => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      seen.push({path:req.url, method:req.method, auth:req.headers.authorization, body});
      res.setHeader('Content-Type', 'application/json');
      res.end(req.url.endsWith('/models') ? '{"data":[{"id":"studio-test"}]}' : '{"ok":true}');
    });
  });
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const transport = transportInBrowserContext();
  const connection = {baseUrl:'http://127.0.0.1:' + server.address().port + '/webui', token:'synthetic-cep-token', timeoutMs:1000};
  const models = await transport.listModels(connection);
  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'studio-test');
  const result = await transport.request({...connection, path:'/api/chat/completions', body:{model:'studio-test', messages:[]}});
  assert.equal(result.status, 200);
  assert.deepEqual(seen, [
    {path:'/webui/api/models', method:'GET', auth:'Bearer synthetic-cep-token', body:''},
    {path:'/webui/api/chat/completions', method:'POST', auth:'Bearer synthetic-cep-token', body:'{"model":"studio-test","messages":[]}'}
  ]);
});
