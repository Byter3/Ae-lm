'use strict';

// Optional, read-only compatibility with Hou-lm's local preferences and DPAPI
// format. No Houdini/Python installation or sibling source checkout is needed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {normalizeBaseUrl} = require('./transport');
const MAX_BLOB = 128 * 1024;
const LOGIN_ERROR = 'The saved Hou-lm login could not be read securely. Enter your Open WebUI key here, or save the login again in Hou-lm.';

function readBounded(file, maximum) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum) throw new Error('Invalid settings file.');
    const buffer = Buffer.alloc(maximum + 1);
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (count > maximum) throw new Error('Invalid settings file.');
    return buffer.subarray(0, count);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function readJson(file, maximum) {
  try {
    const value = JSON.parse(readBounded(file, maximum).toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) { return {}; }
}

function model(value) { return typeof value === 'string' && value.length <= 512 ? value : ''; }
function url(value) {
  try { return normalizeBaseUrl(value.trim()); } catch (_) { return ''; }
}

function houServer(value) {
  // Match Hou-lm's saved URL spelling for its hash/entropy, before WHATWG URL
  // canonicalizes host case, default ports, Unicode or path encoding for HTTP.
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  const match = /^(https?):\/\/([^/]+)(.*)$/i.exec(raw);
  if (!match || /[\s\\?#]/.test(raw) || /[@%]/.test(match[2]) ||
      match[3].split('/').some(part => part === '.' || part === '..') ||
      new URL(url(raw) || 'http://invalid').port === '0' || !url(raw)) return '';
  return match[1].toLowerCase() + '://' + match[2] + match[3].replace(/\/+$/, '');
}

function readSettings(options = {}) {
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const own = readJson(path.join(home, '.aelm-settings.json'), 8192);
  const houDirectory = env.HOULM_CONFIG_DIR || (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Hou-lm') : path.join(home, '.config', 'hou-lm'));
  const saved = readJson(path.join(houDirectory, 'preferences.json'), 16384);
  const credentialServer = houServer(saved.server_url);
  const houlm = credentialServer ? {baseUrl:url(credentialServer), model:model(saved.model_id), credentialServer} : null;
  const ownUrl = url(own.baseUrl);
  const maxCaptures = Number.isInteger(own.maxCaptures) && own.maxCaptures >= 1 && own.maxCaptures <= 50 ? own.maxCaptures : 12;
  if (ownUrl) return {baseUrl:ownUrl, model:model(own.model) || (houlm && houlm.baseUrl === ownUrl ? houlm.model : ''), source:'aelm', houlm, maxCaptures};
  if (houlm) return {baseUrl:houlm.baseUrl, model:houlm.model, source:'houlm', houlm, maxCaptures};
  return {baseUrl:'', model:'', source:'', houlm:null, maxCaptures};
}

// Fixed code only: neither URL nor credential data is interpolated into a
// command. Ciphertext and entropy go through stdin; plaintext returns through
// a private pipe, never argv, temporary files, diagnostics or project history.
const UNPROTECT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $cipher = [Convert]::FromBase64String($payload.data)
  $entropy = [Convert]::FromBase64String($payload.entropy)
  $plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($plain))
} catch { exit 1 }
finally { if ($plain) { [Array]::Clear($plain, 0, $plain.Length) } }
`;

function unprotectWindows(data, entropy, options = {}) {
  return new Promise((resolve, reject) => {
    const env = options.env || process.env;
    if ((options.platform || process.platform) !== 'win32' || !env.SystemRoot || !path.isAbsolute(env.SystemRoot)) {
      reject(new Error(LOGIN_ERROR)); return;
    }
    const executable = path.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    try {
      const child = require('child_process').execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', UNPROTECT],
        {windowsHide:true, timeout:5000, maxBuffer:MAX_BLOB * 2, encoding:'utf8'}, (error, stdout) => {
          if (error || !/^[A-Za-z0-9+/]+={0,2}$/.test(stdout) || stdout.length > MAX_BLOB * 2) {
            reject(new Error(LOGIN_ERROR)); return;
          }
          const result = Buffer.from(stdout, 'base64');
          if (!result.length || result.length > MAX_BLOB) { result.fill(0); reject(new Error(LOGIN_ERROR)); return; }
          resolve(result);
        });
      child.stdin.on('error', () => { /* execFile completion reports failure without echoing input. */ });
      child.stdin.end(JSON.stringify({data:data.toString('base64'), entropy:entropy.toString('base64')}));
    } catch (_) { reject(new Error(LOGIN_ERROR)); }
  });
}

async function loadHouToken(houlm, selectedUrl, options = {}) {
  const env = options.env || process.env;
  if (!houlm || !houlm.baseUrl || url(selectedUrl) !== houlm.baseUrl) return '';
  if ((options.platform || process.platform) !== 'win32') return '';
  let plaintext;
  try {
    const server = houServer(houlm.credentialServer);
    if (!server || url(server) !== houlm.baseUrl || !env.LOCALAPPDATA || !path.isAbsolute(env.LOCALAPPDATA)) throw new Error(LOGIN_ERROR);
    const filename = crypto.createHash('sha256').update(server, 'utf8').digest('hex') + '.dpapi';
    const file = path.join(env.LOCALAPPDATA, 'Hou-lm', 'credentials', filename);
    let blob;
    try { blob = readBounded(file, MAX_BLOB); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
    const magic = Buffer.from('HOULM-DPAPI\x01\x00', 'binary');
    if (blob.length <= magic.length || !blob.subarray(0, magic.length).equals(magic)) throw new Error(LOGIN_ERROR);
    const entropy = crypto.createHash('sha256').update('Hou-lm credential v1\0', 'utf8').update(server, 'utf8').digest();
    const decrypt = options.decrypt || unprotectWindows;
    plaintext = await decrypt(blob.subarray(magic.length), entropy, options);
    if (!Buffer.isBuffer(plaintext) || plaintext.length > MAX_BLOB) throw new Error(LOGIN_ERROR);
    const envelope = JSON.parse(plaintext.toString('utf8'));
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
        Object.keys(envelope).sort().join(',') !== 'key,server,version' || envelope.version !== 1 ||
        envelope.server !== server || typeof envelope.key !== 'string' ||
        !/^[\x21-\x7e]{1,8192}$/.test(envelope.key)) throw new Error(LOGIN_ERROR);
    return envelope.key;
  } catch (_) { throw new Error(LOGIN_ERROR); }
  finally { if (Buffer.isBuffer(plaintext)) plaintext.fill(0); }
}

module.exports = {readSettings, loadHouToken, unprotectWindows};
