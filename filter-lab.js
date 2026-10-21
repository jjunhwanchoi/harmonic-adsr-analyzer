"use strict";

// The UI uses the conventional dimensionless Q factor. Web Audio lowpass Q
// uses decibels; convert with 20*log10(Q), including negative values.
class FilterLab {
  constructor(onChange) {
    this.onChange = onChange;
    this.cutoff = 1000;
    this.q = Math.SQRT1_2;
    this.enabled = false;
    this.playing = false;
    this.volumeDb = -18;
    this.maxHz = 20000;
    this.els = Object.fromEntries([
      "cutoff", "cutoffValue", "filterQ", "qValue", "dryButton", "wetButton",
      "filterReset", "labVolume", "volumeValue", "filterStatus", "responseCanvas", "responseReadout",
    ].map(id => [id, document.getElementById(id)]));
    // A disconnected node permits accurate response exploration before upload,
    // without opening an output device. Replaced with the real sample rate later.
    this.responseContext = new OfflineAudioContext(1, 1, 48000);
    this.responseNode = this.responseContext.createBiquadFilter();
    this.responseNode.type = "lowpass";
    this.els.cutoff.addEventListener("input", () => {
      this.cutoff = 20 * (this.maxHz / 20) ** (Number(this.els.cutoff.value) / 1000);
      this.update();
    });
    this.els.filterQ.addEventListener("input", () => {
      this.q = Number(this.els.filterQ.value);
      this.update();
    });
    this.els.dryButton.addEventListener("click", () => this.select(false));
    this.els.wetButton.addEventListener("click", () => this.select(true));
    this.els.filterReset.addEventListener("click", () => {
      this.cutoff = Math.min(1000, this.maxHz);
      this.q = Math.SQRT1_2;
      this.update();
    });
    this.els.labVolume.addEventListener("input", () => {
      this.volumeDb = Number(this.els.labVolume.value);
      if (this.output) this.smooth(this.output.gain, 10 ** (this.volumeDb / 20));
      this.els.volumeValue.textContent = `${this.volumeDb} dB`;
    });
    this.update(false);
  }

  attach(context) {
    this.context = context;
    this.maxHz = Math.min(20000, context.sampleRate * 0.49);
    this.cutoff = Math.min(this.cutoff, this.maxHz);
    this.filter = context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.dry = context.createGain();
    this.wet = context.createGain();
    this.output = context.createGain();
    this.filter.connect(this.wet).connect(this.output);
    this.dry.connect(this.output);
    this.output.connect(context.destination);
    this.dry.gain.value = this.enabled ? 0 : 1;
    this.wet.gain.value = this.enabled ? 1 : 0;
    this.output.gain.value = 10 ** (this.volumeDb / 20);
    this.filter.frequency.value = this.cutoff;
    this.filter.Q.value = 20 * Math.log10(this.q);
    this.responseNode = context.createBiquadFilter();
    this.responseNode.type = "lowpass";
    this.update();
  }

  connect(source) {
    // Both branches stay connected so switching never restarts playback and
    // the filter history remains warm even while listening to the dry branch.
    source.connect(this.dry);
    source.connect(this.filter);
  }

  smooth(param, value) {
    const now = this.context.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else {
      const current = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(current, now);
    }
    param.linearRampToValueAtTime(value, now + 0.025);
  }

  select(enabled) {
    this.enabled = enabled;
    if (this.context) {
      this.smooth(this.dry.gain, enabled ? 0 : 1);
      this.smooth(this.wet.gain, enabled ? 1 : 0);
    }
    this.setPlaying(this.playing);
  }

  setPlaying(playing) {
    this.playing = playing;
    this.els.dryButton.setAttribute("aria-pressed", String(!this.enabled));
    this.els.wetButton.setAttribute("aria-pressed", String(this.enabled));
    this.els.filterStatus.textContent = `${this.enabled ? "필터음" : "원음"} 선택 · ${playing ? "재생 중" : "재생 대기"}`;
  }

