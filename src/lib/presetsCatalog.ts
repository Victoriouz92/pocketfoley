import {
  FILTER_MODES,
  MOD_SHAPES,
  MOD_TARGETS,
  type FilterMode,
  type SoundRecipe,
  type SoundCategory,
  type MacroValues,
  type ModRouting,
  type ModShape,
  type ModTarget,
  type SeqNote,
  type DrumVoice,
  type SynthesisTopology,
} from './soundEngine';

export const CATEGORIES: Array<SoundCategory> = [
  'Viral & Memes',
  'UI & Apps',
  'Cinematic & Reels',
  'Bass & Subs',
  'Drums & Beats',
  'Cartoon & Melodies',
  'Instruments',
  'Risers & Drops',
  'Foley & Physics',
  'Footsteps',
  'Bells & Chimes',
  'Sci-Fi & Glitch',
];

const TOPOLOGY = {
  ui: 'ui-organic',
  modal: 'modal-impact',
  whoosh: 'cinematic-whoosh',
  boom: 'sub-boom',
  glitch: 'scifi-glitch',
  step: 'footstep',
  bell: 'bell-chime',
  rise: 'riser',
  drop: 'downer',
  beep: 'beep',
  brass: 'brass',
  boing: 'boing',
  drum: 'drum',
  scratch: 'scratch',
  pluck: 'pluck',
  bass808: '808',
} as const satisfies Record<string, SynthesisTopology>;

/* ── Pattern & melody builders ──────────────────────────────────── */

const DRUM_ROWS = {
  k: 'kick',
  s: 'snare',
  h: 'hat',
  o: 'open-hat',
  c: 'clap',
  r: 'rim',
  b: 'cowbell',
  t: 'tom-hi',
  m: 'tom-mid',
  l: 'tom-lo',
  x: 'crash',
  z: 'shaker',
  n: 'snap',
} as const satisfies Record<string, DrumVoice>;

const DRUM_PAN: Partial<Record<DrumVoice, number>> = {
  hat: 0.3,
  'open-hat': 0.3,
  shaker: -0.35,
  cowbell: -0.25,
  'tom-hi': -0.4,
  'tom-mid': 0,
  'tom-lo': 0.4,
  crash: 0.2,
};

/**
 * Drum grid → hits. One character per 16th note: "X" accent, "x" hit, "g" ghost, anything else rest.
 * `swing` (0–0.5) delays every off-beat 16th by that fraction of a step.
 */
