// src/lib/soundEngine.ts
// PocketFoley Procedural DSP Engine & Zero-Dependency 48kHz WAV Exporter
// 100% Client-Side Web Audio API — Strict TypeScript (noUncheckedIndexedAccess) & 60fps Analyser Compatible
//
// Signal flow per voice:
//   topology sources → bus → [dry | anti-alias → soft saturation] → body shelf → tone LPF
//   → tremolo → attack env → auto-pan → voice out ─┬→ master
//                                                  └→ shared reverb sends
// Master: headroom gain → DC block → soft clipper → (analyser) → output
// Reverbs are shared per context (4 decay buckets, crossfaded by SPACE) instead of one
// convolver per hit, which keeps CPU flat when LIVE SCRUB retriggers every 110ms.

export type SynthesisTopology =
  | 'ui-organic'
  | 'modal-impact'
  | 'cinematic-whoosh'
  | 'sub-boom'
  | 'scifi-glitch'
  | 'footstep'
  | 'bell-chime'
  | 'riser'
  | 'downer'
  | 'beep'
  | 'brass'
  | 'boing'
  | 'drum'
  | 'scratch'
  | 'pluck'
  | '808';

export type SoundCategory =
  | 'Viral & Memes'
  | 'UI & Apps'
  | 'Cinematic & Reels'
  | 'Bass & Subs'
  | 'Drums & Beats'
  | 'Cartoon & Melodies'
  | 'Instruments'
  | 'Risers & Drops'
  | 'Foley & Physics'
  | 'Footsteps'
  | 'Bells & Chimes'
  | 'Sci-Fi & Glitch';

export type DrumVoice =
  | 'kick'
  | 'snare'
  | 'tom-hi'
  | 'tom-lo'
  | 'hat'
  | 'crash'
  | 'rim'
  | 'clap'
  | 'click'
  | 'tick'
  | 'tock'
  | 'open-hat'
  | 'cowbell'
  | 'shaker'
  | 'snap'
  | 'tom-mid';

/**
 * One event in a recipe's built-in sequence. Times are seconds at SPEED 0.5; SPEED scales them
 * from 0.5× to 1.5×. `semi` transposes, `bend` glides by that many semitones over the note.
 */
export interface SeqNote {
  at: number;
  len?: number;
  semi?: number;
  vel?: number;
  bend?: number;
  pan?: number;
  drum?: DrumVoice;
}

/**
 * One hit of a user pattern (piano roll): the whole recipe retriggered at a time and transposition.
 * `len` gates the hit: it is faded out and stopped after that many seconds.
 */
export interface PatternNote {
  at: number;
  semi: number;
  vel?: number;
  len?: number;
  /** Stretch the sound (via SPEED) so its natural length matches `len`, then cut exactly there. */
  fit?: boolean;
  /** Overrides the recipe's own sequence time scale — used to lock built-in beats to the pattern BPM. */
  tempoScale?: number;
}

/** One layer of a multi-track mix: live-synthesized notes, or pre-rendered (trimmed) hits. */
export type MixPart =
  | { kind: 'synth'; recipe: SoundRecipe; macros: MacroValues; mod: ModRouting; notes: PatternNote[]; level?: number }
  | { kind: 'buffer'; hits: BufferHit[]; fadeOut?: number; level?: number };

/** A pre-rendered sound placed in time — used for trimmed playback and export. */
export interface BufferHit {
  buffer: AudioBuffer;
  at: number;
  /** Region of the buffer to play, in seconds. */
  start: number;
  len: number;
  level?: number;
}

/** Fade lengths used at a trimmed region's edges. */
const TRIM_FADE_IN = 0.003;

export type ModShape = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'random';
export type ModTarget = 'pitch' | 'filter' | 'amp' | 'pan';

export type FilterMode = 'off' | 'lowpass' | 'highpass' | 'bandpass';

export const MOD_SHAPES: readonly ModShape[] = ['sine', 'triangle', 'square', 'sawtooth', 'random'];
export const MOD_TARGETS: readonly ModTarget[] = ['pitch', 'filter', 'amp', 'pan'];
export const FILTER_MODES: readonly FilterMode[] = ['off', 'lowpass', 'highpass', 'bandpass'];

/**
 * Per-sound routing switches: which LFO shape modulates which destination, and the optional sound
 * filter. Depth, rate, cutoff and resonance live in MacroValues.
 */
export interface ModRouting {
  shape: ModShape;
  target: ModTarget;
  filter: FilterMode;
}

/** Maps the 0–1 CUTOFF macro to Hz (20 Hz … 20 kHz, exponential). */
export const cutoffHz = (cutoff: number): number => 20 * Math.pow(1000, Math.min(1, Math.max(0, cutoff)));

export interface MacroValues {
  x: number;        // 0.0 to 1.0 — Texture / Brightness / Material
  y: number;        // 0.0 to 1.0 — Weight / Body / Sub Depth
  space: number;    // 0.0 to 1.0 — Dry Close-Mic -> Lush Stereo Hall
  grit: number;     // 0.0 to 1.0 — Pure Clean -> Warm Analog Saturation
  speed: number;    // 0.0 to 1.0 — Snappy Micro-Transient -> Drawn-Out Tail
  pitch: number;    // 0.0 to 1.0 — -12 Semitones to +12 Semitones (0.5 = center)
  attack: number;   // 0.0 to 1.0 — Instant Snap -> Slow Swell (fraction of the sound's length)
  width: number;    // 0.0 to 1.0 — Mono -> Extra Wide (0.5 = the recipe's own stereo spread)
  modDepth: number; // 0.0 to 1.0 — LFO Off -> Deep
  modRate: number;  // 0.0 to 1.0 — 0.1 Hz -> 30 Hz (exponential, see modRateHz)
  cutoff: number;   // 0.0 to 1.0 — sound filter cutoff, 20 Hz -> 20 kHz (see cutoffHz)
  resonance: number; // 0.0 to 1.0 — sound filter resonance
}

export interface SoundRecipe {
  id: string;
  name: string;
  category: SoundCategory;
  tag: string;
  description: string;
  topology: SynthesisTopology;
  baseFreq: number;
  /** Relative partials/resonances. For riser/downer: tone-layer voice ratios. For footstep: surface resonances. */
  modalRatios: number[];
  /**
   * Per-topology meaning: FM ratio (ui-organic, modal-impact, scifi-glitch, bell-chime attack shimmer; 0 = off),
   * harmonic ratio (sub-boom), surface ring amount 0–1 (footstep), sweep range in octaves (riser, downer).
   */
  fmRatio: number;
  noiseMix: number;
  stereoSpread: number;
  defaultMacros: MacroValues;
  defaultMod: ModRouting;
  /**
   * bell-chime: number of strikes and how their pitches move. scratch: number of strokes
   * ('down' = the last stroke grinds to a halt).
   */
  strikes?: number;
  pattern?: 'repeat' | 'random' | 'up' | 'down';
  /**
   * Built-in sequence: notes for beep/brass, hits for drum, strikes for modal-impact and bell-chime,
   * steps for footstep. Takes precedence over strikes/pattern.
   */
  sequence?: SeqNote[];
  /** Tone waveform for riser/downer (default sawtooth), beep (sine), brass (sawtooth), boing (sine). */
  wave?: 'sine' | 'triangle' | 'sawtooth' | 'square';
  /** Extra search terms, e.g. what people type when looking for this sound. */
  keywords?: string[];
  /** Native tempo of the built-in sequence (beats). Patterns use it to lock the beat to their BPM. */
  bpm?: number;
  axisLabels: {
    xLeft: string;
    xRight: string;
    yBottom: string;
    yTop: string;
  };
}

const clamp = (val: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, val));

const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * clamp(t, 0, 1);

/** Maps the 0–1 MOD RATE macro to Hz (0.1 Hz … 30 Hz, exponential). */
export const modRateHz = (rate: number): number => 0.1 * Math.pow(300, clamp(rate));

const LIVE_LATENCY_SEC = 0.006;
const MAX_LIVE_VOICES = 6;
const CURVE_POINTS = 96;
const NOISE_SECONDS = 4;

const REVERB_BUCKETS = [
  { duration: 0.4, decay: 4.2 },
  { duration: 0.9, decay: 3.3 },
  { duration: 1.7, decay: 2.6 },
  { duration: 2.9, decay: 2.1 },
] as const;

/**
 * Per-topology trim, measured so each family's median preset peaks around -6…-7 dBFS at default
 * macros. That leaves room for several voices to stack before the soft clipper's knee.
 */
const TOPOLOGY_LEVEL: Record<SynthesisTopology, number> = {
  'ui-organic': 1.75,
  'modal-impact': 3.4,
  'cinematic-whoosh': 2.1,
  // Kept below the soft clipper's knee: bass that rides the clipper turns into audible crackle.
  'sub-boom': 0.5,
  'scifi-glitch': 1.2,
  footstep: 1.6,
  'bell-chime': 2.4,
  riser: 1.3,
  downer: 1.4,
  beep: 1.2,
  brass: 1.3,
  boing: 1.4,
  drum: 0.75,
  scratch: 1.4,
  pluck: 0.95,
  '808': 0.72,
};

/** Low-shelf range (dB) driven by WEIGHT. Bass-led topologies get a deeper boost. */
const SHELF_RANGE: Partial<Record<SynthesisTopology, [number, number]>> = {
  'sub-boom': [-2, 3],
  '808': [-2, 1.5],
  downer: [-3, 7],
  drum: [-3, 7],
};

/** Longest tail each drum voice can ring for, used to size renders. */
const DRUM_TAIL: Record<DrumVoice, number> = {
  kick: 0.62,
  snare: 0.3,
  'tom-hi': 0.35,
  'tom-lo': 0.45,
  hat: 0.08,
  crash: 2.2,
  rim: 0.06,
  clap: 0.2,
  click: 0.04,
  tick: 0.05,
  tock: 0.06,
  'open-hat': 0.4,
  cowbell: 0.35,
  shaker: 0.08,
  snap: 0.1,
  'tom-mid': 0.4,
};

const CRASH_RATIOS = [205.3, 304.4, 369.6, 522.7, 540, 800];
const DEFAULT_DRUMS: SeqNote[] = [{ at: 0, drum: 'kick' }];
const DEFAULT_BEEP: SeqNote[] = [{ at: 0, len: 0.3 }];
const DEFAULT_BRASS: SeqNote[] = [{ at: 0, len: 0.6 }];
const SINGLE_HIT: SeqNote[] = [{ at: 0 }];

const DEFAULT_MODES = [1.0, 1.58, 2.24, 3.16, 4.47];
const GLITCH_SCALE = [1, 1.25, 1.333, 1.5, 1.777, 2.0, 2.5, 3.0];
const PENTATONIC = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
const ARPEGGIO = [1, 5 / 4, 3 / 2, 2, 5 / 2, 3, 4];
const BELL_DEFAULT = [0.5, 1, 1.183, 1.506, 2, 2.514];

const DEFAULT_EXTENDED: Pick<MacroValues, 'attack' | 'width' | 'modDepth' | 'modRate' | 'cutoff' | 'resonance'> = {
  attack: 0,
  width: 0.5,
  modDepth: 0,
  modRate: 0.4,
  cutoff: 0.7,
  resonance: 0.15,
};

function normalizeMacros(raw: Partial<MacroValues>): MacroValues {
  const pick = (k: keyof MacroValues, fallback: number): number => {
    const v = raw[k];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v) : fallback;
  };
  return {
    x: pick('x', 0.5),
    y: pick('y', 0.5),
    space: pick('space', 0),
    grit: pick('grit', 0),
    speed: pick('speed', 0.5),
    pitch: pick('pitch', 0.5),
    attack: pick('attack', DEFAULT_EXTENDED.attack),
    width: pick('width', DEFAULT_EXTENDED.width),
    modDepth: pick('modDepth', DEFAULT_EXTENDED.modDepth),
    modRate: pick('modRate', DEFAULT_EXTENDED.modRate),
    cutoff: pick('cutoff', DEFAULT_EXTENDED.cutoff),
    resonance: pick('resonance', DEFAULT_EXTENDED.resonance),
  };
}

