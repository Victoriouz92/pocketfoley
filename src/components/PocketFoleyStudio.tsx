/**
 * PocketFoley · PF-1 Procedural Foley Workstation
 *
 * Single-file hardware-style front panel: OLED oscilloscope/spectrum, XY morph pad
 * with phosphor trail, SVG rotary knobs, transport deck and preset matrix.
 * Audio is delegated entirely to `soundEngine`; preset data to `presetsCatalog`.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import {
  soundEngine,
  modRateHz,
  cutoffHz,
  topologyDuration,
  FILTER_MODES,
  MOD_SHAPES,
  MOD_TARGETS,
  type SoundRecipe,
  type MacroValues,
  type ModRouting,
  type ModShape,
  type ModTarget,
  type FilterMode,
  type MixPart,
  type BufferHit,
  type PatternNote,
  type SynthesisTopology
} from '../lib/soundEngine';

import {
  PRESETS_CATALOG,
  CATEGORIES,
  mutateMacros,
  encodeStateToHash,
  decodeStateFromHash
} from '../lib/presetsCatalog';

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

const SCRUB_THROTTLE_MS = 110;
const TOAST_MS = 1900;
const TRIGGER_FLASH_MS = 140;
const MIN_RENDER_INDICATOR_MS = 650;
const DOUBLE_TAP_MS = 300;
const TRAIL_LIFETIME_MS = 650;
const TRAIL_MAX_POINTS = 180;

const WAVE_SIZE = 1024;
const FREQ_SIZE = 512;
const BAR_COUNT = 56;

const KNOB_SWEEP = 270;

const HEX = {
  orange: '#FF5722',
  mint: '#10B981',
  amber: '#F59E0B',
  cobalt: '#3B82F6',
  sky: '#38BDF8',
  violet: '#A78BFA',
  stone: '#D6D3D1',
  yellow: '#FACC15',
  zinc: '#A1A1AA',
  oled: '#0A0C0E',
} as const;

type Category = SoundRecipe['category'];
type MacroKey = keyof MacroValues;
type KnobKey = Exclude<MacroKey, 'x' | 'y'>;
type ScrubPhase = 'start' | 'move' | 'end';
type ToastTone = 'ok' | 'warn' | 'error';

interface Toast {
  key: number;
  text: string;
  tone: ToastTone;
}

const MACRO_KEYS: MacroKey[] = ['x', 'y', 'space', 'grit', 'speed', 'pitch', 'attack', 'width', 'modDepth', 'modRate', 'cutoff', 'resonance'];

const TOPOLOGY_META: Record<SynthesisTopology, { code: string; hex: string; badge: string }> = {
  'ui-organic': {
    code: 'UI-ORG',
    hex: HEX.mint,
    badge: 'border-[#10B981]/40 bg-[#10B981]/10 text-[#10B981]',
  },
  'modal-impact': {
    code: 'MODAL',
    hex: HEX.amber,
    badge: 'border-[#F59E0B]/40 bg-[#F59E0B]/10 text-[#F59E0B]',
  },
  'cinematic-whoosh': {
    code: 'WHOOSH',
    hex: HEX.cobalt,
    badge: 'border-[#3B82F6]/40 bg-[#3B82F6]/10 text-[#3B82F6]',
  },
  'sub-boom': {
    code: 'SUB',
    hex: HEX.orange,
    badge: 'border-[#FF5722]/40 bg-[#FF5722]/10 text-[#FF5722]',
  },
  'scifi-glitch': {
    code: 'GLITCH',
    hex: '#E4E4E7',
    badge: 'border-zinc-300/40 bg-zinc-300/10 text-zinc-200',
  },
  footstep: {
    code: 'STEP',
    hex: HEX.stone,
    badge: 'border-[#D6D3D1]/40 bg-[#D6D3D1]/10 text-[#D6D3D1]',
  },
  'bell-chime': {
    code: 'BELL',
    hex: HEX.yellow,
    badge: 'border-[#FACC15]/40 bg-[#FACC15]/10 text-[#FACC15]',
  },
  riser: {
    code: 'RISE',
    hex: HEX.violet,
    badge: 'border-[#A78BFA]/40 bg-[#A78BFA]/10 text-[#A78BFA]',
  },
  downer: {
    code: 'DROP',
    hex: '#818CF8',
    badge: 'border-[#818CF8]/40 bg-[#818CF8]/10 text-[#818CF8]',
  },
  beep: {
    code: 'BEEP',
    hex: '#2DD4BF',
    badge: 'border-[#2DD4BF]/40 bg-[#2DD4BF]/10 text-[#2DD4BF]',
  },
  brass: {
    code: 'BRASS',
    hex: '#FB923C',
    badge: 'border-[#FB923C]/40 bg-[#FB923C]/10 text-[#FB923C]',
  },
  boing: {
    code: 'BOING',
    hex: '#F472B6',
    badge: 'border-[#F472B6]/40 bg-[#F472B6]/10 text-[#F472B6]',
  },
  drum: {
    code: 'DRUM',
    hex: '#E879F9',
    badge: 'border-[#E879F9]/40 bg-[#E879F9]/10 text-[#E879F9]',
  },
  scratch: {
    code: 'SCRATCH',
    hex: '#94A3B8',
    badge: 'border-[#94A3B8]/40 bg-[#94A3B8]/10 text-[#94A3B8]',
  },
  pluck: {
    code: 'PLUCK',
    hex: '#FCA5A5',
    badge: 'border-[#FCA5A5]/40 bg-[#FCA5A5]/10 text-[#FCA5A5]',
  },
  '808': {
    code: '808',
    hex: '#F87171',
    badge: 'border-[#F87171]/40 bg-[#F87171]/10 text-[#F87171]',
  },
};

const FALLBACK_TOPOLOGY = {
  code: 'SYNTH',
  hex: HEX.zinc,
  badge: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
};

const CATEGORY_HEX: Record<string, string> = {
  'Viral & Memes': '#F472B6',
  'UI & Apps': HEX.mint,
  'Cinematic & Reels': HEX.cobalt,
  'Bass & Subs': '#EF4444',
  'Drums & Beats': '#E879F9',
  'Cartoon & Melodies': '#A3E635',
  Instruments: '#2DD4BF',
  Favourites: HEX.amber,
  'Risers & Drops': HEX.violet,
  'Foley & Physics': HEX.amber,
  Footsteps: HEX.stone,
  'Bells & Chimes': HEX.yellow,
  'Sci-Fi & Glitch': HEX.orange,
};

const TOAST_TONE_CLASS: Record<ToastTone, string> = {
  ok: 'border-[#10B981]/50 text-[#10B981] shadow-[0_0_14px_rgba(16,185,129,0.25)]',
  warn: 'border-[#F59E0B]/50 text-[#F59E0B] shadow-[0_0_14px_rgba(245,158,11,0.25)]',
  error: 'border-[#FF5722]/60 text-[#FF5722] shadow-[0_0_14px_rgba(255,87,34,0.3)]',
};

interface KnobDef {
  key: KnobKey;
  label: string;
  minCaption: string;
  maxCaption: string;
  hex: string;
  tip: string;
  bipolar?: boolean;
  secondary?: (value: number) => string;
}

const KNOB_HELP = ' Drag up/down · Shift = fine · double-click to reset.';

const MAIN_KNOBS: KnobDef[] = [
  { key: 'space', label: 'SPACE', minCaption: 'DRY', maxCaption: 'HALL', hex: HEX.cobalt, tip: 'How much room echo: from dry and close to a big hall.' + KNOB_HELP },
  { key: 'grit', label: 'GRIT', minCaption: 'CLEAN', maxCaption: 'CRUNCH', hex: HEX.orange, tip: 'Warm saturation: adds bite and makes bass audible on phones.' + KNOB_HELP },
  { key: 'speed', label: 'SPEED', minCaption: 'TIGHT', maxCaption: 'TAIL', hex: HEX.amber, tip: 'How long the sound lasts: short and snappy, or long with a tail.' + KNOB_HELP },
  { key: 'pitch', label: 'PITCH', minCaption: '-12', maxCaption: '+12', hex: HEX.mint, bipolar: true, secondary: (v) => semitones(v), tip: 'Tune the sound up or down by up to one octave.' + KNOB_HELP },
  { key: 'attack', label: 'ATTACK', minCaption: 'SNAP', maxCaption: 'SWELL', hex: '#E4E4E7', tip: 'How the sound starts: instant hit, or a slow fade-in swell.' + KNOB_HELP },
  { key: 'width', label: 'WIDTH', minCaption: 'MONO', maxCaption: 'WIDE', hex: HEX.sky, bipolar: true, tip: 'Stereo width: centered mono, or spread wide across left and right.' + KNOB_HELP },
];

const MOD_KNOBS: KnobDef[] = [
  { key: 'modDepth', label: 'DEPTH', minCaption: 'OFF', maxCaption: 'DEEP', hex: HEX.violet, tip: 'How strongly the wobble (LFO) moves the sound. 0 = off.' + KNOB_HELP },
  { key: 'modRate', label: 'RATE', minCaption: '0.1HZ', maxCaption: '30HZ', hex: HEX.violet, secondary: (v) => formatRate(modRateHz(v)), tip: 'How fast the wobble moves: slow sweeps to fast flutter.' + KNOB_HELP },
];

const FILTER_KNOBS: KnobDef[] = [
  { key: 'cutoff', label: 'CUTOFF', minCaption: '20HZ', maxCaption: '20K', hex: HEX.sky, secondary: (v) => formatFreq(cutoffHz(v)), tip: 'Where the filter cuts. Low-pass: lower = darker. High-pass: higher = thinner.' + KNOB_HELP },
  { key: 'resonance', label: 'RESO', minCaption: 'SOFT', maxCaption: 'SHARP', hex: HEX.sky, tip: 'Adds a ringing peak at the cutoff — great with the FILTER wobble.' + KNOB_HELP },
];

const FILTER_LABELS: Record<FilterMode, { label: string; tip: string }> = {
  off: { label: 'Off', tip: 'No filter — the sound as designed.' },
  lowpass: { label: 'Low-pass', tip: 'Keeps the lows and removes highs: darker, muffled, "behind a wall".' },
  highpass: { label: 'High-pass', tip: 'Removes the lows: thinner, like a phone speaker or radio.' },
  bandpass: { label: 'Band-pass', tip: 'Keeps only a band around the cutoff: telephone and megaphone effects.' },
};

const CATEGORY_TIPS: Record<string, string> = {
  All: 'Every sound in the library.',
  Favourites: 'Sounds you starred. Tap the star on any sound (or press F) to keep it here.',
  'Viral & Memes': 'The effects people search for most on TikTok, Reels and Shorts.',
  'UI & Apps': 'Clicks, pops, dings and notifications for apps and screen recordings.',
  'Cinematic & Reels': 'Whooshes, hits and stings for transitions and dramatic edits.',
  'Bass & Subs': 'Booms, 808s and subs. Clean ones never crackle.',
  'Drums & Beats': 'Single drum hits and ready-made beats that lock to the pattern BPM.',
  'Cartoon & Melodies': 'Playful cartoon sounds and short tunes.',
  Instruments: 'Single notes made for the piano roll — build chords, melodies and basslines.',
  'Risers & Drops': 'Build-ups, swells, drops and tape stops.',
  'Foley & Physics': 'Real-world sounds: knocks, glass, paper, applause and more.',
  Footsteps: 'Single steps and walking or running sequences on many surfaces.',
  'Bells & Chimes': 'Bells, chimes, gongs and dings.',
  'Sci-Fi & Glitch': 'Lasers, glitches, data blips and teleports.',
};

/* Library filters by what kind of sound it is and how long it lasts. */
type KindFilter = 'all' | 'oneshot' | 'loop' | 'melodic' | 'bass';
type LengthFilter = 'any' | 'short' | 'medium' | 'long';

const KIND_FILTERS: { value: KindFilter; label: string; tip: string }[] = [
  { value: 'all', label: 'All kinds', tip: 'Show every kind of sound.' },
  { value: 'oneshot', label: 'One-shots', tip: 'Single hits, pops and effects.' },
  { value: 'loop', label: 'Loops & beats', tip: 'Beats and rhythmic sequences.' },
  { value: 'melodic', label: 'Melodic', tip: 'Notes and tunes with pitch — good for the piano roll.' },
  { value: 'bass', label: 'Bass', tip: 'Subs, 808s and booms.' },
];
const LENGTH_FILTERS: { value: LengthFilter; label: string; tip: string }[] = [
  { value: 'any', label: 'Any length', tip: 'Any duration.' },
  { value: 'short', label: 'Short', tip: 'Under half a second.' },
  { value: 'medium', label: 'Medium', tip: 'Half a second to two seconds.' },
  { value: 'long', label: 'Long', tip: 'Longer than two seconds.' },
];

const MELODIC_TOPOLOGIES = new Set<SynthesisTopology>(['pluck', 'bell-chime', 'beep', 'brass']);

function traitsOf(r: SoundRecipe): { kind: Exclude<KindFilter, 'all'>; length: Exclude<LengthFilter, 'any'> } {
  const seq = r.sequence ?? [];
  const distinctPitches = new Set(seq.map((n) => n.semi ?? 0)).size;
  const kind =
    r.bpm || (r.topology === 'drum' && seq.length >= 8)
      ? 'loop'
      : r.category === 'Bass & Subs' || r.topology === '808'
        ? 'bass'
        : MELODIC_TOPOLOGIES.has(r.topology) && (r.category === 'Instruments' || distinctPitches >= 3)
          ? 'melodic'
          : 'oneshot';
  const d = topologyDuration(r, r.defaultMacros);
  return { kind, length: d < 0.5 ? 'short' : d <= 2 ? 'medium' : 'long' };
}

/* Piano roll: two octaves around the preset's root, up to 8 steps, up to 4 notes (a chord) per step. */
const ROLL_SEMIS = Array.from({ length: 25 }, (_, i) => 12 - i);
/** Pattern length in beats (1 or 2 bars of 4/4); each track picks its own grid inside it. */
const ROLL_BEATS = [4, 8] as const;
type RollBeats = (typeof ROLL_BEATS)[number];
const ROLL_MAX_CELLS = 32; // 2 bars of 1/16
const ROLL_MAX_NOTES = 4;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
/** Starts like the classic two-voice pattern: root on top, a fourth/fifth below alternating. */
const DEFAULT_ROLL: number[][] = [[0, -5], [0, -7], [0, -5], [0, -7], [], [], [], []];
const STEP_DIVISIONS = [
  { div: 1, label: '1/4' },
  { div: 2, label: '1/8' },
  { div: 4, label: '1/16' },
] as const;
type StepDiv = (typeof STEP_DIVISIONS)[number]['div'];
const divLabel = (div: number) => STEP_DIVISIONS.find((d) => d.div === div)?.label ?? '1/4';

/* Trim: which part of the rendered sound is heard. `end: null` = to the natural end (tail included). */
interface Trim {
  start: number;
  end: number | null;
}
const FULL_TRIM: Trim = { start: 0, end: null };
const MIN_TRIM_LEN = 0.02;
const RENDER_CACHE_SIZE = 32;
const TRIM_FADES = [
  { sec: 0.005, label: '5MS' },
  { sec: 0.015, label: '15MS' },
  { sec: 0.06, label: '60MS' },
  { sec: 0.15, label: '150MS' },
] as const;
const QUICK_LENGTHS = [0.25, 0.5, 1] as const;

