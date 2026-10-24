'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseCompletion, validateToolCalls, TOOLS} = require('../extension/lib/protocol');
const tool = (name = 'ae_inspect', args = {scope: 'activeComp'}, id = 'call_1') => ({id, type: 'function', function: {name, arguments: JSON.stringify(args)}});
const event = delta => 'data: ' + JSON.stringify({choices: [{index: 0, delta}]}) + '\n\n';
const end = (reason = 'stop') => 'data: ' + JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: reason}]}) + '\n\ndata: [DONE]\n\n';

test('JSON and SSE text completions retain literal markup as text', () => {
  const content = '<img src="https://invalid.test/pixel">';
  assert.equal(parseCompletion(JSON.stringify({choices: [{message: {role: 'assistant', content}, finish_reason: 'stop'}]})).content, content);
  assert.equal(parseCompletion(event({content: 'Hello '}) + event({content: 'artist'}) + end(), 'text/event-stream').content, 'Hello artist');
});

test('fragmented parallel tool calls assemble complete arguments before validation', () => {
  const body = event({tool_calls: [{index: 0, id: 'a', type: 'function', function: {name: 'ae_inspect', arguments: '{"scope":'}}, {index: 1, id: 'b', type: 'function', function: {name: 'ae_run_script', arguments: '{"title":"Add null",'}}]}) +
    event({tool_calls: [{index: 1, function: {arguments: '"source":"return 1;"}'}}, {index: 0, function: {arguments: '"project"}'}}]}) + end('tool_calls');
  const result = parseCompletion(body, 'text/event-stream');
  assert.deepEqual(validateToolCalls(result.tool_calls), [{id: 'a', name: 'ae_inspect', args: {scope: 'project'}}, {id: 'b', name: 'ae_run_script', args: {title: 'Add null', source: 'return 1;'}}]);
});

test('CRLF SSE, comments and usage-only events are accepted', () => {
  const body = ': heartbeat\n\n' + event({content: 'Ready'}) + 'data: {"choices":[],"usage":{"total_tokens":9}}\n\n' + end();
  assert.equal(parseCompletion(body.replace(/\n/g, '\r\n'), 'text/event-stream').content, 'Ready');
});

test('no tools are returned from a malformed second call', () => {
  const calls = [tool(), tool('ae_run_script', {title: 'Oops', source: ''}, 'call_2')];
  assert.throws(() => parseCompletion(JSON.stringify({choices: [{message: {tool_calls: calls}, finish_reason: 'tool_calls'}]})), {code: 'invalid_arguments'});
});

test('missing completion marker, missing finish, length, empty and refusal fail', () => {
  assert.throws(() => parseCompletion(event({content: 'partial'}), 'text/event-stream'), {code: 'response_incomplete'});
  assert.throws(() => parseCompletion(event({content: 'partial'}) + 'data: [DONE]\n\n', 'text/event-stream'), {code: 'response_incomplete'});
  assert.throws(() => parseCompletion(event({content: 'partial'}) + end('length'), 'text/event-stream'), {code: 'response_truncated'});
  assert.throws(() => parseCompletion(end(), 'text/event-stream'), {code: 'empty_response'});
  assert.throws(() => parseCompletion(event({refusal: 'No'}) + end(), 'text/event-stream'), {code: 'response_refused'});
});

test('duplicate IDs, unknown tools, truncated arguments and extra fields fail', () => {
  assert.throws(() => validateToolCalls([tool(), tool()]), {code: 'invalid_tools'});
  assert.throws(() => validateToolCalls([tool('shell')]), {code: 'invalid_tools'});
  const incomplete = tool(); incomplete.function.arguments = '{"scope":';
  assert.throws(() => validateToolCalls([incomplete]), {code: 'invalid_arguments'});
  assert.throws(() => validateToolCalls([tool('ae_inspect', {scope: 'project', source: 'bad()'})]), {code: 'invalid_arguments'});
  assert.throws(() => validateToolCalls([tool('ae_inspect', {scope: 'comp'})]), {code: 'invalid_arguments'});
  assert.throws(() => validateToolCalls([tool('ae_inspect', {scope: 'layer', layerIndex: 0})]), {code: 'invalid_arguments'});
  assert.throws(() => validateToolCalls([tool('ae_inspect', {scope: 'project', limit: 51})]), {code: 'invalid_arguments'});
});

