"use strict";

const state = {
  audioContext: null,
  buffer: null,
  mono: null,
  fileName: "",
  analysis: null,
  sourceNode: null,
  startedAt: 0,
  rafId: null,
};

const els = {
  fileInput: document.getElementById("fileInput"),
  dropZone: document.getElementById("dropZone"),
  fileName: document.getElementById("fileName"),
  sourceDuration: document.getElementById("sourceDuration"),
  sampleRate: document.getElementById("sampleRate"),
  channelCount: document.getElementById("channelCount"),
  fundamentalReadout: document.getElementById("fundamentalReadout"),
  manualF0: document.getElementById("manualF0"),
  harmonicCount: document.getElementById("harmonicCount"),
  harmonicCountLabel: document.getElementById("harmonicCountLabel"),
  sensitivity: document.getElementById("sensitivity"),
  sensitivityLabel: document.getElementById("sensitivityLabel"),
  analyzeButton: document.getElementById("analyzeButton"),
  playButton: document.getElementById("playButton"),
  stopButton: document.getElementById("stopButton"),
  csvButton: document.getElementById("csvButton"),
  jsonButton: document.getElementById("jsonButton"),
  analysisStatus: document.getElementById("analysisStatus"),
  trimReadout: document.getElementById("trimReadout"),
  spectrumReadout: document.getElementById("spectrumReadout"),
  mainFrequencyValue: document.getElementById("mainFrequencyValue"),
  mainFrequencyNote: document.getElementById("mainFrequencyNote"),
  mainFrequencyMethod: document.getElementById("mainFrequencyMethod"),
  harmonicSummary: document.getElementById("harmonicSummary"),
  harmonicRows: document.getElementById("harmonicRows"),
  waveCanvas: document.getElementById("waveCanvas"),
  spectrumCanvas: document.getElementById("spectrumCanvas"),
};

const palette = [
  "#37d5bd",
  "#ff7f67",
  "#e8c75f",
  "#9b8cff",
  "#7ad66d",
  "#5cc8ff",
  "#f38ab8",
  "#b7de71",
];

const hzFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 1,
});

init();

function init() {
  wireEvents();
  drawEmptyCanvases();
}

function wireEvents() {
  els.fileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) loadAudioFile(file);
  });

  ["dragenter", "dragover"].forEach((name) => {
    els.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((name) => {
    els.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("dragging");
    });
  });

  els.dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) loadAudioFile(file);
  });

  els.harmonicCount.addEventListener("input", () => {
    els.harmonicCountLabel.textContent = els.harmonicCount.value;
  });

  els.sensitivity.addEventListener("input", () => {
    els.sensitivityLabel.textContent = `${els.sensitivity.value}%`;
  });

  els.analyzeButton.addEventListener("click", () => analyzeLoadedAudio());
  els.playButton.addEventListener("click", () => playAudio());
  els.stopButton.addEventListener("click", () => stopAudio());
  els.csvButton.addEventListener("click", () => exportCsv());
  els.jsonButton.addEventListener("click", () => exportJson());

  [els.manualF0, els.harmonicCount, els.sensitivity].forEach((input) => {
    input.addEventListener("change", () => {
      if (state.buffer) analyzeLoadedAudio();
    });
  });

  window.addEventListener("resize", () => {
    drawAll();
  });
}

async function loadAudioFile(file) {
  setStatus("디코딩");
  stopAudio();

  try {
    const context = getAudioContext();
    const bytes = await file.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    state.buffer = buffer;
    state.mono = mixToMono(buffer);
    state.fileName = file.name;
    state.analysis = null;
    els.fileName.textContent = file.name;
    els.sourceDuration.textContent = formatTime(buffer.duration);
    els.sampleRate.textContent = `${buffer.sampleRate.toLocaleString("ko-KR")} Hz`;
    els.channelCount.textContent = `${buffer.numberOfChannels}`;
    els.fundamentalReadout.textContent = "-";
    els.mainFrequencyValue.textContent = "-";
    els.mainFrequencyNote.textContent = "-";
    els.mainFrequencyMethod.textContent = "분석 대기";
    els.analyzeButton.disabled = false;
    els.playButton.disabled = false;
    els.stopButton.disabled = false;
    els.csvButton.disabled = true;
    els.jsonButton.disabled = true;
    els.harmonicRows.innerHTML =
      '<div class="empty-state">파형을 읽었습니다. 분석을 누르면 배음별 ADSR이 계산됩니다.</div>';
    drawWaveform();
    clearAnalysisCanvases();
    setStatus("대기");
    await analyzeLoadedAudio();
  } catch (error) {
    console.error(error);
    setStatus("오류");
    alert("오디오 파일을 읽지 못했습니다. 브라우저가 지원하는 형식인지 확인해 주세요.");
  }
}