  update(notify = true) {
    this.els.cutoff.value = 1000 * Math.log(this.cutoff / 20) / Math.log(this.maxHz / 20);
    this.els.filterQ.value = this.q;
    this.els.cutoffValue.textContent = `${Math.round(this.cutoff).toLocaleString("ko-KR")} Hz`;
    this.els.cutoff.setAttribute("aria-valuetext", this.els.cutoffValue.textContent);
    this.els.qValue.textContent = this.q.toFixed(3);
    this.responseNode.frequency.value = this.cutoff;
    this.responseNode.Q.value = 20 * Math.log10(this.q);
    if (this.filter) {
      this.smooth(this.filter.frequency, this.cutoff);
      this.smooth(this.filter.Q, 20 * Math.log10(this.q));
    }
    const atCutoff = this.response(new Float32Array([this.cutoff]))[0];
    this.els.responseReadout.textContent = `Cutoff ${Math.round(this.cutoff).toLocaleString("ko-KR")} Hz에서 ${(20 * Math.log10(atCutoff)).toFixed(2)} dB · Q ${this.q.toFixed(3)} · ${(this.responseNode.context.sampleRate / 1000).toFixed(1)} kHz 샘플레이트${this.context ? "" : " (미리보기)"}`;
    this.draw();
    if (notify) this.onChange();
  }

  response(frequencies) {
    const magnitudes = new Float32Array(frequencies.length);
    this.responseNode.getFrequencyResponse(frequencies, magnitudes, new Float32Array(frequencies.length));
    return magnitudes;
  }

  draw() {
    const canvas = this.els.responseCanvas;
    const { width, height } = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#141410";
    ctx.fillRect(0, 0, width, height);
    const left = 48, top = 20, w = Math.max(1, width - 68), h = height - 56;
    const x = f => left + Math.log(f / 20) / Math.log(this.maxHz / 20) * w;
    const y = db => top + (20 - Math.max(-60, Math.min(20, db))) / 80 * h;
    ctx.font = "12px system-ui";
    for (const db of [20, 0, -12, -24, -36, -48, -60]) {
      ctx.strokeStyle = db === 0 ? "#aaa391" : "#34342c";
      ctx.setLineDash(db === 0 ? [4, 4] : []);
      ctx.beginPath(); ctx.moveTo(left, y(db)); ctx.lineTo(left + w, y(db)); ctx.stroke();
      ctx.fillStyle = "#d4cbb8"; ctx.textAlign = "right";
      ctx.fillText(`${db}`, left - 8, y(db) + 4);
    }
    ctx.setLineDash([]);
    const ticks = width < 500 ? [20, 100, 1000, 10000] : [20, 100, 500, 1000, 5000, 10000, 20000];
    for (const f of ticks.filter(f => f <= this.maxHz)) {
      ctx.strokeStyle = "#34342c";
      ctx.beginPath(); ctx.moveTo(x(f), top); ctx.lineTo(x(f), top + h); ctx.stroke();
      ctx.fillStyle = "#d4cbb8"; ctx.textAlign = "center";
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x(f), height - 18);
    }
    ctx.textAlign = "left"; ctx.fillText("dB", 8, 15);
    ctx.textAlign = "right"; ctx.fillText("Hz", width - 4, height - 3);
    const frequencies = Float32Array.from({ length: 640 }, (_, i) => 20 * (this.maxHz / 20) ** (i / 639));
    const magnitudes = this.response(frequencies);
    ctx.strokeStyle = "#37d5bd"; ctx.lineWidth = 2.5; ctx.beginPath();
    frequencies.forEach((f, i) => {
      const py = y(20 * Math.log10(Math.max(magnitudes[i], 1e-9)));
      if (i === 0) ctx.moveTo(x(f), py); else ctx.lineTo(x(f), py);
    });
    ctx.stroke();
    ctx.strokeStyle = "#e8c75f"; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(x(this.cutoff), top); ctx.lineTo(x(this.cutoff), top + h); ctx.stroke();
    ctx.setLineDash([]);
  }
}
