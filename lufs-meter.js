// Live loudness meter: momentary, short-term and integrated LUFS per ITU-R BS.1770-4, plus the
// sample peak. It draws a panel in the top right of the page.
//
// Load it, then call .lufs() on what you play:
//
//   await import('https://cdn.jsdelivr.net/gh/alperta/murepl@main/lufs-meter.js')
//
//   stack(s("bd sd"), note("c2").s("sawtooth")).lufs()
//
// It taps the master output through a channel splitter, so it measures the whole mix in stereo.
// The per-sound analyser behind the oscilloscope downmixes to mono, which reads 3 to 6 dB low.
//
// The integrated reading applies both BS.1770-4 gates, so silence never drags it down.
// lufsMeter.reset() restarts it. lufsMeter.stop() removes the panel.
//
// The sample peak is no true peak. Measure a rendered file with `ffmpeg -af ebur128=peak=true`.

const LUFS_OFFSET = -0.691;
const LUFS_ABS_GATE = -70;
const LUFS_REL_GATE = -10;
const LUFS_TARGET = -14;
const LUFS_HOP_MS = 100;
const LUFS_SHORT_HOPS = 30;

// ITU-R BS.1770-4 K-weighting, redesigned per sample rate off the De Man 2014 constants.
function lufsKCoefs(fs) {
  const G = 3.999843853973347, Qs = 0.7071752369554196, fc = 1681.974450955533;
  const K = Math.tan((Math.PI * fc) / fs);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Qs + K * K;
  const shelf = {
    b0: (Vh + (Vb * K) / Qs + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Qs + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Qs + K * K) / a0,
  };
  const Qh = 0.5003270373238773, fh = 38.13547087602444;
  const Kh = Math.tan((Math.PI * fh) / fs);
  const d0 = 1 + Kh / Qh + Kh * Kh;
  const rlb = { b0: 1, b1: -2, b2: 1, a1: (2 * (Kh * Kh - 1)) / d0, a2: (1 - Kh / Qh + Kh * Kh) / d0 };
  return [shelf, rlb];
}

function lufsStep(c, s, x) {
  const y = c.b0 * x + s[0];
  s[0] = c.b1 * x - c.a1 * y + s[1];
  s[1] = c.b2 * x - c.a2 * y;
  return y;
}

// Σ_c mean square of the K-weighted channel. Every channel weighs 1, because a stereo pair does.
function lufsBlockPower(chans, coefs) {
  let z = 0;
  for (const ch of chans) {
    const s1 = new Float64Array(2), s2 = new Float64Array(2);
    let acc = 0;
    for (let i = 0; i < ch.length; i++) {
      const y = lufsStep(coefs[1], s2, lufsStep(coefs[0], s1, ch[i]));
      acc += y * y;
    }
    z += acc / ch.length;
  }
  return z;
}

function lufsGated(powers) {
  const absT = 10 ** ((LUFS_ABS_GATE - LUFS_OFFSET) / 10);
  let sum = 0, n = 0;
  for (const p of powers) if (p > absT) { sum += p; n++; }
  if (!n) return null;
  const relT = (sum / n) * 10 ** (LUFS_REL_GATE / 10);
  sum = 0; n = 0;
  for (const p of powers) if (p > absT && p > relT) { sum += p; n++; }
  if (!n) return null;
  return LUFS_OFFSET + 10 * Math.log10(sum / n);
}

globalThis.lufsMeter = globalThis.lufsMeter || {
  powers: [],
  momentary: null,
  maxShort: -Infinity,
  peak: 0,
  master: null,
  taps: null,
  coefs: null,
  fs: 48000,
  win: 19200,
  lastHop: 0,
  hidden: false,
  reset() {
    this.powers.length = 0;
    this.maxShort = -Infinity;
    this.peak = 0;
    this.momentary = null;
  },
  stop() {
    this.hidden = true;
    document.getElementById('lufs-meter-panel')?.remove();
  },
  show() {
    this.hidden = false;
  },
};