function getAudioContext() {
  if (!state.audioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextCtor();
  }
  return state.audioContext;
}

function mixToMono(buffer) {
  const result = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      result[i] += data[i] / buffer.numberOfChannels;
    }
  }
  return result;
}

async function analyzeLoadedAudio() {
  if (!state.buffer || !state.mono) return;
  stopAudio(false);
  setStatus("분석 중");
  els.analyzeButton.disabled = true;
  await nextFrame();

  const mono = state.mono;
  const sampleRate = state.buffer.sampleRate;
  const sensitivity = Number(els.sensitivity.value) / 100;
  const active = findActiveRegion(mono, sampleRate, sensitivity);
  const manualF0 = Number(els.manualF0.value);
  const isManualF0 = Number.isFinite(manualF0) && manualF0 > 0;
  const estimatedF0 = isManualF0 ? manualF0 : estimateFundamental(mono, sampleRate, active);
  const harmonicCount = Number(els.harmonicCount.value);
  const frameSize = chooseFrameSize(sampleRate, estimatedF0);
  const hopSize = chooseHopSize(mono.length, sampleRate, frameSize);
  const harmonics = analyzeHarmonics({
    samples: mono,
    sampleRate,
    f0: estimatedF0,
    harmonicCount,
    frameSize,
    hopSize,
    sensitivity,
  });
  const spectrum = computeAverageSpectrum(mono, sampleRate, active);

  state.analysis = {
    sampleRate,
    duration: state.buffer.duration,
    active,
    f0: estimatedF0,
    frameSize,
    hopSize,
    harmonics,
    spectrum,
  };
  els.fundamentalReadout.textContent = `${hzFormatter.format(estimatedF0)} Hz`;
  els.mainFrequencyValue.textContent = `${hzFormatter.format(estimatedF0)} Hz`;
  els.mainFrequencyNote.textContent = frequencyToNoteName(estimatedF0);
  els.mainFrequencyMethod.textContent = isManualF0 ? "수동 지정 기음" : "자동 추정 기음";
  els.trimReadout.textContent = `활성 구간: ${formatTime(active.start / sampleRate)} - ${formatTime(
    active.end / sampleRate,
  )}`;
  els.spectrumReadout.textContent = `${harmonics.length}개 후보 배음`;
  const detectedCount = harmonics.filter((harmonic) => harmonic.detected).length;
  els.harmonicSummary.textContent = `${detectedCount}/${harmonics.length} active`;
  els.csvButton.disabled = harmonics.length === 0;
  els.jsonButton.disabled = harmonics.length === 0;
  els.analyzeButton.disabled = false;
  setStatus("완료");

  renderHarmonicRows();
  drawAll();
}

function chooseFrameSize(sampleRate, f0) {
  const cycles = sampleRate / Math.max(40, f0) * 5;
  const target = clamp(Math.round(cycles), 1024, 8192);
  return nextPowerOfTwo(target);
}

function chooseHopSize(length, sampleRate, frameSize) {
  const base = Math.max(256, Math.round(frameSize / 4));
  const maxFrames = 1100;
  const frames = Math.ceil(length / base);
  if (frames <= maxFrames) return base;
  return Math.ceil(length / maxFrames);
}

function findActiveRegion(samples, sampleRate, sensitivity) {
  const frame = Math.round(sampleRate * 0.018);
  const hop = Math.round(sampleRate * 0.009);
  const rms = [];
  let maxRms = 0;
  for (let start = 0; start + frame < samples.length; start += hop) {
    let sum = 0;
    for (let i = 0; i < frame; i += 1) {
      const value = samples[start + i];
      sum += value * value;
    }
    const value = Math.sqrt(sum / frame);
    rms.push({ start, value });
    if (value > maxRms) maxRms = value;
  }
  const threshold = Math.max(maxRms * sensitivity, 0.0008);
  const first = rms.find((item) => item.value >= threshold);
  const last = [...rms].reverse().find((item) => item.value >= threshold);
  if (!first || !last) {
    return { start: 0, end: samples.length - 1, threshold, rms };
  }
  const pad = Math.round(sampleRate * 0.035);
  return {
    start: clamp(first.start - pad, 0, samples.length - 1),
    end: clamp(last.start + frame + pad, 0, samples.length - 1),
    threshold,
    rms,
  };
}

