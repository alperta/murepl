// Tongue drum synth: a modal model of a 9-tongue steel drum tuned A3 to E5, fitted to a recording on 2026-09-28.
// Load it, then play any pitch:
//
//   await import('https://cdn.jsdelivr.net/gh/alperta/murepl@main/tongue-synth.js')
//
//   note("a3 c4 d4 e4 g4").s("tongue_synth")
//
// A strike rings the struck tongue, the other 8 tongues, 47 body lines and a low mallet knock.
// A pitch outside A3 to E5 takes the decay of the nearest edge tongue, so it sounds less like the drum.
// Each pitch renders once into a buffer, because 59 live oscillators per strike would pile up when notes overlap.

const TONGUE_MIDI = [57, 60, 62, 64, 67, 69, 72, 74, 76];

// midi, swell s, slow amp, slow T60 s, fast amp, fast T60 s. a4 is left out: its hard strike and buzz make it a bad model.
const TONGUE_FUND = [
  [57, 0.008376, 0.1878, 7.361, 0.1038, 1.541],
  [60, 0.00805, 0.1885, 5.109, 0.139, 1.235],
  [62, 0.01041, 0.2421, 3.679, 0.1003, 1.039],
  [64, 0.009257, 0.2286, 3.595, 0.13, 0.94],
  [67, 0.008656, 0.201, 4.889, 0.1128, 1.376],
  [72, 0.006753, 0.1012, 8.506, 0.2384, 1.489],
  [74, 0.006487, 0.1367, 8.181, 0.1649, 1.799],
  [76, 0.004382, 0.1277, 7.992, 0.1663, 1.868],
];

// Per struck tongue, every other tongue: dB under the struck fundamental at 20 ms, T60 s. The a4 row is null for the same reason.
const TONGUE_SYMPATHY = [
  [null, [-19.4, 0.359], [-17.5, 0.802], [-18.2, 0.412], [-26.6, 0.312], [-21.1, 1.04], [-27.8, 0.273], [-27.8, 0.237], [-18.5, 1.06]],
  [[-31.1, 0.356], null, [-16.1, 0.395], [-19.5, 0.429], [-28.6, 0.317], [-36.7, 0.321], [-22.5, 0.716], [-32.9, 0.227], [-33.2, 0.393]],
  [[-41.6, 0.483], [-27.6, 0.346], null, [-20.2, 0.418], [-32.9, 0.324], [-41.6, 0.219], [-36.0, 0.225], [-30.7, 0.826], [-38.9, 0.19]],
  [[-47.8, 0.319], [-38.0, 0.364], [-23.9, 0.367], null, [-30.2, 0.329], [-47.4, 1.16], [-38.4, 0.35], [-42.2, 0.371], [-34.3, 0.629]],
  [[-49.0, 0.354], [-40.4, 0.387], [-30.6, 0.389], [-24.2, 0.626], null, [-45.0, 0.407], [-34.4, 0.309], [-37.3, 0.437], [-38.7, 0.208]],
  null,
  [[-50.3, 0.288], [-43.5, 0.373], [-34.0, 0.397], [-32.2, 0.413], [-34.7, 0.323], [-46.4, 0.321], null, [-26.8, 0.547], [-36.1, 0.259]],
  [[-49.7, 0.276], [-45.7, 0.372], [-35.1, 0.417], [-30.3, 0.413], [-34.7, 0.326], [-50.5, 1.24], [-23.9, 0.221], null, [-30.8, 0.675]],
  [[-46.4, 0.298], [-41.3, 0.323], [-32.6, 0.359], [-28.0, 0.41], [-30.5, 0.332], [-46.0, 0.367], [-26.1, 0.363], [-22.2, 0.243], null],
];

