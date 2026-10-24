'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {readSettings, loadHouToken} = require('../extension/lib/settings');

const SERVER = 'https://studio.example/webui';
const TOKEN = 'synthetic-unit-test-token';
const MAGIC = Buffer.from('HOULM-DPAPI\x01\x00', 'binary');
const CIPHER = Buffer.from('synthetic-ciphertext-not-a-real-credential');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aelm-settings-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const home = path.join(root, 'home');
  const local = path.join(root, 'local');
  fs.mkdirSync(home, {recursive: true});
  fs.mkdirSync(local, {recursive: true});
  const env = {LOCALAPPDATA: local};
  const write = (filename, value) => {
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    fs.writeFileSync(filename, Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value));
  };
  return {
    root, home, local, env, write,
    own: value => write(path.join(home, '.aelm-settings.json'), value),
    hou: value => write(path.join(env.HOULM_CONFIG_DIR || path.join(local, 'Hou-lm'), 'preferences.json'), value),
    read: () => readSettings({home, env}),
    blob: (server = SERVER, body = Buffer.concat([MAGIC, CIPHER])) => {
      const filename = path.join(local, 'Hou-lm', 'credentials', crypto.createHash('sha256').update(server, 'utf8').digest('hex') + '.dpapi');
      write(filename, body);
      return filename;
    }
  };
}

function envelope(server = SERVER, key = TOKEN) {
  return Buffer.from(JSON.stringify({version: 1, server, key}), 'utf8');
}

function assertSafeError(error, sensitive = TOKEN) {
  assert.ok(error instanceof Error);
  assert.ok(error.message.length < 300);
  assert.ok(!error.message.includes(sensitive));
  return true;
}

test('missing files return empty preferences without creating files', t => {
  const f = fixture(t);
  assert.deepEqual(f.read(), {baseUrl: '', model: '', source: '', houlm: null});
  assert.deepEqual(fs.readdirSync(f.home), []);
  assert.deepEqual(fs.readdirSync(f.local), []);
});

test('Hou-lm supplies URL and model only, never approval or plaintext token fields', t => {
  const f = fixture(t);
  f.hou({server_url: SERVER + '/', model_id: 'studio-test', auto_run_commands: true,
    response_wait_minutes: 30, token: TOKEN, key: TOKEN, history: [{role: 'user', content: 'private'}]});
  assert.deepEqual(f.read(), {baseUrl: SERVER, model: 'studio-test', source: 'houlm',
    houlm: {baseUrl: SERVER, model: 'studio-test', credentialServer: SERVER}});
  assert.ok(!JSON.stringify(f.read()).includes(TOKEN));
});

test('valid Ae-lm preferences win without importing a model from another service', t => {
  const f = fixture(t);
  f.hou({server_url: SERVER, model_id: 'hou-model'});
  f.own({baseUrl: 'https://ae.example', model: 'ae-model', autoRun: true, token: TOKEN});
  const settings = f.read();
  assert.equal(settings.source, 'aelm');
  assert.equal(settings.baseUrl, 'https://ae.example');
  assert.equal(settings.model, 'ae-model');
  assert.equal(settings.houlm.baseUrl, SERVER);
  assert.ok(!JSON.stringify(settings).includes(TOKEN));
  f.own({baseUrl: 'https://ae.example'});
  assert.equal(f.read().model, '');
});

test('same-service own URL without a model inherits the Hou-lm model', t => {
  const f = fixture(t);
  f.hou({server_url: SERVER, model_id: 'hou-model'});
  f.own({baseUrl: SERVER + '/'});
  assert.equal(f.read().source, 'aelm');
  assert.equal(f.read().model, 'hou-model');
});

test('invalid or oversized own settings fall back to valid Hou-lm settings', t => {
  const f = fixture(t);
  f.hou({server_url: SERVER, model_id: 'hou-model'});
  for (const bad of ['{broken', '[]', 'null', {baseUrl: 'file:///private', model: 'bad'},
    {baseUrl: SERVER, model: 'bad', ignored: 'x'.repeat(8192)}]) {
    f.own(bad);
    assert.equal(f.read().source, 'houlm');
    assert.equal(f.read().model, 'hou-model');
  }
});