function estimateFundamental(samples, sampleRate, active) {
  const frameSize = Math.min(4096, samples.length);
  if (frameSize < 512) return 440;
  const regionStart = active.start;
  const regionEnd = Math.max(active.end, regionStart + frameSize);
  const span = Math.max(frameSize, regionEnd - regionStart - frameSize);
  const checks = 14;
  const candidates = [];

  for (let i = 0; i < checks; i += 1) {
    const ratio = checks === 1 ? 0 : i / (checks - 1);
    const start = clamp(Math.round(regionStart + span * ratio), 0, Math.max(0, samples.length - frameSize));
    const frame = samples.subarray(start, start + frameSize);
    const rms = frameRms(frame);
    if (rms < active.threshold * 0.5) continue;
    const pitch = pitchByAutocorrelation(frame, sampleRate, 40, 2000);
    if (pitch && pitch.confidence > 0.38) candidates.push(pitch.frequency);
  }

  if (!candidates.length) {
    return 440;
  }

  candidates.sort((a, b) => a - b);
  return median(candidates);
}

function pitchByAutocorrelation(frame, sampleRate, minHz, maxHz) {
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.min(Math.ceil(sampleRate / minHz), frame.length - 2);
  if (maxLag <= minLag) return null;
  const prepared = new Float32Array(frame.length);
  let mean = 0;
  for (let i = 0; i < frame.length; i += 1) mean += frame[i];
  mean /= frame.length;
  for (let i = 0; i < frame.length; i += 1) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame.length - 1));
    prepared[i] = (frame[i] - mean) * w;
  }

  const peaks = [];
  let best = { lag: 0, corr: -Infinity };
  let previous = 0;
  let current = normalizedCorrelation(prepared, minLag);

  for (let lag = minLag + 1; lag <= maxLag; lag += 1) {
    const next = normalizedCorrelation(prepared, lag);
    if (current > previous && current >= next && current > 0.26) {
      peaks.push({ lag: lag - 1, corr: current });
      if (current > best.corr) best = { lag: lag - 1, corr: current };
    }
    previous = current;
    current = next;
  }

  if (!peaks.length) return null;
  const accepted = peaks.find((peak) => peak.corr >= best.corr * 0.86 && peak.corr > 0.34) || best;
  const refinedLag = refineLag(prepared, accepted.lag);
  return {
    frequency: sampleRate / refinedLag,
    confidence: accepted.corr,
  };
}

function normalizedCorrelation(samples, lag) {
  let sum = 0;
  let energyA = 0;
  let energyB = 0;
  const limit = samples.length - lag;
  for (let i = 0; i < limit; i += 1) {
    const a = samples[i];
    const b = samples[i + lag];
    sum += a * b;
    energyA += a * a;
    energyB += b * b;
  }
  if (energyA <= 0 || energyB <= 0) return 0;
  return sum / Math.sqrt(energyA * energyB);
}

function refineLag(samples, lag) {
  if (lag <= 1 || lag >= samples.length - 2) return lag;
  const y1 = normalizedCorrelation(samples, lag - 1);
  const y2 = normalizedCorrelation(samples, lag);
  const y3 = normalizedCorrelation(samples, lag + 1);
  const divisor = y1 - 2 * y2 + y3;
  if (Math.abs(divisor) < 1e-6) return lag;
  return lag + (0.5 * (y1 - y3)) / divisor;
}