// Body lines shared by the notes: Hz, dB under the struck fundamental, T60 s.
const TONGUE_BODY = [
  [801.0, -56.5, 0.6], [840.5, -38.4, 0.154], [868.0, -30.8, 0.6], [896.0, -62.2, 0.256], [917.0, -59.7, 0.279], [935.0, -67.7, 0.171],
  [972.0, -62.3, 0.219], [1003.5, -59.9, 0.403], [1066.8, -39.3, 0.217], [1123.5, -59.1, 0.445], [1163.0, -68.4, 0.6], [1223.0, -69.6, 0.21],
  [1305.0, -51.3, 0.181], [1357.5, -63.1, 0.335], [1392.0, -65.6, 0.364], [1461.7, -47.1, 0.186], [1519.3, -49.8, 0.175], [1561.0, -67.6, 0.498],
  [1589.0, -69.6, 0.0772], [1628.5, -63.0, 0.205], [1667.0, -40.5, 0.347], [1733.5, -58.6, 0.247], [1833.0, -48.2, 0.242], [1914.0, -69.2, 0.115],
  [1997.0, -56.9, 0.338], [2063.5, -49.9, 0.148], [2176.5, -56.9, 0.17], [2310.3, -63.7, 0.136], [2368.0, -49.8, 0.0928], [2562.0, -58.1, 0.129],
  [2695.0, -64.3, 0.248], [2845.0, -68.1, 0.0707], [3028.0, -60.2, 0.135], [3188.0, -58.3, 0.103], [3436.8, -55.6, 0.119], [3560.0, -68.4, 0.177],
  [3691.0, -54.6, 0.0734], [3829.5, -59.1, 0.131], [3937.0, -59.0, 0.147], [4038.0, -66.2, 0.0771], [4231.0, -64.7, 0.108], [4399.0, -49.0, 0.111],
  [4723.0, -65.7, 0.155], [5740.0, -67.2, 0.419], [6784.0, -69.6, 0.405], [8770.0, -70.8, 0.162], [10131.0, -66.9, 0.197],
];

// Scales the fitted amplitudes so the loudest tongue peaks at -6 dBFS.
const TONGUE_GAIN = 1.48;
const TONGUE_HARMONICS = [[2, -28, 1.8], [3, -32, 1.5]];
const TONGUE_KNOCK_DB = -8;
const TONGUE_CACHE = new Map();

const tongueDb = (db) => 10 ** (db / 20);
const tongueHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function tongueInterp(midi, col) {
  const rows = TONGUE_FUND;
  if (midi <= rows[0][0]) return rows[0][col];
  if (midi >= rows.at(-1)[0]) return rows.at(-1)[col];
  const i = rows.findIndex((r) => r[0] > midi);
  const [a, b] = [rows[i - 1], rows[i]];
  return a[col] + ((b[col] - a[col]) * (midi - a[0])) / (b[0] - a[0]);
}

// One decaying sine, (1 - e^(-t/swell)) * e^(-6.91 t/t60), run as recurrences because Math.sin per sample is too slow.
function tongueAddMode(out, sr, hz, amp, swell, t60) {
  if (hz >= sr / 2) return;
  const n = Math.min(out.length, Math.ceil(t60 * sr));
  const decayStep = Math.exp(-6.91 / (t60 * sr));
  const swellStep = Math.exp(-1 / (swell * sr));
  const cw = Math.cos((2 * Math.PI * hz) / sr);
  const sw = Math.sin((2 * Math.PI * hz) / sr);
  let level = amp, rest = 1, c = 1, s = 0;
  for (let i = 0; i < n; i++) {
    out[i] += level * (1 - rest) * s;
    level *= decayStep;
    rest *= swellStep;
    [c, s] = [c * cw - s * sw, s * cw + c * sw];
  }
}

function tongueLowpass(x, sr, hz, q) {
  const w = (2 * Math.PI * hz) / sr, alpha = Math.sin(w) / (2 * q), cw = Math.cos(w), a0 = 1 + alpha;
  const b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, a1 = (-2 * cw) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    [x2, x1, y2, y1] = [x1, x[i], y1, y];
    x[i] = y;
  }
}

