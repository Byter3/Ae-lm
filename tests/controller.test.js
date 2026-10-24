'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Controller} = require('../extension/lib/controller');
const {HistoryStore, validateArchive} = require('../extension/lib/history');

function script(id, source) {
  return {id: id, type: 'function', function: {name: 'ae_run_script', arguments: JSON.stringify({title: 'Add one control', source: source || 'return {created: true};'})}};
}

function completion(calls, content) {
  const message = {role: 'assistant', content: content || (calls ? 'I will add a control after review.' : 'Done.')};
  if (calls) message.tool_calls = calls;
  return {body: JSON.stringify({choices: [{index: 0, message: message, finish_reason: calls ? 'tool_calls' : 'stop'}]}), headers: {'content-type': 'application/json'}};
}

function setup(responses, options) {
  const opts = options || {};
  const current = {projectToken: 'test-session-project-1', projectPath: opts.projectPath || '', hostVersion: '25.1'};
  const executions = [];
  const requests = [];
  const bridge = {
    async identity() { return {ok: true, data: Object.assign({}, current)}; },
    async inspect() { return {ok: true, data: {name: 'Test Comp', layers: [{name: 'Control'}]}}; },
    async execute(args) {
      executions.push(Object.assign({}, args));
      if (opts.execute) return opts.execute(args);
      return {ok: true, data: {created: true}};
    }
  };
  const transport = {
    normalizeBaseUrl(value) { return value; },
    async request(args) {
      requests.push(JSON.parse(JSON.stringify(args.body)));
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error('Synthetic transport ran out of responses.');
      return response;
    }
  };
  const controller = new Controller({bridge: bridge, store: new HistoryStore(), transport: transport});
  controller.configure({baseUrl: 'https://studio.test', token: 'synthetic-token', model: 'test-model'});
  return {controller: controller, current: current, executions: executions, requests: requests};
}

async function untilPending(controller) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (controller.pending) return controller.pending.id;
    if (!controller.busy) throw new Error('Turn ended before review: ' + controller.error);
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Review did not become pending.');
}

function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aelm-controller-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}

test('rejecting a reviewed script executes nothing and gives the model a rejection result', async () => {
  const state = setup([completion([script('reject-1')]), completion(null, 'The proposed edit was rejected.')]);
  const run = state.controller.send('Add a control.');
  const id = await untilPending(state.controller);
  assert.equal(state.controller.decide(id, false), true);
  await run;
  assert.equal(state.executions.length, 0);
  assert.equal(state.controller.archive.receipts[0].status, 'rejected');
  assert.equal(JSON.parse(state.requests[1].messages.find(message => message.role === 'tool').content).error.code, 'rejected');
  assert.equal(state.controller.busy, false);
});

test('double Apply dispatches the exact reviewed source only once', async () => {
  const exactSource = 'var comp = app.project.activeItem; return {name: comp.name};';
  const state = setup([completion([script('apply-1', exactSource)]), completion(null)]);
  const run = state.controller.send('Apply one script.');
  const id = await untilPending(state.controller);
  assert.equal(state.controller.decide(id, true), true);
  assert.equal(state.controller.decide(id, true), false);
  await run;
  assert.equal(state.executions.length, 1);
  assert.equal(state.executions[0].source, exactSource);
  assert.equal(state.executions[0].expectedProjectToken, state.current.projectToken);
  assert.equal(state.controller.archive.receipts[0].status, 'completed');
  assert.equal(state.controller.archive.receipts[0].authorization, 'manual');
});

test('retrying a failed model step uses saved command results without reexecuting', async () => {
  const state = setup([completion([script('once-1')]), new Error('Synthetic model timeout'), completion(null, 'The earlier edit completed.')]);
  state.controller.autoRun = true;
  await state.controller.send('Add a control.');
  assert.equal(state.executions.length, 1);
  assert.match(state.controller.error, /Synthetic model timeout/);
  await state.controller.retry();
  assert.equal(state.executions.length, 1);
  assert.equal(state.controller.archive.receipts.length, 1);
  assert.ok(state.requests[2].messages.some(message => message.tool_call_id === 'once-1'));
  assert.equal(state.controller.archive.messages.filter(message => message.role === 'user').length, 1);
});