function analyzeHarmonics({
  samples,
  sampleRate,
  f0,
  harmonicCount,
  frameSize,
  hopSize,
  sensitivity,
}) {
  const nyquist = sampleRate / 2;
  const usable = [];
  for (let harmonicNumber = 1; harmonicNumber <= harmonicCount; harmonicNumber += 1) {
    const frequency = f0 * harmonicNumber;
    if (frequency >= nyquist * 0.94) break;
    usable.push({
      harmonicNumber,
      frequency,
      color: palette[(harmonicNumber - 1) % palette.length],
    });
  }

  const window = makeHannWindow(frameSize);
  const windowSum = window.reduce((sum, value) => sum + value, 0);
  const kernels = usable.map((harmonic) => makeKernel(harmonic.frequency, sampleRate, window));
  const frameCount = Math.max(1, Math.floor((samples.length - frameSize) / hopSize) + 1);
  const times = new Float32Array(frameCount);
  const envelopes = usable.map(() => new Float32Array(frameCount));

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const start = frameIndex * hopSize;
    times[frameIndex] = (start + frameSize / 2) / sampleRate;
    for (let harmonicIndex = 0; harmonicIndex < usable.length; harmonicIndex += 1) {
      const kernel = kernels[harmonicIndex];
      let real = 0;
      let imag = 0;
      for (let i = 0; i < frameSize; i += 1) {
        const value = samples[start + i] || 0;
        real += value * kernel.real[i];
        imag += value * kernel.imag[i];
      }
      envelopes[harmonicIndex][frameIndex] = (2 * Math.hypot(real, imag)) / windowSum;
    }
  }

  const globalPeak = envelopes.reduce((peak, env) => Math.max(peak, maxOf(env)), 1e-9);
  return usable.map((harmonic, harmonicIndex) => {
    const raw = smoothEnvelope(envelopes[harmonicIndex], 2);
    const peak = maxOf(raw);
    const normalized = normalizeArray(raw, peak || 1);
    const adsr = estimateAdsr(times, normalized, sensitivity);
    const detected = peak >= globalPeak * Math.max(0.006, sensitivity * 0.35);
    return {
      ...harmonic,
      times,
      normalizedEnvelope: normalized,
      peak,
      peakDb: 20 * Math.log10(Math.max(peak, 1e-9)),
      adsr,
      detected,
    };
  });
}

function makeHannWindow(size) {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
}

function makeKernel(frequency, sampleRate, window) {
  const real = new Float32Array(window.length);
  const imag = new Float32Array(window.length);
  const rate = (2 * Math.PI * frequency) / sampleRate;
  for (let i = 0; i < window.length; i += 1) {
    real[i] = window[i] * Math.cos(rate * i);
    imag[i] = -window[i] * Math.sin(rate * i);
  }
  return { real, imag };
}

function smoothEnvelope(envelope, radius) {
  const result = new Float32Array(envelope.length);
  for (let i = 0; i < envelope.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = -radius; j <= radius; j += 1) {
      const index = i + j;
      if (index >= 0 && index < envelope.length) {
        sum += envelope[index];
        count += 1;
      }
    }
    result[i] = sum / count;
  }
  return result;
}

function estimateAdsr(times, envelope, sensitivity) {
  const max = maxOf(envelope);
  if (!max) {
    return { attack: 0, decay: 0, sustain: 0, release: 0, start: 0, end: 0, peak: 0 };
  }

  const threshold = clamp(Math.max(0.025, sensitivity), 0.015, 0.12);
  const startIndex = firstIndex(envelope, (value) => value >= threshold);
  const endIndex = lastIndex(envelope, (value) => value >= threshold);
  const peakIndex = indexOfMax(envelope);

  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    return { attack: 0, decay: 0, sustain: 0, release: 0, start: 0, end: 0, peak: 0 };
  }

  const attackStart = firstIndex(envelope, (value, index) => index >= startIndex && value >= 0.1);
  const attackEnd = firstIndex(envelope, (value, index) => index >= startIndex && value >= 0.9);
  const attack = Math.max(0, times[attackEnd >= 0 ? attackEnd : peakIndex] - times[attackStart >= 0 ? attackStart : startIndex]);

  const tailStart = Math.min(endIndex, peakIndex + Math.max(2, Math.round((endIndex - peakIndex) * 0.42)));
  const tailEnd = Math.min(endIndex, peakIndex + Math.max(3, Math.round((endIndex - peakIndex) * 0.72)));
  const sustainSlice = Array.from(envelope.slice(tailStart, Math.max(tailStart + 1, tailEnd)));
  const sustain = sustainSlice.length ? clamp(median(sustainSlice), 0, 1) : envelope[endIndex];

  let decayEnd = peakIndex;
  for (let i = peakIndex; i <= endIndex; i += 1) {
    if (envelope[i] <= Math.max(sustain * 1.08, 0.18)) {
      decayEnd = i;
      break;
    }
  }
  const decay = Math.max(0, times[decayEnd] - times[peakIndex]);

  const releaseHigh = clamp(Math.max(sustain * 0.85, 0.16), threshold * 1.6, 0.8);
  let releaseStart = peakIndex;
  for (let i = endIndex; i >= startIndex; i -= 1) {
    if (envelope[i] >= releaseHigh) {
      releaseStart = i;
      break;
    }
  }
  const release = Math.max(0, times[endIndex] - times[releaseStart]);

  return {
    attack,
    decay,
    sustain,
    release,
    start: times[startIndex],
    end: times[endIndex],
    peak: times[peakIndex],
  };
}