// The mallet: Gaussian noise through a 4-pole Butterworth lowpass at twice the pitch, 1 ms in, 5 ms out.
function tongueAddKnock(out, sr, hz, amp) {
  const n = Math.ceil(0.05 * sr);
  const x = new Float64Array(n);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) + 1) / 2147483649;
  for (let i = 0; i < n; i++) x[i] = Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand());
  const fc = Math.min(2 * hz, 0.45 * sr);
  tongueLowpass(x, sr, fc, 0.5412);
  tongueLowpass(x, sr, fc, 1.3066);
  let energy = 0;
  const probe = Math.ceil(0.015 * sr);
  for (let i = 0; i < n; i++) {
    x[i] *= (1 - Math.exp(-i / (0.001 * sr))) * Math.exp(-i / (0.005 * sr));
    if (i < probe) energy += x[i] * x[i];
  }
  const scale = amp / Math.sqrt(energy / probe);
  for (let i = 0; i < n; i++) out[i] += scale * x[i];
}

function tongueRender(hz, sr) {
  const midi = 69 + 12 * Math.log2(hz / 440);
  let near = -1;
  TONGUE_MIDI.forEach((m, i) => {
    if (TONGUE_SYMPATHY[i] && (near < 0 || Math.abs(midi - m) < Math.abs(midi - TONGUE_MIDI[near]))) near = i;
  });
  const shift = midi - TONGUE_MIDI[near];
  const [swell, a1, t1, a2, t2] = [1, 2, 3, 4, 5].map((c) => tongueInterp(midi, c));
  const out = new Float64Array(Math.ceil((t1 + 0.05) * sr));
  tongueAddMode(out, sr, hz, a1, swell, t1);
  tongueAddMode(out, sr, hz, a2, swell, t2);
  for (const [ratio, db, t60] of TONGUE_HARMONICS) tongueAddMode(out, sr, ratio * hz, a1 * tongueDb(db), 0.002, t60);
  TONGUE_SYMPATHY[near].forEach((cell, j) => {
    if (cell) tongueAddMode(out, sr, tongueHz(TONGUE_MIDI[j] + shift), a1 * tongueDb(cell[0]), 0.003, cell[1]);
  });
  for (const [bodyHz, db, t60] of TONGUE_BODY) tongueAddMode(out, sr, bodyHz, a1 * tongueDb(db), 0.002, t60);
  tongueAddKnock(out, sr, hz, a1 * tongueDb(TONGUE_KNOCK_DB));
  const tail = Math.ceil(0.05 * sr);
  const buf = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) buf[i] = TONGUE_GAIN * out[i] * Math.min(1, (out.length - i) / tail);
  return buf;
}

function tongueBuffer(ac, hz) {
  const key = `${ac.sampleRate}:${hz.toFixed(2)}`;
  if (!TONGUE_CACHE.has(key)) {
    const data = tongueRender(hz, ac.sampleRate);
    const buffer = new AudioBuffer({ length: data.length, sampleRate: ac.sampleRate, numberOfChannels: 1 });
    buffer.copyToChannel(data, 0);
    TONGUE_CACHE.set(key, buffer);
  }
  return TONGUE_CACHE.get(key);
}

if (typeof registerSound !== 'function') throw new Error('tongue synth: registerSound is missing, load this file inside the editor');

registerSound(
  'tongue_synth',
  (t, value, onended) => {
    const ac = getAudioContext();
    const src = new AudioBufferSourceNode(ac, { buffer: tongueBuffer(ac, getFrequencyFromValue(value, 57)) });
    src.onended = onended;
    src.start(t);
    return { node: src, stop: (time) => src.stop(time) };
  },
  { type: 'synth', prebake: true },
);

// Render the 9 drum pitches now, because 9 fresh renders in one tick would land after their strike time.
TONGUE_MIDI.forEach((m) => tongueBuffer(getAudioContext(), tongueHz(m)));

globalThis.tongueSynth = { render: tongueRender, clear: () => TONGUE_CACHE.clear() };
