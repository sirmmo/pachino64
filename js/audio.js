// Tiny WebAudio synth: sound effects + a looping chiptune. No external files.
let ctx = null, master = null, musicGain = null, sfxGain = null;
let muted = false, musicTimer = null, nextNoteTime = 0, step = 0, mood = 1;
// mood 2 = the same tune in a minor key, a bit slower and grittier (world 2)
export function setMusicMood(m) { mood = m; }
const minor = (n) => { const pc = n % 12; return pc === 4 || pc === 9 || pc === 11 ? n - 1 : n; };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) { return; }
  master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.16; musicGain.connect(master);
  sfxGain = ctx.createGain(); sfxGain.gain.value = 0.5; sfxGain.connect(master);
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.6;
  return muted;
}

function tone(freq, dur, { type = 'square', vol = 0.3, slide = 0, delay = 0, dest = sfxGain, attack = 0.005 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.3, freq = 1200, delay = 0, q = 1 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(sfxGain); s.start(t);
}

export const sfx = {
  jump: () => tone(330, 0.18, { slide: 2.2, vol: 0.18 }),
  jump2: () => tone(400, 0.2, { slide: 2.4, vol: 0.18 }),
  jump3: () => { tone(440, 0.25, { slide: 2.6, vol: 0.18 }); tone(660, 0.2, { slide: 2, vol: 0.1, delay: 0.08 }); },
  longjump: () => tone(250, 0.35, { slide: 1.8, vol: 0.18, type: 'sawtooth' }),
  coin: () => { tone(988, 0.08, { vol: 0.15 }); tone(1319, 0.3, { vol: 0.15, delay: 0.07 }); },
  redcoin: () => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.15, { vol: 0.13, delay: i * 0.06 })); },
  stomp: () => { tone(180, 0.15, { slide: 0.4, vol: 0.3 }); noise(0.12, { vol: 0.25, freq: 500 }); },
  slash: () => noise(0.16, { vol: 0.3, freq: 3000, q: 0.7 }),
  hit: () => { tone(220, 0.25, { slide: 0.5, vol: 0.25, type: 'sawtooth' }); },
  hurt: () => { tone(500, 0.12, { slide: 0.6, vol: 0.25 }); tone(300, 0.3, { slide: 0.5, vol: 0.25, delay: 0.1 }); },
  pound: () => { noise(0.3, { vol: 0.5, freq: 200, q: 0.5 }); tone(90, 0.3, { slide: 0.5, vol: 0.35, type: 'triangle' }); },
  crate: () => { noise(0.25, { vol: 0.45, freq: 800, q: 0.6 }); },
  spring: () => tone(200, 0.4, { slide: 4, vol: 0.2, type: 'triangle' }),
  splash: () => noise(0.4, { vol: 0.3, freq: 900, q: 0.4 }),
  talk: () => tone(600 + Math.random() * 300, 0.05, { vol: 0.08, type: 'triangle' }),
  oneup: () => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.12, { vol: 0.13, delay: i * 0.08 })); },
  heart: () => tone(880, 0.12, { vol: 0.08, type: 'triangle' }),
  star: () => {
    const notes = [523, 659, 784, 1047, 988, 1047, 1319, 1568];
    notes.forEach((f, i) => tone(f, i === notes.length - 1 ? 0.8 : 0.16, { vol: 0.15, delay: i * 0.11 }));
    notes.forEach((f, i) => tone(f / 2, 0.16, { vol: 0.08, type: 'triangle', delay: i * 0.11 }));
  },
  appear: () => { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, { vol: 0.12, delay: i * 0.09, type: 'triangle' })); },
  bossHit: () => { tone(150, 0.4, { slide: 0.3, vol: 0.35, type: 'sawtooth' }); noise(0.3, { vol: 0.3, freq: 400 }); },
  die: () => { [523, 494, 466, 440, 415, 392].forEach((f, i) => tone(f, 0.2, { vol: 0.15, delay: i * 0.15 })); },
  pause: () => { tone(660, 0.08, { vol: 0.12 }); tone(990, 0.12, { vol: 0.12, delay: 0.08 }); },
};

// --- Music: bouncy loop, two voices + bass, scheduled ahead of time ---
const N = (n) => n === null ? null : 440 * Math.pow(2, (n - 69) / 12);
// MIDI notes, 16th grid, 64 steps (4 bars), null = rest
const lead = [
  72, null, 76, null, 79, null, 76, 77, 79, null, 81, 79, 77, null, 76, null,
  74, null, 77, null, 81, null, 77, 79, 81, null, 83, 81, 79, null, 77, null,
  76, null, 79, null, 84, null, 83, 81, 79, null, 77, 76, 74, null, 72, null,
  71, null, 74, null, 77, 76, 74, 72, 74, null, 71, null, 72, null, null, null,
];
const bass = [48, 55, 52, 55, 50, 57, 53, 57, 52, 55, 48, 52, 43, 50, 47, 50];

function scheduleMusic() {
  if (!ctx) return;
  const spb = 60 / (mood === 2 ? 118 : 132) / 4; // 16th notes
  while (nextNoteTime < ctx.currentTime + 0.2) {
    const s = step % 64;
    const ln = lead[s];
    const dt = nextNoteTime - ctx.currentTime;
    if (ln !== null) tone(N(mood === 2 ? minor(ln) : ln), spb * 1.8, { type: mood === 2 ? 'sawtooth' : 'square', vol: mood === 2 ? 0.09 : 0.12, dest: musicGain, delay: dt });
    if (s % 4 === 0) {
      const b = bass[(s / 4) | 0];
      tone(N(mood === 2 ? minor(b) : b), spb * 3.5, { type: 'triangle', vol: 0.35, dest: musicGain, delay: dt });
    }
    if (s % 8 === 4) noiseHat(dt);
    nextNoteTime += spb; step++;
  }
}
function noiseHat(delay) {
  const t = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * 0.04);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
  const g = ctx.createGain(); g.gain.value = 0.25;
  s.connect(f); f.connect(g); g.connect(musicGain); s.start(t);
}

export function startMusic() {
  if (!ctx || musicTimer) return;
  nextNoteTime = ctx.currentTime + 0.1; step = 0;
  musicTimer = setInterval(scheduleMusic, 50);
}
