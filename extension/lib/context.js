'use strict';

const {validateMessages} = require('./history');

const COMPACTED_NOTE = 'Earlier conversation turns were omitted to fit this request. The full archive remains local. Do not guess omitted details or claim old observations are current; use retained exact results or request a fresh bounded inspection.';
const RESULT_NOTE = 'Some large tool results contain _aelmContext / _aelmOmitted partial-data markers added by the client for this request only. Omitted values are unknown, not empty or verified. Exact scripts, outcome metadata and full results remain in local receipts. Never repeat a completed script to recover omitted output; inspect only the missing properties with a smaller read if needed.';

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

// Deterministic previews, never model-written summaries. All changes are made to
// a parsed request copy; the archive and execution receipts stay exact.
function preview(value, profile, depth) {
  if (JSON.stringify(value).length <= profile.inline) return value;
  if (typeof value === 'string') return {_aelmOmitted:'string', originalCharacters:value.length, preview:value.slice(0, profile.text)};
  if (Array.isArray(value)) {
    const count = depth ? Math.min(value.length, profile.items) : 0;
    return {_aelmOmitted:'array', totalItems:value.length, omittedItems:value.length-count,
      preview:value.slice(0,count).map(item=>preview(item,profile,depth-1))};
  }
  if (object(value)) {
    const keys=Object.keys(value), selected=depth ? keys.slice(0,profile.fields) : [];
    const sample=Object.create(null);
    selected.forEach(key=>{sample[key]=preview(value[key],profile,depth-1);});
    return {_aelmOmitted:'object', totalFields:keys.length, omittedFields:keys.length-selected.length, preview:sample};
  }
  return value;
}

function* toolResultPreviews(content) {
  let original;
  try { original=JSON.parse(content); } catch (_) { return; }
  // Do not guess the meaning of arbitrary or failed results. In particular,
  // error messages and possiblyModified/unknown outcomes are never shortened.
  if (!object(original) || original.ok!==true || !object(original.data) || '_aelmContext' in original) return;
  const data=original.data;
  let fields;
  if (data.execution==='completed' && typeof data.id==='string' && 'result' in data) fields=['result'];
  else if (['project','activeComp','comp','layer'].includes(data.scope) && !('execution' in data)) fields=['items','layers','properties','property'];
  else return;
  fields=fields.filter(key=>key in data && JSON.stringify(data[key]).length>512);
  if (!fields.length) return;
  const profiles=[
    {inline:512,text:600,items:8,fields:16,depth:6},
    {inline:256,text:200,items:4,fields:8,depth:4},
    {inline:80,text:80,items:2,fields:4,depth:2},
    {inline:0,text:0,items:0,fields:0,depth:0}
  ];
  for (const profile of profiles) {
    const reduced=Object.assign({}, original, {data:Object.assign({},data)});
    fields.forEach(key=>{reduced.data[key]=preview(data[key],profile,profile.depth);});
    reduced._aelmContext={partial:true,originalCharacters:content.length,
      note:'Large result data shortened for this model request only. Full result is in the local receipt. Omitted values are unknown; use a smaller inspection if needed. Do not repeat completed scripts.'};
    const serialized=JSON.stringify(reduced);
    if (serialized.length<content.length) yield serialized;
  }
}

function buildContext(messages, options) {
  const opts = options || {};
  const system = opts.system === undefined ? '' : opts.system;
  const maxChars = opts.maxChars === undefined ? 96000 : opts.maxChars;
  if (typeof system !== 'string' || !Number.isSafeInteger(maxChars) || maxChars < 1) {
    throw new TypeError('Context needs a system string and a positive integer character budget.');
  }
  const clean = validateMessages(messages, {allowPending: false});
  const turns = [];
  clean.forEach(message => {
    if (message.role === 'user') turns.push([]);
    if (!turns.length) throw new Error('Context must begin with a user message.');
    turns[turns.length - 1].push(message);
  });
  let removed = 0;
  const shortened = new Set();
  let result;
  let characters;
  function assemble() {
    const instructions = system + (removed ? '\n\n' + COMPACTED_NOTE : '') + (shortened.size ? '\n\n' + RESULT_NOTE : '');
    result = [{role: 'system', content: instructions}].concat(...turns);
    characters = JSON.stringify(result).length;
  }
  assemble();
  while (characters > maxChars && turns.length > 1) {
    turns.shift();
    removed += 1;
    assemble();
  }
  // An individual legal host reply can be larger than the whole context budget.
  // Reduce bulky data oldest-first only under pressure, keeping every exact
  // call/source and its paired outcome. Preserve the newest exact result if it fits.
  const active=turns.length ? turns[0] : [];
  for (const message of active) {
    if (characters<=maxChars) break;
    if (message.role!=='tool') continue;
    for (const reduced of toolResultPreviews(message.content)) {
      if (reduced.length>=message.content.length) continue;
      message.content=reduced;
      shortened.add(message.tool_call_id);
      assemble();
      if (characters<=maxChars) break;
    }
  }
  if (characters > maxChars) {
    const error = new Error('This task still exceeds the model context budget after reducing large result data. Send a smaller next request; completed commands remain recorded and will not be replayed.');
    error.code = 'context_limit';
    throw error;
  }
  return {messages: result, compacted: removed > 0 || shortened.size > 0, characters: characters, removedTurns: removed, compactedResults:shortened.size};
}

module.exports = {buildContext, COMPACTED_NOTE};
