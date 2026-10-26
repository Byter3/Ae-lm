'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {AssetStore,validateVisuals,items:visualItems} = require('./visuals');

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_TEXT = 1024 * 1024;
const STATUSES = ['proposed', 'rejected', 'running', 'completed', 'failed', 'unknown', 'cancelled'];

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw failure('history_invalid', label + ' must be an object.');
  }
}

function keys(value, permitted, label) {
  object(value, label);
  if (Object.keys(value).some(key => permitted.indexOf(key) < 0)) {
    throw failure('history_invalid', label + ' contains unsupported fields.');
  }
}

function string(value, label, maximum, allowEmpty) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.length)) {
    throw failure('history_invalid', label + ' must be a bounded string.');
  }
  return value;
}

function timestamp(value, label) {
  string(value, label, 40, false);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw failure('history_invalid', label + ' must be an ISO timestamp.');
  }
  return value;
}

function jsonValue(value, label) {
  let count = 0;
  function visit(item, depth) {
    if (++count > 50000 || depth > 32) throw failure('history_invalid', label + ' is too deeply nested.');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'string') return string(item, label, MAX_TEXT, true);
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(child => visit(child, depth + 1));
    if (item && typeof item === 'object') {
      const result = {};
      Object.keys(item).forEach(key => {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          throw failure('history_invalid', label + ' contains an unsafe object key.');
        }
        string(key, label + ' key', 512, true);
        result[key] = visit(item[key], depth + 1);
      });
      return result;
    }
    throw failure('history_invalid', label + ' must contain JSON values only.');
  }
  const clean = visit(value, 0);
  if (JSON.stringify(clean).length > MAX_TEXT) throw failure('history_invalid', label + ' is too large.');
  return clean;
}

function validateMessages(messages, options) {
  const opts = options || {};
  if (!Array.isArray(messages) || messages.length > 100000) {
    throw failure('history_invalid', 'History messages must be a bounded array.');
  }
  const clean = [];
  let pending = new Map();
  const known = new Set();
  function settlePending() {
    if (!pending.size) return;
    if (!opts.restore) throw failure('history_invalid', 'Tool requests must have paired results before the next message.');
    pending.forEach((call, id) => {
      const receipt = opts.receipts && opts.receipts.find(item => item.id === id);
      if (receipt && ['completed', 'failed', 'rejected', 'cancelled'].indexOf(receipt.status) >= 0 && 'result' in receipt) {
        clean.push({role: 'tool', tool_call_id: id, content: typeof receipt.result === 'string' ? receipt.result : JSON.stringify(receipt.result)});
        return;
      }
      const unknown = !receipt || ['unknown', 'running', 'completed', 'failed'].indexOf(receipt.status) >= 0;
      clean.push({role: 'tool', tool_call_id: id, content: JSON.stringify({
        ok: false,
        status: unknown ? 'unknown' : 'cancelled',
        error: unknown
          ? 'Execution outcome was not recorded before interruption. Do not replay this command; inspect current state first.'
          : 'This request was interrupted before a result was recorded. It was not replayed on restore.'
      })});
    });
    pending = new Map();
  }
  messages.forEach((message, index) => {
    keys(message, ['role', 'content', 'tool_calls', 'tool_call_id'], 'Message');
    if (['user', 'assistant', 'tool'].indexOf(message.role) < 0) throw failure('history_invalid', 'Unsupported message role.');
    if (message.role !== 'tool') settlePending();
    if (message.role === 'user') {
      if ('tool_calls' in message || 'tool_call_id' in message) throw failure('history_invalid', 'User messages cannot contain tool metadata.');
      clean.push({role: 'user', content: string(message.content, 'User content', MAX_TEXT, false)});
      return;
    }
    if (index === 0) throw failure('history_invalid', 'Conversation must begin with a user message.');
    if (message.role === 'tool') {
      if ('tool_calls' in message) throw failure('history_invalid', 'Tool results cannot request tools.');
      const id = string(message.tool_call_id, 'Tool result ID', 256, false);
      if (!pending.has(id)) throw failure('history_invalid', 'Tool result has no matching request, or is duplicated.');
      pending.delete(id);
      clean.push({role: 'tool', tool_call_id: id, content: string(message.content, 'Tool result', MAX_TEXT, true)});
      return;
    }
    if ('tool_call_id' in message) throw failure('history_invalid', 'Assistant messages cannot be tool results.');
    const content = message.content === null ? null : string(message.content, 'Assistant content', MAX_TEXT, true);
    const result = {role: 'assistant', content: content};
    if ('tool_calls' in message) {
      if (!Array.isArray(message.tool_calls) || message.tool_calls.length < 1 || message.tool_calls.length > 32) {
        throw failure('history_invalid', 'Tool requests must be a bounded nonempty array.');
      }
      result.tool_calls = message.tool_calls.map(call => {
        keys(call, ['id', 'type', 'function'], 'Tool request');
        const id = string(call.id, 'Tool request ID', 256, false);
        if (known.has(id)) throw failure('history_invalid', 'Tool request IDs must be unique.');
        known.add(id);
        if (call.type !== 'function') throw failure('history_invalid', 'Only function tools are supported.');
        keys(call.function, ['name', 'arguments'], 'Tool function');
        const name = string(call.function.name, 'Tool name', 128, false);
        if (!/^[A-Za-z0-9_-]+$/.test(name)) throw failure('history_invalid', 'Invalid tool name.');
        const argumentsText = string(call.function.arguments, 'Tool arguments', MAX_TEXT, true);
        let parsedArguments;
        try { parsedArguments = JSON.parse(argumentsText); } catch (_) {
          throw failure('history_invalid', 'Archived tool arguments must contain complete JSON.');
        }
        object(parsedArguments, 'Tool arguments');
        jsonValue(parsedArguments, 'Tool arguments');
        const entry = {id: id, type: 'function', function: {name: name, arguments: argumentsText}};
        pending.set(id, entry);
        return entry;
      });
    } else if (!content) {
      throw failure('history_invalid', 'Empty assistant messages require a tool request.');
    }
    clean.push(result);
  });
  if (opts.restore) settlePending();
  else if (pending.size && opts.allowPending === false) throw failure('history_invalid', 'Tool results are still pending.');
  return clean;
}

