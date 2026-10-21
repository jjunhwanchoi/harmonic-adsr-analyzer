// Dependency-free integration checks using DOM/Web Audio test doubles.
// Does not replace native browser, listening or visual verification.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..');
const elements = new Map();
const canvas = new Proxy({}, { get: () => () => {} });
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', checked: false, textContent: '', attrs: {}, events: {},
      addEventListener(name, callback) { this.events[name] = callback; },
      setAttribute(name, value) { this.attrs[name] = value; },
      getBoundingClientRect() { return { width: 800, height: 300 }; },
      getContext() { return canvas; },
    });
    return elements.get(id);
  },
};
class Param {
  constructor(value = 0) { this.value = value; }
  cancelAndHoldAtTime() {}
  linearRampToValueAtTime(value) { this.value = value; }
}
class Node {
  constructor(context) {
    this.context = context; this.connections = [];
    this.gain = new Param(1); this.frequency = new Param(350); this.Q = new Param(1);
  }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  getFrequencyResponse(frequencies, magnitudes) {
    // Independent RBJ low-pass coefficient evaluation with Web Audio Q in dB.
    const w0 = 2 * Math.PI * this.frequency.value / this.context.sampleRate;
    const c = Math.cos(w0), alpha = Math.sin(w0) / (2 * 10 ** (this.Q.value / 20));
    const b = [(1-c)/2, 1-c, (1-c)/2], a = [1+alpha, -2*c, 1-alpha];
    frequencies.forEach((f, i) => {
      const w = 2 * Math.PI * f / this.context.sampleRate;
      const mag = cs => Math.hypot(cs.reduce((s,v,k) => s + v*Math.cos(k*w), 0), cs.reduce((s,v,k) => s - v*Math.sin(k*w), 0));
      magnitudes[i] = mag(b) / mag(a);
    });
  }
}
class Context {
  constructor(channels, length, rate = 48000) { this.sampleRate = rate; this.currentTime = 0; this.destination = {}; }
  createBiquadFilter() { return new Node(this); }
  createGain() { return new Node(this); }
  createBufferSource() { return new Node(this); }
  resume() {}
}
const scope = vm.createContext({ document, window: { AudioContext: Context, devicePixelRatio: 1, addEventListener() {} }, OfflineAudioContext: Context, console, Intl, Float32Array, requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
vm.runInContext(fs.readFileSync(path.join(root, 'filter-lab.js'), 'utf8'), scope);
vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), scope);
const run = code => vm.runInContext(code, scope);
assert.match(document.getElementById('responseReadout').textContent, /-3.01 dB/);
run('state.filterLab.q = 2; state.filterLab.update()');
assert.match(document.getElementById('responseReadout').textContent, /6.02 dB/);
run('state.buffer = { duration: 1 }; state.analysis = { marker: 42, harmonics: [], spectrum: { frequencies: new Float32Array([100, 1000, 10000]), magnitudes: new Float32Array([1, .5, .1]) } }; playAudio()');
assert.equal(run('state.sourceNode.connections.length'), 2);
assert.equal(run('state.sourceNode.connections.includes(state.audioContext.destination)'), false);
assert.ok(Math.abs(run('state.filterLab.filter.Q.value') - 6.0206) < .001);
run('state.filterLab.select(true)');
assert.equal(run('state.filterLab.wet.gain.value'), 1);
assert.equal(run('state.filterLab.dry.gain.value'), 0);
assert.equal(run('state.analysis.marker'), 42);
run('globalThis.oldSource = state.sourceNode; globalThis.oldEnd = oldSource.onended; playAudio(); oldEnd()');
assert.equal(run('oldSource.onended'), null);
assert.equal(run('state.sourceNode.started'), true);
run('stopAudio()');
assert.equal(run('state.sourceNode'), null);
assert.match(document.getElementById('filterStatus').textContent, /재생 대기/);
run('state.filterLab.attach(new OfflineAudioContext(1, 1, 22050)); state.filterLab.cutoff = state.filterLab.maxHz; state.filterLab.update(false)');
assert.equal(run('state.filterLab.maxHz'), 22050 * .49);
assert.ok(Number.isFinite(run('state.filterLab.response(new Float32Array([state.filterLab.maxHz]))[0]')));
console.log('PASS: startup, Q conversion, response math, dry/wet routing, analysis isolation, stale onended, stop, sample-rate limit');