function computeAverageSpectrum(samples, sampleRate, active) {
  const nyquist = sampleRate / 2;
  const size = 16384;
  const start = clamp(
    Math.round((active.start + active.end) / 2 - size / 2),
    0,
    Math.max(0, samples.length - size - 1),
  );
  const frame = samples.subarray(start, Math.min(samples.length, start + size));
  const window = makeHannWindow(frame.length);
  const windowSum = window.reduce((sum, value) => sum + value, 0);
  const bins = 360;
  const frequencies = new Float32Array(bins);
  const magnitudes = new Float32Array(bins);
  const minFreq = 24;
  const maxFreq = Math.min(nyquist * 0.92, 16000);

  for (let bin = 0; bin < bins; bin += 1) {
    const ratio = bin / (bins - 1);
    const frequency = minFreq * (maxFreq / minFreq) ** ratio;
    const rate = (2 * Math.PI * frequency) / sampleRate;
    let real = 0;
    let imag = 0;
    for (let i = 0; i < frame.length; i += 1) {
      const value = frame[i] * window[i];
      real += value * Math.cos(rate * i);
      imag -= value * Math.sin(rate * i);
    }
    frequencies[bin] = frequency;
    magnitudes[bin] = (2 * Math.hypot(real, imag)) / windowSum;
  }

  return { frequencies, magnitudes };
}

function renderHarmonicRows() {
  const analysis = state.analysis;
  if (!analysis) return;

  els.harmonicRows.innerHTML = "";
  analysis.harmonics.forEach((harmonic) => {
    const row = document.createElement("div");
    row.className = "harmonic-row";

    const adsr = harmonic.adsr;
    row.innerHTML = `
      <span class="harmonic-index"><i class="color-chip" style="background:${harmonic.color}"></i><span><strong>H${harmonic.harmonicNumber}</strong><small>${
        harmonic.harmonicNumber === 1 ? "기음" : `${harmonic.harmonicNumber}배음`
      }</small></span></span>
      <span class="freq-cell">${hzFormatter.format(harmonic.frequency)} Hz</span>
      <span class="peak-cell">${formatDb(harmonic.peakDb)}</span>
      <span class="adsr-cell">A ${formatSeconds(adsr.attack)} · D ${formatSeconds(adsr.decay)}<br>S ${Math.round(
        adsr.sustain * 100,
      )}% · R ${formatSeconds(adsr.release)}</span>
    `;
    els.harmonicRows.appendChild(row);
  });
}

function drawAll() {
  drawWaveform();
  drawSpectrum();
}

function drawEmptyCanvases() {
  drawCanvasMessage(els.waveCanvas, "오디오 파형");
  drawCanvasMessage(els.spectrumCanvas, "스펙트럼");
}

function clearAnalysisCanvases() {
  drawCanvasMessage(els.spectrumCanvas, "분석을 기다리는 중");
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function drawCanvasMessage(canvas, text) {
  const { ctx, width, height } = setupCanvas(canvas);
  drawPanelBackground(ctx, width, height);
  ctx.fillStyle = "#aaa391";
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, width / 2, height / 2);
}

