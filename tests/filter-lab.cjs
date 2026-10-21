// Run against a local server: BASE_URL=http://127.0.0.1:8000 node tests/filter-lab.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8000');
    assert.match(await page.locator('#responseReadout').innerText(), /-3.01 dB/);
    const numerical = await page.evaluate(async () => {
      const lab = state.filterLab;
      lab.q = 2; lab.update();
      const cutoffDb = 20 * Math.log10(lab.response(new Float32Array([1000]))[0]);
      // Render an actual sine through a native biquad and compare RMS to graph.
      const offline = new OfflineAudioContext(1, 48000, 48000);
      const osc = offline.createOscillator(); osc.frequency.value = 1000;
      const filter = offline.createBiquadFilter(); filter.type = 'lowpass';
      filter.frequency.value = 1000; filter.Q.value = 20 * Math.log10(2);
      osc.connect(filter).connect(offline.destination); osc.start();
      const rendered = (await offline.startRendering()).getChannelData(0);
      const rms = Math.sqrt(rendered.slice(24000).reduce((s, x) => s + x*x, 0) / 24000);
      return { cutoffDb, measuredGain: rms * Math.SQRT2 };
    });
    assert.ok(Math.abs(numerical.cutoffDb - 6.0206) < .01);
    assert.ok(Math.abs(numerical.measuredGain - 2) < .01);
    await page.click('#filterReset');
    // A real WAV upload exercises decoding, analysis and the shared playback graph.
    const rate = 48000, count = rate * 2;
    const wav = Buffer.alloc(44 + count * 2);
    wav.write('RIFF'); wav.writeUInt32LE(36 + count * 2, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
    wav.writeUInt32LE(count * 2, 40);
    for (let i = 0; i < count; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 220 * i / rate)), 44 + i * 2);
    await page.locator('#fileInput').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav });
    await page.waitForFunction(() => state.analysis && !els.analyzeButton.disabled);
    const before = await page.evaluate(() => JSON.stringify(state.analysis));
    await page.check('#loopAudio');
    await page.click('#playButton');
    await page.click('#wetButton');
    await page.locator('#filterQ').fill('2');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => JSON.stringify(state.analysis)), before);
    assert.equal(await page.evaluate(() => state.sourceNode.loop), true);
    assert.ok(await page.evaluate(() => state.filterLab.wet.gain.value > .99));
    await page.click('#dryButton');
    await page.waitForTimeout(100);
    assert.ok(await page.evaluate(() => state.filterLab.dry.gain.value > .99));
    // Repeated starts must not let an older onended callback stop a new source.
    await page.click('#playButton'); await page.click('#playButton');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => !!state.sourceNode), true);
    await page.click('#stopButton');
    assert.equal(await page.evaluate(() => state.sourceNode), null);
    await page.uncheck('#loopAudio');
    await page.click('#playButton');
    await page.waitForFunction(() => state.sourceNode === null, { timeout: 5000 });
    const download = page.waitForEvent('download');
    await page.click('#jsonButton');
    assert.match((await download).suggestedFilename(), /harmonics.json$/);
    await page.screenshot({ path: '/tmp/biquad-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: '/tmp/biquad-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: native response/render, upload, ADSR unchanged, A/B, loop, restart, natural end, export, mobile overflow, no page errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
