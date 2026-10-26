'use strict';

const childProcess = require('child_process');
const path = require('path');

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createVisibleCapture(options) {
  const opts = options || {};
  const spawn = opts.spawn || childProcess.spawn;
  const platform = opts.platform || process.platform;
  const helperPath = opts.helperPath || path.join(__dirname, '..', 'capture', 'visible-capture.ps1');
  const systemRoot = opts.systemRoot || process.env.SystemRoot || 'C:\\Windows';
  const executable = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  let region = null;
  let busy = false;
  let generation = 0;

  function run(mode, payload) {
    if (platform !== 'win32') return Promise.reject(failure('capture_unavailable', 'Visible composition capture is currently available on Windows only.'));
    if (busy) return Promise.reject(failure('capture_busy', 'A view selection or capture is already running.'));
    busy = true;
    return new Promise((resolve, reject) => {
      let child, timer, settled = false, bytes = 0;
      const chunks = [];
      const limit = 6 * 1024 * 1024;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        busy = false;
        clearTimeout(timer);
        if (error && child) { try { child.kill(); } catch (_) {} }
        error ? reject(error) : resolve(value);
      };
      try {
        child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'RemoteSigned', '-File', helperPath, '-Mode', mode], {
          windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (_) {
        finish(failure('capture_unavailable', 'The local view capture helper could not start.'));
        return;
      }
      timer = setTimeout(() => finish(failure('capture_timeout', mode === 'select' ? 'View selection timed out. Choose the view again.' : 'View capture timed out.')), mode === 'select' ? 60000 : 15000);
      child.on('error', () => finish(failure('capture_unavailable', 'The local view capture helper could not start.')));
      child.stdin.on('error', () => finish(failure('capture_unavailable', 'The local view capture helper stopped before receiving its request.')));
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > limit) { finish(failure('capture_too_large', 'The captured view exceeds its size limit.')); return; }
        chunks.push(Buffer.from(chunk));
      });
      // Never surface compiler paths, environment details or arbitrary helper stderr.
      child.stderr.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > limit) finish(failure('capture_too_large', 'The capture helper exceeded its output limit.'));
      });
      child.on('close', code => {
        if (settled) return;
        let result;
        try { result = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim()); } catch (_) {
          finish(failure('capture_failed', 'The local view capture helper did not return a result. A studio script policy may block it; ask your administrator to approve the bundled helper. Image attachments still work.')); return;
        }
        if (code !== 0 || !result || result.ok !== true) {
          const allowed = {
            capture_cancelled: 'View selection was cancelled.',
            capture_foreground: 'Keep the selected After Effects window in front, then retry the capture.',
            capture_window_changed: 'The After Effects window moved, resized or changed. Choose the view again.',
            capture_occluded: 'Another window covers the selected view. Uncover it and retry.',
            capture_bounds: 'The selected view is invalid. Choose a rectangle inside the composition viewer.',
            capture_unavailable: 'The Windows capture helper is unavailable.',
            capture_empty: 'The selected view could not be captured.',
            capture_viewer_type: 'Make a Composition viewer active before requesting a capture.',
            capture_viewer_not_found: 'No supported visible Composition viewer was found. Keep one Composition viewer open in the main After Effects window.',
            capture_viewer_ambiguous: 'More than one possible viewer is visible. Keep only the intended Composition viewer visible and retry.'
          };
          const key = result && Object.prototype.hasOwnProperty.call(allowed, result.code) ? result.code : 'capture_failed';
          finish(failure(key, allowed[key] || 'The selected view could not be captured.'));
          return;
        }
        finish(null, result);
      });
      try { child.stdin.end(JSON.stringify(payload || {})); } catch (_) {
        finish(failure('capture_unavailable', 'The local view capture helper could not receive its request.'));
      }
    });
  }

  function validRect(rect) {
    return rect && ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(rect[key])) &&
      Math.abs(rect.x) <= 100000 && Math.abs(rect.y) <= 100000 && rect.width >= 1 && rect.width <= 32768 && rect.height >= 1 && rect.height <= 32768;
  }
  function validRegion(value) {
    return value && Number.isSafeInteger(value.processId) && value.processId > 0 &&
      typeof value.processStartTicks === 'string' && /^\d{1,20}$/.test(value.processStartTicks) &&
      typeof value.windowHandle === 'string' && /^\d{1,20}$/.test(value.windowHandle) &&
      validRect(value.windowRect) && validRect(value.clientRect) && validRect(value.captureRect);
  }

  return {
    hasRegion: () => !!region,
    clearRegion: () => { generation += 1; region = null; },
    async selectRegion() {
      if (busy) throw failure('capture_busy', 'A view selection or capture is already running.');
      const selectedGeneration = ++generation;
      region = null;
      const result = await run('select', {});
      if (generation !== selectedGeneration) throw failure('capture_cancelled', 'View selection was cancelled.');
      if (!validRegion(result.region)) throw failure('capture_failed', 'The selected view could not be validated.');
      region = result.region;
      return {selected: true, sourceWidth: region.captureRect.width, sourceHeight: region.captureRect.height};
    },
    async capture(options) {
      const captureRegion = region;
      const captureGeneration = generation;
      const captureOptions = options || {};
      if (!captureRegion && captureOptions.viewerType !== 'composition') {
        throw failure('capture_viewer_type', 'Make a Composition viewer active before requesting a capture.');
      }
      const maxWidth = captureOptions.maxWidth === undefined ? 1280 : captureOptions.maxWidth;
      const maxHeight = captureOptions.maxHeight === undefined ? 1280 : captureOptions.maxHeight;
      if (![maxWidth, maxHeight].every(value => Number.isSafeInteger(value) && value >= 64 && value <= 1280)) {
        throw failure('capture_bounds', 'Capture dimensions must be between 64 and 1280 pixels.');
      }
      let result;
      try { result = await run('capture', captureRegion ? {region: captureRegion, maxWidth, maxHeight} : {auto: true, viewerType: 'composition', maxWidth, maxHeight}); }
      catch (error) {
        if (['capture_window_changed', 'capture_bounds'].includes(error.code)) region = null;
        throw error;
      }
      if (generation !== captureGeneration) throw failure('capture_cancelled', 'View capture was cancelled.');
      const meta = result.metadata;
      if (result.mime !== 'image/png' || typeof result.imageBase64 !== 'string' ||
          result.imageBase64.length > 5 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.imageBase64) ||
          !meta || meta.method !== (captureRegion ? 'selected-visible-region' : 'detected-visible-viewer') ||
          !Number.isInteger(meta.width) || !Number.isInteger(meta.height) ||
          meta.width < 1 || meta.height < 1 || meta.width > maxWidth || meta.height > maxHeight ||
          !Number.isInteger(meta.sourceWidth) || !Number.isInteger(meta.sourceHeight) ||
          meta.sourceWidth < 64 || meta.sourceHeight < 64 || meta.sourceWidth > 8192 || meta.sourceHeight > 8192 ||
          (captureRegion && (meta.sourceWidth !== captureRegion.captureRect.width || meta.sourceHeight !== captureRegion.captureRect.height)) ||
          typeof meta.capturedAt !== 'string' || !Number.isFinite(Date.parse(meta.capturedAt))) {
        throw failure('capture_failed', 'The captured view returned invalid image metadata.');
      }
      const bytes = Buffer.from(result.imageBase64, 'base64');
      if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
          bytes.readUInt32BE(16) !== meta.width || bytes.readUInt32BE(20) !== meta.height) {
        throw failure('capture_failed', 'The captured view is not a valid PNG image.');
      }
      return {bytes, mime: 'image/png', metadata: {method: meta.method, capturedAt: meta.capturedAt,
        width: meta.width, height: meta.height, sourceWidth: meta.sourceWidth, sourceHeight: meta.sourceHeight}};
    }
  };
}

module.exports = {createVisibleCapture};