test('stream tool identity changes fail; sparse Responses bridge indices are accepted', () => {
  const first = event({tool_calls: [{index: 0, id: 'a', function: {name: 'ae_inspect', arguments: '{'}}]});
  assert.throws(() => parseCompletion(first + event({tool_calls: [{index: 0, id: 'b', function: {arguments: '}'}}]}) + end('tool_calls'), 'text/event-stream'), {code: 'invalid_tools'});
  assert.equal(parseCompletion(event({tool_calls: [{index: 3, ...tool()}]}) + end('tool_calls'), 'text/event-stream').tool_calls[0].id, 'call_1');
});

test('bridge repeated metadata and repeated complete argument object are retained once', () => {
  const part = {index: 7, ...tool()};
  const answer = parseCompletion(event({tool_calls: [part]}) + event({tool_calls: [part]}) + end('tool_calls'), 'text/event-stream');
  assert.equal(answer.tool_calls[0].function.name, 'ae_inspect');
  assert.equal(answer.tool_calls[0].function.arguments, '{"scope":"activeComp"}');
});

test('full message snapshots reconcile earlier prefixes by stable call ID', () => {
  const first = event({content: 'I will ', tool_calls: [{index: 4, id: 'call_1', function: {name: 'ae_inspect', arguments: '{"scope":'}}]});
  const snapshot = 'data: ' + JSON.stringify({choices: [{index: 0, message: {content: 'I will inspect.', tool_calls: [tool()]}, finish_reason: 'tool_calls'}]}) + '\n\ndata: [DONE]\n\n';
  const answer = parseCompletion(first + snapshot, 'text/event-stream');
  assert.equal(answer.content, 'I will inspect.');
  assert.deepEqual(answer.tool_calls, [tool()]);
  const incompatible = snapshot.replace('activeComp', 'project').replace('call_1', 'call_other');
  assert.throws(() => parseCompletion(first + incompatible, 'text/event-stream'), {code: 'invalid_tools'});
});

test('snapshot-only completions and harmless Open WebUI status metadata work', () => {
  const body = 'data: {"status":"processing"}\n\n' + 'data: ' + JSON.stringify({choices: [{message: {role: 'assistant', tool_calls: [tool()]}, finish_reason: 'tool_calls'}]}) + '\n\ndata: [DONE]\n\n';
  assert.deepEqual(parseCompletion(body, 'text/event-stream').tool_calls, [tool()]);
});

test('generic source is accepted without recipe or vocabulary restrictions', () => {
  const source = 'var c = app.project.activeItem; var n = c.layers.addNull(); n.name = "Control"; return {name:n.name};';
  assert.equal(validateToolCalls([tool('ae_run_script', {title: 'Add a control to active comp', source})])[0].args.source, source);
  assert.equal(TOOLS.length, 2);
});

test('nested property paths preserve match names and reject unsafe shapes', () => {
  const args = {scope: 'layer', layerIndex: 1, propertyPath: ['ADBE Transform Group', 'ADBE Position']};
  assert.deepEqual(validateToolCalls([tool('ae_inspect', args)])[0].args, args);
  for (const propertyPath of [new Array(13).fill(1), [''], [0], [{}], ['x'.repeat(257)]]) {
    assert.throws(() => validateToolCalls([tool('ae_inspect', {...args, propertyPath})]), {code: 'invalid_arguments'});
  }
  assert.throws(() => validateToolCalls([tool('ae_inspect', {scope: 'project', propertyPath: ['x']})]), {code: 'invalid_arguments'});
});