function validateArchive(value, options) {
  const opts = options || {};
  keys(value, ['schemaVersion', 'conversationId', 'createdAt', 'updatedAt', 'messages', 'receipts', 'visuals'], 'Archive');
  if (![1,2].includes(value.schemaVersion) || value.schemaVersion===1 && 'visuals' in value) throw failure('history_version', 'Unsupported Ae-lm history version. The original file has been preserved.');
  const archive = {
    schemaVersion: value.schemaVersion,
    conversationId: string(value.conversationId, 'Conversation ID', 256, false),
    createdAt: timestamp(value.createdAt, 'Creation date'),
    updatedAt: timestamp(value.updatedAt, 'Update date'),
    messages: [],
    receipts: []
  };
  if (!Array.isArray(value.receipts) || value.receipts.length > 100000) throw failure('history_invalid', 'Receipts must be a bounded array.');
  const ids = new Set();
  archive.receipts = value.receipts.map(receipt => {
    keys(receipt, ['id', 'title', 'source', 'kind', 'status', 'result', 'createdAt', 'startedAt', 'completedAt', 'sourceHash', 'targetProjectToken', 'error', 'authorization'], 'Receipt');
    const id = string(receipt.id, 'Receipt ID', 256, false);
    if (ids.has(id)) throw failure('history_invalid', 'Receipt IDs must be unique.');
    ids.add(id);
    if (['read', 'script', 'capture'].indexOf(receipt.kind) < 0 || STATUSES.indexOf(receipt.status) < 0) {
      throw failure('history_invalid', 'Invalid receipt kind or status.');
    }
    const result = {
      id: id,
      title: string(receipt.title, 'Receipt title', 4096, true),
      source: string(receipt.source, 'Receipt source', MAX_TEXT, true),
      kind: receipt.kind,
      status: opts.restore && receipt.status === 'running' ? 'unknown'
        : opts.restore && receipt.status === 'proposed' ? 'cancelled' : receipt.status,
      createdAt: timestamp(receipt.createdAt, 'Receipt creation date')
    };
    ['startedAt', 'completedAt'].forEach(key => { if (key in receipt) result[key] = timestamp(receipt[key], key); });
    ['sourceHash', 'targetProjectToken', 'error'].forEach(key => { if (key in receipt) result[key] = string(receipt[key], key, 4096, true); });
    if ('authorization' in receipt) {
      if (['manual', 'auto-run', 'viewport-access'].indexOf(receipt.authorization) < 0) throw failure('history_invalid', 'Invalid authorization receipt.');
      result.authorization = receipt.authorization;
    }
    if ('result' in receipt) result.result = jsonValue(receipt.result, 'Receipt result');
    return result;
  });
  archive.messages = validateMessages(value.messages, {restore: !!opts.restore, receipts: archive.receipts});
  if(value.schemaVersion===2){
    const callIds=new Set(archive.messages.flatMap(m=>(m.tool_calls||[]).filter(c=>c.function.name==='ae_capture_view').map(c=>c.id)));
    archive.visuals=validateVisuals(value.visuals,archive.messages.filter(m=>m.role==='user').length,callIds);
  }
  if (Buffer.byteLength(JSON.stringify(archive), 'utf8') > MAX_BYTES) throw failure('history_size', 'History exceeds the 50 MiB archive limit.');
  return archive;
}