// The host rebuilds its master on a reset, so the tap re-checks the node it holds every frame.
function lufsTap() {
  const m = lufsMeter;
  const master = getSuperdoughAudioController()?.output?.destinationGain;
  if (!master) return null;
  if (m.master === master && m.taps) return m.taps;
  const ctx = getAudioContext();
  const splitter = ctx.createChannelSplitter(2);
  const left = ctx.createAnalyser();
  const right = ctx.createAnalyser();
  left.fftSize = 32768;
  right.fftSize = 32768;
  master.connect(splitter);
  splitter.connect(left, 0);
  splitter.connect(right, 1);
  m.fs = ctx.sampleRate;
  m.win = Math.round(0.4 * m.fs);
  m.coefs = lufsKCoefs(m.fs);
  m.master = master;
  m.taps = {
    left,
    right,
    bufL: new Float32Array(left.fftSize),
    bufR: new Float32Array(right.fftSize),
  };
  return m.taps;
}

function lufsMeasure() {
  const m = lufsMeter;
  const taps = lufsTap();
  if (!taps) return;
  const now = performance.now();
  if (now - m.lastHop < LUFS_HOP_MS) return;
  m.lastHop = now;
  taps.left.getFloatTimeDomainData(taps.bufL);
  taps.right.getFloatTimeDomainData(taps.bufR);
  const start = taps.bufL.length - m.win;
  const w = [taps.bufL.subarray(start), taps.bufR.subarray(start)];
  for (const ch of w) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > m.peak) m.peak = a; }
  const z = lufsBlockPower(w, m.coefs);
  m.powers.push(z);
  m.momentary = z > 0 ? LUFS_OFFSET + 10 * Math.log10(z) : null;
  const tail = m.powers.slice(-LUFS_SHORT_HOPS);
  if (tail.length === LUFS_SHORT_HOPS) {
    const mean = tail.reduce((a, p) => a + p, 0) / LUFS_SHORT_HOPS;
    const s = mean > 0 ? LUFS_OFFSET + 10 * Math.log10(mean) : null;
    if (s !== null && s > m.maxShort) m.maxShort = s;
  }
}

function lufsShortTerm() {
  const tail = lufsMeter.powers.slice(-LUFS_SHORT_HOPS);
  if (tail.length < LUFS_SHORT_HOPS) return null;
  const mean = tail.reduce((a, p) => a + p, 0) / LUFS_SHORT_HOPS;
  return mean > 0 ? LUFS_OFFSET + 10 * Math.log10(mean) : null;
}

function lufsPanel() {
  let el = document.getElementById('lufs-meter-panel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lufs-meter-panel';
    el.style.cssText = [
      'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
      'background:rgba(0,0,0,.82)', 'color:#eaeaea', 'padding:10px 14px',
      'font:13px/1.55 ui-monospace,Menlo,monospace', 'border-radius:6px',
      'white-space:pre', 'pointer-events:none', 'letter-spacing:.02em',
    ].join(';');
    document.body.appendChild(el);
  }
  return el;
}

function lufsDraw() {
  const m = lufsMeter;
  const el = lufsPanel();
  el.style.display = m.hidden ? 'none' : 'block';
  if (m.hidden) return;
  if (!m.taps) {
    el.textContent = 'LUFS: waiting for audio';
    return;
  }
  const fmt = (v) => (v === null || !isFinite(v) ? ' --.-' : v.toFixed(1).padStart(5));
  const i = lufsGated(m.powers);
  const peakDb = m.peak > 0 ? 20 * Math.log10(m.peak) : -Infinity;
  const over = i === null ? '' : (i - LUFS_TARGET >= 0 ? '+' : '') + (i - LUFS_TARGET).toFixed(1);
  el.textContent = [
    'M   ' + fmt(m.momentary) + ' LUFS',
    'S   ' + fmt(lufsShortTerm()) + ' LUFS',
    'I   ' + fmt(i) + ' LUFS  ' + over,
    'max ' + fmt(m.maxShort) + ' LUFS short',
    'pk  ' + fmt(peakDb) + ' dBFS  ' + (m.powers.length / 10).toFixed(0) + 's',
  ].join('\n');
  el.style.color = i !== null && i > LUFS_TARGET ? '#ff9a52' : '#eaeaea';
}

Pattern.prototype.lufs = function (config = {}) {
  const id = config.id ?? 'lufs-meter';
  return this.draw(
    () => {
      // An exception here kills the animation loop and shows nothing, so the panel says why.
      try {
        lufsMeasure();
        lufsDraw();
      } catch (err) {
        lufsPanel().textContent = 'LUFS failed: ' + err.message;
      }
    },
    { id },
  );
};