function drawPanelBackground(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#141410";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(212, 203, 184, 0.09)";
  ctx.lineWidth = 1;
  for (let y = 36; y < height; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let x = 64; x < width; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

function drawWaveform() {
  if (!state.mono) {
    drawCanvasMessage(els.waveCanvas, "오디오 파형");
    return;
  }

  const { ctx, width, height } = setupCanvas(els.waveCanvas);
  const samples = state.mono;
  drawPanelBackground(ctx, width, height);

  const center = height / 2;
  const scale = height * 0.42;
  ctx.strokeStyle = "rgba(243, 240, 231, 0.2)";
  ctx.beginPath();
  ctx.moveTo(0, center);
  ctx.lineTo(width, center);
  ctx.stroke();

  ctx.strokeStyle = "#37d5bd";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(samples.length / width));
  for (let x = 0; x < width; x += 1) {
    const start = Math.floor(x * step);
    let min = 1;
    let max = -1;
    for (let i = 0; i < step && start + i < samples.length; i += 1) {
      const value = samples[start + i];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    ctx.moveTo(x, center - max * scale);
    ctx.lineTo(x, center - min * scale);
  }
  ctx.stroke();

  if (state.analysis) {
    const { active, sampleRate } = state.analysis;
    const x1 = (active.start / sampleRate / state.buffer.duration) * width;
    const x2 = (active.end / sampleRate / state.buffer.duration) * width;
    ctx.fillStyle = "rgba(232, 199, 95, 0.11)";
    ctx.fillRect(x1, 0, Math.max(1, x2 - x1), height);
    ctx.strokeStyle = "#e8c75f";
    [x1, x2].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    });
  }

  if (state.sourceNode) {
    const elapsed = state.audioContext.currentTime - state.startedAt;
    const x = (elapsed / state.buffer.duration) * width;
    ctx.strokeStyle = "#ff7f67";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

function drawSpectrum() {
  const analysis = state.analysis;
  if (!analysis) {
    drawCanvasMessage(els.spectrumCanvas, "스펙트럼");
    return;
  }

  const { ctx, width, height } = setupCanvas(els.spectrumCanvas);
  drawPanelBackground(ctx, width, height);
  const { frequencies, magnitudes } = analysis.spectrum;
  const maxMag = maxOf(magnitudes) || 1;
  const minFreq = frequencies[0];
  const maxFreq = frequencies[frequencies.length - 1];

  ctx.strokeStyle = "#9b8cff";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < frequencies.length; i += 1) {
    const x = logX(frequencies[i], minFreq, maxFreq, width);
    const db = 20 * Math.log10(Math.max(magnitudes[i] / maxMag, 1e-5));
    const y = map(db, -70, 0, height - 24, 16);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  analysis.harmonics.forEach((harmonic) => {
    if (harmonic.frequency < minFreq || harmonic.frequency > maxFreq) return;
    const x = logX(harmonic.frequency, minFreq, maxFreq, width);
    const alpha = harmonic.detected ? 0.9 : 0.22;
    ctx.strokeStyle = hexToRgba(harmonic.color, alpha);
    ctx.lineWidth = harmonic.detected ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(x, 12);
    ctx.lineTo(x, height - 22);
    ctx.stroke();
    if (harmonic.detected && harmonic.harmonicNumber <= 12) {
      ctx.fillStyle = harmonic.color;
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(String(harmonic.harmonicNumber), x + 4, 22);
    }
  });

  drawAxisLabel(ctx, "20 Hz", 10, height - 8);
  drawAxisLabel(ctx, `${Math.round(maxFreq / 1000)} kHz`, width - 54, height - 8);
}

function playAudio() {
  if (!state.buffer) return;
  const context = getAudioContext();
  context.resume();
  stopAudio(false);
  const source = context.createBufferSource();
  source.buffer = state.buffer;
  source.connect(context.destination);
  source.onended = () => {
    stopAudio(false);
  };
  state.sourceNode = source;
  state.startedAt = context.currentTime;
  source.start();
  animatePlayback();
}

function stopAudio(redraw = true) {
  if (state.sourceNode) {
    try {
      state.sourceNode.stop();
    } catch {
      // Source may already be stopped by the browser.
    }
    state.sourceNode.disconnect();
    state.sourceNode = null;
  }
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  if (redraw) drawWaveform();
}

function animatePlayback() {
  if (!state.sourceNode) return;
  drawWaveform();
  state.rafId = requestAnimationFrame(animatePlayback);
}

function exportCsv() {
  const analysis = state.analysis;
  if (!analysis) return;
  const rows = [
    [
      "harmonic",
      "frequency_hz",
      "peak_db",
      "attack_s",
      "decay_s",
      "sustain_ratio",
      "release_s",
      "detected",
    ],
  ];
  analysis.harmonics.forEach((harmonic) => {
    rows.push([
      harmonic.harmonicNumber,
      harmonic.frequency.toFixed(4),
      harmonic.peakDb.toFixed(3),
      harmonic.adsr.attack.toFixed(5),
      harmonic.adsr.decay.toFixed(5),
      harmonic.adsr.sustain.toFixed(5),
      harmonic.adsr.release.toFixed(5),
      harmonic.detected ? "true" : "false",
    ]);
  });
  downloadText(`${safeBaseName(state.fileName)}-harmonics.csv`, rows.map((row) => row.join(",")).join("\n"));
}

function exportJson() {
  const analysis = state.analysis;
  if (!analysis) return;
  const payload = {
    fileName: state.fileName,
    duration: analysis.duration,
    sampleRate: analysis.sampleRate,
    fundamentalHz: analysis.f0,
    frameSize: analysis.frameSize,
    hopSize: analysis.hopSize,
    harmonics: analysis.harmonics.map((harmonic) => ({
      harmonic: harmonic.harmonicNumber,
      frequencyHz: harmonic.frequency,
      peakDb: harmonic.peakDb,
      detected: harmonic.detected,
      adsr: harmonic.adsr,
      envelope: Array.from(harmonic.normalizedEnvelope, (value) => Number(value.toFixed(5))),
      envelopeTimes: Array.from(harmonic.times, (value) => Number(value.toFixed(5))),
    })),
  };
  downloadText(`${safeBaseName(state.fileName)}-harmonics.json`, JSON.stringify(payload, null, 2));
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeBaseName(name) {
  return (name || "analysis").replace(/\.[^/.]+$/, "").replace(/[^\w가-힣-]+/g, "-");
}

function frameRms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    sum += frame[i] * frame[i];
  }
  return Math.sqrt(sum / frame.length);
}

function firstIndex(array, predicate) {
  for (let i = 0; i < array.length; i += 1) {
    if (predicate(array[i], i)) return i;
  }
  return -1;
}

function lastIndex(array, predicate) {
  for (let i = array.length - 1; i >= 0; i -= 1) {
    if (predicate(array[i], i)) return i;
  }
  return -1;
}

function indexOfMax(array) {
  let index = 0;
  let value = -Infinity;
  for (let i = 0; i < array.length; i += 1) {
    if (array[i] > value) {
      value = array[i];
      index = i;
    }
  }
  return index;
}

function maxOf(array) {
  let max = 0;
  for (let i = 0; i < array.length; i += 1) {
    if (array[i] > max) max = array[i];
  }
  return max;
}

function normalizeArray(array, peak) {
  const result = new Float32Array(array.length);
  const divisor = Math.max(peak, 1e-9);
  for (let i = 0; i < array.length; i += 1) {
    result[i] = clamp(array[i] / divisor, 0, 1);
  }
  return result;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function nextPowerOfTwo(value) {
  let power = 1;
  while (power < value) power *= 2;
  return power;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function map(value, inMin, inMax, outMin, outMax) {
  const ratio = (value - inMin) / (inMax - inMin);
  return outMin + clamp(ratio, 0, 1) * (outMax - outMin);
}

function logX(frequency, minFreq, maxFreq, width) {
  return (Math.log(frequency / minFreq) / Math.log(maxFreq / minFreq)) * width;
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatDb(value) {
  if (!Number.isFinite(value)) return "-∞";
  return `${value.toFixed(1)} dB`;
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) return "0ms";
  if (value < 1) return `${Math.round(value * 1000)}ms`;
  return `${value.toFixed(2)}s`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "00:00.000";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(3).padStart(6, "0")}`;
}

function frequencyToNoteName(frequency) {
  if (!Number.isFinite(frequency) || frequency <= 0) return "-";
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const midi = 69 + 12 * Math.log2(frequency / 440);
  const rounded = Math.round(midi);
  const cents = Math.round((midi - rounded) * 100);
  const octave = Math.floor(rounded / 12) - 1;
  const note = noteNames[((rounded % 12) + 12) % 12];
  const centsLabel = cents === 0 ? "±0c" : `${cents > 0 ? "+" : ""}${cents}c`;
  return `${note}${octave} ${centsLabel}`;
}

function setStatus(text) {
  els.analysisStatus.textContent = text;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