function createArchive() {
  const now = new Date().toISOString();
  return {schemaVersion: 1, conversationId: crypto.randomBytes(16).toString('hex'), createdAt: now, updatedAt: now, messages: [], receipts: []};
}

function digest(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

function sidecarPath(projectPath) {
  if (projectPath === null || projectPath === undefined || projectPath === '') return null;
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath) || !/\.aepx?$/i.test(projectPath)) {
    throw failure('history_path', 'History needs an absolute saved .aep or .aepx project path.');
  }
  return path.join(path.dirname(projectPath), '.aelm', path.basename(projectPath) + '.json');
}

function regularFile(filePath, allowMissing) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw failure('history_path', 'History destination must be a regular file.');
    if (stat.size > MAX_BYTES) throw failure('history_size', 'History exceeds the 50 MiB archive limit.');
    return stat;
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return null;
    throw error;
  }
}

function readBytes(filePath) {
  if (!regularFile(filePath, true)) return null;
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(descriptor).size;
    if (size > MAX_BYTES) throw failure('history_size', 'History exceeds the 50 MiB archive limit.');
    const bytes = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const count = fs.readSync(descriptor, bytes, read, size - read, read);
      if (count === 0) break;
      read += count;
    }
    const extra = Buffer.alloc(1);
    if (read !== size || fs.readSync(descriptor, extra, 0, 1, size) !== 0) {
      throw failure('history_conflict', 'History changed while being read. Try reopening it.');
    }
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