function beat(bpm: number, rows: Partial<Record<keyof typeof DRUM_ROWS, string>>, swing = 0): SeqNote[] {
  const step = 60 / bpm / 4;
  const out: SeqNote[] = [];
  for (const [row, grid] of Object.entries(rows) as [keyof typeof DRUM_ROWS, string][]) {
    const drum = DRUM_ROWS[row];
    [...grid].forEach((ch, i) => {
      const vel = ch === 'X' ? 1 : ch === 'x' ? 0.75 : ch === 'g' ? 0.35 : 0;
      if (vel > 0) out.push({ at: i * step + (i % 2 ? swing * step : 0), drum, vel, pan: DRUM_PAN[drum] ?? 0 });
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Single-line melody: semitones (null = rest), evenly spaced. */
function melody(semis: (number | null)[], spacing: number, len?: number): SeqNote[] {
  return semis.flatMap((semi, i) => (semi === null ? [] : [{ at: i * spacing, semi, len }]));
}

/** Strummed chords: each chord's notes are staggered by `strumGap`, chords `spacing` apart. */
function strum(chords: number[][], spacing: number, strumGap = 0.02): SeqNote[] {
  return chords.flatMap((chord, c) =>
    chord.map((semi, i) => ({ at: c * spacing + i * strumGap, semi, vel: 1 - i * 0.08, pan: (i - 1.5) * 0.15 })),
  );
}

/** A crowd of claps (or any drum) scattered over `duration`, swelling in and fading out. */
function crowd(drum: DrumVoice, count: number, duration: number, seed: number): SeqNote[] {
  const rand = seededRandom(seed);
  return Array.from({ length: count }, () => {
    const at = rand() * duration;
    const swell = Math.min(1, at / (duration * 0.15), (duration - at) / (duration * 0.25) + 0.15);
    return { at, drum, vel: swell * (0.45 + rand() * 0.55), pan: rand() * 2 - 1 };
  }).sort((a, b) => a.at - b.at);
}

/** Random scattered pops/snaps with jittered level — bubble wrap, popcorn. */
function scatter(drum: DrumVoice, count: number, duration: number, seed: number): SeqNote[] {
  const rand = seededRandom(seed);
  return Array.from({ length: count }, () => ({ at: rand() * duration, drum, vel: 0.5 + rand() * 0.5, pan: rand() * 1.6 - 0.8 })).sort(
    (a, b) => a.at - b.at,
  );
}

/** EDM-style snare build: quarters → eighths → sixteenths, rising, landing on a crash. */
function snareBuild(bpm: number): SeqNote[] {
  const beatLen = 60 / bpm;
  const out: SeqNote[] = [];
  let at = 0;
  for (const [count, div] of [[4, 1], [8, 2], [16, 4]] as const) {
    for (let i = 0; i < count; i++) {
      out.push({ at, drum: 'snare', vel: 0.3 + 0.7 * (at / (beatLen * 12)) });
      at += beatLen / div;
    }
  }
  out.push({ at, drum: 'crash' }, { at, drum: 'kick' });
  return out;
}

type CoreMacros = Pick<MacroValues, 'x' | 'y' | 'space' | 'grit' | 'speed' | 'pitch'> & Partial<MacroValues>;
const mac = (x: number, y: number, space: number, grit: number, speed: number, extra: Partial<MacroValues> = {}): CoreMacros => ({
  x,
  y,
  space,
  grit,
  speed,
  pitch: 0.5,
  ...extra,
});
const axes = (xLeft: string, xRight: string, yBottom: string, yTop: string) => ({ xLeft, xRight, yBottom, yTop });

const AX = {
  pop: axes('Soft Pop', 'Bright Pop', 'Tiny', 'Plump'),
  click: axes('Soft Click', 'Crisp Click', 'Light', 'Firm'),
  kit: axes('Warm Kit', 'Bright Kit', 'Tight', 'Roomy'),
  melody: axes('Mellow', 'Bright', 'Soft Touch', 'Full Body'),
  cartoon: axes('Gentle', 'Zany', 'Small', 'Big'),
  clap: axes('Muffled', 'Crisp', 'Small Room', 'Hall'),
};

/** Compact preset builder for the larger families below; same shape as the literal presets above. */
function preset(p: {
  id: string;
  name: string;
  category: SoundCategory;
  tag: string;
  description: string;
  keywords: string[];
  topology: SynthesisTopology;
  baseFreq: number;
  macros: CoreMacros;
  axis: ReturnType<typeof axes>;
  ratios?: number[];
  fm?: number;
  noise?: number;
  spread?: number;
  wave?: SoundRecipe['wave'];
  sequence?: SeqNote[];
  strikes?: number;
  pattern?: SoundRecipe['pattern'];
  mod?: Partial<ModRouting>;
  bpm?: number;
}): RecipeInput {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    tag: p.tag,
    description: p.description,
    keywords: p.keywords,
    topology: p.topology,
    baseFreq: p.baseFreq,
    modalRatios: p.ratios ?? [1, 2, 3, 4, 5],
    fmRatio: p.fm ?? 1,
    noiseMix: p.noise ?? 0.1,
    stereoSpread: p.spread ?? 0.3,
    wave: p.wave,
    sequence: p.sequence,
    strikes: p.strikes,
    pattern: p.pattern,
    bpm: p.bpm,
    defaultMacros: p.macros,
    defaultMod: p.mod,
    axisLabels: p.axis,
  };
}

/* ── Sequence builders (deterministic, so every preset sounds the same each load) ── */

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Physical bounce: each gap and each hit shrink by the restitution factor. */
function bounce(hits: number, firstGap: number, restitution: number): SeqNote[] {
  const out: SeqNote[] = [];
  let at = 0;
  let gap = firstGap;
  let vel = 1;
  for (let i = 0; i < hits; i++) {
    out.push({ at, vel, pan: i % 2 ? 0.25 : -0.25 });
    at += gap;
    gap *= restitution;
    vel *= 0.72;
  }
  return out;
}

/** Alternating left/right footsteps with a little timing drift. */
function steps(count: number, gap: number): SeqNote[] {
  const rand = seededRandom(count * 31 + Math.round(gap * 100));
  return Array.from({ length: count }, (_, i) => ({
    at: i === 0 ? 0 : i * gap + (rand() - 0.5) * gap * 0.06,
    vel: i % 2 ? 0.86 : 1,
    pan: i % 2 ? 0.35 : -0.35,
  }));
}

function drumRoll(): SeqNote[] {
  const hits = 30;
  const spacing = 0.055;
  const out: SeqNote[] = Array.from({ length: hits }, (_, i) => ({
    at: i * spacing,
    drum: 'snare' as const,
    vel: 0.25 + 0.75 * Math.pow(i / (hits - 1), 1.5),
    pan: i % 2 ? 0.15 : -0.15,
  }));
  const end = hits * spacing + 0.05;
  out.push({ at: end, drum: 'crash' }, { at: end, drum: 'kick' });
  return out;
}

function crickets(): SeqNote[] {
  const out: SeqNote[] = [];
  for (let chirp = 0; chirp < 4; chirp++) {
    for (let pulse = 0; pulse < 3; pulse++) {
      out.push({ at: chirp * 0.5 + pulse * 0.045, len: 0.022, vel: pulse === 1 ? 1 : 0.8, pan: chirp % 2 ? 0.4 : -0.3 });
    }
  }
  return out;
}

function typing(): SeqNote[] {
  const rand = seededRandom(7);
  const out: SeqNote[] = [];
  let at = 0;
  for (let i = 0; i < 16; i++) {
    out.push({ at, drum: 'click', vel: 0.6 + rand() * 0.4, pan: (rand() - 0.5) * 0.6 });
    at += 0.07 + rand() * 0.14 + (i === 7 ? 0.25 : 0);
  }
  return out;
}

function tickTock(count: number): SeqNote[] {
  return Array.from({ length: count }, (_, i) => ({ at: i * 0.5, drum: i % 2 ? ('tock' as const) : ('tick' as const) }));
}

function applause(): SeqNote[] {
  const rand = seededRandom(42);
  const out: SeqNote[] = [];
  for (let i = 0; i < 80; i++) {
    const at = rand() * 2.6;
    const swell = at < 0.35 ? at / 0.35 : at > 2 ? Math.max(0.15, 1 - (at - 2) / 0.6) : 1;
    out.push({ at, drum: 'clap', vel: swell * (0.45 + rand() * 0.55), pan: rand() * 2 - 1 });
  }
  return out.sort((a, b) => a.at - b.at);
}

function heartbeat(beats: number, interval: number): SeqNote[] {
  const out: SeqNote[] = [];
  for (let i = 0; i < beats; i++) {
    out.push({ at: i * interval, drum: 'kick', vel: 1 }, { at: i * interval + 0.24, drum: 'kick', vel: 0.65 });
  }
  return out;
}

const DEFAULT_MOD: ModRouting = { shape: 'sine', target: 'pitch', filter: 'off' };

const EXTENDED_DEFAULTS: Pick<MacroValues, 'attack' | 'width' | 'modDepth' | 'modRate' | 'cutoff' | 'resonance'> = {
  attack: 0,
  width: 0.5,
  modDepth: 0,
  modRate: 0.4,
  cutoff: 0.7,
  resonance: 0.15,
};

/** Presets only need the six core macros; the newer ones default to neutral values. */
type RecipeInput = Omit<SoundRecipe, 'defaultMacros' | 'defaultMod'> & {
  defaultMacros: Pick<MacroValues, 'x' | 'y' | 'space' | 'grit' | 'speed' | 'pitch'> & Partial<MacroValues>;
  defaultMod?: Partial<ModRouting>;
};

const defineRecipe = (r: RecipeInput): SoundRecipe => ({
  ...r,
  defaultMacros: { ...EXTENDED_DEFAULTS, ...r.defaultMacros },
  defaultMod: { ...DEFAULT_MOD, ...r.defaultMod },
});

// Modal ratios describe relative resonances, not equal-tempered notes.
// fmRatio meaning depends on topology — see SoundRecipe.fmRatio in soundEngine.ts.
// Actual timbre and decay depend on the engine's macro mappings.
const RECIPES = [
  // ── Viral & Memes ──────────────────────────────────────────────────
  // Original synthesized takes on the effect styles creators search for most; no samples are used.
  {
    id: 'dramatic-meme-boom',
    name: 'Dramatic Meme Boom',
    category: 'Viral & Memes',
    tag: 'Meme Boom',
    description: 'The deep, saturated "bwom" boom that punctuates dramatic stares, plot twists and reaction cuts.',
    keywords: ['vine boom', 'bruh', 'boom', 'reaction', 'dramatic'],
    topology: TOPOLOGY.boom,
    baseFreq: 55,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 1,
    noiseMix: 0.2,
    stereoSpread: 0.2,
    defaultMacros: { x: 0.55, y: 0.85, space: 0.35, grit: 0.55, speed: 0.38, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft Thud', xRight: 'Saturated Boom', yBottom: 'Small Boom', yTop: 'Huge Boom' },
  },
  {
    id: 'bass-boosted-boom',
    name: 'Bass Boosted Boom',
    category: 'Viral & Memes',
    tag: 'Bass Boosted',
    description: 'An over-the-top distorted bass hit for comedic emphasis — loud and gritty, but soft-clipped so it never crackles.',
    keywords: ['bass boosted', 'distorted', 'loud', 'meme'],
    topology: TOPOLOGY.boom,
    baseFreq: 45,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 1,
    noiseMix: 0.3,
    stereoSpread: 0.15,
    defaultMacros: { x: 0.72, y: 1, space: 0.2, grit: 0.9, speed: 0.45, pitch: 0.5 },
    axisLabels: { xLeft: 'Muffled', xRight: 'Blown Out', yBottom: 'Punchy', yTop: 'Massive' },
  },
  {
    id: 'party-air-horn',
    name: 'Party Air Horn',
    category: 'Viral & Memes',
    tag: 'Air Horn',
    description: 'The classic three-blast party air horn for wins, hype moments and montage drops.',
    keywords: ['airhorn', 'mlg', 'hype', 'horn', 'win'],
    topology: TOPOLOGY.brass,
    baseFreq: 466,
    modalRatios: [1, 1.007, 0.993, 2.004],
    fmRatio: 1,
    noiseMix: 0.05,
    stereoSpread: 0.3,
    wave: 'sawtooth',
    sequence: [{ at: 0, len: 0.3 }, { at: 0.36, len: 0.12 }, { at: 0.52, len: 0.95 }],
    defaultMacros: { x: 0.78, y: 0.5, space: 0.2, grit: 0.35, speed: 0.5, pitch: 0.5, modDepth: 0.1, modRate: 0.7 },
    defaultMod: { shape: 'sine', target: 'pitch' },
    axisLabels: { xLeft: 'Muffled Horn', xRight: 'Blaring Horn', yBottom: 'Thin', yTop: 'Stadium' },
  },
  {
    id: 'sad-trombone',
    name: 'Sad Trombone',
    category: 'Viral & Memes',
    tag: 'Fail Wah Wah',
    description: 'Four falling muted "wah wah wah waaah" notes — the universal sound of failure.',
    keywords: ['fail', 'wah wah', 'trombone', 'lose', 'sad'],
    topology: TOPOLOGY.brass,
    baseFreq: 233,
    modalRatios: [1, 1.004],
    fmRatio: 1,
    noiseMix: 0.08,
    stereoSpread: 0.1,
    wave: 'sawtooth',
    sequence: [
      { at: 0, len: 0.38, semi: 0 },
      { at: 0.45, len: 0.38, semi: -1 },
      { at: 0.9, len: 0.38, semi: -2 },
      { at: 1.35, len: 1.5, semi: -3, bend: -0.5 },
    ],
    defaultMacros: { x: 0.32, y: 0.5, space: 0.15, grit: 0.05, speed: 0.5, pitch: 0.5, modDepth: 0.35, modRate: 0.62 },
    defaultMod: { shape: 'sine', target: 'filter' },
    axisLabels: { xLeft: 'Muted', xRight: 'Open Bell', yBottom: 'Thin', yTop: 'Fat' },
  },
  {
    id: 'boo-womp',
    name: 'Boo-Womp Letdown',
    category: 'Viral & Memes',
    tag: 'Two-Note Fail',
    description: 'A dopey two-note tuba drop for awkward moments, letdowns and "well, that happened".',
    keywords: ['womp womp', 'fail', 'tuba', 'letdown', 'awkward'],
    topology: TOPOLOGY.brass,
    baseFreq: 147,
    modalRatios: [1, 1.003, 2.001],
    fmRatio: 1,
    noiseMix: 0.05,
    stereoSpread: 0.1,
    wave: 'sawtooth',
    sequence: [{ at: 0, len: 0.32, semi: 0 }, { at: 0.42, len: 1, semi: -5, bend: -0.4 }],
    defaultMacros: { x: 0.3, y: 0.6, space: 0.12, grit: 0.1, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Dull Tuba', xRight: 'Brassy', yBottom: 'Small', yTop: 'Big Band' },
  },
  {
    id: 'dun-dun-duuun',
    name: 'Dun Dun Duuun',
    category: 'Viral & Memes',
    tag: 'Dramatic Sting',
    description: 'A three-hit ominous brass sting for dramatic reveals, suspicious looks and plot twists.',
    keywords: ['dramatic', 'suspense', 'reveal', 'plot twist', 'sting'],
    topology: TOPOLOGY.brass,
    baseFreq: 196,
    modalRatios: [1, 1.189, 1.498, 2],
    fmRatio: 1,
    noiseMix: 0.04,
    stereoSpread: 0.4,
    wave: 'sawtooth',
    sequence: [{ at: 0, len: 0.2, semi: 0 }, { at: 0.3, len: 0.2, semi: -1 }, { at: 0.6, len: 1.6, semi: -4 }],
    defaultMacros: { x: 0.62, y: 0.7, space: 0.45, grit: 0.2, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Dark Low Brass', xRight: 'Bright Brass', yBottom: 'Small Ensemble', yTop: 'Full Orchestra' },
  },
  {
    id: 'ba-dum-tss',
    name: 'Ba Dum Tss',
    category: 'Viral & Memes',
    tag: 'Rimshot',
    description: 'The comedy rimshot after a bad joke: two toms, a kick and a crash cymbal.',
    keywords: ['rimshot', 'joke', 'drum', 'badum', 'comedy'],
    topology: TOPOLOGY.drum,
    baseFreq: 100,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0.4,
    sequence: [
      { at: 0, drum: 'tom-hi', vel: 0.8, pan: -0.2 },
      { at: 0.15, drum: 'tom-lo', vel: 0.85, pan: 0.1 },
      { at: 0.34, drum: 'kick', vel: 0.6 },
      { at: 0.34, drum: 'crash', vel: 0.8, pan: 0.3 },
    ],
    defaultMacros: { x: 0.6, y: 0.5, space: 0.2, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Dull Kit', xRight: 'Bright Kit', yBottom: 'Tight', yTop: 'Ringing' },
  },
  {
    id: 'drum-roll-reveal',
    name: 'Drum Roll Reveal',
    category: 'Viral & Memes',
    tag: 'Drum Roll',
    description: 'A building snare roll that lands on a crash — for reveals, rankings and "the winner is…".',
    keywords: ['drum roll', 'reveal', 'winner', 'suspense'],
    topology: TOPOLOGY.drum,
    baseFreq: 100,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0.3,
    sequence: drumRoll(),
    defaultMacros: { x: 0.6, y: 0.5, space: 0.25, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft Brushes', xRight: 'Crisp Snare', yBottom: 'Tight', yTop: 'Ringing' },
  },
  {
    id: 'censor-bleep',
    name: 'Censor Bleep',
    category: 'Viral & Memes',
    tag: 'Bleep',
    description: 'A clean 1 kHz bleep for censoring words. SPEED sets the length.',
    keywords: ['beep', 'bleep', 'censor', 'swear', 'curse'],
    topology: TOPOLOGY.beep,
    baseFreq: 1000,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0,
    wave: 'sine',
    sequence: [{ at: 0, len: 0.45 }],
    defaultMacros: { x: 0.5, y: 0.5, space: 0, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft', xRight: 'Sharp', yBottom: 'Light', yTop: 'Full' },
  },
  {
    id: 'wrong-answer-buzzer',
    name: 'Wrong Answer Buzzer',
    category: 'Viral & Memes',
    tag: 'Wrong',
    description: 'A low game-show buzzer for wrong answers, fails and "nope".',
    keywords: ['wrong', 'buzzer', 'error', 'fail', 'quiz', 'game show'],
    topology: TOPOLOGY.beep,
    baseFreq: 150,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0.1,
    wave: 'square',
    sequence: [{ at: 0, len: 0.3 }, { at: 0.36, len: 0.6 }],
    defaultMacros: { x: 0.35, y: 0.5, space: 0.05, grit: 0.25, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Muffled', xRight: 'Harsh', yBottom: 'Thin', yTop: 'Heavy' },
  },
  {
    id: 'correct-answer-ding',
    name: 'Correct Answer Ding',
    category: 'Viral & Memes',
    tag: 'Correct',
    description: 'A bright two-note ding for correct answers, checkmarks and wins.',
    keywords: ['correct', 'right', 'ding', 'quiz', 'yes', 'game show'],
    topology: TOPOLOGY.bell,
    baseFreq: 1318.5,
    modalRatios: [1, 2, 3.01, 4.1],
    fmRatio: 2,
    noiseMix: 0.1,
    stereoSpread: 0.3,
    sequence: [{ at: 0, semi: 0 }, { at: 0.13, semi: 7 }],
    defaultMacros: { x: 0.65, y: 0.4, space: 0.25, grit: 0, speed: 0.35, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft', xRight: 'Sparkling', yBottom: 'Quick', yTop: 'Ringing' },
  },
  {
    id: 'record-scratch-freeze',
    name: 'Record Scratch Freeze',
    category: 'Viral & Memes',
    tag: 'Record Scratch',
    description: 'The "record scratch, freeze frame" moment: a back-and-forth scratch that grinds to a stop.',
    keywords: ['record scratch', 'freeze frame', 'vinyl', 'stop', 'yep that\'s me'],
    topology: TOPOLOGY.scratch,
    baseFreq: 220,
    modalRatios: [1, 1.26, 1.5],
    fmRatio: 1,
    noiseMix: 0.5,
    stereoSpread: 0.2,
    strikes: 2,
    pattern: 'down',
    defaultMacros: { x: 0.6, y: 0.5, space: 0.05, grit: 0.15, speed: 0.45, pitch: 0.5 },
    axisLabels: { xLeft: 'Slow Drag', xRight: 'Fast Whip', yBottom: 'Thin', yTop: 'Fat' },
  },
  {
    id: 'falling-metal-pipe',
    name: 'Falling Metal Pipe',
    category: 'Viral & Memes',
    tag: 'Metal Clang',
    description: 'A huge, ringing steel-pipe clang that bounces on a concrete floor — the loudest meme in the room.',
    keywords: ['metal pipe', 'pipe falling', 'clang', 'meme', 'steel'],
    topology: TOPOLOGY.modal,
    baseFreq: 520,
    modalRatios: [1, 2.76, 5.4, 8.93, 13.34],
    fmRatio: 1,
    noiseMix: 0.45,
    stereoSpread: 0.4,
    sequence: bounce(4, 0.28, 0.55),
    defaultMacros: { x: 0.86, y: 0.72, space: 0.35, grit: 0.3, speed: 0.9, pitch: 0.5 },
    axisLabels: { xLeft: 'Dull Iron', xRight: 'Ringing Steel', yBottom: 'Thin Rod', yTop: 'Heavy Pipe' },
  },
  {
    id: 'cartoon-bonk',
    name: 'Cartoon Bonk',
    category: 'Viral & Memes',
    tag: 'Bonk',
    description: 'A hollow wooden bonk on the head for slapstick hits and bad takes.',
    keywords: ['bonk', 'hit', 'head', 'cartoon', 'slapstick'],
    topology: TOPOLOGY.modal,
    baseFreq: 420,
    modalRatios: [1, 1.58, 3.1],
    fmRatio: 1,
    noiseMix: 0.3,
    stereoSpread: 0.1,
    defaultMacros: { x: 0.42, y: 0.55, space: 0.1, grit: 0.1, speed: 0.14, pitch: 0.5 },
    axisLabels: { xLeft: 'Hollow Wood', xRight: 'Hard Bat', yBottom: 'Tap', yTop: 'Wallop' },
  },
  {
    id: 'rizz-boing',
    name: 'Rizz Boing',
    category: 'Viral & Memes',
    tag: 'Rizz',
    description: 'The rising wobbly "bwoing" for smooth-talker moments and eyebrow raises.',
    keywords: ['rizz', 'boing', 'eyebrow', 'smooth', 'flirt'],
    topology: TOPOLOGY.boing,
    baseFreq: 300,
    modalRatios: [1, 2],
    fmRatio: 1.1,
    noiseMix: 0.05,
    stereoSpread: 0.1,
    wave: 'sine',
    defaultMacros: { x: 0.55, y: 0.65, space: 0.1, grit: 0.05, speed: 0.35, pitch: 0.5 },
    axisLabels: { xLeft: 'Slow Wobble', xRight: 'Fast Wobble', yBottom: 'Subtle', yTop: 'Wild' },
  },
  {
    id: 'cartoon-spring-boing',
    name: 'Cartoon Spring Boing',
    category: 'Viral & Memes',
    tag: 'Spring',
    description: 'A twangy spring boing for bounces, surprises and cartoon pops.',
    keywords: ['boing', 'spring', 'bounce', 'cartoon', 'jaw harp'],
    topology: TOPOLOGY.boing,
    baseFreq: 220,
    modalRatios: [1, 2],
    fmRatio: -0.2,
    noiseMix: 0.05,
    stereoSpread: 0.1,
    wave: 'sine',
    defaultMacros: { x: 0.5, y: 0.8, space: 0.08, grit: 0.05, speed: 0.45, pitch: 0.5 },
    axisLabels: { xLeft: 'Slow Spring', xRight: 'Tight Spring', yBottom: 'Gentle', yTop: 'Wild' },
  },
  {
    id: 'jump-boing',
    name: 'Jump Boing',
    category: 'Viral & Memes',
    tag: 'Jump',
    description: 'A quick upward boing for jumps, pop-ins and characters springing into frame.',
    keywords: ['jump', 'boing', 'pop in', 'cartoon'],
    topology: TOPOLOGY.boing,
    baseFreq: 200,
    modalRatios: [1, 2],
    fmRatio: 1.6,
    noiseMix: 0.08,
    stereoSpread: 0.1,
    wave: 'sine',
    defaultMacros: { x: 0.6, y: 0.45, space: 0.06, grit: 0.05, speed: 0.2, pitch: 0.5 },
    axisLabels: { xLeft: 'Slow Wobble', xRight: 'Fast Wobble', yBottom: 'Subtle', yTop: 'Wild' },
  },
  {
    id: 'awkward-crickets',
    name: 'Awkward Crickets',
    category: 'Viral & Memes',
    tag: 'Crickets',
    description: 'Chirping crickets for awkward silences, failed jokes and empty rooms.',
    keywords: ['crickets', 'silence', 'awkward', 'nobody', 'night'],
    topology: TOPOLOGY.beep,
    baseFreq: 4400,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0.1,
    stereoSpread: 0.6,
    wave: 'sine',
    sequence: crickets(),
    defaultMacros: { x: 0.7, y: 0.3, space: 0.3, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Distant', xRight: 'Close', yBottom: 'Few', yTop: 'Loud' },
  },
  {
    id: 'whoopee-cushion',
    name: 'Whoopee Cushion',
    category: 'Viral & Memes',
    tag: 'Fart',
    description: 'A rubbery whoopee-cushion blurt for kids\' content and prank videos.',
    keywords: ['fart', 'whoopee', 'prank', 'funny', 'toot'],
    topology: TOPOLOGY.brass,
    baseFreq: 90,
    modalRatios: [1, 1.015],
    fmRatio: 1,
    noiseMix: 0.35,
    stereoSpread: 0.05,
    wave: 'sawtooth',
    sequence: [{ at: 0, len: 0.65, semi: 2, bend: -5 }],
    defaultMacros: { x: 0.25, y: 0.6, space: 0.04, grit: 0.2, speed: 0.5, pitch: 0.5, modDepth: 0.55, modRate: 0.92 },
    defaultMod: { shape: 'random', target: 'amp' },
    axisLabels: { xLeft: 'Muffled', xRight: 'Squeaky', yBottom: 'Tiny', yTop: 'Epic' },
  },
  {
    id: 'countdown-321-go',
    name: 'Countdown 3-2-1 Go',
    category: 'Viral & Memes',
    tag: 'Countdown',
    description: 'Three countdown beeps and a higher "go" tone for challenges, races and timers.',
    keywords: ['countdown', 'timer', '321', 'race', 'start', 'beep'],
    topology: TOPOLOGY.beep,
    baseFreq: 880,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0,
    wave: 'sine',
    sequence: [{ at: 0, len: 0.14 }, { at: 1, len: 0.14 }, { at: 2, len: 0.14 }, { at: 3, len: 0.6, semi: 12 }],
    defaultMacros: { x: 0.45, y: 0.5, space: 0.1, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft', xRight: 'Sharp', yBottom: 'Light', yTop: 'Full' },
  },
  {
    id: 'victory-fanfare',
    name: 'Victory Fanfare',
    category: 'Viral & Memes',
    tag: 'Win',
    description: 'A short bright brass "da-da-da-daaa" for victories, unboxings and achievements.',
    keywords: ['win', 'victory', 'fanfare', 'success', 'trumpet'],
    topology: TOPOLOGY.brass,
    baseFreq: 262,
    modalRatios: [1, 1.26, 1.498, 2],
    fmRatio: 1,
    noiseMix: 0.03,
    stereoSpread: 0.5,
    wave: 'sawtooth',
    sequence: [{ at: 0, len: 0.11 }, { at: 0.14, len: 0.11 }, { at: 0.28, len: 0.11 }, { at: 0.42, len: 0.9, semi: 5 }],
    defaultMacros: { x: 0.82, y: 0.5, space: 0.35, grit: 0.1, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Mellow', xRight: 'Brilliant', yBottom: 'Solo', yTop: 'Section' },
  },
  {
    id: 'magic-sparkle',
    name: 'Magic Sparkle',
    category: 'Viral & Memes',
    tag: 'Sparkle',
    description: 'A glittery cascade of tiny chimes for magic reveals, glow-ups and transformations.',
    keywords: ['sparkle', 'magic', 'glitter', 'glow up', 'twinkle', 'shine'],
    topology: TOPOLOGY.bell,
    baseFreq: 2093,
    modalRatios: [1, 2.76],
    fmRatio: 0,
    noiseMix: 0.05,
    stereoSpread: 0.9,
    strikes: 12,
    pattern: 'random',
    defaultMacros: { x: 0.8, y: 0.2, space: 0.5, grit: 0, speed: 0.2, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft Glow', xRight: 'Glitter', yBottom: 'Quick', yTop: 'Lingering' },
  },
  {
    id: 'retro-coin-pickup',
    name: 'Retro Coin Pickup',
    category: 'Viral & Memes',
    tag: 'Coin',
    description: 'A two-note chiptune coin blip for points, rewards and collecting things.',
    keywords: ['coin', 'retro', '8 bit', 'game', 'pickup', 'points'],
    topology: TOPOLOGY.beep,
    baseFreq: 988,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0,
    wave: 'square',
    sequence: [{ at: 0, len: 0.07 }, { at: 0.07, len: 0.5, semi: 5 }],
    defaultMacros: { x: 0.45, y: 0.5, space: 0.08, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft Chip', xRight: 'Bright Chip', yBottom: 'Light', yTop: 'Full' },
  },
  {
    id: 'retro-game-over',
    name: 'Retro Game Over',
    category: 'Viral & Memes',
    tag: 'Game Over',
    description: 'A falling chiptune melody for game-over screens, losses and "it\'s over" moments.',
    keywords: ['game over', 'lose', 'retro', '8 bit', 'fail'],
    topology: TOPOLOGY.beep,
    baseFreq: 523,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0,
    wave: 'square',
    sequence: [
      { at: 0, len: 0.2, semi: 7 },
      { at: 0.22, len: 0.2, semi: 4 },
      { at: 0.44, len: 0.2, semi: 0 },
      { at: 0.66, len: 0.9, semi: -5 },
    ],
    defaultMacros: { x: 0.4, y: 0.5, space: 0.15, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft Chip', xRight: 'Bright Chip', yBottom: 'Light', yTop: 'Full' },
  },

  // ── UI & Apps ──────────────────────────────────────────────────────
  {
    id: 'cupertino-tap',
    name: 'Cupertino Glass Tap',
    category: 'UI & Apps',
    tag: 'Glass Tap',
    description:
      'A tiny polished glass touch with a rounded body and a clean, sparkling edge.',
    topology: TOPOLOGY.ui,
    baseFreq: 1120,
    modalRatios: [1, 2.32, 4.25, 6.63, 9.38],
    fmRatio: 2,
    noiseMix: 0.07,
    stereoSpread: 0.12,
    defaultMacros: {
      x: 0.7,
      y: 0.28,
      space: 0.08,
      grit: 0.02,
      speed: 0.12,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Frosted Glass',
      xRight: 'Cut Crystal',
      yBottom: 'Tiny Touch',
      yTop: 'Rounded Knock',
    },
  },
  {
    id: 'linear-toggle',
    name: 'Linear Silk Toggle',
    category: 'UI & Apps',
    tag: 'Soft Toggle',
    description:
      'A close, restrained toggle with a soft fabric edge and a compact wooden heart.',
    topology: TOPOLOGY.ui,
    baseFreq: 580,
    modalRatios: [1, 1.47, 2.09, 2.56, 3.12],
    fmRatio: 1,
    noiseMix: 0.18,
    stereoSpread: 0.04,
    defaultMacros: {
      x: 0.3,
      y: 0.4,
      space: 0.02,
      grit: 0.06,
      speed: 0.08,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Soft Felt',
      xRight: 'Silk Snap',
      yBottom: 'Light Switch',
      yTop: 'Firm Detent',
    },
  },
  {
    id: 'dopamine-coin',
    name: 'Dopamine Coin Pop',
    category: 'UI & Apps',
    tag: 'Reward Pop',
    description:
      'A bright, buoyant reward pop with a clear musical center and a golden shimmer.',
    topology: TOPOLOGY.ui,
    baseFreq: 1318.51,
    modalRatios: [1, 2, 3, 4, 6],
    fmRatio: 2,
    noiseMix: 0.04,
    stereoSpread: 0.28,
    defaultMacros: {
      x: 0.72,
      y: 0.34,
      space: 0.18,
      grit: 0.04,
      speed: 0.3,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Candy Bubble',
      xRight: 'Golden Sparkle',
      yBottom: 'Small Coin',
      yTop: 'Treasure Token',
    },
  },
  {
    id: 'velvet-notification',
    name: 'Velvet Notification Pill',
    category: 'UI & Apps',
    tag: 'Gentle Alert',
    description:
      'A mellow notification with a warm bell-like center and a soft, lingering cushion.',
    topology: TOPOLOGY.ui,
    baseFreq: 659.25,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 1,
    noiseMix: 0.03,
    stereoSpread: 0.36,
    defaultMacros: {
      x: 0.27,
      y: 0.46,
      space: 0.26,
      grit: 0.03,
      speed: 0.46,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Warm Velvet',
      xRight: 'Porcelain Glow',
      yBottom: 'Gentle Nudge',
      yTop: 'Plush Chime',
    },
  },
  {
    id: 'leica-shutter',
    name: 'Mechanical Leica Shutter',
    category: 'UI & Apps',
    tag: 'Camera Click',
    description:
      'A dry camera-inspired mechanism with a crisp blade edge and a compact mechanical clack.',
    topology: TOPOLOGY.ui,
    baseFreq: 360,
    modalRatios: [1, 1.62, 2.73, 4.18, 6.25],
    fmRatio: 3.4,
    noiseMix: 0.78,
    stereoSpread: 0.1,
    defaultMacros: {
      x: 0.78,
      y: 0.55,
      space: 0.05,
      grit: 0.2,
      speed: 0.06,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Cloth Curtain',
      xRight: 'Steel Blades',
      yBottom: 'Pocket Camera',
      yTop: 'Heavy Mechanism',
    },
  },
  {
    id: 'text-popup-bubble',
    name: 'Text Pop-Up Bubble',
    category: 'UI & Apps',
    tag: 'Caption Pop',
    description:
      'A compact, playful bubble pop that gives captions, chat messages, and animated stickers a tactile entrance.',
    topology: TOPOLOGY.ui,
    baseFreq: 760,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 1,
    noiseMix: 0.1,
    stereoSpread: 0.16,
    defaultMacros: {
      x: 0.48,
      y: 0.42,
      space: 0.06,
      grit: 0.04,
      speed: 0.1,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Soap Bubble',
      xRight: 'Candy Snap',
      yBottom: 'Tiny Message',
      yTop: 'Bouncy Sticker',
    },
  },
  {
    id: 'camera-flash-charge',
    name: 'Camera Flash Charge',
    category: 'UI & Apps',
    tag: 'Electric Charge',
    description:
      'A soft rising capacitor whine for photo reveals and capture animations, smooth enough for headphones.',
    topology: TOPOLOGY.rise,
    baseFreq: 900,
    modalRatios: [1, 2.004],
    fmRatio: 1.2,
    noiseMix: 0.08,
    stereoSpread: 0.22,
    wave: 'sine',
    defaultMacros: {
      x: 0.35,
      y: 0.1,
      space: 0.12,
      grit: 0.04,
      speed: 0.25,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Soft Filament',
      xRight: 'White Spark',
      yBottom: 'Pocket Flash',
      yTop: 'Studio Strobe',
    },
  },
  {
    id: 'text-message-ding',
    name: 'Text Message Ding',
    category: 'UI & Apps',
    tag: 'Message',
    description: 'A short two-note ding for incoming texts, DMs and chat bubbles on screen.',
    keywords: ['text', 'message', 'dm', 'notification', 'sms', 'chat'],
    topology: TOPOLOGY.bell,
    baseFreq: 1568,
    modalRatios: [1, 2.01, 3.02],
    fmRatio: 0,
    noiseMix: 0.08,
    stereoSpread: 0.2,
    sequence: [{ at: 0, semi: 0 }, { at: 0.1, semi: 7 }],
    defaultMacros: { x: 0.55, y: 0.3, space: 0.12, grit: 0, speed: 0.25, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft', xRight: 'Glassy', yBottom: 'Quick', yTop: 'Ringing' },
  },
  {
    id: 'like-heart-pop',
    name: 'Like Heart Pop',
    category: 'UI & Apps',
    tag: 'Like',
    description: 'A plump, happy pop for likes, hearts, reactions and follower counters.',
    keywords: ['like', 'heart', 'pop', 'reaction', 'follow'],
    topology: TOPOLOGY.ui,
    baseFreq: 980,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 1,
    noiseMix: 0.12,
    stereoSpread: 0.2,
    defaultMacros: { x: 0.55, y: 0.38, space: 0.08, grit: 0, speed: 0.14, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft Pop', xRight: 'Bright Pop', yBottom: 'Tiny', yTop: 'Plump' },
  },
  {
    id: 'success-toast-chime',
    name: 'Success Toast Chime',
    category: 'UI & Apps',
    tag: 'Success',
    description: 'A quick rising three-note chime for "saved", "sent" and "done" confirmations.',
    keywords: ['success', 'done', 'saved', 'complete', 'confirm'],
    topology: TOPOLOGY.bell,
    baseFreq: 1046.5,
    modalRatios: [1, 2, 3.01],
    fmRatio: 0,
    noiseMix: 0.05,
    stereoSpread: 0.3,
    sequence: [{ at: 0, semi: 0 }, { at: 0.08, semi: 4 }, { at: 0.16, semi: 7 }],
    defaultMacros: { x: 0.55, y: 0.3, space: 0.2, grit: 0, speed: 0.3, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft', xRight: 'Sparkling', yBottom: 'Quick', yTop: 'Ringing' },
  },
  {
    id: 'error-alert',
    name: 'Error Alert',
    category: 'UI & Apps',
    tag: 'Error',
    description: 'A gentle falling two-tone alert for errors, warnings and invalid input.',
    keywords: ['error', 'alert', 'warning', 'invalid', 'denied'],
    topology: TOPOLOGY.beep,
    baseFreq: 620,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0.1,
    wave: 'triangle',
    sequence: [{ at: 0, len: 0.12 }, { at: 0.16, len: 0.3, semi: -5 }],
    defaultMacros: { x: 0.5, y: 0.5, space: 0.1, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft', xRight: 'Sharp', yBottom: 'Light', yTop: 'Full' },
  },
  {
    id: 'phone-vibrate',
    name: 'Phone Vibrate',
    category: 'UI & Apps',
    tag: 'Vibrate',
    description: 'A buzzing phone-on-the-table vibration for incoming messages and calls.',
    keywords: ['vibrate', 'phone', 'buzz', 'call', 'notification'],
    topology: TOPOLOGY.beep,
    baseFreq: 165,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0.1,
    stereoSpread: 0,
    wave: 'square',
    sequence: [{ at: 0, len: 0.4 }, { at: 0.55, len: 0.4 }],
    defaultMacros: { x: 0.2, y: 0.5, space: 0, grit: 0.1, speed: 0.5, pitch: 0.5, modDepth: 0.25, modRate: 0.9 },
    defaultMod: { shape: 'random', target: 'amp' },
    axisLabels: { xLeft: 'In Pocket', xRight: 'On Table', yBottom: 'Light', yTop: 'Strong' },
  },
  {
    id: 'alarm-clock-beeping',
    name: 'Alarm Clock Beeping',
    category: 'UI & Apps',
    tag: 'Alarm',
    description: 'Two bursts of four quick alarm beeps for wake-up scenes, deadlines and morning routines.',
    keywords: ['alarm', 'wake up', 'clock', 'morning', 'beep'],
    topology: TOPOLOGY.beep,
    baseFreq: 2000,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0,
    wave: 'square',
    sequence: [0, 0.12, 0.24, 0.36, 0.8, 0.92, 1.04, 1.16].map((at) => ({ at, len: 0.07 })),
    defaultMacros: { x: 0.3, y: 0.5, space: 0.05, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Muffled', xRight: 'Piercing', yBottom: 'Light', yTop: 'Full' },
  },
  {
    id: 'mouse-click',
    name: 'Mouse Click',
    category: 'UI & Apps',
    tag: 'Click',
    description: 'A crisp single mouse or keyboard click for screen recordings and tutorials.',
    keywords: ['click', 'mouse', 'tap', 'button', 'tutorial'],
    topology: TOPOLOGY.drum,
    baseFreq: 100,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0,
    sequence: [{ at: 0, drum: 'click' }],
    defaultMacros: { x: 0.6, y: 0.4, space: 0.02, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft', xRight: 'Crisp', yBottom: 'Light', yTop: 'Firm' },
  },

  // ── Cinematic & Reels ──────────────────────────────────────────────
  {
    id: 'whip-pan',
    name: 'Whip Pan Doppler Whoosh',
    category: 'Cinematic & Reels',
    tag: 'Fast Transition',
    description:
      'A wide rush of air with a bright leading edge and a low, passing body.',
    topology: TOPOLOGY.whoosh,
    baseFreq: 190,
    modalRatios: [1, 1.5, 2, 3, 4],
    fmRatio: 1,
    noiseMix: 0.88,
    stereoSpread: 0.94,
    defaultMacros: {
      x: 0.75,
      y: 0.46,
      space: 0.2,
      grit: 0.1,
      speed: 0.2,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Soft Air',
      xRight: 'Razor Wind',
      yBottom: 'Passing Ribbon',
      yTop: 'Heavy Flyby',
    },
  },
  {
    id: 'soft-text-swoosh',
    name: 'Soft Text Swoosh',
    category: 'Cinematic & Reels',
    tag: 'Title Swoosh',
    description:
      'A short, soft air swoosh for sliding text, lower thirds, and quick UI transitions.',
    topology: TOPOLOGY.whoosh,
    baseFreq: 260,
    modalRatios: [1, 1.5, 2, 3, 4],
    fmRatio: 1,
    noiseMix: 0.9,
    stereoSpread: 0.7,
    defaultMacros: {
      x: 0.55,
      y: 0.25,
      space: 0.12,
      grit: 0.02,
      speed: 0.06,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Breath',
      xRight: 'Crisp Air',
      yBottom: 'Light Slide',
      yTop: 'Bold Slide',
    },
  },
  {
    id: 'oppenheimer-sub',
    name: 'Oppenheimer Sub Drop',
    category: 'Bass & Subs',
    tag: 'Deep Impact',
    description:
      'A centered low impact with a descending bass core and a restrained dusty wake.',
    topology: TOPOLOGY.boom,
    baseFreq: 58,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 0.5,
    noiseMix: 0.18,
    stereoSpread: 0.18,
    defaultMacros: {
      x: 0.24,
      y: 0.88,
      space: 0.42,
      grit: 0.38,
      speed: 0.72,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Buried Thunder',
      xRight: 'Cracked Earth',
      yBottom: 'Distant Rumble',
      yTop: 'Chest Pressure',
    },
  },
  {
    id: 'dark-trailer-braaam',
    name: 'Dark Trailer Braaam',
    category: 'Bass & Subs',
    tag: 'Saturated Bass',
    description:
      'A dense bass impact whose saturated upper harmonics suggest a distant, ominous horn.',
    topology: TOPOLOGY.boom,
    baseFreq: 73.42,
    modalRatios: [1, 2, 3, 4, 6],
    fmRatio: 1,
    noiseMix: 0.24,
    stereoSpread: 0.32,
    defaultMacros: {
      x: 0.54,
      y: 0.82,
      space: 0.54,
      grit: 0.64,
      speed: 0.82,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Black Velvet',
      xRight: 'Burnished Brass',
      yBottom: 'Distant Warning',
      yTop: 'Monolithic Weight',
    },
  },
  {
    id: 'dustfall-reveal',
    name: 'Dustfall Reveal Thud',
    category: 'Cinematic & Reels',
    tag: 'Weighty Reveal',
    description:
      'A compact, earthy reveal with a blunt bass strike and a rough cloud of dust.',
    topology: TOPOLOGY.boom,
    baseFreq: 86,
    modalRatios: [1, 1.47, 2.09, 2.56, 3.12],
    fmRatio: 0.75,
    noiseMix: 0.46,
    stereoSpread: 0.24,
    defaultMacros: {
      x: 0.4,
      y: 0.74,
      space: 0.3,
      grit: 0.42,
      speed: 0.34,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Packed Soil',
      xRight: 'Flying Gravel',
      yBottom: 'Falling Book',
      yTop: 'Stone Slab',
    },
  },
  {
    id: 'heavy-bass-slam',
    name: 'Heavy Bass Slam',
    category: 'Bass & Subs',
    tag: 'Beat Drop',
    description:
      'A tight, saturated bass slam with a gritty attack for punchy reveals, beat cuts, and dramatic title hits.',
    topology: TOPOLOGY.boom,
    baseFreq: 65.41,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 0.5,
    noiseMix: 0.28,
    stereoSpread: 0.12,
    defaultMacros: {
      x: 0.58,
      y: 0.92,
      space: 0.16,
      grit: 0.62,
      speed: 0.24,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Rubber Mallet',
      xRight: 'Concrete Crack',
      yBottom: 'Floor Knock',
      yTop: 'Room-Shaking Slam',
    },
  },
  {
    id: 'cinematic-punch',
    name: 'Cinematic Punch Hit',
    category: 'Cinematic & Reels',
    tag: 'Punch',
    description:
      'A tight, chesty punch impact for fight beats, on-the-beat edits, and kinetic text.',
    topology: TOPOLOGY.boom,
    baseFreq: 75,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 1,
    noiseMix: 0.55,
    stereoSpread: 0.15,
    defaultMacros: {
      x: 0.62,
      y: 0.75,
      space: 0.14,
      grit: 0.3,
      speed: 0.05,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Body Blow',
      xRight: 'Leather Crack',
      yBottom: 'Light Jab',
      yTop: 'Knockout',
    },
  },
  {
    id: 'vinyl-scratch-stop',
    name: 'Vinyl Scratch Stop',
    category: 'Cinematic & Reels',
    tag: 'Scratch Cut',
    description:
      'A stylized synthetic record-scratch accent with a rough, stuttering edge for freeze frames and comic interruptions.',
    topology: TOPOLOGY.glitch,
    baseFreq: 310,
    modalRatios: [1, 1.37, 2.11, 3.43, 5.17],
    fmRatio: 4.75,
    noiseMix: 0.84,
    stereoSpread: 0.18,
    defaultMacros: {
      x: 0.82,
      y: 0.38,
      space: 0.04,
      grit: 0.72,
      speed: 0.18,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Worn Groove',
      xRight: 'Needle Scrape',
      yBottom: 'Quick Flick',
      yTop: 'Heavy Platter',
    },
  },

  {
    id: 'fast-swipe-transition',
    name: 'Fast Swipe Transition',
    category: 'Cinematic & Reels',
    tag: 'Swipe',
    description: 'A very short, bright swipe for jump cuts, slide transitions and outfit changes.',
    keywords: ['swipe', 'transition', 'whoosh', 'swoosh', 'cut'],
    topology: TOPOLOGY.whoosh,
    baseFreq: 300,
    modalRatios: [1, 1.5, 2, 3, 4],
    fmRatio: 1,
    noiseMix: 0.92,
    stereoSpread: 0.85,
    defaultMacros: { x: 0.72, y: 0.3, space: 0.1, grit: 0.03, speed: 0.02, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft Air', xRight: 'Sharp Air', yBottom: 'Light', yTop: 'Heavy' },
  },
  {
    id: 'heart-monitor-beep',
    name: 'Heart Monitor Beep',
    category: 'Cinematic & Reels',
    tag: 'Hospital',
    description: 'Slow hospital heart-monitor beeps for tense, medical and emotional scenes.',
    keywords: ['heart monitor', 'hospital', 'ecg', 'beep', 'medical'],
    topology: TOPOLOGY.beep,
    baseFreq: 1000,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0,
    wave: 'sine',
    sequence: [{ at: 0, len: 0.1 }, { at: 0.85, len: 0.1 }, { at: 1.7, len: 0.1 }],
    defaultMacros: { x: 0.45, y: 0.5, space: 0.15, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft', xRight: 'Sharp', yBottom: 'Light', yTop: 'Full' },
  },
  {
    id: 'clock-tick-tock',
    name: 'Clock Tick Tock',
    category: 'Cinematic & Reels',
    tag: 'Ticking',
    description: 'A steady tick-tock for suspense, deadlines and "time is running out" moments.',
    keywords: ['clock', 'tick tock', 'ticking', 'time', 'suspense', 'timer'],
    topology: TOPOLOGY.drum,
    baseFreq: 100,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0.2,
    sequence: tickTock(8),
    defaultMacros: { x: 0.55, y: 0.5, space: 0.15, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Wooden Clock', xRight: 'Metal Watch', yBottom: 'Light', yTop: 'Heavy' },
  },

  // ── Bass & Subs ────────────────────────────────────────────────────
  {
    id: '808-long-boom',
    name: '808 Long Boom',
    category: 'Bass & Subs',
    tag: '808',
    description: 'A long, round 808-style sub boom that sustains under a beat drop or a title card.',
    keywords: ['808', 'sub', 'bass', 'boom', 'trap'],
    topology: TOPOLOGY.boom,
    baseFreq: 49,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 1,
    noiseMix: 0.05,
    stereoSpread: 0.05,
    defaultMacros: { x: 0.25, y: 0.9, space: 0.08, grit: 0.3, speed: 0.85, pitch: 0.5 },
    axisLabels: { xLeft: 'Round', xRight: 'Growling', yBottom: 'Short', yTop: 'Huge' },
  },
  {
    id: 'trailer-hit-boom',
    name: 'Trailer Hit Boom',
    category: 'Bass & Subs',
    tag: 'Trailer Hit',
    description: 'A massive cinematic trailer hit with a wide dusty tail for title slams and logo reveals.',
    keywords: ['trailer', 'hit', 'boom', 'impact', 'cinematic', 'title'],
    topology: TOPOLOGY.boom,
    baseFreq: 41,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 1,
    noiseMix: 0.45,
    stereoSpread: 0.3,
    defaultMacros: { x: 0.6, y: 0.92, space: 0.55, grit: 0.45, speed: 0.75, pitch: 0.5 },
    axisLabels: { xLeft: 'Dark Hit', xRight: 'Bright Hit', yBottom: 'Tight', yTop: 'Colossal' },
  },
  {
    id: 'deep-sub-impact',
    name: 'Deep Sub Impact',
    category: 'Bass & Subs',
    tag: 'Sub Impact',
    description: 'A clean, deep sub impact that you feel more than hear — for edits on the beat and big reveals.',
    keywords: ['sub', 'impact', 'deep', 'bass', 'hit'],
    topology: TOPOLOGY.boom,
    baseFreq: 35,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 0.5,
    noiseMix: 0.25,
    stereoSpread: 0.15,
    defaultMacros: { x: 0.3, y: 1, space: 0.3, grit: 0.25, speed: 0.55, pitch: 0.5 },
    axisLabels: { xLeft: 'Pure Sub', xRight: 'Textured', yBottom: 'Tight', yTop: 'Huge' },
  },
  {
    id: 'big-explosion',
    name: 'Big Explosion',
    category: 'Bass & Subs',
    tag: 'Explosion',
    description: 'A blast with a sharp crack, a heavy sub and a long rolling rumble.',
    keywords: ['explosion', 'blast', 'bomb', 'boom', 'kaboom'],
    topology: TOPOLOGY.boom,
    baseFreq: 45,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 1,
    noiseMix: 0.95,
    stereoSpread: 0.6,
    defaultMacros: { x: 0.55, y: 0.9, space: 0.5, grit: 0.5, speed: 0.8, pitch: 0.5 },
    axisLabels: { xLeft: 'Distant', xRight: 'Close Crack', yBottom: 'Small', yTop: 'Massive' },
  },
  {
    id: 'thunder-crack',
    name: 'Thunder Crack & Rumble',
    category: 'Bass & Subs',
    tag: 'Thunder',
    description: 'A bright thunder crack that rolls into a long, wide storm rumble.',
    keywords: ['thunder', 'storm', 'lightning', 'rumble', 'weather'],
    topology: TOPOLOGY.boom,
    baseFreq: 38,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 0.75,
    noiseMix: 0.9,
    stereoSpread: 0.8,
    defaultMacros: { x: 0.8, y: 0.85, space: 0.7, grit: 0.3, speed: 1, pitch: 0.5 },
    axisLabels: { xLeft: 'Far Away', xRight: 'Overhead', yBottom: 'Light Storm', yTop: 'Huge Storm' },
  },
  {
    id: 'earthquake-rumble',
    name: 'Earthquake Rumble',
    category: 'Bass & Subs',
    tag: 'Rumble',
    description: 'A dark, sustained ground rumble for earthquakes, approaching monsters and building tension.',
    keywords: ['earthquake', 'rumble', 'ground', 'shake', 'tension'],
    topology: TOPOLOGY.boom,
    baseFreq: 30,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 0.5,
    noiseMix: 0.92,
    stereoSpread: 0.5,
    defaultMacros: { x: 0.1, y: 1, space: 0.3, grit: 0.2, speed: 1, pitch: 0.5 },
    axisLabels: { xLeft: 'Deep Rumble', xRight: 'Gravelly', yBottom: 'Tremor', yTop: 'Quake' },
  },
  {
    id: '808-glide-down',
    name: '808 Glide Down',
    category: 'Bass & Subs',
    tag: '808 Slide',
    description: 'A gliding 808 note that slides down an octave, straight out of a trap beat.',
    keywords: ['808', 'glide', 'slide', 'trap', 'bass'],
    topology: TOPOLOGY.drop,
    baseFreq: 41,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0.05,
    wave: 'sine',
    defaultMacros: { x: 0.3, y: 0.9, space: 0.05, grit: 0.4, speed: 0.35, pitch: 0.5 },
    axisLabels: { xLeft: 'Clean', xRight: 'Distorted', yBottom: 'Thin', yTop: 'Heavy' },
  },
  {
    id: 'wobble-bass-drop',
    name: 'Wobble Bass Drop',
    category: 'Bass & Subs',
    tag: 'Wobble',
    description: 'A falling wobble bass with a pumping filter — the classic dubstep-style drop.',
    keywords: ['wobble', 'dubstep', 'drop', 'wub', 'bass'],
    topology: TOPOLOGY.drop,
    baseFreq: 41,
    modalRatios: [1, 1.005, 2],
    fmRatio: 1.5,
    noiseMix: 0.05,
    stereoSpread: 0.3,
    wave: 'sawtooth',
    defaultMacros: { x: 0.45, y: 0.8, space: 0.15, grit: 0.45, speed: 0.55, pitch: 0.5, modDepth: 0.55, modRate: 0.62 },
    defaultMod: { shape: 'square', target: 'filter' },
    axisLabels: { xLeft: 'Dark Wub', xRight: 'Screaming Wub', yBottom: 'Thin', yTop: 'Heavy' },
  },
  {
    id: 'punchy-kick-drum',
    name: 'Punchy Kick Drum',
    category: 'Bass & Subs',
    tag: 'Kick',
    description: 'A tight, punchy kick for beat syncs, cuts and transitions on the downbeat.',
    keywords: ['kick', 'drum', 'beat', 'punch', 'bass drum'],
    topology: TOPOLOGY.drum,
    baseFreq: 100,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0,
    sequence: [{ at: 0, drum: 'kick' }],
    defaultMacros: { x: 0.5, y: 0.7, space: 0.05, grit: 0.1, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft Beater', xRight: 'Clicky Beater', yBottom: 'Tight', yTop: 'Boomy' },
  },
  {
    id: 'tense-heartbeat',
    name: 'Tense Heartbeat',
    category: 'Bass & Subs',
    tag: 'Heartbeat',
    description: 'A deep "lub-dub" heartbeat for tension, fear and dramatic close-ups.',
    keywords: ['heartbeat', 'heart', 'pulse', 'tension', 'scary'],
    topology: TOPOLOGY.drum,
    baseFreq: 100,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0,
    sequence: heartbeat(3, 0.9),
    defaultMacros: { x: 0.15, y: 0.75, space: 0.12, grit: 0.05, speed: 0.5, pitch: 0.4 },
    axisLabels: { xLeft: 'Muffled', xRight: 'Present', yBottom: 'Faint', yTop: 'Pounding' },
  },
  {
    id: 'sub-rumble-swell',
    name: 'Sub Rumble Swell',
    category: 'Bass & Subs',
    tag: 'Sub Riser',
    description: 'A low sub swell that rises into a drop — the bassy build before the hit.',
    keywords: ['sub', 'swell', 'riser', 'build', 'bass'],
    topology: TOPOLOGY.rise,
    baseFreq: 30,
    modalRatios: [1],
    fmRatio: 0.5,
    noiseMix: 0.3,
    stereoSpread: 0.2,
    wave: 'sine',
    defaultMacros: { x: 0.2, y: 1, space: 0.3, grit: 0.2, speed: 0.55, pitch: 0.5 },
    axisLabels: { xLeft: 'Pure Sub', xRight: 'Airy Rumble', yBottom: 'Gentle', yTop: 'Massive' },
  },

  // ── Risers & Drops ─────────────────────────────────────────────────
  {
    id: 'slow-motion-whoosh',
    name: 'Slow Motion Whoosh',
    category: 'Risers & Drops',
    tag: 'Slow-Mo',
    description: 'A deep, stretched whoosh that drops into slow motion — for speed ramps and epic moments.',
    keywords: ['slow motion', 'slowmo', 'speed ramp', 'whoosh', 'epic'],
    topology: TOPOLOGY.drop,
    baseFreq: 110,
    modalRatios: [1, 1.5],
    fmRatio: 2,
    noiseMix: 0.7,
    stereoSpread: 0.7,
    wave: 'sawtooth',
    defaultMacros: { x: 0.45, y: 0.7, space: 0.55, grit: 0.05, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Tonal', xRight: 'Airy', yBottom: 'Light', yTop: 'Heavy' },
  },
  {
    id: 'tape-rewind',
    name: 'Tape Rewind',
    category: 'Risers & Drops',
    tag: 'Rewind',
    description: 'A fast, warbly tape rewind for "let me explain" flashbacks and replays.',
    keywords: ['rewind', 'vhs', 'tape', 'flashback', 'replay'],
    topology: TOPOLOGY.rise,
    baseFreq: 500,
    modalRatios: [1, 1.5],
    fmRatio: 1.6,
    noiseMix: 0.65,
    stereoSpread: 0.3,
    wave: 'sawtooth',
    defaultMacros: { x: 0.6, y: 0.1, space: 0.05, grit: 0.2, speed: 0.15, pitch: 0.5, modDepth: 0.25, modRate: 0.8 },
    defaultMod: { shape: 'random', target: 'pitch' },
    axisLabels: { xLeft: 'Muffled', xRight: 'Squealing', yBottom: 'Thin', yTop: 'Full' },
  },
  {
    id: 'tension-riser',
    name: 'Cinematic Tension Riser',
    category: 'Risers & Drops',
    tag: 'Build Up',
    description:
      'A dark, swelling string-like riser with a pulsing tremolo that builds tension into a cut or a drop.',
    topology: TOPOLOGY.rise,
    baseFreq: 110,
    modalRatios: [1, 1.498, 2.003],
    fmRatio: 2,
    noiseMix: 0.35,
    stereoSpread: 0.7,
    wave: 'sawtooth',
    defaultMacros: {
      x: 0.45,
      y: 0.55,
      space: 0.45,
      grit: 0.12,
      speed: 0.6,
      pitch: 0.5,
      modDepth: 0.22,
      modRate: 0.55,
    },
    defaultMod: { shape: 'sine', target: 'amp' },
    axisLabels: {
      xLeft: 'Dark Strings',
      xRight: 'Bright Air',
      yBottom: 'Thin Build',
      yTop: 'Huge Build',
    },
  },
  {
    id: 'neon-riser',
    name: 'Neon Riser Sweep',
    category: 'Risers & Drops',
    tag: 'Airy Build',
    description:
      'A luminous, extended air sweep with a broad stereo halo and an electric edge.',
    topology: TOPOLOGY.whoosh,
    baseFreq: 340,
    modalRatios: [1, 2, 3, 4, 6],
    fmRatio: 2.5,
    noiseMix: 0.72,
    stereoSpread: 0.86,
    defaultMacros: {
      x: 0.82,
      y: 0.3,
      space: 0.58,
      grit: 0.15,
      speed: 0.84,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Mist Glow',
      xRight: 'Neon Sparks',
      yBottom: 'Floating Haze',
      yTop: 'Gathering Storm',
    },
  },
  {
    id: 'soft-swell-upper',
    name: 'Soft Swell Upper',
    category: 'Risers & Drops',
    tag: 'Gentle Riser',
    description:
      'A smooth, airy upward swell for soft reveals, intros, and title cards.',
    topology: TOPOLOGY.rise,
    baseFreq: 220,
    modalRatios: [1, 1.0058, 0.9942],
    fmRatio: 1,
    noiseMix: 0.5,
    stereoSpread: 0.6,
    wave: 'triangle',
    defaultMacros: {
      x: 0.4,
      y: 0.3,
      space: 0.4,
      grit: 0,
      speed: 0.35,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Warm Pad',
      xRight: 'Airy Breath',
      yBottom: 'Floating',
      yTop: 'Swelling',
    },
  },
  {
    id: 'reverse-cymbal',
    name: 'Reverse Cymbal Swell',
    category: 'Risers & Drops',
    tag: 'Reverse FX',
    description:
      'A shimmering reversed-cymbal style noise swell that sucks the viewer into the next shot.',
    topology: TOPOLOGY.rise,
    baseFreq: 400,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0.95,
    stereoSpread: 0.8,
    wave: 'sine',
    defaultMacros: {
      x: 0.8,
      y: 0.15,
      space: 0.3,
      grit: 0.02,
      speed: 0.3,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Dark Wash',
      xRight: 'Bright Sizzle',
      yBottom: 'Thin Swell',
      yTop: 'Full Swell',
    },
  },
  {
    id: 'cartoon-slide-up',
    name: 'Cartoon Slide Up',
    category: 'Risers & Drops',
    tag: 'Comedy Upper',
    description:
      'A playful slide-whistle glide upward with a light vibrato for comic moments.',
    topology: TOPOLOGY.rise,
    baseFreq: 500,
    modalRatios: [1],
    fmRatio: 1.5,
    noiseMix: 0.03,
    stereoSpread: 0.1,
    wave: 'sine',
    defaultMacros: {
      x: 0.2,
      y: 0.1,
      space: 0.12,
      grit: 0,
      speed: 0.15,
      pitch: 0.5,
      modDepth: 0.25,
      modRate: 0.72,
    },
    defaultMod: { shape: 'sine', target: 'pitch' },
    axisLabels: {
      xLeft: 'Pure Whistle',
      xRight: 'Breathy Whistle',
      yBottom: 'Tiny Toy',
      yTop: 'Big Brass',
    },
  },
  {
    id: 'level-up-sweep',
    name: 'Level Up Sweep',
    category: 'Risers & Drops',
    tag: 'Power Up',
    description:
      'A fast, bright pitch sweep that powers up into a reward, upgrade, or stat boost.',
    topology: TOPOLOGY.rise,
    baseFreq: 330,
    modalRatios: [1, 2],
    fmRatio: 2,
    noiseMix: 0.12,
    stereoSpread: 0.4,
    wave: 'triangle',
    defaultMacros: {
      x: 0.6,
      y: 0.25,
      space: 0.2,
      grit: 0.05,
      speed: 0.08,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Clean Tone',
      xRight: 'Sparkle Air',
      yBottom: 'Small Boost',
      yTop: 'Mega Boost',
    },
  },
  {
    id: 'power-down',
    name: 'Power Down',
    category: 'Risers & Drops',
    tag: 'Shutdown',
    description:
      'An electrical system powering down with a falling hum that slows to silence.',
    topology: TOPOLOGY.drop,
    baseFreq: 45,
    modalRatios: [1, 1.5],
    fmRatio: 3,
    noiseMix: 0.1,
    stereoSpread: 0.3,
    wave: 'sawtooth',
    defaultMacros: {
      x: 0.35,
      y: 0.55,
      space: 0.2,
      grit: 0.15,
      speed: 0.4,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Warm Hum',
      xRight: 'Electric Fizz',
      yBottom: 'Small Device',
      yTop: 'Power Station',
    },
  },
  {
    id: 'tape-stop',
    name: 'Tape Stop',
    category: 'Risers & Drops',
    tag: 'Slowdown',
    description:
      'A reel-to-reel tape grinding to a halt, ideal for record-stop cuts and freeze frames.',
    topology: TOPOLOGY.drop,
    baseFreq: 40,
    modalRatios: [1, 2, 3],
    fmRatio: 3.5,
    noiseMix: 0.05,
    stereoSpread: 0.2,
    wave: 'triangle',
    defaultMacros: {
      x: 0.5,
      y: 0.5,
      space: 0.05,
      grit: 0.2,
      speed: 0.25,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Muffled Reel',
      xRight: 'Bright Reel',
      yBottom: 'Thin Tape',
      yTop: 'Heavy Reel',
    },
  },
  {
    id: 'sub-bass-drop',
    name: 'Sub Bass Drop',
    category: 'Bass & Subs',
    tag: '808 Drop',
    description:
      'A deep, clean sub glide that drops under a beat cut or a title slam.',
    topology: TOPOLOGY.drop,
    baseFreq: 30,
    modalRatios: [1],
    fmRatio: 2.5,
    noiseMix: 0.02,
    stereoSpread: 0.05,
    wave: 'sine',
    defaultMacros: {
      x: 0.2,
      y: 0.9,
      space: 0.1,
      grit: 0.1,
      speed: 0.5,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Pure Sub',
      xRight: 'Growling Sub',
      yBottom: 'Light Drop',
      yTop: 'Floor Shaker',
    },
  },
  {
    id: 'cartoon-slide-down',
    name: 'Cartoon Slide Down',
    category: 'Risers & Drops',
    tag: 'Comedy Downer',
    description:
      'A falling slide-whistle glide with a wobbly vibrato for fails and pratfalls.',
    topology: TOPOLOGY.drop,
    baseFreq: 380,
    modalRatios: [1],
    fmRatio: 1.5,
    noiseMix: 0.03,
    stereoSpread: 0.1,
    wave: 'sine',
    defaultMacros: {
      x: 0.2,
      y: 0.1,
      space: 0.1,
      grit: 0,
      speed: 0.3,
      pitch: 0.5,
      modDepth: 0.28,
      modRate: 0.74,
    },
    defaultMod: { shape: 'sine', target: 'pitch' },
    axisLabels: {
      xLeft: 'Pure Whistle',
      xRight: 'Breathy Whistle',
      yBottom: 'Tiny Toy',
      yTop: 'Big Brass',
    },
  },
  {
    id: 'deflate-whoop',
    name: 'Deflate Whoop',
    category: 'Risers & Drops',
    tag: 'Sad Downer',
    description:
      'A rubbery downward whoop like a balloon losing air, for letdowns and comic sighs.',
    topology: TOPOLOGY.drop,
    baseFreq: 160,
    modalRatios: [1, 1.01],
    fmRatio: 1.6,
    noiseMix: 0.25,
    stereoSpread: 0.25,
    wave: 'triangle',
    defaultMacros: {
      x: 0.4,
      y: 0.3,
      space: 0.08,
      grit: 0.05,
      speed: 0.3,
      pitch: 0.5,
      modDepth: 0.3,
      modRate: 0.78,
    },
    defaultMod: { shape: 'sine', target: 'amp' },
    axisLabels: {
      xLeft: 'Rubber',
      xRight: 'Squeaky',
      yBottom: 'Small Balloon',
      yTop: 'Bouncy Castle',
    },
  },
  {
    id: 'downlifter-sweep',
    name: 'Downlifter Sweep',
    category: 'Risers & Drops',
    tag: 'Transition Out',
    description:
      'An airy falling sweep that releases energy after a drop or settles into a calm scene.',
    topology: TOPOLOGY.drop,
    baseFreq: 140,
    modalRatios: [1, 1.5],
    fmRatio: 2,
    noiseMix: 0.8,
    stereoSpread: 0.75,
    wave: 'sawtooth',
    defaultMacros: {
      x: 0.7,
      y: 0.4,
      space: 0.5,
      grit: 0.05,
      speed: 0.45,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Tonal Fall',
      xRight: 'Airy Fall',
      yBottom: 'Gentle Release',
      yTop: 'Massive Release',
    },
  },

  // ── Foley & Physics ────────────────────────────────────────────────
  {
    id: 'nordic-oak',
    name: 'Nordic Oak Knock',
    category: 'Foley & Physics',
    tag: 'Wood Knock',
    description:
      'A warm oak-like knock with clustered wooden resonances and a short grainy attack.',
    topology: TOPOLOGY.modal,
    baseFreq: 330,
    modalRatios: [1, 1.47, 2.09, 2.56, 3.12],
    fmRatio: 1,
    noiseMix: 0.34,
    stereoSpread: 0.08,
    defaultMacros: {
      x: 0.36,
      y: 0.58,
      space: 0.1,
      grit: 0.16,
      speed: 0.22,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Oiled Oak',
      xRight: 'Dry End Grain',
      yBottom: 'Thin Panel',
      yTop: 'Solid Timber',
    },
  },
  {
    id: 'crystal-goblet',
    name: 'Crystal Goblet Ping',
    category: 'Foley & Physics',
    tag: 'Glass Ring',
    description:
      'A delicate goblet-like ring with widely spaced resonances and a fine glassy attack.',
    topology: TOPOLOGY.modal,
    baseFreq: 880,
    modalRatios: [1, 2.32, 4.25, 6.63, 9.38],
    fmRatio: 2.32,
    noiseMix: 0.06,
    stereoSpread: 0.24,
    defaultMacros: {
      x: 0.76,
      y: 0.25,
      space: 0.24,
      grit: 0.01,
      speed: 0.68,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Frosted Rim',
      xRight: 'Crystal Sparkle',
      yBottom: 'Thin Stemware',
      yTop: 'Heavy Goblet',
    },
  },
  {
    id: 'cavern-droplet',
    name: 'Cavern Water Droplet',
    category: 'Foley & Physics',
    tag: 'Water Plink',
    description:
      'A rounded droplet-like plink with a hollow wet body and a spacious cavern tail.',
    topology: TOPOLOGY.modal,
    baseFreq: 690,
    modalRatios: [1, 1.68, 2.74, 3.85, 5.19],
    fmRatio: 1.5,
    noiseMix: 0.22,
    stereoSpread: 0.46,
    defaultMacros: {
      x: 0.48,
      y: 0.42,
      space: 0.76,
      grit: 0.02,
      speed: 0.48,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Velvet Water',
      xRight: 'Silver Splash',
      yBottom: 'Tiny Droplet',
      yTop: 'Deep Pool',
    },
  },
  {
    id: 'titanium-pipe',
    name: 'Hollow Titanium Pipe',
    category: 'Foley & Physics',
    tag: 'Metal Strike',
    description:
      'A hollow pipe-like strike with separated metallic partials and a lingering ring.',
    topology: TOPOLOGY.modal,
    baseFreq: 285,
    modalRatios: [1, 2.32, 3.89, 5.14, 6.71],
    fmRatio: 3.89,
    noiseMix: 0.2,
    stereoSpread: 0.2,
    defaultMacros: {
      x: 0.68,
      y: 0.66,
      space: 0.28,
      grit: 0.18,
      speed: 0.7,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Brushed Metal',
      xRight: 'Bright Chrome',
      yBottom: 'Narrow Tube',
      yTop: 'Heavy Conduit',
    },
  },
  {
    id: 'cardstock-snap',
    name: 'Thick Cardstock Snap',
    category: 'Foley & Physics',
    tag: 'Paper Snap',
    description:
      'A dry, noise-led paper snap with just enough broad resonance to suggest stiff card.',
    topology: TOPOLOGY.modal,
    baseFreq: 1240,
    modalRatios: [1, 1.31, 1.87, 2.63, 3.76],
    fmRatio: 1.31,
    noiseMix: 0.94,
    stereoSpread: 0.06,
    defaultMacros: {
      x: 0.72,
      y: 0.32,
      space: 0.03,
      grit: 0.14,
      speed: 0.06,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Soft Paper',
      xRight: 'Crisp Fold',
      yBottom: 'Postcard Flick',
      yTop: 'Thick Card Slap',
    },
  },
  {
    id: 'cash-register-chaching',
    name: 'Cash Register Cha-Ching',
    category: 'Foley & Physics',
    tag: 'Cash Bell',
    description:
      'A cash-register-inspired bell strike with a golden ring and a crisp mechanical edge for sales and reward reveals.',
    topology: TOPOLOGY.modal,
    baseFreq: 1046.5,
    modalRatios: [1, 1.5, 2, 3, 4.5],
    fmRatio: 1.5,
    noiseMix: 0.2,
    stereoSpread: 0.26,
    defaultMacros: {
      x: 0.74,
      y: 0.4,
      space: 0.18,
      grit: 0.12,
      speed: 0.48,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Old Brass',
      xRight: 'Fresh Coins',
      yBottom: 'Small Tip',
      yTop: 'Jackpot Bell',
    },
  },
  {
    id: 'glass-shatter-ping',
    name: 'Glass Shatter Ping',
    category: 'Foley & Physics',
    tag: 'Crystal Break',
    description:
      'A stylized glass-break accent combining a sharp noisy strike with bright, inharmonic shard-like resonances.',
    topology: TOPOLOGY.modal,
    baseFreq: 1260,
    modalRatios: [1, 1.93, 3.17, 5.29, 7.61],
    fmRatio: 5.29,
    noiseMix: 0.76,
    stereoSpread: 0.72,
    defaultMacros: {
      x: 0.9,
      y: 0.3,
      space: 0.24,
      grit: 0.2,
      speed: 0.3,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Cracked Pane',
      xRight: 'Crystal Shards',
      yBottom: 'Thin Glass',
      yTop: 'Heavy Window',
    },
  },
  {
    id: 'cloth-sleeve-swish',
    name: 'Cloth Sleeve Swish',
    category: 'Foley & Physics',
    tag: 'Fabric',
    description:
      'A quick fabric swish like a sleeve or jacket moving past the mic, for hand gestures and body movement.',
    topology: TOPOLOGY.whoosh,
    baseFreq: 180,
    modalRatios: [1, 1.5, 2, 3, 4],
    fmRatio: 1,
    noiseMix: 0.95,
    stereoSpread: 0.3,
    defaultMacros: {
      x: 0.3,
      y: 0.3,
      space: 0.04,
      grit: 0.02,
      speed: 0.05,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Cotton',
      xRight: 'Nylon',
      yBottom: 'Light Sleeve',
      yTop: 'Heavy Coat',
    },
  },

  {
    id: 'door-knock',
    name: 'Door Knock',
    category: 'Foley & Physics',
    tag: 'Knock Knock',
    description: 'Three firm knuckle knocks on a wooden door for arrivals, surprises and "who\'s there?".',
    keywords: ['knock', 'door', 'knock knock', 'wood'],
    topology: TOPOLOGY.modal,
    baseFreq: 180,
    modalRatios: [1, 1.47, 2.09, 2.56],
    fmRatio: 1,
    noiseMix: 0.5,
    stereoSpread: 0.1,
    sequence: [{ at: 0 }, { at: 0.18, vel: 0.9 }, { at: 0.36, vel: 0.95 }],
    defaultMacros: { x: 0.35, y: 0.65, space: 0.15, grit: 0.05, speed: 0.1, pitch: 0.5 },
    axisLabels: { xLeft: 'Thick Door', xRight: 'Thin Door', yBottom: 'Polite', yTop: 'Pounding' },
  },
  {
    id: 'rubber-ball-bounce',
    name: 'Rubber Ball Bounce',
    category: 'Foley & Physics',
    tag: 'Bounce',
    description: 'A rubber ball bouncing to rest, with each bounce quicker and softer than the last.',
    keywords: ['bounce', 'ball', 'basketball', 'drop'],
    topology: TOPOLOGY.modal,
    baseFreq: 190,
    modalRatios: [1, 1.62, 2.4],
    fmRatio: 1,
    noiseMix: 0.2,
    stereoSpread: 0.2,
    sequence: bounce(7, 0.4, 0.72),
    defaultMacros: { x: 0.3, y: 0.55, space: 0.1, grit: 0, speed: 0.12, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft Rubber', xRight: 'Hard Ball', yBottom: 'Small Ball', yTop: 'Basketball' },
  },
  {
    id: 'coin-drop-spin',
    name: 'Coin Drop & Spin',
    category: 'Foley & Physics',
    tag: 'Coin Drop',
    description: 'A coin hitting the table and rattling to a stop, for money, tips and "drop a coin".',
    keywords: ['coin', 'drop', 'money', 'spin', 'rattle'],
    topology: TOPOLOGY.modal,
    baseFreq: 2600,
    modalRatios: [1, 2.4, 4.1],
    fmRatio: 1,
    noiseMix: 0.15,
    stereoSpread: 0.3,
    sequence: bounce(10, 0.18, 0.78),
    defaultMacros: { x: 0.85, y: 0.25, space: 0.15, grit: 0, speed: 0.35, pitch: 0.5 },
    axisLabels: { xLeft: 'Copper', xRight: 'Silver', yBottom: 'Small Coin', yTop: 'Heavy Coin' },
  },
  {
    id: 'keyboard-typing',
    name: 'Keyboard Typing',
    category: 'Foley & Physics',
    tag: 'Typing',
    description: 'A burst of natural keyboard typing for tutorials, hacker scenes and "texting" shots.',
    keywords: ['typing', 'keyboard', 'type', 'computer', 'hacker', 'asmr'],
    topology: TOPOLOGY.drum,
    baseFreq: 100,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0.3,
    sequence: typing(),
    defaultMacros: { x: 0.55, y: 0.4, space: 0.08, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Laptop', xRight: 'Mechanical', yBottom: 'Light Touch', yTop: 'Heavy Typist' },
  },
  {
    id: 'body-fall-thud',
    name: 'Body Fall Thud',
    category: 'Foley & Physics',
    tag: 'Fall',
    description: 'A heavy body or bag hitting the floor, for falls, faints and dramatic drops.',
    keywords: ['fall', 'thud', 'drop', 'body', 'faint'],
    topology: TOPOLOGY.boom,
    baseFreq: 70,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 0.5,
    noiseMix: 0.65,
    stereoSpread: 0.1,
    defaultMacros: { x: 0.35, y: 0.7, space: 0.1, grit: 0.15, speed: 0.05, pitch: 0.5 },
    axisLabels: { xLeft: 'Carpet', xRight: 'Wooden Floor', yBottom: 'Light Bag', yTop: 'Heavy Body' },
  },
  {
    id: 'crowd-applause',
    name: 'Crowd Applause',
    category: 'Foley & Physics',
    tag: 'Applause',
    description: 'A small crowd clapping that swells and fades, for wins, endings and standing ovations.',
    keywords: ['applause', 'clapping', 'crowd', 'audience', 'cheer'],
    topology: TOPOLOGY.drum,
    baseFreq: 100,
    modalRatios: [1],
    fmRatio: 1,
    noiseMix: 0,
    stereoSpread: 0.9,
    sequence: applause(),
    defaultMacros: { x: 0.55, y: 0.5, space: 0.4, grit: 0, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Muffled', xRight: 'Crisp', yBottom: 'Small Room', yTop: 'Hall' },
  },

  // ── Footsteps ──────────────────────────────────────────────────────
  {
    id: 'walking-on-wood',
    name: 'Walking on Wood',
    category: 'Footsteps',
    tag: 'Walk',
    description: 'Four calm footsteps across a creaky wooden floor, alternating left and right.',
    keywords: ['walking', 'footsteps', 'wood', 'floor', 'walk'],
    topology: TOPOLOGY.step,
    baseFreq: 120,
    modalRatios: [1, 1.47, 2.09],
    fmRatio: 0.35,
    noiseMix: 0.32,
    stereoSpread: 0.4,
    sequence: steps(4, 0.55),
    defaultMacros: { x: 0.7, y: 0.5, space: 0.2, grit: 0.05, speed: 0.4, pitch: 0.5 },
    axisLabels: { xLeft: 'Rug Edge', xRight: 'Bare Oak', yBottom: 'Tiptoe', yTop: 'Firm Heel' },
  },
  {
    id: 'running-on-concrete',
    name: 'Running on Concrete',
    category: 'Footsteps',
    tag: 'Run',
    description: 'Six fast running steps on concrete for chases, sprints and action cuts.',
    keywords: ['running', 'run', 'sprint', 'chase', 'footsteps'],
    topology: TOPOLOGY.step,
    baseFreq: 95,
    modalRatios: [1, 1.6, 2.4],
    fmRatio: 0.05,
    noiseMix: 0.45,
    stereoSpread: 0.4,
    sequence: steps(6, 0.3),
    defaultMacros: { x: 0.65, y: 0.6, space: 0.1, grit: 0.04, speed: 0.25, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft Rubber', xRight: 'Hard Concrete', yBottom: 'Light Jog', yTop: 'Heavy Sprint' },
  },
  {
    id: 'high-heels-walking',
    name: 'High Heels Walking',
    category: 'Footsteps',
    tag: 'Heels Walk',
    description: 'Confident high-heel steps across a marble lobby, for entrances and fashion reels.',
    keywords: ['heels', 'high heels', 'walking', 'fashion', 'entrance'],
    topology: TOPOLOGY.step,
    baseFreq: 160,
    modalRatios: [1, 2.76, 5.4],
    fmRatio: 0.25,
    noiseMix: 0.2,
    stereoSpread: 0.4,
    sequence: steps(4, 0.5),
    defaultMacros: { x: 0.92, y: 0.3, space: 0.38, grit: 0.02, speed: 0.2, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft Tile', xRight: 'Polished Marble', yBottom: 'Delicate', yTop: 'Confident' },
  },
  {
    id: 'walking-on-gravel',
    name: 'Walking on Gravel',
    category: 'Footsteps',
    tag: 'Gravel Walk',
    description: 'Four crunchy steps along a gravel path for outdoor vlogs and nature walks.',
    keywords: ['gravel', 'walking', 'outdoor', 'path', 'crunch'],
    topology: TOPOLOGY.step,
    baseFreq: 80,
    modalRatios: [1, 2, 3],
    fmRatio: 0,
    noiseMix: 0.88,
    stereoSpread: 0.4,
    sequence: steps(4, 0.6),
    defaultMacros: { x: 0.6, y: 0.6, space: 0.1, grit: 0.08, speed: 0.55, pitch: 0.5 },
    axisLabels: { xLeft: 'Fine Grit', xRight: 'Coarse Stone', yBottom: 'Light Step', yTop: 'Heavy Boot' },
  },
  // fmRatio = floor ring amount (0–1); modalRatios = floor resonances relative to 4× baseFreq.
  {
    id: 'sneaker-concrete',
    name: 'Sneaker on Concrete',
    category: 'Footsteps',
    tag: 'Urban Step',
    description:
      'A firm rubber-sole step on concrete with a soft heel thump and a clean scuff. Every hit varies slightly.',
    topology: TOPOLOGY.step,
    baseFreq: 95,
    modalRatios: [1, 1.6, 2.4],
    fmRatio: 0.05,
    noiseMix: 0.4,
    stereoSpread: 0.15,
    defaultMacros: {
      x: 0.62,
      y: 0.55,
      space: 0.12,
      grit: 0.04,
      speed: 0.35,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Soft Rubber',
      xRight: 'Hard Concrete',
      yBottom: 'Light Jog',
      yTop: 'Heavy Stomp',
    },
  },
  {
    id: 'leather-hardwood',
    name: 'Leather Shoe Hardwood',
    category: 'Footsteps',
    tag: 'Wood Floor',
    description:
      'A polished leather heel on an old hardwood floor with a hollow board resonance.',
    topology: TOPOLOGY.step,
    baseFreq: 120,
    modalRatios: [1, 1.47, 2.09],
    fmRatio: 0.35,
    noiseMix: 0.32,
    stereoSpread: 0.12,
    defaultMacros: {
      x: 0.7,
      y: 0.5,
      space: 0.2,
      grit: 0.05,
      speed: 0.4,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Rug Edge',
      xRight: 'Bare Oak',
      yBottom: 'Tiptoe',
      yTop: 'Firm Heel',
    },
  },
  {
    id: 'gravel-path',
    name: 'Gravel Path Crunch',
    category: 'Footsteps',
    tag: 'Gravel',
    description:
      'Boots pressing into loose gravel with a dense spray of tiny stone grains.',
    topology: TOPOLOGY.step,
    baseFreq: 80,
    modalRatios: [1, 2, 3],
    fmRatio: 0,
    noiseMix: 0.88,
    stereoSpread: 0.3,
    defaultMacros: {
      x: 0.6,
      y: 0.6,
      space: 0.1,
      grit: 0.08,
      speed: 0.55,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Fine Grit',
      xRight: 'Coarse Stone',
      yBottom: 'Light Step',
      yTop: 'Heavy Boot',
    },
  },
  {
    id: 'snow-crunch',
    name: 'Fresh Snow Crunch',
    category: 'Footsteps',
    tag: 'Snow',
    description:
      'A slow, compressed crunch into fresh powder with a muffled, cold body.',
    topology: TOPOLOGY.step,
    baseFreq: 70,
    modalRatios: [1, 2, 3],
    fmRatio: 0,
    noiseMix: 0.7,
    stereoSpread: 0.2,
    defaultMacros: {
      x: 0.3,
      y: 0.55,
      space: 0.05,
      grit: 0.02,
      speed: 0.7,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Powder',
      xRight: 'Packed Ice',
      yBottom: 'Soft Sink',
      yTop: 'Deep Crunch',
    },
  },
  {
    id: 'forest-leaves',
    name: 'Forest Leaf Litter',
    category: 'Footsteps',
    tag: 'Leaves',
    description:
      'A soft step through dry leaves and twigs with a crisp, papery rustle.',
    topology: TOPOLOGY.step,
    baseFreq: 75,
    modalRatios: [1, 2, 3],
    fmRatio: 0,
    noiseMix: 0.62,
    stereoSpread: 0.35,
    defaultMacros: {
      x: 0.78,
      y: 0.35,
      space: 0.14,
      grit: 0.04,
      speed: 0.6,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Damp Moss',
      xRight: 'Dry Leaves',
      yBottom: 'Light Stroll',
      yTop: 'Heavy Trudge',
    },
  },
  {
    id: 'metal-catwalk',
    name: 'Metal Catwalk Step',
    category: 'Footsteps',
    tag: 'Metal Grate',
    description:
      'A heavy boot on a steel grating with a bright, ringing metallic shimmer.',
    topology: TOPOLOGY.step,
    baseFreq: 110,
    modalRatios: [1, 2.32, 3.89],
    fmRatio: 0.85,
    noiseMix: 0.45,
    stereoSpread: 0.25,
    defaultMacros: {
      x: 0.8,
      y: 0.65,
      space: 0.32,
      grit: 0.08,
      speed: 0.45,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Rubber Mat',
      xRight: 'Bare Steel',
      yBottom: 'Careful Step',
      yTop: 'Running Boot',
    },
  },
  {
    id: 'stiletto-marble',
    name: 'Stiletto on Marble',
    category: 'Footsteps',
    tag: 'High Heels',
    description:
      'A sharp, confident heel click on polished marble with a short lobby echo.',
    topology: TOPOLOGY.step,
    baseFreq: 160,
    modalRatios: [1, 2.76, 5.4],
    fmRatio: 0.25,
    noiseMix: 0.2,
    stereoSpread: 0.1,
    defaultMacros: {
      x: 0.92,
      y: 0.3,
      space: 0.38,
      grit: 0.02,
      speed: 0.2,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Soft Tile',
      xRight: 'Polished Marble',
      yBottom: 'Delicate Tap',
      yTop: 'Confident Strike',
    },
  },

  // ── Bells & Chimes ─────────────────────────────────────────────────
  // fmRatio = attack shimmer FM ratio (0 = off); strikes/pattern control multi-note chimes.
  {
    id: 'hotel-desk-bell',
    name: 'Hotel Desk Bell',
    category: 'Bells & Chimes',
    tag: 'Desk Ding',
    description:
      'A bright reception desk bell with a clean strike and a long, shimmering ring.',
    topology: TOPOLOGY.bell,
    baseFreq: 1568,
    modalRatios: [1, 2.02, 2.76, 3.6, 4.98, 6.12],
    fmRatio: 1.41,
    noiseMix: 0.25,
    stereoSpread: 0.25,
    defaultMacros: {
      x: 0.66,
      y: 0.45,
      space: 0.2,
      grit: 0.02,
      speed: 0.45,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Muted Brass',
      xRight: 'Polished Steel',
      yBottom: 'Quick Ding',
      yTop: 'Long Ring',
    },
  },
  {
    id: 'champagne-cling',
    name: 'Champagne Glass Cling',
    category: 'Bells & Chimes',
    tag: 'Glass Toast',
    description:
      'Two crystal glasses touching in a toast, with a delicate double ring.',
    topology: TOPOLOGY.bell,
    baseFreq: 1850,
    modalRatios: [1, 2.32, 4.25, 6.63],
    fmRatio: 0,
    noiseMix: 0.15,
    stereoSpread: 0.4,
    strikes: 2,
    pattern: 'repeat',
    defaultMacros: {
      x: 0.72,
      y: 0.3,
      space: 0.22,
      grit: 0.01,
      speed: 0.4,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Thick Tumbler',
      xRight: 'Fine Crystal',
      yBottom: 'Gentle Touch',
      yTop: 'Festive Clink',
    },
  },
  {
    id: 'soft-notification-ding',
    name: 'Soft Notification Ding',
    category: 'Bells & Chimes',
    tag: 'Gentle Ding',
    description:
      'A rounded, friendly ding for notifications, captions, and success states.',
    topology: TOPOLOGY.bell,
    baseFreq: 1046.5,
    modalRatios: [1, 2, 3.01, 4.1],
    fmRatio: 0,
    noiseMix: 0.05,
    stereoSpread: 0.2,
    defaultMacros: {
      x: 0.4,
      y: 0.4,
      space: 0.18,
      grit: 0,
      speed: 0.3,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Velvet',
      xRight: 'Glass',
      yBottom: 'Subtle',
      yTop: 'Present',
    },
  },
  {
    id: 'achievement-chime',
    name: 'Achievement Unlock Chime',
    category: 'Bells & Chimes',
    tag: 'Success',
    description:
      'A bright three-note rising chime for level-ups, wins, and unlocked rewards.',
    topology: TOPOLOGY.bell,
    baseFreq: 784,
    modalRatios: [1, 2, 3, 4.1],
    fmRatio: 2,
    noiseMix: 0.08,
    stereoSpread: 0.35,
    strikes: 3,
    pattern: 'up',
    defaultMacros: {
      x: 0.62,
      y: 0.4,
      space: 0.3,
      grit: 0,
      speed: 0.35,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Soft Mallet',
      xRight: 'Sparkle Bell',
      yBottom: 'Quick Win',
      yTop: 'Grand Victory',
    },
  },
  {
    id: 'music-box-arpeggio',
    name: 'Music Box Arpeggio',
    category: 'Bells & Chimes',
    tag: 'Music Box',
    description:
      'A tiny steel-comb music box playing a sweet rising arpeggio.',
    topology: TOPOLOGY.bell,
    baseFreq: 1046.5,
    modalRatios: [1, 3.01, 6.27],
    fmRatio: 0,
    noiseMix: 0.06,
    stereoSpread: 0.3,
    strikes: 4,
    pattern: 'up',
    defaultMacros: {
      x: 0.7,
      y: 0.25,
      space: 0.25,
      grit: 0,
      speed: 0.3,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Wooden Box',
      xRight: 'Steel Comb',
      yBottom: 'Tiny Tines',
      yTop: 'Rich Tines',
    },
  },
  {
    id: 'wind-chimes',
    name: 'Wind Chimes',
    category: 'Bells & Chimes',
    tag: 'Chime Cluster',
    description:
      'A breezy cluster of aluminium chimes striking at random pentatonic pitches — different every time.',
    topology: TOPOLOGY.bell,
    baseFreq: 1318.5,
    modalRatios: [1, 2.756, 5.404],
    fmRatio: 0,
    noiseMix: 0.1,
    stereoSpread: 0.9,
    strikes: 7,
    pattern: 'random',
    defaultMacros: {
      x: 0.62,
      y: 0.5,
      space: 0.35,
      grit: 0,
      speed: 0.65,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Bamboo',
      xRight: 'Aluminium',
      yBottom: 'Gentle Breeze',
      yTop: 'Gusty Wind',
    },
  },
  {
    id: 'tubular-bell',
    name: 'Tubular Orchestra Bell',
    category: 'Bells & Chimes',
    tag: 'Orchestral',
    description:
      'A full orchestral tubular bell with a firm mallet strike and a stately decay.',
    topology: TOPOLOGY.bell,
    baseFreq: 392,
    modalRatios: [1, 2.756, 5.404, 8.933],
    fmRatio: 0,
    noiseMix: 0.18,
    stereoSpread: 0.3,
    defaultMacros: {
      x: 0.55,
      y: 0.7,
      space: 0.4,
      grit: 0.02,
      speed: 0.85,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Felt Mallet',
      xRight: 'Hard Mallet',
      yBottom: 'Short Chime',
      yTop: 'Cathedral Ring',
    },
  },
  {
    id: 'temple-singing-bowl',
    name: 'Temple Singing Bowl',
    category: 'Bells & Chimes',
    tag: 'Meditation',
    description:
      'A warm bronze singing bowl with slow beating overtones and a very long bloom.',
    topology: TOPOLOGY.bell,
    baseFreq: 220,
    modalRatios: [1, 2.71, 5.12, 8.1],
    fmRatio: 0,
    noiseMix: 0.08,
    stereoSpread: 0.5,
    defaultMacros: {
      x: 0.32,
      y: 0.8,
      space: 0.45,
      grit: 0,
      speed: 0.95,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Dark Bronze',
      xRight: 'Bright Brass',
      yBottom: 'Small Bowl',
      yTop: 'Grand Bowl',
    },
  },
  {
    id: 'distant-church-bell',
    name: 'Distant Church Bell',
    category: 'Bells & Chimes',
    tag: 'Town Bell',
    description:
      'A large bronze tower bell heard across town, with a low hum and a long, wide tail.',
    topology: TOPOLOGY.bell,
    baseFreq: 196,
    modalRatios: [0.5, 1, 1.183, 1.506, 2, 2.514, 2.662, 3.011],
    fmRatio: 0,
    noiseMix: 0.2,
    stereoSpread: 0.45,
    defaultMacros: {
      x: 0.45,
      y: 0.85,
      space: 0.7,
      grit: 0.02,
      speed: 1,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Dark Bronze',
      xRight: 'Bright Bronze',
      yBottom: 'Small Chapel',
      yTop: 'Grand Cathedral',
    },
  },

  {
    id: 'ding-dong-doorbell',
    name: 'Ding Dong Doorbell',
    category: 'Bells & Chimes',
    tag: 'Doorbell',
    description: 'A classic two-tone "ding-dong" doorbell for deliveries, visitors and surprises.',
    keywords: ['doorbell', 'ding dong', 'door', 'visitor', 'delivery'],
    topology: TOPOLOGY.bell,
    baseFreq: 659.25,
    modalRatios: [1, 2.01, 3, 4.2],
    fmRatio: 0,
    noiseMix: 0.1,
    stereoSpread: 0.2,
    sequence: [{ at: 0, semi: 0 }, { at: 0.55, semi: -4 }],
    defaultMacros: { x: 0.5, y: 0.55, space: 0.25, grit: 0, speed: 0.55, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft Chime', xRight: 'Bright Chime', yBottom: 'Short', yTop: 'Ringing' },
  },
  {
    id: 'boxing-ring-bell',
    name: 'Boxing Ring Bell',
    category: 'Bells & Chimes',
    tag: 'Fight Bell',
    description: 'Three hard "ding ding ding" strikes of a boxing bell for fights, rounds and showdowns.',
    keywords: ['boxing', 'ring', 'fight', 'round', 'ding ding'],
    topology: TOPOLOGY.bell,
    baseFreq: 1150,
    modalRatios: [1, 2.02, 2.76, 3.6],
    fmRatio: 1.41,
    noiseMix: 0.3,
    stereoSpread: 0.2,
    sequence: [{ at: 0 }, { at: 0.28 }, { at: 0.56 }],
    defaultMacros: { x: 0.7, y: 0.5, space: 0.25, grit: 0.02, speed: 0.5, pitch: 0.5 },
    axisLabels: { xLeft: 'Dull Brass', xRight: 'Bright Steel', yBottom: 'Short', yTop: 'Ringing' },
  },
  {
    id: 'big-gong-crash',
    name: 'Big Gong Crash',
    category: 'Bells & Chimes',
    tag: 'Gong',
    description: 'A huge shimmering gong for epic intros, announcements and dramatic entrances.',
    keywords: ['gong', 'epic', 'intro', 'asian', 'announcement'],
    topology: TOPOLOGY.bell,
    baseFreq: 110,
    modalRatios: [1, 1.52, 2.03, 2.48, 3.1, 4.2],
    fmRatio: 1.41,
    noiseMix: 0.4,
    stereoSpread: 0.6,
    defaultMacros: { x: 0.55, y: 0.9, space: 0.6, grit: 0.05, speed: 1, pitch: 0.5 },
    axisLabels: { xLeft: 'Dark Bronze', xRight: 'Shimmering', yBottom: 'Small Gong', yTop: 'Temple Gong' },
  },
  {
    id: 'elevator-ding',
    name: 'Elevator Ding',
    category: 'Bells & Chimes',
    tag: 'Elevator',
    description: 'A soft single elevator arrival chime for "next level" and arrival moments.',
    keywords: ['elevator', 'ding', 'arrival', 'lift'],
    topology: TOPOLOGY.bell,
    baseFreq: 1046.5,
    modalRatios: [1, 2, 2.98],
    fmRatio: 0,
    noiseMix: 0.05,
    stereoSpread: 0.2,
    defaultMacros: { x: 0.4, y: 0.45, space: 0.2, grit: 0, speed: 0.45, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft', xRight: 'Bright', yBottom: 'Quick', yTop: 'Ringing' },
  },

  // ── Sci-Fi & Glitch ────────────────────────────────────────────────
  {
    id: 'laser-zap',
    name: 'Laser Zap',
    category: 'Sci-Fi & Glitch',
    tag: 'Laser',
    description: 'A fast falling laser "pew" for shots, zaps and power-ups.',
    keywords: ['laser', 'pew', 'zap', 'shoot', 'blaster'],
    topology: TOPOLOGY.drop,
    baseFreq: 300,
    modalRatios: [1, 1.5],
    fmRatio: 3,
    noiseMix: 0.05,
    stereoSpread: 0.3,
    wave: 'triangle',
    defaultMacros: { x: 0.6, y: 0.1, space: 0.15, grit: 0.1, speed: 0.02, pitch: 0.5 },
    axisLabels: { xLeft: 'Soft Ray', xRight: 'Bright Blast', yBottom: 'Small Gun', yTop: 'Cannon' },
  },
  {
    id: 'teleport-warp',
    name: 'Teleport Warp',
    category: 'Sci-Fi & Glitch',
    tag: 'Teleport',
    description: 'A rising shimmering warp for teleports, magic swaps and appear/disappear edits.',
    keywords: ['teleport', 'warp', 'disappear', 'appear', 'portal'],
    topology: TOPOLOGY.rise,
    baseFreq: 220,
    modalRatios: [1, 1.5, 2.01],
    fmRatio: 2.5,
    noiseMix: 0.4,
    stereoSpread: 0.8,
    wave: 'triangle',
    defaultMacros: { x: 0.65, y: 0.3, space: 0.45, grit: 0.05, speed: 0.15, pitch: 0.5, modDepth: 0.3, modRate: 0.85 },
    defaultMod: { shape: 'triangle', target: 'pitch' },
    axisLabels: { xLeft: 'Tonal', xRight: 'Airy', yBottom: 'Small', yTop: 'Huge' },
  },
  {
    id: 'neural-telemetry',
    name: 'Neural Link Telemetry',
    category: 'Sci-Fi & Glitch',
    tag: 'Data Pulse',
    description:
      'A precise digital pulse with a clear tonal center and small, restless electronic edges.',
    topology: TOPOLOGY.glitch,
    baseFreq: 880,
    modalRatios: [1, 2, 3, 5, 7],
    fmRatio: 2,
    noiseMix: 0.08,
    stereoSpread: 0.42,
    defaultMacros: {
      x: 0.58,
      y: 0.22,
      space: 0.14,
      grit: 0.16,
      speed: 0.2,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Clean Signal',
      xRight: 'Electric Flecks',
      yBottom: 'Tiny Synapse',
      yTop: 'Network Pulse',
    },
  },
  {
    id: 'hologram-boot',
    name: 'Hologram Boot Sequence',
    category: 'Sci-Fi & Glitch',
    tag: 'Luminous Startup',
    description:
      'A spacious digital shimmer with stepped edges, a soft luminous tonal foundation, and a slow auto-pan.',
    topology: TOPOLOGY.glitch,
    baseFreq: 523.25,
    modalRatios: [1, 2, 3, 4, 6],
    fmRatio: 1.5,
    noiseMix: 0.14,
    stereoSpread: 0.74,
    defaultMacros: {
      x: 0.64,
      y: 0.38,
      space: 0.46,
      grit: 0.12,
      speed: 0.64,
      pitch: 0.5,
      modDepth: 0.35,
      modRate: 0.45,
    },
    defaultMod: { shape: 'triangle', target: 'pan' },
    axisLabels: {
      xLeft: 'Frosted Light',
      xRight: 'Prismatic Shards',
      yBottom: 'Floating Icon',
      yTop: 'Full Projection',
    },
  },
  {
    id: 'data-corrupt',
    name: 'Cyberpunk Data Corrupt',
    category: 'Sci-Fi & Glitch',
    tag: 'Broken Signal',
    description:
      'A torn electronic burst with noisy fragments, dissonant sidebands, and a rough digital bite.',
    topology: TOPOLOGY.glitch,
    baseFreq: 370,
    modalRatios: [1, 1.41, 2.73, 4.11, 6.37],
    fmRatio: 6.37,
    noiseMix: 0.58,
    stereoSpread: 0.62,
    defaultMacros: {
      x: 0.88,
      y: 0.48,
      space: 0.16,
      grit: 0.78,
      speed: 0.28,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Frayed Wire',
      xRight: 'Shattered Pixels',
      yBottom: 'Brief Error',
      yTop: 'System Fracture',
    },
  },
  {
    id: 'plasma-deflect',
    name: 'Plasma Shield Deflect',
    category: 'Sci-Fi & Glitch',
    tag: 'Energy Strike',
    description:
      'A compact charged strike with a firm electronic body and a sharp metallic halo.',
    topology: TOPOLOGY.glitch,
    baseFreq: 740,
    modalRatios: [1, 2.32, 3.89, 5.14, 6.71],
    fmRatio: 3.5,
    noiseMix: 0.3,
    stereoSpread: 0.68,
    defaultMacros: {
      x: 0.78,
      y: 0.64,
      space: 0.32,
      grit: 0.38,
      speed: 0.22,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Soft Energy',
      xRight: 'Ion Sparks',
      yBottom: 'Glancing Touch',
      yTop: 'Shield Collision',
    },
  },
  {
    id: 'quantum-spool',
    name: 'Quantum Drive Spool',
    category: 'Sci-Fi & Glitch',
    tag: 'Engine Charge',
    description:
      'A low electronic engine tone with a dense harmonic body and a slowly breathing filter halo.',
    topology: TOPOLOGY.glitch,
    baseFreq: 233.08,
    modalRatios: [1, 1.5, 2, 3, 4.5],
    fmRatio: 0.75,
    noiseMix: 0.2,
    stereoSpread: 0.82,
    defaultMacros: {
      x: 0.52,
      y: 0.76,
      space: 0.5,
      grit: 0.3,
      speed: 0.88,
      pitch: 0.5,
      modDepth: 0.3,
      modRate: 0.35,
    },
    defaultMod: { shape: 'sine', target: 'filter' },
    axisLabels: {
      xLeft: 'Smooth Reactor',
      xRight: 'Crackling Core',
      yBottom: 'Idle Hover',
      yTop: 'Heavy Drive',
    },
  },
  {
    id: 'glitch-transition-cut',
    name: 'Glitch Transition Cut',
    category: 'Sci-Fi & Glitch',
    tag: 'Digital Cut',
    description:
      'A short, abrasive digital tear with scattered metallic edges for fast montage cuts and glitch transitions.',
    topology: TOPOLOGY.glitch,
    baseFreq: 460,
    modalRatios: [1, 1.73, 2.91, 4.37, 6.83],
    fmRatio: 7.25,
    noiseMix: 0.66,
    stereoSpread: 0.9,
    defaultMacros: {
      x: 0.92,
      y: 0.44,
      space: 0.08,
      grit: 0.84,
      speed: 0.08,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Loose Static',
      xRight: 'Pixel Razor',
      yBottom: 'Tiny Skip',
      yTop: 'Digital Rupture',
    },
  },
  {
    id: 'cyber-scan-lock',
    name: 'Cyber Scan Lock',
    category: 'Sci-Fi & Glitch',
    tag: 'Target Confirm',
    description:
      'A focused scanner-like chirp with a clear tonal anchor and a precise electronic edge for target and identity confirmations.',
    topology: TOPOLOGY.glitch,
    baseFreq: 987.77,
    modalRatios: [1, 2, 3, 4, 5],
    fmRatio: 2,
    noiseMix: 0.06,
    stereoSpread: 0.3,
    defaultMacros: {
      x: 0.66,
      y: 0.28,
      space: 0.16,
      grit: 0.08,
      speed: 0.26,
      pitch: 0.5,
    },
    axisLabels: {
      xLeft: 'Soft Beacon',
      xRight: 'Laser Focus',
      yBottom: 'Distant Marker',
      yTop: 'Firm Lock',
    },
  },
] satisfies RecipeInput[];

/* ── Library expansion: pops, clicks, claps, beats, cartoon, melodies, more viral ── */

const POPS_AND_CLICKS: RecipeInput[] = [
  preset({ id: 'bubble-pop-high', name: 'Bubble Pop High', category: 'UI & Apps', tag: 'Pop', description: 'A tiny, bright bubble pop for stickers, emojis and quick pop-ins.', keywords: ['pop', 'bubble', 'sticker', 'emoji'], topology: TOPOLOGY.ui, baseFreq: 1400, noise: 0.08, macros: mac(0.5, 0.3, 0.06, 0, 0.08), axis: AX.pop }),
  preset({ id: 'bubble-pop-low', name: 'Bubble Pop Low', category: 'UI & Apps', tag: 'Pop', description: 'A rounder, deeper bubble pop for bigger elements and title cards.', keywords: ['pop', 'bubble', 'deep', 'title'], topology: TOPOLOGY.ui, baseFreq: 520, noise: 0.08, macros: mac(0.45, 0.55, 0.08, 0, 0.12), axis: AX.pop }),
  preset({ id: 'cute-pop-up', name: 'Cute Pop-Up', category: 'UI & Apps', tag: 'Pop-Up', description: 'A sweet, springy pop-up for kawaii edits, stickers and captions.', keywords: ['pop up', 'cute', 'kawaii', 'caption'], topology: TOPOLOGY.ui, baseFreq: 1200, fm: 2, noise: 0.05, macros: mac(0.6, 0.3, 0.1, 0, 0.1), axis: AX.pop }),
  preset({ id: 'mouth-pop', name: 'Mouth Pop', category: 'UI & Apps', tag: 'Mouth Pop', description: 'A finger-in-cheek mouth pop for playful reveals and transitions.', keywords: ['mouth pop', 'cheek', 'pop', 'cork'], topology: TOPOLOGY.ui, baseFreq: 700, noise: 0.2, macros: mac(0.35, 0.6, 0.05, 0, 0.07), axis: AX.pop }),
  preset({ id: 'pop-in-notification', name: 'Pop-In Notification', category: 'UI & Apps', tag: 'Pop-In', description: 'A soft pop with a short tail for banners, toasts and in-app messages.', keywords: ['notification', 'pop', 'banner', 'toast'], topology: TOPOLOGY.ui, baseFreq: 880, noise: 0.06, macros: mac(0.55, 0.4, 0.15, 0, 0.2), axis: AX.pop }),
  preset({ id: 'champagne-cork-pop', name: 'Champagne Cork Pop', category: 'Foley & Physics', tag: 'Cork', description: 'A cork flying out of a bottle for celebrations, launches and milestones.', keywords: ['cork', 'champagne', 'celebrate', 'pop', 'bottle'], topology: TOPOLOGY.ui, baseFreq: 380, noise: 0.7, spread: 0.2, macros: mac(0.7, 0.65, 0.15, 0.05, 0.05), axis: AX.pop }),
  preset({ id: 'water-bloop', name: 'Water Bloop', category: 'UI & Apps', tag: 'Bloop', description: 'A liquid upward "bloop" for drops, likes and playful UI moments.', keywords: ['bloop', 'water', 'drop', 'liquid', 'blob'], topology: TOPOLOGY.modal, baseFreq: 520, ratios: [1, 1.6, 2.3], noise: 0.05, macros: mac(0.3, 0.2, 0.08, 0, 0.2), axis: AX.pop }),
  preset({ id: 'plop-drop', name: 'Plop Drop', category: 'Foley & Physics', tag: 'Plop', description: 'A thick little plop, like something dropping into water or mud.', keywords: ['plop', 'drop', 'water', 'mud', 'splash'], topology: TOPOLOGY.modal, baseFreq: 300, ratios: [1, 1.7, 2.6], noise: 0.15, macros: mac(0.35, 0.25, 0.1, 0, 0.15), axis: AX.pop }),
  preset({ id: 'balloon-pop', name: 'Balloon Pop', category: 'Foley & Physics', tag: 'Balloon', description: 'A sharp balloon burst for surprises, party moments and jump scares.', keywords: ['balloon', 'pop', 'burst', 'party', 'bang'], topology: TOPOLOGY.boom, baseFreq: 120, noise: 0.9, spread: 0.3, macros: mac(0.9, 0.3, 0.2, 0.2, 0, { pitch: 0.7 }), axis: AX.pop }),
  preset({ id: 'bubble-wrap-popping', name: 'Bubble Wrap Popping', category: 'Foley & Physics', tag: 'Bubble Wrap', description: 'A satisfying run of bubble-wrap pops — ASMR gold.', keywords: ['bubble wrap', 'pop', 'asmr', 'satisfying'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.6, sequence: scatter('snap', 12, 2.2, 11), macros: mac(0.6, 0.4, 0.06, 0, 0.5), axis: AX.click }),
  preset({ id: 'popcorn-popping', name: 'Popcorn Popping', category: 'Foley & Physics', tag: 'Popcorn', description: 'Kernels popping in a pan, building into a busy crackle.', keywords: ['popcorn', 'pop', 'kitchen', 'cooking', 'movie night'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.7, sequence: crowd('snap', 30, 3, 21), macros: mac(0.55, 0.3, 0.1, 0, 0.5), axis: AX.click }),
  preset({ id: 'toggle-switch-on', name: 'Toggle Switch On', category: 'UI & Apps', tag: 'Toggle On', description: 'A crisp, slightly higher switch click for turning something on.', keywords: ['toggle', 'switch', 'on', 'enable'], topology: TOPOLOGY.ui, baseFreq: 900, noise: 0.5, spread: 0.05, macros: mac(0.7, 0.45, 0.03, 0, 0.03), axis: AX.click }),
  preset({ id: 'toggle-switch-off', name: 'Toggle Switch Off', category: 'UI & Apps', tag: 'Toggle Off', description: 'The lower partner of the toggle-on click for turning something off.', keywords: ['toggle', 'switch', 'off', 'disable'], topology: TOPOLOGY.ui, baseFreq: 620, noise: 0.5, spread: 0.05, macros: mac(0.6, 0.5, 0.03, 0, 0.03), axis: AX.click }),
  preset({ id: 'pen-click', name: 'Pen Click', category: 'Foley & Physics', tag: 'Pen', description: 'A ballpoint pen clicking down and back up — for study, office and "let\'s go" moments.', keywords: ['pen', 'click', 'office', 'study', 'write'], topology: TOPOLOGY.modal, baseFreq: 2400, ratios: [1, 2.3, 3.7], noise: 0.6, spread: 0.1, sequence: [{ at: 0 }, { at: 0.09, vel: 0.7 }], macros: mac(0.8, 0.2, 0.04, 0, 0.02), axis: AX.click }),
  preset({ id: 'light-switch-click', name: 'Light Switch Click', category: 'Foley & Physics', tag: 'Light Switch', description: 'A wall light switch flicked on — for lights-on reveals and room transitions.', keywords: ['light switch', 'switch', 'lights', 'click'], topology: TOPOLOGY.modal, baseFreq: 1500, ratios: [1, 1.8, 2.9], noise: 0.55, spread: 0.05, macros: mac(0.65, 0.45, 0.08, 0, 0.03), axis: AX.click }),
  preset({ id: 'phone-camera-shutter', name: 'Phone Camera Shutter', category: 'UI & Apps', tag: 'Shutter', description: 'A quick two-part camera shutter for photo reveals, screenshots and photo dumps.', keywords: ['camera', 'shutter', 'photo', 'screenshot', 'snap'], topology: TOPOLOGY.modal, baseFreq: 900, ratios: [1, 1.6, 2.7], noise: 0.9, spread: 0.15, sequence: [{ at: 0 }, { at: 0.07, vel: 0.75 }], macros: mac(0.85, 0.35, 0.06, 0.05, 0.03), axis: AX.click }),
  preset({ id: 'tongue-click', name: 'Tongue Click', category: 'UI & Apps', tag: 'Tongue Click', description: 'A wet tongue click for sassy beats, "tsk" moments and subtle accents.', keywords: ['tongue click', 'tsk', 'mouth', 'click'], topology: TOPOLOGY.ui, baseFreq: 1300, noise: 0.3, spread: 0.05, macros: mac(0.4, 0.5, 0.04, 0, 0.02), axis: AX.click }),
  preset({ id: 'mechanical-key-clack', name: 'Mechanical Key Clack', category: 'UI & Apps', tag: 'Keyboard', description: 'One satisfying mechanical keyboard keypress.', keywords: ['keyboard', 'mechanical', 'key', 'click', 'asmr'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0, sequence: [{ at: 0, drum: 'click' }, { at: 0.004, drum: 'rim', vel: 0.35 }], macros: mac(0.5, 0.7, 0.03, 0, 0.5), axis: AX.click }),
  preset({ id: 'seatbelt-click', name: 'Seatbelt Click', category: 'Foley & Physics', tag: 'Buckle', description: 'A seatbelt buckling in — "buckle up" for car vlogs and road trips.', keywords: ['seatbelt', 'buckle', 'car', 'click', 'road trip'], topology: TOPOLOGY.modal, baseFreq: 1800, ratios: [1, 2.76, 5.4], noise: 0.45, spread: 0.1, sequence: [{ at: 0 }, { at: 0.05, vel: 0.8 }], macros: mac(0.8, 0.4, 0.06, 0, 0.05), axis: AX.click }),
  preset({ id: 'door-lock-click', name: 'Door Lock Click', category: 'Foley & Physics', tag: 'Lock', description: 'A latch turning and locking shut for secrets, safes and "locked in" moments.', keywords: ['lock', 'door', 'latch', 'click', 'locked in'], topology: TOPOLOGY.modal, baseFreq: 900, ratios: [1, 2.32, 3.89], noise: 0.5, spread: 0.1, sequence: [{ at: 0, vel: 0.7 }, { at: 0.11 }], macros: mac(0.7, 0.55, 0.08, 0.05, 0.05), axis: AX.click }),
  preset({ id: 'lighter-flick', name: 'Lighter Flick', category: 'Foley & Physics', tag: 'Lighter', description: 'A metal lighter lid flicking open and the wheel striking.', keywords: ['lighter', 'flick', 'zippo', 'fire', 'click'], topology: TOPOLOGY.modal, baseFreq: 3000, ratios: [1, 2.4, 4.1], noise: 0.8, spread: 0.1, sequence: [{ at: 0 }, { at: 0.12, vel: 0.85 }], macros: mac(0.85, 0.3, 0.08, 0.05, 0.04), axis: AX.click }),
  preset({ id: 'ratchet-wind', name: 'Ratchet Wind', category: 'Foley & Physics', tag: 'Ratchet', description: 'A quick ratchet or wind-up toy clicking round — for "loading" and building moments.', keywords: ['ratchet', 'wind up', 'gear', 'clicks', 'loading'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.2, sequence: Array.from({ length: 10 }, (_, i) => ({ at: i * 0.045, drum: 'tick' as const, vel: 0.6 + (i % 2) * 0.3 })), macros: mac(0.6, 0.4, 0.04, 0, 0.5), axis: AX.click }),
  preset({ id: 'knuckle-crack', name: 'Knuckle Crack', category: 'Foley & Physics', tag: 'Crack', description: 'A quick crack-crack-crack of knuckles before getting to work.', keywords: ['knuckle', 'crack', 'ready', 'work'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.2, sequence: [{ at: 0, drum: 'snap', vel: 0.8 }, { at: 0.07, drum: 'snap', vel: 0.6 }, { at: 0.15, drum: 'snap', vel: 0.9 }], macros: mac(0.35, 0.5, 0.04, 0, 0.5, { pitch: 0.3 }), axis: AX.click }),
];

const CLAPS: RecipeInput[] = [
  preset({ id: 'single-hand-clap', name: 'Single Hand Clap', category: 'Drums & Beats', tag: 'Clap', description: 'One clean hand clap for beats, cuts and emphasis.', keywords: ['clap', 'hand clap', 'single'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0, sequence: [{ at: 0, drum: 'clap' }], macros: mac(0.55, 0.5, 0.12, 0, 0.5), axis: AX.clap }),
  preset({ id: 'double-clap', name: 'Double Clap', category: 'Drums & Beats', tag: 'Clap Clap', description: 'Two quick claps — "let\'s go" energy for hooks and transitions.', keywords: ['clap', 'double', 'clap clap'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.2, sequence: [{ at: 0, drum: 'clap', pan: -0.2 }, { at: 0.15, drum: 'clap', pan: 0.2 }], macros: mac(0.55, 0.5, 0.12, 0, 0.5), axis: AX.clap }),
  preset({ id: 'stacked-clap-hit', name: 'Stacked Clap Hit', category: 'Drums & Beats', tag: 'Fat Clap', description: 'Four claps layered a few milliseconds apart into one huge, wide clap.', keywords: ['clap', 'stacked', 'layered', 'fat', 'edm'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.8, sequence: [0, 0.008, 0.015, 0.022].map((at, i) => ({ at, drum: 'clap' as const, vel: 0.85, pan: [-0.6, 0.6, -0.2, 0.2][i] })), macros: mac(0.6, 0.5, 0.3, 0.1, 0.5), axis: AX.clap }),
  preset({ id: 'slow-clap', name: 'Slow Clap', category: 'Viral & Memes', tag: 'Slow Clap', description: 'The sarcastic slow clap — for "well done" moments that weren\'t well done.', keywords: ['slow clap', 'sarcastic', 'well done', 'clap', 'meme'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0, sequence: [0, 0.95, 1.85, 2.6].map((at, i) => ({ at, drum: 'clap' as const, vel: 0.75 + i * 0.07 })), macros: mac(0.5, 0.5, 0.45, 0, 0.5), axis: AX.clap }),
  preset({ id: 'big-crowd-applause', name: 'Big Crowd Applause', category: 'Foley & Physics', tag: 'Ovation', description: 'A large audience bursting into applause — for endings, wins and standing ovations.', keywords: ['applause', 'crowd', 'ovation', 'audience', 'clapping'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 1, sequence: crowd('clap', 150, 4, 77), macros: mac(0.5, 0.5, 0.55, 0, 0.5), axis: AX.clap }),
  preset({ id: 'high-five-slap', name: 'High Five Slap', category: 'Foley & Physics', tag: 'High Five', description: 'A meaty palm-to-palm high five for teamwork and wins.', keywords: ['high five', 'slap', 'hands', 'teamwork'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0, sequence: [{ at: 0, drum: 'clap' }, { at: 0, drum: 'kick', vel: 0.3 }], macros: mac(0.45, 0.4, 0.1, 0, 0.5, { pitch: 0.4 }), axis: AX.clap }),
  preset({ id: 'comedy-face-slap', name: 'Comedy Face Slap', category: 'Viral & Memes', tag: 'Slap', description: 'An exaggerated cartoon slap for reaction edits and "snap out of it" moments.', keywords: ['slap', 'face slap', 'snap out of it', 'comedy'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.1, sequence: [{ at: 0, drum: 'clap' }, { at: 0, drum: 'snap', vel: 0.8 }, { at: 0.004, drum: 'kick', vel: 0.45 }], macros: mac(0.6, 0.5, 0.15, 0.2, 0.5, { pitch: 0.35 }), axis: AX.clap }),
  preset({ id: 'finger-snaps', name: 'Finger Snaps', category: 'Drums & Beats', tag: 'Snap', description: 'Two crisp finger snaps for transitions, outfit changes and "just like that".', keywords: ['snap', 'finger snap', 'transition', 'just like that'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.3, sequence: [{ at: 0, drum: 'snap', pan: -0.2 }, { at: 0.5, drum: 'snap', pan: 0.2 }], macros: mac(0.55, 0.5, 0.15, 0, 0.5), axis: AX.clap }),
];

const DRUM_HITS: RecipeInput[] = [
  preset({ id: 'snare-hit', name: 'Snare Hit', category: 'Drums & Beats', tag: 'Snare', description: 'A single punchy snare hit.', keywords: ['snare', 'drum', 'hit'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0, sequence: [{ at: 0, drum: 'snare' }], macros: mac(0.6, 0.5, 0.15, 0.05, 0.5), axis: AX.kit }),
  preset({ id: 'closed-hi-hat', name: 'Closed Hi-Hat', category: 'Drums & Beats', tag: 'Hi-Hat', description: 'A tight closed hi-hat tick.', keywords: ['hi hat', 'hat', 'cymbal', 'tick'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0, sequence: [{ at: 0, drum: 'hat' }], macros: mac(0.6, 0.5, 0.05, 0, 0.5), axis: AX.kit }),
  preset({ id: 'open-hi-hat', name: 'Open Hi-Hat', category: 'Drums & Beats', tag: 'Open Hat', description: 'A sizzling open hi-hat.', keywords: ['open hat', 'hi hat', 'cymbal'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0, sequence: [{ at: 0, drum: 'open-hat' }], macros: mac(0.6, 0.5, 0.08, 0, 0.5), axis: AX.kit }),
  preset({ id: 'crash-cymbal', name: 'Crash Cymbal', category: 'Drums & Beats', tag: 'Crash', description: 'A bright crash cymbal to open a section or land a hit.', keywords: ['crash', 'cymbal', 'hit', 'impact'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.3, sequence: [{ at: 0, drum: 'crash' }], macros: mac(0.6, 0.6, 0.2, 0, 0.5), axis: AX.kit }),
  preset({ id: 'cowbell-hit', name: 'Cowbell', category: 'Drums & Beats', tag: 'Cowbell', description: 'A classic drum-machine cowbell. More cowbell, as they say.', keywords: ['cowbell', 'bell', 'drum machine'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0, sequence: [{ at: 0, drum: 'cowbell' }], macros: mac(0.6, 0.5, 0.08, 0, 0.5), axis: AX.kit }),
  preset({ id: 'rimshot-click', name: 'Rimshot Click', category: 'Drums & Beats', tag: 'Rim', description: 'A dry rim click / sidestick.', keywords: ['rim', 'sidestick', 'click', 'drum'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0, sequence: [{ at: 0, drum: 'rim' }], macros: mac(0.6, 0.5, 0.1, 0, 0.5), axis: AX.kit }),
  preset({ id: 'tom-drop', name: 'Tom Drop', category: 'Drums & Beats', tag: 'Toms', description: 'High, mid and low toms tumbling down into a crash.', keywords: ['tom', 'fill', 'drop', 'drums'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.6, bpm: 120, sequence: beat(120, { t: 'Xx', m: '..Xx', l: '....Xx', k: '......X', x: '......X' }), macros: mac(0.55, 0.6, 0.25, 0, 0.5), axis: AX.kit }),
  preset({ id: 'shaker-loop', name: 'Shaker Loop', category: 'Drums & Beats', tag: 'Shaker', description: 'A steady accented shaker groove to lay under talking-head clips.', keywords: ['shaker', 'loop', 'percussion', 'groove'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.3, bpm: 100, sequence: beat(100, { z: 'Xxgx'.repeat(8) }), macros: mac(0.6, 0.5, 0.1, 0, 0.5), axis: AX.kit }),
];

const BEATS: RecipeInput[] = [
  preset({ id: 'boom-bap-beat', name: 'Boom Bap Beat', category: 'Drums & Beats', tag: 'Hip-Hop', description: 'A head-nodding 90 BPM boom-bap bar with a little swing.', keywords: ['boom bap', 'hip hop', 'beat', 'loop', 'drums'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.4, bpm: 90, sequence: beat(90, { k: 'X......x..X.....', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.' }, 0.12), macros: mac(0.5, 0.65, 0.12, 0.1, 0.5), axis: AX.kit }),
  preset({ id: 'trap-beat', name: 'Trap Beat', category: 'Drums & Beats', tag: 'Trap', description: 'A 140 BPM half-time trap bar with rolling hats and a boomy kick.', keywords: ['trap', 'beat', '808', 'hi hat roll', 'loop'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.4, bpm: 140, sequence: beat(140, { k: 'X......x.x......', c: '........X.......', h: 'xxxxxxxxxxgxgxxx', o: '..............x.' }), macros: mac(0.55, 0.9, 0.1, 0.15, 0.5), axis: AX.kit }),
  preset({ id: 'four-on-the-floor', name: 'Four on the Floor', category: 'Drums & Beats', tag: 'House', description: 'A 124 BPM house groove: kick on every beat, claps and offbeat open hats.', keywords: ['house', 'edm', 'four on the floor', 'dance', 'loop'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.4, bpm: 124, sequence: beat(124, { k: 'X...X...X...X...', c: '....X.......X...', o: '..x...x...x...x.', z: 'gxgxgxgxgxgxgxgx' }), macros: mac(0.6, 0.6, 0.12, 0.05, 0.5), axis: AX.kit }),
  preset({ id: 'rock-beat', name: 'Rock Beat', category: 'Drums & Beats', tag: 'Rock', description: 'A straight 110 BPM rock bar that opens on a crash.', keywords: ['rock', 'beat', 'drums', 'band', 'loop'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.4, bpm: 110, sequence: beat(110, { k: 'X.......X.x.....', s: '....X.......X...', h: '..x.x.x.x.x.x.x.', x: 'X' }), macros: mac(0.6, 0.6, 0.2, 0.15, 0.5), axis: AX.kit }),
  preset({ id: 'dembow-beat', name: 'Dembow Beat', category: 'Drums & Beats', tag: 'Reggaeton', description: 'The 96 BPM reggaeton dembow rhythm for dance and travel clips.', keywords: ['reggaeton', 'dembow', 'latin', 'dance', 'beat'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.4, bpm: 96, sequence: beat(96, { k: 'X...X...X...X...', r: '...x..x....x..x.', h: 'x.x.x.x.x.x.x.x.' }), macros: mac(0.55, 0.65, 0.1, 0.05, 0.5), axis: AX.kit }),
  preset({ id: 'lofi-chill-beat', name: 'Lo-fi Chill Beat', category: 'Drums & Beats', tag: 'Lo-fi', description: 'A lazy, swung 80 BPM lo-fi bar for study vlogs and cozy edits.', keywords: ['lofi', 'chill', 'study', 'beat', 'cozy'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.3, bpm: 80, sequence: beat(80, { k: 'X.....x...X.....', s: '....X.......X..g', h: 'x.xgx.x.x.xgx.x.' }, 0.2), macros: mac(0.25, 0.6, 0.25, 0.25, 0.5), axis: AX.kit }),
  preset({ id: 'afro-groove', name: 'Afro Groove', category: 'Drums & Beats', tag: 'Afrobeats', description: 'A bouncy 105 BPM afro-style groove with cowbell and shaker.', keywords: ['afrobeats', 'afro', 'groove', 'cowbell', 'dance'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.5, bpm: 105, sequence: beat(105, { k: 'X..x..X...X..x..', r: '....x..x....x...', b: 'x.xx.x.x.x..x.x.', z: 'xgxgxgxgxgxgxgxg' }), macros: mac(0.55, 0.6, 0.12, 0.05, 0.5), axis: AX.kit }),
  preset({ id: 'funk-groove', name: 'Funk Groove', category: 'Drums & Beats', tag: 'Funk', description: 'A tight 100 BPM funk bar with ghost notes and busy 16th hats.', keywords: ['funk', 'groove', 'ghost notes', 'beat'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.4, bpm: 100, sequence: beat(100, { k: 'X..x..x...X..x..', s: '....X..g.g..X..g', h: 'xgxgxgxgxgxgxgxg' }), macros: mac(0.6, 0.55, 0.12, 0.05, 0.5), axis: AX.kit }),
  preset({ id: 'disco-beat', name: 'Disco Beat', category: 'Drums & Beats', tag: 'Disco', description: 'A 118 BPM disco groove with offbeat open hats.', keywords: ['disco', 'dance', 'retro', 'beat', '70s'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.4, bpm: 118, sequence: beat(118, { k: 'X...X...X...X...', s: '....X.......X...', o: '..x...x...x...x.', h: 'x...x...x...x...' }), macros: mac(0.65, 0.55, 0.2, 0, 0.5), axis: AX.kit }),
  preset({ id: 'drum-and-bass', name: 'Drum & Bass Break', category: 'Drums & Beats', tag: 'DnB', description: 'A fast 172 BPM two-step break for action edits and sports montages.', keywords: ['drum and bass', 'dnb', 'fast', 'break', 'action'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.4, bpm: 172, sequence: beat(172, { k: 'X.........x.....X.........x.....', s: '....X.......X.......X.......X..g', h: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.' }), macros: mac(0.65, 0.55, 0.12, 0.1, 0.5), axis: AX.kit }),
  preset({ id: 'marching-snare', name: 'Marching Snare Cadence', category: 'Drums & Beats', tag: 'Marching', description: 'A crisp marching-band snare cadence for intros and countdowns.', keywords: ['marching', 'snare', 'cadence', 'band', 'parade'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.2, bpm: 112, sequence: beat(112, { s: 'X.xxX.x.X.xxX.x.', l: 'x.......x.......' }), macros: mac(0.7, 0.4, 0.2, 0, 0.5), axis: AX.kit }),
  preset({ id: 'stomp-stomp-clap', name: 'Stomp Stomp Clap', category: 'Drums & Beats', tag: 'Stomp Clap', description: 'The stadium "stomp, stomp, clap" rhythm for hype and sports edits.', keywords: ['stomp', 'clap', 'stadium', 'sports', 'hype'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.6, bpm: 80, sequence: [...beat(80, { k: 'X.X.....X.X.....', c: '....X.......X...' }), ...beat(80, { c: '....X.......X...' }).map((n) => ({ ...n, at: n.at + 0.01, pan: 0.5 }))], macros: mac(0.5, 0.75, 0.45, 0, 0.5), axis: AX.kit }),
  preset({ id: 'drum-fill', name: 'Drum Fill', category: 'Drums & Beats', tag: 'Fill', description: 'A one-bar tom and snare fill that crashes into the next section.', keywords: ['drum fill', 'fill', 'toms', 'transition'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.6, bpm: 120, sequence: beat(120, { s: 'XxXx', t: '....XxXx', m: '........Xx', l: '..........XxXx', k: '................X', x: '................X' }), macros: mac(0.6, 0.6, 0.25, 0.05, 0.5), axis: AX.kit }),
  preset({ id: 'edm-snare-build', name: 'EDM Snare Build-Up', category: 'Drums & Beats', tag: 'Build-Up', description: 'A snare roll that speeds up from quarters to sixteenths and lands on a crash.', keywords: ['build up', 'snare roll', 'edm', 'drop', 'riser'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.3, bpm: 128, sequence: snareBuild(128), macros: mac(0.65, 0.5, 0.3, 0.1, 0.5), axis: AX.kit }),
  preset({ id: 'snap-beat', name: 'Finger Snap Beat', category: 'Drums & Beats', tag: 'Snap Beat', description: 'A minimal snap-and-kick groove for fashion, beauty and get-ready-with-me clips.', keywords: ['snap', 'beat', 'minimal', 'grwm', 'fashion'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.3, bpm: 96, sequence: beat(96, { k: 'X.......X.x.....', n: '....X.......X...', z: 'x.x.x.x.x.x.x.x.' }), macros: mac(0.55, 0.6, 0.2, 0, 0.5), axis: AX.kit }),
  preset({ id: 'latin-cowbell-groove', name: 'Latin Cowbell Groove', category: 'Drums & Beats', tag: 'Latin', description: 'A lively cowbell, rim and kick groove for summer and travel clips.', keywords: ['latin', 'cowbell', 'salsa', 'summer', 'travel'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.5, bpm: 110, sequence: beat(110, { b: 'X.xx.x.xX.xx.x.x', r: '..x...x...x..x..', k: 'X.....x.X.....x.', z: 'gxgxgxgxgxgxgxgx' }), macros: mac(0.6, 0.5, 0.15, 0, 0.5), axis: AX.kit }),
];

const CARTOON: RecipeInput[] = [
  preset({ id: 'cartoon-tiptoe', name: 'Cartoon Tiptoe', category: 'Cartoon & Melodies', tag: 'Sneaking', description: 'Plucky pizzicato steps creeping up and back down — the classic sneaking-around cue.', keywords: ['tiptoe', 'sneaky', 'pizzicato', 'sneaking', 'cartoon'], topology: TOPOLOGY.pluck, baseFreq: 196, wave: 'triangle', noise: 0.15, spread: 0.3, sequence: melody([0, 2, 3, 5, 7, 5, 3, 2], 0.3), macros: mac(0.4, 0.5, 0.12, 0, 0.1), axis: AX.melody }),
  preset({ id: 'sneaky-pizzicato', name: 'Sneaky Pizzicato', category: 'Cartoon & Melodies', tag: 'Mischief', description: 'A minor, mischievous pizzicato line for pranks and plotting.', keywords: ['sneaky', 'pizzicato', 'mischief', 'prank', 'plotting'], topology: TOPOLOGY.pluck, baseFreq: 220, wave: 'triangle', noise: 0.15, spread: 0.3, sequence: melody([0, 3, 7, 3, 0, null, -2, 0], 0.32), macros: mac(0.4, 0.5, 0.15, 0, 0.12), axis: AX.melody }),
  preset({ id: 'xylophone-run-up', name: 'Xylophone Run Up', category: 'Cartoon & Melodies', tag: 'Gliss Up', description: 'A quick climbing xylophone run for "ta-da", ideas and cheerful reveals.', keywords: ['xylophone', 'run', 'glissando', 'cheerful', 'ta da'], topology: TOPOLOGY.bell, baseFreq: 523.25, ratios: [1, 3.0, 6.0], fm: 0, noise: 0.2, spread: 0.4, sequence: melody([0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24], 0.05), macros: mac(0.7, 0.3, 0.2, 0, 0.15), axis: AX.melody }),
  preset({ id: 'xylophone-run-down', name: 'Xylophone Run Down', category: 'Cartoon & Melodies', tag: 'Gliss Down', description: 'A tumbling xylophone run downward for falls, oops and slides.', keywords: ['xylophone', 'run down', 'fall', 'oops', 'glissando'], topology: TOPOLOGY.bell, baseFreq: 523.25, ratios: [1, 3.0, 6.0], fm: 0, noise: 0.2, spread: 0.4, sequence: melody([24, 21, 19, 16, 14, 12, 9, 7, 4, 2, 0], 0.05), macros: mac(0.7, 0.3, 0.2, 0, 0.15), axis: AX.melody }),
  preset({ id: 'quick-slip-whistle', name: 'Quick Slip Whistle', category: 'Cartoon & Melodies', tag: 'Slip', description: 'A lightning-fast slide whistle up — the banana-peel slip.', keywords: ['slip', 'banana', 'slide whistle', 'cartoon', 'fall'], topology: TOPOLOGY.rise, baseFreq: 520, ratios: [1], fm: 1.8, noise: 0.03, spread: 0.1, wave: 'sine', macros: mac(0.2, 0.1, 0.1, 0, 0.02, { modDepth: 0.2, modRate: 0.75 }), mod: { shape: 'sine', target: 'pitch' }, axis: AX.cartoon }),
  preset({ id: 'zip-away', name: 'Zip Away', category: 'Cartoon & Melodies', tag: 'Zip', description: 'A cartoon character zipping off-screen in a blink.', keywords: ['zip', 'zoom', 'run away', 'fast', 'cartoon'], topology: TOPOLOGY.rise, baseFreq: 300, ratios: [1, 1.5], fm: 2.5, noise: 0.4, spread: 0.6, wave: 'sine', macros: mac(0.6, 0.15, 0.12, 0, 0.0), axis: AX.cartoon }),
  preset({ id: 'falling-whistle', name: 'Cartoon Falling Whistle', category: 'Cartoon & Melodies', tag: 'Falling', description: 'The long descending whistle of something falling from a great height.', keywords: ['falling', 'whistle', 'drop', 'bomb', 'cartoon'], topology: TOPOLOGY.drop, baseFreq: 300, ratios: [1], fm: 2, noise: 0.05, spread: 0.1, wave: 'sine', macros: mac(0.2, 0.1, 0.15, 0, 0.7, { modDepth: 0.12, modRate: 0.72 }), mod: { shape: 'sine', target: 'pitch' }, axis: AX.cartoon }),
  preset({ id: 'toy-squeak', name: 'Toy Squeak', category: 'Cartoon & Melodies', tag: 'Squeak', description: 'A rubber-duck squeeze-squeak for pets, babies and cute moments.', keywords: ['squeak', 'rubber duck', 'toy', 'cute', 'dog toy'], topology: TOPOLOGY.beep, baseFreq: 1200, wave: 'sine', noise: 0.2, spread: 0.1, sequence: [{ at: 0, len: 0.12, bend: 5 }, { at: 0.18, len: 0.15, semi: 3, bend: 4 }], macros: mac(0.6, 0.5, 0.08, 0.05, 0.5), axis: AX.cartoon }),
  preset({ id: 'cuckoo-clock', name: 'Cuckoo Clock', category: 'Cartoon & Melodies', tag: 'Cuckoo', description: 'A two-note cuckoo call for "it\'s that time" and crazy moments.', keywords: ['cuckoo', 'clock', 'crazy', 'time', 'bird'], topology: TOPOLOGY.beep, baseFreq: 784, wave: 'sine', noise: 0.15, spread: 0.1, sequence: [{ at: 0, len: 0.18, semi: 4 }, { at: 0.26, len: 0.3, semi: 0 }, { at: 0.75, len: 0.18, semi: 4 }, { at: 1.01, len: 0.3, semi: 0 }], macros: mac(0.4, 0.5, 0.2, 0, 0.5), axis: AX.cartoon }),
  preset({ id: 'kazoo-ta-da', name: 'Kazoo Ta-Da', category: 'Cartoon & Melodies', tag: 'Ta-Da', description: 'A buzzy kazoo "ta-daaa" for silly reveals and proud moments.', keywords: ['kazoo', 'ta da', 'silly', 'reveal', 'proud'], topology: TOPOLOGY.brass, baseFreq: 392, ratios: [1, 1.004], noise: 0.2, spread: 0.1, wave: 'sawtooth', sequence: [{ at: 0, len: 0.14 }, { at: 0.2, len: 0.75, semi: 7 }], macros: mac(0.9, 0.3, 0.12, 0.35, 0.5, { modDepth: 0.15, modRate: 0.74 }), mod: { shape: 'sine', target: 'pitch' }, axis: AX.cartoon }),
  preset({ id: 'cartoon-wobble', name: 'Cartoon Wobble', category: 'Cartoon & Melodies', tag: 'Wobble', description: 'A jelly-like wobble for dizzy, jiggly and wobbly moments.', keywords: ['wobble', 'jelly', 'dizzy', 'jiggle'], topology: TOPOLOGY.boing, baseFreq: 260, ratios: [1, 2], fm: 0, noise: 0.03, spread: 0.2, wave: 'sine', macros: mac(0.25, 1, 0.1, 0, 0.75), axis: AX.cartoon }),
  preset({ id: 'pop-up-spring', name: 'Pop-Up Spring', category: 'Cartoon & Melodies', tag: 'Jack-in-the-Box', description: 'A springy pop-up like a jack-in-the-box jumping out.', keywords: ['spring', 'jack in the box', 'pop up', 'surprise'], topology: TOPOLOGY.boing, baseFreq: 180, ratios: [1, 2], fm: 2, noise: 0.15, spread: 0.1, wave: 'triangle', macros: mac(0.7, 0.6, 0.08, 0, 0.3), axis: AX.cartoon }),
  preset({ id: 'eye-blink-ting', name: 'Eye Blink Ting', category: 'Cartoon & Melodies', tag: 'Blink', description: 'A tiny high "ting" for blinks, sparkles in the eye and cute glances.', keywords: ['blink', 'ting', 'sparkle', 'wink', 'cute'], topology: TOPOLOGY.bell, baseFreq: 3136, ratios: [1, 2.76], fm: 0, noise: 0.05, spread: 0.2, macros: mac(0.7, 0.2, 0.15, 0, 0.05), axis: AX.cartoon }),
  preset({ id: 'lightbulb-idea', name: 'Lightbulb Idea Ding', category: 'Cartoon & Melodies', tag: 'Idea', description: 'A bright upward "ding!" for the moment someone gets an idea.', keywords: ['idea', 'lightbulb', 'ding', 'eureka', 'aha'], topology: TOPOLOGY.bell, baseFreq: 1568, ratios: [1, 2, 3.01], fm: 2, noise: 0.08, spread: 0.3, sequence: [{ at: 0, semi: 0 }, { at: 0.06, semi: 12 }], macros: mac(0.75, 0.35, 0.25, 0, 0.35), axis: AX.cartoon }),
  preset({ id: 'cartoon-running-feet', name: 'Cartoon Running Feet', category: 'Cartoon & Melodies', tag: 'Leg Spin', description: 'Legs spinning in place before a cartoon dash — a fast "brrrrr" of tom taps.', keywords: ['running', 'legs', 'dash', 'cartoon', 'spin'], topology: TOPOLOGY.drum, baseFreq: 100, noise: 0, spread: 0.3, sequence: Array.from({ length: 18 }, (_, i) => ({ at: i * 0.045, drum: (i % 2 ? 'tom-hi' : 'tom-mid') as DrumVoice, vel: 0.5 + (i / 18) * 0.5, pan: i % 2 ? 0.2 : -0.2 })), macros: mac(0.6, 0.3, 0.06, 0, 0.5, { pitch: 0.75 }), axis: AX.cartoon }),
  preset({ id: 'magic-poof', name: 'Magic Poof', category: 'Cartoon & Melodies', tag: 'Poof', description: 'A soft airy "poof" for things vanishing in a cloud of smoke.', keywords: ['poof', 'disappear', 'smoke', 'magic', 'vanish'], topology: TOPOLOGY.whoosh, baseFreq: 400, noise: 0.95, spread: 0.6, macros: mac(0.6, 0.3, 0.4, 0, 0.03), axis: AX.cartoon }),
  preset({ id: 'bubble-bounce', name: 'Bubble Bounce', category: 'Cartoon & Melodies', tag: 'Bounce', description: 'A light bubbly bounce that settles quickly — for cute hops and bouncy text.', keywords: ['bounce', 'bubble', 'hop', 'cute'], topology: TOPOLOGY.modal, baseFreq: 700, ratios: [1, 1.6, 2.3], noise: 0.05, spread: 0.3, sequence: bounce(5, 0.22, 0.7), macros: mac(0.35, 0.2, 0.1, 0, 0.1), axis: AX.cartoon }),
  preset({ id: 'confused-huh-boing', name: 'Confused Huh Boing', category: 'Viral & Memes', tag: 'Huh?', description: 'A short questioning boing for confused looks and "wait, what?" moments.', keywords: ['huh', 'confused', 'what', 'question', 'boing'], topology: TOPOLOGY.boing, baseFreq: 260, ratios: [1, 2], fm: 0.6, noise: 0.05, spread: 0.1, wave: 'sine', macros: mac(0.55, 0.5, 0.08, 0, 0.18), axis: AX.cartoon }),
];

const MELODIES: RecipeInput[] = [
  preset({ id: 'ukulele-happy-strum', name: 'Ukulele Happy Strum', category: 'Cartoon & Melodies', tag: 'Ukulele', description: 'A sunny I–IV–V–I ukulele strum for vlogs, recipes and feel-good intros.', keywords: ['ukulele', 'happy', 'strum', 'vlog', 'feel good'], topology: TOPOLOGY.pluck, baseFreq: 261.63, wave: 'sawtooth', noise: 0.25, spread: 0.5, sequence: strum([[0, 4, 7, 12], [5, 9, 12, 17], [7, 11, 14, 19], [0, 4, 7, 12]], 0.6), macros: mac(0.45, 0.5, 0.2, 0, 0.4), axis: AX.melody }),
  preset({ id: 'kalimba-lullaby', name: 'Kalimba Lullaby', category: 'Cartoon & Melodies', tag: 'Kalimba', description: 'A gentle kalimba lullaby for calm, cozy and bedtime content.', keywords: ['kalimba', 'lullaby', 'calm', 'cozy', 'bedtime'], topology: TOPOLOGY.pluck, baseFreq: 392, ratios: [1, 5.4], wave: 'triangle', noise: 0.1, spread: 0.4, sequence: melody([0, 4, 7, 9, 7, 4, 2, 0], 0.32), macros: mac(0.35, 0.4, 0.35, 0, 0.5), axis: AX.melody }),
  preset({ id: 'marimba-morning', name: 'Marimba Morning', category: 'Cartoon & Melodies', tag: 'Marimba', description: 'A bright, bouncy marimba line for morning routines and upbeat intros.', keywords: ['marimba', 'morning', 'routine', 'upbeat', 'alarm'], topology: TOPOLOGY.pluck, baseFreq: 523.25, ratios: [1, 3.99], wave: 'triangle', noise: 0.1, spread: 0.4, sequence: melody([0, 7, 4, 9, 7, 12], 0.22), macros: mac(0.45, 0.4, 0.2, 0, 0.3), axis: AX.melody }),
  preset({ id: 'harp-glissando', name: 'Harp Glissando', category: 'Cartoon & Melodies', tag: 'Dreamy', description: 'A shimmering harp sweep for dream sequences, flashbacks and magic.', keywords: ['harp', 'glissando', 'dream', 'flashback', 'magic'], topology: TOPOLOGY.pluck, baseFreq: 261.63, wave: 'triangle', noise: 0.08, spread: 0.6, sequence: melody([0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24], 0.045), macros: mac(0.5, 0.4, 0.5, 0, 0.7), axis: AX.melody }),
  preset({ id: 'music-box-lullaby', name: 'Music Box Lullaby', category: 'Cartoon & Melodies', tag: 'Music Box', description: 'A slow, tender music-box tune for baby, family and nostalgic moments.', keywords: ['music box', 'lullaby', 'baby', 'nostalgic', 'family'], topology: TOPOLOGY.bell, baseFreq: 1046.5, ratios: [1, 3.01, 6.27], fm: 0, noise: 0.06, spread: 0.3, sequence: melody([0, 4, 7, 12, 7, 4, 9, 7], 0.38), macros: mac(0.6, 0.25, 0.3, 0, 0.35), axis: AX.melody }),
  preset({ id: 'lofi-chime-loop', name: 'Lo-fi Chime Loop', category: 'Cartoon & Melodies', tag: 'Lo-fi', description: 'A soft, dreamy chime phrase that loops nicely under talking clips.', keywords: ['lofi', 'chime', 'loop', 'chill', 'study'], topology: TOPOLOGY.bell, baseFreq: 659.25, ratios: [1, 2, 3.01], fm: 0, noise: 0.03, spread: 0.5, sequence: melody([0, 7, 11, 7, 4, 9, 12, 9], 0.45), macros: mac(0.35, 0.35, 0.5, 0.15, 0.3), axis: AX.melody }),
  preset({ id: 'level-complete-jingle', name: 'Level Complete Jingle', category: 'Cartoon & Melodies', tag: 'Chiptune', description: 'A triumphant chiptune phrase for wins, finished tasks and "done!" moments.', keywords: ['level complete', 'chiptune', 'win', 'game', 'retro'], topology: TOPOLOGY.beep, baseFreq: 523.25, wave: 'square', noise: 0, spread: 0, sequence: [...melody([0, 4, 7, 12, 7], 0.11, 0.1), { at: 0.6, len: 0.6, semi: 12 }], macros: mac(0.45, 0.5, 0.15, 0, 0.5), axis: AX.melody }),
  preset({ id: 'brand-intro-jingle', name: 'Bright Intro Jingle', category: 'Cartoon & Melodies', tag: 'Intro', description: 'A short, optimistic five-note rise for channel intros and logo reveals.', keywords: ['intro', 'jingle', 'logo', 'channel', 'brand'], topology: TOPOLOGY.pluck, baseFreq: 392, ratios: [1, 3.99], wave: 'triangle', noise: 0.1, spread: 0.5, sequence: melody([0, 4, 7, 11, 12], 0.14), macros: mac(0.55, 0.45, 0.35, 0, 0.55), axis: AX.melody }),
  preset({ id: 'cute-notification-melody', name: 'Cute Notification Melody', category: 'Cartoon & Melodies', tag: 'Cute', description: 'A three-note kalimba chirp for cute notifications and DMs.', keywords: ['cute', 'notification', 'kalimba', 'dm', 'message'], topology: TOPOLOGY.pluck, baseFreq: 784, ratios: [1, 5.4], wave: 'triangle', noise: 0.08, spread: 0.3, sequence: melody([0, 4, 9], 0.09), macros: mac(0.45, 0.35, 0.2, 0, 0.25), axis: AX.melody }),
  preset({ id: 'mystery-detective', name: 'Mystery Detective', category: 'Cartoon & Melodies', tag: 'Mystery', description: 'A creeping chromatic pizzicato line for investigations and "who did it?".', keywords: ['mystery', 'detective', 'investigation', 'suspicious', 'pizzicato'], topology: TOPOLOGY.pluck, baseFreq: 146.83, wave: 'triangle', noise: 0.15, spread: 0.3, sequence: melody([0, 1, 0, 1, 3, 2, 1, -1], 0.34), macros: mac(0.35, 0.6, 0.25, 0, 0.15), axis: AX.melody }),
  preset({ id: 'happy-whistle-tune', name: 'Happy Whistle Tune', category: 'Cartoon & Melodies', tag: 'Whistle', description: 'A carefree whistled tune for walks, good moods and sunny days.', keywords: ['whistle', 'happy', 'carefree', 'walk', 'sunny'], topology: TOPOLOGY.beep, baseFreq: 1046.5, wave: 'sine', noise: 0.12, spread: 0.1, sequence: melody([0, 2, 4, 7, 4, 2, 4, 0], 0.2, 0.18), macros: mac(0.4, 0.5, 0.2, 0, 0.5, { modDepth: 0.12, modRate: 0.72 }), mod: { shape: 'sine', target: 'pitch' }, axis: AX.melody }),
  preset({ id: 'sad-moment-keys', name: 'Sad Moment Keys', category: 'Cartoon & Melodies', tag: 'Sad', description: 'A slow falling electric-piano phrase for emotional and "it\'s over" moments.', keywords: ['sad', 'emotional', 'piano', 'keys', 'crying'], topology: TOPOLOGY.bell, baseFreq: 440, ratios: [1, 2, 3.01], fm: 1, noise: 0.04, spread: 0.4, sequence: melody([7, 5, 4, 2, 0], 0.55), macros: mac(0.3, 0.6, 0.45, 0, 0.45), axis: AX.melody }),
  preset({ id: 'victory-harp-arpeggio', name: 'Victory Harp Arpeggio', category: 'Cartoon & Melodies', tag: 'Victory', description: 'A rising harp arpeggio for achievements, unlocks and happy endings.', keywords: ['victory', 'harp', 'arpeggio', 'achievement', 'happy ending'], topology: TOPOLOGY.pluck, baseFreq: 261.63, wave: 'triangle', noise: 0.08, spread: 0.6, sequence: melody([0, 4, 7, 12, 16, 19, 24], 0.08), macros: mac(0.55, 0.45, 0.4, 0, 0.6), axis: AX.melody }),
  preset({ id: 'chill-guitar-pluck', name: 'Chill Guitar Pluck', category: 'Cartoon & Melodies', tag: 'Guitar', description: 'A relaxed four-note guitar pluck for travel, coffee and slow-living clips.', keywords: ['guitar', 'chill', 'acoustic', 'travel', 'coffee'], topology: TOPOLOGY.pluck, baseFreq: 196, wave: 'sawtooth', noise: 0.2, spread: 0.4, sequence: melody([0, 7, 12, 7, 4, 7, 12, 16], 0.3), macros: mac(0.3, 0.55, 0.25, 0, 0.5), axis: AX.melody }),
  preset({ id: 'steel-drum-island', name: 'Steel Drum Island', category: 'Cartoon & Melodies', tag: 'Island', description: 'A breezy steel-drum phrase for beach, summer and vacation vibes.', keywords: ['steel drum', 'island', 'beach', 'summer', 'vacation'], topology: TOPOLOGY.bell, baseFreq: 523.25, ratios: [1, 2, 3.0], fm: 1.5, noise: 0.08, spread: 0.4, sequence: melody([0, 4, 7, 4, 9, 7], 0.2), macros: mac(0.6, 0.35, 0.3, 0, 0.3), axis: AX.melody }),
];

const MORE_VIRAL: RecipeInput[] = [
  preset({ id: 'anime-wow-sparkle', name: 'Anime Wow Sparkle', category: 'Viral & Memes', tag: 'Anime', description: 'A rapid glittering upward sweep for anime-style "sugoi" reveals and glow-ups.', keywords: ['anime', 'wow', 'sparkle', 'glow up', 'kawaii'], topology: TOPOLOGY.bell, baseFreq: 1568, ratios: [1, 2.76], fm: 0, noise: 0.05, spread: 0.8, sequence: melody([0, 2, 4, 7, 9, 12, 14, 16], 0.03), macros: mac(0.8, 0.2, 0.45, 0, 0.25), axis: AX.cartoon }),
  preset({ id: 'zoom-in-impact', name: 'Zoom-In Impact', category: 'Viral & Memes', tag: 'Zoom', description: 'A dramatic boom for the punch-in zoom on someone\'s face.', keywords: ['zoom', 'zoom in', 'dramatic', 'boom', 'reaction'], topology: TOPOLOGY.boom, baseFreq: 50, noise: 0.6, spread: 0.4, macros: mac(0.7, 0.85, 0.5, 0.45, 0.4), axis: axes('Soft', 'Hard', 'Small', 'Huge') }),
  preset({ id: 'horror-strings-stab', name: 'Horror Strings Stab', category: 'Viral & Memes', tag: 'Horror', description: 'Shrieking high string stabs for jump scares and creepy reveals.', keywords: ['horror', 'scary', 'stab', 'strings', 'jump scare'], topology: TOPOLOGY.brass, baseFreq: 1046.5, ratios: [1, 1.06], noise: 0.15, spread: 0.4, wave: 'sawtooth', sequence: [0, 0.18, 0.36, 0.54].map((at) => ({ at, len: 0.12 })), macros: mac(0.9, 0.3, 0.35, 0.2, 0.5), axis: axes('Muted', 'Shrieking', 'Thin', 'Full') }),
  preset({ id: 'mission-failed-sting', name: 'Mission Failed Sting', category: 'Viral & Memes', tag: 'Mission Failed', description: 'A dark, falling brass sting for failed attempts and game-over edits.', keywords: ['mission failed', 'fail', 'game over', 'sad', 'sting'], topology: TOPOLOGY.brass, baseFreq: 220, ratios: [1, 1.189, 1.498], noise: 0.05, spread: 0.4, wave: 'sawtooth', sequence: [{ at: 0, len: 0.3, semi: 0 }, { at: 0.35, len: 0.3, semi: -2 }, { at: 0.7, len: 1.4, semi: -5 }], macros: mac(0.45, 0.7, 0.4, 0.15, 0.5), axis: axes('Dark', 'Bright', 'Small', 'Huge') }),
  preset({ id: 'deep-bong-chime', name: 'Deep Bong Chime', category: 'Viral & Memes', tag: 'Bong', description: 'A deep, round "bong" for punchlines, logos and "and that\'s the tea".', keywords: ['bong', 'chime', 'punchline', 'deep', 'gong'], topology: TOPOLOGY.bell, baseFreq: 98, ratios: [1, 2, 2.7], fm: 1, noise: 0.1, spread: 0.3, macros: mac(0.45, 0.85, 0.35, 0.05, 0.6), axis: axes('Dark', 'Bright', 'Short', 'Huge') }),
  preset({ id: 'yeet-throw-whoosh', name: 'Yeet Throw Whoosh', category: 'Viral & Memes', tag: 'Yeet', description: 'A super fast throw whoosh for yeeting things out of frame.', keywords: ['yeet', 'throw', 'whoosh', 'fast', 'toss'], topology: TOPOLOGY.whoosh, baseFreq: 320, noise: 0.95, spread: 0.9, macros: mac(0.85, 0.35, 0.1, 0.05, 0), axis: axes('Soft Air', 'Sharp Air', 'Light', 'Heavy') }),
  preset({ id: 'jackpot-win-bells', name: 'Jackpot Win Bells', category: 'Viral & Memes', tag: 'Jackpot', description: 'A rapid shower of bright bells for jackpots, giveaways and big wins.', keywords: ['jackpot', 'win', 'casino', 'giveaway', 'bells'], topology: TOPOLOGY.bell, baseFreq: 1318.5, ratios: [1, 2.02, 2.76], fm: 1.41, noise: 0.15, spread: 0.9, sequence: Array.from({ length: 14 }, (_, i) => ({ at: i * 0.07, semi: [0, 4, 7, 12][i % 4], vel: 0.7 + (i % 2) * 0.3, pan: i % 2 ? 0.5 : -0.5 })), macros: mac(0.75, 0.35, 0.3, 0, 0.35), axis: axes('Soft', 'Brilliant', 'Short', 'Ringing') }),
  preset({ id: 'siren-whoop', name: 'Siren Whoop', category: 'Viral & Memes', tag: 'Siren', description: 'A rising-falling siren whoop for "alert", chaos and police-chase jokes.', keywords: ['siren', 'police', 'alert', 'whoop', 'alarm'], topology: TOPOLOGY.beep, baseFreq: 600, wave: 'triangle', noise: 0, spread: 0.2, sequence: [{ at: 0, len: 0.45, bend: 7 }, { at: 0.45, len: 0.45, semi: 7, bend: -7 }, { at: 0.9, len: 0.45, bend: 7 }, { at: 1.35, len: 0.45, semi: 7, bend: -7 }], macros: mac(0.55, 0.5, 0.15, 0.1, 0.5), axis: axes('Soft', 'Piercing', 'Light', 'Full') }),
  preset({ id: 'bike-horn-honk', name: 'Bike Horn Honk Honk', category: 'Viral & Memes', tag: 'Honk', description: 'A squeezy clown/bike horn "honk honk" for silly moments.', keywords: ['honk', 'clown horn', 'bike horn', 'silly', 'goose'], topology: TOPOLOGY.brass, baseFreq: 330, ratios: [1, 1.012], noise: 0.25, spread: 0.1, wave: 'sawtooth', sequence: [{ at: 0, len: 0.15 }, { at: 0.25, len: 0.18 }], macros: mac(0.7, 0.4, 0.06, 0.35, 0.5), axis: AX.cartoon }),
  preset({ id: 'car-horn-beep', name: 'Car Horn Beep', category: 'Viral & Memes', tag: 'Car Horn', description: 'A two-tone car horn "beep beeep" for road-rage jokes and arrivals.', keywords: ['car horn', 'beep', 'traffic', 'road', 'honk'], topology: TOPOLOGY.brass, baseFreq: 415, ratios: [1, 1.26], noise: 0.05, spread: 0.2, wave: 'sawtooth', sequence: [{ at: 0, len: 0.2 }, { at: 0.3, len: 0.55 }], macros: mac(0.55, 0.5, 0.08, 0.3, 0.5), axis: axes('Muffled', 'Blaring', 'Small Car', 'Truck') }),
  preset({ id: 'dj-rewind', name: 'DJ Rewind', category: 'Viral & Memes', tag: 'Rewind', description: 'A DJ spinning the record back for a "run that back" replay.', keywords: ['dj rewind', 'run it back', 'replay', 'scratch', 'pull up'], topology: TOPOLOGY.scratch, baseFreq: 260, ratios: [1, 1.5, 2], noise: 0.55, spread: 0.3, strikes: 6, macros: mac(0.75, 0.5, 0.1, 0.15, 0.15), axis: axes('Slow Spin', 'Fast Spin', 'Thin', 'Fat') }),
  preset({ id: 'bass-drop-meme', name: 'Bass Drop Meme', category: 'Viral & Memes', tag: 'Drop', description: 'A heavy distorted sub dive for "wait for it…" drops.', keywords: ['bass drop', 'drop', 'wait for it', 'meme', 'bass'], topology: TOPOLOGY.drop, baseFreq: 55, ratios: [1], fm: 2, noise: 0.05, spread: 0.1, wave: 'sine', macros: mac(0.4, 1, 0.1, 0.65, 0.3), axis: axes('Clean', 'Distorted', 'Thin', 'Huge') }),
];

// Single-note instruments for the piano roll. All are rooted on A so several tracks stay in key.
const INSTRUMENTS: RecipeInput[] = [
  preset({ id: 'kalimba-note', name: 'Kalimba', category: 'Instruments', tag: 'Plucked tine', description: 'A soft kalimba note — sweet and cozy for melodies and chords.', keywords: ['kalimba', 'note', 'melody', 'instrument', 'thumb piano'], topology: TOPOLOGY.pluck, baseFreq: 440, ratios: [1, 5.4], wave: 'triangle', noise: 0.1, spread: 0.3, macros: mac(0.4, 0.4, 0.25, 0, 0.45), axis: AX.melody }),
  preset({ id: 'marimba-note', name: 'Marimba', category: 'Instruments', tag: 'Wooden bar', description: 'A round marimba note for bouncy, friendly melodies.', keywords: ['marimba', 'note', 'melody', 'instrument', 'mallet'], topology: TOPOLOGY.pluck, baseFreq: 440, ratios: [1, 3.99], wave: 'triangle', noise: 0.12, spread: 0.3, macros: mac(0.45, 0.45, 0.15, 0, 0.3), axis: AX.melody }),
  preset({ id: 'ukulele-note', name: 'Ukulele', category: 'Instruments', tag: 'Nylon string', description: 'A bright ukulele pluck — stack three notes for a happy chord.', keywords: ['ukulele', 'note', 'string', 'instrument', 'happy'], topology: TOPOLOGY.pluck, baseFreq: 440, wave: 'sawtooth', noise: 0.25, spread: 0.3, macros: mac(0.45, 0.5, 0.15, 0, 0.4), axis: AX.melody }),
  preset({ id: 'harp-note', name: 'Harp', category: 'Instruments', tag: 'Concert harp', description: 'A ringing harp string for dreamy arpeggios.', keywords: ['harp', 'note', 'dreamy', 'instrument', 'arpeggio'], topology: TOPOLOGY.pluck, baseFreq: 220, wave: 'triangle', noise: 0.06, spread: 0.4, macros: mac(0.5, 0.45, 0.35, 0, 0.7), axis: AX.melody }),
  preset({ id: 'pizzicato-note', name: 'Pizzicato Strings', category: 'Instruments', tag: 'Plucked strings', description: 'A short plucked-strings note for playful, sneaky lines.', keywords: ['pizzicato', 'strings', 'note', 'sneaky', 'instrument'], topology: TOPOLOGY.pluck, baseFreq: 220, wave: 'triangle', noise: 0.18, spread: 0.3, macros: mac(0.35, 0.55, 0.2, 0, 0.12), axis: AX.melody }),
  preset({ id: 'electric-piano-note', name: 'Electric Piano', category: 'Instruments', tag: 'Keys', description: 'A mellow electric-piano note for lo-fi chords and soft intros.', keywords: ['piano', 'electric piano', 'keys', 'rhodes', 'chords'], topology: TOPOLOGY.bell, baseFreq: 440, ratios: [1, 2, 3.01], fm: 1, noise: 0.04, spread: 0.3, macros: mac(0.4, 0.55, 0.25, 0, 0.4), axis: AX.melody }),
  preset({ id: 'music-box-note', name: 'Music Box', category: 'Instruments', tag: 'Steel comb', description: 'A tiny music-box tine for lullabies and nostalgic tunes.', keywords: ['music box', 'note', 'lullaby', 'instrument', 'cute'], topology: TOPOLOGY.bell, baseFreq: 880, ratios: [1, 3.01, 6.27], fm: 0, noise: 0.06, spread: 0.3, macros: mac(0.65, 0.25, 0.25, 0, 0.3), axis: AX.melody }),
  preset({ id: 'glass-bell-note', name: 'Glass Bell', category: 'Instruments', tag: 'Bell', description: 'A clear glassy bell note that sparkles on top of a beat.', keywords: ['bell', 'glass', 'note', 'sparkle', 'instrument'], topology: TOPOLOGY.bell, baseFreq: 880, ratios: [1, 2.32, 4.25], fm: 2, noise: 0.08, spread: 0.3, macros: mac(0.65, 0.3, 0.3, 0, 0.45), axis: AX.melody }),
  preset({ id: 'soft-synth-lead', name: 'Soft Synth Lead', category: 'Instruments', tag: 'Lead', description: 'A gentle triangle lead with a touch of vibrato for hooks and melodies.', keywords: ['synth', 'lead', 'melody', 'hook', 'instrument'], topology: TOPOLOGY.beep, baseFreq: 440, wave: 'triangle', noise: 0.05, spread: 0.2, sequence: [{ at: 0, len: 0.45 }], macros: mac(0.45, 0.5, 0.2, 0, 0.5, { modDepth: 0.12, modRate: 0.72 }), mod: { shape: 'sine', target: 'pitch' }, axis: AX.melody }),
  preset({ id: 'retro-square-lead', name: 'Retro Square Lead', category: 'Instruments', tag: 'Chiptune', description: 'A chiptune square lead for game-style melodies.', keywords: ['chiptune', 'square', 'lead', '8 bit', 'retro'], topology: TOPOLOGY.beep, baseFreq: 440, wave: 'square', noise: 0, spread: 0, sequence: [{ at: 0, len: 0.3 }], macros: mac(0.4, 0.5, 0.1, 0, 0.5), axis: AX.melody }),
  preset({ id: 'brass-stab-note', name: 'Brass Stab', category: 'Instruments', tag: 'Brass', description: 'A punchy brass hit for big chords and fanfares.', keywords: ['brass', 'stab', 'horn', 'chord', 'instrument'], topology: TOPOLOGY.brass, baseFreq: 220, ratios: [1, 1.006, 0.994, 2], wave: 'sawtooth', noise: 0.04, spread: 0.4, sequence: [{ at: 0, len: 0.35 }], macros: mac(0.7, 0.6, 0.25, 0.15, 0.5), axis: AX.melody }),
  preset({ id: 'warm-pad-note', name: 'Warm Pad', category: 'Instruments', tag: 'Pad', description: 'A slow, warm pad note — hold chords under a beat.', keywords: ['pad', 'warm', 'chords', 'ambient', 'instrument'], topology: TOPOLOGY.brass, baseFreq: 220, ratios: [1, 1.007, 0.993, 1.5], wave: 'triangle', noise: 0.03, spread: 0.6, sequence: [{ at: 0, len: 1.4 }], macros: mac(0.3, 0.5, 0.45, 0, 0.5, { attack: 0.5 }), axis: AX.melody }),
  preset({ id: 'whistle-note', name: 'Whistle', category: 'Instruments', tag: 'Whistle', description: 'A breathy whistled note for carefree tunes.', keywords: ['whistle', 'note', 'tune', 'melody', 'happy'], topology: TOPOLOGY.beep, baseFreq: 880, wave: 'sine', noise: 0.12, spread: 0.1, sequence: [{ at: 0, len: 0.4 }], macros: mac(0.4, 0.5, 0.2, 0, 0.5, { modDepth: 0.12, modRate: 0.72 }), mod: { shape: 'sine', target: 'pitch' }, axis: AX.melody }),
  preset({ id: '808-bass-note', name: '808 Bass', category: 'Instruments', tag: '808', description: 'A clean, tuned 808 bass note for basslines under a beat.', keywords: ['808', 'bass', 'bassline', 'trap', 'note'], topology: TOPOLOGY.bass808, baseFreq: 55, fm: 0, noise: 0.05, spread: 0, macros: mac(0.35, 0.6, 0, 0.1, 0.45), axis: axes('Soft punch', 'Hard punch', 'Pure sub', 'Phone-friendly') }),
  preset({ id: 'sine-sub-bass-note', name: 'Sine Sub Bass', category: 'Instruments', tag: 'Sub', description: 'A pure sine sub note — the cleanest possible low end.', keywords: ['sub', 'sine', 'bass', 'clean', 'note'], topology: TOPOLOGY.bass808, baseFreq: 55, fm: 0, noise: 0, spread: 0, macros: mac(0.08, 0, 0, 0, 0.5), axis: axes('Soft punch', 'Hard punch', 'Pure sub', 'Phone-friendly') }),
];

// Clean, tuned 808s. They sit under the soft clipper's knee, so they never crackle.
const BASS_808: RecipeInput[] = [
  preset({ id: 'clean-808', name: 'Clean 808', category: 'Bass & Subs', tag: '808', description: 'A smooth, clean 808 with a soft punch and a long round tail.', keywords: ['808', 'clean', 'bass', 'trap', 'sub'], topology: TOPOLOGY.bass808, baseFreq: 49, fm: 0, noise: 0.05, spread: 0, macros: mac(0.35, 0.5, 0.05, 0, 0.7), axis: axes('Soft punch', 'Hard punch', 'Pure sub', 'Phone-friendly') }),
  preset({ id: 'punchy-808', name: 'Punchy 808', category: 'Bass & Subs', tag: '808 Punch', description: 'A short, hard-hitting 808 with a clicky attack for drill and trap edits.', keywords: ['808', 'punch', 'drill', 'trap', 'kick'], topology: TOPOLOGY.bass808, baseFreq: 55, fm: 0, noise: 0.2, spread: 0, macros: mac(0.75, 0.6, 0.05, 0.1, 0.35), axis: axes('Soft punch', 'Hard punch', 'Pure sub', 'Phone-friendly') }),
  preset({ id: '808-long-tail', name: '808 Long Tail', category: 'Bass & Subs', tag: '808 Tail', description: 'A deep 808 that rings out for seconds — the classic low-end bloom.', keywords: ['808', 'long', 'tail', 'deep', 'sub'], topology: TOPOLOGY.bass808, baseFreq: 41, fm: 0, noise: 0.05, spread: 0, macros: mac(0.3, 0.4, 0.08, 0.05, 1), axis: axes('Soft punch', 'Hard punch', 'Pure sub', 'Phone-friendly') }),
  preset({ id: '808-slide-up', name: '808 Slide Up', category: 'Bass & Subs', tag: '808 Slide', description: 'An 808 that slides up a fifth as it rings — instant trap bounce.', keywords: ['808', 'slide', 'glide', 'trap', 'up'], topology: TOPOLOGY.bass808, baseFreq: 41, fm: 7, noise: 0.05, spread: 0, macros: mac(0.35, 0.55, 0.05, 0.1, 0.6), axis: axes('Soft punch', 'Hard punch', 'Pure sub', 'Phone-friendly') }),
  preset({ id: '808-octave-drop', name: '808 Octave Drop', category: 'Bass & Subs', tag: '808 Drop', description: 'An 808 that glides down a full octave for dramatic drops.', keywords: ['808', 'drop', 'glide', 'octave', 'down'], topology: TOPOLOGY.bass808, baseFreq: 82, fm: -12, noise: 0.05, spread: 0, macros: mac(0.35, 0.55, 0.05, 0.1, 0.6), axis: axes('Soft punch', 'Hard punch', 'Pure sub', 'Phone-friendly') }),
  preset({ id: 'warm-saturated-808', name: 'Warm Saturated 808', category: 'Bass & Subs', tag: 'Warm 808', description: 'A warmer 808 with clean, oversampled saturation — audible on phones without crackle.', keywords: ['808', 'saturated', 'warm', 'distorted', 'phone'], topology: TOPOLOGY.bass808, baseFreq: 49, fm: 0, noise: 0.05, spread: 0, macros: mac(0.4, 0.6, 0.05, 0.45, 0.7), axis: axes('Soft punch', 'Hard punch', 'Pure sub', 'Phone-friendly') }),
  preset({ id: 'deep-sine-sub', name: 'Deep Sine Sub', category: 'Bass & Subs', tag: 'Sine Sub', description: 'A pure, very deep sine sub — felt more than heard, totally clean.', keywords: ['sub', 'sine', 'deep', 'clean', 'low end'], topology: TOPOLOGY.bass808, baseFreq: 36, fm: 0, noise: 0, spread: 0, macros: mac(0.05, 0, 0, 0, 0.75), axis: axes('Soft punch', 'Hard punch', 'Pure sub', 'Phone-friendly') }),
  preset({ id: 'sub-pulse', name: 'Sub Pulse', category: 'Bass & Subs', tag: 'Pulse', description: 'A short, tight sub pulse for beat-synced cuts and tension.', keywords: ['sub', 'pulse', 'short', 'tight', 'tension'], topology: TOPOLOGY.bass808, baseFreq: 45, fm: 0, noise: 0.05, spread: 0, macros: mac(0.3, 0.4, 0, 0, 0.05), axis: axes('Soft punch', 'Hard punch', 'Pure sub', 'Phone-friendly') }),
];

export const PRESETS_CATALOG: SoundRecipe[] = [
  ...RECIPES,
  ...POPS_AND_CLICKS,
  ...CLAPS,
  ...DRUM_HITS,
  ...BEATS,
  ...CARTOON,
  ...MELODIES,
  ...MORE_VIRAL,
  ...INSTRUMENTS,
  ...BASS_808,
].map(defineRecipe);

const MACRO_KEYS = [
  'x',
  'y',
  'space',
  'grit',
  'speed',
  'pitch',
  'attack',
  'width',
  'modDepth',
  'modRate',
  'cutoff',
  'resonance',
] as const satisfies readonly (keyof MacroValues)[];

const LEGACY_MACRO_COUNT = 6;

const RECIPE_BY_ID = new Map(
  PRESETS_CATALOG.map((recipe) => [recipe.id, recipe] as const),
);

const FALLBACK_RECIPE_ID = 'cupertino-tap';
const DEFAULT_MUTATION_INTENSITY = 0.22;

// Explicit per-axis weighting keeps pitch changes comparatively small.
const MUTATION_WEIGHTS: Readonly<MacroValues> = {
  x: 1,
  y: 1,
  space: 0.75,
  grit: 0.8,
  speed: 0.7,
  pitch: 0.35,
  attack: 0.5,
  width: 0.6,
  modDepth: 0.6,
  modRate: 0.6,
  cutoff: 0.5,
  resonance: 0.4,
};

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roundUnit(value: number): number {
  return Math.round(clampUnit(value) * 100) / 100;
}

/**
 * Finite numbers are clamped to [0, 1].
 * Missing values, non-numbers, NaN, and infinities use the fallback.
 */
function sanitizeMacro(value: unknown, fallback = 0.5): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clampUnit(value)
    : fallback;
}

/**
 * Six summed uniform samples give a bounded, Gaussian-like distribution.
 * Each sample has variance 1/12, so sqrt(2) normalizes the sum's
 * variance to 1. This avoids logarithms and unbounded outliers.
 */
function gaussianLike(): number {
  let sum = 0;

  for (let i = 0; i < 6; i += 1) {
    sum += Math.random();
  }

  return (sum - 3) * Math.SQRT2;
}

/**
 * Returns a new macro object; never mutates the supplied values.
 *
 * At the default intensity, the approximate standard deviation is
 * 0.11 for x/y and 0.0385 for pitch before boundary clamping.
 * Intensity is limited to [0, 1]; non-finite values use the default.
 * A zero intensity only sanitizes and rounds the current values.
 */
export function mutateMacros(
  current: MacroValues,
  intensity: number = DEFAULT_MUTATION_INTENSITY,
): MacroValues {
  const amount =
    typeof intensity === 'number' && Number.isFinite(intensity)
      ? clampUnit(intensity)
      : DEFAULT_MUTATION_INTENSITY;

  const nudge = (key: keyof MacroValues): number => {
    const start = sanitizeMacro(current?.[key], EXTENDED_DEFAULTS[key as keyof typeof EXTENDED_DEFAULTS] ?? 0.5);

    if (amount === 0) {
      return roundUnit(start);
    }

    const offset =
      gaussianLike() * amount * 0.5 * MUTATION_WEIGHTS[key];

    return roundUnit(start + offset);
  };

  return {
    x: nudge('x'),
    y: nudge('y'),
    space: nudge('space'),
    grit: nudge('grit'),
    speed: nudge('speed'),
    pitch: nudge('pitch'),
    attack: nudge('attack'),
    width: nudge('width'),
    modDepth: nudge('modDepth'),
    modRate: nudge('modRate'),
    cutoff: nudge('cutoff'),
    resonance: nudge('resonance'),
  };
}

/**
 * A piano-roll pattern as carried in share links. `steps` is the length in beats (one or two bars),
 * `div` the grid (steps per beat), and `cells[step]` lists semitone offsets (-12…+12) for each of
 * the `steps × div` steps.
 */
export interface SharedPattern {
  bpm: number;
  steps: 4 | 8;
  div: 1 | 2 | 4;
  cells: number[][];
}

const PATTERN_MAX_NOTES = 4;
const PATTERN_MIN_BPM = 60;
const PATTERN_MAX_BPM = 200;
const SEMI_LETTER_BASE = 'a'.charCodeAt(0) + 12; // 'a' = -12, 'm' = 0, 'y' = +12

/** "120x4x1xmh.mf.mh.mf" — bpm, beats, steps per beat, then one letter per note, steps split by "." */
function encodePattern(pattern: SharedPattern): string {
  const bpm = Math.round(Math.min(PATTERN_MAX_BPM, Math.max(PATTERN_MIN_BPM, pattern.bpm)));
  const cells = Array.from({ length: pattern.steps * pattern.div }, (_, i) =>
    [...new Set(pattern.cells[i] ?? [])]
      .filter((s) => Number.isInteger(s) && s >= -12 && s <= 12)
      .slice(0, PATTERN_MAX_NOTES)
      .map((s) => String.fromCharCode(SEMI_LETTER_BASE + s))
      .join(''),
  );
  return `${bpm}x${pattern.steps}x${pattern.div}x${cells.join('.')}`;
}

function decodePattern(bpm: string, steps: string, div: string, cells: string): SharedPattern {
  const groups = cells.split('.');
  const beats = steps === '8' ? 8 : 4;
  const perBeat = div === '4' ? 4 : div === '2' ? 2 : 1;
  return {
    bpm: Math.min(PATTERN_MAX_BPM, Math.max(PATTERN_MIN_BPM, Number(bpm))),
    steps: beats,
    div: perBeat,
    // Older links always carried 8 cells; missing cells are empty, extra ones are ignored.
    cells: Array.from({ length: beats * perBeat }, (_, i) =>
      [...new Set([...(groups[i] ?? '')].map((ch) => ch.charCodeAt(0) - SEMI_LETTER_BASE))].slice(0, PATTERN_MAX_NOTES),
    ),
  };
}

/**
 * Serializes a recipe, its twelve macros, the LFO/filter routing and (optionally) a piano-roll
 * pattern without throwing validation errors.
 *
 * Unknown recipe IDs fall back to cupertino-tap.
 * Each macro is sanitized, then quantized to an integer from 0 to 100.
 * The filter mode is only written when it is on; the pattern only when it contains a note.
 *
 * Example:
 * #pf=cupertino-tap:70.28.8.2.12.50.0.50.0.40.70.15:sine-pitch-lowpass:p120x4x1xmh.mf.mh.mf....
 *
 * Returns the hash without reading or changing window.location.
 */
export function encodeStateToHash(
  recipeId: string,
  macros: MacroValues,
  mod?: ModRouting,
  pattern?: SharedPattern,
): string {
  const recipe = RECIPE_BY_ID.get(recipeId);
  const safeRecipeId = recipe ? recipeId : FALLBACK_RECIPE_ID;
  const fallback = recipe?.defaultMacros;

  const packedMacros = MACRO_KEYS.map((key) =>
    Math.round(sanitizeMacro(macros?.[key], fallback?.[key] ?? 0.5) * 100),
  ).join('.');

  const routing = mod ?? recipe?.defaultMod ?? DEFAULT_MOD;
  const hasNotes = pattern?.cells.some((cell) => cell.length > 0) ?? false;
  const packedPattern = pattern && hasNotes ? `:p${encodePattern(pattern)}` : '';
  const filter = routing.filter !== 'off' ? `-${routing.filter}` : '';
  return `#pf=${safeRecipeId}:${packedMacros}:${routing.shape}-${routing.target}${filter}${packedPattern}`;
}

// Six or ten (older links) or twelve canonical integers from 0 through 100, plus optional LFO /
// filter routing and an optional piano-roll pattern (4–32 dot-separated steps of up to 4 letters a–y).
// Rejects leading zeros, signs, decimals, whitespace, and extra fields.
// The leading "#" is optional when decoding a manually supplied value.
const STATE_HASH_PATTERN =
  /^#?pf=([a-z0-9]+(?:-[a-z0-9]+)*):((?:0|[1-9]\d?|100)(?:\.(?:0|[1-9]\d?|100)){5}(?:(?:\.(?:0|[1-9]\d?|100)){4}(?:(?:\.(?:0|[1-9]\d?|100)){2})?)?)(?::([a-z]+)-([a-z]+)(?:-([a-z]+))?(?::p([1-9]\d{1,2})x([48])x([124])x((?:[a-y]{0,4}\.){3,31}[a-y]{0,4}))?)?$/;

const MAX_STATE_HASH_LENGTH = 420;

const isModShape = (v: unknown): v is ModShape =>
  typeof v === 'string' && (MOD_SHAPES as readonly string[]).includes(v);

const isModTarget = (v: unknown): v is ModTarget =>
  typeof v === 'string' && (MOD_TARGETS as readonly string[]).includes(v);

const isFilterMode = (v: unknown): v is FilterMode =>
  typeof v === 'string' && (FILTER_MODES as readonly string[]).includes(v);

/**
 * Parses a PocketFoley hash without browser APIs or dependencies.
 * Unknown recipes, malformed hashes, and out-of-range values return null.
 * Legacy six-macro links keep the preset's defaults for the newer macros.
 * `pattern` is present only when the link carries a piano-roll pattern.
 */
export function decodeStateFromHash(
  hash: string,
): { recipeId: string; macros: MacroValues; mod: ModRouting; pattern?: SharedPattern } | null {
  if (
    typeof hash !== 'string' ||
    hash.length === 0 ||
    hash.length > MAX_STATE_HASH_LENGTH
  ) {
    return null;
  }

  const match = STATE_HASH_PATTERN.exec(hash);

  // JavaScript's "$" can match before a final newline; require a
  // complete match so trailing line terminators are also rejected.
  if (!match || match[0] !== hash) {
    return null;
  }

  const recipeId = match[1];
  const packedMacros = match[2];
  const recipe = recipeId ? RECIPE_BY_ID.get(recipeId) : undefined;

  if (!recipeId || !packedMacros || !recipe) {
    return null;
  }

  // The pattern guarantees six or ten valid integer tokens.
  const values = packedMacros.split('.').map((v) => Number(v) / 100);
  const macros = { ...recipe.defaultMacros };
  MACRO_KEYS.forEach((key, i) => {
    const v = values[i];
    if (v !== undefined && (i < LEGACY_MACRO_COUNT || values.length > LEGACY_MACRO_COUNT)) {
      macros[key] = v;
    }
  });

  const shape = match[3];
  const target = match[4];
  const filter = match[5];
  const mod: ModRouting = {
    shape: isModShape(shape) ? shape : recipe.defaultMod.shape,
    target: isModTarget(target) ? target : recipe.defaultMod.target,
    // A link with routing but no filter token was made with the filter off.
    filter: isFilterMode(filter) ? filter : shape ? 'off' : recipe.defaultMod.filter,
  };

  const [, , , , , , bpm, steps, div, cells] = match;
  if (bpm && steps && div && cells !== undefined) {
    return { recipeId, macros, mod, pattern: decodePattern(bpm, steps, div, cells) };
  }
  return { recipeId, macros, mod };
}