test('invalid, malformed and oversized Hou-lm preferences are ignored', t => {
  const f = fixture(t);
  for (const bad of ['{broken', '[]', 'null', {server_url: 'file:///private'},
    {server_url: SERVER, ignored: 'x'.repeat(16384)}]) {
    f.hou(bad);
    assert.equal(f.read().source, '');
    assert.equal(f.read().houlm, null);
  }
});

test('unusable model fields never enter the settings result', t => {
  const f = fixture(t);
  for (const bad of [null, 42, {}, ['model'], 'm'.repeat(513)]) {
    f.hou({server_url: SERVER, model_id: bad});
    assert.equal(f.read().model, '');
    f.own({baseUrl: 'https://ae.example', model: bad});
    assert.equal(f.read().model, '');
    fs.unlinkSync(path.join(f.home, '.aelm-settings.json'));
  }
});

test('Hou config-directory override affects preferences, not credential storage', async t => {
  const f = fixture(t);
  f.env.HOULM_CONFIG_DIR = path.join(f.root, 'studio-config');
  f.hou({server_url: SERVER, model_id: 'override-model'});
  f.blob();
  const settings = f.read();
  assert.equal(settings.model, 'override-model');
  assert.equal(await loadHouToken(settings.houlm, SERVER, {env: f.env, platform: 'win32', decrypt: async () => envelope()}), TOKEN);
  assert.deepEqual(fs.readdirSync(f.env.HOULM_CONFIG_DIR), ['preferences.json']);
});

test('non-Windows preference fallback reads the user config path without credentials', async t => {
  const f = fixture(t);
  delete f.env.LOCALAPPDATA;
  f.write(path.join(f.home, '.config', 'hou-lm', 'preferences.json'), {server_url: SERVER, model_id: 'fallback-model'});
  const settings = f.read();
  assert.equal(settings.model, 'fallback-model');
  let calls = 0;
  assert.equal(await loadHouToken(settings.houlm, SERVER, {env: f.env, platform: 'darwin', decrypt: async () => {calls++; return envelope();}}), '');
  assert.equal(calls, 0);
});

test('saved login uses exact Hou URL identity for filename, entropy and envelope', async t => {
  const f = fixture(t);
  const exact = 'https://Studio.Example:443/webui';
  f.hou({server_url: '  ' + exact + '/  ', model_id: 'test-model'});
  const blobPath = f.blob(exact);
  const before = fs.readFileSync(blobPath);
  const settings = f.read();
  assert.equal(settings.houlm.credentialServer, exact);
  assert.equal(settings.baseUrl, SERVER);
  let calls = 0;
  const token = await loadHouToken(settings.houlm, SERVER, {env: f.env, platform: 'win32', decrypt: async (cipher, entropy) => {
    calls++;
    assert.deepEqual(cipher, CIPHER);
    assert.deepEqual(entropy, crypto.createHash('sha256').update(Buffer.from('Hou-lm credential v1\x00')).update(exact, 'utf8').digest());
    return envelope(exact);
  }});
  assert.equal(token, TOKEN);
  assert.equal(calls, 1);
  assert.deepEqual(fs.readFileSync(blobPath), before);
  assert.deepEqual(fs.readdirSync(f.home), []);
});

test('foreign endpoint, scheme, port or base path never triggers credential decryption', async t => {
  const f = fixture(t);
  f.hou({server_url: SERVER, model_id: 'test-model'});
  f.blob();
  const settings = f.read();
  let calls = 0;
  const decrypt = async () => {calls++; return envelope();};
  for (const foreign of ['https://other.example/webui', 'http://studio.example/webui',
    'https://studio.example:444/webui', 'https://studio.example/other',
    'https://studio.example/webui/child', 'https://studio.example/webui?key=bad',
    'https://attacker@studio.example/webui', 'file:///private']) {
    assert.equal(await loadHouToken(settings.houlm, foreign, {env: f.env, platform: 'win32', decrypt}), '');
  }
  assert.equal(calls, 0);
});