const isTrimmed = (t: Trim) => t.start > 0.0005 || t.end !== null;
const trimRegion = (t: Trim, duration: number) => {
  const start = Math.min(t.start, Math.max(0, duration - MIN_TRIM_LEN));
  const end = Math.min(t.end ?? duration, duration);
  return { start, len: Math.max(MIN_TRIM_LEN, end - start) };
};
const renderKey = (r: SoundRecipe, m: MacroValues, routing: ModRouting, semi: number) =>
  `${r.id}|${MACRO_KEYS.map((k) => m[k].toFixed(3)).join(',')}|${routing.shape}-${routing.target}-${routing.filter}|${semi}`;

/* Pattern tracks: each holds its own sound and notes. */
interface Track {
  recipe: SoundRecipe;
  macros: MacroValues;
  mod: ModRouting;
  trim: Trim;
  steps: number[][];
  /** Grid resolution: 1 = 1/4 notes, 2 = 1/8, 4 = 1/16. */
  div: StepDiv;
  muted: boolean;
}
type LengthMode = 'natural' | 'cut' | 'fit';

const TRACK_COLORS = ['#FF7A45', '#60A5FA', '#4ADE80'] as const;
const emptySteps = (): number[][] => Array.from({ length: ROLL_MAX_CELLS }, () => []);
const EMPTY_STEPS = emptySteps();
const padSteps = (steps: number[][]) => Array.from({ length: ROLL_MAX_CELLS }, (_, i) => steps[i] ?? []);

/** Moves notes to another grid resolution, keeping their timing (coarser grids merge cells). */
function regrid(steps: number[][], from: number, to: number): number[][] {
  const out = emptySteps();
  steps.forEach((cell, i) => {
    const j = Math.floor((i * to) / from);
    if (!cell.length || j >= ROLL_MAX_CELLS) return;
    out[j] = [...new Set([...(out[j] ?? []), ...cell])].slice(0, ROLL_MAX_NOTES);
  });
  return out;
}
const LENGTH_MODES: { mode: LengthMode; label: string; tip: string }[] = [
  { mode: 'natural', label: 'Natural', tip: 'Every sound plays its full natural length — notes may overlap.' },
  { mode: 'cut', label: 'Cut', tip: 'Every note stops at the end of its step, so nothing overlaps. Beats follow the BPM.' },
  {
    mode: 'fit',
    label: 'Fit',
    tip: 'Each sound is resized to end exactly where the next note on its track starts. Beats lock to the BPM.',
  },
];

const trackFor = (recipe: SoundRecipe, steps: number[][], div: StepDiv = 1): Track => ({
  recipe,
  macros: { ...recipe.defaultMacros },
  mod: { ...recipe.defaultMod },
  trim: FULL_TRIM,
  steps: padSteps(steps),
  div,
  muted: false,
});

/** A small ready-to-play song: the current sound on the one, a beat, and kalimba chords on top. */
function defaultTracks(first: SoundRecipe): Track[] {
  const find = (id: string) => PRESETS_CATALOG.find((r) => r.id === id) ?? first;
  const one = EMPTY_STEPS.map((_, i) => (i === 0 ? [0] : []));
  return [trackFor(first, one), trackFor(find('boom-bap-beat'), one), trackFor(find('kalimba-note'), DEFAULT_ROLL)];
}

const pitchClass = (midi: number) => ((Math.round(midi) % 12) + 12) % 12;
const noteName = (midi: number) => `${NOTE_NAMES[pitchClass(midi)] ?? ''}${Math.floor(Math.round(midi) / 12) - 1}`;
const rootMidiOf = (recipe: SoundRecipe, pitch: number) =>
  69 + 12 * Math.log2((recipe.baseFreq * Math.pow(2, ((pitch - 0.5) * 24) / 12)) / 440);

const SHAPE_META: Record<ModShape, { label: string; path: string }> = {
  sine: { label: 'SINE', path: 'M1 6 C3 -1 5 -1 6 6 S9 13 11 6' },
  triangle: { label: 'TRI', path: 'M1 9 L3.5 2 L8.5 10 L11 3' },
  square: { label: 'SQR', path: 'M1 9 V3 H6 V9 H11 V3' },
  sawtooth: { label: 'SAW', path: 'M1 9 L6 3 V9 L11 3 V9' },
  random: { label: 'S&H', path: 'M1 7 H3 V2 H5 V9 H7 V4 H9 V8 H11' },
};

const SHAPE_TIPS: Record<ModShape, string> = {
  sine: 'Smooth, even wobble.',
  triangle: 'Straight up-and-down wobble, a little sharper than sine.',
  square: 'Jumps between two values — trills and sirens.',
  sawtooth: 'Ramps up then drops — rising zaps and alarms.',
  random: 'Random steps — glitchy, robotic movement.',
};

const TARGET_TIPS: Record<ModTarget, string> = {
  pitch: 'The wobble moves the pitch — vibrato and sirens.',
  filter: 'The wobble opens and closes the tone — wah and wub.',
  amp: 'The wobble moves the volume — tremolo and pulsing.',
  pan: 'The wobble moves the sound left and right.',
};

const TARGET_LABEL: Record<ModTarget, string> = {
  pitch: 'PITCH',
  filter: 'FILTER',
  amp: 'AMP',
  pan: 'PAN',
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const pct = (v: number) => `${Math.round(v * 100)}`;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function semitones(pitch: number): string {
  const st = (pitch - 0.5) * 24;
  const rounded = Math.abs(st) < 0.05 ? 0 : st;
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded).toFixed(1)}st`;
}

function formatFreq(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}kHz` : `${Math.round(hz)}Hz`;
}

function formatRate(hz: number): string {
  return `${hz < 1 ? hz.toFixed(2) : hz < 10 ? hz.toFixed(1) : Math.round(hz)}Hz`;
}

const isModShape = (v: unknown): v is ModShape =>
  typeof v === 'string' && (MOD_SHAPES as readonly string[]).includes(v);

const isFilterMode = (v: unknown): v is FilterMode =>
  typeof v === 'string' && (FILTER_MODES as readonly string[]).includes(v);

const isModTarget = (v: unknown): v is ModTarget =>
  typeof v === 'string' && (MOD_TARGETS as readonly string[]).includes(v);


function topologyMeta(t: SynthesisTopology) {
  return TOPOLOGY_META[t] ?? FALLBACK_TOPOLOGY;
}

function sanitizeMacros(raw: unknown, fallback: MacroValues): MacroValues {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<MacroKey, unknown>>;
  const out: MacroValues = { ...fallback };
  for (const k of MACRO_KEYS) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = clamp01(v);
  }
  return out;
}

function macrosEqual(a: MacroValues, b: MacroValues): boolean {
  return MACRO_KEYS.every((k) => Math.abs(a[k] - b[k]) < 1e-4);
}

/** Normalises CATEGORIES whether it is exported as strings or {id|name|label} objects. */
function resolveCategories(): Category[] {
  const fromCatalog = Array.from(new Set(PRESETS_CATALOG.map((r) => r.category)));
  const raw = CATEGORIES as unknown;
  if (!Array.isArray(raw)) return fromCatalog;
  const list = raw
    .map((c: unknown) => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object') {
        const o = c as { id?: unknown; name?: unknown; label?: unknown };
        return [o.id, o.name, o.label].find((v) => typeof v === 'string');
      }
      return undefined;
    })
    .filter((c): c is Category => typeof c === 'string');
  return list.length > 0 ? list : fromCatalog;
}

const CATEGORY_LIST = resolveCategories();
const CATALOG_INDEX = new Map(PRESETS_CATALOG.map((r, i) => [r.id, i] as const));
const ALL_BANK = 'All';
const FAV_BANK = 'Favourites';
const FAV_STORAGE_KEY = 'pf-favourites';

/** Starred sound ids, remembered per browser. Unknown ids (removed presets) are dropped. */
function loadFavourites(): ReadonlySet<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FAV_STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && CATALOG_INDEX.has(id)) : []);
  } catch {
    return new Set();
  }
}

/* Undo / redo: a snapshot of the editor and every track. */
interface Snapshot {
  recipe: SoundRecipe;
  macros: MacroValues;
  mod: ModRouting;
  trim: Trim;
  tracks: Track[];
  activeTrack: number;
}
const HISTORY_LIMIT = 80;
/** A change is recorded once things stay still this long, so one knob drag is one undo step. */
const HISTORY_SETTLE_MS = 400;

/** Identity of a snapshot. The selected track is described by the editor, which it mirrors. */
function snapshotKey(snap: Snapshot): string {
  return JSON.stringify([
    snap.activeTrack,
    snap.tracks.map((t, i) => {
      const live = i === snap.activeTrack ? snap : t;
      return [live.recipe.id, live.macros, live.mod, live.trim, t.steps, t.div, t.muted];
    }),
  ]);
}
const SOUND_TRAITS = new Map(PRESETS_CATALOG.map((r) => [r.id, traitsOf(r)] as const));

function categoryMeta(cat: string) {
  const i = CATEGORY_LIST.indexOf(cat as Category);
  return {
    bank: String.fromCharCode(65 + Math.max(0, i)),
    hex: CATEGORY_HEX[cat] ?? HEX.zinc,
  };
}

interface RollPattern {
  bpm: number;
  steps: number;
  div: number;
  cells: number[][];
}

/** Accepts only a well-formed pattern from a decoded link; anything else is ignored. */
function readRollPattern(raw: unknown): RollPattern | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Partial<Record<keyof RollPattern, unknown>>;
  if (typeof p.bpm !== 'number' || typeof p.steps !== 'number' || typeof p.div !== 'number' || !Array.isArray(p.cells)) {
    return undefined;
  }
  const cells = Array.from({ length: ROLL_MAX_CELLS }, (_, i) => {
    const cell: unknown = (p.cells as unknown[])[i];
    return Array.isArray(cell)
      ? cell.filter((s): s is number => typeof s === 'number' && Number.isInteger(s) && s >= -12 && s <= 12).slice(0, ROLL_MAX_NOTES)
      : [];
  });
  return {
    bpm: Math.min(200, Math.max(60, Math.round(p.bpm))),
    steps: p.steps === 8 ? 8 : 4,
    div: STEP_DIVISIONS.some((d) => d.div === p.div) ? p.div : 1,
    cells,
  };
}

function readHashState(): { recipe: SoundRecipe; macros: MacroValues; mod: ModRouting; pattern?: RollPattern } | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (hash.length < 2) return null;
  for (const candidate of [hash, hash.slice(1)]) {
    try {
      const decoded = decodeStateFromHash(candidate) as unknown;
      if (!decoded || typeof decoded !== 'object') continue;
      const d = decoded as Record<string, unknown>;
      const nested = d.recipe && typeof d.recipe === 'object' ? (d.recipe as { id?: unknown }).id : undefined;
      const id = [d.recipeId, d.presetId, d.id, nested].find((v): v is string => typeof v === 'string');
      const recipe = PRESETS_CATALOG.find((r) => r.id === id);
      if (!recipe) continue;
      const rawMod = (d.mod && typeof d.mod === 'object' ? d.mod : {}) as { shape?: unknown; target?: unknown; filter?: unknown };
      const mod: ModRouting = {
        shape: isModShape(rawMod.shape) ? rawMod.shape : recipe.defaultMod.shape,
        target: isModTarget(rawMod.target) ? rawMod.target : recipe.defaultMod.target,
        filter: isFilterMode(rawMod.filter) ? rawMod.filter : recipe.defaultMod.filter,
      };
      return { recipe, macros: sanitizeMacros(d.macros, recipe.defaultMacros), mod, pattern: readRollPattern(d.pattern) };
    } catch {
      /* malformed hash form — try the next candidate */
    }
  }
  return null;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission denied or insecure context — use the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
  );
}

/** Log-spaced FFT bin ranges for the spectrum bars, computed once. */
const BAR_BINS = (() => {
  const lo = new Uint16Array(BAR_COUNT);
  const hi = new Uint16Array(BAR_COUNT);
  const minBin = 2;
  const maxBin = FREQ_SIZE - 1;
  for (let i = 0; i < BAR_COUNT; i++) {
    const a = Math.floor(minBin * Math.pow(maxBin / minBin, i / BAR_COUNT));
    const b = Math.floor(minBin * Math.pow(maxBin / minBin, (i + 1) / BAR_COUNT));
    lo[i] = a;
    hi[i] = Math.max(a + 1, b);
  }
  return { lo, hi };
})();

/* ────────────────────────────────────────────────────────────────────────── */
/* Inline icons                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function IconPlay({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path d="M7 4.5v15a1 1 0 0 0 1.52.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" fill="currentColor" />
    </svg>
  );
}

function IconDice({ className = '' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconReset({ className = '' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M4 12a8 8 0 1 0 2.6-5.9" />
      <path d="M4 4.5v5h5" />
    </svg>
  );
}

function IconLink({ className = '' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
    </svg>
  );
}

function IconStar({ className = '', filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg {...iconProps} className={className} fill={filled ? 'currentColor' : 'none'}>
      <path d="m12 3.5 2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />
    </svg>
  );
}

function IconUndo({ className = '' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function IconForge({ className = '' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M12 3.5v11" />
      <path d="m7.5 10 4.5 4.5 4.5-4.5" />
      <path d="M4 16.5v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Hardware primitives                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

function Led({ hex, on, pulse = false, size = 'sm' }: { hex: string; on: boolean; pulse?: boolean; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full transition-[opacity,box-shadow] duration-300 ease-smooth ${size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2'} ${pulse ? 'animate-pulse' : ''}`}
      style={{
        backgroundColor: hex,
        opacity: on ? 1 : 0.22,
        boxShadow: on ? `0 0 6px ${hex}, 0 0 14px ${hex}80` : 'none',
      }}
    />
  );
}

/** Small uppercase caption. */
function Silk({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3 ${className}`}>{children}</span>;
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md border border-line bg-inset px-1 font-mono text-[10px] leading-none text-ink-3">
      {children}
    </kbd>
  );
}

function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`relative rounded-[24px] border border-line bg-panel p-3.5 shadow-panel transition-colors duration-300 sm:p-5 ${className}`}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-4 sm:gap-3">
        <h2 className="text-[12px] font-semibold tracking-[0.02em] text-ink">{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}

function ToggleSwitch({
  on,
  onToggle,
  label,
  hint,
  tip,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  hint?: string;
  tip?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-tip={tip}
      data-tip-key={hint}
      onClick={onToggle}
      className="group flex items-center gap-2 rounded-full py-1 pl-1 pr-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <span
        className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-300 ease-smooth ${on ? 'bg-accent' : 'bg-inset shadow-well'}`}
      >
        <span
          className={`absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-smooth ${on ? 'translate-x-4' : ''}`}
        />
      </span>
      <span className="text-[12px] font-medium text-ink-2 transition-colors group-hover:text-ink">{label}</span>
      {hint && <Kbd>{hint}</Kbd>}
    </button>
  );
}

type ThemePref = 'system' | 'light' | 'dark';

/** Light / dark / follow-the-system, remembered per browser. */
function useThemePref() {
  const [pref, setPref] = useState<ThemePref>(() => {
    try {
      const saved = localStorage.getItem('pf-theme');
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);
    try {
      if (pref === 'system') localStorage.removeItem('pf-theme');
      else localStorage.setItem('pf-theme', pref);
    } catch {
      // Storage blocked — the choice still applies for this visit.
    }
  }, [pref]);
  return [pref, setPref] as const;
}

