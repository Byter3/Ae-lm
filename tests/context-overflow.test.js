'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {buildContext} = require('../extension/lib/context');
const {validateMessages, HistoryStore} = require('../extension/lib/history');
const {Controller} = require('../extension/lib/controller');

const identity = {projectToken: 'synthetic-project-1', projectPath: null, hostVersion: '25.6'};
const verification = 'Execution returned. Inspect authored state separately to verify the intended change.';

function scriptCall(id, source) {
  return {id, type: 'function', function: {name: 'ae_run_script', arguments: JSON.stringify({
    title: 'Read bounded authored parameters', source: source || 'return {read: true};'
  })}};
}

function scriptResult(id, result) {
  return {ok: true, data: {id, execution: 'completed', identity: {...identity}, verification, result}};
}

function batch(calls, results) {
  return [{role: 'assistant', content: 'I will inspect the relevant authored parameters.', tool_calls: calls}]
    .concat(results.map((result, index) => ({role: 'tool', tool_call_id: calls[index].id, content: JSON.stringify(result)})));
}

function turn(calls, results) {
  return [{role: 'user', content: 'Refine the existing composition after inspecting it. Do not render.'}].concat(batch(calls, results));
}

function tool(messages, id) {
  return messages.find(message => message.role === 'tool' && message.tool_call_id === id);
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

function assertBounded(context, maxChars) {
  assert.equal(context.characters, JSON.stringify(context.messages).length);
  assert.ok(context.characters <= maxChars, 'serialized model messages remain inside the character budget');
  validateMessages(context.messages.slice(1), {allowPending: false});
}

test('a legal host reply larger than the remaining default budget continues with a partial request copy', () => {
  const source = '/*' + 'source '.repeat(450) + '*/ return {read: true};';
  const result = scriptResult('large-1', {parameters: 'p'.repeat(97000)});
  assert.ok(JSON.stringify(result).length < 100000, 'fixture fits the native host reply limit');
  const messages = freeze(turn([scriptCall('large-1', source)], [result]));
  const original = JSON.stringify(messages);
  const context = buildContext(messages, {system: 'Use recorded results; never replay commands.'});
  assertBounded(context, 96000);
  assert.equal(context.compacted, true);
  assert.equal(context.compactedResults, 1);
  assert.deepEqual(context.messages[2].tool_calls, messages[1].tool_calls, 'exact source and command identity are retained');
  const reduced = JSON.parse(tool(context.messages, 'large-1').content);
  assert.equal(reduced._aelmContext.partial, true);
  assert.equal(reduced._aelmContext.originalCharacters, messages[2].content.length);
  assert.equal(typeof reduced._aelmContext.note, 'string');
  assert.equal(reduced.ok, result.ok);
  for (const key of ['id', 'execution', 'identity', 'verification']) assert.deepEqual(reduced.data[key], result.data[key]);
  assert.equal(JSON.stringify(messages), original, 'full local history is unchanged');
});

test('exact result data is untouched when it fits, including at the exact budget boundary', () => {
  const messages = turn([scriptCall('exact-1')], [scriptResult('exact-1', {parameters: 'p'.repeat(40000)})]);
  const complete = buildContext(messages, {system: 'AE assistant'});
  const context = buildContext(messages, {system: 'AE assistant', maxChars: complete.characters});
  assert.deepEqual(context.messages.slice(1), messages);
  assert.equal(context.compacted, false);
  assert.equal(context.compactedResults, 0);
});

test('older complete turns are removed before reducing an active result that can fit exactly', () => {
  const old = [{role: 'user', content: 'Earlier request ' + 'x'.repeat(40000)}, {role: 'assistant', content: 'Earlier answer.'}];
  const current = turn([scriptCall('current-1')], [scriptResult('current-1', {parameters: 'p'.repeat(70000)})]);
  const context = buildContext(old.concat(current), {system: 'AE assistant'});
  assertBounded(context, 96000);
  assert.equal(context.removedTurns, 1);
  assert.equal(context.compactedResults, 0);
  assert.deepEqual(context.messages.slice(1), current);
});

test('two large current-turn reads reduce the older result while keeping the newest exact', () => {
  const first = scriptResult('older-read', {parameters: 'a'.repeat(60000)});
  const latest = scriptResult('newer-read', {parameters: 'b'.repeat(60000)});
  const messages = turn([scriptCall('older-read'), scriptCall('newer-read')], [first, latest]);
  const context = buildContext(messages, {system: 'AE assistant'});
  assertBounded(context, 96000);
  assert.equal(context.removedTurns, 0);
  assert.equal(context.compactedResults, 1);
  assert.equal(JSON.parse(tool(context.messages, 'older-read').content)._aelmContext.partial, true);
  assert.equal(tool(context.messages, 'newer-read').content, tool(messages, 'newer-read').content);
  assert.deepEqual(context.messages[2].tool_calls, messages[1].tool_calls);
});

test('inspection result reduction retains target, observation and pagination metadata', () => {
  const calls = ['inspect-old', 'inspect-new'].map(id => ({id, type: 'function', function: {
    name: 'ae_inspect', arguments: JSON.stringify({scope: 'layer', compId: 7, layerIndex: 3, offset: 0, limit: 40})
  }}));
  const read = {ok: true, data: {
    identity: {...identity}, observation: 'Authored state; no render or preview requested.', scope: 'layer',
    comp: {id: 7, name: 'Test composition'}, layer: {index: 3, name: 'Existing ring'},
    offset: 0, limit: 40, total: 60, hasMore: true,
    properties: Array.from({length: 40}, (_, index) => ({index: index + 1, name: 'Property ' + index, expression: 'x'.repeat(1500)}))
  }};
  const messages = turn(calls, [read, read]);
  const context = buildContext(messages, {system: 'AE assistant'});
  assertBounded(context, 96000);
  const reduced = JSON.parse(tool(context.messages, 'inspect-old').content);
  assert.equal(reduced._aelmContext.partial, true);
  for (const key of ['identity', 'observation', 'scope', 'comp', 'layer', 'offset', 'limit', 'total', 'hasMore']) {
    assert.deepEqual(reduced.data[key], read.data[key]);
  }
  assert.equal(tool(context.messages, 'inspect-new').content, tool(messages, 'inspect-new').content);
});

test('older previews are reduced further before sacrificing a newest result that can still fit exactly', () => {
  const first = scriptResult('older-detailed', Array.from({length: 8}, () => 'a'.repeat(8000)));
  const latest = scriptResult('newest-detailed', 'b'.repeat(91000));
  const messages = turn([scriptCall('older-detailed'), scriptCall('newest-detailed')], [first, latest]);
  const context = buildContext(messages, {system: 'AE assistant'});
  assertBounded(context, 96000);
  assert.equal(context.compactedResults, 1, 'deeper reduction of the older preview is sufficient');
  assert.equal(tool(context.messages, 'newest-detailed').content, tool(messages, 'newest-detailed').content);
});

test('a small property payload can be reduced even when its protected envelope exceeds former result targets', () => {
  const call = {id: 'protected-envelope', type: 'function', function: {
    name: 'ae_inspect', arguments: JSON.stringify({scope: 'layer', compId: 9, layerIndex: 2, propertyPath: [1]})
  }};
  const read = {ok: true, data: {
    identity: {...identity, projectPath: 'C:/studio/' + 'long-project-folder/'.repeat(120) + 'Project.aep'},
    observation: 'Authored state and existing diagnostics; no render or preview requested.', scope: 'layer',
    comp: {id: 9, name: 'Composition ' + 'c'.repeat(450)}, layer: {index: 2, name: 'Layer ' + 'l'.repeat(450)},
    offset: 0, limit: 1, total: 1, hasMore: false,
    property: {name: 'Opacity', expression: 'x'.repeat(1800)}
  }};
  const messages = turn([call], [read]);
  const exact = buildContext(messages, {system: 'AE assistant', maxChars: 1000000});
  messages[0].content += 'u'.repeat(96200 - exact.characters);
  assert.equal(JSON.stringify([{role: 'system', content: 'AE assistant'}].concat(messages)).length, 96200);
  const protectedEnvelope = {...read.data};
  delete protectedEnvelope.property;
  assert.ok(JSON.stringify(protectedEnvelope).length > 1500);
  const original = JSON.stringify(messages);
  const context = buildContext(messages, {system: 'AE assistant'});
  assertBounded(context, 96000);
  assert.equal(context.compactedResults, 1);
  assert.equal(context.messages[1].content, messages[0].content, 'the exact user request is not shortened');
  assert.deepEqual(context.messages[2].tool_calls, messages[1].tool_calls);
  const reduced = JSON.parse(tool(context.messages, call.id).content);
  assert.equal(reduced._aelmContext.partial, true);
  for (const key of Object.keys(protectedEnvelope)) assert.deepEqual(reduced.data[key], protectedEnvelope[key]);
  assert.equal(JSON.stringify(messages), original);
});

test('partial failure and restored unknown outcome evidence survive reduction of another result', () => {
  const failure = {ok: false, error: {code: 'script_failed', message: 'An earlier edit may remain.', possiblyModified: true}};
  const unknown = {ok: false, status: 'unknown', error: 'The outcome was not recorded. Do not replay.'};
  const messages = turn([scriptCall('read-large'), scriptCall('partial'), scriptCall('unknown')], [
    scriptResult('read-large', {parameters: 'x'.repeat(97000)}), failure, unknown
  ]);
  const context = buildContext(messages, {system: 'AE assistant'});
  assertBounded(context, 96000);
  for (const id of ['partial', 'unknown']) assert.equal(tool(context.messages, id).content, tool(messages, id).content);
  assert.deepEqual(context.messages[2].tool_calls, messages[1].tool_calls);
});

test('escaped and multibyte inspection values use serialized size rather than raw string length', () => {
  const result = scriptResult('escaped', {expression: '"\\\n\u{1f600}'.repeat(8000)});
  assert.ok(JSON.stringify(result).length < 100000, 'fixture remains legal for the host');
  const messages = turn([scriptCall('escaped')], [result]);
  assert.ok(JSON.stringify(messages).length > 96000, 'JSON embedding exceeds the model budget');
  const context = buildContext(messages, {system: 'AE assistant'});
  assertBounded(context, 96000);
  assert.equal(context.compactedResults, 1);
  assert.equal(JSON.parse(tool(context.messages, 'escaped').content)._aelmContext.partial, true);
});

test('unrecognized or malformed oversized result bodies fail instead of inventing an outcome', () => {
  for (const content of [JSON.stringify({unrecognized: 'x'.repeat(97000)}), 'not-json ' + 'x'.repeat(97000)]) {
    const messages = turn([scriptCall('unrecognized')], [{}]);
    messages[2].content = content;
    assert.throws(() => buildContext(messages, {system: 'AE assistant'}), {code: 'context_limit'});
  }
});

test('oversized exact prompt or source still fails without rewriting command arguments', () => {
  const source = '/*' + 'x'.repeat(32000) + '*/ return null;';
  const messages = turn([scriptCall('source-1', source), scriptCall('source-2', source), scriptCall('source-3', source)], [
    scriptResult('source-1', null), scriptResult('source-2', null), scriptResult('source-3', null)
  ]);
  const original = JSON.stringify(messages);
  assert.throws(() => buildContext(messages, {system: 'AE assistant'}), {code: 'context_limit'});
  assert.equal(JSON.stringify(messages), original);
  assert.throws(() => buildContext([{role: 'user', content: 'x'.repeat(97000)}], {system: 'AE assistant'}), {code: 'context_limit'});
});

function completion(calls, content) {
  const message = {role: 'assistant', content: content || 'I will inspect the composition.'};
  if (calls) message.tool_calls = calls;
  return {body: JSON.stringify({choices: [{index: 0, message, finish_reason: calls ? 'tool_calls' : 'stop'}]}),
    headers: {'content-type': 'application/json'}};
}

test('a failed model request after compaction retries recorded results without repeating host execution', async () => {
  const call = scriptCall('once-only');
  const fullResult = scriptResult(call.id, {parameters: 'x'.repeat(97000)});
  const responses = [completion([call]), new Error('Synthetic connection failure'), completion(null, 'Inspection received.')];
  const requests = [];
  const executions = [];
  const progress = [];
  const bridge = {
    async identity() { return {ok: true, data: {...identity}}; },
    async execute(args) { executions.push({...args}); return fullResult; },
    async inspect() { throw new Error('This fixture must not inspect or replay automatically.'); }
  };
  const transport = {
    normalizeBaseUrl(value) { return value; },
    async request(args) {
      requests.push(JSON.parse(JSON.stringify(args.body)));
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error('Unexpected extra model request.');
      return response;
    }
  };
  const controller = new Controller({bridge, store: new HistoryStore(), transport, onProgress: value => progress.push(value)});
  controller.configure({baseUrl: 'https://studio.test', token: 'synthetic-token', model: 'test-model'});
  controller.autoRun = true;
  await controller.send('Inspect the composition and use its recorded result.');
  assert.equal(executions.length, 1);
  assert.match(controller.error, /Synthetic connection failure/);
  assert.equal(requests.length, 2, 'the reduced context reaches the next model step');
  assert.ok(JSON.stringify(requests[1].messages).length <= controller.maxContextChars);
  assert.equal(JSON.parse(tool(requests[1].messages, call.id).content)._aelmContext.partial, true);
  assert.equal(tool(controller.archive.messages, call.id).content, JSON.stringify(fullResult));
  assert.deepEqual(controller.archive.receipts[0].result, fullResult);
  await controller.retry();
  assert.equal(controller.error, '');
  assert.equal(executions.length, 1, 'model retry never reexecutes the inspected script');
  assert.equal(controller.archive.receipts.length, 1);
  assert.deepEqual(requests[2].messages, requests[1].messages, 'retry rebuilds the same request from full local evidence');
  assert.equal(controller.archive.messages.filter(message => message.role === 'user').length, 1);
  assert.ok(progress.some(value => /result/i.test(value.detail || '')), 'progress reports result shortening');
});
