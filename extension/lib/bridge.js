'use strict';

// The host evaluates on AE's main thread. A client timeout is not a cancellation.
class Bridge {
  constructor(options) {
    if (!options || typeof options.evalScript !== 'function') throw new TypeError('evalScript is required');
    this.evalScript = options.evalScript;
    this.timeoutMs = options.timeoutMs || 30000;
    this.tail = Promise.resolve();
    this.blocked = false;
  }

  identity() { return this.call('identity', {}); }
  inspect(args) { return this.call('inspect', args || {}); }
  execute(args) { return this.call('execute', args); }

  call(method, args) {
    if (!['identity', 'inspect', 'execute'].includes(method)) return Promise.reject(new Error('Unknown host method'));
    let encoded;
    try {
      encoded = JSON.stringify(args || {});
      if (encoded.length > 110000) throw new Error('Host request is too large');
    } catch (err) { return Promise.reject(err); }
    const run = () => {
      if (this.blocked) {
        const error = new Error('A previous host call has an unknown outcome. Wait for AE to finish and reopen the panel before further commands.');
        error.code = 'host_outcome_unknown'; error.outcome = 'unknown';
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          settled = true;
          this.blocked = true;
          const error = new Error('After Effects has not returned. The script may still be running; it was not retried.');
          error.code = 'host_timeout'; error.outcome = method === 'execute' ? 'unknown' : 'read_timeout';
          reject(error);
        }, this.timeoutMs);
        const fail = (message, code) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          if (method === 'execute') this.blocked = true;
          const error = new Error(message); error.code = code;
          error.outcome = method === 'execute' ? 'unknown' : 'failed';
          reject(error);
        };
        try {
          // JSON encodes both arguments; source never becomes part of this invocation.
          const invocation = 'AELM.dispatch(' + JSON.stringify(method) + ',' + JSON.stringify(encoded) + ')';
          this.evalScript(invocation, (reply) => {
            if (settled) return;
            if (typeof reply !== 'string' || reply.length > 140000) return fail('Invalid host response.', 'host_invalid_response');
            let parsed;
            try { parsed = JSON.parse(reply); } catch (_) { return fail('After Effects returned an unreadable result.', 'host_invalid_response'); }
            if (!parsed || typeof parsed.ok !== 'boolean' || (!parsed.ok && (!parsed.error || typeof parsed.error.code !== 'string' || typeof parsed.error.message !== 'string'))) {
              return fail('After Effects returned an invalid result.', 'host_invalid_response');
            }
            settled = true; clearTimeout(timer); resolve(parsed);
          });
        } catch (_) { fail('Could not obtain a reliable result from After Effects.', 'host_dispatch_failed'); }
      });
    };
    const task = this.tail.then(run);
    this.tail = task.catch(() => {});
    return task;
  }
}

module.exports = { Bridge };