const THEME_OPTIONS: { value: 'light' | 'dark'; label: string; tip: string; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'Light',
    tip: 'Light theme — warm cream.',
    icon: (
      <svg {...iconProps} className="h-3.5 w-3.5">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    tip: 'Dark theme — graphite.',
    icon: (
      <svg {...iconProps} className="h-3.5 w-3.5">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
    ),
  },
];

/** Light/dark switch. Until the user picks one, the active side follows the system setting. */
function ThemeToggle({ pref, onChange }: { pref: ThemePref; onChange: (pref: ThemePref) => void }) {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChangeScheme = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChangeScheme);
    return () => mq.removeEventListener('change', onChangeScheme);
  }, []);
  const resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  return (
    <div role="radiogroup" aria-label="Theme" className="flex items-center gap-0.5 rounded-full border border-line bg-inset p-0.5 shadow-well">
      {THEME_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={resolved === o.value}
          data-tip={o.tip}
          aria-label={o.label}
          onClick={() => onChange(o.value)}
          className={`flex h-7 w-7 items-center justify-center rounded-full outline-none transition-all duration-300 ease-smooth focus-visible:ring-2 focus-visible:ring-accent/50 ${
            resolved === o.value ? 'bg-raised text-ink shadow-raised' : 'text-ink-3 hover:text-ink'
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * "Install app": Android and desktop Chrome/Edge show their install dialog; iPhone/iPad have no
 * dialog, so the button explains Share → Add to Home Screen. Hidden once running as an app.
 */
function InstallButton({ onHint }: { onHint: (text: string) => void }) {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
  );
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || (!prompt && !ios)) return null;
  return (
    <button
      type="button"
      data-tip="Install PocketFoley as an app on this device. It opens from your home screen or desktop and works offline."
      onClick={async () => {
        if (!prompt) {
          onHint('TAP SHARE ↑ THEN “ADD TO HOME SCREEN”');
          return;
        }
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice.outcome === 'accepted') setPrompt(null);
      }}
      className="flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[12px] font-semibold text-page shadow-raised outline-none transition-all duration-200 ease-smooth hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-95"
    >
      <IconForge className="h-3.5 w-3.5" />
      Install app
    </button>
  );
}

/**
 * One shared tooltip for the whole app: any element with `data-tip` (and optionally
 * `data-tip-key` for a shortcut) shows a small explanation after a short hover, or immediately
 * on keyboard focus. Touch taps never trigger it.
 */
function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; shortcut?: string; x: number; y: number; above: boolean } | null>(null);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    const show = (el: HTMLElement, delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const text = el.dataset.tip;
        if (!text || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const above = r.top > 90;
        setTip({ text, shortcut: el.dataset.tipKey, x: r.left + r.width / 2, y: above ? r.top : r.bottom, above });
      }, delay);
    };
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.buttons !== 0) return;
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip]') : null;
      if (el === current) return;
      current = el;
      if (el) show(el, 450);
      else hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip]') : null;
      if (el && el.matches(':focus-visible')) {
        current = el;
        show(el, 0);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('pointerover', onOver);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('focusin', onFocus);
    window.addEventListener('focusout', hide);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerover', onOver);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('focusin', onFocus);
      window.removeEventListener('focusout', hide);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!tip) return null;
  const x = Math.min(Math.max(tip.x, 132), window.innerWidth - 132);
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[100] w-max max-w-[250px] animate-[pf-tip_0.18s_var(--ease-smooth)] rounded-xl bg-ink px-3 py-2 text-[12px] leading-snug text-page shadow-[0_12px_32px_-10px_rgba(0,0,0,0.55)]"
      style={{ left: x, top: tip.above ? tip.y - 10 : tip.y + 10, transform: `translate(-50%, ${tip.above ? '-100%' : '0'})` }}
    >
      {tip.text}
      {tip.shortcut && (
        <span className="ml-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-page/15 px-1 font-mono text-[10px]">
          {tip.shortcut}
        </span>
      )}
    </div>
  );
}

/** Tooltip attributes; a trailing "(K)" in the text becomes the shortcut badge. */
function tipAttrs(text: string) {
  const m = /^(.*?)\s*\(([^()]{1,7})\)$/.exec(text);
  return m ? { 'data-tip': m[1], 'data-tip-key': m[2] } : { 'data-tip': text };
}

function HardwareButton({
  label,
  keyHint,
  icon,
  onClick,
  ledHex,
  ledOn = false,
  ledPulse = false,
  disabled = false,
  title,
}: {
  label: string;
  keyHint?: string;
  icon: ReactNode;
  onClick: () => void;
  ledHex: string;
  ledOn?: boolean;
  ledPulse?: boolean;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      {...tipAttrs(title)}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="group relative flex h-[76px] min-w-0 flex-col justify-between whitespace-nowrap rounded-2xl border border-line bg-raised px-3.5 py-3 text-left text-ink shadow-raised outline-none transition-all duration-200 ease-smooth hover:-translate-y-px hover:border-line-strong focus-visible:ring-2 focus-visible:ring-accent/50 active:translate-y-0 active:scale-[0.97] disabled:cursor-wait disabled:opacity-60"
    >
      <span className="flex items-start justify-between">
        <span className="h-[18px] w-[18px] text-ink-2 transition-colors group-hover:text-ink">{icon}</span>
        <span className="flex items-center gap-1.5">
          {keyHint && <Kbd>{keyHint}</Kbd>}
          <Led hex={ledHex} on={ledOn} pulse={ledPulse} />
        </span>
      </span>
      <span className="truncate text-[12.5px] font-medium">{label}</span>
    </button>
  );
}

function SmallKey({
  active = false,
  onClick,
  title,
  children,
  className = '',
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      {...tipAttrs(title)}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[11.5px] font-medium outline-none transition-all duration-200 ease-smooth focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.96] ${
        active
          ? 'border-transparent bg-ink text-page shadow-raised'
          : 'border-line bg-raised text-ink-2 shadow-raised hover:border-line-strong hover:text-ink'
      } ${className}`}
    >
      {children}
    </button>
  );
}