const bellRing = (m: MacroValues) => lerp(0.5, 4.5, m.speed);
const bellSpacing = (m: MacroValues) => lerp(0.07, 0.22, m.speed);
const bellStrikes = (r: SoundRecipe) => Math.round(clamp(r.strikes ?? 1, 1, 12));
const modalRing = (m: MacroValues) => lerp(0.09, 1.15, m.speed);
const stepDuration = (r: SoundRecipe, m: MacroValues) => 0.14 + lerp(0.1, 0.36, m.speed) + clamp(r.fmRatio) * 0.4;
const scratchStrokes = (r: SoundRecipe) => Math.round(clamp(r.strikes ?? 2, 1, 16));
const scratchStrokeLen = (m: MacroValues) => lerp(0.06, 0.24, m.speed);
const boingDuration = (m: MacroValues) => lerp(0.25, 1.2, m.speed);
const pluckRing = (m: MacroValues) => lerp(0.15, 2, m.speed);
const bass808Length = (m: MacroValues) => lerp(0.25, 3, m.speed);

/** Sequence time scale: SPEED 0.5 plays `at`/`len` as written. */
const seqScale = (m: MacroValues) => lerp(0.5, 1.5, m.speed);
const seqLastAt = (r: SoundRecipe, scale: number) => (r.sequence ? Math.max(0, ...r.sequence.map((n) => n.at)) * scale : 0);
const seqEnd = (seq: SeqNote[], scale: number, defaultLen: number) =>
  Math.max(0, ...seq.map((n) => n.at + (n.len ?? defaultLen))) * scale;

/**
 * Length of the dry sound in seconds (before reverb tail). Shared by live playback and export.
 * `tempoScale` overrides the SPEED-derived sequence scale (tempo-locked beats in a pattern).
 */
export function topologyDuration(recipe: SoundRecipe, macros: Partial<MacroValues>, tempoScale?: number): number {
  const m = normalizeMacros(macros);
  const s = tempoScale ?? seqScale(m);
  switch (recipe.topology) {
    case 'ui-organic':
      return lerp(0.028, 0.32, m.speed);
    case 'modal-impact':
      return modalRing(m) + seqLastAt(recipe, s);
    case 'cinematic-whoosh':
      return lerp(0.22, 1.85, m.speed);
    case 'sub-boom':
      return lerp(0.45, 2.4, m.speed);
    case 'scifi-glitch':
      return lerp(0.12, 0.95, m.speed);
    case 'footstep':
      return stepDuration(recipe, m) + seqLastAt(recipe, s);
    case 'bell-chime':
      return recipe.sequence
        ? bellRing(m) + seqLastAt(recipe, s)
        : bellRing(m) + bellSpacing(m) * 1.6 * (bellStrikes(recipe) - 1);
    case 'riser':
      return lerp(0.6, 6, m.speed);
    case 'downer':
      return lerp(0.35, 3.5, m.speed);
    case 'beep':
      return seqEnd(recipe.sequence ?? DEFAULT_BEEP, s, 0.25) + 0.05;
    case 'brass':
      return seqEnd(recipe.sequence ?? DEFAULT_BRASS, s, 0.5) + 0.12;
    case 'boing':
      return boingDuration(m);
    case 'drum':
      return Math.max(...(recipe.sequence ?? DEFAULT_DRUMS).map((n) => n.at * s + DRUM_TAIL[n.drum ?? 'kick']));
    case 'scratch':
      return scratchStrokes(recipe) * scratchStrokeLen(m) + 0.1;
    case 'pluck':
      return pluckRing(m) + seqLastAt(recipe, s);
    case '808':
      return bass808Length(m);
  }
}

/**
 * SPEED value whose natural length is closest to `target` seconds. Every topology's length rises
 * with SPEED, so a short bisection is exact enough; out-of-range targets clamp to 0 or 1.
 */