test('missing credentials and missing inherited settings require no decrypt operation', async t => {
  const f = fixture(t);
  f.hou({server_url: SERVER});
  let calls = 0;
  const options = {env: f.env, platform: 'win32', decrypt: async () => {calls++; return envelope();}};
  assert.equal(await loadHouToken(f.read().houlm, SERVER, options), '');
  assert.equal(await loadHouToken(null, SERVER, options), '');
  assert.equal(calls, 0);
});

test('invalid magic, empty data and oversized ciphertext reject before decryption', async t => {
  const f = fixture(t);
  f.hou({server_url: SERVER});
  const settings = f.read();
  let calls = 0;
  for (const blob of [Buffer.alloc(0), Buffer.from('not-DPAPI'), MAGIC, Buffer.concat([MAGIC, Buffer.alloc(128 * 1024)])]) {
    f.blob(SERVER, blob);
    await assert.rejects(loadHouToken(settings.houlm, SERVER, {env: f.env, platform: 'win32', decrypt: async () => {calls++; return envelope();}}), assertSafeError);
  }
  assert.equal(calls, 0);
});

test('decryption errors do not expose upstream exception text', async t => {
  const f = fixture(t);
  f.hou({server_url: SERVER});
  f.blob();
  const marker = 'sensitive-path-or-token-never-show-this';
  await assert.rejects(loadHouToken(f.read().houlm, SERVER, {env: f.env, platform: 'win32', decrypt: async () => {throw new Error(marker);}}), error => assertSafeError(error, marker));
});

test('decrypted envelopes require the exact version, URL and field allowlist', async t => {
  const f = fixture(t);
  f.hou({server_url: SERVER});
  f.blob();
  const wrong = [null, [], {version: '1', server: SERVER, key: TOKEN},
    {version: 2, server: SERVER, key: TOKEN}, {version: 1, server: 'https://other.example', key: TOKEN},
    {version: 1, server: SERVER + '/', key: TOKEN}, {version: 1, server: SERVER},
    {version: 1, server: SERVER, key: TOKEN, autoRun: true}];
  for (const value of wrong) {
    await assert.rejects(loadHouToken(f.read().houlm, SERVER, {env: f.env, platform: 'win32', decrypt: async () => Buffer.from(JSON.stringify(value))}), assertSafeError);
  }
  for (const value of [Buffer.from('{broken'), Buffer.from([0xff, 0xfe])]) {
    await assert.rejects(loadHouToken(f.read().houlm, SERVER, {env: f.env, platform: 'win32', decrypt: async () => value}), assertSafeError);
  }
});

test('decrypted keys must be bounded nonempty printable ASCII without spaces', async t => {
  const f = fixture(t);
  f.hou({server_url: SERVER});
  f.blob();
  for (const key of ['', null, 42, 'contains space', 'line\nbreak', '\u007f', '\u00e9', 'x'.repeat(8193)]) {
    await assert.rejects(loadHouToken(f.read().houlm, SERVER, {env: f.env, platform: 'win32', decrypt: async () => envelope(SERVER, key)}), assertSafeError);
  }
});

test('copied ciphertext from another server cannot supply that server key', async t => {
  const f = fixture(t);
  const other = 'https://second.example/webui';
  f.hou({server_url: other});
  f.blob(other);
  const originalEntropy = crypto.createHash('sha256').update(Buffer.from('Hou-lm credential v1\x00')).update(SERVER, 'utf8').digest();
  await assert.rejects(loadHouToken(f.read().houlm, other, {env: f.env, platform: 'win32', decrypt: async (_cipher, entropy) => {
    assert.notDeepEqual(entropy, originalEntropy);
    throw new Error('Synthetic DPAPI rejects ciphertext with other entropy');
  }}), assertSafeError);
  // Even a faulty decrypt adapter cannot bypass the plaintext server binding.
  await assert.rejects(loadHouToken(f.read().houlm, other, {env: f.env, platform: 'win32', decrypt: async () => envelope(SERVER)}), assertSafeError);
});