function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string; tip: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={`Filter by ${label}`} className="flex flex-wrap items-center gap-0.5 rounded-full border border-line bg-inset p-0.5 shadow-well">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          data-tip={o.tip}
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-full px-3 text-[11.5px] font-medium outline-none transition-all duration-200 ease-smooth focus-visible:ring-2 focus-visible:ring-accent/50 ${
            value === o.value ? 'bg-raised text-ink shadow-raised' : 'text-ink-3 hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PianoRoll({
  steps,
  stepCount,
  div,
  rootMidi,
  playingStep,
  onToggle,
  color,
  ghosts = [],
}: {
  steps: number[][];
  stepCount: number;
  /** Steps per beat — beat and bar lines are drawn from it. */
  div: number;
  rootMidi: number;
  playingStep: number | null;
  onToggle: (step: number, semi: number) => void;
  /** Colour of the notes being edited (the active track). */
  color: string;
  /** Other tracks' notes, drawn faintly so the parts can be lined up. */
  ghosts?: { steps: number[][]; color: string }[];
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-inset p-1 shadow-well">
      <div
        role="grid"
        aria-label="Piano roll"
        className="grid min-w-[420px] overflow-hidden rounded-xl"
        style={{ gridTemplateColumns: `46px repeat(${stepCount}, minmax(${stepCount > 16 ? 18 : stepCount > 8 ? 26 : 44}px, 1fr))` }}
      >
        {ROLL_SEMIS.map((semi) => {
          const midi = rootMidi + semi;
          const black = BLACK_KEYS.has(pitchClass(midi));
          const label = pitchClass(midi) === 0 || semi === 0 ? noteName(midi) : '';
          return (
            <div key={semi} role="row" className="contents">
              <div
                className={`flex h-3.5 items-center justify-end border-b border-line pr-1.5 font-mono text-[7.5px] font-medium ${
                  semi === 0
                    ? 'bg-accent text-accent-ink'
                    : black
                      ? 'bg-[var(--pf-key-black)] text-ink-3'
                      : 'bg-[var(--pf-key-white)] text-ink-3'
                }`}
              >
                {label}
              </div>
              {Array.from({ length: stepCount }, (_, step) => {
                const on = steps[step]?.includes(semi) ?? false;
                const ghost = on ? undefined : ghosts.find((g) => g.steps[step]?.includes(semi));
                return (
                  <button
                    key={step}
                    type="button"
                    role="gridcell"
                    aria-selected={on}
                    aria-label={`Step ${step + 1}, ${noteName(midi)}`}
                    onClick={() => onToggle(step, semi)}
                    className={`relative h-3.5 border-b border-r border-line p-px outline-none transition-colors duration-150 hover:bg-accent/10 focus-visible:ring-1 focus-visible:ring-accent ${
                      playingStep === step ? 'bg-accent/15' : black ? 'bg-[var(--pf-cell-alt)]' : 'bg-[var(--pf-cell)]'
                    } ${(step + 1) % (div * 4) === 0 ? 'border-r-ink-3/60' : (step + 1) % div === 0 ? 'border-r-line-strong' : ''}`}
                  >
                    {on ? (
                      <span
                        className="flex h-full items-center rounded-[4px] pl-1 font-mono text-[7px] font-semibold text-black/70"
                        style={{ background: color, boxShadow: `0 0 10px ${color}59` }}
                      >
                        {stepCount <= 16 && noteName(midi)}
                      </span>
                    ) : (
                      ghost && <span className="block h-full rounded-[4px] opacity-25" style={{ background: ghost.color }} />
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Waveform of the current sound's offline render with draggable START / END handles. Dragging
 * anywhere moves the nearest handle; arrow keys nudge a focused handle (Shift = 50 ms steps).
 */
function TrimEditor({
  buffer,
  trim,
  hex,
  onChange,
  onCommit,
}: {
  buffer: AudioBuffer | null;
  trim: Trim;
  hex: string;
  onChange: (next: Trim) => void;
  onCommit: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ pointerId: number; handle: 'start' | 'end' } | null>(null);
  const duration = buffer?.duration ?? 1;
  const start = Math.min(trim.start, duration);
  const end = Math.min(trim.end ?? duration, duration);

  // Peak-per-column waveform, redrawn when the render or the canvas size changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      if (!buffer) return;
      const left = buffer.getChannelData(0);
      const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
      const cols = Math.max(1, Math.floor(rect.width));
      const per = Math.max(1, Math.floor(left.length / cols));
      let max = 0.0001;
      const peaks = new Float32Array(cols);
      for (let c = 0; c < cols; c++) {
        let p = 0;
        for (let i = c * per, e = Math.min(left.length, i + per); i < e; i++) {
          p = Math.max(p, Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0));
        }
        peaks[c] = p;
        max = Math.max(max, p);
      }
      const mid = rect.height / 2;
      ctx.fillStyle = hex;
      for (let c = 0; c < cols; c++) {
        const h = Math.max(1, ((peaks[c] ?? 0) / max) * (mid - 2));
        ctx.fillRect(c, mid - h, 1, h * 2);
      }
    };
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    draw();
    return () => ro.disconnect();
  }, [buffer, hex]);

  const timeAt = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return clamp01((clientX - rect.left) / rect.width) * duration;
  };

  const apply = (handle: 'start' | 'end', time: number) => {
    if (handle === 'start') onChange({ start: Math.max(0, Math.min(time, end - MIN_TRIM_LEN)), end: trim.end });
    else {
      const nextEnd = Math.min(duration, Math.max(time, start + MIN_TRIM_LEN));
      onChange({ start: trim.start, end: nextEnd >= duration - 0.0005 ? null : nextEnd });
    }
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!buffer || e.button !== 0) return;
    e.preventDefault();
    const time = timeAt(e.clientX);
    const handle = Math.abs(time - start) <= Math.abs(time - end) ? 'start' : 'end';
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, handle };
    apply(handle, time);
  };
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d?.pointerId === e.pointerId) apply(d.handle, timeAt(e.clientX));
  };
  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
    onCommit();
  };
  const handleKey = (handle: 'start' | 'end') => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const current = handle === 'start' ? start : end;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') apply(handle, current - step);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') apply(handle, current + step);
    else return;
    e.preventDefault();
  };
  const handleKeyUp = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key.startsWith('Arrow')) onCommit();
  };

  const pctStart = (start / duration) * 100;
  const pctEnd = (end / duration) * 100;
  const ticks = Array.from({ length: Math.min(12, Math.max(1, Math.floor(duration / 0.25))) + 1 }, (_, i) => {
    const step = duration <= 1.5 ? 0.25 : duration <= 4 ? 0.5 : 1;
    return i * step;
  }).filter((t) => t <= duration + 1e-6);

  return (
    <div className="relative">
      <div className="relative h-36 overflow-hidden rounded-2xl border border-line bg-inset shadow-well">
      {/* Inner track is inset so the round handles stay fully visible at 0 % and 100 %. */}
      <div
        ref={wrapRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="absolute inset-y-0 left-3 right-3 touch-none cursor-ew-resize"
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-x-0 inset-y-2 h-[calc(100%-16px)] w-full" />
        {!buffer && (
          <span className="absolute inset-0 flex items-center justify-center text-[11px] text-ink-3">Rendering waveform…</span>
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 bg-[var(--pf-dim)] transition-[width] duration-75"
          style={{ width: `${pctStart}%` }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 bg-[var(--pf-dim)] transition-[width] duration-75"
          style={{ width: `${100 - pctEnd}%` }}
        />
        {(['start', 'end'] as const).map((handle) => {
          const pct = handle === 'start' ? pctStart : pctEnd;
          const value = handle === 'start' ? start : end;
          return (
            <div
              key={handle}
              role="slider"
              tabIndex={0}
              aria-label={handle === 'start' ? 'Trim start' : 'Trim end'}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration * 1000)}
              aria-valuenow={Math.round(value * 1000)}
              aria-valuetext={`${value.toFixed(3)} seconds`}
              onKeyDown={handleKey(handle)}
              onKeyUp={handleKeyUp}
              className="group absolute inset-y-0 z-10 w-4 -translate-x-1/2 outline-none"
              style={{ left: `${pct}%` }}
            >
              <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-accent shadow-glow" />
              <span
                className={`absolute left-1/2 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-accent bg-raised shadow-raised transition-transform duration-200 ease-smooth group-hover:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-accent/50 ${
                  handle === 'start' ? 'top-1.5' : 'bottom-1.5'
                }`}
              />
            </div>
          );
        })}
      </div>
      </div>
      <div className="relative mx-3 mt-1.5 h-3 font-mono text-[9px] tabular-nums text-ink-3">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(t / duration) * 100}%` }}>
            {t.toFixed(t < 1 && duration <= 1.5 ? 2 : 1)}s
          </span>
        ))}
      </div>
    </div>
  );
}

function ModKey({
  active,
  label,
  icon,
  onClick,
  tip,
}: {
  active: boolean;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  tip?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-tip={tip}
      onClick={onClick}
      className={`flex min-w-0 items-center justify-center border px-1 text-[10.5px] font-medium outline-none ${icon ? 'h-12 flex-col gap-1 rounded-2xl' : 'h-8 gap-1.5 rounded-full'} transition-all duration-200 ease-smooth focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.96] ${
        active
          ? 'border-transparent bg-ink text-page shadow-raised'
          : 'border-line bg-raised text-ink-2 shadow-raised hover:border-line-strong hover:text-ink'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Rotary knob                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

interface RotaryKnobProps {
  label: string;
  value: number;
  defaultValue: number;
  hex: string;
  minCaption: string;
  maxCaption: string;
  bipolar?: boolean;
  secondary?: string;
  tip?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  onCommit: () => void;
}

function RotaryKnob({
  label,
  value,
  defaultValue,
  hex,
  minCaption,
  maxCaption,
  bipolar = false,
  secondary,
  tip,
  disabled = false,
  onChange,
  onCommit,
}: RotaryKnobProps) {
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const dragRef = useRef<{ pointerId: number; lastY: number; value: number; moved: boolean } | null>(null);
  const lastTapRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  const angle = -KNOB_SWEEP / 2 + value * KNOB_SWEEP;

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    if (performance.now() - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      onChange(defaultValue);
      onCommit();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, lastY: e.clientY, value, moved: false };
    setDragging(true);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dy = d.lastY - e.clientY;
    d.lastY = e.clientY;
    if (dy === 0) return;
    const next = clamp01(d.value + dy * (e.shiftKey ? 1 / 720 : 1 / 180));
    if (next !== d.value) {
      d.value = next;
      d.moved = true;
      onChange(next);
    }
  };

  const handlePointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.moved) {
      lastTapRef.current = 0;
      onCommit();
    } else {
      lastTapRef.current = performance.now();
    }
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = value + step;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = value - step;
        break;
      case 'PageUp':
        next = value + 0.1;
        break;
      case 'PageDown':
        next = value - 0.1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 1;
        break;
      case 'Delete':
      case 'Backspace':
        next = defaultValue;
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(clamp01(next));
  };

  const handleKeyUp = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Delete', 'Backspace'].includes(e.key)) {
      onCommit();
    }
  };

  const percent = Math.round(value * 100);
  const arcFrom = bipolar ? 0 : -KNOB_SWEEP / 2;
  const [dotX, dotY] = polar(23, angle);

  return (
    <div className={`flex flex-col items-center gap-1 transition-opacity duration-300 ${disabled ? 'pointer-events-none opacity-35' : ''}`}>
      <Silk className="text-ink-2">{label}</Silk>
      <div
        role="slider"
        tabIndex={0}
        aria-label={`${label} macro`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={secondary ? `${percent}% (${secondary})` : `${percent}%`}
        data-tip={tip ?? 'Drag up/down · Shift = fine · double-click resets.'}
        aria-disabled={disabled || undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        className={`group relative h-[84px] w-[84px] touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${dragging ? 'cursor-grabbing' : 'cursor-ns-resize'}`}
      >
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <defs>
            <radialGradient id={`${gid}-cap`} cx="40%" cy="28%" r="85%">
              <stop offset="0%" style={{ stopColor: 'var(--pf-knob-hi)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--pf-knob-lo)' }} />
            </radialGradient>
          </defs>

          {/* Track + value arc */}
          <path d={arcPath(44, -KNOB_SWEEP / 2, KNOB_SWEEP / 2)} fill="none" stroke="var(--pf-track)" strokeWidth="5" strokeLinecap="round" />
          <path
            d={arcPath(44, Math.min(arcFrom, angle), Math.max(arcFrom, angle))}
            fill="none"
            stroke={hex}
            strokeWidth="5"
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${hex}66)`, transition: dragging ? 'none' : 'd 120ms ease-out' }}
          />

          {/* Cap */}
          <circle
            cx="50"
            cy="50"
            r="32"
            fill={`url(#${gid}-cap)`}
            stroke="var(--pf-line-strong)"
            strokeWidth="0.8"
            className="origin-center transition-transform duration-200 ease-smooth group-hover:scale-[1.03]"
            style={{ filter: 'drop-shadow(0 6px 10px var(--pf-knob-shadow))', transformBox: 'fill-box' }}
          />
          <circle cx={dotX} cy={dotY} r="3.2" fill={hex} style={{ filter: `drop-shadow(0 0 3px ${hex})` }} />
        </svg>
      </div>
      <span className="font-mono text-[12.5px] font-medium tabular-nums text-ink">{percent}%</span>
      <span className="flex w-[88px] justify-between text-[9px] font-medium uppercase tracking-[0.08em] text-ink-3">
        <span>{minCaption}</span>
        <span>{maxCaption}</span>
      </span>
      <span className="h-3 font-mono text-[10px] tabular-nums text-ink-3">{secondary ?? ''}</span>
    </div>
  );
}

const polar = (r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return [50 + r * Math.sin(rad), 50 - r * Math.cos(rad)] as const;
};

/** SVG arc on the knob face between two angles (0° = 12 o'clock, clockwise). */
function arcPath(r: number, from: number, to: number): string {
  if (to - from < 0.5) return '';
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* XY morph pad                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

interface XYMorphPadProps {
  x: number;
  y: number;
  labels: SoundRecipe['axisLabels'];
  hex: string;
  onScrub: (x: number, y: number, phase: ScrubPhase) => void;
}

function XYMorphPad({ x, y, labels, hex, onScrub }: XYMorphPadProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const pointerRef = useRef<number | null>(null);
  const lastPointRef = useRef({ x, y });
  const [dragging, setDragging] = useState(false);

  const toMacro = (clientX: number, clientY: number) => {
    const el = surfaceRef.current;
    if (!el) return lastPointRef.current;
    const rect = el.getBoundingClientRect();
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01(1 - (clientY - rect.top) / rect.height),
    };
  };

  const pushTrail = (p: { x: number; y: number }, t = performance.now()) => {
    const trail = trailRef.current;
    trail.push({ x: p.x, y: p.y, t });
    if (trail.length > TRAIL_MAX_POINTS) trail.splice(0, trail.length - TRAIL_MAX_POINTS);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerRef.current = e.pointerId;
    setDragging(true);
    const p = toMacro(e.clientX, e.clientY);
    lastPointRef.current = p;
    pushTrail(p);
    onScrub(p.x, p.y, 'start');
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerRef.current !== e.pointerId) return;
    const native = e.nativeEvent;
    const samples = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const events = samples.length > 0 ? samples : [native];
    let p = lastPointRef.current;
    for (const ev of events) {
      p = toMacro(ev.clientX, ev.clientY);
      pushTrail(p);
    }
    lastPointRef.current = p;
    onScrub(p.x, p.y, 'move');
  };

  const handlePointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerRef.current !== e.pointerId) return;
    pointerRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // pointercancel carries unreliable coordinates; keep the last tracked point instead.
    const p = e.type === 'pointerup' ? toMacro(e.clientX, e.clientY) : lastPointRef.current;
    lastPointRef.current = p;
    onScrub(p.x, p.y, 'end');
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    let nx = x;
    let ny = y;
    if (e.key === 'ArrowLeft') nx -= step;
    else if (e.key === 'ArrowRight') nx += step;
    else if (e.key === 'ArrowUp') ny += step;
    else if (e.key === 'ArrowDown') ny -= step;
    else return;
    e.preventDefault();
    const p = { x: clamp01(nx), y: clamp01(ny) };
    lastPointRef.current = p;
    pushTrail(p);
    onScrub(p.x, p.y, 'move');
  };

  const handleKeyUp = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key.startsWith('Arrow')) onScrub(lastPointRef.current.x, lastPointRef.current.y, 'end');
  };

  useEffect(() => {
    if (pointerRef.current === null) lastPointRef.current = { x, y };
  }, [x, y]);

  // Decaying phosphor trail, drawn on its own canvas layer.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let w = 0;
    let h = 0;
    let raf = 0;
    let clean = true;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      clean = false;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const pts = trailRef.current;
      while (pts.length > 0 && now - (pts[0]?.t ?? now) > TRAIL_LIFETIME_MS) pts.shift();
      const head = pts[pts.length - 1];
      if (!head) {
        if (!clean) {
          ctx.clearRect(0, 0, w, h);
          clean = true;
        }
        return;
      }
      clean = false;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = hex;
      ctx.shadowColor = hex;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (!a || !b) continue;
        const life = 1 - (now - b.t) / TRAIL_LIFETIME_MS;
        if (life <= 0) continue;
        ctx.globalAlpha = life * 0.85;
        ctx.lineWidth = 1 + life * 5;
        ctx.shadowBlur = 14 * life;
        ctx.beginPath();
        ctx.moveTo(a.x * w, (1 - a.y) * h);
        ctx.lineTo(b.x * w, (1 - b.y) * h);
        ctx.stroke();
      }
      const headLife = 1 - (now - head.t) / TRAIL_LIFETIME_MS;
      ctx.globalAlpha = Math.max(0, headLife) * 0.5;
      ctx.shadowBlur = 0;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(head.x * w, (1 - head.y) * h, 3 + headLife * 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [hex]);

  const glide = dragging ? '' : 'transition-[left,top] duration-300 ease-smooth';
  const edge = 'truncate text-[10.5px] font-medium text-ink-2';

  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)_20px] grid-rows-[22px_auto_22px] gap-1.5">
      <div />
      <div className={`flex items-center justify-center ${edge}`}>{labels.yTop}</div>
      <div />

      <div className="flex items-center justify-center">
        <span className={`rotate-180 [writing-mode:vertical-rl] ${edge}`}>{labels.xLeft}</span>
      </div>

      <div
        ref={surfaceRef}
        role="application"
        tabIndex={0}
        aria-label={`XY morph pad. X ${labels.xLeft} to ${labels.xRight}, Y ${labels.yBottom} to ${labels.yTop}. Arrow keys to nudge.`}
        aria-valuetext={`X ${pct(x)}%, Y ${pct(y)}%`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        className={`relative aspect-square w-full touch-none overflow-hidden rounded-[20px] border border-line bg-inset bg-[linear-gradient(var(--pf-grid)_1px,transparent_1px),linear-gradient(90deg,var(--pf-grid)_1px,transparent_1px)] shadow-well outline-none [background-size:12.5%_12.5%] focus-visible:ring-2 focus-visible:ring-accent/50 ${dragging ? 'cursor-none' : 'cursor-crosshair'}`}
      >
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-line-strong" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-line-strong" />

        <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />

        <span
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 w-px ${glide}`}
          style={{ left: `${x * 100}%`, backgroundColor: `${hex}40` }}
        />
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 h-px ${glide}`}
          style={{ top: `${(1 - y) * 100}%`, backgroundColor: `${hex}40` }}
        />

        <span
          aria-hidden
          className={`pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 ${glide}`}
          style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%` }}
        >
          <span
            className={`block rounded-full border-[3px] bg-raised transition-all duration-300 ease-smooth ${dragging ? 'h-9 w-9' : 'h-7 w-7'}`}
            style={{ borderColor: hex, boxShadow: `0 0 0 6px ${hex}22, 0 0 24px ${hex}99, 0 4px 10px rgba(0,0,0,0.25)` }}
          />
        </span>

        <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full border border-line bg-panel/80 px-2 py-0.5 font-mono text-[10px] tabular-nums text-ink-2 backdrop-blur">
          {x.toFixed(2)} · {y.toFixed(2)}
        </span>
      </div>

      <div className="flex items-center justify-center">
        <span className={`[writing-mode:vertical-rl] ${edge}`}>{labels.xRight}</span>
      </div>

      <div />
      <div className={`flex items-center justify-center ${edge}`}>{labels.yBottom}</div>
      <div />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* OLED oscilloscope + spectrum                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function OledVisualizer({ signalLedRef }: { signalLedRef: RefObject<HTMLSpanElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const wave = new Uint8Array(WAVE_SIZE);
    const freq = new Uint8Array(FREQ_SIZE);
    const bars = new Float32Array(BAR_COUNT);
    const peaks = new Float32Array(BAR_COUNT);
    let w = 0;
    let h = 0;
    let raf = 0;
    let energy = 0;
    let lastFrame = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = HEX.oled;
      ctx.fillRect(0, 0, w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      // The scope is decorative. A 30 fps cap leaves more time for live audio on phones.
      if (now - lastFrame < 33) return;
      lastFrame = now;
      if (w === 0 || h === 0) return;

      wave.fill(128);
      freq.fill(0);
      try {
        soundEngine.getWaveformData(wave);
        soundEngine.getFrequencyData(freq);
      } catch {
        /* engine not booted until first user gesture — render silence */
      }

      // Phosphor persistence: partial clear leaves a decaying afterglow.
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(10,12,14,0.38)';
      ctx.fillRect(0, 0, w, h);

      // Graticule.
      ctx.fillStyle = 'rgba(16,185,129,0.07)';
      for (let gx = 1; gx < 10; gx++) ctx.fillRect(Math.round((gx * w) / 10), 0, 1, h);
      for (let gy = 1; gy < 8; gy++) ctx.fillRect(0, Math.round((gy * h) / 8), w, 1);

      // Signal level.
      let peak = 0;
      for (let i = 0; i < WAVE_SIZE; i++) {
        const d = Math.abs((wave[i] ?? 128) - 128);
        if (d > peak) peak = d;
      }
      energy = Math.max(peak / 128, energy * 0.9);

      // Spectrum bars (log-spaced) with falling peak caps.
      const gap = 2;
      const barW = Math.max(1, (w - gap * (BAR_COUNT - 1)) / BAR_COUNT);
      const barMaxH = h * 0.42;
      for (let i = 0; i < BAR_COUNT; i++) {
        let m = 0;
        const binEnd = Math.min(BAR_BINS.hi[i] ?? 0, FREQ_SIZE);
        for (let b = BAR_BINS.lo[i] ?? 0; b < binEnd; b++) m = Math.max(m, freq[b] ?? 0);
        const v = m / 255;
        const prevBar = bars[i] ?? 0;
        const bar = v > prevBar ? v : prevBar * 0.86;
        const prevPeak = peaks[i] ?? 0;
        const pk = bar > prevPeak ? bar : Math.max(0, prevPeak - 0.007);
        bars[i] = bar;
        peaks[i] = pk;
        const bx = i * (barW + gap);
        const bh = bar * barMaxH;
        if (bh > 0.5) {
          ctx.fillStyle = 'rgba(255,87,34,0.55)';
          ctx.fillRect(bx, h - bh, barW, bh);
        }
        if (pk > 0.01) {
          ctx.fillStyle = 'rgba(245,158,11,0.9)';
          ctx.fillRect(bx, h - pk * barMaxH - 2, barW, 1.5);
        }
      }

      // Oscilloscope with rising zero-crossing trigger for a stable trace.
      const span = WAVE_SIZE / 2;
      let start = 0;
      for (let i = 1; i < span; i++) {
        if ((wave[i - 1] ?? 128) < 128 && (wave[i] ?? 128) >= 128) {
          start = i;
          break;
        }
      }
      const mid = h * 0.42;
      const amp = h * 0.36;
      ctx.beginPath();
      for (let i = 0; i < span; i++) {
        const v = ((wave[start + i] ?? 128) - 128) / 128;
        const px = (i / (span - 1)) * w;
        const py = mid - v * amp;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.lineJoin = 'round';
      ctx.strokeStyle = HEX.mint;
      ctx.shadowColor = HEX.mint;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 4;
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.4;
      ctx.shadowBlur = 5;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Segment level meter.
      const segs = 12;
      const lit = Math.round(Math.min(1, energy * 1.4) * segs);
      for (let s = 0; s < segs; s++) {
        ctx.fillStyle =
          s < lit ? (s >= segs - 2 ? HEX.orange : s >= segs - 4 ? HEX.amber : HEX.mint) : 'rgba(16,185,129,0.12)';
        ctx.fillRect(w - 12 - (segs - s) * 6, 10, 4, 6);
      }

      if (energy < 0.01) {
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(16,185,129,0.4)';
        ctx.fillText('AWAITING TRIGGER  ·  [SPACE]', w / 2, mid - 16);
      }

      const led = signalLedRef.current;
      if (led) {
        const level = Math.min(1, energy * 1.6);
        led.style.opacity = String(0.18 + level * 0.82);
        led.style.boxShadow = level > 0.05 ? `0 0 ${4 + level * 8}px ${HEX.mint}` : 'none';
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [signalLedRef]);

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Studio                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-phosphor/40">{label}</span>
      <span className="truncate font-mono text-[12px] tabular-nums text-phosphor [text-shadow:0_0_8px_rgba(16,185,129,0.45)]">{value}</span>
    </div>
  );
}

function Studio({ initialRecipe }: { initialRecipe: SoundRecipe }) {
  const [themePref, setThemePref] = useThemePref();
  const [recipe, setRecipe] = useState<SoundRecipe>(initialRecipe);
  const [macros, setMacros] = useState<MacroValues>(() => ({ ...initialRecipe.defaultMacros }));
  const [mod, setMod] = useState<ModRouting>(() => ({ ...initialRecipe.defaultMod }));
  const [activeCategory, setActiveCategory] = useState<string>(initialRecipe.category);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [lengthFilter, setLengthFilter] = useState<LengthFilter>('any');
  const [liveScrub, setLiveScrub] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [triggerLit, setTriggerLit] = useState(false);
  const [keyHeld, setKeyHeld] = useState(false);
  const [pointerHeld, setPointerHeld] = useState(false);

  const recipeRef = useRef(recipe);
  const macrosRef = useRef(macros);
  const modRef = useRef(mod);
  const liveScrubRef = useRef(liveScrub);
  const exportingRef = useRef(false);
  const lastScrubRef = useRef(0);
  const ignoreHashRef = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);
  const signalLedRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    liveScrubRef.current = liveScrub;
  }, [liveScrub]);

  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const showToast = useCallback((text: string, tone: ToastTone = 'ok') => {
    window.clearTimeout(toastTimer.current);
    setToast({ key: Date.now(), text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const applyMacros = useCallback((next: MacroValues) => {
    macrosRef.current = next;
    setMacros(next);
    return next;
  }, []);

  const setMacro = useCallback(
    (key: MacroKey, value: number) => {
      const next = { ...macrosRef.current };
      next[key] = clamp01(value);
      return applyMacros(next);
    },
    [applyMacros],
  );

  const applyMod = useCallback((next: ModRouting) => {
    modRef.current = next;
    setMod(next);
    return next;
  }, []);

  /* ── Favourites ─────────────────────────────────────────────────────── */
  const [favourites, setFavourites] = useState<ReadonlySet<string>>(loadFavourites);
  const favouritesRef = useRef(favourites);

  const toggleFavourite = useCallback(
    (id: string) => {
      const next = new Set(favouritesRef.current);
      const adding = !next.has(id);
      if (adding) next.add(id);
      else next.delete(id);
      favouritesRef.current = next;
      setFavourites(next);
      try {
        localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Storage blocked — favourites still work for this visit.
      }
      showToast(adding ? '★ SAVED TO FAVOURITES' : 'REMOVED FROM FAVOURITES');
    },
    [showToast],
  );

  /* ── Trim and the render cache behind trimmed playback ──────────────── */
  // True while the pattern plays. Sounds never pile up: outside the pattern each new sound stops
  // the previous one, and while the pattern plays, edits are heard in the loop instead.
  const rollActive = useRef(false);
  const [trim, setTrimState] = useState<Trim>(FULL_TRIM);
  const trimRef = useRef(trim);
  const [trimFade, setTrimFade] = useState(0.015);
  const trimFadeRef = useRef(trimFade);
  const renderCache = useRef(new Map<string, Promise<AudioBuffer>>());
  const rendered = useRef(new Map<string, AudioBuffer>());

  useEffect(() => {
    trimFadeRef.current = trimFade;
  }, [trimFade]);

  const setTrim = useCallback((next: Trim) => {
    trimRef.current = next;
    setTrimState(next);
  }, []);

  /** Offline render of the current patch at a transposition, cached (LRU) for trimmed playback. */
  const getRender = useCallback((r: SoundRecipe, m: MacroValues, routing: ModRouting, semi = 0) => {
    const key = renderKey(r, m, routing, semi);
    let promise = renderCache.current.get(key);
    if (!promise) {
      promise = soundEngine.renderOffline(r, m, routing, semi ? [{ at: 0, semi }] : undefined).then((b) => {
        rendered.current.set(key, b);
        return b;
      });
      renderCache.current.set(key, promise);
      if (renderCache.current.size > RENDER_CACHE_SIZE) {
        const oldest = renderCache.current.keys().next().value;
        if (oldest !== undefined) {
          renderCache.current.delete(oldest);
          rendered.current.delete(oldest);
        }
      }
    }
    return { key, promise };
  }, []);

  const fire = useCallback(
    (
      m: MacroValues = macrosRef.current,
      r: SoundRecipe = recipeRef.current,
      routing: ModRouting = modRef.current,
    ) => {
      if (rollActive.current) return; // the running pattern plays the edited sound instead
      const t = trimRef.current;
      try {
        if (isTrimmed(t)) {
          // Trimmed sounds play from their offline render; until that render exists (e.g. mid-drag),
          // fall back to live synthesis cut to the same length.
          const buffer = rendered.current.get(renderKey(r, m, routing, 0));
          if (buffer) {
            const region = trimRegion(t, buffer.duration);
            soundEngine.playBuffer({ buffer, at: 0, ...region }, { choke: true, fadeOut: trimFadeRef.current });
          } else {
            soundEngine.play(r, m, routing, { choke: true, gate: t.end === null ? undefined : t.end - t.start });
          }
        } else {
          soundEngine.play(r, m, routing, { choke: true });
        }
      } catch {
        showToast('ENGINE FAULT · CHECK AUDIO OUTPUT', 'error');
        return;
      }
      setTriggerLit(true);
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setTriggerLit(false), TRIGGER_FLASH_MS);
    },
    [showToast],
  );

  const selectRecipe = useCallback(
    (r: SoundRecipe, opts: { play?: boolean; macros?: MacroValues; mod?: ModRouting } = {}) => {
      recipeRef.current = r;
      setRecipe(r);
      setTrim(FULL_TRIM);
      const m = applyMacros(opts.macros ?? { ...r.defaultMacros });
      const routing = applyMod(opts.mod ?? { ...r.defaultMod });
      if (opts.play) fire(m, r, routing);
    },
    [applyMacros, applyMod, fire, setTrim],
  );

  const changeMod = useCallback(
    (patch: Partial<ModRouting>) => {
      const routing = applyMod({ ...modRef.current, ...patch });
      // Picking an LFO shape or target with depth at zero would be inaudible — open it up a little.
      const wantsLfo = patch.shape !== undefined || patch.target !== undefined;
      const m =
        wantsLfo && macrosRef.current.modDepth < 0.05 ? applyMacros({ ...macrosRef.current, modDepth: 0.35 }) : macrosRef.current;
      fire(m, recipeRef.current, routing);
    },
    [applyMacros, applyMod, fire],
  );

  const mutate = useCallback(() => {
    const next = sanitizeMacros(mutateMacros(macrosRef.current), macrosRef.current);
    applyMacros(next);
    fire(next);
  }, [applyMacros, fire]);

  const reset = useCallback(() => {
    applyMacros({ ...recipeRef.current.defaultMacros });
    applyMod({ ...recipeRef.current.defaultMod });
    showToast('MACROS RESET · PRESET DEFAULT');
  }, [applyMacros, applyMod, showToast]);

  const share = useCallback(async () => {
    try {
      const roll = rollState.current;
      const pattern = {
        bpm: roll.bpm,
        steps: roll.beats,
        div: roll.activeDiv,
        cells: roll.rollSteps.slice(0, roll.beats * roll.activeDiv),
      } as const;
      const encoded = encodeStateToHash(recipeRef.current.id, macrosRef.current, modRef.current, pattern).replace(/^#/, '');
      if (window.location.hash.replace(/^#/, '') !== encoded) {
        ignoreHashRef.current = true;
        window.location.hash = encoded;
      }
      const ok = await copyText(window.location.href);
      showToast(ok ? 'LINK COPIED TO CLIPBOARD' : 'LINK SAVED TO ADDRESS BAR', ok ? 'ok' : 'warn');
    } catch {
      showToast('SHARE FAILED', 'error');
    }
  }, [showToast]);

  const forge = useCallback(async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    const r = recipeRef.current;
    const m = macrosRef.current;
    const routing = modRef.current;
    try {
      const t = trimRef.current;
      const job = isTrimmed(t)
        ? getRender(r, m, routing).promise.then(async (b) => {
            const trimmed = await soundEngine.renderBufferHits([{ buffer: b, at: 0, ...trimRegion(t, b.duration) }], trimFadeRef.current);
            soundEngine.downloadWav(trimmed, `${r.name} trim`);
          })
        : soundEngine.exportWav(r, m, routing);
      await Promise.all([job, wait(MIN_RENDER_INDICATOR_MS)]);
      showToast(`WAV FORGED · ${r.name.toUpperCase()}${isTrimmed(t) ? ' · TRIMMED' : ''}`);
    } catch {
      showToast('EXPORT FAILED · RETRY', 'error');
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [showToast]);

  const toggleLive = useCallback(() => setLiveScrub((v) => !v), []);

  /* ── Pattern: up to three tracks, each with its own sound and notes ───── */
  const [tracks, setTracks] = useState<Track[]>(() => defaultTracks(initialRecipe));
  const [activeTrack, setActiveTrack] = useState(0);
  const activeTrackRef = useRef(0);
  const [beats, setBeats] = useState<RollBeats>(4);
  const [bpm, setBpm] = useState(120);
  const [loopRoll, setLoopRoll] = useState(false);
  const [lengthMode, setLengthMode] = useState<LengthMode>('fit');
  const [rollPlaying, setRollPlaying] = useState(false);
  const [rollStep, setRollStep] = useState<number | null>(null);
  const [rollExporting, setRollExporting] = useState(false);
  const rollSteps = tracks[activeTrack]?.steps ?? EMPTY_STEPS;
  const activeDiv: StepDiv = tracks[activeTrack]?.div ?? 1;
  const rollState = useRef({ tracks, rollSteps, activeDiv, beats, bpm, loopRoll, lengthMode });
  const rollTimers = useRef(new Set<number>());
  const rollToken = useRef(0);
  const playRollRef = useRef<(replace?: boolean, startAt?: number) => Promise<void>>(async () => {});

  useEffect(() => {
    rollState.current = { tracks, rollSteps, activeDiv, beats, bpm, loopRoll, lengthMode };
  }, [tracks, rollSteps, activeDiv, beats, bpm, loopRoll, lengthMode]);

  /** Updates the notes of the selected track. */
  const setRollSteps = useCallback((next: number[][] | ((prev: number[][]) => number[][])) => {
    setTracks((all) =>
      all.map((t, i) => (i === activeTrackRef.current ? { ...t, steps: typeof next === 'function' ? next(t.steps) : next } : t)),
    );
  }, []);

  /** Changes the selected track's grid (1/4, 1/8, 1/16); its notes keep their timing. */
  const setTrackDiv = useCallback((div: StepDiv) => {
    setTracks((all) =>
      all.map((t, i) => (i === activeTrackRef.current && t.div !== div ? { ...t, div, steps: regrid(t.steps, t.div, div) } : t)),
    );
  }, []);

  // The editor (preset, knobs, routing, trim) always edits the selected track's sound.
  useEffect(() => {
    setTracks((all) => all.map((t, i) => (i === activeTrackRef.current ? { ...t, recipe, macros, mod, trim } : t)));
  }, [recipe, macros, mod, trim]);

  const clearRollTimers = useCallback(() => {
    for (const id of rollTimers.current) window.clearTimeout(id);
    rollTimers.current.clear();
  }, []);

  const queueRollTimer = useCallback((action: () => void, delayMs: number) => {
    const id = window.setTimeout(() => {
      rollTimers.current.delete(id);
      action();
    }, Math.max(0, delayMs));
    rollTimers.current.add(id);
  }, []);

  const stopRoll = useCallback(() => {
    rollToken.current++;
    rollActive.current = false;
    clearRollTimers();
    setRollStep(null);
    setRollPlaying(false);
    soundEngine.stopAll();
  }, [clearRollTimers]);

  /**
   * Turns every unmuted track into a mix part.
   * - Natural: each sound plays its full length.
   * - Cut: each note stops at the end of its step.
   * - Fit: each note is sized (via SPEED) to end exactly where that track's next note starts.
   * In Cut and Fit, built-in beats are locked to the pattern BPM. Trimmed tracks play from cached
   * offline renders (one per distinct pitch) instead of live synthesis.
   */
  const buildMix = useCallback(async (): Promise<{ loopSec: number; parts: MixPart[] } | null> => {
    const { tracks: all, beats: loopBeats, bpm: tempo, lengthMode: mode } = rollState.current;
    const beatSec = 60 / tempo;
    const cellsOf = (t: Track) => t.steps.slice(0, loopBeats * t.div);
    const playing = all.filter((t) => !t.muted && cellsOf(t).some((c) => c.length > 0));
    if (playing.length === 0) return null;
    const level = Math.min(1, 1.2 / Math.sqrt(playing.length));

    const parts: MixPart[] = [];
    for (const track of playing) {
      const cells = cellsOf(track);
      const count = cells.length;
      const stepSec = beatSec / track.div;
      const starts = cells.flatMap((c, i) => (c.length ? [i] : []));
      const tempoScale = mode !== 'natural' && track.recipe.bpm ? track.recipe.bpm / tempo : undefined;
      const notes: PatternNote[] = starts.flatMap((i, k) => {
        const len = mode === 'natural' ? undefined : mode === 'cut' ? stepSec : ((starts[k + 1] ?? count) - i) * stepSec;
        return (cells[i] ?? []).map((semi) => ({ at: i * stepSec, semi, len, fit: mode === 'fit' && !track.recipe.bpm, tempoScale }));
      });

      if (!isTrimmed(track.trim)) {
        parts.push({ kind: 'synth', recipe: track.recipe, macros: track.macros, mod: track.mod, notes, level });
        continue;
      }
      const semis = [...new Set(notes.map((n) => n.semi))];
      if (semis.some((s) => !rendered.current.has(renderKey(track.recipe, track.macros, track.mod, s)))) {
        showToast('RENDERING TRIMMED TRACK…');
      }
      const buffers = new Map(
        await Promise.all(semis.map(async (s) => [s, await getRender(track.recipe, track.macros, track.mod, s).promise] as const)),
      );
      const hits = notes.flatMap((n): BufferHit[] => {
        const buffer = buffers.get(n.semi);
        if (!buffer) return [];
        const region = trimRegion(track.trim, buffer.duration);
        const together = notes.filter((o) => Math.abs(o.at - n.at) < 0.001).length;
        return [{ buffer, at: n.at, start: region.start, len: n.len ? Math.min(region.len, n.len) : region.len, level: 1 / Math.sqrt(together) }];
      });
      parts.push({ kind: 'buffer', hits, fadeOut: trimFadeRef.current, level });
    }
    return { loopSec: loopBeats * beatSec, parts };
  }, [getRender, showToast]);

  const playRoll = useCallback(
    async (replace = true, startAt?: number) => {
      const token = ++rollToken.current;
      rollActive.current = true;
      let plan: Awaited<ReturnType<typeof buildMix>>;
      try {
        plan = await buildMix();
      } catch {
        plan = null;
      }
      if (token !== rollToken.current) return; // stopped while rendering
      if (!plan) {
        rollActive.current = false;
        showToast('PATTERN EMPTY · CLICK THE GRID', 'warn');
        return;
      }
      const { loopSec } = plan;
      if (replace) clearRollTimers();
      let origin: number;
      try {
        origin = soundEngine.playMix(plan.parts, replace, startAt);
      } catch {
        rollActive.current = false;
        showToast('ENGINE FAULT · CHECK AUDIO OUTPUT', 'error');
        return;
      }
      setRollPlaying(true);
      const ticks = rollState.current.beats * 4;
      const toMs = (at: number) => (at - soundEngine.audioTime()) * 1000;
      for (let i = 0; i < ticks; i++) {
        queueRollTimer(() => setRollStep(i), toMs(origin + (i * loopSec) / ticks));
      }
      // Prepare the next bar before this one ends. Audio nodes then start on the audio clock,
      // even if React or the browser delays a visual update near the bar line.
      queueRollTimer(() => {
        if (rollState.current.loopRoll) {
          void playRollRef.current(false, origin + loopSec);
        } else {
          queueRollTimer(() => {
            if (token !== rollToken.current) return;
            rollActive.current = false;
            setRollStep(null);
            setRollPlaying(false);
          }, toMs(origin + loopSec));
        }
      }, toMs(origin + loopSec - Math.min(0.35, loopSec / 4)));
    },
    [buildMix, clearRollTimers, queueRollTimer, showToast],
  );

  useEffect(() => {
    playRollRef.current = playRoll;
  }, [playRoll]);

  useEffect(() => () => clearRollTimers(), [clearRollTimers]);

  /** The Play button and Space: always heard on its own, so a running pattern stops first. */
  const playNow = useCallback(() => {
    if (rollActive.current) stopRoll();
    fire();
  }, [fire, stopRoll]);

  const toggleRoll = useCallback(() => {
    if (rollActive.current) stopRoll();
    else void playRoll();
  }, [playRoll, stopRoll]);

  const toggleCell = useCallback(
    (step: number, semi: number) => {
      const current = rollState.current.rollSteps[step] ?? [];
      const adding = !current.includes(semi);
      const nextCell = adding ? [...current, semi].slice(-ROLL_MAX_NOTES) : current.filter((s) => s !== semi);
      if (adding && current.length >= ROLL_MAX_NOTES) showToast(`MAX ${ROLL_MAX_NOTES} NOTES PER STEP`, 'warn');
      setRollSteps((prev) => prev.map((cell, i) => (i === step ? nextCell : cell)));
      if (!adding || rollActive.current) return;
      // Audition the note exactly as the pattern will play it (trimmed when a trim is set).
      const r = recipeRef.current;
      const m = macrosRef.current;
      const routing = modRef.current;
      const t = trimRef.current;
      try {
        const buffer = isTrimmed(t) ? rendered.current.get(renderKey(r, m, routing, semi)) : undefined;
        if (buffer) {
          soundEngine.playBuffer({ buffer, at: 0, ...trimRegion(t, buffer.duration) }, { choke: true, fadeOut: trimFadeRef.current });
        } else {
          soundEngine.play(r, m, routing, { choke: true, semi, gate: t.end === null ? undefined : t.end - t.start });
          if (isTrimmed(t)) void getRender(r, m, routing, semi).promise;
        }
      } catch {
        showToast('ENGINE FAULT · CHECK AUDIO OUTPUT', 'error');
      }
    },
    [getRender, showToast],
  );

  const forgeRoll = useCallback(async () => {
    if (exportingRef.current) return;
    if (rollActive.current) stopRoll();
    exportingRef.current = true;
    setRollExporting(true);
    try {
      const plan = await buildMix();
      if (!plan) {
        showToast('PATTERN EMPTY · CLICK THE GRID', 'warn');
        return;
      }
      const job = soundEngine.renderMix(plan.parts).then((b) => soundEngine.downloadWav(b, 'pattern'));
      await Promise.all([job, wait(MIN_RENDER_INDICATOR_MS)]);
      showToast('PATTERN EXPORTED · ALL TRACKS');
    } catch {
      showToast('EXPORT FAILED · RETRY', 'error');
    } finally {
      exportingRef.current = false;
      setRollExporting(false);
    }
  }, [buildMix, showToast, stopRoll]);

  /** Selects a track; its sound is loaded into the editor so knobs and Library now change it. */
  const selectTrack = useCallback(
    (i: number) => {
      const track = rollState.current.tracks[i];
      if (!track || i === activeTrackRef.current) return;
      activeTrackRef.current = i;
      setActiveTrack(i);
      selectRecipe(track.recipe, { macros: track.macros, mod: track.mod });
      setTrim(track.trim);
      setActiveCategory(track.recipe.category);
    },
    [selectRecipe, setTrim],
  );

  const toggleMute = useCallback((i: number) => {
    setTracks((all) => all.map((t, k) => (k === i ? { ...t, muted: !t.muted } : t)));
  }, []);

  /* ── Waveform for the trim editor (debounced so knob drags don't queue renders) ── */
  const [waveBuffer, setWaveBuffer] = useState<AudioBuffer | null>(null);
  const waveKeyRef = useRef('');
  useEffect(() => {
    const key = renderKey(recipe, macros, mod, 0);
    waveKeyRef.current = key;
    const cached = rendered.current.get(key);
    if (cached) {
      setWaveBuffer(cached);
      return;
    }
    const id = window.setTimeout(() => {
      getRender(recipe, macros, mod)
        .promise.then((b) => {
          if (waveKeyRef.current === key) setWaveBuffer(b);
        })
        .catch(() => undefined);
    }, 220);
    return () => window.clearTimeout(id);
  }, [recipe, macros, mod, getRender]);

  const auditionTrim = useCallback(() => fire(), [fire]);

  /* ── Search ─────────────────────────────────────────────────────── */
  const [query, setQuery] = useState('');
  const [showAllPresets, setShowAllPresets] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const handleScrub = useCallback(
    (x: number, y: number, phase: ScrubPhase) => {
      const next = applyMacros({ ...macrosRef.current, x, y });
      if (liveScrubRef.current) {
        const now = performance.now();
        if (phase === 'start' || (phase === 'move' && now - lastScrubRef.current >= SCRUB_THROTTLE_MS)) {
          lastScrubRef.current = now;
          // While dragging, each new hit replaces the previous one instead of piling up.
          fire(next);
        }
      } else if (phase === 'end') {
        fire(next);
      }
    },
    [applyMacros, fire],
  );

  // Restore patch from URL hash on mount and whenever the hash changes externally.
  useEffect(() => {
    const apply = (announce: boolean) => {
      if (ignoreHashRef.current) {
        ignoreHashRef.current = false;
        return;
      }
      const state = readHashState();
      if (!state) return;
      const samePatch =
        state.recipe.id === recipeRef.current.id &&
        macrosEqual(state.macros, macrosRef.current) &&
        state.mod.shape === modRef.current.shape &&
        state.mod.target === modRef.current.target &&
        state.mod.filter === modRef.current.filter;
      const roll = rollState.current;
      const pattern = state.pattern;
      const samePattern =
        !pattern ||
        (pattern.bpm === roll.bpm &&
          pattern.steps === roll.beats &&
          pattern.div === roll.activeDiv &&
          JSON.stringify(pattern.cells) === JSON.stringify(roll.rollSteps));
      if (samePatch && samePattern) return;

      if (!samePatch) {
        selectRecipe(state.recipe, { macros: state.macros, mod: state.mod });
        setActiveCategory(state.recipe.category);
      }
      if (pattern && !samePattern) {
        stopRoll();
        const div = (STEP_DIVISIONS.find((d) => d.div === pattern.div)?.div ?? 1) as StepDiv;
        setTracks((all) => all.map((t, i) => (i === activeTrackRef.current ? { ...t, div, steps: padSteps(pattern.cells) } : t)));
        setBeats(pattern.steps === 8 ? 8 : 4);
        setBpm(pattern.bpm);
      }
      if (announce) showToast(pattern ? 'PATCH + PATTERN LOADED · PRESS P' : 'PATCH LOADED FROM LINK');
    };
    apply(true);
    const onHashChange = () => apply(true);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [selectRecipe, showToast, stopRoll]);

  /* ── Undo / redo ────────────────────────────────────────────────────── */
  const historyRef = useRef<{ past: Snapshot[]; future: Snapshot[]; current: Snapshot | null; key: string }>({
    past: [],
    future: [],
    current: null,
    key: '',
  });
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });

  const syncHistory = useCallback(() => {
    const h = historyRef.current;
    setHistory({ canUndo: h.past.length > 0, canRedo: h.future.length > 0 });
  }, []);

  const record = useCallback(
    (snap: Snapshot) => {
      const h = historyRef.current;
      const key = snapshotKey(snap);
      if (key === h.key) return;
      if (h.current) {
        h.past.push(h.current);
        if (h.past.length > HISTORY_LIMIT) h.past.shift();
      }
      h.future = [];
      h.current = snap;
      h.key = key;
      syncHistory();
    },
    [syncHistory],
  );

  const pendingSnap = useRef<Snapshot | null>(null);
  useEffect(() => {
    const snap = { recipe, macros, mod, trim, tracks, activeTrack };
    pendingSnap.current = snap;
    const id = window.setTimeout(() => {
      pendingSnap.current = null;
      record(snap);
    }, HISTORY_SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [record, recipe, macros, mod, trim, tracks, activeTrack]);

  // A new click or key press starts a new step: settle whatever is still pending first, so two
  // quick actions stay two undo steps. A knob drag is one pointerdown, so it stays one step.
  useEffect(() => {
    const flush = () => {
      const snap = pendingSnap.current;
      if (!snap) return;
      pendingSnap.current = null;
      record(snap);
    };
    window.addEventListener('pointerdown', flush, true);
    window.addEventListener('keydown', flush, true);
    return () => {
      window.removeEventListener('pointerdown', flush, true);
      window.removeEventListener('keydown', flush, true);
    };
  }, [record]);

  const restore = useCallback(
    (snap: Snapshot) => {
      const h = historyRef.current;
      h.current = snap;
      h.key = snapshotKey(snap);
      activeTrackRef.current = snap.activeTrack;
      setActiveTrack(snap.activeTrack);
      recipeRef.current = snap.recipe;
      setRecipe(snap.recipe);
      applyMacros(snap.macros);
      applyMod(snap.mod);
      setTrim(snap.trim);
      setTracks(snap.tracks);
      syncHistory();
    },
    [applyMacros, applyMod, setTrim, syncHistory],
  );

  /** Steps through history; a change made in the last moment is recorded first so it isn't lost. */
  const stepHistory = useCallback(
    (dir: 'undo' | 'redo') => {
      record({
        recipe: recipeRef.current,
        macros: macrosRef.current,
        mod: modRef.current,
        trim: trimRef.current,
        tracks: rollState.current.tracks,
        activeTrack: activeTrackRef.current,
      });
      const h = historyRef.current;
      const target = dir === 'undo' ? h.past.pop() : h.future.pop();
      if (!target || !h.current) {
        showToast(dir === 'undo' ? 'NOTHING TO UNDO' : 'NOTHING TO REDO', 'warn');
        return;
      }
      (dir === 'undo' ? h.future : h.past).push(h.current);
      restore(target);
      showToast(dir === 'undo' ? 'UNDO' : 'REDO');
    },
    [record, restore, showToast],
  );
  const undo = useCallback(() => stepHistory('undo'), [stepHistory]);
  const redo = useCallback(() => stepHistory('redo'), [stepHistory]);
  const favouriteCurrent = useCallback(() => toggleFavourite(recipeRef.current.id), [toggleFavourite]);

  // Global hardware shortcuts.
  const actionsRef = useRef({ playNow, mutate, forge, toggleLive, toggleRoll, undo, redo, favouriteCurrent });
  useEffect(() => {
    actionsRef.current = { playNow, mutate, forge, toggleLive, toggleRoll, undo, redo, favouriteCurrent };
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !isTypingTarget(e.target)) {
        // Latin letter if the layout gives one (QWERTZ, AZERTY…), else the physical key (Cyrillic).
        const letter = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : '';
        if (letter === 'z' || letter === 'y') {
          e.preventDefault();
          if (letter === 'y' || e.shiftKey) actionsRef.current.redo();
          else actionsRef.current.undo();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      // Match the character too: "/" sits on different physical keys across keyboard layouts.
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          setKeyHeld(true);
          if (!e.repeat) actionsRef.current.playNow();
          break;
        case 'KeyR':
          if (!e.repeat) actionsRef.current.mutate();
          break;
        case 'KeyE':
          if (!e.repeat) void actionsRef.current.forge();
          break;
        case 'KeyL':
          if (!e.repeat) actionsRef.current.toggleLive();
          break;
        case 'KeyP':
          if (!e.repeat) actionsRef.current.toggleRoll();
          break;
        case 'KeyF':
          if (!e.repeat) actionsRef.current.favouriteCurrent();
          break;
        case 'Slash':
          e.preventDefault();
          searchRef.current?.focus();
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (!isTypingTarget(e.target)) e.preventDefault();
      setKeyHeld(false);
    };
    const onBlur = () => setKeyHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const searching = query.trim().length > 0;
  const visiblePresets = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    // Match at word starts so "ding" finds dings, not "landing" or "building".
    const patterns = terms.map((t) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    return PRESETS_CATALOG.filter((r) => {
      if (terms.length === 0) {
        if (activeCategory === FAV_BANK) {
          if (!favourites.has(r.id)) return false;
        } else if (activeCategory !== ALL_BANK && r.category !== activeCategory) return false;
      }
      const traits = SOUND_TRAITS.get(r.id);
      if (kindFilter !== 'all' && traits?.kind !== kindFilter) return false;
      if (lengthFilter !== 'any' && traits?.length !== lengthFilter) return false;
      if (terms.length === 0) return true;
      const haystack = [r.name, r.tag, r.category, r.description, r.topology, ...(r.keywords ?? [])].join(' ').toLowerCase();
      return patterns.every((p) => p.test(haystack));
    });
  }, [activeCategory, favourites, kindFilter, lengthFilter, query]);
  const displayedPresets = showAllPresets ? visiblePresets : visiblePresets.slice(0, 8);
  const activeTracks = tracks.filter((t) => !t.muted && t.steps.slice(0, beats * t.div).some((cell) => cell.length > 0)).length;
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of PRESETS_CATALOG) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return counts;
  }, []);

  const topo = topologyMeta(recipe.topology);
  const bank = categoryMeta(recipe.category);
  const presetIndex = (CATALOG_INDEX.get(recipe.id) ?? 0) + 1;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const triggerPressed = keyHeld || pointerHeld;

  const renderKnob = (k: KnobDef, disabled = false) => (
    <RotaryKnob
      key={k.key}
      tip={k.tip}
      disabled={disabled}
      label={k.label}
      value={macros[k.key]}
      defaultValue={recipe.defaultMacros[k.key]}
      hex={k.hex}
      minCaption={k.minCaption}
      maxCaption={k.maxCaption}
      bipolar={k.bipolar}
      secondary={k.secondary?.(macros[k.key])}
      onChange={(v) => setMacro(k.key, v)}
      onCommit={() => fire()}
    />
  );

  return (
    <div className="min-h-screen w-full bg-page px-2.5 py-3 text-ink-2 antialiased transition-colors duration-300 sm:px-6 sm:py-10">
      <div className="relative mx-auto max-w-6xl select-none">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1 sm:mb-6 sm:gap-4">
          <div className="flex items-center gap-3.5">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-[14px] bg-accent text-accent-ink shadow-glow">
              <svg viewBox="0 0 24 24" aria-hidden className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M3 12h2.5l2-5 3 10 3-14 3 12 2-3H21" />
              </svg>
            </div>
            <div>
              <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-ink">PocketFoley</h1>
              <p className="text-[12.5px] text-ink-3">
                Sound effects studio · {PRESETS_CATALOG.length} sounds · <span className="font-medium text-ink-2">by VV Labs</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <InstallButton onHint={(text) => showToast(text, 'warn')} />
            <div className="flex items-center gap-3 rounded-full border border-line bg-panel px-3.5 py-2 shadow-raised">
              <span className="flex items-center gap-1.5" data-tip="Lights up while sound is playing.">
                <span
                  ref={signalLedRef}
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: HEX.mint, opacity: 0.18 }}
                />
                <Silk>Signal</Silk>
              </span>
              <span className="flex items-center gap-1.5" data-tip="Lights up while the pattern plays.">
                <Led hex={HEX.orange} on={rollPlaying} pulse={rollPlaying} />
                <Silk>Pattern</Silk>
              </span>
              <span className="flex items-center gap-1.5" data-tip="Blinks while a WAV file is being rendered.">
                <Led hex={HEX.amber} on={exporting || rollExporting} pulse={exporting || rollExporting} />
                <Silk>Export</Silk>
              </span>
            </div>
            <div className="flex items-center gap-0.5 rounded-full border border-line bg-inset p-0.5 shadow-well">
              {(
                [
                  ['Undo', 'Undo the last change (Ctrl+Z)', history.canUndo, undo, ''],
                  ['Redo', 'Redo what you undid (Ctrl+Y)', history.canRedo, redo, '-scale-x-100'],
                ] as const
              ).map(([label, tip, enabled, onClick, flip]) => (
                <button
                  key={label}
                  type="button"
                  aria-label={label}
                  {...tipAttrs(tip)}
                  disabled={!enabled}
                  onClick={onClick}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-ink-2 outline-none transition-all duration-200 ease-smooth hover:bg-raised hover:text-ink hover:shadow-raised focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-90 disabled:pointer-events-none disabled:opacity-30"
                >
                  <IconUndo className={`h-3.5 w-3.5 ${flip}`} />
                </button>
              ))}
            </div>
            <ThemeToggle pref={themePref} onChange={setThemePref} />
          </div>
        </header>

        <main className="flex flex-col">

        {/* ── Preset matrix ──────────────────────────────────────────── */}
        <Panel
          className="mt-3 sm:mt-4"
          title="Library"
          right={
            <label className="relative flex items-center">
              <span className="sr-only">Search sounds</span>
              <svg {...iconProps} className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-ink-3">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m20 20-4.2-4.2" />
              </svg>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setQuery('');
                    e.currentTarget.blur();
                  }
                }}
                placeholder={`Search ${PRESETS_CATALOG.length} sounds`}
                className="h-9 w-[min(76vw,18rem)] rounded-full border border-line bg-inset pl-9 pr-9 text-[12.5px] text-ink shadow-well outline-none transition-all duration-200 ease-smooth placeholder:text-ink-3 focus:border-accent/50 focus:ring-4 focus:ring-accent/10 sm:w-64 sm:focus:w-72"
              />
              <span className="pointer-events-none absolute right-2.5">
                <Kbd>/</Kbd>
              </span>
            </label>
          }
        >
          <div role="tablist" aria-label="Sound banks" className="mb-3 flex flex-nowrap gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
            {[ALL_BANK, FAV_BANK, ...CATEGORY_LIST].map((cat) => {
              const meta = categoryMeta(cat);
              const active = !searching && cat === activeCategory;
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-tip={CATEGORY_TIPS[cat]}
                  onClick={() => {
                    setQuery('');
                    setActiveCategory(cat);
                  }}
                  className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium outline-none transition-all duration-200 ease-smooth focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97] ${
                    active
                      ? 'border-transparent bg-ink text-page shadow-raised'
                      : 'border-line bg-raised text-ink-2 shadow-raised hover:border-line-strong hover:text-ink'
                  }`}
                >
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.hex }} />
                  {cat}
                  <span className={`font-mono text-[10.5px] tabular-nums ${active ? 'opacity-60' : 'text-ink-3'}`}>
                    {cat === ALL_BANK ? PRESETS_CATALOG.length : cat === FAV_BANK ? favourites.size : (categoryCounts.get(cat) ?? 0)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <FilterChips label="kind" options={KIND_FILTERS} value={kindFilter} onChange={setKindFilter} />
            <FilterChips label="length" options={LENGTH_FILTERS} value={lengthFilter} onChange={setLengthFilter} />
          </div>

          <div role="tabpanel" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {searching && visiblePresets.length > 0 && (
              <div className="col-span-full text-[12px] text-ink-3">
                {visiblePresets.length} result{visiblePresets.length === 1 ? '' : 's'} for “{query.trim()}” · Esc to clear
              </div>
            )}
            {visiblePresets.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-line-strong py-10 text-center text-[12.5px] text-ink-3">
                {searching
                  ? `No sounds match “${query.trim()}”`
                  : activeCategory === FAV_BANK && favourites.size === 0
                    ? 'No favourites yet — tap the ☆ on any sound to keep it here.'
                    : 'No sounds match these filters'}
              </div>
            )}
            {displayedPresets.map((r) => {
              const selected = r.id === recipe.id;
              const meta = topologyMeta(r.topology);
              const fav = favourites.has(r.id);
              return (
                <div key={r.id} className="group/card relative">
                <button
                  type="button"
                  aria-pressed={selected}
                  data-tip={r.description}
                  onClick={() => selectRecipe(r, { play: true })}
                  className={`group relative flex h-full min-h-[92px] w-full flex-col justify-between gap-2.5 rounded-2xl border p-3.5 text-left outline-none transition-all duration-200 ease-smooth focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.98] ${
                    selected
                      ? 'border-accent/60 bg-raised shadow-[0_0_0_3px_color-mix(in_oklab,var(--pf-accent)_18%,transparent),var(--pf-shadow-raised)]'
                      : 'border-line bg-raised shadow-raised hover:-translate-y-0.5 hover:border-line-strong'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-mono text-[9.5px] text-ink-3">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.hex }} />
                      {meta.code}
                    </span>
                    {selected ? (
                      <span className="flex h-4 items-center gap-1 rounded-full bg-accent px-1.5 text-[9px] font-semibold text-accent-ink">
                        <IconPlay className="h-2 w-2" />
                        On
                      </span>
                    ) : (
                      <span className="font-mono text-[9.5px] tabular-nums text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">
                        {pad2((CATALOG_INDEX.get(r.id) ?? 0) + 1)}
                      </span>
                    )}
                  </span>
                  <span className="text-[13px] font-semibold leading-snug tracking-[-0.01em] text-ink">{r.name}</span>
                  <span className="truncate pr-7 text-[11.5px] text-ink-3">{r.tag}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={fav}
                  aria-label={fav ? `Remove ${r.name} from favourites` : `Add ${r.name} to favourites`}
                  data-tip={fav ? 'Remove from favourites.' : 'Save to favourites.'}
                  onClick={() => toggleFavourite(r.id)}
                  className={`absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full outline-none transition-all duration-200 ease-smooth hover:bg-inset focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-90 ${
                    fav ? 'text-[#F59E0B]' : 'text-ink-3 opacity-40 hover:text-ink group-hover/card:opacity-100'
                  }`}
                >
                  <IconStar filled={fav} className="h-3.5 w-3.5" />
                </button>
                </div>
              );
            })}
          </div>
          {visiblePresets.length > displayedPresets.length && (
            <button type="button" onClick={() => setShowAllPresets(true)} className="mt-3 w-full rounded-full bg-raised px-4 py-2.5 text-[12.5px] font-semibold text-ink shadow-raised focus-visible:outline-2 focus-visible:outline-accent">
              Show all {visiblePresets.length} sounds
            </button>
          )}
          {showAllPresets && visiblePresets.length > 8 && (
            <button type="button" onClick={() => setShowAllPresets(false)} className="mt-3 w-full rounded-full px-4 py-2 text-[12px] text-ink-2 underline underline-offset-2">
              Show fewer sounds
            </button>
          )}
        </Panel>

        {/* ── Display + XY pad ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className="relative flex min-h-[250px] flex-col rounded-[26px] bg-[#141518] p-2 shadow-panel ring-1 ring-black/20 sm:min-h-[380px]">
            <div className="relative flex flex-1 flex-col overflow-hidden rounded-[20px] bg-display shadow-[inset_0_2px_14px_rgba(0,0,0,0.9)]">
              <div className="relative z-10 flex items-center justify-between gap-3 px-4 pb-2 pt-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-mono text-[10px] tabular-nums text-phosphor/55">
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: bank.hex }} />
                    <span>{recipe.category}</span>
                    <span className="text-phosphor/30">·</span>
                    <span>
                      {pad2(presetIndex)}/{pad2(PRESETS_CATALOG.length)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[17px] font-semibold tracking-[-0.01em] text-phosphor [text-shadow:0_0_14px_rgba(16,185,129,0.45)]">
                    {recipe.name}
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    aria-pressed={favourites.has(recipe.id)}
                    aria-label={favourites.has(recipe.id) ? 'Remove from favourites' : 'Add to favourites'}
                    {...tipAttrs(favourites.has(recipe.id) ? 'Remove this sound from your favourites (F)' : 'Save this sound to your favourites (F)')}
                    onClick={() => toggleFavourite(recipe.id)}
                    className={`flex h-7 w-7 items-center justify-center rounded-full outline-none transition-all duration-200 ease-smooth hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-90 ${
                      favourites.has(recipe.id) ? 'text-[#F59E0B]' : 'text-phosphor/50 hover:text-phosphor'
                    }`}
                  >
                    <IconStar filled={favourites.has(recipe.id)} className="h-4 w-4" />
                  </button>
                  <span className={`rounded-full border px-2 py-0.5 font-mono text-[9.5px] ${topo.badge}`}>{topo.code}</span>
                </span>
              </div>

              <div className="relative min-h-[100px] flex-1 sm:min-h-[190px]">
                <OledVisualizer signalLedRef={signalLedRef} />

                {toast && (
                  <div
                    key={toast.key}
                    role="status"
                    aria-live="polite"
                    className={`absolute right-4 top-3 z-20 animate-[pf-toast_0.35s_var(--ease-smooth)] rounded-full border bg-display/90 px-3 py-1 font-mono text-[10.5px] backdrop-blur ${TOAST_TONE_CLASS[toast.tone]}`}
                  >
                    {toast.text}
                  </div>
                )}

                {exporting && (
                  <div className="absolute inset-x-4 bottom-3 z-20 flex items-center gap-2.5 rounded-full border border-[#F59E0B]/40 bg-display/90 px-3 py-1.5 font-mono text-[10.5px] text-[#F59E0B] backdrop-blur">
                    <Led hex={HEX.amber} on pulse size="md" />
                    <span>Rendering</span>
                    <span className="text-[#F59E0B]/60">48kHz / 16-bit PCM</span>
                    <span className="ml-auto h-1 w-20 overflow-hidden rounded-full bg-[#F59E0B]/15">
                      <span className="block h-full w-full animate-pulse bg-[#F59E0B]/70" />
                    </span>
                  </div>
                )}
              </div>

              <div className="relative z-10 mx-3 grid grid-cols-5 gap-x-2 gap-y-2 border-t border-phosphor/10 px-1 py-2.5">
                <Readout label="TEX" value={macros.x.toFixed(2)} />
                <Readout label="WGT" value={macros.y.toFixed(2)} />
                <Readout label="SPC" value={`${pct(macros.space)}%`} />
                <Readout label="GRT" value={`${pct(macros.grit)}%`} />
                <Readout label="SPD" value={`${pct(macros.speed)}%`} />
                <Readout label="PCH" value={semitones(macros.pitch)} />
                <Readout label="ATK" value={`${pct(macros.attack)}%`} />
                <Readout label="WID" value={`${pct(macros.width)}%`} />
                <Readout label="LFO" value={macros.modDepth < 0.01 ? 'OFF' : `${pct(macros.modDepth)}%`} />
                <Readout label="RATE" value={formatRate(modRateHz(macros.modRate))} />
              </div>
              <p className="relative z-10 truncate px-4 pb-3.5 text-[11.5px] text-phosphor/45">{recipe.description}</p>

              {/* Glass: faint scanlines, soft vignette, top highlight */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-30 bg-[repeating-linear-gradient(180deg,rgba(0,0,0,0.16)_0px,rgba(0,0,0,0.16)_1px,transparent_1px,transparent_3px)]"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-30 bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(0,0,0,0.45)_100%)]"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-30 bg-[linear-gradient(165deg,rgba(255,255,255,0.05)_0%,transparent_32%)]"
              />
            </div>
          </section>

          <Panel
            title="Morph pad"
            right={
              <span className="flex items-center gap-1.5">
                <Led hex={topo.hex} on={triggerLit} />
                <Silk>{liveScrub ? 'Plays while dragging' : 'Plays on release'}</Silk>
              </span>
            }
          >
            <div data-tip="Drag to morph the sound. Left/right and up/down change its character — see the labels on each side.">
            <XYMorphPad
              x={macros.x}
              y={macros.y}
              labels={recipe.axisLabels}
              hex={topo.hex}
              onScrub={handleScrub}
            />
            </div>
          </Panel>
        </div>

        {/* ── Macros + transport ─────────────────────────────────────── */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <Panel title="Shape" right={<Silk>Drag ↕ · Shift = fine · Double-click resets</Silk>}>
            <div className="grid grid-cols-3 gap-x-2 gap-y-5">{MAIN_KNOBS.map((k) => renderKnob(k))}</div>
            <div className="mt-5 border-t border-line pt-4">
              <div className="flex items-center justify-between gap-2">
                <Silk>Filter</Silk>
                <span className="flex items-center gap-1.5">
                  <Led hex={HEX.sky} on={mod.filter !== 'off'} />
                  <Silk>{mod.filter === 'off' ? 'Off' : `${FILTER_LABELS[mod.filter].label} · ${formatFreq(cutoffHz(macros.cutoff))}`}</Silk>
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-4">
                <div role="radiogroup" aria-label="Filter type" className="grid min-w-[240px] flex-1 grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {FILTER_MODES.map((filter) => (
                    <ModKey
                      key={filter}
                      active={mod.filter === filter}
                      label={FILTER_LABELS[filter].label}
                      tip={FILTER_LABELS[filter].tip}
                      onClick={() => changeMod({ filter })}
                    />
                  ))}
                </div>
                <div className="flex gap-5">{FILTER_KNOBS.map((k) => renderKnob(k, mod.filter === 'off'))}</div>
              </div>
            </div>
          </Panel>

          <div className="grid content-start gap-4">
          <Panel
            title="Play"
            right={
              <span className="flex flex-wrap items-center justify-end gap-x-2">
                <ToggleSwitch on={liveScrub} onToggle={toggleLive} label="Live scrub" hint="L" tip="Replays the sound while you drag the pad, so you hear changes instantly." />
              </span>
            }
          >
            <div className="grid gap-3">
              <button
                type="button"
                aria-label="Trigger sound (Space)"
                data-tip="Play the current sound with all your settings."
                data-tip-key="Space"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  setPointerHeld(true);
                  playNow();
                }}
                onPointerUp={() => setPointerHeld(false)}
                onPointerLeave={() => setPointerHeld(false)}
                onPointerCancel={() => setPointerHeld(false)}
                onClick={(e) => {
                  if (e.detail === 0) playNow();
                }}
                className={`group relative flex h-[92px] w-full items-center justify-between overflow-hidden rounded-[22px] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--pf-accent)_82%,white)_0%,var(--pf-accent)_100%)] px-6 text-left text-accent-ink outline-none transition-all duration-200 ease-smooth focus-visible:ring-4 focus-visible:ring-accent/30 ${
                  triggerPressed
                    ? 'scale-[0.985] shadow-[inset_0_2px_10px_rgba(0,0,0,0.25)]'
                    : 'shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_36px_-14px_var(--pf-accent-glow)] hover:-translate-y-px hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_22px_42px_-14px_var(--pf-accent-glow)]'
                }`}
              >
                {/* Soft sheen that brightens on hit */}
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_20%_0%,rgba(255,255,255,0.35),transparent_55%)] transition-opacity duration-300 ${
                    triggerLit ? 'opacity-100' : 'opacity-60'
                  }`}
                />
                <span className="relative flex flex-col gap-1">
                  <span className="text-[22px] font-semibold tracking-[-0.02em]">Play sound</span>
                  <span className="flex items-center gap-1.5 text-[12px] font-medium opacity-70">
                    <kbd className="rounded-md bg-black/10 px-1.5 py-0.5 font-mono text-[11px]">Space</kbd>
                    {rollPlaying ? 'stops the pattern and plays this sound' : 'stops the previous sound'}
                  </span>
                </span>
                <span
                  className={`relative flex h-14 w-14 items-center justify-center rounded-full bg-black/10 transition-transform duration-200 ease-smooth ${
                    triggerPressed ? 'scale-90' : 'group-hover:scale-105'
                  }`}
                >
                  <IconPlay className="ml-0.5 h-6 w-6" />
                </span>
              </button>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <HardwareButton
                  label="Mutate"
                  keyHint="R"
                  title="Randomly nudge the knobs for a fresh variation, then play it (R)"
                  icon={<IconDice className="h-[18px] w-[18px]" />}
                  onClick={mutate}
                  ledHex={HEX.mint}
                  ledOn={triggerLit}
                />
                <HardwareButton
                  label="Reset"
                  title="Put every knob back to how this preset started."
                  icon={<IconReset className="h-[18px] w-[18px]" />}
                  onClick={reset}
                  ledHex={HEX.zinc}
                  ledOn={!macrosEqual(macros, recipe.defaultMacros)}
                />
                <HardwareButton
                  label="Share link"
                  title="Copy a link that opens this exact sound and pattern."
                  icon={<IconLink className="h-[18px] w-[18px]" />}
                  onClick={() => void share()}
                  ledHex={HEX.cobalt}
                  ledOn={toast?.text.startsWith('LINK') ?? false}
                />
                <HardwareButton
                  label={exporting ? 'Rendering…' : 'Export .wav'}
                  keyHint="E"
                  title="Download this sound as a WAV file, 48 kHz / 16-bit (E)"
                  icon={<IconForge className="h-[18px] w-[18px]" />}
                  onClick={() => void forge()}
                  ledHex={HEX.amber}
                  ledOn={exporting}
                  ledPulse={exporting}
                  disabled={exporting}
                />
              </div>
            </div>
          </Panel>

          <Panel
            title="Modulation"
            right={
              <span className="flex items-center gap-1.5">
                <Led hex={HEX.violet} on={macros.modDepth >= 0.01} />
                <Silk>
                  {SHAPE_META[mod.shape].label} → {TARGET_LABEL[mod.target]} · {formatRate(modRateHz(macros.modRate))}
                </Silk>
              </span>
            }
          >
            <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
              <div className="flex gap-5">{MOD_KNOBS.map((k) => renderKnob(k))}</div>
              <div className="flex min-w-[220px] flex-1 flex-col gap-3.5">
                <div>
                  <Silk>Shape</Silk>
                  <div role="radiogroup" aria-label="LFO shape" className="mt-2 grid grid-cols-5 gap-1.5">
                    {MOD_SHAPES.map((shape) => (
                      <ModKey
                        key={shape}
                        active={mod.shape === shape}
                        label={SHAPE_META[shape].label}
                        tip={SHAPE_TIPS[shape]}
                        onClick={() => changeMod({ shape })}
                        icon={
                          <svg viewBox="0 0 12 12" aria-hidden className="h-3 w-3 overflow-visible">
                            <path d={SHAPE_META[shape].path} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                          </svg>
                        }
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <Silk>Target</Silk>
                  <div role="radiogroup" aria-label="LFO target" className="mt-2 grid grid-cols-4 gap-1.5">
                    {MOD_TARGETS.map((target) => (
                      <ModKey
                        key={target}
                        active={mod.target === target}
                        label={TARGET_LABEL[target]}
                        tip={TARGET_TIPS[target]}
                        onClick={() => changeMod({ target })}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Panel>
          </div>
        </div>

        {/* ── Trim / length ──────────────────────────────────────────── */}
        <Panel
          className="mt-4"
          title="Trim"
          right={
            <span className="flex items-center gap-1.5">
              <Led hex={HEX.orange} on={isTrimmed(trim)} />
              <Silk>{isTrimmed(trim) ? 'Applies to play, pattern & export' : 'Full sound'}</Silk>
            </span>
          }
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_268px]">
            <div data-tip="Drag the two handles to choose which part of the sound is heard. Drag the middle to move the selection.">
              <TrimEditor buffer={waveBuffer} trim={trim} hex={topo.hex} onChange={setTrim} onCommit={auditionTrim} />
            </div>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2 rounded-2xl bg-display px-3.5 py-2.5 shadow-[inset_0_1px_6px_rgba(0,0,0,0.8)]">
                {(() => {
                  const dur = waveBuffer?.duration ?? 0;
                  const region = trimRegion(trim, dur || 1);
                  return [
                    ['Start', region.start],
                    ['End', dur ? region.start + region.len : 0],
                    ['Length', dur ? region.len : 0],
                  ].map(([label, value]) => (
                    <Readout key={label as string} label={label as string} value={`${(value as number).toFixed(2)}s`} />
                  ));
                })()}
              </div>
              <div>
                <Silk>Quick length</Silk>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {QUICK_LENGTHS.map((len) => (
                    <SmallKey
                      key={len}
                      title={`Keep ${len}s from the start point`}
                      onClick={() => {
                        setTrim({ start: trim.start, end: trim.start + len });
                        auditionTrim();
                      }}
                      className="px-1"
                    >
                      {len < 1 ? `${len * 1000}ms` : `${len}s`}
                    </SmallKey>
                  ))}
                  <SmallKey title="Reset to the full sound" active={!isTrimmed(trim)} onClick={() => setTrim(FULL_TRIM)} className="px-1">
                    Full
                  </SmallKey>
                </div>
              </div>
              <div>
                <Silk>Fade out</Silk>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {TRIM_FADES.map((f) => (
                    <SmallKey key={f.sec} title={`${f.label} fade at the end point`} active={trimFade === f.sec} onClick={() => setTrimFade(f.sec)} className="px-1">
                      {f.label.toLowerCase()}
                    </SmallKey>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Panel>

        {/* ── Pattern / piano roll ───────────────────────────────────── */}
        <Panel
          className="mt-4"
          title="Pattern"
          right={
            <span className="flex items-center gap-1.5">
              <Led hex={HEX.mint} on={rollPlaying} pulse={rollPlaying} />
              <Silk>
                {activeTracks} track{activeTracks === 1 ? '' : 's'} · {bpm} bpm · {beats === 4 ? '1 bar' : '2 bars'}
              </Silk>
            </span>
          }
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[232px_minmax(0,1fr)]">
            <div className="flex flex-col gap-3.5">
              <div className="flex gap-2">
              <button
                type="button"
                {...tipAttrs(rollPlaying ? 'Stop the pattern (P)' : 'Play every track together (P)')}
                onClick={toggleRoll}
                className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[13px] font-semibold outline-none transition-all duration-200 ease-smooth focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-[0.97] ${
                  rollPlaying ? 'bg-ink text-page shadow-raised' : 'bg-accent text-accent-ink shadow-glow hover:-translate-y-px'
                }`}
              >
                {rollPlaying ? <span aria-hidden className="h-3 w-3 rounded-[3px] bg-current" /> : <IconPlay className="h-3.5 w-3.5" />}
                {rollPlaying ? 'Stop' : 'Play pattern'}
                <kbd className="rounded-md bg-black/10 px-1.5 py-0.5 font-mono text-[10.5px] font-medium">P</kbd>
              </button>
                <SmallKey title="Repeat the pattern until you press Stop." active={loopRoll} onClick={() => setLoopRoll((v) => !v)} className="h-11 px-4">
                  Loop
                </SmallKey>
              </div>
              <div>
                <Silk>Note length</Silk>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {LENGTH_MODES.map((l) => (
                    <SmallKey key={l.mode} title={l.tip} active={lengthMode === l.mode} onClick={() => setLengthMode(l.mode)} className="px-1">
                      {l.label}
                    </SmallKey>
                  ))}
                </div>
              </div>
              <div>
                <Silk>Tempo</Silk>
                <div className="mt-2 flex items-center gap-1.5">
                  <SmallKey title="Slower: 5 BPM down." onClick={() => setBpm((b) => Math.max(60, b - 5))} className="w-9 px-0">
                    −
                  </SmallKey>
                  <span className="flex h-8 flex-1 items-center justify-center rounded-full bg-display font-mono text-[13px] tabular-nums text-phosphor shadow-[inset_0_1px_5px_rgba(0,0,0,0.8)]">
                    {bpm} bpm
                  </span>
                  <SmallKey title="Faster: 5 BPM up." onClick={() => setBpm((b) => Math.min(200, b + 5))} className="w-9 px-0">
                    +
                  </SmallKey>
                </div>
              </div>
              <div>
                <Silk>Length</Silk>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {ROLL_BEATS.map((n) => (
                    <SmallKey key={n} title={`The pattern lasts ${n === 4 ? 'one bar (4 beats)' : 'two bars (8 beats)'} for every track.`} active={beats === n} onClick={() => setBeats(n)} className="px-1">
                      {n === 4 ? '1 bar' : '2 bars'}
                    </SmallKey>
                  ))}
                </div>
              </div>
              <div>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TRACK_COLORS[activeTrack] ?? TRACK_COLORS[0] }} />
                  <Silk>Grid · track {activeTrack + 1}</Silk>
                </span>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {STEP_DIVISIONS.map((d) => (
                    <SmallKey
                      key={d.div}
                      title={`Track ${activeTrack + 1} gets ${d.div * 4} steps per bar (${d.label} notes). Each track has its own grid — e.g. 1/16 for hi-hats.`}
                      active={activeDiv === d.div}
                      onClick={() => setTrackDiv(d.div)}
                      className="px-1"
                    >
                      {d.label}
                    </SmallKey>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SmallKey title="Remove all notes from the selected track." onClick={() => setRollSteps(emptySteps())}>
                  Clear
                </SmallKey>
                <SmallKey title="Download all unmuted tracks mixed into one WAV file." active={rollExporting} onClick={() => void forgeRoll()}>
                  <IconForge className="h-3.5 w-3.5" />
                  {rollExporting ? 'Rendering…' : 'Export'}
                </SmallKey>
              </div>
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                Pick a track, then click the grid to add up to {ROLL_MAX_NOTES} notes per step. Choosing a sound in the Library puts it on the selected track.
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div role="radiogroup" aria-label="Tracks" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {tracks.map((t, i) => {
                  const active = i === activeTrack;
                  const color = TRACK_COLORS[i] ?? TRACK_COLORS[0];
                  const notes = t.steps.slice(0, beats * t.div).reduce((sum, cell) => sum + cell.length, 0);
                  return (
                    <div key={i} className="relative">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        data-tip={`Track ${i + 1}: click to edit its notes. Then pick any sound in the Library to put it on this track.`}
                        onClick={() => selectTrack(i)}
                        className={`flex w-full min-w-0 flex-col gap-1 rounded-2xl border py-2.5 pl-3.5 pr-11 text-left outline-none transition-all duration-200 ease-smooth focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.98] ${
                          active ? 'bg-raised shadow-raised' : 'border-line bg-inset shadow-well hover:border-line-strong'
                        } ${t.muted ? 'opacity-50' : ''}`}
                        style={active ? { borderColor: color, boxShadow: `0 0 0 3px ${color}26, var(--pf-shadow-raised)` } : undefined}
                      >
                        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                          <Silk className={`shrink-0 ${active ? 'text-ink' : ''}`}>Track {i + 1}</Silk>
                          <span className="truncate font-mono text-[10px] tabular-nums text-ink-3">
                            {notes} note{notes === 1 ? '' : 's'} · {divLabel(t.div)}
                          </span>
                        </span>
                        <span className="truncate text-[12.5px] font-semibold text-ink">{t.recipe.name}</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={t.muted}
                        aria-label={`${t.muted ? 'Unmute' : 'Mute'} track ${i + 1}`}
                        data-tip={t.muted ? 'Unmute this track.' : 'Mute this track — it stays silent in play and export.'}
                        onClick={() => toggleMute(i)}
                        className={`absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border font-mono text-[10px] font-semibold outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/50 ${
                          t.muted ? 'border-transparent bg-ink text-page' : 'border-line bg-raised text-ink-3 hover:text-ink'
                        }`}
                      >
                        M
                      </button>
                    </div>
                  );
                })}
              </div>
              <PianoRoll
                steps={rollSteps}
                stepCount={beats * activeDiv}
                div={activeDiv}
                rootMidi={rootMidiOf(recipe, macros.pitch)}
                playingStep={rollStep === null ? null : Math.floor((rollStep * activeDiv) / 4)}
                onToggle={toggleCell}
                color={TRACK_COLORS[activeTrack] ?? TRACK_COLORS[0]}
                ghosts={tracks.flatMap((t, i) =>
                  i === activeTrack || t.muted
                    ? []
                    : [{ steps: regrid(t.steps.slice(0, beats * t.div), t.div, activeDiv), color: TRACK_COLORS[i] ?? TRACK_COLORS[0] }],
                )}
              />
            </div>
          </div>
        </Panel>



        </main>

        {/* ── Footer legend ──────────────────────────────────────────── */}
        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 px-1 pb-2 text-[11.5px] text-ink-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {[
              ['Space', 'Play'],
              ['R', 'Mutate'],
              ['E', 'Export'],
              ['L', 'Live scrub'],
              ['P', 'Pattern'],
              ['F', 'Favourite'],
              ['Ctrl+Z', 'Undo'],
              ['/', 'Search'],
            ].map(([k, label]) => (
              <span key={k} className="flex items-center gap-1.5">
                <Kbd>{k}</Kbd>
                {label}
              </span>
            ))}
          </div>
          <span>
            Produced by <span className="font-semibold text-ink-2">VV Labs</span> · procedural, no samples · 48 kHz
          </span>
        </footer>
      </div>
      <TooltipLayer />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Entry                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export function PocketFoleyStudio() {
  const first = PRESETS_CATALOG[0];
  if (!first) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-6">
        <div className="rounded-[24px] border border-line bg-panel px-10 py-8 text-center shadow-panel">
          <div className="mb-2 flex items-center justify-center gap-2">
            <Led hex={HEX.orange} on pulse />
            <span className="text-[15px] font-semibold text-ink">PocketFoley</span>
          </div>
          <p className="text-[12.5px] text-ink-3">No sounds loaded — check PRESETS_CATALOG.</p>
        </div>
      </div>
    );
  }
  return <Studio initialRecipe={first} />;
}

export default PocketFoleyStudio;