test('one malformed tool in a batch prevents every command in that response', async () => {
  const malformed = script('bad-2');
  malformed.function.arguments = '{"source":';
  const state = setup([completion([script('valid-1'), malformed])]);
  state.controller.autoRun = true;
  await state.controller.send('Apply these edits.');
  assert.equal(state.executions.length, 0);
  assert.equal(state.controller.archive.receipts.length, 0);
  assert.match(state.controller.error, /invalid tool arguments/);
});

test('Stop during approval cancels the proposal and does not continue model work', async () => {
  const state = setup([completion([script('stop-1')])]);
  const run = state.controller.send('Propose one edit.');
  await untilPending(state.controller);
  state.controller.stop();
  await run;
  assert.equal(state.executions.length, 0);
  assert.equal(state.requests.length, 1);
  assert.equal(state.controller.archive.receipts[0].status, 'cancelled');
  assert.equal(state.controller.pending, null);
  validateArchive(state.controller.archive);
});

test('a possibly applied script failure stops the rest of its batch', async () => {
  const state = setup([completion([script('partial-1'), script('must-not-run-2')])], {
    execute: async () => ({ok: false, error: {code: 'script_error', message: 'Synthetic partial failure.', possiblyModified: true}})
  });
  state.controller.autoRun = true;
  await state.controller.send('Apply two edits.');
  assert.equal(state.executions.length, 1);
  assert.equal(state.executions[0].id, 'partial-1');
  assert.match(state.controller.error, /Earlier edits may remain/);
  const secondResult = state.controller.archive.messages.find(message => message.tool_call_id === 'must-not-run-2');
  assert.equal(JSON.parse(secondResult.content).error.code, 'cancelled');
  validateArchive(state.controller.archive);
});

test('Save As during review carries history to the new file and preserves the original', async t => {
  const directory = temp(t);
  const state = setup([completion([script('saveas-1')]), completion(null)], {projectPath: path.join(directory, 'Shot_v001.aep')});
  const run = state.controller.send('Add the control.');
  const id = await untilPending(state.controller);
  const oldPath = state.controller.store.path;
  const oldBytes = fs.readFileSync(oldPath);
  state.current.projectPath = path.join(directory, 'Shot_v002.aep');
  state.controller.decide(id, true);
  await run;
  assert.equal(state.executions.length, 1);
  assert.deepEqual(fs.readFileSync(oldPath), oldBytes);
  assert.equal(state.controller.store.path, path.join(directory, '.aelm', 'Shot_v002.aep.json'));
  const restored = new HistoryStore().bind(state.current.projectPath).archive;
  assert.equal(restored.receipts[0].status, 'completed');
  assert.equal(restored.messages[0].content, 'Add the control.');
});

test('changing the project before Apply executes nothing in the newly active project', async () => {
  const state = setup([completion([script('project-1')])]);
  const run = state.controller.send('Edit this project.');
  const id = await untilPending(state.controller);
  state.current.projectToken = 'test-session-project-2';
  state.controller.decide(id, true);
  await run;
  assert.equal(state.executions.length, 0);
  assert.match(state.controller.error, /active project changed/);
  assert.equal(state.controller.archive.receipts[0].status, 'cancelled');
  validateArchive(state.controller.archive);
});

test('model reuse of a completed command ID is rejected without a second execution', async () => {
  const state = setup([completion([script('reused')]), completion([script('reused')])]);
  state.controller.autoRun = true;
  await state.controller.send('Add one control.');
  assert.equal(state.executions.length, 1);
  assert.match(state.controller.error, /reused an earlier command ID/);
});

test('unknown host execution outcome is recorded and no later batch command runs', async () => {
  const unknown = new Error('Host response timed out.');
  unknown.code = 'host_timeout';
  unknown.outcome = 'unknown';
  const state = setup([completion([script('unknown-1'), script('not-after-unknown')])], {execute: async () => { throw unknown; }});
  state.controller.autoRun = true;
  await state.controller.send('Apply edits.');
  assert.equal(state.executions.length, 1);
  assert.equal(state.controller.archive.receipts[0].status, 'unknown');
  assert.match(state.controller.error, /outcome is unknown/);
  const restored = validateArchive(state.controller.archive, {restore: true});
  assert.equal(restored.receipts[0].status, 'unknown');
  assert.equal(state.executions.length, 1);
});