function ensureDirectory(directory) {
  try { fs.mkdirSync(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure('history_path', 'The .aelm destination must be a directory, not a link.');
}

class HistoryStore {
  constructor() {
    this.assets = new AssetStore();
    this.path = null;
    this.baselineHash = null;
    this.archive = createArchive();
    this._saving = false;
  }

  bind(projectPath, options) {
    if (this._saving) throw failure('history_locked', 'Wait for the current history save before changing projects.');
    const opts = options || {};
    const target = sidecarPath(projectPath);
    let archive;
    let baselineHash = null;
    let status = target ? 'new' : 'unsaved';
    if (target) {
      const parent = path.dirname(target);
      if (fs.existsSync(parent)) {
        const stat = fs.lstatSync(parent);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure('history_path', 'The .aelm destination must be a directory, not a link.');
      }
      const bytes = readBytes(target);
      if (bytes) {
        if (opts.carry) throw failure('history_conflict', 'The Save As destination already has a history. It was not overwritten.');
        let parsed;
        try { parsed = JSON.parse(bytes.toString('utf8')); } catch (_) {
          throw failure('history_invalid', 'The history is not valid JSON. The original file has been preserved.');
        }
        archive = validateArchive(parsed, {restore: true});
        baselineHash = digest(bytes);
        status = 'loaded';
      }
    }
    if (!archive) archive = opts.carry ? validateArchive(opts.carry) : createArchive();
    if (opts.carry && target) status = 'carried';
    this.assets.bind(target,visualItems(archive),!!opts.carry);
    this.path = target;
    this.baselineHash = baselineHash;
    this.archive = archive;
    return {archive: archive, path: target, status: status};
  }

  _prepareSave(value) {
    if (this._saving) throw failure('history_locked', 'A history save is already in progress.');
    const archive = validateArchive(value);
    archive.updatedAt = new Date().toISOString();
    const bytes = Buffer.from(JSON.stringify(archive, null, 2) + '\n', 'utf8');
    if (bytes.length > MAX_BYTES) throw failure('history_size', 'History exceeds the 50 MiB archive limit.');
    if (!this.path) {
      this.archive = archive;
      return {result:{archive:archive,path:null,status:'unsaved'}};
    }
    const target = this.path;
    ensureDirectory(path.dirname(target));
    const lockPath = target + '.lock';
    let lock;
    try { lock = fs.openSync(lockPath, 'wx', 0o600); } catch (error) {
      if (error.code === 'EEXIST') throw failure('history_locked', 'Another writer or an interrupted save holds this history lock. The original history has been preserved.');
      throw error;
    }
    this._saving = true;
    const state = {target,lockPath,lock,temporary:target + '.' + crypto.randomBytes(8).toString('hex') + '.tmp',
      baselineHash:this.baselineHash,archive,bytes};
    try {
      this._checkSave(state);
      const fd = fs.openSync(state.temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      return state;
    } catch(error) { this._finishSave(state); throw error; }
  }

  _checkSave(state) {
    if (this.path !== state.target || this.baselineHash !== state.baselineHash) {
      throw failure('history_conflict', 'The history target changed while saving. It was not overwritten.');
    }
    const existing = readBytes(state.target);
    const actualHash = existing === null ? null : digest(existing);
    if (actualHash !== state.baselineHash) {
      throw failure('history_conflict', 'History changed outside this panel. It was not overwritten. Reopen the project history before continuing.');
    }
  }

  _saved(state) {
    this.baselineHash = digest(state.bytes);
    this.archive = state.archive;
    state.committed = true;
    state.result = {archive:state.archive,path:state.target,status:'saved'};
    return state.result;
  }

  _finishSave(state) {
    // Remove only our exclusive temporary file and lock; never unlink the target.
    // Cleanup failure cannot turn an already committed save into a failed save
    // or mask the original pre-commit error. A leftover lock remains protective.
    let cleanupFailed = false;
    try { fs.unlinkSync(state.temporary); } catch (error) { if(error.code!=='ENOENT')cleanupFailed=true; }
    try { fs.closeSync(state.lock); } catch (_) { cleanupFailed=true; }
    try { fs.unlinkSync(state.lockPath); } catch (error) { if(error.code!=='ENOENT')cleanupFailed=true; }
    this._saving = false;
    if (cleanupFailed && state.committed) {
      state.result.warning = 'History was saved, but temporary save-file cleanup failed. A remaining history lock may need attention before the next save.';
    }
  }

  save(value) {
    const state = this._prepareSave(value);
    if (state.result) return state.result;
    try {
      this._checkSave(state);
      fs.renameSync(state.temporary, state.target);
      return this._saved(state);
    } finally { this._finishSave(state); }
  }

  async saveAsync(value) {
    const state = this._prepareSave(value);
    if (state.result) return state.result;
    const delays = [50,100,200,400,800];
    try {
      for (let attempt=0; ; attempt++) {
        // Keep the same exclusive lock, but check for non-cooperating changes
        // again after every delay. Transient Windows sharing failures never
        // authorize overwriting a different baseline or deleting the target.
        this._checkSave(state);
        try {
          await new Promise((resolve,reject)=>fs.rename(state.temporary,state.target,error=>error?reject(error):resolve()));
          return this._saved(state);
        } catch(error) {
          if (['EPERM','EBUSY','EACCES'].indexOf(error.code)<0) throw error;
          if (attempt>=delays.length) {
            const failed=failure('history_write_failed','Windows kept the history file busy or denied replacement. The previous history is preserved. Close any program holding that JSON file, then retry.');
            failed.causeCode=error.code;
            throw failed;
          }
          await new Promise(resolve=>setTimeout(resolve,delays[attempt]));
        }
      }
    } finally { this._finishSave(state); }
  }

}

module.exports = {HistoryStore, createArchive, validateArchive, validateMessages, sidecarPath, MAX_BYTES};