function speedForLength(recipe: SoundRecipe, m: MacroValues, target: number, tempoScale?: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (topologyDuration(recipe, { ...m, speed: mid }, tempoScale) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Length of a user pattern: the latest end of any of its hits. */
export function patternDuration(recipe: SoundRecipe, macros: Partial<MacroValues>, notes: PatternNote[]): number {
  return Math.max(
    0,
    ...notes.map((n) => n.at + Math.min(n.len ?? Infinity, topologyDuration(recipe, macros, n.tempoScale))),
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Curves                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Master soft clipper. Fed through a 0.5 pre-gain, so the curve covers signals up to ±2.0:
 * linear below 0.82, then a tanh knee that never exceeds 0.98 — no hard digital clipping.
 */
function createSoftClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const knee = 0.82;
  const room = 0.98 - knee;
  for (let i = 0; i < n; i++) {
    const s = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(s);
    const out = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    curve[i] = Math.sign(s) * out;
  }
  return curve;
}

const SOFT_CLIP_CURVE = createSoftClipCurve();
const saturationCache = new Map<number, Float32Array<ArrayBuffer>>();

/** Normalised tanh saturation curve; input is pre-scaled by 0.5 so typical peaks stay inside the curve. */
function saturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const key = Math.round(drive * 4) / 4;
  const cached = saturationCache.get(key);
  if (cached) return cached;
  const samples = 4096;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const norm = Math.tanh(key);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = Math.tanh(x * key) / norm;
  }
  saturationCache.set(key, curve);
  return curve;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Voice building blocks                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

interface NoiseBank {
  pink: AudioBuffer;
  white: AudioBuffer;
}

interface MasterBus {
  input: GainNode;
  reverb: (bucket: number) => ConvolverNode;
  /** Fades out every reverb tail now ringing; the next voice gets fresh convolvers. */
  flush: (t: number) => void;
}

interface Voice {
  ctx: BaseAudioContext;
  now: number;
  dur: number;
  m: MacroValues;
  r: SoundRecipe;
  f: number;
  bus: AudioNode;
  /** Every detune param registered here follows the pitch LFO. */
  pitch: AudioParam[];
  /** Every source in the voice, so a stolen voice can actually stop (a silent voice still costs CPU). */
  sources: AudioScheduledSourceNode[];
  spread: number;
  noise: NoiseBank;
  rand: () => number;
  /** Time scale for the recipe's built-in sequence (SPEED-derived, or locked to a pattern's tempo). */
  scale: number;
}

interface LiveVoice {
  out: GainNode;
  end: number;
  sources: AudioScheduledSourceNode[];
}

function makeOsc(v: Voice, type: OscillatorType, freq?: number, at = v.now): OscillatorNode {
  const o = v.ctx.createOscillator();
  o.type = type;
  if (freq !== undefined) o.frequency.setValueAtTime(freq, at);
  v.pitch.push(o.detune);
  v.sources.push(o);
  return o;
}

/**
 * Biquad coefficients are recomputed every sample while an a-rate param is automated, which made
 * swept filters the most expensive part of a voice. Block-rate (128 samples) is inaudible for sweeps.
 */
function blockRate(f: BiquadFilterNode): BiquadFilterNode {
  try {
    f.frequency.automationRate = 'k-rate';
    f.detune.automationRate = 'k-rate';
    f.Q.automationRate = 'k-rate';
    f.gain.automationRate = 'k-rate';
  } catch {
    // Older engines without automationRate keep a-rate.
  }
  return f;
}

function makeGain(ctx: BaseAudioContext, value = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function makeFilter(ctx: BaseAudioContext, type: BiquadFilterType, freq?: number, q = 0.707): BiquadFilterNode {
  const f = blockRate(ctx.createBiquadFilter());
  f.type = type;
  if (freq !== undefined) f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function makePan(ctx: BaseAudioContext, value: number): StereoPannerNode {
  const p = ctx.createStereoPanner();
  p.pan.value = clamp(value, -1, 1);
  return p;
}

function makeNoise(v: Voice, kind: 'pink' | 'white'): AudioBufferSourceNode {
  const s = v.ctx.createBufferSource();
  s.buffer = v.noise[kind];
  s.loop = true;
  v.pitch.push(s.detune);
  v.sources.push(s);
  return s;
}

function startNoise(v: Voice, s: AudioBufferSourceNode, at: number, stopAt: number): void {
  s.start(at, v.rand() * (NOISE_SECONDS - 1));
  s.stop(stopAt);
}

/** Percussive envelope: near-silent → linear attack → exponential release. */
function percEnv(param: AudioParam, t: number, peak: number, attack: number, release: number): void {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + Math.max(0.005, release));
}

/** Exponential glide sampled into a curve; `accel` > 1 makes the glide start slow and finish fast. */
function glideCurve(from: number, to: number, accel = 1): number[] {
  const out: number[] = [];
  for (let i = 0; i < CURVE_POINTS; i++) {
    const t = Math.pow(i / (CURVE_POINTS - 1), accel);
    out.push(from * Math.pow(to / from, t));
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Topologies                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/** UI-ORGANIC — tactile micro-clicks, pops and switches. */
function synthUiOrganic(v: Voice): void {
  const { ctx, now, dur, m, r, f } = v;

  const car = makeOsc(v, m.grit > 0.6 ? 'triangle' : 'sine', f * lerp(1.3, 2.1, m.x));
  car.frequency.exponentialRampToValueAtTime(Math.max(30, f * lerp(0.95, 0.62, m.y)), now + dur * 0.6);

  const mod = makeOsc(v, 'sine', Math.min(f * r.fmRatio * lerp(0.9, 1.3, m.x), 9000));
  const index = makeGain(ctx);
  index.gain.setValueAtTime(f * lerp(0.06, 1.0, m.x), now);
  index.gain.exponentialRampToValueAtTime(0.01, now + dur * 0.45);

  const env = makeGain(ctx);
  percEnv(env.gain, now, 0.55, 0.0018, dur);
  const pan = makePan(ctx, (v.rand() * 2 - 1) * v.spread * 0.3);

  mod.connect(index).connect(car.frequency);
  car.connect(env).connect(pan).connect(v.bus);
  car.start(now);
  mod.start(now);
  car.stop(now + dur + 0.05);
  mod.stop(now + dur + 0.05);

  // Surface click transient
  const clickDur = lerp(0.003, 0.016, r.noiseMix);
  const click = makeNoise(v, 'white');
  const bp = makeFilter(ctx, 'bandpass', lerp(1800, 6500, m.x), 2.2);
  const cg = makeGain(ctx);
  percEnv(cg.gain, now, lerp(0.08, 0.42, r.noiseMix), 0.0008, clickDur);
  click.connect(bp).connect(cg).connect(v.bus);
  startNoise(v, click, now, now + clickDur + 0.02);
}

/** MODAL-IMPACT — parallel resonator bank: wood, glass, metal, water. Sequences give knocks and bounces. */
function synthModalImpact(v: Voice): void {
  const { ctx, now, m, r, f } = v;
  const ratios = r.modalRatios.length >= 3 ? r.modalRatios.slice(0, 6) : DEFAULT_MODES;
  const hits = r.sequence ?? SINGLE_HIT;
  const scale = v.scale;
  const ring = modalRing(m);
  const exciterDur = lerp(0.006, 0.03, 1 - m.x * 0.7);

  for (const hit of hits) {
    const t = now + hit.at * scale;
    const vel = hit.vel ?? 1;
    const jitter = hits.length > 1 ? 1 + (v.rand() - 0.5) * 0.012 : 1;
    const fh = f * Math.pow(2, (hit.semi ?? 0) / 12) * jitter;
    const hitRing = ring * (0.55 + 0.45 * vel);

    const exciter = makeNoise(v, 'pink');
    const exGain = makeGain(ctx);
    percEnv(exGain.gain, t, 0.9 * vel, 0.0005, exciterDur);
    exciter.connect(exGain);

    ratios.forEach((ratio, idx) => {
      const stretch = 1 + (m.x - 0.5) * 0.22 * idx;
      const modeFreq = clamp(fh * ratio * stretch, 45, 15000);
      const decay = hitRing * Math.pow(0.72, idx * (1 - m.x * 0.45));
      const weight = (idx === 0 ? lerp(0.6, 1.3, m.y) : 1 / (idx + 1)) * vel;

      const res = makeFilter(ctx, 'bandpass', modeFreq, lerp(14, 70, m.x));
      v.pitch.push(res.detune);
      const resGain = makeGain(ctx);
      percEnv(resGain.gain, t, weight * 1.1, 0.0005, decay);
      exGain.connect(res).connect(resGain).connect(v.bus);

      const partial = makeOsc(v, 'sine', modeFreq, t);
      if (m.y < 0.35 && idx === 0) {
        partial.frequency.exponentialRampToValueAtTime(modeFreq * 1.35, t + decay * 0.7);
      }
      const pg = makeGain(ctx);
      percEnv(pg.gain, t, (0.26 / (idx + 1)) * weight, 0.0015, decay);
      const pan = makePan(ctx, ((idx % 2 === 0 ? 1 : -1) * idx * v.spread) / ratios.length + (hit.pan ?? 0) * v.spread);
      partial.connect(pg).connect(pan).connect(v.bus);
      partial.start(t);
      partial.stop(t + decay + 0.05);
    });

    startNoise(v, exciter, t, t + exciterDur + 0.03);
  }
}

/** CINEMATIC-WHOOSH — stereo doppler noise sweep with a sub trajectory. */
function synthCinematicWhoosh(v: Voice): void {
  const { ctx, now, dur, m, r, f } = v;
  const end = now + dur;
  const peakTime = now + dur * lerp(0.38, 0.65, m.x);

  const noise = makeNoise(v, 'pink');
  noise.playbackRate.value = lerp(0.65, 1.4, m.x);
  const sweep = makeFilter(ctx, 'bandpass', undefined, lerp(1.2, 5, m.x));
  v.pitch.push(sweep.detune);
  const lowFreq = clamp(f * 0.45, 60, 1200);
  const peakFreq = clamp(f * lerp(3.2, 11, m.x), 450, 11000);
  sweep.frequency.setValueAtTime(lowFreq, now);
  sweep.frequency.exponentialRampToValueAtTime(peakFreq, peakTime);
  sweep.frequency.exponentialRampToValueAtTime(lowFreq * 0.7, end);

  const noiseAmp = makeGain(ctx);
  noiseAmp.gain.setValueAtTime(0.0001, now);
  noiseAmp.gain.exponentialRampToValueAtTime(lerp(0.35, 0.75, r.noiseMix), peakTime);
  noiseAmp.gain.exponentialRampToValueAtTime(0.0001, end);

  const pan = makePan(ctx, -v.spread);
  pan.pan.setValueAtTime(-v.spread, now);
  pan.pan.linearRampToValueAtTime(v.spread, end);

  noise.connect(sweep).connect(noiseAmp).connect(pan).connect(v.bus);
  startNoise(v, noise, now, end + 0.05);

  const subPeak = clamp(f * lerp(0.6, 1.2, m.y), 48, 260);
  const sub = makeOsc(v, 'sine', subPeak * 0.45);
  sub.frequency.exponentialRampToValueAtTime(subPeak, peakTime);
  sub.frequency.exponentialRampToValueAtTime(36, end);
  const subGain = makeGain(ctx);
  subGain.gain.setValueAtTime(0.0001, now);
  subGain.gain.linearRampToValueAtTime(lerp(0.1, 0.5, m.y), peakTime);
  subGain.gain.exponentialRampToValueAtTime(0.0001, end);
  sub.connect(subGain).connect(v.bus);
  sub.start(now);
  sub.stop(end + 0.05);
}

/**
 * SUB-BOOM — trailer impact, 808, meme boom, explosion. The sine core holds near full level before
 * decaying (that sustain is what reads as "weight"), an octave layer keeps it audible on phone
 * speakers that can't reproduce 40 Hz, and a built-in tanh stage thickens the whole hit. High
 * noiseMix adds a long low rumble for explosions, thunder and earthquakes.
 */
function synthSubBoom(v: Voice): void {
  const { ctx, now, dur, m, r, f } = v;
  const end = now + dur;

  const impactPitch = clamp(f * lerp(1.6, 2.8, m.x), 85, 340);
  const floor = clamp(f * lerp(0.45, 0.75, 1 - m.y * 0.4), 28, 68);
  const hold = Math.min(dur * 0.45, lerp(0.03, 0.24, m.speed) * lerp(0.6, 1.25, m.y));

  // Weight stage: everything tonal is summed and gently saturated before it reaches the voice bus.
  // 4× oversampling matters here: saturating a 40 Hz sine at 2× folds harmonics back as crackle.
  const weight = makeGain(ctx, 0.75);
  const shaper = ctx.createWaveShaper();
  shaper.curve = saturationCurve(lerp(1.3, 6, m.grit) + m.y * 0.4);
  shaper.oversample = '4x';
  const post = makeGain(ctx, 0.85);
  weight.connect(shaper).connect(post).connect(v.bus);

  const holdEnv = (param: AudioParam, peak: number, release: number) => {
    param.setValueAtTime(0.0001, now);
    param.linearRampToValueAtTime(peak, now + 0.005);
    param.linearRampToValueAtTime(peak * 0.82, now + 0.005 + hold);
    param.exponentialRampToValueAtTime(0.0001, now + 0.005 + hold + release);
  };

  const sub = makeOsc(v, 'sine', impactPitch);
  sub.frequency.exponentialRampToValueAtTime(floor, now + 0.09);
  sub.frequency.exponentialRampToValueAtTime(Math.max(24, floor * 0.72), end);
  const subGain = makeGain(ctx);
  holdEnv(subGain.gain, 0.95, Math.max(0.05, dur - hold));
  sub.connect(subGain).connect(weight);

  // Octave layer for small speakers
  const octave = makeOsc(v, 'sine', impactPitch * 2);
  octave.frequency.exponentialRampToValueAtTime(floor * 2, now + 0.09);
  octave.frequency.exponentialRampToValueAtTime(Math.max(48, floor * 1.44), end);
  const octGain = makeGain(ctx);
  holdEnv(octGain.gain, lerp(0.14, 0.38, m.x), Math.max(0.05, (dur - hold) * 0.6));
  octave.connect(octGain).connect(weight);

  const harmonic = makeOsc(v, 'sawtooth', floor * r.fmRatio);
  harmonic.frequency.exponentialRampToValueAtTime(floor * 0.98, end);
  const harmFilter = makeFilter(ctx, 'lowpass', undefined, 0.7);
  harmFilter.frequency.setValueAtTime(lerp(260, 3400, m.x), now);
  harmFilter.frequency.exponentialRampToValueAtTime(110, now + dur * 0.85);
  const harmGain = makeGain(ctx);
  percEnv(harmGain.gain, now, lerp(0.1, 0.5, m.x), 0.015, dur * 0.85);
  harmonic.connect(harmFilter).connect(harmGain).connect(weight);

  const crackDur = lerp(0.06, 0.35, r.noiseMix);
  const crack = makeNoise(v, 'pink');
  const crackFilter = makeFilter(ctx, 'bandpass', lerp(450, 2800, m.x), 0.9);
  const crackGain = makeGain(ctx);
  percEnv(crackGain.gain, now, lerp(0.2, 0.45, r.noiseMix), 0.001, crackDur);
  crack.connect(crackFilter).connect(crackGain).connect(v.bus);
  startNoise(v, crack, now, now + crackDur + 0.03);

  if (r.noiseMix > 0.5) {
    const rumble = makeNoise(v, 'pink');
    rumble.playbackRate.value = lerp(0.5, 0.9, m.x);
    const lp = makeFilter(ctx, 'lowpass', lerp(90, 420, m.x), 0.8);
    const rg = makeGain(ctx);
    rg.gain.setValueAtTime(0.0001, now);
    rg.gain.linearRampToValueAtTime((r.noiseMix - 0.5) * 2 * 0.45, now + 0.03 + dur * 0.06);
    rg.gain.exponentialRampToValueAtTime(0.0001, end);
    const pan = makePan(ctx, 0);
    pan.pan.setValueAtTime(-v.spread * 0.4, now);
    pan.pan.linearRampToValueAtTime(v.spread * 0.4, end);
    rumble.connect(lp).connect(rg).connect(pan).connect(v.bus);
    startNoise(v, rumble, now, end + 0.05);
  }

  sub.start(now);
  sub.stop(end + 0.05);
  octave.start(now);
  octave.stop(end + 0.05);
  harmonic.start(now);
  harmonic.stop(end + 0.05);
}

/**
 * SCIFI-GLITCH — smooth digital telemetry. Steps glide instead of jumping, gates ramp instead of
 * snapping, FM sidebands are kept below ~17 kHz so nothing folds back as aliasing.
 */
function synthScifiGlitch(v: Voice): void {
  const { ctx, now, dur, m, r, f } = v;
  const steps = Math.max(4, Math.floor(lerp(4, 14, m.x)));
  const stepTime = dur / steps;
  const glide = lerp(0.014, 0.003, m.x);

  const car = makeOsc(v, m.grit > 0.75 ? 'triangle' : 'sine');
  const mod = makeOsc(v, 'sine');
  const index = makeGain(ctx);
  const amp = makeGain(ctx);
  const lp = makeFilter(ctx, 'lowpass', lerp(2800, 8000, m.x), 0.6);
  const pan = makePan(ctx, 0);

  let seed = Math.floor((m.x * 100 + m.y * 53 + f) * 13) >>> 0;
  const nextRand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < steps; i++) {
    const t = now + i * stepTime;
    const interval = GLITCH_SCALE[Math.floor(nextRand() * GLITCH_SCALE.length)] ?? 1;
    const stepFreq = clamp(f * interval * lerp(0.8, 1.6, m.x), 90, 4200);
    const modFreq = Math.min(stepFreq * r.fmRatio, 6000);
    const deviation = clamp(stepFreq * lerp(0.2, 1.4, m.grit), 0, Math.max(0, 17000 - stepFreq - modFreq));

    if (i === 0) {
      car.frequency.setValueAtTime(stepFreq, t);
      mod.frequency.setValueAtTime(modFreq, t);
      index.gain.setValueAtTime(deviation, t);
    } else {
      car.frequency.setTargetAtTime(stepFreq, t, glide);
      mod.frequency.setTargetAtTime(modFreq, t, glide);
      index.gain.setTargetAtTime(deviation, t, glide);
    }
    const open = i === 0 || nextRand() > 0.22;
    amp.gain.setTargetAtTime(open ? 0.42 : 0.1, t, 0.004);
    pan.pan.setTargetAtTime((nextRand() * 2 - 1) * v.spread, t, 0.01);
  }
  amp.gain.setTargetAtTime(0, now + dur * 0.9, dur * 0.04 + 0.004);

  mod.connect(index).connect(car.frequency);
  car.connect(amp).connect(lp).connect(pan).connect(v.bus);
  car.start(now);
  mod.start(now);
  car.stop(now + dur + 0.25);
  mod.stop(now + dur + 0.25);

  if (r.noiseMix > 0.1) {
    const noise = makeNoise(v, 'white');
    const bp = makeFilter(ctx, 'bandpass', 5200, 0.9);
    const ng = makeGain(ctx);
    percEnv(ng.gain, now, r.noiseMix * 0.12, 0.002, dur * 0.5);
    noise.connect(bp).connect(ng).connect(pan);
    startNoise(v, noise, now, now + dur * 0.55);
  }
}

/** FOOTSTEP — one step per sequence entry (default one), alternating feet, humanised every time. */
function synthFootstep(v: Voice): void {
  const scale = v.scale;
  for (const step of v.r.sequence ?? SINGLE_HIT) {
    footstepAt(v, v.now + Math.max(0, step.at) * scale, step.vel ?? 1, (step.pan ?? 0) * v.spread);
  }
}

/** Heel + toe hits: body thump, surface scuff, crunch grains, optional floor ring. */
function footstepAt(v: Voice, t0: number, vel: number, panOffset: number): void {
  const { ctx, m, r, f } = v;
  const ring = clamp(r.fmRatio);
  const pitchVar = 1 + (v.rand() * 2 - 1) * 0.06;
  const gap = lerp(0.045, 0.11, m.speed) * lerp(0.85, 1.15, v.rand());
  const hits = [
    { t: t0, g: vel },
    { t: t0 + gap, g: lerp(0.4, 0.7, v.rand()) * vel },
  ];
  const surfaceDecay = lerp(0.03, 0.14, 1 - m.x) * lerp(0.8, 1.6, m.speed);
  const ratios = (r.modalRatios.length ? r.modalRatios : [1, 1.6, 2.4]).slice(0, 3);

  for (const hit of hits) {
    const pan = makePan(ctx, panOffset + (v.rand() * 2 - 1) * v.spread * 0.3);
    pan.connect(v.bus);

    // Body thump
    const thumpFreq = clamp(f * pitchVar, 35, 400);
    const thump = makeOsc(v, 'sine', thumpFreq * 1.9, hit.t);
    thump.frequency.exponentialRampToValueAtTime(thumpFreq * 0.7, hit.t + 0.045);
    const tg = makeGain(ctx);
    percEnv(tg.gain, hit.t, lerp(0.12, 0.6, m.y) * hit.g, 0.002, lerp(0.04, 0.12, m.y));
    thump.connect(tg).connect(pan);
    thump.start(hit.t);
    thump.stop(hit.t + 0.2);

    // Surface scuff
    const scuff = makeNoise(v, 'pink');
    const hp = makeFilter(ctx, 'highpass', lerp(80, 400, m.x), 0.7);
    const bp = makeFilter(ctx, 'bandpass', lerp(450, 3600, m.x) * lerp(0.85, 1.2, v.rand()) * pitchVar, lerp(0.7, 1.6, m.x));
    const sg = makeGain(ctx);
    percEnv(sg.gain, hit.t, lerp(0.35, 0.8, r.noiseMix) * hit.g, lerp(0.001, 0.006, 1 - m.x), surfaceDecay);
    scuff.connect(hp).connect(bp).connect(sg).connect(pan);
    startNoise(v, scuff, hit.t, hit.t + surfaceDecay + 0.05);

    // Crunch grains (gravel, snow, leaves)
    if (r.noiseMix > 0.45) {
      const count = Math.max(2, Math.round(lerp(3, 14, (r.noiseMix - 0.45) / 0.55) * hit.g));
      const span = lerp(0.03, 0.1, m.speed);
      const grains = makeNoise(v, 'white');
      const gbp = makeFilter(ctx, 'bandpass', lerp(1500, 6000, m.x), 1.2);
      const gg = makeGain(ctx, 0);
      const times = Array.from({ length: count }, () => hit.t + v.rand() * span).sort((a, b) => a - b);
      let lastEnd = hit.t;
      for (const gt of times) {
        const start = Math.max(gt, lastEnd + 0.0005);
        const len = lerp(0.0015, 0.005, v.rand());
        gg.gain.setValueAtTime(0, start);
        gg.gain.linearRampToValueAtTime(lerp(0.08, 0.35, v.rand()) * hit.g, start + 0.0005);
        gg.gain.linearRampToValueAtTime(0, start + len);
        lastEnd = start + len;
      }
      grains.connect(gbp).connect(gg).connect(pan);
      startNoise(v, grains, hit.t, lastEnd + 0.02);
    }

    // Floor resonance (wood boards, metal grating)
    if (ring > 0.02) {
      ratios.forEach((ratio, i) => {
        const rf = clamp(f * 4 * ratio * pitchVar, 150, 9000);
        const o = makeOsc(v, 'sine', rf, hit.t);
        const rg = makeGain(ctx);
        percEnv(rg.gain, hit.t, (ring * 0.1 * hit.g) / (i + 1), 0.001, lerp(0.04, 0.4, ring));
        o.connect(rg).connect(pan);
        o.start(hit.t);
        o.stop(hit.t + 0.5);
      });
    }
  }
}

/** BELL-CHIME — additive bell partials with beating pairs, optional FM attack shimmer and multi-strike patterns. */
function synthBellChime(v: Voice): void {
  const { ctx, now, m, r, f } = v;
  const strikes = r.sequence ? r.sequence.length : bellStrikes(r);
  const pattern = r.pattern ?? 'random';
  const ring = bellRing(m);
  const spacing = bellSpacing(m);
  // Budget oscillators: multi-strike chimes use fewer partials and no beating pairs.
  const ratios = (r.modalRatios.length ? r.modalRatios : BELL_DEFAULT).slice(0, strikes > 2 ? 5 : 8);
  const pairs = strikes <= 2;
  const weights = ratios.map((_, i) => Math.pow(1 / (i + 1), lerp(1.3, 0.55, m.x)));
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  // Long ringing strikes overlap, so busy runs and showers are scaled down further.
  const strikeLevel = (0.42 / weightSum) * (strikes > 4 ? 0.5 : strikes > 1 ? 0.75 : 1);

  const strike = (t: number, fp: number, vel: number) => {
    ratios.forEach((ratio, i) => {
      const pf = fp * ratio;
      const a = (weights[i] ?? 0) * strikeLevel * vel;
      if (pf < 30 || pf > 15000 || a < 0.004) return;
      const decay = ring * Math.pow(lerp(0.5, 0.82, m.y), i) * (ratio < 1 ? 1.3 : 1);
      const beat = lerp(0.2, 1.6, m.x) * (0.5 + i * 0.35);
      const detunes = pairs ? [-beat / 2, beat / 2] : [0];
      const g = makeGain(ctx);
      percEnv(g.gain, t, a / detunes.length, 0.0012, decay);
      const pan = makePan(ctx, (i % 2 ? 1 : -1) * v.spread * 0.45 * (i / ratios.length + 0.2));
      g.connect(pan).connect(v.bus);
      for (const d of detunes) {
        const o = makeOsc(v, 'sine', pf + d, t);
        o.connect(g);
        o.start(t);
        o.stop(t + decay + 0.05);
      }
    });

    if (r.fmRatio > 0) {
      const car = makeOsc(v, 'sine', fp, t);
      const mod = makeOsc(v, 'sine', Math.min(fp * r.fmRatio, 12000), t);
      const index = makeGain(ctx);
      index.gain.setValueAtTime(fp * lerp(0.3, 1.6, m.x), t);
      index.gain.exponentialRampToValueAtTime(0.01, t + 0.09);
      const cg = makeGain(ctx);
      percEnv(cg.gain, t, 0.12 * vel * (strikeLevel / 0.42), 0.001, ring * 0.25);
      mod.connect(index).connect(car.frequency);
      car.connect(cg).connect(v.bus);
      car.start(t);
      mod.start(t);
      car.stop(t + ring * 0.3);
      mod.stop(t + ring * 0.3);
    }

    const tick = makeNoise(v, 'white');
    const tbp = makeFilter(ctx, 'bandpass', clamp(fp * 2.5, 800, 16000), 1.5);
    const tg = makeGain(ctx);
    percEnv(tg.gain, t, lerp(0.03, 0.18, r.noiseMix) * vel, 0.0005, 0.008);
    tick.connect(tbp).connect(tg).connect(v.bus);
    startNoise(v, tick, t, t + 0.03);
  };

  if (r.sequence) {
    const scale = v.scale;
    for (const n of r.sequence) strike(now + n.at * scale, f * Math.pow(2, (n.semi ?? 0) / 12), n.vel ?? 1);
    return;
  }

  let t = now;
  let prev = -1;
  for (let s = 0; s < strikes; s++) {
    let step: number;
    if (pattern === 'repeat') {
      step = s === 0 ? 1 : 1 + (v.rand() - 0.5) * 0.012;
    } else if (pattern === 'up') {
      step = ARPEGGIO[s % ARPEGGIO.length] ?? 1;
    } else if (pattern === 'down') {
      step = ARPEGGIO[Math.max(0, Math.min(strikes, ARPEGGIO.length) - 1 - s)] ?? 1;
    } else {
      let idx = Math.floor(v.rand() * PENTATONIC.length);
      if (idx === prev) idx = (idx + 1 + Math.floor(v.rand() * (PENTATONIC.length - 1))) % PENTATONIC.length;
      prev = idx;
      step = PENTATONIC[idx] ?? 1;
    }
    const vel = s === 0 ? 1 : pattern === 'random' ? lerp(0.45, 0.85, v.rand()) : 0.8;
    strike(t, f * step, vel);
    t += pattern === 'random' ? spacing * lerp(0.5, 1.6, v.rand()) : spacing;
  }
}

/** RISER / DOWNER — layered tone sweep + noise sweep + sub, with a rising or falling energy curve. */
function synthSweep(v: Voice, up: boolean): void {
  const { ctx, now, dur, m, r, f } = v;
  const end = now + dur;
  const octaves = clamp(r.fmRatio, 0.25, 4);
  const lo = clamp(f, 20, 4000);
  const hi = clamp(f * Math.pow(2, octaves), 30, 9000);
  const accel = up ? 1 : 1.7; // downers decelerate like a tape stop
  const from = up ? lo : hi;
  const to = up ? hi : lo;

  const noiseLevel = clamp(r.noiseMix + (m.x - 0.5) * 0.6);
  const toneLevel = 1 - noiseLevel * 0.75;

  // Energy curve
  const master = ctx.createGain();
  const ampCurve: number[] = [];
  for (let i = 0; i < CURVE_POINTS; i++) {
    const t = i / (CURVE_POINTS - 1);
    ampCurve.push(up ? 0.02 + 0.98 * Math.pow(t, 2.2) : t < 0.015 ? t / 0.015 : Math.pow(1 - (t - 0.015) / 0.985, 1.4));
  }
  if (up) {
    master.gain.setValueCurveAtTime(ampCurve, now, Math.max(0.05, dur - 0.04));
    master.gain.linearRampToValueAtTime(0, end);
  } else {
    master.gain.setValueCurveAtTime(ampCurve, now, dur);
  }
  master.connect(v.bus);

  // Tone layer
  const ratios = (r.modalRatios.length ? r.modalRatios : [1]).slice(0, 4);
  const lpLo = lerp(350, 1200, m.x);
  const lpHi = lerp(2500, 9000, m.x);
  const lp = blockRate(ctx.createBiquadFilter());
  lp.type = 'lowpass';
  lp.Q.value = 0.9;
  lp.frequency.setValueCurveAtTime(glideCurve(up ? lpLo : lpHi, up ? lpHi : lpLo, accel), now, dur);
  v.pitch.push(lp.detune);
  const toneGain = makeGain(ctx, (toneLevel * 0.45) / Math.sqrt(ratios.length));
  toneGain.connect(lp).connect(master);

  ratios.forEach((ratio, i) => {
    const o = makeOsc(v, r.wave ?? 'sawtooth');
    o.frequency.setValueCurveAtTime(glideCurve(from * ratio, to * ratio, accel), now, dur);
    o.detune.value = i === 0 ? 0 : (i % 2 ? 1 : -1) * lerp(2, 10, m.x);
    const pan = makePan(ctx, i === 0 ? 0 : (i % 2 ? 1 : -1) * v.spread * 0.6);
    o.connect(pan).connect(toneGain);
    o.start(now);
    o.stop(end + 0.05);
  });

  // Noise layer
  if (noiseLevel > 0.03) {
    const noise = makeNoise(v, 'pink');
    const bp = blockRate(ctx.createBiquadFilter());
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    const nLo = 300;
    const nHi = lerp(4000, 11000, m.x);
    bp.frequency.setValueCurveAtTime(glideCurve(up ? nLo : nHi, up ? nHi : nLo, accel), now, dur);
    const ng = makeGain(ctx, noiseLevel * 0.75);
    const pan = makePan(ctx, 0);
    pan.pan.setValueAtTime(up ? -v.spread * 0.5 : v.spread * 0.5, now);
    pan.pan.linearRampToValueAtTime(up ? v.spread * 0.5 : -v.spread * 0.5, end);
    noise.connect(bp).connect(ng).connect(pan).connect(master);
    startNoise(v, noise, now, end + 0.05);
  }

  // Sub layer
  if (m.y > 0.05) {
    const sub = makeOsc(v, 'sine');
    sub.frequency.setValueCurveAtTime(glideCurve(Math.max(20, from * 0.5), Math.max(20, to * 0.5), accel), now, dur);
    const sg = makeGain(ctx, m.y * 0.26);
    sub.connect(sg).connect(master);
    sub.start(now);
    sub.stop(end + 0.05);
  }
}

const FIT_STRETCH = 1.4;

/** Click-free gate: short linear edges around a held level. */
function gateEnv(param: AudioParam, t: number, len: number, level: number, edgeMax = 0.006): void {
  const edge = Math.min(edgeMax, len / 3);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(level, t + edge);
  param.setValueAtTime(level, t + len - edge);
  param.linearRampToValueAtTime(0, t + len);
}

/** BEEP — sequenced tones: censor bleep, buzzers, countdowns, retro coins, crickets, alarms. */
function synthBeep(v: Voice): void {
  const { ctx, now, m, r, f } = v;
  const scale = v.scale;
  // Square/triangle beeps are tamed by this lowpass; TEXTURE opens it.
  const tone = makeFilter(ctx, 'lowpass', lerp(900, 14000, Math.pow(m.x, 1.3)), 0.5);
  tone.connect(v.bus);

  for (const n of r.sequence ?? DEFAULT_BEEP) {
    const t = now + n.at * scale;
    const len = Math.max(0.012, (n.len ?? 0.25) * scale);
    const nf = clamp(f * Math.pow(2, (n.semi ?? 0) / 12), 30, 16000);
    const env = makeGain(ctx);
    gateEnv(env.gain, t, len, 0.4 * (n.vel ?? 1));
    const pan = makePan(ctx, (n.pan ?? 0) * v.spread);
    env.connect(pan).connect(tone);

    const o = makeOsc(v, r.wave ?? 'sine', nf, t);
    if (n.bend) o.frequency.exponentialRampToValueAtTime(clamp(nf * Math.pow(2, n.bend / 12), 30, 16000), t + len);
    o.connect(env);
    o.start(t);
    o.stop(t + len + 0.02);

    if (r.noiseMix > 0.02) {
      const breath = makeNoise(v, 'pink');
      const bp = makeFilter(ctx, 'bandpass', nf, 4);
      const bg = makeGain(ctx, r.noiseMix * 0.8);
      breath.connect(bp).connect(bg).connect(env);
      startNoise(v, breath, t, t + len + 0.02);
    }
  }
}

/**
 * BRASS — stacked detuned voices with a lip "scoop" into pitch and a filter that blooms open on
 * every note: air horns, sad trombone, dramatic stings, fanfares, honks.
 */
function synthBrass(v: Voice): void {
  const { ctx, now, m, r, f } = v;
  const scale = v.scale;
  const stack = (r.modalRatios.length ? r.modalRatios : [1, 1.006, 0.994]).slice(0, 5);
  const level = 0.42 / Math.sqrt(stack.length);

  for (const n of r.sequence ?? DEFAULT_BRASS) {
    const t = now + n.at * scale;
    const len = Math.max(0.05, (n.len ?? 0.5) * scale);
    const vel = n.vel ?? 1;
    const nf = clamp(f * Math.pow(2, (n.semi ?? 0) / 12), 30, 4000);
    const bend = n.bend ? Math.pow(2, n.bend / 12) : 1;

    const bloom = Math.min(0.09, len * 0.4);
    const closed = clamp(nf * lerp(1.2, 2.5, m.x), 150, 16000);
    const open = clamp(nf * lerp(3.5, 12, m.x), 400, 17000);
    const filt = makeFilter(ctx, 'lowpass', undefined, lerp(0.9, 2.2, m.x));
    filt.frequency.setValueAtTime(closed, t);
    filt.frequency.exponentialRampToValueAtTime(open, t + bloom);
    filt.frequency.exponentialRampToValueAtTime(Math.max(closed, open * 0.6), t + len);

    const attack = Math.min(0.025, len * 0.3);
    const env = makeGain(ctx);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level * vel, t + attack);
    env.gain.linearRampToValueAtTime(level * vel * 0.85, Math.max(t + attack + 0.001, t + len - 0.04));
    env.gain.linearRampToValueAtTime(0, t + len + 0.05);
    filt.connect(env).connect(v.bus);

    stack.forEach((ratio, i) => {
      const target = nf * ratio;
      const o = makeOsc(v, r.wave ?? 'sawtooth', target * Math.pow(2, -1.5 / 12), t);
      o.frequency.exponentialRampToValueAtTime(target, t + 0.045);
      if (bend !== 1) o.frequency.exponentialRampToValueAtTime(target * bend, t + len);
      const pan = makePan(ctx, i === 0 ? 0 : (i % 2 ? 1 : -1) * v.spread * 0.5);
      o.connect(pan).connect(filt);
      o.start(t);
      o.stop(t + len + 0.1);
    });

    if (r.noiseMix > 0.02) {
      const breath = makeNoise(v, 'pink');
      const bp = makeFilter(ctx, 'bandpass', clamp(nf * 3, 200, 12000), 1.5);
      const bg = makeGain(ctx, r.noiseMix * 0.25);
      breath.connect(bp).connect(bg).connect(env);
      startNoise(v, breath, t, t + len + 0.06);
    }
  }
}

/** BOING — a glide with a fast vibrato that dies away: springs, jumps, "rizz" pitch wobbles. */
function synthBoing(v: Voice): void {
  const { ctx, now, dur, m, r, f } = v;
  const glide = clamp(r.fmRatio, -3, 3);
  const end = now + dur;
  const rate = lerp(8, 20, m.x);

  const car = makeOsc(v, r.wave ?? 'sine', f);
  car.frequency.exponentialRampToValueAtTime(clamp(f * Math.pow(2, glide), 30, 12000), now + dur * 0.85);
  const twang = makeOsc(v, 'triangle', f * 2);
  twang.frequency.exponentialRampToValueAtTime(clamp(f * 2 * Math.pow(2, glide), 60, 16000), now + dur * 0.85);

  const wobble = ctx.createOscillator();
  wobble.frequency.setValueAtTime(rate, now);
  wobble.frequency.linearRampToValueAtTime(rate * 0.7, end);
  v.sources.push(wobble);
  const wobbleDepth = makeGain(ctx);
  wobbleDepth.gain.setValueAtTime(lerp(250, 1100, m.y), now);
  wobbleDepth.gain.exponentialRampToValueAtTime(5, end);
  wobble.connect(wobbleDepth);
  wobbleDepth.connect(car.detune);
  wobbleDepth.connect(twang.detune);

  const env = makeGain(ctx);
  percEnv(env.gain, now, 0.5, 0.004, dur);
  const twangGain = makeGain(ctx, (r.modalRatios[1] ?? 0) > 0 ? 0.18 : 0);
  car.connect(env);
  twang.connect(twangGain).connect(env);
  env.connect(v.bus);

  for (const s of [car, twang, wobble]) {
    s.start(now);
    s.stop(end + 0.05);
  }

  if (r.noiseMix > 0.02) {
    const click = makeNoise(v, 'white');
    const bp = makeFilter(ctx, 'bandpass', 3000, 1.2);
    const cg = makeGain(ctx);
    percEnv(cg.gain, now, r.noiseMix * 0.5, 0.0005, 0.01);
    click.connect(bp).connect(cg).connect(v.bus);
    startNoise(v, click, now, now + 0.03);
  }
}

/** One synthesized drum/percussion hit. PITCH transposes every voice. */
function drumHit(v: Voice, drum: DrumVoice, t: number, vel: number, pan: number, tune: number): void {
  const { ctx, m } = v;
  const out = makePan(ctx, pan);
  out.connect(v.bus);

  const tone = (type: OscillatorType, f0: number, f1: number, drop: number, decay: number, gain: number) => {
    const o = makeOsc(v, type, f0 * tune, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1 * tune, t + drop);
    const g = makeGain(ctx);
    percEnv(g.gain, t, gain * vel, 0.001, decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.05);
  };
  const noise = (kind: 'pink' | 'white', type: BiquadFilterType, freq: number, q: number, decay: number, gain: number, highpass?: number) => {
    const s = makeNoise(v, kind);
    const flt = makeFilter(ctx, type, freq, q);
    const g = makeGain(ctx);
    percEnv(g.gain, t, gain * vel, 0.0008, decay);
    if (highpass) s.connect(makeFilter(ctx, 'highpass', highpass, 0.7)).connect(flt);
    else s.connect(flt);
    flt.connect(g).connect(out);
    startNoise(v, s, t, t + decay + 0.05);
  };

  switch (drum) {
    case 'kick':
      tone('sine', 160, 46, lerp(0.04, 0.1, m.y), lerp(0.18, 0.55, m.y), 0.95);
      noise('white', 'bandpass', 3000, 0.8, 0.006, 0.05 + m.x * 0.25);
      break;
    case 'snare':
      tone('triangle', 200, 160, 0.03, 0.09, 0.45);
      noise('white', 'bandpass', 3800, 0.6, lerp(0.09, 0.22, m.y), 0.75, 900);
      break;
    case 'tom-hi':
      tone('sine', 260, 190, 0.12, 0.28, 0.75);
      noise('pink', 'bandpass', 1200, 1, 0.03, 0.15);
      break;
    case 'tom-lo':
      tone('sine', 150, 105, 0.15, 0.38, 0.85);
      noise('pink', 'bandpass', 800, 1, 0.03, 0.15);
      break;
    case 'hat':
      noise('white', 'bandpass', 10000, 1.2, 0.045, 0.45, 7000);
      break;
    case 'crash': {
      const decay = lerp(0.9, 2.1, m.y);
      const hp = makeFilter(ctx, 'highpass', 6000, 0.7);
      const bp = makeFilter(ctx, 'bandpass', 9000, 0.6);
      const g = makeGain(ctx);
      percEnv(g.gain, t, 0.4 * vel, 0.001, decay);
      hp.connect(bp).connect(g).connect(out);
      for (const ratio of CRASH_RATIOS) {
        const o = makeOsc(v, 'square', ratio * 2 * tune, t);
        o.connect(hp);
        o.start(t);
        o.stop(t + decay + 0.05);
      }
      noise('white', 'highpass', 5000, 0.7, decay * 0.8, 0.35);
      break;
    }
    case 'rim':
      tone('triangle', 1700, 1600, 0.01, 0.035, 0.35);
      noise('white', 'bandpass', 2200, 2, 0.015, 0.4);
      break;
    case 'clap': {
      const s = makeNoise(v, 'white');
      const bp = makeFilter(ctx, 'bandpass', lerp(900, 1500, v.rand()), 1.1);
      const g = makeGain(ctx);
      for (const [i, burst] of [0, 0.011, 0.023].entries()) {
        const b = t + burst;
        g.gain.setValueAtTime(0.0001, b);
        g.gain.linearRampToValueAtTime(2.2 * vel, b + 0.001);
        g.gain.exponentialRampToValueAtTime(i === 2 ? 0.0001 : 0.05, b + (i === 2 ? 0.14 : 0.009));
      }
      s.connect(bp).connect(g).connect(out);
      startNoise(v, s, t, t + 0.2);
      break;
    }
    case 'click': {
      const variation = lerp(0.9, 1.1, v.rand());
      tone('sine', 420 * variation, 420 * variation, 0, 0.025, 0.55);
      noise('white', 'bandpass', lerp(2500, 4500, v.rand()), 1.5, 0.012, 0.75);
      break;
    }
    case 'tick':
      tone('sine', 2400, 2400, 0, 0.03, 0.3);
      noise('white', 'bandpass', 5000, 2, 0.01, 0.35);
      break;
    case 'tock':
      tone('sine', 1500, 1500, 0, 0.045, 0.32);
      noise('white', 'bandpass', 3000, 2, 0.012, 0.3);
      break;
    case 'open-hat':
      noise('white', 'bandpass', 9000, 0.9, lerp(0.2, 0.38, m.y), 0.4, 6500);
      break;
    case 'cowbell': {
      // Two detuned squares through a bandpass: the classic drum-machine cowbell.
      const bp = makeFilter(ctx, 'bandpass', 2600, 1.4);
      const g = makeGain(ctx);
      percEnv(g.gain, t, 0.32 * vel, 0.001, lerp(0.15, 0.32, m.y));
      bp.connect(g).connect(out);
      for (const f0 of [540, 800]) {
        const o = makeOsc(v, 'square', f0 * tune, t);
        o.connect(bp);
        o.start(t);
        o.stop(t + 0.4);
      }
      break;
    }
    case 'shaker':
      noise('white', 'highpass', 6000, 0.7, lerp(0.04, 0.07, v.rand()), 0.35);
      break;
    case 'snap':
      tone('sine', 1900, 1500, 0.01, 0.02, 0.2);
      noise('white', 'bandpass', lerp(2200, 3000, v.rand()), 1.8, 0.05, 0.75);
      break;
    case 'tom-mid':
      tone('sine', 200, 145, 0.13, 0.33, 0.8);
      noise('pink', 'bandpass', 1000, 1, 0.03, 0.15);
      break;
  }
}

/**
 * PLUCK — plucked string/bar: a bright tone through a lowpass that closes as the note decays, plus
 * optional bar partials (modalRatios beyond 1) and a pick transient. Ukulele, harp, kalimba, marimba.
 */
/**
 * 808 — a pitched, tonal bass note for basslines in the piano roll: clean sine with a short pitch
 * "punch" (TEXTURE), an octave layer for small speakers (WEIGHT), optional glide (fmRatio, in
 * semitones over the note) and clean 4× oversampled saturation (GRIT). Plays at true pitch, unlike
 * sub-boom's impact floor.
 */
function synth808(v: Voice): void {
  const { ctx, now, dur, m, r, f } = v;
  const end = now + dur;
  const punch = lerp(0.3, 2, m.x);
  const punchTime = lerp(0.018, 0.06, m.x);
  const glideTo = clamp(f * Math.pow(2, r.fmRatio / 12), 20, 2000);

  const out = makeGain(ctx, 1);
  if (m.grit > 0.02) {
    const pre = makeGain(ctx, 0.6);
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve(1 + m.grit * 5);
    shaper.oversample = '4x';
    const post = makeGain(ctx, 0.95);
    out.connect(pre).connect(shaper).connect(post).connect(v.bus);
  } else {
    out.connect(v.bus);
  }

  const env = (param: AudioParam, peak: number, release: number) => {
    param.setValueAtTime(0.0001, now);
    param.linearRampToValueAtTime(peak, now + 0.004);
    param.exponentialRampToValueAtTime(0.0001, now + 0.004 + release);
  };

  const body = makeOsc(v, 'sine', clamp(f * Math.pow(2, punch), 20, 4000));
  body.frequency.exponentialRampToValueAtTime(f, now + punchTime);
  if (r.fmRatio !== 0) body.frequency.exponentialRampToValueAtTime(glideTo, now + dur * 0.8);
  const bodyGain = makeGain(ctx);
  env(bodyGain.gain, 0.9, dur);
  body.connect(bodyGain).connect(out);

  const octave = makeOsc(v, 'triangle', clamp(f * 2 * Math.pow(2, punch), 40, 8000));
  octave.frequency.exponentialRampToValueAtTime(f * 2, now + punchTime);
  if (r.fmRatio !== 0) octave.frequency.exponentialRampToValueAtTime(glideTo * 2, now + dur * 0.8);
  const octGain = makeGain(ctx);
  env(octGain.gain, lerp(0, 0.3, m.y), dur * 0.7);
  octave.connect(octGain).connect(out);

  for (const o of [body, octave]) {
    o.start(now);
    o.stop(end + 0.05);
  }

  if (r.noiseMix > 0.02) {
    const click = makeNoise(v, 'white');
    const bp = makeFilter(ctx, 'bandpass', 2500, 0.9);
    const cg = makeGain(ctx);
    percEnv(cg.gain, now, r.noiseMix * 0.35, 0.0005, 0.008);
    click.connect(bp).connect(cg).connect(v.bus);
    startNoise(v, click, now, now + 0.03);
  }
}

function synthPluck(v: Voice): void {
  const { ctx, now, m, r, f } = v;
  const scale = v.scale;
  const ring = pluckRing(m);
  const partials = (r.modalRatios.length ? r.modalRatios : [1]).slice(1, 4);

  for (const n of r.sequence ?? SINGLE_HIT) {
    const t = now + n.at * scale;
    const vel = n.vel ?? 1;
    const nf = clamp(f * Math.pow(2, (n.semi ?? 0) / 12), 40, 8000);
    const pan = makePan(ctx, (n.pan ?? 0) * v.spread);
    pan.connect(v.bus);

    const lp = makeFilter(ctx, 'lowpass', undefined, lerp(0.7, 2.2, m.x * 0.6));
    lp.frequency.setValueAtTime(clamp(nf * lerp(4, 18, m.x), 300, 18000), t);
    lp.frequency.exponentialRampToValueAtTime(clamp(nf * 1.2, 100, 18000), t + ring * 0.6);
    const env = makeGain(ctx);
    percEnv(env.gain, t, 0.45 * vel, 0.002, ring);
    lp.connect(env).connect(pan);

    const body = makeOsc(v, r.wave ?? 'sawtooth', nf, t);
    body.connect(lp);
    body.start(t);
    body.stop(t + ring + 0.05);

    partials.forEach((ratio, i) => {
      const pf = nf * ratio;
      if (pf > 16000) return;
      const o = makeOsc(v, 'sine', pf, t);
      const g = makeGain(ctx);
      percEnv(g.gain, t, (0.18 * vel) / (i + 1), 0.001, ring * 0.25);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + ring * 0.3 + 0.05);
    });

    if (r.noiseMix > 0.02) {
      const pick = makeNoise(v, 'white');
      const bp = makeFilter(ctx, 'bandpass', clamp(nf * 4, 800, 14000), 1.2);
      const pg = makeGain(ctx);
      percEnv(pg.gain, t, r.noiseMix * 0.5 * vel, 0.0005, 0.006);
      pick.connect(bp).connect(pg).connect(pan);
      startNoise(v, pick, t, t + 0.03);
    }
  }
}

/** DRUM — a sequence of synthesized percussion hits: rimshot, drum roll, heartbeat, typing, applause, clock. */
function synthDrum(v: Voice): void {
  const scale = v.scale;
  const tune = v.f / v.r.baseFreq;
  for (const n of v.r.sequence ?? DEFAULT_DRUMS) {
    drumHit(v, n.drum ?? 'kick', v.now + n.at * scale, n.vel ?? 1, (n.pan ?? 0) * v.spread, tune);
  }
}

/**
 * SCRATCH — a record pushed back and forth: playback speed follows a |sin| per stroke, so pitch,
 * brightness and level all drop to zero at each reversal. pattern 'down' grinds the last stroke to a halt.
 */
function synthScratch(v: Voice): void {
  const { ctx, now, m, r, f } = v;
  const strokes = scratchStrokes(r);
  const total = strokes * scratchStrokeLen(m);
  const points = Math.min(512, 48 * strokes);
  const peakRate = lerp(1.4, 3.2, m.x);

  const rates: number[] = [];
  const amps: number[] = [];
  for (let i = 0; i < points; i++) {
    const tt = (i / (points - 1)) * strokes;
    const k = Math.min(strokes - 1, Math.floor(tt));
    const u = tt - k;
    let s = Math.sin(Math.PI * u);
    if (r.pattern === 'down' && k === strokes - 1) s = u < 0.15 ? u / 0.15 : Math.pow(1 - (u - 0.15) / 0.85, 1.6);
    const rate = Math.max(0.03, s * peakRate * (k % 2 ? 1.15 : 1));
    rates.push(rate);
    amps.push(Math.pow(Math.min(1, s * 1.3), 0.7) * 0.9);
  }

  const env = ctx.createGain();
  env.gain.setValueCurveAtTime(amps, now, total);
  env.connect(v.bus);

  const stack = (r.modalRatios.length ? r.modalRatios : [1, 1.5, 2]).slice(0, 3);
  const lp = makeFilter(ctx, 'lowpass', undefined, 0.8);
  lp.frequency.setValueCurveAtTime(rates.map((x) => clamp(f * 4 * x * lerp(1, 3, m.x), 200, 16000)), now, total);
  const toneSum = makeGain(ctx, 0.3 / Math.sqrt(stack.length));
  toneSum.connect(lp).connect(env);
  for (const ratio of stack) {
    const o = makeOsc(v, 'sawtooth');
    o.frequency.setValueCurveAtTime(rates.map((x) => clamp(f * ratio * x, 20, 15000)), now, total);
    o.connect(toneSum);
    o.start(now);
    o.stop(now + total + 0.05);
  }

  const noise = makeNoise(v, 'pink');
  const bp = makeFilter(ctx, 'bandpass', undefined, 0.9);
  bp.frequency.setValueCurveAtTime(rates.map((x) => clamp(1100 * x, 200, 12000)), now, total);
  const ng = makeGain(ctx, r.noiseMix * 0.9);
  noise.connect(bp).connect(ng).connect(env);
  startNoise(v, noise, now, now + total + 0.05);
}

const SYNTHS: Record<SynthesisTopology, (v: Voice) => void> = {
  'ui-organic': synthUiOrganic,
  'modal-impact': synthModalImpact,
  'cinematic-whoosh': synthCinematicWhoosh,
  'sub-boom': synthSubBoom,
  'scifi-glitch': synthScifiGlitch,
  footstep: synthFootstep,
  'bell-chime': synthBellChime,
  riser: (v) => synthSweep(v, true),
  downer: (v) => synthSweep(v, false),
  beep: synthBeep,
  brass: synthBrass,
  boing: synthBoing,
  drum: synthDrum,
  scratch: synthScratch,
  pluck: synthPluck,
  '808': synth808,
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Engine                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export class PocketFoleyEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private liveMaster: MasterBus | null = null;
  private liveVoices: LiveVoice[] = [];
  private noiseCache = new Map<number, NoiseBank>();
  private impulseCache = new Map<string, AudioBuffer>();

  /**
   * Initializes or resumes the live AudioContext and unlocks iOS Safari playback
   */
  private ensureContext(): AudioContext {
    if (typeof window === 'undefined') {
      throw new Error('PocketFoleyEngine requires a browser environment.');
    }

    // Unlock iOS physical mute switch so web audio plays like Spotify/YouTube
    const nav = navigator as Navigator & {
      audioSession?: { type: string };
    };
    if (nav.audioSession) {
      try {
        nav.audioSession.type = 'playback';
      } catch {
        // Ignore on unsupported browsers
      }
    }

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx({ sampleRate: 48000 });

      this.analyser = this.ctx.createAnalyser();
      // 2048 guarantees 2048 time-domain samples and 1024 frequency bins
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.78;
      this.analyser.connect(this.ctx.destination);

      this.liveMaster = this.createMaster(this.ctx, this.analyser);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    return this.ctx;
  }

  /** Procedural white + pink noise (Paul Kellet's filter), generated once per sample rate. */
  private getNoise(sampleRate: number): NoiseBank {
    const cached = this.noiseCache.get(sampleRate);
    if (cached) return cached;

    const make = (type: 'white' | 'pink'): AudioBuffer => {
      const length = Math.ceil(sampleRate * NOISE_SECONDS);
      const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
      for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          if (type === 'white') {
            data[i] = white * 0.8;
          } else {
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
            b6 = white * 0.115926;
          }
        }
      }
      return buffer;
    };

    const bank = { white: make('white'), pink: make('pink') };
    this.noiseCache.set(sampleRate, bank);
    return bank;
  }

  /** Algorithmic stereo room IR, energy-normalised so the wet level is predictable. */
  private getImpulse(sampleRate: number, bucket: number): AudioBuffer {
    const key = `${sampleRate}:${bucket}`;
    const cached = this.impulseCache.get(key);
    if (cached) return cached;

    const spec = REVERB_BUCKETS[bucket] ?? REVERB_BUCKETS[0];
    const length = Math.max(1, Math.floor(sampleRate * spec.duration));
    const ir = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
    const earlyEnd = sampleRate * 0.03;

    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      let lp = 0;
      let energy = 0;
      for (let i = 0; i < length; i++) {
        const envelope = Math.pow(1 - i / length, spec.decay);
        lp += 0.55 * (Math.random() * 2 - 1 - lp);
        const early = i < earlyEnd && i % (ch ? 223 : 211) < 9 ? 1.8 : 1;
        const s = lp * envelope * early;
        data[i] = s;
        energy += s * s;
      }
      const scale = Math.sqrt(0.5 / Math.max(energy, 1e-9));
      for (let i = 0; i < length; i++) data[i] = (data[i] ?? 0) * scale;
    }

    this.impulseCache.set(key, ir);
    return ir;
  }

  /**
   * Master chain shared by every voice in a context; reverbs are created lazily per decay bucket.
   * No DynamicsCompressorNode here on purpose: it shaves ~10 dB off short transients (clicks, knocks)
   * even below threshold. Voices are level-balanced instead, and the soft clipper only engages when
   * several voices stack up.
   */
  private createMaster(ctx: BaseAudioContext, output: AudioNode): MasterBus {
    const input = makeGain(ctx, 0.8);
    const dcBlock = makeFilter(ctx, 'highpass', 22, 0.7);

    const clipDrive = makeGain(ctx, 0.5);
    const clipper = ctx.createWaveShaper();
    clipper.curve = SOFT_CLIP_CURVE;
    // No oversampling: its reconstruction filter rings past the 0.98 ceiling on bass-heavy peaks.
    clipper.oversample = 'none';

    input.connect(dcBlock).connect(clipDrive).connect(clipper).connect(output);

    // A convolver's tail can't be cleared, so flushing fades its return out and drops it; the next
    // voice lazily builds a fresh one. Throttled so rapid retriggers don't rebuild IRs constantly.
    const reverbs: ({ conv: ConvolverNode; ret: GainNode } | undefined)[] = [];
    let lastFlush = -1;
    return {
      input,
      reverb: (bucket) => {
        let slot = reverbs[bucket];
        if (!slot) {
          const conv = ctx.createConvolver();
          conv.normalize = false;
          conv.buffer = this.getImpulse(ctx.sampleRate, bucket);
          const ret = makeGain(ctx, 1);
          conv.connect(ret).connect(input);
          slot = { conv, ret };
          reverbs[bucket] = slot;
        }
        return slot.conv;
      },
      flush: (t) => {
        if (t - lastFlush < 0.2) return;
        lastFlush = t;
        reverbs.forEach((slot, i) => {
          if (!slot) return;
          slot.ret.gain.setTargetAtTime(0, t, 0.012);
          window.setTimeout(() => {
            slot.conv.disconnect();
            slot.ret.disconnect();
          }, 250);
          reverbs[i] = undefined;
        });
      },
    };
  }

  /**
   * Builds one complete voice into `master`. Identical for live playback and offline export.
   * `gate` cuts the voice after that many seconds; `fit` first picks the SPEED whose natural length
   * equals the gate, so the sound ends exactly where the next one starts. `tempoScale` locks a
   * recipe's built-in sequence to an external tempo.
   */
  private renderVoice(
    ctx: BaseAudioContext,
    master: MasterBus,
    recipe: SoundRecipe,
    macros: Partial<MacroValues>,
    mod: ModRouting,
    opts: { offset?: number; semi?: number; level?: number; gate?: number; fit?: boolean; tempoScale?: number } = {}
  ): LiveVoice {
    const { offset = 0, semi = 0, level = 1, gate, fit = false, tempoScale } = opts;
    const base = normalizeMacros(macros);
    // Fit aims a little past the gate: decays fade out before their nominal end, so a sound sized
    // exactly to the slot would leave an audible gap. The gate then cuts it right at the next note.
    const m = fit && gate !== undefined ? { ...base, speed: speedForLength(recipe, base, gate * FIT_STRETCH, tempoScale) } : base;
    const scale = tempoScale ?? seqScale(m);
    const now = ctx.currentTime + LIVE_LATENCY_SEC + offset;
    const dur = topologyDuration(recipe, m, scale);
    const rootFreq = clamp(recipe.baseFreq * Math.pow(2, ((m.pitch - 0.5) * 24 + semi) / 12), 20, 14000);

    // Saturation: parallel dry/wet with unity small-signal gain, so GRIT adds harmonics, not level.
    // Long bass swells (risers in the bass bank) stack sub energy for seconds — give them headroom.
    const bassSwell = recipe.category === 'Bass & Subs' && recipe.topology === 'riser' ? 0.6 : 1;
    const bus = makeGain(ctx, TOPOLOGY_LEVEL[recipe.topology] * bassSwell * level);
    const sum = makeGain(ctx, 1);
    const dry = makeGain(ctx, 1 - m.grit * 0.9);
    bus.connect(dry).connect(sum);
    if (m.grit > 0.01) {
      const drive = 1 + m.grit * 10;
      const antiAlias = makeFilter(ctx, 'lowpass', 9000, 0.5);
      const pre = makeGain(ctx, 0.5);
      const shaper = ctx.createWaveShaper();
      shaper.curve = saturationCurve(drive);
      shaper.oversample = '2x';
      const wet = makeGain(ctx, (m.grit * Math.tanh(drive)) / (0.5 * drive));
      bus.connect(antiAlias).connect(pre).connect(shaper).connect(wet).connect(sum);
    }

    const shelf = makeFilter(ctx, 'lowshelf', 180);
    const [shelfLow, shelfHigh] = SHELF_RANGE[recipe.topology] ?? [-4, 5];
    // A sub is almost all low end, so a big shelf boost just pushes the whole sound into the
    // clipper (crackle). Bass sounds get weight from the saturator and octave layer instead.
    const bassLed = recipe.category === 'Bass & Subs';
    shelf.gain.value = lerp(shelfLow, bassLed ? Math.min(shelfHigh, 3) : shelfHigh, m.y);
    const tone = makeFilter(ctx, 'lowpass', lerp(2200, 18000, Math.pow(m.x, 0.85)), 0.6);
    const trem = makeGain(ctx, 1);
    const attackEnv = makeGain(ctx, 1);
    const autoPan = makePan(ctx, 0);
    const out = makeGain(ctx, 1);
    sum.connect(shelf).connect(tone);

    // Optional sound filter. Resonance is gain-compensated so a sharp peak can't push into the clipper.
    let filterNode: BiquadFilterNode = tone;
    let preTrem: AudioNode = tone;
    if (mod.filter !== 'off') {
      const user = makeFilter(ctx, mod.filter, cutoffHz(m.cutoff), lerp(0.6, 9, Math.pow(m.resonance, 1.4)));
      const compensate = makeGain(ctx, 1 / (1 + m.resonance * 1.4));
      tone.connect(user).connect(compensate);
      filterNode = user;
      preTrem = compensate;
    }
    preTrem.connect(trem).connect(attackEnv).connect(autoPan).connect(out);

    const dryOut = makeGain(ctx, 1 - m.space * 0.3);
    out.connect(dryOut).connect(master.input);

    if (m.space > 0.02) {
      const sendTone = makeFilter(ctx, 'lowpass', lerp(2500, 11000, m.x), 0.5);
      out.connect(sendTone);
      const wet = Math.pow(m.space, 0.8) * 0.85;
      const pos = m.space * (REVERB_BUCKETS.length - 1);
      const a = Math.floor(pos);
      const b = Math.min(a + 1, REVERB_BUCKETS.length - 1);
      const frac = pos - a;
      const sendA = makeGain(ctx, wet * (1 - frac));
      sendTone.connect(sendA).connect(master.reverb(a));
      if (b !== a && frac > 0.01) {
        const sendB = makeGain(ctx, wet * frac);
        sendTone.connect(sendB).connect(master.reverb(b));
      }
    }

    if (m.attack > 0.01) {
      const attackTime = Math.max(0.002, Math.pow(m.attack, 1.6) * dur * 0.9);
      attackEnv.gain.setValueAtTime(0, now);
      attackEnv.gain.linearRampToValueAtTime(1, now + attackTime);
    }

    const voice: Voice = {
      ctx,
      now,
      dur,
      m,
      r: recipe,
      f: rootFreq,
      bus,
      pitch: [],
      sources: [],
      spread: clamp(recipe.stereoSpread * m.width * 2),
      noise: this.getNoise(ctx.sampleRate),
      rand: Math.random,
      scale,
    };
    SYNTHS[recipe.topology](voice);
    // With the sound filter on, the FILTER LFO target sweeps it (classic wobble) instead of the tone stage.
    this.attachLfo(voice, mod, filterNode, trem, autoPan);

    let end = now + dur + 0.1;
    if (gate !== undefined && gate < dur) {
      // Gate: fade the dry voice and its reverb sends out at `gate`, then stop every source.
      const cut = now + Math.max(0.01, gate);
      const fade = Math.min(0.012, gate / 3);
      out.gain.setValueAtTime(1, cut - fade);
      out.gain.linearRampToValueAtTime(0, cut);
      for (const s of voice.sources) {
        try {
          s.stop(cut + 0.02);
        } catch {
          // Already scheduled to stop earlier.
        }
      }
      end = cut + 0.05;
    }

    return { out, end, sources: voice.sources };
  }

  /** LFO → pitch (all registered detune params), filter cutoff, amplitude or pan. */
  private attachLfo(v: Voice, mod: ModRouting, tone: BiquadFilterNode, trem: GainNode, autoPan: StereoPannerNode): void {
    const depth = v.m.modDepth;
    if (depth < 0.01) return;
    const { ctx, now } = v;
    const rate = modRateHz(v.m.modRate);
    const stopAt = now + v.dur + 0.3;

    let source: AudioScheduledSourceNode;
    let signal: AudioNode;
    if (mod.shape === 'random') {
      const cs = ctx.createConstantSource();
      cs.offset.setValueAtTime(0, now);
      const step = 1 / rate;
      for (let t = now, n = 0; t < stopAt && n < 600; t += step, n++) {
        cs.offset.setTargetAtTime(v.rand() * 2 - 1, t, step * 0.18);
      }
      source = cs;
      signal = cs;
    } else {
      const lfo = ctx.createOscillator();
      lfo.type = mod.shape;
      lfo.frequency.value = rate;
      source = lfo;
      signal = lfo;
      if (mod.shape === 'square' || mod.shape === 'sawtooth') {
        // Round off the hard edges so square/saw LFOs don't click.
        const smooth = makeFilter(ctx, 'lowpass', clamp(rate * 10, 25, 400), 0.5);
        lfo.connect(smooth);
        signal = smooth;
      }
    }

    const amount = makeGain(ctx);
    signal.connect(amount);
    switch (mod.target) {
      case 'pitch':
        amount.gain.value = depth * depth * 1200;
        for (const p of v.pitch) amount.connect(p);
        break;
      case 'filter':
        amount.gain.value = depth * 3600;
        amount.connect(tone.detune);
        break;
      case 'amp':
        trem.gain.value = 1 - depth * 0.5;
        amount.gain.value = depth * 0.5;
        amount.connect(trem.gain);
        break;
      case 'pan':
        amount.gain.value = depth;
        amount.connect(autoPan.pan);
        break;
    }
    source.start(now);
    source.stop(stopAt);
    v.sources.push(source);
  }

  /** Fades a live voice out and really stops its sources shortly after. */
  private releaseVoice(voice: LiveVoice, t: number, fade = 0.015): void {
    voice.out.gain.cancelScheduledValues(t);
    voice.out.gain.setValueAtTime(voice.out.gain.value, t);
    voice.out.gain.setTargetAtTime(0, t, fade);
    const stopAt = t + fade * 6;
    for (const s of voice.sources) {
      try {
        s.stop(stopAt);
      } catch {
        // Source already finished.
      }
    }
    voice.end = Math.min(voice.end, stopAt);
  }

  /**
   * Plays a sound immediately through the live AudioContext. Once MAX_LIVE_VOICES are sounding the
   * oldest is faded out and stopped. `choke` (mono) cuts every sounding voice and its reverb tail
   * first. `gate` limits how long the new sound is heard.
   */
  public play(
    recipe: SoundRecipe,
    macros: MacroValues,
    mod: ModRouting = recipe.defaultMod,
    options: { choke?: boolean; semi?: number; gate?: number } = {}
  ): void {
    const ctx = this.ensureContext();
    if (!this.liveMaster) return;

    const t = this.prepareVoiceSlot(ctx, options.choke ?? false);
    const voice = this.renderVoice(ctx, this.liveMaster, recipe, macros, mod, { semi: options.semi, gate: options.gate });
    this.trackVoice(voice, t);
  }

  /**
   * Plays a region of a pre-rendered sound (see renderOffline) — this is how trimmed sounds play.
   * The buffer already went through a master chain, so it re-enters the live master at unity.
   */
  public playBuffer(hit: BufferHit, options: { choke?: boolean; fadeOut?: number } = {}): void {
    const ctx = this.ensureContext();
    if (!this.liveMaster) return;
    const t = this.prepareVoiceSlot(ctx, options.choke ?? false);
    const voice = this.scheduleBufferHit(ctx, this.liveMaster.input, hit, options.fadeOut ?? 0.015, t + LIVE_LATENCY_SEC, 1 / 0.8);
    this.trackVoice(voice, t);
  }

  /** Clears finished voices, applies mono choke and steals the oldest voice when full. */
  private prepareVoiceSlot(ctx: AudioContext, choke: boolean): number {
    const t = ctx.currentTime;
    this.liveVoices = this.liveVoices.filter((v) => v.end > t);
    if (choke) this.stopAll();
    while (this.liveVoices.length >= MAX_LIVE_VOICES) {
      const oldest = this.liveVoices.shift();
      if (!oldest) break;
      this.releaseVoice(oldest, t);
    }
    return t;
  }

  private scheduleBufferHit(
    ctx: BaseAudioContext,
    destination: AudioNode,
    hit: BufferHit,
    fadeOut: number,
    origin: number,
    gain: number
  ): LiveVoice {
    const start = clamp(hit.start, 0, Math.max(0, hit.buffer.duration - 0.01));
    const len = clamp(hit.len, 0.01, hit.buffer.duration - start);
    const when = origin + hit.at;
    const level = (hit.level ?? 1) * gain;
    const fade = Math.min(fadeOut, len / 2);

    const src = ctx.createBufferSource();
    src.buffer = hit.buffer;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(level, when + Math.min(TRIM_FADE_IN, len / 4));
    env.gain.setValueAtTime(level, when + len - fade);
    env.gain.linearRampToValueAtTime(0, when + len);
    src.connect(env).connect(destination);
    src.start(when, start, len + 0.01);
    return { out: env, end: when + len + 0.05, sources: [src] };
  }

  /**
   * Schedules a whole multi-track pattern at once. Chords are scaled by 1/√n so stacked notes don't
   * pile into the clipper. `replace` stops whatever is sounding first; loop repeats pass false so the
   * previous bar's tails ring into the next.
   */
  public playMix(parts: MixPart[], replace = true): void {
    const ctx = this.ensureContext();
    if (!this.liveMaster) return;
    const t = ctx.currentTime;
    if (replace) this.stopAll();
    else this.liveVoices = this.liveVoices.filter((v) => v.end > t);
    for (const voice of this.scheduleMix(ctx, this.liveMaster, parts, t + LIVE_LATENCY_SEC, 1 / 0.8)) {
      this.trackVoice(voice, t);
    }
  }

  /** Renders a multi-track mix offline (pattern export). */
  public async renderMix(parts: MixPart[]): Promise<AudioBuffer> {
    const sampleRate = 48000;
    const ends = parts.flatMap((p) =>
      p.kind === 'synth'
        ? p.notes.map((n) => {
            const m = normalizeMacros(p.macros);
            const tail = m.space > 0.02 ? (REVERB_BUCKETS[Math.ceil(m.space * (REVERB_BUCKETS.length - 1))] ?? REVERB_BUCKETS[0]).duration : 0.05;
            return n.at + Math.min(n.len ?? Infinity, topologyDuration(p.recipe, m, n.tempoScale)) + tail;
          })
        : p.hits.map((h) => h.at + h.len),
    );
    const total = LIVE_LATENCY_SEC + Math.max(0.1, ...ends) + 0.3;
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * total), sampleRate);
    const master = this.createMaster(offlineCtx, offlineCtx.destination);
    this.scheduleMix(offlineCtx, master, parts, 0, 1 / 0.8);
    return offlineCtx.startRendering();
  }

  private scheduleMix(ctx: BaseAudioContext, master: MasterBus, parts: MixPart[], origin: number, bufferGain: number): LiveVoice[] {
    const voices: LiveVoice[] = [];
    for (const part of parts) {
      const level = part.level ?? 1;
      if (part.kind === 'synth') {
        for (const n of part.notes) {
          voices.push(
            this.renderVoice(ctx, master, part.recipe, part.macros, part.mod, {
              offset: origin - ctx.currentTime - LIVE_LATENCY_SEC + n.at,
              semi: n.semi,
              level: this.chordLevel(part.notes, n) * level,
              gate: n.len,
              fit: n.fit,
              tempoScale: n.tempoScale,
            }),
          );
        }
      } else {
        for (const hit of part.hits) {
          voices.push(this.scheduleBufferHit(ctx, master.input, { ...hit, level: (hit.level ?? 1) * level }, part.fadeOut ?? 0.015, origin, bufferGain));
        }
      }
    }
    return voices;
  }

  /**
   * Cuts every live voice within ~15 ms — including pattern hits that haven't started yet — and
   * fades out the shared reverb tails so nothing from the previous sound keeps ringing.
   */
  public stopAll(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.liveVoices) this.releaseVoice(v, t, 0.005);
    this.liveVoices = [];
    this.liveMaster?.flush(t);
  }

  private chordLevel(notes: PatternNote[], note: PatternNote): number {
    const together = notes.filter((n) => Math.abs(n.at - note.at) < 0.001).length;
    return (note.vel ?? 1) / Math.sqrt(Math.max(1, together));
  }

  private trackVoice(voice: LiveVoice, t: number): void {
    this.liveVoices.push(voice);
    window.setTimeout(() => voice.out.disconnect(), (voice.end - t + 0.5) * 1000);
  }

  /**
   * Renders the sound (or a user pattern of it) offline at 48 kHz stereo through the same master
   * chain as live playback.
   */
  public async renderOffline(
    recipe: SoundRecipe,
    macros: MacroValues,
    mod: ModRouting = recipe.defaultMod,
    notes?: PatternNote[]
  ): Promise<AudioBuffer> {
    const sampleRate = 48000;
    const m = normalizeMacros(macros);
    const tailBucket = REVERB_BUCKETS[Math.ceil(m.space * (REVERB_BUCKETS.length - 1))] ?? REVERB_BUCKETS[0];
    const tail = m.space > 0.02 ? tailBucket.duration : 0.05;
    const body = notes?.length ? patternDuration(recipe, m, notes) : topologyDuration(recipe, m);
    const total = LIVE_LATENCY_SEC + body + tail + 0.35;

    const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * total), sampleRate);
    const master = this.createMaster(offlineCtx, offlineCtx.destination);
    if (notes?.length) {
      for (const n of notes) {
        this.renderVoice(offlineCtx, master, recipe, m, mod, {
          offset: n.at,
          semi: n.semi,
          level: this.chordLevel(notes, n),
          gate: n.len,
          fit: n.fit,
          tempoScale: n.tempoScale,
        });
      }
    } else {
      this.renderVoice(offlineCtx, master, recipe, m, mod);
    }
    return offlineCtx.startRendering();
  }

  /**
   * Renders offline, normalizes to -1 dBFS, encodes a standard 44-byte RIFF/WAVE header,
   * and triggers an instant browser download. Pass `notes` to export a piano-roll pattern.
   */
  public async exportWav(
    recipe: SoundRecipe,
    macros: MacroValues,
    mod: ModRouting = recipe.defaultMod,
    notes?: PatternNote[]
  ): Promise<void> {
    const renderedBuffer = await this.renderOffline(recipe, macros, mod, notes);
    this.downloadWav(renderedBuffer, recipe.name + (notes?.length ? ' pattern' : ''));
  }

  /** Mixes pre-rendered hits (trimmed sounds or a trimmed pattern) into one buffer offline. */
  public async renderBufferHits(hits: BufferHit[], fadeOut = 0.015): Promise<AudioBuffer> {
    const sampleRate = 48000;
    const total = Math.max(0.05, ...hits.map((h) => h.at + h.len)) + 0.05;
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * total), sampleRate);
    for (const hit of hits) this.scheduleBufferHit(offlineCtx, offlineCtx.destination, hit, fadeOut, 0, 1);
    return offlineCtx.startRendering();
  }

  /** Normalizes and downloads an already rendered buffer as `PocketFoley_<name>_48kHz.wav`. */
  /**
   * Saves the WAV. On phones and tablets that can share files, the system share sheet opens
   * instead ("Save to Files", or straight into TikTok, Instagram, CapCut…); otherwise it downloads.
   */
  public downloadWav(buffer: AudioBuffer, name: string): void {
    const wavBlob = this.encodeNormalizedWav(buffer);
    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const fileName = `PocketFoley_${safeName}_48kHz.wav`;
    const download = () => {
      const url = URL.createObjectURL(wavBlob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    };

    const file = new File([wavBlob], fileName, { type: 'audio/wav' });
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: fileName }).catch((err: unknown) => {
        // Cancelling the sheet is a choice, not a failure; anything else falls back to a download.
        if (!(err instanceof DOMException && err.name === 'AbortError')) download();
      });
      return;
    }
    download();
  }

  /**
   * Normalizes stereo AudioBuffer peak to -1.0 dBFS (0.891) and writes 16-bit PCM RIFF/WAVE
   */
  private encodeNormalizedWav(buffer: AudioBuffer): Blob {
    const numChannels = 2;
    const sampleRate = buffer.sampleRate;
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const length = left.length;

    // Find peak amplitude for studio normalization (-1.0 dBFS target = 0.89125)
    let peak = 0.0001;
    for (let i = 0; i < length; i++) {
      const absL = Math.abs(left[i] ?? 0);
      const absR = Math.abs(right[i] ?? 0);
      if (absL > peak) peak = absL;
      if (absR > peak) peak = absR;
    }
    const normGain = 0.89125 / peak;

    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = length * blockAlign;
    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    // 44-Byte RIFF WAVE Header
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true);  // AudioFormat (1 = Linear PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // 16-bit
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave L/R channels & convert Float32 -> Int16
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sL = clamp((left[i] ?? 0) * normGain, -1, 1);
      const sR = clamp((right[i] ?? 0) * normGain, -1, 1);
      view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7fff, true);
      view.setInt16(offset + 2, sR < 0 ? sR * 0x8000 : sR * 0x7fff, true);
      offset += 4;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  /**
   * Populates real-time oscilloscope time-domain data for the 60fps Canvas visualizer
   */
  public getWaveformData(targetArray: Uint8Array<ArrayBuffer>): void {
    if (!this.analyser) {
      targetArray.fill(128);
      return;
    }
    this.analyser.getByteTimeDomainData(targetArray);
  }

  /**
   * Populates real-time FFT spectrum frequency data for the 60fps Canvas visualizer
   */
  public getFrequencyData(targetArray: Uint8Array<ArrayBuffer>): void {
    if (!this.analyser) {
      targetArray.fill(0);
      return;
    }
    this.analyser.getByteFrequencyData(targetArray);
  }
}

export const soundEngine = new PocketFoleyEngine();
