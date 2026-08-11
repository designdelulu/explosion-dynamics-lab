import * as LabData from './data.js';
import { ResearchFluidEngine } from './fluid-engine.js';

/*
 * Explosion Dynamics Lab renderer
 * --------------------------------
 * The established Canvas model evaluates the scene from (seed, settings, time).
 * Upgraded cinematic presets replace the legacy plume with bounded, fixed-step
 * WebGL2 fluid profiles while this class remains the public compositor,
 * deterministic export API, family-specific analytical early-phase renderer,
 * analytical Overview renderer, and compatibility fallback.
 */

const TAU = Math.PI * 2;
const MAX_PARTICLES = 2200;
const MAX_CLOUD_LOBES = 56;
const ALPHA_STEPS = 96;
const alphaColorCache = new Map();
const LAYER_NAMES = [
  'flash',
  'fireball',
  'shock',
  'thermal',
  'dust',
  'cloud',
  'debris',
  'grid',
];

const localClamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clamp = typeof LabData.clamp === 'function' ? LabData.clamp : localClamp;
const saturate = (value) => clamp(Number.isFinite(value) ? value : 0, 0, 1);
const lerp = (a, b, amount) => a + (b - a) * amount;
const smoothstep = (edge0, edge1, value) => {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const x = saturate((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
};
const easeOutCubic = (value) => 1 - Math.pow(1 - saturate(value), 3);
const easeOutExpo = (value) => (value >= 1 ? 1 : 1 - Math.pow(2, -8 * saturate(value)));
const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

function hasFluidProfile(preset) {
  return Boolean(
    preset?.researchModel
    && (preset.researchModel.engine === 'webgl2-fluid-2.5d' || preset.researchModel.id),
  );
}

function requestsFluidRenderer(preset, viewMode) {
  return viewMode === 'cinematic' && hasFluidProfile(preset);
}

const DEFAULT_LAYERS = Object.freeze({
  flash: true,
  fireball: true,
  shock: true,
  thermal: true,
  dust: true,
  cloud: true,
  debris: true,
  grid: true,
});

const DEFAULT_SETTINGS = Object.freeze({
  presetId: LabData.DEFAULT_PRESET_ID || 'compact-conventional',
  seed: 1842,
  energy: 1,
  burst: LabData.PRESET_BY_ID?.[LabData.DEFAULT_PRESET_ID]?.burstType || 'surface',
  altitude: LabData.PRESET_BY_ID?.[LabData.DEFAULT_PRESET_ID]?.defaultAltitude ?? 0.02,
  windDirection: 90,
  windStrength: 24,
  environment: LabData.DEFAULT_ENVIRONMENT_ID || 'flat-range',
  timeOfDay: LabData.DEFAULT_TIME_ID || 'dusk',
  cameraDistance: 100,
  cameraAngle: 0,
  density: 100,
  paletteId: LabData.DEFAULT_PALETTE_ID || 'natural-fire',
  quality: 'balanced',
  diagnostic: 'beauty',
  debugMetrics: false,
  viewMode: 'cinematic',
  flowMode: 'off',
});

const QUALITY_ALIASES = Object.freeze({
  auto: 'balanced',
  low: 'mobile',
  medium: 'balanced',
  mobile: 'mobile',
  balanced: 'balanced',
  high: 'high',
});

const FLUID_TIER_FALLBACKS = Object.freeze({
  high: Object.freeze(['high', 'balanced', 'mobile']),
  balanced: Object.freeze(['balanced', 'mobile']),
  mobile: Object.freeze(['mobile']),
});

const REFRACTION_GEOMETRY = Object.freeze({
  'conventional-compact': Object.freeze({ aspect: 0.46, x: 0.02, y: 0.08 }),
  'industrial-combustion': Object.freeze({ aspect: 0.76, x: -0.025, y: -0.02 }),
  'ground-coupled': Object.freeze({ aspect: 0.3, x: 0, y: 0.1 }),
  meteor: Object.freeze({ aspect: 0.54, x: 0.09, y: -0.04 }),
  volcanic: Object.freeze({ aspect: 0.4, x: 0, y: 0.08 }),
  'fictional-plasma': Object.freeze({ aspect: 1, x: 0, y: 0 }),
  'nuclear-scale': Object.freeze({ aspect: 0.66, x: 0, y: 0 }),
});

/*
 * Layered shockwave art direction per event family. All values are
 * dimensionless multipliers over the existing normalized shock phase; none is
 * a pressure, distance, or damage quantity.
 *   bands        trailing contour bands behind the leading edge
 *   spacing      radial gap between bands as a fraction of front radius
 *   thickness    leading-edge stroke weight multiplier
 *   opacity      overall shock opacity multiplier
 *   aspect       vertical flattening of the front (1 = spherical)
 *   irregularity angular radius noise so the front reads as matter, not vector art
 *   chroma       subtle warm/cool separation on the leading edge
 *   dust         dust-lift boundary strength behind the front (surface events)
 *   groundRing   ground-reflected wave strength
 *   condensation transient condensation-style ring for humid, elevated events
 *   shellWidth   refractive shell width as a fraction of front radius
 *   elongation/rotation/offsetX  directional stretch for traveling sources
 */
const SHOCK_FAMILY_PROFILES = Object.freeze({
  'conventional-compact': Object.freeze({
    bands: 3, spacing: 0.062, thickness: 1.2, opacity: 1.18, aspect: 0.6,
    irregularity: 0.03, chroma: 0.34, dust: 1.25, groundRing: 1.05,
    condensation: 0, shellWidth: 0.055,
  }),
  'industrial-combustion': Object.freeze({
    bands: 2, spacing: 0.1, thickness: 0.8, opacity: 0.62, aspect: 0.68,
    irregularity: 0.05, chroma: 0.16, dust: 0.55, groundRing: 0.55,
    condensation: 0, shellWidth: 0.1,
  }),
  'ground-coupled': Object.freeze({
    bands: 3, spacing: 0.055, thickness: 1.05, opacity: 0.95, aspect: 0.3,
    irregularity: 0.05, chroma: 0.12, dust: 1.8, groundRing: 1.6,
    condensation: 0, shellWidth: 0.045,
  }),
  meteor: Object.freeze({
    bands: 3, spacing: 0.08, thickness: 1.05, opacity: 1, aspect: 0.58,
    irregularity: 0.04, chroma: 0.5, dust: 0.75, groundRing: 0.85,
    condensation: 0.4, shellWidth: 0.075, elongation: 1.22, rotation: -0.12, offsetX: 0.08,
  }),
  volcanic: Object.freeze({
    bands: 0, spacing: 0, thickness: 0.6, opacity: 0.5, aspect: 0.52,
    irregularity: 0.06, chroma: 0, dust: 0.9, groundRing: 0.4,
    condensation: 0, shellWidth: 0, pulsed: true,
  }),
  'fictional-plasma': Object.freeze({
    bands: 4, spacing: 0.048, thickness: 0.85, opacity: 1.15, aspect: 1,
    irregularity: 0.018, chroma: 0.95, dust: 0, groundRing: 0.3,
    condensation: 0, shellWidth: 0.07, spectral: true,
  }),
  'nuclear-scale': Object.freeze({
    bands: 4, spacing: 0.058, thickness: 1.3, opacity: 1.25, aspect: 0.66,
    irregularity: 0.026, chroma: 0.55, dust: 1.15, groundRing: 1.35,
    condensation: 0.65, shellWidth: 0.095,
  }),
});

/* Art-direction tuning defaults for the hidden ?visualDev=1 panel. Every value
 * is a multiplier over the shipped look; 1 keeps the accepted appearance. */
const DEFAULT_TUNING = Object.freeze({
  shockBands: 1,
  shockSpacing: 1,
  shockOpacity: 1,
  refraction: 1,
  trailPersistence: 1,
  flowDensity: 1,
  flowLifetime: 1,
  structuralIntensity: 1,
  environmentDetail: 1,
  cityDensity: 1,
  dustResponse: 1,
  structureResponse: 1,
  capWidth: 1,
  stemThickness: 1,
  cameraPullback: 1,
  exposure: 1,
  envIllumination: 1,
});

const FLOW_MODES = new Set(['off', 'flow', 'field']);

const DIAGNOSTIC_MODES = new Set([
  'beauty',
  'velocity',
  'temperature',
  'smoke',
  'incandescent',
  'divergence',
  'density',
  'vorticity',
  'pressure',
  'tracers',
]);

const FALLBACK_PALETTE = Object.freeze({
  id: 'natural-fire',
  skyTop: '#070910',
  skyBottom: '#30241f',
  horizon: '#70452c',
  ground: '#08090b',
  groundLight: '#6a3520',
  core: '#fffdf0',
  hot: '#ffd27a',
  flame: '#ff7b2f',
  ember: '#ffb14a',
  thermal: '#ff6838',
  shock: '#dcefff',
  smoke: '#2a2a2d',
  smokeLight: '#6c625b',
  dust: '#8f7257',
  cloud: '#4f4a49',
  plasma: '#8edcff',
  grid: '#607489',
  text: '#e7edf2',
});

// Distinctions are artistic, normalized behavior profiles—not calibrated yields.
const BEHAVIOR_PROFILES = Object.freeze({
  compact: {
    duration: 8, scale: 0.72, flash: 0.72, fireball: 0.74, shock: 0.86,
    dust: 0.72, debris: 1, cloud: 0.32, smoke: 0.45, column: 0.22,
    mushroom: 0, ejecta: 0.34, roll: 0.28, shake: 0.65, particles: 680,
    fireEnd: 0.31, riseStart: 0.18, cloudStart: 0.44,
  },
  conventional: {
    duration: 11, scale: 1, flash: 0.82, fireball: 0.94, shock: 1,
    dust: 0.9, debris: 0.9, cloud: 0.52, smoke: 0.62, column: 0.45,
    mushroom: 0.08, ejecta: 0.45, roll: 0.42, shake: 0.78, particles: 1040,
    fireEnd: 0.34, riseStart: 0.16, cloudStart: 0.39,
  },
  industrial: {
    duration: 14, scale: 1.02, flash: 0.45, fireball: 1.28, shock: 0.55,
    dust: 0.4, debris: 0.35, cloud: 0.82, smoke: 1.2, column: 0.7,
    mushroom: 0, ejecta: 0.1, roll: 1.15, shake: 0.42, particles: 1250,
    fireEnd: 0.58, riseStart: 0.12, cloudStart: 0.32,
  },
  fuelAir: {
    duration: 13, scale: 1.18, flash: 0.58, fireball: 1.45, shock: 0.88,
    dust: 0.7, debris: 0.22, cloud: 0.65, smoke: 0.92, column: 0.58,
    mushroom: 0.05, ejecta: 0.08, roll: 1.28, shake: 0.68, particles: 1300,
    fireEnd: 0.52, riseStart: 0.14, cloudStart: 0.34,
  },
  underground: {
    duration: 13, scale: 1, flash: 0.18, fireball: 0.25, shock: 0.62,
    dust: 1.6, debris: 1.5, cloud: 1.08, smoke: 1.12, column: 1.02,
    mushroom: 0, ejecta: 1.55, roll: 0.18, shake: 1.05, particles: 1500,
    fireEnd: 0.19, riseStart: 0.06, cloudStart: 0.26,
  },
  meteorAir: {
    duration: 15, scale: 1.45, flash: 1.15, fireball: 1.12, shock: 1.4,
    dust: 0.16, debris: 0.06, cloud: 0.72, smoke: 0.55, column: 0.38,
    mushroom: 0.08, ejecta: 0, roll: 0.34, shake: 0.75, particles: 1050,
    fireEnd: 0.29, riseStart: 0.2, cloudStart: 0.4,
  },
  meteorImpact: {
    duration: 18, scale: 1.55, flash: 1, fireball: 1.08, shock: 1.48,
    dust: 1.65, debris: 1.6, cloud: 1.38, smoke: 1.3, column: 1.12,
    mushroom: 0.2, ejecta: 1.75, roll: 0.4, shake: 1.25, particles: 1850,
    fireEnd: 0.28, riseStart: 0.08, cloudStart: 0.25,
  },
  volcanic: {
    duration: 20, scale: 1.35, flash: 0.04, fireball: 0.28, shock: 0.14,
    dust: 1.05, debris: 0.82, cloud: 1.62, smoke: 1.62, column: 1.7,
    mushroom: 0, ejecta: 0.78, roll: 0.32, shake: 0.34, particles: 1900,
    fireEnd: 0.44, riseStart: 0, cloudStart: 0.16, sustained: true,
  },
  plasma: {
    duration: 11, scale: 1.05, flash: 1.08, fireball: 0.88, shock: 0.92,
    dust: 0.18, debris: 0.18, cloud: 0.42, smoke: 0.2, column: 0.36,
    mushroom: 0, ejecta: 0.06, roll: 0.2, shake: 0.5, particles: 1120,
    fireEnd: 0.38, riseStart: 0.15, cloudStart: 0.38, electrical: true,
  },
  nuclearAir: {
    duration: 20, scale: 1.65, flash: 1.75, fireball: 1.52, shock: 1.65,
    dust: 0.72, debris: 0.2, cloud: 1.55, smoke: 1.2, column: 1.55,
    mushroom: 1.55, ejecta: 0.08, roll: 0.82, shake: 1.05, particles: 1900,
    fireEnd: 0.33, riseStart: 0.12, cloudStart: 0.3,
  },
  nuclearGround: {
    duration: 22, scale: 1.72, flash: 1.62, fireball: 1.45, shock: 1.7,
    dust: 1.7, debris: 0.7, cloud: 1.72, smoke: 1.5, column: 1.68,
    mushroom: 1.65, ejecta: 0.72, roll: 0.72, shake: 1.2, particles: 2100,
    fireEnd: 0.31, riseStart: 0.09, cloudStart: 0.27,
  },
  extreme: {
    duration: 26, scale: 1.75, flash: 2.1, fireball: 1.82, shock: 2.05,
    dust: 1.35, debris: 0.42, cloud: 2, smoke: 1.72, column: 2.05,
    mushroom: 2.1, ejecta: 0.4, roll: 0.98, shake: 1.36, particles: 2200,
    fireEnd: 0.34, riseStart: 0.1, cloudStart: 0.27,
  },
});

function findRecord(collection, id) {
  if (!collection) return null;
  if (Array.isArray(collection)) {
    return collection.find((item) => item && String(item.id ?? item.value ?? '') === String(id)) || null;
  }
  if (typeof collection === 'object') {
    return collection[id] || Object.values(collection).find(
      (item) => item && String(item.id ?? item.value ?? '') === String(id),
    ) || null;
  }
  return null;
}

function getPresetRecord(id) {
  if (typeof LabData.getPreset === 'function') {
    const match = LabData.getPreset(id);
    if (match) return match;
  }
  return LabData.PRESET_BY_ID?.[id]
    || findRecord(LabData.PRESETS || LabData.presets || LabData.EVENT_PRESETS, id)
    || {};
}

function getPaletteRecord(id) {
  if (typeof LabData.getPalette === 'function') {
    const match = LabData.getPalette(id);
    if (match) return match;
  }
  return LabData.PALETTE_BY_ID?.[id]
    || findRecord(LabData.PALETTES || LabData.palettes || LabData.COLOR_PALETTES, id)
    || {};
}

function profileKey(preset, id) {
  const token = [
    id,
    preset.id,
    preset.name,
    preset.title,
    preset.type,
    preset.kind,
    preset.family,
  ].filter(Boolean).join(' ').toLowerCase();
  if (token.includes('extreme') || token.includes('historical')) return 'extreme';
  if (token.includes('nuclear') && (token.includes('ground') || token.includes('surface'))) return 'nuclearGround';
  if (token.includes('nuclear')) return 'nuclearAir';
  if (token.includes('volcan')) return 'volcanic';
  if (token.includes('plasma') || token.includes('fictional')) return 'plasma';
  if (token.includes('meteor') && (token.includes('ground') || token.includes('impact'))) return 'meteorImpact';
  if (token.includes('meteor')) return 'meteorAir';
  if (token.includes('underground') || token.includes('subsurface')) return 'underground';
  if (token.includes('fuel') || token.includes('thermobar')) return 'fuelAir';
  if (token.includes('industrial')) return 'industrial';
  if (token.includes('compact') || token.includes('small')) return 'compact';
  return 'conventional';
}

function numericOverride(sources, keys, fallback) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      if (source[key] !== undefined && Number.isFinite(Number(source[key]))) return Number(source[key]);
    }
  }
  return fallback;
}

function resolveBehavior(preset, id) {
  const key = profileKey(preset, id);
  const base = BEHAVIOR_PROFILES[key];
  const visual = preset.visual || preset.render || preset.behavior || preset.effects || {};
  const physics = preset.physics || preset.model || {};
  const timing = preset.timeline || preset.timing || {};
  const sources = [visual, physics, timing, preset];
  const result = { ...base, key };
  result.duration = numericOverride(sources, ['duration', 'durationSeconds', 'seconds'], base.duration);
  result.scale = numericOverride(sources, ['visualScale', 'scale', 'size'], base.scale);
  result.flash = numericOverride(sources, ['flash', 'flashStrength', 'flashIntensity'], base.flash);
  result.fireball = numericOverride(sources, ['fireball', 'fireballRadius', 'fireballScale', 'fireballStrength'], base.fireball);
  result.fireGrowth = numericOverride(sources, ['fireballGrowth', 'fireGrowth'], 1);
  result.shock = numericOverride(sources, ['shock', 'shockRadius', 'shockScale', 'shockStrength'], base.shock);
  result.shockOpacity = numericOverride(sources, ['shockOpacity'], 1);
  result.shockThickness = numericOverride(sources, ['shockThickness'], 0.7);
  result.surface = numericOverride(sources, ['surfaceInteraction', 'surface'], base.dust);
  result.dust = numericOverride(sources, ['dust', 'dustAmount', 'surfaceDust'], base.dust);
  result.debris = numericOverride(sources, ['debris', 'debrisAmount'], base.debris);
  result.cloud = numericOverride(sources, ['cloud', 'cloudSpread', 'cloudScale', 'cloudAmount'], base.cloud);
  result.smoke = numericOverride(sources, ['smoke', 'smokeAmount'], base.smoke);
  result.column = numericOverride(sources, ['column', 'columnScale', 'columnRise'], base.column);
  result.mushroom = numericOverride(sources, ['mushroom', 'mushroomScale'], base.mushroom);
  result.ejecta = numericOverride(sources, ['ejecta', 'ejectaAmount'], Math.max(base.ejecta, result.surface * 0.62));
  result.roll = numericOverride(sources, ['roll', 'rollingFire', 'turbulence'], base.roll);
  result.windResponse = numericOverride(sources, ['windResponse'], 0.7);
  result.atmosphericLight = numericOverride(sources, ['atmosphericLight'], result.flash);
  // Full-frame flash wash is independently profile-configurable. A neutral
  // default keeps every established preset byte-identical; Ground Burst alone
  // opts down so the local surface flash is not buried by a viewport-wide tint.
  result.atmosphericWash = numericOverride(sources, ['atmosphericWash'], 1);
  result.heatDistortion = numericOverride(sources, ['heatDistortion'], 0.6);
  result.shake = numericOverride(sources, ['shake', 'cameraShake'], base.shake);
  result.particles = Math.round(numericOverride(
    [preset.particleBudget, ...sources],
    ['balanced', 'particles', 'particleCount'],
    base.particles,
  ));
  result.fireEnd = numericOverride(sources, ['fireEnd', 'fireballEnd'], base.fireEnd);
  result.riseStart = numericOverride(sources, ['riseStart', 'columnStart'], base.riseStart);
  result.cloudStart = numericOverride(sources, ['cloudStart', 'cloudFormation'], base.cloudStart);
  result.sustained = Boolean(visual.sustained ?? preset.sustained ?? base.sustained);
  result.electrical = Boolean(visual.electrical ?? preset.electrical ?? base.electrical);
  return result;
}

function resolvePalette(record, id) {
  const colors = record.colors || record.palette || record;
  const read = (keys, fallback) => {
    for (const key of keys) {
      if (typeof colors[key] === 'string' && colors[key]) return colors[key];
    }
    return fallback;
  };
  return {
    id: record.id || id,
    skyTop: read(['skyTop', 'backgroundTop', 'background', 'sky'], FALLBACK_PALETTE.skyTop),
    skyBottom: read(['skyBottom', 'backgroundBottom', 'horizon'], FALLBACK_PALETTE.skyBottom),
    horizon: read(['horizon', 'ambient', 'atmosphere'], FALLBACK_PALETTE.horizon),
    ground: read(['ground', 'surface', 'dark'], FALLBACK_PALETTE.ground),
    groundLight: read(['groundLight', 'reflection', 'surfaceGlow'], FALLBACK_PALETTE.groundLight),
    core: read(['core', 'fireCore', 'whiteHot'], FALLBACK_PALETTE.core),
    hot: read(['hot', 'fireHot', 'flash', 'highlight'], FALLBACK_PALETTE.hot),
    flame: read(['flame', 'fire', 'fireOuter', 'primary'], FALLBACK_PALETTE.flame),
    ember: read(['ember', 'spark', 'secondary'], FALLBACK_PALETTE.ember),
    thermal: read(['thermal', 'heat', 'glow'], FALLBACK_PALETTE.thermal),
    shock: read(['shock', 'wave', 'pressure'], FALLBACK_PALETTE.shock),
    smoke: read(['smoke', 'smokeDark'], FALLBACK_PALETTE.smoke),
    smokeLight: read(['smokeLight', 'ash', 'cloudLight'], FALLBACK_PALETTE.smokeLight),
    dust: read(['dust', 'earth', 'particulate'], FALLBACK_PALETTE.dust),
    cloud: read(['cloud', 'cloudDark'], FALLBACK_PALETTE.cloud),
    plasma: read(['plasma', 'electric', 'accent'], FALLBACK_PALETTE.plasma),
    grid: read(['grid', 'line', 'guide'], FALLBACK_PALETTE.grid),
    text: read(['text', 'foreground', 'label'], FALLBACK_PALETTE.text),
  };
}

function hashString(value) {
  let hash = 2166136261 >>> 0;
  const string = String(value);
  for (let index = 0; index < string.length; index += 1) {
    hash ^= string.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function colorWithAlpha(color, alpha) {
  const bucket = Math.round(saturate(alpha) * ALPHA_STEPS);
  const a = bucket / ALPHA_STEPS;
  if (typeof color !== 'string') return `rgba(255,255,255,${a})`;
  let shades = alphaColorCache.get(color);
  if (!shades) {
    shades = new Array(ALPHA_STEPS + 1);
    alphaColorCache.set(color, shades);
  }
  if (shades[bucket]) return shades[bucket];
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let body = hex[1];
    if (body.length === 3) body = body.split('').map((part) => part + part).join('');
    const value = Number.parseInt(body, 16);
    shades[bucket] = `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${a})`;
    return shades[bucket];
  }
  const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(',').slice(0, 3).map((part) => finite(part.trim(), 255));
    shades[bucket] = `rgba(${parts[0]},${parts[1]},${parts[2]},${a})`;
    return shades[bucket];
  }
  shades[bucket] = color;
  return shades[bucket];
}

function createLayerCanvas() {
  try {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(1, 1);
    if (typeof document !== 'undefined' && document.createElement) return document.createElement('canvas');
  } catch (_) {
    // A missing offscreen layer is non-fatal; the renderer can draw directly.
  }
  return null;
}

function safeContext(canvas, attributes = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  try {
    return canvas.getContext('2d', attributes) || canvas.getContext('2d');
  } catch (_) {
    try {
      return canvas.getContext('2d');
    } catch (_) {
      return null;
    }
  }
}

function phaseEnvelope(value, attack, sustain, release) {
  if (value < attack) return smoothstep(0, attack, value);
  if (value <= sustain) return 1;
  return 1 - smoothstep(sustain, release, value);
}

/**
 * Hybrid Canvas/WebGL2 compositor for the Explosion Dynamics Lab.
 *
 * Public time values are seconds from the beginning of the selected preset.
 * All spatial values shown by the renderer are normalized visual relationships.
 * Canvas supplies the environment, analytical early shock, non-flagship
 * presets, and graceful fallback; the flagship plume is the projected field.
 */
export class ExplosionRenderer {
  constructor(canvas, { reducedMotion = false, researchCanvas = null } = {}) {
    this.canvas = canvas || null;
    this.researchCanvas = researchCanvas || null;
    this.reducedMotion = Boolean(reducedMotion);
    this.ctx = safeContext(this.canvas, { alpha: false, desynchronized: true });
    this.available = Boolean(this.ctx);
    this.destroyed = false;

    this.settings = {
      ...DEFAULT_SETTINGS,
      layers: { ...DEFAULT_LAYERS },
      tuning: { ...DEFAULT_TUNING },
    };
    this._preset = getPresetRecord(this.settings.presetId);
    this._behavior = resolveBehavior(this._preset, this.settings.presetId);
    this._palette = resolvePalette(getPaletteRecord(this.settings.paletteId), this.settings.paletteId);
    this._environment = LabData.ENVIRONMENT_BY_ID?.[this.settings.environment] || {};
    this._timeSetting = LabData.TIME_BY_ID?.[this.settings.timeOfDay] || {};
    this._presetTimeline = [];
    this._phaseById = Object.create(null);
    this._buildPresetTimeline();
    this._origin = { x: 0.52, y: 0.74 };
    this._cssWidth = 0;
    this._cssHeight = 0;
    this._dpr = 1;

    this._glowCanvas = createLayerCanvas();
    this._matterCanvas = createLayerCanvas();
    this._refractionCanvas = createLayerCanvas();
    this._glowContext = safeContext(this._glowCanvas, { alpha: true, desynchronized: true });
    this._matterContext = safeContext(this._matterCanvas, { alpha: true, desynchronized: true });
    this._refractionContext = safeContext(this._refractionCanvas, { alpha: true, desynchronized: true });
    this._layerWidth = 0;
    this._layerHeight = 0;

    this._particleKind = new Uint8Array(MAX_PARTICLES);
    this._particleStart = new Float32Array(MAX_PARTICLES);
    this._particleLife = new Float32Array(MAX_PARTICLES);
    this._particleAngle = new Float32Array(MAX_PARTICLES);
    this._particleSpeed = new Float32Array(MAX_PARTICLES);
    this._particleRise = new Float32Array(MAX_PARTICLES);
    this._particleSize = new Float32Array(MAX_PARTICLES);
    this._particlePhase = new Float32Array(MAX_PARTICLES);
    this._particleBias = new Float32Array(MAX_PARTICLES);
    this._particleDepth = new Float32Array(MAX_PARTICLES);
    this._lobeX = new Float32Array(MAX_CLOUD_LOBES);
    this._lobeY = new Float32Array(MAX_CLOUD_LOBES);
    this._lobeSize = new Float32Array(MAX_CLOUD_LOBES);
    this._lobePhase = new Float32Array(MAX_CLOUD_LOBES);

    this._poolSignature = '';
    this._layout = {};
    this._phase = {};
    this._stats = {
      available: this.available,
      fps: 0,
      frameMs: 0,
      dpr: 1,
      width: 0,
      height: 0,
      particleCount: 0,
      adaptiveScale: 1,
      qualityScale: 1,
      quality: this.settings.quality,
      error: this.available ? null : 'Canvas 2D is unavailable.',
    };
    this._adaptiveScale = 1;
    this._slowFrames = 0;
    this._fastFrames = 0;
    this._lastFrameStamp = 0;
    this._fluidLive = null;
    this._fluidExport = null;
    this._fluidLiveMeta = null;
    this._fluidExportMeta = null;
    this._researchFluidRendered = false;
    this._rebuildParticlePool();
    this.resize();
  }

  /** Merge a partial settings object. Layer flags may be nested or top-level. */
  configure(partialSettings = {}) {
    if (this.destroyed || !partialSettings || typeof partialSettings !== 'object') return this;
    const previousSignature = `${this.settings.seed}|${this.settings.presetId}|${this.settings.burst}`;
    const next = { ...this.settings };

    const stringKeys = [
      'presetId', 'burst', 'environment', 'timeOfDay', 'paletteId', 'quality', 'diagnostic', 'viewMode', 'flowMode',
    ];
    for (const key of stringKeys) {
      if (partialSettings[key] !== undefined) next[key] = String(partialSettings[key]);
    }
    const numericKeys = [
      'seed', 'energy', 'altitude', 'windDirection', 'windStrength',
      'cameraDistance', 'cameraAngle', 'density',
    ];
    for (const key of numericKeys) {
      if (partialSettings[key] !== undefined) next[key] = finite(partialSettings[key], next[key]);
    }
    if (partialSettings.debugMetrics !== undefined) {
      next.debugMetrics = Boolean(partialSettings.debugMetrics);
    }

    next.seed = (Math.max(1, Math.floor(next.seed)) >>> 0) || 1;
    next.energy = clamp(next.energy, 0.1, 4);
    // The app uses normalized altitude (-0.2..0.75); values above 1 are also
    // accepted as a 0..100 UI percentage for standalone renderer consumers.
    next.altitude = clamp(next.altitude, -0.25, 100);
    next.windDirection = ((next.windDirection % 360) + 360) % 360;
    next.windStrength = clamp(next.windStrength, 0, 100);
    // Outer safety clamp — the authoritative bound regardless of what the app
    // layer sends. Widened alongside app.js's CAMERA_ANGLE_RANGE/family zoom
    // bounds (camera-sensitivity pass) with headroom on the angle side so the
    // app's own clamp is always reached first.
    next.cameraDistance = clamp(next.cameraDistance, 35, 220);
    next.cameraAngle = clamp(next.cameraAngle, -58, 58);
    next.density = clamp(next.density, 10, 160);
    next.quality = QUALITY_ALIASES[next.quality] || 'balanced';
    next.diagnostic = DIAGNOSTIC_MODES.has(next.diagnostic) ? next.diagnostic : 'beauty';
    next.viewMode = next.viewMode === 'overview' ? 'overview' : 'cinematic';
    next.flowMode = FLOW_MODES.has(next.flowMode) ? next.flowMode : 'off';

    next.tuning = { ...(this.settings.tuning || DEFAULT_TUNING) };
    if (partialSettings.tuning && typeof partialSettings.tuning === 'object') {
      for (const key of Object.keys(DEFAULT_TUNING)) {
        if (partialSettings.tuning[key] !== undefined) {
          next.tuning[key] = clamp(finite(partialSettings.tuning[key], next.tuning[key]), 0, 3);
        }
      }
    }

    const layerPatch = partialSettings.layers && typeof partialSettings.layers === 'object'
      ? partialSettings.layers
      : {};
    next.layers = { ...this.settings.layers };
    for (const name of LAYER_NAMES) {
      if (layerPatch[name] !== undefined) next.layers[name] = Boolean(layerPatch[name]);
      if (partialSettings[name] !== undefined) next.layers[name] = Boolean(partialSettings[name]);
    }

    this.settings = next;
    this._preset = getPresetRecord(next.presetId);
    this._behavior = resolveBehavior(this._preset, next.presetId);
    this._palette = resolvePalette(getPaletteRecord(next.paletteId), next.paletteId);
    this._environment = LabData.ENVIRONMENT_BY_ID?.[next.environment] || {};
    this._timeSetting = LabData.TIME_BY_ID?.[next.timeOfDay] || {};
    this._buildPresetTimeline();
    const nextSignature = `${next.seed}|${next.presetId}|${next.burst}`;
    if (previousSignature !== nextSignature) this._rebuildParticlePool();
    this._stats.quality = next.quality;
    if (this._fluidLive && this._fluidLiveMeta?.selectedTier === next.quality) {
      this._fluidLive.configure(this._fluidSettings(this._fluidLiveMeta.effectiveTier));
    }
    if (this._fluidExport && this._fluidExportMeta?.selectedTier === next.quality) {
      this._fluidExport.configure(this._fluidSettings(this._fluidExportMeta.effectiveTier));
    }
    if (!requestsFluidRenderer(this._preset, next.viewMode)) {
      this.researchCanvas?.classList?.remove('is-active');
    }
    this.resize();
    return this;
  }

  /** Resize the live canvas using a capped device pixel ratio. */
  resize() {
    if (!this.available || this.destroyed || !this.canvas) return false;
    try {
      const rect = typeof this.canvas.getBoundingClientRect === 'function'
        ? this.canvas.getBoundingClientRect()
        : null;
      const width = Math.max(1, Math.round(
        finite(rect?.width, 0)
        || finite(this.canvas.clientWidth, 0)
        || this._cssWidth
        || finite(this.canvas.width, 960),
      ));
      const height = Math.max(1, Math.round(
        finite(rect?.height, 0)
        || finite(this.canvas.clientHeight, 0)
        || this._cssHeight
        || finite(this.canvas.height, 540),
      ));
      const dpr = this._liveDpr(width, height);
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
      if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
      this._cssWidth = width;
      this._cssHeight = height;
      this._dpr = dpr;
      this._stats.dpr = dpr;
      this._stats.width = width;
      this._stats.height = height;
      return true;
    } catch (error) {
      this._recordError(error);
      return false;
    }
  }

  /** Render one deterministic live frame. `time` is elapsed preset seconds. */
  render(time, options = {}) {
    if (!this.available || this.destroyed || !this.canvas || !this.ctx) return false;
    if (!this._cssWidth || !this._cssHeight) this.resize();
    const started = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const success = this._renderInto(
      this.canvas,
      this.ctx,
      finite(time, 0),
      options,
      this._cssWidth,
      this._cssHeight,
      this._dpr,
      true,
    );
    const ended = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    this._updateAdaptiveQuality(Math.max(0, ended - started), ended);
    return success;
  }

  /**
   * Render to an export canvas without resizing or otherwise disturbing the live
   * canvas. Export canvases use one logical pixel per backing-store pixel unless
   * options.pixelRatio/options.logicalWidth/options.logicalHeight are supplied.
   */
  renderTo(targetCanvas, time, options = {}) {
    if (this.destroyed || !targetCanvas) return false;
    const targetContext = safeContext(targetCanvas, { alpha: options.transparent === true });
    if (!targetContext) return false;
    const ratio = clamp(finite(options.pixelRatio, 1), 0.5, 3);
    const width = Math.max(1, finite(options.logicalWidth, targetCanvas.width / ratio || 1));
    const height = Math.max(1, finite(options.logicalHeight, targetCanvas.height / ratio || 1));
    const liveFluidRendered = this._researchFluidRendered;
    try {
      return this._renderInto(
        targetCanvas,
        targetContext,
        finite(time, 0),
        { ...options, exporting: options.exporting !== false },
        width,
        height,
        ratio,
        false,
      );
    } finally {
      // Export owns a separate offscreen fluid engine. Its result must not
      // overwrite the live canvas backend reported by diagnostics or used by
      // the next live composition.
      this._researchFluidRendered = liveFluidRendered;
    }
  }

  /** Accept normalized coordinates, or live-canvas CSS pixel coordinates. */
  setOrigin(x, y) {
    if (this.destroyed) return this;
    let normalizedX = finite(x, this._origin.x);
    let normalizedY = finite(y, this._origin.y);
    if (Math.abs(normalizedX) > 1 || Math.abs(normalizedY) > 1) {
      normalizedX /= Math.max(1, this._cssWidth);
      normalizedY /= Math.max(1, this._cssHeight);
    }
    this._origin.x = clamp(normalizedX, 0.08, 0.92);
    this._origin.y = clamp(normalizedY, 0.16, 0.9);
    return this;
  }

  getStats(options = {}) {
    const fluid = this._fluidLive?.getStats?.(options) || null;
    const fluidMeta = this._fluidLiveMeta;
    const estimatedBytes = finite(fluid?.estimatedGpuBytes, 0);
    const overviewActive = this.settings.viewMode === 'overview';
    const researchRequested = requestsFluidRenderer(this._preset, this.settings.viewMode);
    const fluidActive = researchRequested
      && this._researchFluidRendered
      && Boolean(fluid?.available);
    const fallbackActive = researchRequested && !fluidActive;
    const researchModel = this._preset?.researchModel || {};
    const sourcePrimitives = Array.isArray(fluid?.sourcePrimitives)
      ? [...fluid.sourcePrimitives]
      : Array.isArray(researchModel.sourcePrimitives) ? [...researchModel.sourcePrimitives] : [];
    const fallbackReason = overviewActive
      ? null
      : fluidMeta?.fallbackReason || (fluid && !fluid.available ? fluid.reason : null);
    return {
      ...this._stats,
      activeRenderer: overviewActive
        ? 'ANALYTICAL OVERVIEW'
        : fluidActive ? 'GPU FLUID' : fallbackActive ? 'CANVAS FALLBACK' : 'CANVAS 2D',
      visualizationMode: overviewActive ? 'overview' : 'cinematic',
      rendererFallback: fallbackActive,
      activePreset: this._preset?.name || this.settings.presetId,
      activePresetId: this.settings.presetId,
      eventFamily: fluid?.eventFamily || this._preset?.eventFamily || this._preset?.eventFamilyId || 'Unclassified',
      eventFamilyId: fluid?.eventFamilyId || this._preset?.eventFamilyId || null,
      fluidProfile: fluid?.fluidProfile || fluid?.profileId || researchModel.id || null,
      sourcePrimitives,
      researchRequested,
      webgl2Available: fluid
        ? Boolean(fluid.webgl2Available ?? fluid.available)
        : (researchRequested ? false : null),
      fluidBackend: overviewActive
        ? 'Analytical Overview'
        : fluidActive ? 'WebGL2 fluid' : fallbackActive ? 'Canvas 2D fallback' : 'Canvas 2D',
      fluidRequestedTier: this.settings.quality,
      fluidTier: fluidMeta?.effectiveTier || fluid?.tier || this.settings.quality,
      fluidGrid: fluid?.gridWidth && fluid?.gridHeight ? `${fluid.gridWidth} × ${fluid.gridHeight}` : '—',
      fluidFixedStep: fluid?.fixedStep ?? null,
      fluidStep: fluid?.stepIndex ?? 0,
      pressureIterations: fluid?.pressureIterations ?? null,
      rayMarchSteps: fluid?.raySteps ?? null,
      volumeSlices: fluid?.volumeSlices ?? fluid?.raySteps ?? null,
      tracerCount: fluid?.tracerCount ?? null,
      tracerType: fluid?.tracerType ?? null,
      gpuMemory: estimatedBytes > 0 ? `${(estimatedBytes / 1048576).toFixed(1)} MiB` : '—',
      fluidFallbackReason: fallbackReason,
      fluidResets: fluid?.resets ?? 0,
      fluidDrawCalls: fluid?.drawCalls ?? 0,
      fluidSimulationSteps: fluid?.simulationSteps ?? 0,
      fluidSessionCount: Number(Boolean(this._fluidLive)) + Number(Boolean(this._fluidExport)),
      fieldMetrics: fluid?.metrics || fluid?.fieldMetrics || null,
      renderDomain: fluid?.renderDomain || null,
      shockSmokeAlignment: this._stats.shockSmokeAlignment || null,
      maxVelocity: fluid?.velocityMagnitude ?? null,
      maxTemperature: fluid?.maximumTemperature ?? null,
      maxSmoke: fluid?.smokeDensity ?? null,
      maxVorticity: fluid?.vorticityMagnitude ?? null,
      lastGlError: fluid?.lastGlError ?? null,
    };
  }

  /** Release the reusable offscreen WebGL export session after an export job. */
  releaseExportResources() {
    if (this.destroyed) return false;
    this._disposeResearchEngine(false);
    return this._fluidExport === null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.available = false;
    this.ctx = null;
    this.canvas = null;
    this._glowContext = null;
    this._matterContext = null;
    this._refractionContext = null;
    this._glowCanvas = null;
    this._matterCanvas = null;
    this._refractionCanvas = null;
    this._fluidLive?.destroy?.();
    this._fluidExport?.destroy?.();
    this._fluidLive = null;
    this._fluidExport = null;
    this._fluidLiveMeta = null;
    this._fluidExportMeta = null;
    this.researchCanvas?.classList?.remove('is-active');
    this.researchCanvas = null;
    this._stats.available = false;
  }

  _liveDpr(width, height) {
    const device = finite(globalThis.devicePixelRatio, 1);
    const caps = { mobile: 1, balanced: this.reducedMotion ? 1.25 : 1.5, high: 2 };
    let dpr = Math.min(device, caps[this.settings.quality] || 2);
    // A hard backing-store limit avoids pathological memory use on tall/high-DPR screens.
    const longest = Math.max(width, height);
    if (longest * dpr > 4096) dpr = 4096 / longest;
    const areaLimit = 5_500_000;
    if (width * height * dpr * dpr > areaLimit) dpr = Math.sqrt(areaLimit / (width * height));
    return clamp(dpr, 0.2, 2);
  }

  _qualityScale(isLive, options) {
    if (Number.isFinite(options.qualityScale)) return clamp(options.qualityScale, 0.25, 1);
    const selected = { mobile: 0.42, balanced: 0.7 * this._adaptiveScale, high: 1 };
    // Export is fixed and deterministic; callers can explicitly request a lower scale.
    if (!isLive && this.settings.quality === 'balanced') return 0.7;
    return selected[this.settings.quality] || 1;
  }

  _updateAdaptiveQuality(frameCost, frameStamp) {
    const previous = this._stats.frameMs || frameCost;
    this._stats.frameMs = lerp(previous, frameCost, 0.08);
    if (this._lastFrameStamp > 0) {
      const delta = frameStamp - this._lastFrameStamp;
      if (delta > 0 && delta < 1000) {
        const fps = 1000 / delta;
        this._stats.fps = lerp(this._stats.fps || fps, fps, 0.08);
      }
    }
    this._lastFrameStamp = frameStamp;

    // Adaptive quality changes particle/lobe density slowly, never simulation state.
    if (this.settings.quality !== 'balanced') return;
    if (this._stats.frameMs > 21) {
      this._slowFrames += 1;
      this._fastFrames = 0;
    } else if (this._stats.frameMs < 13.5) {
      this._fastFrames += 1;
      this._slowFrames = 0;
    } else {
      this._slowFrames = Math.max(0, this._slowFrames - 1);
      this._fastFrames = Math.max(0, this._fastFrames - 1);
    }
    if (this._slowFrames > 18) {
      this._adaptiveScale = Math.max(0.38, this._adaptiveScale - 0.09);
      this._slowFrames = 0;
    } else if (this._fastFrames > 90) {
      this._adaptiveScale = Math.min(1, this._adaptiveScale + 0.05);
      this._fastFrames = 0;
    }
    this._stats.adaptiveScale = this._adaptiveScale;
  }

  _recordError(error) {
    this._stats.error = error instanceof Error ? error.message : String(error || 'Canvas render failed.');
  }

  _fluidSettings(tier = this.settings.quality) {
    const render = this._preset?.render || {};
    const researchModel = this._preset?.researchModel || {};
    const detailDensity = clamp(this.settings.density / 100, 0.35, 1.4);
    const palette = {
      id: this._palette.id,
      background: this._palette.skyTop,
      flash: this._palette.core,
      core: this._palette.core,
      hot: this._palette.hot,
      flame: this._palette.flame,
      ember: this._palette.ember,
      smoke: this._palette.smoke,
      smokeLight: this._palette.smokeLight,
      cloud: this._palette.cloud,
      dust: this._palette.dust,
      shock: this._palette.shock,
      plasma: this._palette.plasma,
      thermal: this._palette.thermal,
    };
    return {
      presetId: this.settings.presetId,
      profileId: researchModel.id || this.settings.presetId,
      eventFamily: this._preset?.eventFamily || this._preset?.eventFamilyId || 'Unclassified',
      eventFamilyId: this._preset?.eventFamilyId || researchModel.familyId || null,
      physicalFamilyId: this._preset?.physicalFamilyId || this._preset?.eventFamilyId || researchModel.familyId || null,
      sourcePrimitives: Array.isArray(researchModel.sourcePrimitives)
        ? [...researchModel.sourcePrimitives]
        : [],
      paletteId: this._palette.id,
      palette,
      seed: this.settings.seed,
      energy: this.settings.energy,
      altitude: Math.abs(this.settings.altitude) <= 1 ? this.settings.altitude : this.settings.altitude / 100,
      windDirection: this.settings.windDirection,
      windStrength: this.settings.windStrength,
      duration: Math.max(5, finite(this._preset?.duration, this._behavior.duration)),
      reducedMotion: this.reducedMotion,
      sourceStrength: clamp(
        (0.72 + finite(render.fireballRadius, 1) * 0.22)
          * lerp(0.72, 1.14, (detailDensity - 0.35) / 1.05),
        0.4,
        1.5,
      ),
      buoyancy: clamp(0.5 + finite(render.columnRise, 1) * 0.13, 0.45, 0.82),
      densityLoading: clamp(0.1 + finite(render.smoke, 1) * 0.055, 0.08, 0.25),
      cooling: clamp(0.17 + finite(render.smoke, 1) * 0.035, 0.14, 0.34),
      smokeConversion: clamp(0.58 + finite(render.smoke, 1) * 0.18, 0.52, 0.96),
      // Longer events keep their particulate aloft longer, so cloud lifetime
      // scales with the preset timeline instead of one universal fade rate.
      dissipation: clamp(
        0.998 + finite(this._preset?.duration, 12) * 0.00003,
        0.997,
        0.9995,
      ),
      tier: QUALITY_ALIASES[tier] || 'balanced',
      diagnostic: this.settings.diagnostic,
      debugMetrics: Boolean(this.settings.debugMetrics),
      exposureBoost: clamp(finite(this.settings.tuning?.exposure, 1), 0.5, 1.6),
      capWidthBoost: clamp(finite(this.settings.tuning?.capWidth, 1), 0.6, 1.6),
      stemWidthBoost: clamp(finite(this.settings.tuning?.stemThickness, 1), 0.6, 1.6),
    };
  }

  _disposeResearchEngine(isLive) {
    const engineKey = isLive ? '_fluidLive' : '_fluidExport';
    const metaKey = isLive ? '_fluidLiveMeta' : '_fluidExportMeta';
    this[engineKey]?.destroy?.();
    this[engineKey] = null;
    this[metaKey] = null;
  }

  _createResearchEngine(isLive) {
    const selectedTier = QUALITY_ALIASES[this.settings.quality] || 'balanced';
    const candidates = FLUID_TIER_FALLBACKS[selectedTier] || FLUID_TIER_FALLBACKS.balanced;
    const engineKey = isLive ? '_fluidLive' : '_fluidExport';
    const metaKey = isLive ? '_fluidLiveMeta' : '_fluidExportMeta';
    const failures = [];
    let retainedEngine = null;

    for (const candidateTier of candidates) {
      retainedEngine?.destroy?.();
      retainedEngine = null;
      let candidateEngine = null;
      try {
        candidateEngine = new ResearchFluidEngine({
          ...(isLive ? {
            canvas: this.researchCanvas,
            width: Math.max(1, Math.round(this._cssWidth * this._dpr)),
            height: Math.max(1, Math.round(this._cssHeight * this._dpr)),
          } : {}),
          settings: this._fluidSettings(candidateTier),
          tier: candidateTier,
        });
      } catch (error) {
        failures.push({ tier: candidateTier, reason: error?.message || String(error) });
        continue;
      }

      const stats = candidateEngine.getStats?.() || {};
      if (stats.available) {
        retainedEngine = candidateEngine;
        const firstFailure = failures[0];
        this[engineKey] = retainedEngine;
        this[metaKey] = {
          selectedTier,
          effectiveTier: candidateTier,
          fallbackReason: firstFailure
            ? `${firstFailure.tier} tier was unavailable; using ${candidateTier}. ${String(firstFailure.reason).slice(0, 180)}`
            : null,
        };
        return retainedEngine;
      }

      failures.push({
        tier: candidateTier,
        reason: stats.reason || 'The WebGL2 fluid tier could not be initialized.',
      });
      retainedEngine = candidateEngine;
    }

    this[engineKey] = retainedEngine;
    this[metaKey] = {
      selectedTier,
      effectiveTier: candidates[candidates.length - 1],
      fallbackReason: failures
        .map(({ tier, reason }) => `${tier}: ${String(reason).slice(0, 140)}`)
        .join(' · ') || 'No WebGL2 fluid tier could be initialized.',
      failed: true,
    };
    return retainedEngine;
  }

  _ensureResearchEngine(isLive) {
    if (!requestsFluidRenderer(this._preset, this.settings.viewMode)) return null;
    if (isLive && !this.researchCanvas) return null;

    const engineKey = isLive ? '_fluidLive' : '_fluidExport';
    const metaKey = isLive ? '_fluidLiveMeta' : '_fluidExportMeta';
    const selectedTier = QUALITY_ALIASES[this.settings.quality] || 'balanced';
    const engine = this[engineKey];
    const meta = this[metaKey];
    if (engine && !engine.destroyed && meta?.selectedTier === selectedTier) return engine;
    if (!engine && meta?.failed && meta.selectedTier === selectedTier) return null;

    this._disposeResearchEngine(isLive);
    return this._createResearchEngine(isLive);
  }

  _renderResearchFluid(engine, time, width, height, dpr, layout, phase) {
    if (!engine) return false;
    const outputScale = clamp(finite(engine.getRenderResolutionScale?.(), 1), 0.55, 1);
    const outputWidth = Math.max(1, Math.round(width * dpr * outputScale));
    const outputHeight = Math.max(1, Math.round(height * dpr * outputScale));
    const scaleX = outputWidth / Math.max(1, width);
    const scaleY = outputHeight / Math.max(1, height);
    const meta = engine === this._fluidLive ? this._fluidLiveMeta : this._fluidExportMeta;
    const effectiveTier = meta?.effectiveTier || this.settings.quality;
    engine.configure(this._fluidSettings(effectiveTier));
    return engine.render({
      time,
      width: outputWidth,
      height: outputHeight,
      quality: effectiveTier,
      diagnostic: this.settings.diagnostic,
      debugMetrics: Boolean(this.settings.debugMetrics),
      layerVisibility: [
        Number(this.settings.layers.fireball),
        Number(this.settings.layers.cloud),
        Number(this.settings.layers.dust),
        Number(this.settings.layers.thermal),
      ],
      phase,
      layout: {
        ...layout,
        width: outputWidth,
        height: outputHeight,
        // The Canvas scene applies its brief camera impulse as a transform. The
        // stacked WebGL canvas cannot inherit that transform, so bake the same
        // deterministic offset into the volume placement for live and export.
        originX: (layout.originX + layout.shakeX) * scaleX,
        originY: (layout.originY + layout.shakeY) * scaleY,
        eventY: (layout.eventY + layout.shakeY) * scaleY,
        surfaceY: (layout.surfaceY + layout.shakeY) * scaleY,
      },
    });
  }

  _buildPresetTimeline() {
    this._presetTimeline = [];
    this._phaseById = Object.create(null);
    try {
      if (typeof LabData.buildPhaseTimeline === 'function' && Array.isArray(this._preset.phases)) {
        this._presetTimeline = LabData.buildPhaseTimeline(this._preset);
      } else if (Array.isArray(this._preset.phases)) {
        this._presetTimeline = this._preset.phases;
      }
    } catch (_) {
      this._presetTimeline = Array.isArray(this._preset.phases) ? this._preset.phases : [];
    }
    for (const phase of this._presetTimeline) this._phaseById[phase.id] = phase;
  }

  _rebuildParticlePool() {
    const signature = `${this.settings.seed}|${this.settings.presetId}|${this.settings.burst}`;
    if (signature === this._poolSignature) return;
    this._poolSignature = signature;
    const rng = mulberry32((this.settings.seed ^ hashString(signature)) >>> 0);
    const duration = Math.max(1, this._behavior.duration);
    const behavior = this._behavior;

    // Particle lifecycle parameters live in fixed typed arrays and are evaluated
    // analytically at render time. No particle is ever pushed, spliced, or spawned.
    for (let index = 0; index < MAX_PARTICLES; index += 1) {
      const selector = rng();
      let kind;
      if (selector < 0.2 * behavior.debris / Math.max(0.4, behavior.debris + behavior.cloud)) kind = 2;
      else if (selector < 0.32) kind = 1;
      else if (selector < 0.56) kind = 3;
      else if (selector < 0.82) kind = 4;
      else if (selector < 0.93) kind = behavior.electrical ? 5 : 0;
      else kind = 6;
      if (behavior.key === 'volcanic' && selector > 0.6) kind = 6;
      this._particleKind[index] = kind;

      const randomStart = rng();
      if (kind === 0 || kind === 5) this._particleStart[index] = duration * (0.015 + randomStart * 0.18);
      else if (kind === 1 || kind === 2) this._particleStart[index] = duration * (0.035 + randomStart * 0.24);
      else if (kind === 3) this._particleStart[index] = duration * (behavior.riseStart + randomStart * 0.36);
      else this._particleStart[index] = duration * (behavior.cloudStart + randomStart * 0.34);

      const baseLife = kind <= 2 ? 0.24 : kind === 3 ? 0.52 : 0.68;
      this._particleLife[index] = duration * (baseLife + rng() * (kind <= 2 ? 0.22 : 0.38));
      this._particleAngle[index] = rng() * TAU;
      this._particleSpeed[index] = 0.35 + rng() * rng() * 1.35;
      this._particleRise[index] = 0.25 + rng() * 1.15;
      this._particleSize[index] = 0.35 + rng() * rng() * 1.8;
      this._particlePhase[index] = rng() * TAU;
      this._particleBias[index] = rng() * 2 - 1;
      this._particleDepth[index] = rng();
    }

    // A second tiny fixed pool describes broad cloud lobes; fine particles sit on top.
    for (let index = 0; index < MAX_CLOUD_LOBES; index += 1) {
      const angle = rng() * TAU;
      const radius = Math.sqrt(rng());
      this._lobeX[index] = Math.cos(angle) * radius;
      this._lobeY[index] = Math.sin(angle) * radius;
      this._lobeSize[index] = 0.55 + rng() * 0.8;
      this._lobePhase[index] = rng() * TAU;
    }
  }

  _prepareLayers(pixelWidth, pixelHeight, dpr) {
    if (!this._glowCanvas || !this._matterCanvas || !this._refractionCanvas
      || !this._glowContext || !this._matterContext || !this._refractionContext) return false;
    if (pixelWidth !== this._layerWidth || pixelHeight !== this._layerHeight) {
      this._glowCanvas.width = pixelWidth;
      this._glowCanvas.height = pixelHeight;
      this._matterCanvas.width = pixelWidth;
      this._matterCanvas.height = pixelHeight;
      this._refractionCanvas.width = pixelWidth;
      this._refractionCanvas.height = pixelHeight;
      this._layerWidth = pixelWidth;
      this._layerHeight = pixelHeight;
    }
    for (const context of [this._glowContext, this._matterContext]) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, pixelWidth, pixelHeight);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.filter = 'none';
      context.setLineDash([]);
    }
    return true;
  }

  _renderInto(canvas, context, time, options, width, height, dpr, isLive) {
    try {
      const safeTime = clamp(time, 0, Math.max(1, this._behavior.duration));
      const pixelWidth = Math.max(1, canvas.width || Math.round(width * dpr));
      const pixelHeight = Math.max(1, canvas.height || Math.round(height * dpr));
      const quality = this._qualityScale(isLive, options);
      const budgets = this._preset.particleBudget || {};
      let particleBudget = this._behavior.particles * quality;
      if (!Number.isFinite(options.qualityScale)) {
        if (this.settings.quality === 'mobile') particleBudget = finite(budgets.low, this._behavior.particles * 0.45);
        else if (this.settings.quality === 'balanced') {
          particleBudget = lerp(
            finite(budgets.low, this._behavior.particles * 0.5),
            finite(budgets.balanced, this._behavior.particles),
            0.68,
          );
        } else if (this.settings.quality === 'high') particleBudget = finite(budgets.high, this._behavior.particles * 1.65);
      }
      this._stats.qualityScale = quality;
      const activeCount = Math.min(
        MAX_PARTICLES,
        Math.max(80, Math.round(particleBudget * (this.settings.density / 100))),
      );
      this._stats.particleCount = activeCount;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.filter = 'none';
      if (options.clear !== false) context.clearRect(0, 0, pixelWidth, pixelHeight);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const phase = this._calculateTimeline(safeTime);
      const layout = this._calculateLayout(width, height, phase, options);
      const fluidEngine = this._ensureResearchEngine(isLive);
      this._researchFluidRendered = Boolean(
        fluidEngine
        && this._renderResearchFluid(fluidEngine, safeTime, width, height, dpr, layout, phase),
      );
      const renderDomain = fluidEngine?.getStats?.().renderDomain;
      if (renderDomain?.volumeScale && renderDomain?.sourceCenter) {
        const [sourceX, sourceY] = renderDomain.sourceCenter;
        const [scaleX, scaleY] = renderDomain.volumeScale;
        const shock = this._shockGroundFront(layout, phase);
        const shockRadius = shock.radius * dpr;
        const renderRadiusX = Math.min(sourceX, 1 - sourceX) * scaleX * pixelWidth;
        const renderRadiusY = Math.min(sourceY, 1 - sourceY) * scaleY * pixelHeight;
        this._stats.shockSmokeAlignment = {
          shockRadius,
          renderRadiusX,
          renderRadiusY,
          // Ground-coupled pressure travels primarily along the surface, so
          // compare its event-space radius with the horizontal render extent.
          // Keep the vertical ratio visible for diagnostics without treating
          // the physically lower smoke column as a clipped shock mismatch.
          shockToRenderRadius: shockRadius / Math.max(1, renderRadiusX),
          shockToVerticalRadius: shockRadius / Math.max(1, renderRadiusY),
          viewportCropsNaturally: shockRadius > Math.max(pixelWidth, pixelHeight),
        };
      } else {
        this._stats.shockSmokeAlignment = null;
      }
      const fluidExportRequired = !isLive
        && options.exporting === true
        && requestsFluidRenderer(this._preset, this.settings.viewMode);
      if (fluidExportRequired && !this._researchFluidRendered) {
        const fluidStats = fluidEngine?.getStats?.() || {};
        throw new Error(
          `Research fluid export unavailable: ${fluidStats.reason || this._fluidExportMeta?.fallbackReason || 'WebGL2 fluid initialization failed.'}`,
        );
      }
      if (isLive) {
        this.researchCanvas?.classList?.toggle('is-active', this._researchFluidRendered);
      }
      const hasLayers = this.settings.viewMode === 'cinematic'
        ? this._prepareLayers(pixelWidth, pixelHeight, dpr)
        : false;

      context.save();
      if (layout.shakeX || layout.shakeY) context.translate(layout.shakeX, layout.shakeY);
      this._drawBackground(context, layout, phase, options);

      if (requestsFluidRenderer(this._preset, this.settings.viewMode)
        && this.settings.diagnostic === 'beauty'
        && this.settings.layers.shock) {
        this._drawResearchRefraction(context, canvas, layout, phase, dpr);
      }

      if (this.settings.viewMode === 'overview') {
        this._drawOverview(context, layout, phase, activeCount, quality);
      } else if (hasLayers) {
        this._drawCinematicLayers(
          context,
          this._glowContext,
          this._matterContext,
          layout,
          phase,
          activeCount,
          quality,
        );
      } else {
        // Graceful fallback for unusual Canvas implementations without scratch canvases.
        this._drawCinematicLayers(context, context, context, layout, phase, activeCount, quality, true);
      }
      context.restore();

      // Export uses the exact same stateful WebGL solver as live playback. Its
      // reusable offscreen canvas is composited only after the Canvas camera
      // transform because the fluid placement already includes that offset.
      if (this._researchFluidRendered && !isLive && fluidEngine?.canvas) {
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalCompositeOperation = 'source-over';
        context.drawImage(fluidEngine.canvas, 0, 0, pixelWidth, pixelHeight);
        context.restore();
      }

      if (options.includeHUD || options.includeInterface) this._drawExportHud(context, layout, phase, safeTime);
      if (options.watermark) this._drawWatermark(context, layout);
      this._stats.error = null;
      return true;
    } catch (error) {
      this._recordError(error);
      try {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = '#08090d';
        context.fillRect(0, 0, canvas.width || 1, canvas.height || 1);
      } catch (_) {
        // Nothing else can be done if the target itself has become invalid.
      }
      return false;
    }
  }

  _calculateTimeline(time) {
    const duration = Math.max(1, this._behavior.duration);
    const t = clamp(time / duration, 0, 1);
    const behavior = this._behavior;
    if (this._presetTimeline.length) {
      const phase = (id) => this._phaseById[id] || null;
      const progress = (id, fallback = 0) => {
        const entry = phase(id);
        if (!entry) return fallback;
        if (typeof LabData.getPhaseProgress === 'function') return LabData.getPhaseProgress(entry, time);
        return saturate((time - entry.start) / Math.max(Number.EPSILON, entry.end - entry.start));
      };
      const weight = (id, fallback = 0, edge = 0.14) => {
        const entry = phase(id);
        if (!entry) return fallback;
        if (typeof LabData.phaseWeight === 'function') return LabData.phaseWeight(entry, time, edge);
        const value = progress(id);
        return phaseEnvelope(value, edge, 1 - edge, 1) * finite(entry.intensity, 1);
      };
      const onset = weight('detonation', 0, 0.08);
      const flashWeight = Math.max(weight('peak-flash', 0, 0.1), onset * 0.7);
      const fireProgress = progress('fireball-expansion', saturate(t / Math.max(0.05, behavior.fireEnd)));
      const fireWeight = phase('fireball-expansion')
        ? weight('fireball-expansion', 0, 0.11)
        : (1 - smoothstep(behavior.fireEnd * 0.62, Math.min(0.8, behavior.fireEnd * 1.55), t));
      const shockProgress = progress('shock-front', easeOutCubic(saturate((t - 0.015) / 0.55)));
      const shockAlpha = phase('shock-front')
        ? weight('shock-front', 0, 0.09)
        : (1 - smoothstep(0.18, 0.82, t)) * smoothstep(0.008, 0.035, t);
      const surface = Math.max(
        weight('surface-interaction', 0, 0.08),
        weight('dust-debris', 0, 0.1) * 0.84,
      );
      const rise = progress('column-rise', easeOutCubic(saturate((t - behavior.riseStart) / Math.max(0.1, 0.72 - behavior.riseStart))));
      const cloudProgress = Math.max(
        progress('cloud-formation', 0),
        progress('mushroom-development', 0) * 0.9,
      );
      const cloud = phase('cloud-formation') || phase('mushroom-development')
        ? cloudProgress * (1 - 0.45 * progress('dissipation', 0))
        : smoothstep(behavior.cloudStart, Math.min(0.82, behavior.cloudStart + 0.25), t)
          * (1 - 0.45 * smoothstep(0.82, 1, t));
      const dissipation = progress('dissipation', smoothstep(0.66, 1, t));
      let current = null;
      for (const entry of this._presetTimeline) {
        if (time >= entry.start && time <= entry.end) current = entry;
      }
      Object.assign(this._phase, {
        time,
        normalized: t,
        duration,
        currentPhaseId: current?.id || (t <= 0 ? null : 'dissipation'),
        flash: this.reducedMotion
          ? Math.min(0.34, flashWeight * behavior.flash * 0.28)
          : flashWeight * behavior.flash,
        fireGrowth: easeOutExpo(saturate(fireProgress * behavior.fireGrowth)),
        fireAlpha: saturate(fireWeight),
        shockProgress: easeOutCubic(shockProgress),
        shockAlpha: saturate(shockAlpha),
        surface: saturate(surface),
        rise: saturate(rise),
        cloud: saturate(cloud),
        dissipation: saturate(dissipation),
      });
      this._stats.phase = this._phase.currentPhaseId;
      return this._phase;
    }

    const flashAttack = behavior.key === 'volcanic' ? 0.02 : 0.008;
    const flashEnd = behavior.key === 'volcanic' ? 0.12 : 0.1;
    const flash = phaseEnvelope(t, flashAttack, 0.018, flashEnd) * behavior.flash;
    const fireGrowth = easeOutExpo(saturate(t / Math.max(0.035, behavior.fireEnd * 0.55)));
    const fireFade = behavior.sustained
      ? 0.55 + 0.45 * (1 - smoothstep(0.7, 1, t))
      : 1 - smoothstep(behavior.fireEnd * 0.62, Math.min(0.78, behavior.fireEnd * 1.55), t);
    const shockProgress = easeOutCubic(saturate((t - 0.015) / 0.55));
    const shockAlpha = (1 - smoothstep(0.18, 0.82, t)) * smoothstep(0.008, 0.035, t);
    const surface = phaseEnvelope(t, 0.035, 0.2, 0.67);
    const rise = easeOutCubic(saturate((t - behavior.riseStart) / Math.max(0.1, 0.72 - behavior.riseStart)));
    const cloud = smoothstep(behavior.cloudStart, Math.min(0.82, behavior.cloudStart + 0.25), t)
      * (1 - 0.45 * smoothstep(0.82, 1, t));
    const dissipation = smoothstep(0.66, 1, t);
    Object.assign(this._phase, {
      time,
      normalized: t,
      duration,
      flash: this.reducedMotion ? Math.min(0.34, flash * 0.28) : flash,
      fireGrowth,
      fireAlpha: saturate(fireFade),
      shockProgress,
      shockAlpha: saturate(shockAlpha),
      surface,
      rise,
      cloud,
      dissipation,
      currentPhaseId: null,
    });
    return this._phase;
  }

  _calculateLayout(width, height, phase, options) {
    // Cube-root-style scaling preserves broad visual relationships without implying units.
    const energyScale = typeof LabData.cubeRootScale === 'function'
      ? LabData.cubeRootScale(this.settings.energy, 1)
      : Math.cbrt(Math.max(0.05, this.settings.energy));
    // Divisor and the 180 reference point are unchanged from the original
    // formula, so every distance <=180 (the old hard ceiling) renders
    // identically to before. Only the floor is lowered, giving the
    // previously-unreachable 180-220 headroom (camera-sensitivity pass, wider
    // per-family pullback) real visual effect instead of clamping to a no-op.
    const cameraScale = clamp(1.55 - this.settings.cameraDistance / 180, 0.40, 1.35);
    // Automatic pullback on narrow (portrait) viewports: large events keep
    // their full silhouette inside the padded render domain instead of
    // walling against its sides. Landscape and desktop framing (aspect >= 1)
    // is unchanged.
    const aspectPullback = clamp(0.62 + 0.38 * (width / Math.max(1, height)), 0.75, 1);
    const tunedPullback = clamp(finite(this.settings.tuning?.cameraPullback, 1), 0.6, 1.4);
    // A research profile may reserve a little extra headroom only for the
    // compact/mobile portrait projection. It is a composition pullback, not
    // a source or volume adjustment, so the field, dense shock counts, and
    // all desktop/tablet framing remain intact.
    const mobilePortrait = this.settings.quality === 'mobile' && height > width;
    const profilePortraitPullback = mobilePortrait
      ? clamp(finite(this._preset?.researchModel?.mobilePortraitPullback, 1), 1, 1.2)
      : 1;
    const scale = energyScale * this._behavior.scale * cameraScale * aspectPullback
      / (tunedPullback * profilePortraitPullback);
    // Coefficients strengthened ~1.6x (camera-sensitivity pass) so a given
    // drag produces noticeably more visible parallax; at cameraAngle === 0
    // (the default/reset state) both terms are still exactly zero, so idle
    // and freshly-reset framing is bit-for-bit unchanged.
    const angleOffset = (this.settings.cameraAngle / 45) * width * 0.056;
    const originX = this._origin.x * width + angleOffset;
    const burst = String(this.settings.burst).toLowerCase();
    const normalizedAltitude = Math.abs(this.settings.altitude) <= 1
      ? this.settings.altitude
      : this.settings.altitude / 100;
    const elevated = burst.includes('air')
      || burst.includes('atmos')
      || burst.includes('hover')
      || ['meteorAir', 'nuclearAir', 'extreme', 'plasma'].includes(this._behavior.key);
    const portraitOriginY = mobilePortrait
      ? clamp(finite(this._preset?.mobilePortraitOriginY, this._origin.y), 0.4, 0.82)
      : this._origin.y;
    const surfaceY = clamp(portraitOriginY * height + (this.settings.cameraAngle / 45) * height * 0.04, height * 0.58, height * 0.88);
    const buried = burst.includes('under')
      || burst.includes('subsurface')
      || normalizedAltitude < -0.04
      || this._behavior.key === 'underground';
    const altitudeOffset = elevated ? height * (0.035 + Math.max(0, normalizedAltitude) * 0.22) : 0;
    const burialOffset = height * (0.012 + Math.abs(Math.min(0, normalizedAltitude)) * 0.12);
    const eventY = buried ? surfaceY + burialOffset : surfaceY - altitudeOffset;
    const windAngle = this.settings.windDirection * Math.PI / 180;
    const windStrength = this.settings.windStrength / 100;
    const windResponse = this._behavior.windResponse || 0.7;
    const windX = Math.sin(windAngle) * windStrength * windResponse;
    const windY = -Math.cos(windAngle) * windStrength * 0.2 * windResponse;
    let shakeX = 0;
    let shakeY = 0;
    if (this.settings.viewMode !== 'overview' && !this.reducedMotion && options.disableShake !== true) {
      const decay = Math.exp(-phase.time * 2.15) * smoothstep(0.015, 0.055, phase.normalized);
      const amplitude = Math.min(width, height) * 0.006 * this._behavior.shake * energyScale * decay;
      const seedPhase = (this.settings.seed % 997) / 997 * TAU;
      shakeX = Math.sin(phase.time * 37 + seedPhase) * amplitude;
      shakeY = Math.sin(phase.time * 49 + seedPhase * 1.71) * amplitude * 0.48;
    }
    Object.assign(this._layout, {
      width,
      height,
      min: Math.min(width, height),
      scale,
      energyScale,
      cameraScale,
      originX,
      originY: this.settings.viewMode === 'overview' ? this._origin.y * height : eventY,
      eventY,
      surfaceY,
      windX,
      windY,
      windStrength,
      shakeX,
      shakeY,
      buried,
      elevated,
    });
    return this._layout;
  }

  _drawBackground(context, layout, phase, options) {
    const palette = this._palette;
    const { width, height, surfaceY } = layout;
    const time = String(this.settings.timeOfDay).toLowerCase();
    let skyTop = this._timeSetting.skyTop || palette.skyTop;
    let skyBottom = this._timeSetting.skyBottom || palette.skyBottom;
    if (!this._timeSetting.skyTop && time.includes('day') && !time.includes('night')) {
      skyTop = '#162837';
      skyBottom = '#765c49';
    } else if (!this._timeSetting.skyTop && time.includes('night')) {
      skyTop = '#03050a';
      skyBottom = '#141a25';
    } else if (!this._timeSetting.skyTop && time.includes('dawn')) {
      skyTop = '#171726';
      skyBottom = '#865644';
    }
    const sky = context.createLinearGradient(0, -12, 0, surfaceY + 10);
    sky.addColorStop(0, skyTop);
    sky.addColorStop(0.76, skyBottom);
    sky.addColorStop(1, palette.horizon);
    context.fillStyle = sky;
    context.fillRect(-12, -12, width + 24, surfaceY + 24);

    const starOpacity = finite(this._timeSetting.starOpacity, time.includes('night') ? 0.72 : 0);
    if (starOpacity > 0) {
      context.fillStyle = colorWithAlpha(palette.text, starOpacity * 0.48);
      const stars = this.settings.quality === 'mobile' ? 18 : 38;
      for (let index = 0; index < stars; index += 1) {
        const value = hashString(`${this.settings.seed}:star:${index}`);
        const x = (value % 1009) / 1009 * width;
        const y = ((value >>> 10) % 977) / 977 * surfaceY * 0.68;
        const radius = 0.35 + ((value >>> 20) & 3) * 0.18;
        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        context.fill();
      }
    }

    if (this.settings.viewMode === 'overview') {
      context.fillStyle = colorWithAlpha(palette.ground, options.transparent ? 0.9 : 1);
      context.fillRect(-12, -12, width + 24, height + 24);
      return;
    }

    this._drawEnvironmentSilhouette(context, layout, phase);
    const environmentGround = this._environment.ground || palette.ground;
    const environmentHorizon = this._environment.horizon || palette.groundLight;
    const environment = String(this.settings.environment).toLowerCase();
    // The bright horizon seam is softened on natural terrain so the ground
    // reads as receding land, not a lit strip.
    const naturalGround = !environment.includes('grid');
    const ground = context.createLinearGradient(0, surfaceY, 0, height + 12);
    ground.addColorStop(0, colorWithAlpha(environmentHorizon, naturalGround ? 0.16 : 0.64));
    ground.addColorStop(naturalGround ? 0.04 : 0.08, environmentGround);
    ground.addColorStop(1, '#030405');
    context.fillStyle = ground;
    context.fillRect(-12, surfaceY, width + 24, height - surfaceY + 24);

    // The analytical reference grid belongs to the scientific dark-grid stage
    // and the overview mode. On cinematic natural terrain it read as a
    // prototype artifact, so it is suppressed there.
    if (this.settings.layers.grid && !naturalGround) this._drawPerspectiveGrid(context, layout);

    // Qualitative atmospheric darkening: heavy particulate phases pull the sky
    // down so the luminous core and cloud silhouette gain local contrast.
    const smokeLoad = saturate(
      phase.cloud * this._behavior.smoke * 0.4 + phase.surface * this._behavior.dust * 0.2,
    ) * (1 - phase.dissipation * 0.6);
    if (smokeLoad > 0.02 && this.settings.viewMode !== 'overview') {
      const darkening = context.createLinearGradient(0, 0, 0, surfaceY);
      darkening.addColorStop(0, `rgba(2,3,5,${(smokeLoad * 0.34).toFixed(3)})`);
      darkening.addColorStop(0.7, `rgba(2,3,5,${(smokeLoad * 0.16).toFixed(3)})`);
      darkening.addColorStop(1, 'rgba(2,3,5,0)');
      context.fillStyle = darkening;
      context.fillRect(-12, -12, width + 24, surfaceY + 24);
    }
  }

  /**
   * Fictional environment silhouettes with foreground/middle/background depth
   * plus a stylized, qualitative environmental response driven by the phase.
   * Nothing here maps to a real place, structure, or engineering quantity.
   */
  _drawEnvironmentSilhouette(context, layout, phase = this._phase) {
    const environment = String(this.settings.environment).toLowerCase();
    context.save();
    if (environment.includes('city') || environment.includes('urban')) {
      this._drawCityEnvironment(context, layout, phase);
    } else if (environment.includes('mountain') || environment.includes('valley')) {
      this._drawMountainEnvironment(context, layout, phase);
    } else if (environment.includes('ocean') || environment.includes('water')) {
      this._drawOceanEnvironment(context, layout, phase);
    } else if (environment.includes('desert')) {
      this._drawDesertEnvironment(context, layout, phase);
    } else if (environment.includes('grid')) {
      this._drawGridEnvironment(context, layout, phase);
    } else {
      this._drawRangeEnvironment(context, layout, phase);
    }
    context.restore();
  }

  /** Normalized ground-track of the pressure front used by response effects. */
  _shockGroundFront(layout, phase) {
    const maxRadius = layout.min * (0.58 + this._behavior.shock * 0.16) * layout.energyScale;
    return {
      radius: maxRadius * phase.shockProgress,
      active: phase.shockAlpha > 0.008 || phase.shockProgress > 0.02,
      strength: saturate(phase.shockAlpha * clamp(this._behavior.shock, 0.2, 2.2)),
    };
  }

  /** Layered fictional skyline (working name: Meridian City). */
  _drawCityEnvironment(context, layout, phase) {
    const { width, height, surfaceY } = layout;
    const tuning = this.settings.tuning || DEFAULT_TUNING;
    const angleShift = this.settings.cameraAngle * 1.6;
    const ambient = finite(this._timeSetting.ambient, 0.4);
    const night = ambient < 0.5;
    const detail = clamp(tuning.environmentDetail * tuning.cityDensity, 0.3, 2);
    const mobile = this.settings.quality === 'mobile';
    const front = this._shockGroundFront(layout, phase);
    const response = saturate(front.strength * clamp(tuning.structureResponse, 0, 2))
      * saturate(this._behavior.shock);
    const groundColor = this._environment.ground || this._palette.ground;
    const hazeColor = this._environment.horizon || this._palette.horizon;
    const eventGlow = saturate(phase.flash * 0.8 + phase.fireAlpha * 0.35);

    // Atmospheric haze band above the skyline.
    const haze = context.createLinearGradient(0, surfaceY - height * 0.15, 0, surfaceY);
    haze.addColorStop(0, colorWithAlpha(hazeColor, 0));
    haze.addColorStop(1, colorWithAlpha(hazeColor, night ? 0.16 : 0.24));
    context.fillStyle = haze;
    context.fillRect(-12, surfaceY - height * 0.15, width + 24, height * 0.15);

    const layers = [
      { count: Math.round(52 * detail), minH: 0.018, maxH: 0.05, alpha: night ? 0.42 : 0.5, widthMin: 7, widthMax: 18, salt: 'far', detail: false, shift: angleShift * 0.4 },
      { count: Math.round(34 * detail), minH: 0.03, maxH: 0.085, alpha: 0.78, widthMin: 11, widthMax: 26, salt: 'mid', detail: !mobile, shift: angleShift * 0.7 },
      { count: Math.round(20 * detail), minH: 0.05, maxH: 0.135, alpha: 1, widthMin: 16, widthMax: 40, salt: 'near', detail: !mobile, shift: angleShift },
    ];

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
      const layer = layers[layerIndex];
      const near = layerIndex === 2;
      let x = -34 + layer.shift;
      for (let index = 0; index < layer.count && x < width + 34; index += 1) {
        const hash = hashString(`${this.settings.seed}:${layer.salt}:${index}`);
        const buildingWidth = layer.widthMin + (hash % (layer.widthMax - layer.widthMin));
        const buildingHeight = height * (layer.minH + ((hash >>> 8) % 1000) / 1000 * (layer.maxH - layer.minH));
        const centerX = x + buildingWidth / 2;
        const distanceFromEvent = Math.abs(centerX - layout.originX);

        // Stylized pressure response: brief sway + facade dimming once the
        // ground front has passed this silhouette. Qualitative only.
        let sway = 0;
        let passed = 0;
        if (front.active && response > 0.02 && front.radius > 10) {
          passed = smoothstep(distanceFromEvent, distanceFromEvent + layout.min * 0.05, front.radius);
          const recency = Math.exp(-Math.max(0, front.radius - distanceFromEvent) / (layout.min * 0.3));
          sway = Math.sin(phase.time * 11 + centerX * 0.13) * 2.4 * response * passed * recency * (near ? 1 : 0.4);
        }

        context.save();
        if (sway) {
          context.translate(centerX, surfaceY);
          context.transform(1, 0, sway * 0.012, 1, 0, 0);
          context.translate(-centerX, -surfaceY);
        }
        const facade = colorWithAlpha(groundColor, layer.alpha);
        context.fillStyle = facade;
        context.fillRect(x, surfaceY - buildingHeight, buildingWidth, buildingHeight + 1);

        // Flash illumination on the event-facing edge.
        if (eventGlow > 0.02 && !mobile) {
          const towardEvent = centerX < layout.originX ? x + buildingWidth - 2.5 : x;
          context.fillStyle = colorWithAlpha(this._palette.hot, eventGlow * (near ? 0.34 : 0.18) * (1 - passed * 0.5));
          context.fillRect(towardEvent, surfaceY - buildingHeight, 2.5, buildingHeight);
        }

        if (layer.detail && buildingWidth >= 14) {
          // Rooftop details on taller silhouettes.
          if (near && ((hash >>> 16) & 3) === 0) {
            context.fillStyle = facade;
            context.fillRect(centerX - 1, surfaceY - buildingHeight - 7, 2, 7);
          }
          if (near && ((hash >>> 18) & 7) === 0) {
            context.fillStyle = colorWithAlpha(groundColor, 0.9);
            context.fillRect(x + 3, surfaceY - buildingHeight - 4, Math.min(9, buildingWidth * 0.4), 4);
          }
          // Window grid; lit at night, flash-brightened, blacked out after
          // the front passes (a temporary, fictional outage impression).
          const columns = Math.max(2, Math.floor(buildingWidth / 6));
          const rows = Math.max(2, Math.floor(buildingHeight / 10));
          const blackout = passed * response;
          for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < columns; column += 1) {
              const windowHash = hashString(`${this.settings.seed}:w:${layer.salt}:${index}:${row}:${column}`);
              const litBase = night ? (windowHash % 100) < 46 : (windowHash % 100) < 8;
              const dark = ((windowHash >>> 8) % 100) / 100 < blackout;
              const flicker = phase.flash > 0.05 && ((windowHash >>> 16) & 3) === 0;
              if (!litBase && !flicker) continue;
              const windowAlpha = dark ? 0.03 : (flicker ? 0.5 : night ? 0.34 : 0.16);
              context.fillStyle = colorWithAlpha(
                flicker ? this._palette.core : this._palette.ember,
                windowAlpha * (near ? 1 : 0.7),
              );
              context.fillRect(
                x + 2 + column * (buildingWidth - 4) / columns,
                surfaceY - buildingHeight + 4 + row * (buildingHeight - 8) / rows,
                1.6,
                2.2,
              );
            }
          }
        }
        context.restore();

        // Street-level dust burst where the front has just arrived.
        if (near && front.active && response > 0.04) {
          const arriving = Math.exp(-((front.radius - distanceFromEvent) ** 2) / ((layout.min * 0.06) ** 2));
          const burst = arriving * response * clamp(tuning.dustResponse, 0, 2);
          if (burst > 0.03) {
            const dustRadius = 7 + burst * layout.min * 0.03;
            const dust = context.createRadialGradient(centerX, surfaceY, 0, centerX, surfaceY, dustRadius);
            dust.addColorStop(0, colorWithAlpha(this._palette.dust, burst * 0.5));
            dust.addColorStop(1, colorWithAlpha(this._palette.dust, 0));
            context.fillStyle = dust;
            context.beginPath();
            context.ellipse(centerX, surfaceY - 2, dustRadius, dustRadius * 0.4, 0, 0, TAU);
            context.fill();
            // Roof debris silhouettes: brief dark specks above the roofline.
            context.fillStyle = colorWithAlpha('#0a0b0d', burst * 0.7);
            for (let speck = 0; speck < 3; speck += 1) {
              const speckHash = hashString(`${this.settings.seed}:speck:${index}:${speck}`);
              context.fillRect(
                x + (speckHash % Math.max(1, buildingWidth)),
                surfaceY - buildingHeight - 4 - (speckHash >>> 6) % 10,
                1.6,
                1.6,
              );
            }
          }
        }

        x += buildingWidth + 4 + ((hash >>> 20) & 7);
      }
    }

    // Street lighting pools at night, dimming inside the passed-front zone.
    if (night && !mobile) {
      for (let lamp = 0; lamp < Math.round(14 * detail); lamp += 1) {
        const hash = hashString(`${this.settings.seed}:lamp:${lamp}`);
        const lampX = (hash % 1000) / 1000 * width;
        const outage = front.active
          ? smoothstep(Math.abs(lampX - layout.originX), Math.abs(lampX - layout.originX) + layout.min * 0.04, front.radius) * response
          : 0;
        const lampAlpha = 0.24 * (1 - outage * 0.9);
        if (lampAlpha <= 0.02) continue;
        context.fillStyle = colorWithAlpha(this._palette.ember, lampAlpha);
        context.beginPath();
        context.arc(lampX, surfaceY - 3, 1.1, 0, TAU);
        context.fill();
      }
    }
  }

  /** Smooth multi-octave ridge height in 0..1 from a continuous noise field. */
  _ridgeHeight(x, salt, octaves = 3) {
    let value = 0;
    let amplitude = 0.62;
    let frequency = 0.9;
    for (let octave = 0; octave < octaves; octave += 1) {
      const scaled = x * frequency;
      const cell = Math.floor(scaled);
      const frac = scaled - cell;
      const smooth = frac * frac * (3 - 2 * frac);
      const a = (hashString(`${this.settings.seed}:${salt}:${octave}:${cell}`) % 1000) / 1000;
      const b = (hashString(`${this.settings.seed}:${salt}:${octave}:${cell + 1}`) % 1000) / 1000;
      value += lerp(a, b, smooth) * amplitude;
      amplitude *= 0.5;
      frequency *= 2.1;
    }
    return value;
  }

  /**
   * Layered fictional mountain valley built from a continuous height-noise
   * field (not triangles): four ridge planes recede with atmospheric
   * perspective — distant planes are lighter, hazier, and lower-contrast —
   * over a soft sky-haze band. Unlocated and generic.
   */
  _drawMountainEnvironment(context, layout, phase) {
    const { width, height, surfaceY } = layout;
    const groundColor = this._environment.ground || this._palette.ground;
    const hazeColor = this._environment.horizon || this._palette.horizon;
    // Distant sky-haze band grounds the ridge line into the horizon.
    const skyHaze = context.createLinearGradient(0, surfaceY - height * 0.2, 0, surfaceY);
    skyHaze.addColorStop(0, colorWithAlpha(hazeColor, 0));
    skyHaze.addColorStop(1, colorWithAlpha(hazeColor, 0.22));
    context.fillStyle = skyHaze;
    context.fillRect(-12, surfaceY - height * 0.2, width + 24, height * 0.2);

    const ridges = [
      { salt: 'ridgeA', amp: 0.05, base: 0.075, haze: 0.5, contrast: 0.42, octaves: 2, freq: 0.7 },
      { salt: 'ridgeB', amp: 0.075, base: 0.055, haze: 0.32, contrast: 0.66, octaves: 3, freq: 1.0 },
      { salt: 'ridgeC', amp: 0.1, base: 0.032, haze: 0.16, contrast: 0.85, octaves: 3, freq: 1.35 },
      { salt: 'ridgeD', amp: 0.125, base: 0.012, haze: 0.05, contrast: 1, octaves: 4, freq: 1.7 },
    ];
    const step = Math.max(5, Math.round(width / 190));
    for (const ridge of ridges) {
      context.save();
      context.beginPath();
      context.moveTo(-20, surfaceY + 4);
      for (let x = -20; x <= width + 20; x += step) {
        const noise = this._ridgeHeight((x / width) * 6 * ridge.freq, ridge.salt, ridge.octaves);
        const valley = Math.abs(x / width - 0.5) * height * 0.05;
        const peak = height * (ridge.base + noise * ridge.amp) - valley;
        context.lineTo(x, surfaceY - peak);
      }
      context.lineTo(width + 20, surfaceY + 4);
      context.closePath();
      // Atmospheric perspective: distant ridges fade toward the haze color.
      const bodyAlpha = 0.55 + ridge.contrast * 0.4;
      const body = context.createLinearGradient(0, surfaceY - height * 0.15, 0, surfaceY);
      body.addColorStop(0, colorWithAlpha(hazeColor, ridge.haze * 0.7));
      body.addColorStop(0.55, colorWithAlpha(groundColor, bodyAlpha * (0.6 + ridge.contrast * 0.4)));
      body.addColorStop(1, colorWithAlpha(groundColor, bodyAlpha));
      context.fillStyle = body;
      context.fill();
      context.restore();
    }

    // Valley-contained dust response: pooled haze hugging the floor.
    const surface = saturate(phase.surface * this._behavior.dust);
    if (surface > 0.03) {
      const pool = context.createLinearGradient(0, surfaceY - height * 0.05, 0, surfaceY);
      pool.addColorStop(0, colorWithAlpha(this._palette.dust, 0));
      pool.addColorStop(1, colorWithAlpha(this._palette.dust, surface * 0.26 * (1 - phase.dissipation * 0.5)));
      context.fillStyle = pool;
      context.fillRect(-12, surfaceY - height * 0.05, width + 24, height * 0.05 + 4);
    }
  }

  _drawOceanEnvironment(context, layout, phase) {
    const { width, height, surfaceY } = layout;
    const front = this._shockGroundFront(layout, phase);
    // Horizon moisture band.
    const moisture = context.createLinearGradient(0, surfaceY - height * 0.06, 0, surfaceY);
    moisture.addColorStop(0, colorWithAlpha(this._palette.shock, 0));
    moisture.addColorStop(1, colorWithAlpha(this._palette.shock, 0.1));
    context.fillStyle = moisture;
    context.fillRect(-12, surfaceY - height * 0.06, width + 24, height * 0.06);
    // Event-light reflection column on the water.
    const glowStrength = saturate(phase.flash * 0.7 + phase.fireAlpha * phase.fireGrowth * 0.5);
    if (glowStrength > 0.02) {
      const reflection = context.createLinearGradient(0, surfaceY, 0, Math.min(height, surfaceY + height * 0.2));
      reflection.addColorStop(0, colorWithAlpha(this._palette.hot, glowStrength * 0.4));
      reflection.addColorStop(1, colorWithAlpha(this._palette.hot, 0));
      context.fillStyle = reflection;
      const reflectionWidth = layout.min * 0.16 * (0.5 + phase.fireGrowth);
      context.fillRect(layout.originX - reflectionWidth / 2, surfaceY, reflectionWidth, height * 0.2);
    }
    // Animated swell lines with shock-displacement near the front.
    context.strokeStyle = colorWithAlpha(this._palette.shock, 0.18);
    context.lineWidth = 1;
    for (let row = 0; row < 7; row += 1) {
      const y = surfaceY + 4 + row * (6 + row * 1.6);
      const step = Math.max(14, width / 110);
      context.beginPath();
      for (let x = -20; x <= width + 20; x += step) {
        const distance = Math.abs(x - layout.originX);
        const shockLift = front.active
          ? Math.exp(-((front.radius * 0.92 - distance) ** 2) / ((layout.min * 0.05) ** 2)) * front.strength * 6
          : 0;
        const waveY = y + Math.sin(x * 0.03 + row * 1.7 + phase.time * 0.9) * 1.6 - shockLift;
        if (x === -20) context.moveTo(x, waveY);
        else context.lineTo(x, waveY);
      }
      context.stroke();
    }
    // Spray burst where the front crosses the surface.
    if (front.active && front.strength > 0.05 && !this.reducedMotion) {
      for (let jet = 0; jet < 10; jet += 1) {
        const side = jet % 2 === 0 ? 1 : -1;
        const x = layout.originX + side * front.radius * 0.9 * (0.75 + this._particleDepth[jet + 40] * 0.3);
        if (x < -20 || x > width + 20) continue;
        const sprayHeight = layout.min * 0.02 * front.strength * (0.5 + this._particleSize[jet + 40] * 0.6);
        const spray = context.createLinearGradient(x, surfaceY, x, surfaceY - sprayHeight);
        spray.addColorStop(0, colorWithAlpha(this._palette.shock, front.strength * 0.5));
        spray.addColorStop(1, colorWithAlpha(this._palette.shock, 0));
        context.fillStyle = spray;
        context.fillRect(x - 1.4, surfaceY - sprayHeight, 2.8, sprayHeight);
      }
    }
  }

  _drawDesertEnvironment(context, layout, phase) {
    const { width, height, surfaceY } = layout;
    const groundColor = this._environment.ground || this._palette.ground;
    const dustTint = this._environment.dustTint || this._palette.dust;
    // Distant heat-haze band.
    const haze = context.createLinearGradient(0, surfaceY - height * 0.05, 0, surfaceY);
    haze.addColorStop(0, colorWithAlpha(dustTint, 0));
    haze.addColorStop(1, colorWithAlpha(dustTint, 0.18));
    context.fillStyle = haze;
    context.fillRect(-12, surfaceY - height * 0.05, width + 24, height * 0.05);
    // Three dune layers with increasing contrast.
    const duneLayers = [
      { amplitude: 0.02, alpha: 0.4, salt: 'dunefar', lift: 0.045 },
      { amplitude: 0.032, alpha: 0.7, salt: 'dunemid', lift: 0.026 },
      { amplitude: 0.045, alpha: 1, salt: 'dunenear', lift: 0.008 },
    ];
    for (const dune of duneLayers) {
      context.fillStyle = colorWithAlpha(groundColor, dune.alpha);
      context.beginPath();
      context.moveTo(-20, surfaceY + 6);
      for (let index = 0; index <= 8; index += 1) {
        const x = -20 + index / 8 * (width + 40);
        const hash = hashString(`${this.settings.seed}:${dune.salt}:${index}`);
        const crest = height * ((hash % 100) / 100 * dune.amplitude + dune.lift * 0.2);
        const controlX = x - (width + 40) / 16;
        const previousHash = hashString(`${this.settings.seed}:${dune.salt}:${index - 1}`);
        const previousCrest = height * ((previousHash % 100) / 100 * dune.amplitude + dune.lift * 0.2);
        context.quadraticCurveTo(controlX, surfaceY - Math.max(crest, previousCrest) - 2, x, surfaceY - crest);
      }
      context.lineTo(width + 20, surfaceY + 6);
      context.closePath();
      context.fill();
    }
    // Heat shimmer above the horizon while the fireball is hot.
    if (!this.reducedMotion && phase.fireAlpha > 0.05) {
      context.strokeStyle = colorWithAlpha(this._palette.hot, phase.fireAlpha * 0.07);
      context.lineWidth = 1;
      for (let band = 0; band < 3; band += 1) {
        const y = surfaceY - 6 - band * 5;
        context.beginPath();
        for (let x = -20; x <= width + 20; x += 26) {
          const waveY = y + Math.sin(x * 0.05 + phase.time * 3.4 + band * 2) * 1.4;
          if (x === -20) context.moveTo(x, waveY);
          else context.lineTo(x, waveY);
        }
        context.stroke();
      }
    }
  }

  /** Generic instrumented test range: towers, markers, and a service road. */
  _drawRangeEnvironment(context, layout, phase) {
    const { width, height, surfaceY } = layout;
    const groundColor = this._environment.ground || this._palette.ground;
    const detail = clamp((this.settings.tuning || DEFAULT_TUNING).environmentDetail, 0.3, 2);
    context.fillStyle = colorWithAlpha(groundColor, 0.98);
    context.fillRect(-20, surfaceY - 2, width + 40, 4);
    if (this.settings.quality === 'mobile' || detail < 0.45) return;
    const front = this._shockGroundFront(layout, phase);
    // Distant instrument towers (generic lattice silhouettes, no insignia).
    const towers = Math.round(5 * detail);
    for (let tower = 0; tower < towers; tower += 1) {
      const hash = hashString(`${this.settings.seed}:tower:${tower}`);
      const towerX = 40 + (hash % 1000) / 1000 * (width - 80);
      if (Math.abs(towerX - layout.originX) < layout.min * 0.09) continue;
      const towerHeight = height * (0.03 + ((hash >>> 10) % 40) / 1000);
      const lean = front.active
        ? smoothstep(Math.abs(towerX - layout.originX), Math.abs(towerX - layout.originX) + layout.min * 0.05, front.radius)
          * front.strength * (towerX < layout.originX ? -3 : 3)
        : 0;
      context.strokeStyle = colorWithAlpha(groundColor, 0.85);
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(towerX - 3, surfaceY);
      context.lineTo(towerX + lean, surfaceY - towerHeight);
      context.lineTo(towerX + 3, surfaceY);
      context.moveTo(towerX - 2, surfaceY - towerHeight * 0.45);
      context.lineTo(towerX + 2 + lean * 0.5, surfaceY - towerHeight * 0.45);
      context.stroke();
    }
    // Range markers along the ground.
    context.fillStyle = colorWithAlpha(this._palette.grid, 0.3);
    for (let marker = 0; marker < Math.round(9 * detail); marker += 1) {
      const hash = hashString(`${this.settings.seed}:marker:${marker}`);
      const markerX = (hash % 1000) / 1000 * width;
      context.fillRect(markerX, surfaceY - 4, 1.4, 4);
    }
    // Service road converging toward the horizon.
    context.strokeStyle = colorWithAlpha(this._palette.grid, 0.14);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(width * 0.16, height + 10);
    context.lineTo(width * 0.44, surfaceY);
    context.moveTo(width * 0.3, height + 10);
    context.lineTo(width * 0.47, surfaceY);
    context.stroke();
  }

  /** Analytical dark-grid stage: depth ticks and a clean reference horizon. */
  _drawGridEnvironment(context, layout) {
    const { width, surfaceY } = layout;
    context.fillStyle = colorWithAlpha(this._environment.ground || this._palette.ground, 0.98);
    context.fillRect(-20, surfaceY - 2, width + 40, 4);
    context.strokeStyle = colorWithAlpha(this._palette.grid, 0.4);
    context.lineWidth = 1;
    for (let tick = 0; tick <= 10; tick += 1) {
      const x = tick / 10 * width;
      const tall = tick % 5 === 0;
      context.beginPath();
      context.moveTo(x, surfaceY - (tall ? 8 : 4));
      context.lineTo(x, surfaceY);
      context.stroke();
    }
  }

  _drawPerspectiveGrid(context, layout) {
    const { width, height, surfaceY, originX } = layout;
    context.save();
    context.strokeStyle = colorWithAlpha(this._palette.grid, 0.11);
    context.lineWidth = 1;
    for (let index = 1; index <= 8; index += 1) {
      const ratio = index / 8;
      const y = surfaceY + (height - surfaceY) * ratio * ratio;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    for (let index = -8; index <= 8; index += 1) {
      context.beginPath();
      context.moveTo(originX + index * width * 0.025, surfaceY);
      context.lineTo(width * 0.5 + index * width * 0.11, height);
      context.stroke();
    }
    context.restore();
  }

  _drawCinematicLayers(context, glow, matter, layout, phase, activeCount, quality, direct = false) {
    const layers = this.settings.layers;
    const researchFluid = this._researchFluidRendered;
    const diagnostic = researchFluid && this.settings.diagnostic !== 'beauty';
    if (diagnostic) return;
    if (layers.flash || layers.thermal) this._drawAtmosphericLight(glow, layout, phase);
    if (layers.thermal || layers.fireball) this._drawSurfaceReflection(glow, layout, phase);
    if (layers.shock) this._drawFamilyShock(glow, matter, layout, phase);
    if (layers.thermal) this._drawThermal(glow, layout, phase);
    if (layers.fireball && researchFluid) {
      this._drawFamilyEarlyEffects(glow, matter, layout, phase, quality);
    } else if (layers.fireball) {
      this._drawFireball(glow, layout, phase, quality);
    }
    if (layers.thermal) this._drawHeatDistortion(glow, layout, phase, quality);
    if (this._behavior.electrical && layers.fireball) this._drawElectrical(glow, layout, phase, quality);

    if (layers.dust) this._drawSurfaceInteraction(matter, layout, phase);
    if (layers.cloud && !researchFluid) this._drawCloudBody(matter, layout, phase, quality);
    if (!researchFluid && (layers.dust || layers.debris || layers.cloud)) {
      this._drawParticles(matter, layout, phase, activeCount, quality);
    }
    if (this._behavior.key === 'meteorAir' || this._behavior.key === 'meteorImpact') {
      this._drawMeteorTrail(glow, matter, layout, phase, quality);
    }
    if (this._behavior.key === 'volcanic') this._drawVolcanoVent(glow, matter, layout, phase);
    if (this.settings.flowMode !== 'off') this._drawFlowOverlay(glow, layout, phase, quality);

    if (!direct) {
      const pixelWidth = this._layerWidth;
      const pixelHeight = this._layerHeight;
      context.save();
      context.globalCompositeOperation = 'screen';
      context.drawImage(this._glowCanvas, 0, 0, pixelWidth, pixelHeight, 0, 0, layout.width, layout.height);
      context.globalCompositeOperation = 'source-over';
      context.drawImage(this._matterCanvas, 0, 0, pixelWidth, pixelHeight, 0, 0, layout.width, layout.height);
      context.restore();
    }
  }

  _eventFamilyId() {
    return String(
      this._preset?.eventFamilyId
      || this._preset?.researchModel?.familyId
      || this._preset?.physicalFamilyId
      || 'conventional-compact',
    );
  }

  _shockProfile() {
    return SHOCK_FAMILY_PROFILES[this._eventFamilyId()] || SHOCK_FAMILY_PROFILES['conventional-compact'];
  }

  /** Deterministic angular irregularity so the front reads as a physical shell. */
  _shockWobble(angle, band, spread) {
    const seedPhase = (this.settings.seed % 251) * 0.13;
    return (
      Math.sin(angle * 3 + seedPhase + band * 2.1) * 0.52
      + Math.sin(angle * 7 - seedPhase * 1.7 + band * 4.3) * 0.31
      + Math.sin(angle * 13 + seedPhase * 2.9 + band) * 0.17
    ) * spread;
  }

  _traceShockBand(context, radius, aspect, wobble, band, startAngle = 0, endAngle = TAU) {
    const segments = 44;
    context.beginPath();
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = startAngle + (segment / segments) * (endAngle - startAngle);
      const modulated = radius * (1 + this._shockWobble(angle, band, wobble));
      const x = Math.cos(angle) * modulated;
      const y = Math.sin(angle) * modulated * aspect;
      if (segment === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  }

  _drawFamilyShock(glow, matter, layout, phase) {
    const profile = this._shockProfile();
    if (profile.pulsed) {
      this._drawPulsedShock(glow, layout, phase, profile);
      return;
    }
    this._drawLayeredShock(glow, matter, layout, phase, profile);
  }

  /**
   * Layered pressure-front visualization: refractive shell, bright leading
   * edge with chromatic separation, trailing contour bands, ground-reflected
   * wave, dust-lift boundary, and an optional condensation-style ring. All
   * geometry is the same normalized expanding shell as before; only the
   * rendering is richer. Stylized and qualitative throughout.
   */
  _drawLayeredShock(glow, matter, layout, phase, profile) {
    if (phase.shockAlpha <= 0.003) return;
    const tuning = this.settings.tuning || DEFAULT_TUNING;
    const behavior = this._behavior;
    const progress = phase.shockProgress;
    const maxRadius = layout.min * (0.58 + behavior.shock * 0.16) * layout.energyScale;
    const radius = Math.max(2, maxRadius * progress);
    const baseAlpha = saturate(phase.shockAlpha * clamp(behavior.shock, 0.2, 2.2)
      * clamp(behavior.shockOpacity, 0, 1.5))
      * clamp(profile.opacity * tuning.shockOpacity, 0, 2);
    if (baseAlpha <= 0.004) return;
    const aspect = layout.elevated && !profile.spectral
      ? Math.min(1, profile.aspect + 0.18)
      : profile.aspect;
    const wobble = profile.irregularity * (0.5 + progress * 0.9);
    const centerX = layout.originX + radius * (profile.offsetX || 0);
    const centerY = layout.eventY;
    const shockColor = profile.spectral ? this._palette.plasma : this._palette.shock;

    glow.save();
    glow.globalCompositeOperation = 'screen';
    glow.translate(centerX, centerY);
    // The airborne shell stops at the surface; the ground-reflected wave and
    // dust-lift boundary carry the interaction below the horizon line.
    glow.beginPath();
    glow.rect(-radius * 2.6, -radius * 2.6, radius * 5.2, (layout.surfaceY + 3 - centerY) + radius * 2.6);
    glow.clip();
    if (profile.rotation) glow.rotate(profile.rotation);
    if (profile.elongation) glow.scale(profile.elongation, 1);

    // 1 · Refractive shell: a wide translucent annulus around the front.
    if (profile.shellWidth > 0) {
      const shell = radius * profile.shellWidth * (2.6 - progress * 1.4) * clamp(tuning.refraction, 0, 2.5);
      if (shell > 1.5) {
        const gradient = glow.createRadialGradient(0, 0, Math.max(0, radius - shell), 0, 0, radius + shell * 0.7);
        gradient.addColorStop(0, colorWithAlpha(shockColor, 0));
        gradient.addColorStop(0.55, colorWithAlpha(shockColor, baseAlpha * 0.1));
        gradient.addColorStop(0.82, colorWithAlpha(shockColor, baseAlpha * 0.2));
        gradient.addColorStop(1, colorWithAlpha(shockColor, 0));
        glow.fillStyle = gradient;
        glow.save();
        glow.scale(1, aspect);
        glow.beginPath();
        glow.arc(0, 0, radius + shell * 0.7, 0, TAU);
        glow.fill();
        glow.restore();
      }
    }

    // 2 · Chromatic separation just inside/outside the leading edge.
    const chroma = profile.chroma * baseAlpha * 0.3;
    if (chroma > 0.006 && !this.reducedMotion) {
      const warm = profile.spectral ? this._palette.plasma : this._palette.ember;
      const cool = profile.spectral ? this._palette.core : this._palette.shock;
      glow.lineWidth = Math.max(0.7, 1.9 * (1 - progress));
      glow.strokeStyle = colorWithAlpha(warm, chroma);
      this._traceShockBand(glow, radius * 0.986, aspect, wobble, 0);
      glow.stroke();
      glow.strokeStyle = colorWithAlpha(cool, chroma * 0.85);
      this._traceShockBand(glow, radius * 1.014, aspect, wobble, 0);
      glow.stroke();
    }

    // 3 · Leading compression front: thin bright core over a soft halo.
    glow.strokeStyle = colorWithAlpha(shockColor, baseAlpha * 0.24);
    glow.lineWidth = Math.max(1.6, 7.5 * (1 - progress) * profile.thickness * behavior.shockThickness);
    this._traceShockBand(glow, radius, aspect, wobble, 0);
    glow.stroke();
    glow.strokeStyle = colorWithAlpha(shockColor, baseAlpha * 0.78);
    glow.lineWidth = Math.max(0.8, 2.6 * (1 - progress * 0.7) * profile.thickness);
    this._traceShockBand(glow, radius, aspect, wobble, 0);
    glow.stroke();

    // 4 · Trailing contour bands with independent fade and slight lag growth.
    const bandCount = Math.round(clamp(profile.bands * tuning.shockBands, 0, 5));
    for (let band = 1; band <= bandCount; band += 1) {
      const lag = profile.spacing * tuning.shockSpacing * (band + band * band * 0.22);
      const bandRadius = radius * (1 - lag);
      if (bandRadius < 4) continue;
      const bandFade = (1 - band / (bandCount + 1.4)) * (1 - progress * 0.42);
      const bandAlpha = baseAlpha * 0.34 * bandFade;
      if (bandAlpha <= 0.004) continue;
      glow.strokeStyle = colorWithAlpha(shockColor, bandAlpha);
      glow.lineWidth = Math.max(0.7, (2.1 - band * 0.28) * (1 - progress * 0.55) * profile.thickness);
      this._traceShockBand(glow, bandRadius, aspect, wobble * (1 + band * 0.35), band);
      glow.stroke();
    }
    glow.restore();

    // 5 · Ground-reflected wave: a paired surface arc slightly behind the front.
    if (profile.groundRing > 0.05 && (!layout.elevated || progress > 0.12)) {
      const groundAlpha = baseAlpha * 0.34 * profile.groundRing;
      const groundRadius = radius * (profile.elongation || 1);
      glow.save();
      glow.globalCompositeOperation = 'screen';
      glow.strokeStyle = colorWithAlpha(shockColor, groundAlpha);
      glow.lineWidth = Math.max(0.8, 2.6 * (1 - progress));
      glow.beginPath();
      glow.ellipse(layout.originX, layout.surfaceY + 2, groundRadius * 0.94, groundRadius * 0.1, 0, Math.PI, TAU);
      glow.stroke();
      glow.strokeStyle = colorWithAlpha(shockColor, groundAlpha * 0.45);
      glow.lineWidth = Math.max(0.7, 1.7 * (1 - progress));
      glow.beginPath();
      glow.ellipse(layout.originX, layout.surfaceY + 2, groundRadius * 0.78, groundRadius * 0.082, 0, Math.PI, TAU);
      glow.stroke();
      glow.restore();
    }

    // 6 · Dust-lift boundary: particulate raised from the surface just behind
    // the traveling front. Deterministic streaks from the fixed particle pool.
    const dustStrength = profile.dust * behavior.dust * tuning.dustResponse;
    if (matter && dustStrength > 0.08 && !layout.buried && progress > 0.08 && progress < 0.98) {
      const streaks = Math.max(6, Math.round(16 * clamp(tuning.dustResponse, 0, 2)));
      const frontX = radius * 0.92 * (profile.elongation || 1);
      matter.save();
      for (let index = 0; index < streaks; index += 1) {
        const side = index % 2 === 0 ? 1 : -1;
        const along = 0.4 + this._particleDepth[index + 24] * 0.58;
        const x = layout.originX + side * frontX * along;
        if (x < -30 || x > layout.width + 30) continue;
        const heightScale = (1 - along * 0.55) * dustStrength;
        const streakHeight = layout.min * 0.028 * heightScale * (0.6 + this._particleSize[index + 24] * 0.5)
          * Math.sin(Math.PI * saturate(progress * 1.35 - along * 0.3));
        if (streakHeight < 1.2) continue;
        const alpha = baseAlpha * 0.5 * (1 - along * 0.5);
        const dustGradient = matter.createLinearGradient(x, layout.surfaceY, x, layout.surfaceY - streakHeight);
        dustGradient.addColorStop(0, colorWithAlpha(this._palette.dust, alpha));
        dustGradient.addColorStop(1, colorWithAlpha(this._palette.dust, 0));
        matter.fillStyle = dustGradient;
        const streakWidth = Math.max(1.6, layout.min * 0.008 * (0.5 + this._particleSize[index + 24] * 0.6));
        matter.fillRect(x - streakWidth / 2, layout.surfaceY - streakHeight, streakWidth, streakHeight);
      }
      matter.restore();
    }

    // 7 · Condensation-style ring for humid, elevated events at mid-expansion.
    if (profile.condensation > 0.05 && layout.elevated && !this.reducedMotion) {
      const window = Math.sin(Math.PI * saturate((progress - 0.26) / 0.44));
      if (window > 0.02) {
        const ringAlpha = baseAlpha * 0.3 * profile.condensation * window;
        const ringRadius = radius * 0.56;
        glow.save();
        glow.globalCompositeOperation = 'screen';
        const ring = glow.createRadialGradient(centerX, centerY, ringRadius * 0.72, centerX, centerY, ringRadius);
        ring.addColorStop(0, colorWithAlpha(this._palette.core, 0));
        ring.addColorStop(0.72, colorWithAlpha(this._palette.core, ringAlpha));
        ring.addColorStop(1, colorWithAlpha(this._palette.core, 0));
        glow.fillStyle = ring;
        glow.beginPath();
        glow.ellipse(centerX, centerY, ringRadius, ringRadius * 0.42, 0, 0, TAU);
        glow.fill();
        glow.restore();
      }
    }
  }

  /** Volcanic pressure behavior: repeated weak surges rather than one ring. */
  _drawPulsedShock(glow, layout, phase, profile) {
    if (phase.time <= 0.05) return;
    const behavior = this._behavior;
    const period = 2.6;
    const maxRadius = layout.min * 0.2 * layout.energyScale;
    glow.save();
    glow.globalCompositeOperation = 'screen';
    for (let pulse = 0; pulse < 3; pulse += 1) {
      const emitTime = pulse * period + (this.settings.seed % 7) * 0.11;
      const age = (phase.time - emitTime) % (period * 3);
      if (age < 0 || age > period * 1.5) continue;
      const pulseProgress = age / (period * 1.5);
      const pulseRadius = Math.max(2, maxRadius * (0.25 + pulseProgress * 0.75));
      const alpha = saturate((1 - pulseProgress) * 0.3 * profile.opacity * (1 - phase.dissipation));
      if (alpha <= 0.008) continue;
      glow.strokeStyle = colorWithAlpha(this._palette.shock, alpha * clamp(behavior.shock * 3, 0.2, 1));
      glow.lineWidth = Math.max(0.8, 2.2 * (1 - pulseProgress));
      glow.save();
      glow.translate(layout.originX, layout.surfaceY - layout.min * 0.02);
      this._traceShockBand(glow, pulseRadius, profile.aspect, profile.irregularity, pulse);
      glow.stroke();
      glow.restore();
    }
    glow.restore();
  }

  _drawFamilyEarlyEffects(glow, matter, layout, phase, quality) {
    const family = this._eventFamilyId();
    if (family === 'industrial-combustion') {
      this._drawIgnitionCluster(glow, layout, phase, quality, {
        duration: 3.2,
        count: 7,
        radius: 0.062,
        spreadX: 1.3,
        spreadY: 0.72,
        roll: 0.65,
        smokeColor: this._palette.ember,
      });
      return;
    }
    if (family === 'ground-coupled') {
      this._drawGroundCoupledEarly(glow, matter, layout, phase, quality, 1.45);
      return;
    }
    if (family === 'meteor') {
      this._drawMeteorEarly(glow, matter, layout, phase, quality);
      return;
    }
    if (family === 'volcanic') {
      this._drawVolcanicEarly(glow, matter, layout, phase, quality);
      return;
    }
    if (family === 'fictional-plasma') {
      this._drawPlasmaEarly(glow, layout, phase, quality);
      return;
    }
    if (family === 'nuclear-scale') {
      this._drawNuclearEarly(glow, matter, layout, phase, quality);
      return;
    }
    this._drawIgnitionCluster(glow, layout, phase, quality, {
      duration: this._behavior.key === 'compact' ? 0.82 : 1.35,
      count: this._behavior.key === 'compact' ? 4 : 6,
      radius: this._behavior.key === 'compact' ? 0.045 : 0.055,
      spreadX: this._behavior.key === 'compact' ? 1.5 : 1.85,
      spreadY: 0.42,
      roll: 0.22,
      smokeColor: this._palette.dust,
    });
  }

  _drawIgnitionCluster(context, layout, phase, quality, options = {}) {
    const duration = Math.max(0.2, finite(options.duration, 1));
    const visibility = (1 - smoothstep(duration * 0.58, duration, phase.time))
      * saturate(phase.fireAlpha + phase.flash * 0.45);
    if (visibility <= 0.003) return;
    const count = Math.max(2, Math.min(9, Math.round(finite(options.count, 5) * Math.max(0.65, quality))));
    const baseRadius = layout.min * finite(options.radius, 0.05) * layout.scale
      * (0.42 + phase.fireGrowth * 0.58);
    const spreadX = finite(options.spreadX, 1);
    const spreadY = finite(options.spreadY, 0.6);
    const roll = finite(options.roll, 0.2);
    context.save();
    context.globalCompositeOperation = 'screen';
    for (let index = 0; index < count; index += 1) {
      const centered = count === 1 ? 0 : index / (count - 1) - 0.5;
      const seeded = this._particleBias[index];
      const radius = baseRadius * (0.72 + this._particleSize[index] * 0.48);
      const x = layout.originX + (centered + seeded * 0.28) * baseRadius * spreadX * 2.1;
      const y = layout.eventY
        + seeded * baseRadius * spreadY
        - Math.sin(phase.time * (1.5 + roll) + this._particlePhase[index]) * baseRadius * roll;
      const gradient = context.createRadialGradient(x - radius * 0.16, y - radius * 0.18, 0, x, y, radius);
      gradient.addColorStop(0, colorWithAlpha(this._palette.core, visibility * 0.9));
      gradient.addColorStop(0.36, colorWithAlpha(this._palette.hot, visibility * 0.72));
      gradient.addColorStop(0.76, colorWithAlpha(this._palette.flame, visibility * 0.42));
      gradient.addColorStop(1, colorWithAlpha(options.smokeColor || this._palette.ember, 0));
      context.fillStyle = gradient;
      context.beginPath();
      context.ellipse(x, y, radius, radius * (0.7 + spreadY * 0.18), 0, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  _drawGroundCoupledEarly(glow, matter, layout, phase, quality, duration = 1.4) {
    const visibility = (1 - smoothstep(duration * 0.58, duration, phase.time))
      * saturate(phase.surface + phase.fireAlpha * 0.5 + phase.flash * 0.2);
    if (visibility <= 0.003) return;
    const radius = layout.min * 0.12 * layout.scale * (0.35 + phase.fireGrowth * 0.65);
    glow.save();
    glow.globalCompositeOperation = 'screen';
    const flash = glow.createRadialGradient(layout.originX, layout.surfaceY, 0, layout.originX, layout.surfaceY, radius);
    flash.addColorStop(0, colorWithAlpha(this._palette.hot, visibility * 0.7));
    flash.addColorStop(0.42, colorWithAlpha(this._palette.flame, visibility * 0.34));
    flash.addColorStop(1, colorWithAlpha(this._palette.dust, 0));
    glow.fillStyle = flash;
    glow.beginPath();
    glow.ellipse(layout.originX, layout.surfaceY, radius, radius * 0.18, 0, 0, TAU);
    glow.fill();
    glow.restore();

    matter.save();
    // Ground Burst keeps debris close to the surface. The old full-length
    // spokes read as a dark wireframe over the early flash, while the same
    // helper remains unchanged for other ground-coupled events.
    const nuclearGround = this._behavior.key === 'nuclearGround';
    matter.strokeStyle = colorWithAlpha(
      this._palette.dust,
      visibility * (nuclearGround ? 0.12 : 0.58),
    );
    matter.lineWidth = Math.max(1, radius * (nuclearGround ? 0.018 : 0.025));
    if (!nuclearGround) {
      const jets = Math.max(4, Math.round(8 * quality));
      for (let index = 0; index < jets; index += 1) {
        const amount = jets === 1 ? 0.5 : index / (jets - 1);
        const angle = lerp(Math.PI * 1.12, Math.PI * 1.88, amount);
        const length = radius * (0.55 + this._particleDepth[index] * 0.8);
        matter.beginPath();
        matter.moveTo(layout.originX, layout.surfaceY);
        matter.lineTo(
          layout.originX + Math.cos(angle) * length,
          layout.surfaceY + Math.sin(angle) * length * 0.58,
        );
        matter.stroke();
      }
    }
    matter.restore();
  }

  _drawMeteorEarly(glow, matter, layout, phase, quality) {
    // The volumetric entry trail is handled by _drawMeteorTrail for the whole
    // descent; this early hook only adds the surface response for impacts.
    if (this._behavior.key === 'meteorImpact') {
      this._drawGroundCoupledEarly(glow, matter, layout, phase, quality, 1.55);
    }
  }

  /**
   * Deterministic entry trajectory. Returns the head position at `time`
   * seconds plus the unit direction of travel. The meteor arrives at the
   * event origin at `arrival` seconds after detonation; before detonation the
   * head waits off-screen (rendered only as a subtle distant object).
   */
  _meteorTrajectory(layout, time) {
    const seedLean = ((this.settings.seed % 89) / 89 - 0.5) * 0.3;
    const arrival = this._behavior.key === 'meteorImpact' ? 0.62 : 0.5;
    const travel = layout.min * 1.15;
    const targetX = layout.originX;
    const targetY = layout.eventY;
    // Straight-line entry from the upper corner chosen by the seed, with a
    // seeded lean so different seeds produce different entry angles.
    const side = (this.settings.seed % 2 === 0) ? 1 : -1;
    const originX = targetX + side * travel * (0.62 + seedLean);
    const originY = targetY - travel * 0.92;
    const progress = saturate(time / arrival);
    // Subtle acceleration into the lower atmosphere.
    const eased = progress * progress * (3 - 2 * progress) * 0.35 + progress * 0.65;
    const x = lerp(originX, targetX, eased);
    const y = lerp(originY, targetY, eased);
    const dirX = targetX - originX;
    const dirY = targetY - originY;
    const magnitude = Math.hypot(dirX, dirY) || 1;
    return {
      x, y, arrival, progress,
      startX: originX, startY: originY,
      ux: dirX / magnitude, uy: dirY / magnitude,
    };
  }

  _drawVolumetricMeteorTrail(glow, matter, layout, phase, quality) {
    const behavior = this._behavior;
    const tuning = this.settings.tuning || DEFAULT_TUNING;
    const trajectory = this._meteorTrajectory(layout, phase.time);
    const persistence = clamp(tuning.trailPersistence, 0.4, 2.2);

    // Pre-detonation: only a subtle distant object, never a finished trail.
    if (phase.time <= 0.001) {
      glow.save();
      glow.globalCompositeOperation = 'screen';
      const hint = glow.createRadialGradient(
        trajectory.startX, trajectory.startY, 0,
        trajectory.startX, trajectory.startY, 5,
      );
      hint.addColorStop(0, colorWithAlpha(this._palette.core, 0.5));
      hint.addColorStop(1, colorWithAlpha(this._palette.core, 0));
      glow.fillStyle = hint;
      glow.beginPath();
      glow.arc(trajectory.startX, trajectory.startY, 5, 0, TAU);
      glow.fill();
      glow.restore();
      return;
    }

    const fadeStart = trajectory.arrival + 1.4 * persistence;
    const fadeEnd = trajectory.arrival + 3.4 * persistence;
    const trailFade = 1 - smoothstep(fadeStart, fadeEnd, phase.time);
    if (trailFade <= 0.004) return;

    const headX = trajectory.x;
    const headY = trajectory.y;
    const headActive = trajectory.progress < 1;
    const trailSpan = Math.hypot(headX - trajectory.startX, headY - trajectory.startY);
    const blobBudget = Math.max(12, Math.round(30 * Math.max(0.5, quality)));
    const baseRadius = layout.min * 0.011 * layout.scale;
    const lateral = { x: -trajectory.uy, y: trajectory.ux };
    const seedPhase = (this.settings.seed % 173) * 0.37;

    // Smoky wake first (matter layer) so the luminous sheath reads on top.
    matter.save();
    for (let blob = 0; blob < blobBudget; blob += 1) {
      const along = blob / (blobBudget - 1);
      const distanceBack = along * trailSpan;
      if (distanceBack < baseRadius * 2) continue;
      const wobble = Math.sin(along * 21 + seedPhase) * 0.55 + Math.sin(along * 47 + seedPhase * 2.3) * 0.3;
      const age = saturate((phase.time - trajectory.arrival * (1 - along)) / 2.2);
      const drift = layout.windX * layout.min * 0.05 * age;
      const x = headX - trajectory.ux * distanceBack + lateral.x * wobble * baseRadius * (1 + along * 6) + drift;
      const y = headY - trajectory.uy * distanceBack + lateral.y * wobble * baseRadius * (1 + along * 6) - age * layout.min * 0.008;
      const radius = baseRadius * (1.1 + along * 4.2) * (0.75 + age * 0.6);
      const alpha = trailFade * 0.16 * (1 - along * 0.55) * behavior.smoke;
      if (alpha <= 0.004) continue;
      const puff = matter.createRadialGradient(x, y, 0, x, y, radius);
      puff.addColorStop(0, colorWithAlpha(this._palette.smoke, alpha));
      puff.addColorStop(1, colorWithAlpha(this._palette.smoke, 0));
      matter.fillStyle = puff;
      matter.beginPath();
      matter.arc(x, y, radius, 0, TAU);
      matter.fill();
    }
    matter.restore();

    // Heated volumetric core: overlapping soft gradients along the path.
    glow.save();
    glow.globalCompositeOperation = 'screen';
    const luminousSpan = Math.min(trailSpan, layout.min * (headActive ? 0.5 : 0.34));
    const luminousFade = headActive ? 1 : 1 - smoothstep(trajectory.arrival, fadeStart, phase.time) * 0.65;
    for (let blob = 0; blob < blobBudget; blob += 1) {
      const along = blob / (blobBudget - 1);
      const distanceBack = along * luminousSpan;
      const wobble = Math.sin(along * 33 + seedPhase * 1.7) * 0.3;
      const x = headX - trajectory.ux * distanceBack + lateral.x * wobble * baseRadius * (1 + along * 2.4);
      const y = headY - trajectory.uy * distanceBack + lateral.y * wobble * baseRadius * (1 + along * 2.4);
      const radius = baseRadius * (0.9 + along * 2.4);
      const heat = (1 - along) * luminousFade * trailFade;
      const alpha = heat * (0.4 + 0.28 * Math.sin(along * 59 + seedPhase * 3.1));
      if (alpha <= 0.006) continue;
      const core = glow.createRadialGradient(x, y, 0, x, y, radius);
      core.addColorStop(0, colorWithAlpha(this._palette.core, alpha * 0.8));
      core.addColorStop(0.45, colorWithAlpha(this._palette.hot, alpha * 0.5));
      core.addColorStop(1, colorWithAlpha(this._palette.flame, 0));
      glow.fillStyle = core;
      glow.beginPath();
      glow.arc(x, y, radius, 0, TAU);
      glow.fill();
    }

    // Plasma sheath and motion-blurred head.
    if (headActive) {
      const headRadius = baseRadius * 2.1;
      const sheath = glow.createRadialGradient(headX, headY, 0, headX, headY, headRadius * 3.2);
      sheath.addColorStop(0, colorWithAlpha(this._palette.core, 0.95));
      sheath.addColorStop(0.3, colorWithAlpha(this._palette.hot, 0.6));
      sheath.addColorStop(0.66, colorWithAlpha(this._palette.plasma, 0.2));
      sheath.addColorStop(1, colorWithAlpha(this._palette.plasma, 0));
      glow.fillStyle = sheath;
      glow.beginPath();
      glow.arc(headX, headY, headRadius * 3.2, 0, TAU);
      glow.fill();
      // Directional blur streak through the head.
      const blurLength = headRadius * 7;
      const streak = glow.createLinearGradient(
        headX - trajectory.ux * blurLength, headY - trajectory.uy * blurLength,
        headX + trajectory.ux * headRadius * 1.6, headY + trajectory.uy * headRadius * 1.6,
      );
      streak.addColorStop(0, colorWithAlpha(this._palette.hot, 0));
      streak.addColorStop(0.7, colorWithAlpha(this._palette.hot, 0.34));
      streak.addColorStop(1, colorWithAlpha(this._palette.core, 0.85));
      glow.strokeStyle = streak;
      glow.lineCap = 'round';
      glow.lineWidth = headRadius * 1.15;
      glow.beginPath();
      glow.moveTo(headX - trajectory.ux * blurLength, headY - trajectory.uy * blurLength);
      glow.lineTo(headX + trajectory.ux * headRadius * 1.2, headY + trajectory.uy * headRadius * 1.2);
      glow.stroke();

      // Fragmentation: small diverging shards in the final third of entry.
      if (trajectory.progress > 0.55) {
        const shards = 3;
        for (let shard = 0; shard < shards; shard += 1) {
          const bias = this._particleBias[shard + 6];
          const shardProgress = saturate((trajectory.progress - 0.55) / 0.45);
          const spread = layout.min * 0.045 * shardProgress * (0.4 + Math.abs(bias));
          const sx = headX - trajectory.ux * spread * 2.4 + lateral.x * bias * spread;
          const sy = headY - trajectory.uy * spread * 2.4 + lateral.y * bias * spread;
          const shardAlpha = (1 - shardProgress * 0.5) * 0.55;
          const shardRadius = baseRadius * (0.5 + Math.abs(bias) * 0.45);
          const shardGlow = glow.createRadialGradient(sx, sy, 0, sx, sy, shardRadius * 2.4);
          shardGlow.addColorStop(0, colorWithAlpha(this._palette.core, shardAlpha));
          shardGlow.addColorStop(0.6, colorWithAlpha(this._palette.ember, shardAlpha * 0.4));
          shardGlow.addColorStop(1, colorWithAlpha(this._palette.ember, 0));
          glow.fillStyle = shardGlow;
          glow.beginPath();
          glow.arc(sx, sy, shardRadius * 2.4, 0, TAU);
          glow.fill();
        }
      }
    }
    glow.restore();
  }

  _drawVolcanicEarly(glow, matter, layout, phase, quality) {
    const pulse = (0.58 + Math.sin(phase.time * 3.1 + (this.settings.seed % 31)) * 0.22)
      * (1 - phase.dissipation * 0.5);
    const width = layout.min * 0.035 * layout.scale;
    glow.save();
    glow.strokeStyle = colorWithAlpha(this._palette.ember, pulse * 0.55);
    glow.lineWidth = Math.max(1, width * 0.22);
    const jets = Math.max(2, Math.round(4 * quality));
    for (let index = 0; index < jets; index += 1) {
      const offset = (index / Math.max(1, jets - 1) - 0.5) * width;
      glow.beginPath();
      glow.moveTo(layout.originX + offset, layout.surfaceY - width * 0.72);
      glow.quadraticCurveTo(
        layout.originX + offset * 1.6,
        layout.surfaceY - width * (1.6 + this._particleDepth[index]),
        layout.originX + offset * 2.2,
        layout.surfaceY - width * (2.1 + this._particleDepth[index]),
      );
      glow.stroke();
    }
    glow.restore();
  }

  _drawPlasmaEarly(context, layout, phase, quality) {
    const visibility = (1 - smoothstep(1.05, 1.85, phase.time))
      * saturate(phase.flash + phase.fireAlpha * 0.5);
    if (visibility <= 0.003) return;
    const radius = layout.min * 0.092 * layout.scale * (0.2 + phase.fireGrowth * 0.8);
    context.save();
    context.globalCompositeOperation = 'screen';
    const core = context.createRadialGradient(layout.originX, layout.eventY, 0, layout.originX, layout.eventY, radius);
    core.addColorStop(0, colorWithAlpha(this._palette.core, visibility * 0.95));
    core.addColorStop(0.35, colorWithAlpha(this._palette.plasma, visibility * 0.7));
    core.addColorStop(0.78, colorWithAlpha(this._palette.flame, visibility * 0.28));
    core.addColorStop(1, colorWithAlpha(this._palette.plasma, 0));
    context.fillStyle = core;
    context.beginPath();
    context.arc(layout.originX, layout.eventY, radius, 0, TAU);
    context.fill();
    context.strokeStyle = colorWithAlpha(this._palette.plasma, visibility * 0.74);
    context.lineWidth = Math.max(0.8, radius * 0.025);
    const rings = Math.max(1, Math.round(2 * quality));
    for (let index = 0; index < rings; index += 1) {
      context.beginPath();
      context.ellipse(
        layout.originX,
        layout.eventY,
        radius * (0.72 + index * 0.2),
        radius * (0.34 + index * 0.22),
        phase.time * (0.5 + index * 0.16),
        0,
        TAU,
      );
      context.stroke();
    }
    context.restore();
  }

  _drawNuclearEarly(glow, matter, layout, phase, quality) {
    if (this._behavior.key === 'nuclearAir') {
      // Preserve the accepted Research Model's complete analytical fireball
      // envelope while the established GPU plume evolves above it.
      this._drawFireball(glow, layout, phase, quality);
      return;
    }
    const duration = this._behavior.key === 'extreme' ? 2.7 : 1.75;
    const visibility = 1 - smoothstep(duration * 0.58, duration, phase.time);
    if (visibility <= 0.003) return;
    glow.save();
    glow.globalAlpha *= visibility;
    this._drawFireball(glow, layout, phase, quality);
    glow.restore();
    if (this._behavior.key === 'nuclearGround') {
      this._drawGroundCoupledEarly(glow, matter, layout, phase, quality, duration * 0.85);
    }
  }

  _drawAtmosphericLight(context, layout, phase) {
    const flashContribution = this.settings.layers.flash ? phase.flash : 0;
    const thermalContribution = this.settings.layers.thermal
      ? phase.fireAlpha * phase.fireGrowth * 0.11
      : 0;
    // A profile may keep a strong local flash while reducing the broad
    // full-frame atmospheric wash. Profiles that do not override
    // atmosphericLight resolve it to their flash value, so their established
    // behavior remains unchanged. Ground Burst uses the control to keep the
    // surface core legible through the surrounding dust instead of painting
    // the entire viewport pale during the first second.
    const atmosphericWash = clamp(this._behavior.atmosphericWash, 0.2, 1);
    const intensity = saturate(
      (flashContribution * 0.64 + thermalContribution)
      * Math.max(0.2, this._behavior.atmosphericLight)
      * clamp(finite(this.settings.tuning?.envIllumination, 1), 0.2, 2),
    );
    if (intensity <= 0.002) return;
    const radius = layout.min * (0.35 + this._behavior.fireball * 0.15) * layout.energyScale;
    const gradient = context.createRadialGradient(
      layout.originX,
      layout.eventY,
      0,
      layout.originX,
      layout.eventY,
      radius,
    );
    gradient.addColorStop(0, colorWithAlpha(this._palette.core, intensity * 0.72));
    gradient.addColorStop(0.22, colorWithAlpha(this._palette.hot, intensity * 0.28));
    gradient.addColorStop(1, colorWithAlpha(this._palette.flame, 0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, layout.width, layout.height);

    if (this.settings.layers.flash && flashContribution > 0.02) {
      context.fillStyle = colorWithAlpha(
        this._palette.core,
        Math.min(
          this.reducedMotion ? 0.12 : 0.58,
          phase.flash * 0.34 * atmosphericWash,
        ),
      );
      context.fillRect(0, 0, layout.width, layout.height);
    }
  }

  _drawThermal(context, layout, phase) {
    if (phase.fireAlpha <= 0.01) return;
    const radius = layout.min * (0.13 + 0.12 * phase.fireGrowth) * this._behavior.fireball * layout.scale;
    const glow = context.createRadialGradient(layout.originX, layout.eventY, radius * 0.05, layout.originX, layout.eventY, radius * 1.75);
    glow.addColorStop(0, colorWithAlpha(this._palette.hot, 0.34 * phase.fireAlpha));
    glow.addColorStop(0.35, colorWithAlpha(this._palette.thermal, 0.16 * phase.fireAlpha));
    glow.addColorStop(1, colorWithAlpha(this._palette.thermal, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(layout.originX, layout.eventY, radius * 1.75, 0, TAU);
    context.fill();
  }

  _drawSurfaceReflection(context, layout, phase) {
    const strength = saturate(phase.flash * 0.18 + phase.fireAlpha * phase.fireGrowth * 0.34)
      * (this._environment.reflective ? 1.35 : 0.78);
    if (strength <= 0.003) return;
    const radius = layout.min * 0.2 * layout.scale * Math.max(0.35, this._behavior.fireball);
    const reflection = context.createRadialGradient(
      layout.originX,
      layout.surfaceY,
      0,
      layout.originX,
      layout.surfaceY,
      Math.max(2, radius),
    );
    reflection.addColorStop(0, colorWithAlpha(this._palette.hot, strength * 0.52));
    reflection.addColorStop(0.5, colorWithAlpha(this._palette.flame, strength * 0.18));
    reflection.addColorStop(1, colorWithAlpha(this._palette.flame, 0));
    context.fillStyle = reflection;
    context.beginPath();
    context.ellipse(layout.originX, layout.surfaceY + 2, radius, radius * 0.12, 0, 0, TAU);
    context.fill();
  }

  _drawHeatDistortion(context, layout, phase, quality) {
    if (this.reducedMotion || phase.fireAlpha <= 0.03 || quality < 0.4) return;
    const alpha = phase.fireAlpha * this._behavior.heatDistortion * 0.12;
    if (alpha <= 0.004) return;
    const radius = layout.min * 0.08 * layout.scale * this._behavior.fireball;
    context.save();
    context.strokeStyle = colorWithAlpha(this._palette.shock, alpha);
    context.lineWidth = Math.max(0.6, layout.min / 1000);
    const bands = Math.max(2, Math.min(6, Math.round(6 * quality)));
    for (let band = 0; band < bands; band += 1) {
      const y = layout.eventY - radius * (0.35 + band * 0.24);
      context.beginPath();
      for (let segment = 0; segment <= 12; segment += 1) {
        const amount = segment / 12;
        const x = layout.originX - radius + amount * radius * 2;
        const wave = Math.sin(amount * TAU * 2 + phase.time * 2.2 + band) * radius * 0.025;
        if (segment === 0) context.moveTo(x, y + wave);
        else context.lineTo(x, y + wave);
      }
      context.stroke();
    }
    context.restore();
  }

  _drawResearchRefraction(context, sourceCanvas, layout, phase, dpr) {
    if (this.reducedMotion || phase.shockAlpha <= 0.015 || phase.shockProgress >= 0.85) return;
    const scratch = this._refractionCanvas;
    const scratchContext = this._refractionContext;
    if (!scratch || !scratchContext || !sourceCanvas) return;
    scratchContext.setTransform(1, 0, 0, 1, 0, 0);
    scratchContext.clearRect(0, 0, scratch.width, scratch.height);
    scratchContext.drawImage(sourceCanvas, 0, 0, scratch.width, scratch.height);

    const maxRadius = layout.min * (0.58 + this._behavior.shock * 0.16) * layout.energyScale;
    const radius = Math.max(2, maxRadius * phase.shockProgress);
    const ring = Math.max(2.5, radius * (0.026 + (1 - phase.shockProgress) * 0.035));
    const displacement = Math.max(0.4, ring * 0.34) * phase.shockAlpha;
    const family = this._eventFamilyId();
    const familyGeometry = REFRACTION_GEOMETRY[family] || REFRACTION_GEOMETRY['nuclear-scale'];
    const aspect = family === 'nuclear-scale' && this._behavior.key === 'nuclearGround'
      ? 0.4
      : familyGeometry.aspect;
    const centerX = layout.originX + radius * familyGeometry.x;
    const centerY = family === 'ground-coupled'
      ? lerp(layout.eventY, layout.surfaceY, 0.72)
      : layout.eventY + radius * familyGeometry.y;
    const outerRadius = radius + ring;
    const innerRadius = Math.max(0, radius - ring);
    context.save();
    context.beginPath();
    context.ellipse(centerX, centerY, outerRadius, outerRadius * aspect, 0, 0, TAU);
    context.ellipse(centerX, centerY, innerRadius, innerRadius * aspect, 0, 0, TAU);
    context.clip('evenodd');
    const refractionBoost = clamp(finite(this.settings.tuning?.refraction, 1), 0, 2.5);
    context.globalAlpha = Math.min(0.44, phase.shockAlpha * 0.3 * refractionBoost);
    context.drawImage(
      scratch,
      0,
      0,
      scratch.width,
      scratch.height,
      displacement / Math.max(0.25, dpr),
      -displacement * 0.28 / Math.max(0.25, dpr),
      layout.width,
      layout.height,
    );
    context.restore();
  }

  /**
   * Analytic advection field used by the flow overlays. It mirrors the same
   * normalized phase quantities that drive the visible simulation (shock
   * expansion, buoyant column, cap circulation, ground outflow, wind), so
   * streamlines curve with the motion the viewer actually sees. Values are
   * screen-space display velocities only.
   */
  _flowVelocity(x, y, layout, phase, scratch) {
    const behavior = this._behavior;
    const dx = x - layout.originX;
    const dy = y - layout.eventY;
    const flatDy = dy / 0.66;
    const distance = Math.hypot(dx, flatDy) + 0.001;
    let vx = 0;
    let vy = 0;

    // Expanding pressure front: strongest in a band around the current radius.
    const maxRadius = layout.min * (0.58 + behavior.shock * 0.16) * layout.energyScale;
    const front = Math.max(6, maxRadius * phase.shockProgress);
    const bandWidth = front * 0.24 + 10;
    const frontWeight = Math.exp(-((distance - front) ** 2) / (bandWidth * bandWidth))
      * phase.shockAlpha * behavior.shock;
    vx += (dx / distance) * frontWeight * 46;
    vy += (flatDy / distance) * frontWeight * 30;

    // Buoyant column: upward flow inside the stem envelope.
    const rise = layout.min * 0.2 * behavior.column * layout.scale * phase.rise;
    const capY = layout.eventY - rise;
    const stemWidth = layout.min * (0.035 + behavior.column * 0.03) * layout.scale;
    if (y > capY - stemWidth && y < layout.surfaceY + 4 && rise > 4) {
      const columnWeight = Math.exp(-(dx * dx) / (stemWidth * stemWidth * 2.2)) * phase.rise;
      vy -= columnWeight * 34 * behavior.column;
      vx += columnWeight * layout.windX * 22;
      // Entrainment: gentle inflow toward the stem at low altitude.
      vx += -Math.sign(dx) * Math.exp(-Math.abs(dx) / (stemWidth * 3.2)) * columnWeight * 8;
    }

    // Cap circulation for mushroom-capable families: paired counter vortices.
    if (behavior.mushroom > 0.15 && phase.cloud > 0.05 && rise > 8) {
      const capRadius = layout.min * 0.07 * layout.scale * behavior.cloud * (0.35 + 0.65 * phase.cloud) * 1.4;
      for (const side of [-1, 1]) {
        const cx = layout.originX + side * capRadius * 0.85 + layout.windX * layout.min * 0.1;
        const cy = capY;
        const rx = x - cx;
        const ry = y - cy;
        const vortexDistance = Math.hypot(rx, ry) + 0.001;
        const falloff = Math.exp(-(vortexDistance * vortexDistance) / (capRadius * capRadius * 1.6));
        const spin = side * 30 * phase.cloud * behavior.mushroom;
        vx += (-ry / vortexDistance) * falloff * spin;
        vy += (rx / vortexDistance) * falloff * spin;
      }
    }

    // Ground outflow behind the surface-reflected wave.
    if (!layout.buried && y > layout.surfaceY - layout.min * 0.05 && phase.surface > 0.03) {
      const groundWeight = Math.exp(-Math.abs(y - layout.surfaceY) / (layout.min * 0.03))
        * phase.surface * behavior.dust;
      vx += Math.sign(dx || 1) * groundWeight * 20;
      vy -= groundWeight * 6;
    }

    // Ambient wind drift.
    vx += layout.windX * 14 * (behavior.windResponse || 0.7);

    scratch.vx = vx;
    scratch.vy = vy;
    return scratch;
  }

  /**
   * Profile-gated late wind/shear strands. The flow overlay used to draw a
   * large set of contiguous streamlines from nearby shock seeds; during the
   * mature Ground Burst those paths converged and read as one painted ribbon.
   * This cheaper analytical path keeps the same canvas layer and natural GPU
   * smoke occlusion, but gives the profile a small deterministic family of
   * broken, depth-weighted strands instead of a merged band.
   */
  _drawWindStreakOverlay(glow, layout, phase, quality, profile, activity, structural) {
    const qualityId = ['mobile', 'balanced', 'high'].includes(this.settings.quality)
      ? this.settings.quality
      : 'balanced';
    const tier = profile?.[qualityId] || profile?.balanced;
    if (!tier) return;
    const normalized = phase.normalized;
    const onset = smoothstep(finite(profile.onset, 0.32), finite(profile.peak, 0.58), normalized);
    const fade = 1 - smoothstep(finite(profile.fadeStart, 0.78), finite(profile.fadeEnd, 1), normalized);
    const timing = onset * fade;
    if (timing <= 0.006) return;

    const count = Math.max(5, Math.round(finite(tier.count, 8)));
    const segments = Math.max(6, Math.min(18, Math.round(finite(tier.segments, 10))));
    const windX = layout.windX || (this.settings.windDirection <= 180 ? 0.001 : -0.001);
    const windY = (layout.windY || 0) * 0.42;
    const windMagnitude = Math.hypot(windX, windY) || 1;
    const alongX = windX / windMagnitude;
    const alongY = windY / windMagnitude;
    const normalX = -alongY;
    const normalY = alongX;
    const rise = layout.min * 0.2 * this._behavior.column * layout.scale * phase.rise;
    const capY = layout.eventY - rise;
    const capX = layout.originX + layout.windX * layout.min * 0.16 * phase.rise * phase.rise;
    const spanMin = finite(tier.spanMin, 0.3);
    const spanMax = Math.max(spanMin, finite(tier.spanMax, 0.6));
    const widthMin = Math.max(0.35, finite(tier.widthMin, 0.6));
    const widthMax = Math.max(widthMin, finite(tier.widthMax, 1.2));
    const opacityMin = Math.max(0.01, finite(tier.opacityMin, 0.05));
    const opacityMax = Math.max(opacityMin, finite(tier.opacityMax, 0.15));
    const curvature = finite(tier.curvature, 0.12);
    const amplitude = finite(tier.amplitude, 0.05);
    const dropout = clamp(finite(tier.dropout, 0.3), 0.08, 0.7);
    const fadeJitter = clamp(finite(tier.fadeJitter, 0.1), 0, 0.3);
    const baseActivity = timing * activity * structural;

    glow.save();
    glow.lineCap = 'round';
    glow.lineJoin = 'round';
    for (let strand = 0; strand < count; strand += 1) {
      const hash = (label) => hashString(`${this.settings.seed}:wind-strand:${strand}:${label}`) % 1000 / 1000;
      const span = layout.min * lerp(spanMin, spanMax, hash('span'));
      const depth = hash('depth');
      const baseOffset = (hash('offset') - 0.5) * layout.min * 0.17;
      const phaseOffset = hash('phase') * TAU;
      const strandFadeStart = clamp(
        finite(profile.fadeStart, 0.78) + hash('fade') * fadeJitter,
        0,
        finite(profile.fadeEnd, 1) - 0.04,
      );
      const strandFade = 1 - smoothstep(
        strandFadeStart,
        Math.max(strandFadeStart + 0.04, finite(profile.fadeEnd, 1)),
        normalized,
      );
      const curveScale = (0.66 + hash('curve') * 0.62) * curvature;
      const strandAmplitude = layout.min * amplitude * (0.62 + hash('amplitude') * 0.72);
      const lineWidth = lerp(widthMin, widthMax, hash('width')) * (0.84 + depth * 0.2);
      const strandAlpha = baseActivity
        * strandFade
        * lerp(opacityMin, opacityMax, 0.28 + depth * 0.72)
        * (1 - depth * 0.36);
      if (strandAlpha <= 0.004) continue;
      const color = depth > 0.58 ? this._palette.smokeLight : this._palette.ember;
      glow.strokeStyle = colorWithAlpha(color, strandAlpha);
      glow.lineWidth = lineWidth;

      let pathOpen = false;
      let runLength = 0;
      const flush = () => {
        if (pathOpen && runLength >= 2) glow.stroke();
        pathOpen = false;
        runLength = 0;
      };

      for (let segment = 0; segment <= segments; segment += 1) {
        const progress = segment / segments;
        const along = (progress - 0.48) * span;
        const wave = Math.sin(
          progress * TAU * (0.52 + hash('wave') * 0.6)
            + phase.time * (0.12 + hash('speed') * 0.1)
            + phaseOffset,
        );
        const fineWave = Math.sin(
          progress * TAU * (1.1 + hash('fine') * 0.7)
            - phase.time * 0.07
            - phaseOffset * 0.68,
        );
        const localOffset = baseOffset
          + (wave * 0.72 + fineWave * 0.28) * strandAmplitude
          + (progress - 0.5) * span * curveScale * 0.18;
        const x = capX + alongX * along + normalX * localOffset;
        const y = capY + alongY * along + normalY * localOffset;
        const segmentHash = hashString(`${this.settings.seed}:wind-segment:${strand}:${segment}`) % 1000 / 1000;
        const keep = segment === 0 || segment === segments
          || segmentHash > dropout * (0.72 + hash('break') * 0.46);
        if (!keep) {
          flush();
          continue;
        }
        if (!pathOpen) {
          glow.beginPath();
          glow.moveTo(x, y);
          pathOpen = true;
          runLength = 1;
        } else {
          glow.lineTo(x, y);
          runLength += 1;
        }
      }
      flush();
    }
    glow.restore();
  }

  /**
   * Optional flow overlays. 'flow' adds restrained streamlines that follow the
   * analytic field above; 'field' adds pressure contours and shock-normal
   * markers in a scientific-visualization register. Qualitative, no units.
   */
  _drawFlowOverlay(glow, layout, phase, quality) {
    const mode = this.settings.flowMode;
    if (mode === 'off' || phase.normalized <= 0.001) return;
    const tuning = this.settings.tuning || DEFAULT_TUNING;
    const structural = clamp(tuning.structuralIntensity, 0, 2.5);
    if (structural <= 0.02) return;
    const isField = mode === 'field';
    const scratch = { vx: 0, vy: 0 };
    const activity = saturate(
      phase.shockAlpha * 1.2 + phase.rise * 0.9 + phase.cloud * 0.7 + phase.surface * 0.5,
    ) * (1 - phase.dissipation * 0.6);
    if (activity <= 0.015) return;

    glow.save();
    glow.globalCompositeOperation = 'screen';

    const windStreakProfile = this._preset?.researchModel?.windStreaks;
    if (windStreakProfile?.mode > 0) {
      this._drawWindStreakOverlay(glow, layout, phase, quality, windStreakProfile, activity, structural);
    } else {
      // Existing analytic streamlines remain unchanged for every profile that
      // does not opt into the dedicated wind/shear strand treatment.
      const lineBudget = Math.round(
        (isField ? 30 : 20) * clamp(tuning.flowDensity, 0, 2.5) * Math.max(0.45, quality),
      );
      const steps = Math.round(15 * clamp(tuning.flowLifetime, 0.4, 2.2));
      const stepSize = Math.max(3, layout.min * 0.009);
      for (let line = 0; line < lineBudget; line += 1) {
        const angle = this._particleAngle[line];
        const radiusFraction = 0.15 + this._particleDepth[line] * 0.85;
        const maxRadius = layout.min * (0.58 + this._behavior.shock * 0.16) * layout.energyScale;
        const startRadius = maxRadius * phase.shockProgress * radiusFraction
          + this._particleSize[line] * layout.min * 0.02;
        let x = layout.originX + Math.cos(angle) * startRadius;
        let y = layout.eventY + Math.sin(angle) * startRadius * 0.66
          - this._particleRise[line] * layout.min * 0.05 * phase.rise;
        if (y > layout.surfaceY + 6) y = layout.surfaceY - this._particleDepth[line] * layout.min * 0.02;
        let previousX = x;
        let previousY = y;
        let drawn = 0;
        glow.beginPath();
        glow.moveTo(x, y);
        let speedSum = 0;
        let upSum = 0;
        for (let step = 0; step < steps; step += 1) {
          this._flowVelocity(x, y, layout, phase, scratch);
          const speed = Math.hypot(scratch.vx, scratch.vy);
          if (speed < 1.4) break;
          x += (scratch.vx / speed) * stepSize;
          y += (scratch.vy / speed) * stepSize;
          if (x < -20 || x > layout.width + 20 || y < -20 || y > layout.surfaceY + layout.min * 0.05) break;
          glow.lineTo(x, y);
          speedSum += speed;
          upSum += -scratch.vy;
          previousX = x;
          previousY = y;
          drawn += 1;
        }
        if (drawn < 3) continue;
        const meanSpeed = speedSum / drawn;
        const buoyant = upSum > 0;
        const lineAlpha = saturate(activity * (0.1 + Math.min(0.32, meanSpeed / 220)))
          * structural * (isField ? 1 : 0.75);
        glow.strokeStyle = colorWithAlpha(
          buoyant ? this._palette.ember : this._palette.shock,
          lineAlpha,
        );
        glow.lineWidth = 0.7 + this._particleSize[line] * 0.45;
        glow.stroke();
        // Direction cue: a small head dot at the streamline tip.
        if (isField && drawn > 5) {
          glow.fillStyle = colorWithAlpha(this._palette.text, lineAlpha * 1.4);
          glow.beginPath();
          glow.arc(previousX, previousY, 1.1, 0, TAU);
          glow.fill();
        }
      }
    }

    if (isField) {
      // Pressure contours: fading irregular bands beyond the front.
      const maxRadius = layout.min * (0.58 + this._behavior.shock * 0.16) * layout.energyScale;
      const front = maxRadius * phase.shockProgress;
      if (front > 12 && phase.shockAlpha > 0.01) {
        glow.save();
        glow.translate(layout.originX, layout.eventY);
        for (let contour = 0; contour < 4; contour += 1) {
          const contourRadius = front * (1.12 + contour * 0.16);
          const contourAlpha = phase.shockAlpha * 0.2 * (1 - contour / 4.6) * structural;
          if (contourAlpha <= 0.006) continue;
          glow.strokeStyle = colorWithAlpha(this._palette.grid, contourAlpha);
          glow.lineWidth = 0.8;
          glow.setLineDash([5, 7]);
          this._traceShockBand(glow, contourRadius, 0.66, 0.02, contour + 5);
          glow.stroke();
        }
        glow.setLineDash([]);
        // Shock-normal markers on the leading edge.
        const ticks = 14;
        glow.strokeStyle = colorWithAlpha(this._palette.text, phase.shockAlpha * 0.34 * structural);
        glow.lineWidth = 1;
        for (let tick = 0; tick < ticks; tick += 1) {
          const tickAngle = (tick / ticks) * TAU;
          const inner = front * (1 + this._shockWobble(tickAngle, 0, 0.02));
          const cosA = Math.cos(tickAngle);
          const sinA = Math.sin(tickAngle) * 0.66;
          glow.beginPath();
          glow.moveTo(cosA * inner, sinA * inner);
          glow.lineTo(cosA * (inner + 7), sinA * (inner + 7));
          glow.stroke();
        }
        glow.restore();
      }
    }
    glow.restore();
  }

  _drawFireball(context, layout, phase, quality) {
    if (phase.fireAlpha <= 0.004 || this._behavior.fireball <= 0.02) return;
    const behavior = this._behavior;
    const radius = Math.max(2, layout.min * 0.075 * behavior.fireball * layout.scale * (0.12 + phase.fireGrowth * 0.88));
    const alpha = phase.fireAlpha;
    const gradient = context.createRadialGradient(
      layout.originX - radius * 0.16,
      layout.eventY - radius * 0.18,
      radius * 0.02,
      layout.originX,
      layout.eventY,
      radius,
    );
    gradient.addColorStop(0, colorWithAlpha(this._palette.core, Math.min(1, alpha * 1.15)));
    gradient.addColorStop(0.18, colorWithAlpha(this._palette.hot, alpha));
    gradient.addColorStop(0.54, colorWithAlpha(this._palette.flame, alpha * 0.92));
    gradient.addColorStop(0.82, colorWithAlpha(this._palette.ember, alpha * 0.36));
    gradient.addColorStop(1, colorWithAlpha(this._palette.flame, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(layout.originX, layout.eventY, radius, 0, TAU);
    context.fill();

    const lobeCount = Math.max(5, Math.round((7 + behavior.roll * 8) * quality));
    for (let index = 0; index < lobeCount; index += 1) {
      const angle = this._particleAngle[index] + phase.time * (0.15 + this._particleBias[index] * 0.08);
      const distance = radius * (0.38 + this._particleDepth[index] * 0.38);
      const x = layout.originX + Math.cos(angle) * distance;
      const y = layout.eventY + Math.sin(angle) * distance * 0.78;
      const lobeRadius = radius * (0.12 + this._particleSize[index] * 0.11);
      const lobe = context.createRadialGradient(x, y, 0, x, y, lobeRadius);
      lobe.addColorStop(0, colorWithAlpha(index % 3 ? this._palette.hot : this._palette.core, alpha * 0.72));
      lobe.addColorStop(0.55, colorWithAlpha(this._palette.flame, alpha * 0.46));
      lobe.addColorStop(1, colorWithAlpha(this._palette.flame, 0));
      context.fillStyle = lobe;
      context.beginPath();
      context.arc(x, y, lobeRadius, 0, TAU);
      context.fill();
    }
  }

  _drawSurfaceInteraction(context, layout, phase) {
    if (phase.surface <= 0.003 || this._behavior.dust <= 0.02) return;
    const radius = layout.min * 0.15 * layout.scale
      * Math.max(this._behavior.dust, this._behavior.surface * 0.78)
      * easeOutCubic(phase.surface);
    const alpha = (1 - phase.dissipation * 0.55) * phase.surface;
    const gradient = context.createRadialGradient(layout.originX, layout.surfaceY, 0, layout.originX, layout.surfaceY, Math.max(2, radius));
    gradient.addColorStop(0, colorWithAlpha(this._palette.dust, alpha * 0.5));
    gradient.addColorStop(0.48, colorWithAlpha(this._palette.dust, alpha * 0.24));
    gradient.addColorStop(1, colorWithAlpha(this._palette.dust, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(layout.originX, layout.surfaceY, radius, radius * 0.16, 0, 0, TAU);
    context.fill();

    if (this._behavior.key === 'meteorImpact' || this._behavior.key === 'underground') {
      context.save();
      context.fillStyle = colorWithAlpha('#020304', 0.68 * phase.surface);
      context.beginPath();
      context.ellipse(layout.originX, layout.surfaceY + 2, radius * 0.24, radius * 0.045, 0, 0, TAU);
      context.fill();
      context.strokeStyle = colorWithAlpha(this._palette.dust, 0.4 * phase.surface);
      context.lineWidth = Math.max(1, radius * 0.015);
      context.beginPath();
      context.ellipse(layout.originX, layout.surfaceY + 1, radius * 0.3, radius * 0.065, 0, Math.PI, TAU);
      context.stroke();
      context.restore();
    }
  }

  _drawCloudBody(context, layout, phase, quality) {
    const behavior = this._behavior;
    if (phase.rise <= 0.002 || behavior.cloud <= 0.02) return;
    // Cloud formation: buoyant rise plus deterministic lobes and horizontal wind drift.
    const tuning = this.settings.tuning || DEFAULT_TUNING;
    const mushroom = behavior.mushroom > 0.2;
    const rise = layout.min * 0.2 * behavior.column * layout.scale * phase.rise;
    const drift = layout.windX * layout.min * 0.16 * phase.rise * phase.rise;
    const capX = layout.originX + drift;
    const capY = layout.eventY - rise;
    const stemWidth = layout.min * (mushroom ? 0.034 : 0.022) * layout.scale
      * Math.max(0.35, behavior.column) * clamp(tuning.stemThickness, 0.5, 2);
    const capRadius = layout.min * 0.07 * layout.scale * behavior.cloud
      * (0.35 + 0.65 * phase.cloud) * (mushroom ? clamp(tuning.capWidth, 0.5, 2) : 1);
    const cloudAlpha = saturate((phase.rise + phase.cloud) * 0.62) * (1 - phase.dissipation * 0.42);

    context.save();
    const stemGradient = context.createLinearGradient(layout.originX, layout.surfaceY, capX, capY);
    stemGradient.addColorStop(0, colorWithAlpha(this._palette.dust, cloudAlpha * 0.22));
    stemGradient.addColorStop(0.42, colorWithAlpha(this._palette.smoke, cloudAlpha * 0.55));
    stemGradient.addColorStop(1, colorWithAlpha(this._palette.cloud, cloudAlpha * 0.72));
    context.strokeStyle = stemGradient;
    context.lineWidth = stemWidth * (0.75 + phase.rise * 0.55);
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(layout.originX, Math.min(layout.surfaceY, layout.eventY + stemWidth));
    context.bezierCurveTo(
      layout.originX - stemWidth * 0.8 + drift * 0.15,
      lerp(layout.eventY, capY, 0.38),
      capX + stemWidth * Math.sin(phase.time * 0.45),
      lerp(layout.eventY, capY, 0.72),
      capX,
      capY,
    );
    context.stroke();

    const lobeCount = Math.max(7, Math.round((15 + behavior.mushroom * 14) * quality));
    for (let index = 0; index < Math.min(MAX_CLOUD_LOBES, lobeCount); index += 1) {
      const mushroomStretch = mushroom ? 1.85 : 1;
      const turbulence = Math.sin(phase.time * 0.38 + this._lobePhase[index]) * capRadius * 0.07;
      const x = capX + this._lobeX[index] * capRadius * mushroomStretch + turbulence;
      const y = capY + this._lobeY[index] * capRadius * (mushroom ? 0.52 : 0.82);
      const radius = Math.max(2, capRadius * (mushroom ? 0.28 : 0.24) * this._lobeSize[index]);
      const puff = context.createRadialGradient(x - radius * 0.2, y - radius * 0.22, 0, x, y, radius);
      const light = index % 4 === 0 ? this._palette.smokeLight : this._palette.cloud;
      puff.addColorStop(0, colorWithAlpha(light, cloudAlpha * 0.62));
      puff.addColorStop(0.7, colorWithAlpha(this._palette.smoke, cloudAlpha * 0.56));
      puff.addColorStop(1, colorWithAlpha(this._palette.smoke, 0));
      context.fillStyle = puff;
      context.beginPath();
      context.arc(x, y, radius, 0, TAU);
      context.fill();
    }

    if (mushroom && phase.cloud > 0.12) {
      // Toroidal under-cap shading: a darker occluded band beneath the cap.
      const underCap = context.createRadialGradient(capX, capY + capRadius * 0.42, capRadius * 0.2, capX, capY + capRadius * 0.42, capRadius * 1.5);
      underCap.addColorStop(0, colorWithAlpha('#0b0a09', cloudAlpha * 0.3));
      underCap.addColorStop(0.7, colorWithAlpha('#0b0a09', cloudAlpha * 0.12));
      underCap.addColorStop(1, colorWithAlpha('#0b0a09', 0));
      context.fillStyle = underCap;
      context.beginPath();
      context.ellipse(capX, capY + capRadius * 0.42, capRadius * 1.5, capRadius * 0.4, 0, 0, TAU);
      context.fill();

      // Outer roll-down: lobes curling beneath the cap rim on both sides.
      const rollProgress = saturate(phase.cloud * 1.15);
      for (const side of [-1, 1]) {
        for (let roll = 0; roll < 3; roll += 1) {
          const rollAngle = 0.3 + roll * 0.42;
          const rollX = capX + side * capRadius * (1.5 - roll * 0.16) * (0.9 + rollProgress * 0.4);
          const rollY = capY + capRadius * (0.2 + Math.sin(rollAngle) * 0.5 * rollProgress);
          const rollRadius = Math.max(2, capRadius * (0.3 - roll * 0.06));
          const rollPuff = context.createRadialGradient(rollX, rollY, 0, rollX, rollY, rollRadius);
          rollPuff.addColorStop(0, colorWithAlpha(this._palette.cloud, cloudAlpha * 0.5 * rollProgress));
          rollPuff.addColorStop(1, colorWithAlpha(this._palette.smoke, 0));
          context.fillStyle = rollPuff;
          context.beginPath();
          context.arc(rollX, rollY, rollRadius, 0, TAU);
          context.fill();
        }
      }

      // Sunlit cap rim.
      context.strokeStyle = colorWithAlpha(this._palette.smokeLight, cloudAlpha * 0.3);
      context.lineWidth = Math.max(1, capRadius * 0.08);
      context.beginPath();
      context.ellipse(capX, capY - capRadius * 0.08, capRadius * 1.62, capRadius * 0.42, 0, Math.PI * 1.06, Math.PI * 1.94);
      context.stroke();
    }
    context.restore();
  }

  _drawParticles(context, layout, phase, activeCount, quality) {
    const behavior = this._behavior;
    const layers = this.settings.layers;
    const sizeScale = Math.max(0.55, layout.min / 720) * (0.82 + layout.scale * 0.18);
    const windTravel = layout.windX * layout.min * 0.24;
    context.save();

    for (let pass = 0; pass < 3; pass += 1) {
      for (let index = 0; index < activeCount; index += 1) {
        const kind = this._particleKind[index];
        const isGround = kind === 1 || kind === 2;
        const isCloud = kind === 3 || kind === 4 || kind === 6;
        const isLight = kind === 0 || kind === 5;
        if ((pass === 0 && !isGround) || (pass === 1 && !isCloud) || (pass === 2 && !isLight)) continue;
        if (isGround && kind === 1 && !layers.dust) continue;
        if (isGround && kind === 2 && !layers.debris) continue;
        if (isCloud && !layers.cloud) continue;
        if (isLight && !layers.fireball) continue;

        const ageSeconds = phase.time - this._particleStart[index];
        const age = ageSeconds / Math.max(0.05, this._particleLife[index]);
        if (age <= 0 || age >= 1) continue;
        const eased = easeOutCubic(age);
        const fade = smoothstep(0, 0.08, age) * (1 - smoothstep(0.65, 1, age));
        const angle = this._particleAngle[index];
        const speed = this._particleSpeed[index];
        const rise = this._particleRise[index];
        const turbulence = Math.sin(age * 9 + this._particlePhase[index]) * this._particleBias[index];
        let x = layout.originX;
        let y = layout.eventY;
        let radius = this._particleSize[index] * sizeScale;
        let alpha = fade;

        if (kind === 1) {
          const direction = Math.cos(angle) < 0 ? -1 : 1;
          x += direction * layout.min * 0.2 * behavior.dust * speed * eased + windTravel * age * 0.18;
          y = layout.surfaceY - layout.min * 0.035 * rise * Math.sin(Math.PI * age) + turbulence * 4;
          radius *= 1.2 + age * 2.8;
          alpha *= 0.28 * behavior.dust;
          context.fillStyle = colorWithAlpha(this._palette.dust, alpha);
        } else if (kind === 2) {
          const arcAngle = Math.PI * (0.12 + (angle / TAU) * 0.76);
          const vx = Math.cos(arcAngle) * layout.min * 0.18 * behavior.ejecta * speed;
          const initialUp = Math.sin(arcAngle) * layout.min * 0.22 * behavior.ejecta * rise;
          x += vx * age + windTravel * age * 0.08;
          y = layout.surfaceY - initialUp * age + layout.min * 0.18 * age * age;
          radius *= 0.45;
          alpha *= Math.min(0.85, behavior.debris * 0.7);
          context.fillStyle = colorWithAlpha(this._palette.ember, alpha);
        } else if (kind === 3) {
          const vertical = layout.min * 0.2 * behavior.column * rise * eased;
          x += windTravel * age * age + turbulence * layout.min * 0.012 * (0.3 + age);
          y -= vertical;
          radius *= 1.3 + age * 3.1;
          alpha *= 0.25 * behavior.smoke;
          context.fillStyle = colorWithAlpha(this._palette.smoke, alpha);
        } else if (kind === 4 || kind === 6) {
          const vertical = layout.min * 0.2 * behavior.column * (0.5 + rise * 0.6) * eased;
          const spread = layout.min * 0.07 * behavior.cloud * speed * Math.pow(age, 1.5);
          x += Math.cos(angle) * spread + windTravel * age * age;
          y -= vertical + Math.sin(angle) * spread * 0.35;
          radius *= 1.8 + age * 4.5;
          alpha *= 0.2 * behavior.cloud;
          context.fillStyle = colorWithAlpha(kind === 6 ? this._palette.smokeLight : this._palette.cloud, alpha);
        } else {
          const radial = layout.min * 0.15 * behavior.fireball * speed * eased;
          x += Math.cos(angle) * radial + layout.windX * layout.min * 0.035 * age;
          y += Math.sin(angle) * radial * 0.75 - layout.min * 0.035 * rise * age;
          radius *= kind === 5 ? 0.55 : 0.75;
          alpha *= kind === 5 ? 0.8 : 0.62;
          context.fillStyle = colorWithAlpha(kind === 5 ? this._palette.plasma : this._palette.ember, alpha);
        }

        if (radius < 1.25 || quality < 0.5) {
          context.fillRect(x, y, Math.max(1, radius), Math.max(1, radius));
        } else {
          context.beginPath();
          context.arc(x, y, Math.min(radius, layout.min * 0.022), 0, TAU);
          context.fill();
        }
      }
    }
    context.restore();
  }

  _drawElectrical(context, layout, phase, quality) {
    const alpha = phase.fireAlpha * (1 - phase.dissipation);
    if (alpha <= 0.01) return;
    context.save();
    context.strokeStyle = colorWithAlpha(this._palette.plasma, alpha * 0.82);
    context.lineWidth = Math.max(0.8, layout.scale * 1.3);
    context.globalCompositeOperation = 'screen';
    const arcs = Math.max(3, Math.round(7 * quality));
    for (let branch = 0; branch < arcs; branch += 1) {
      const angle = this._particleAngle[branch] + phase.time * (0.28 + branch * 0.015);
      const length = layout.min * (0.1 + this._particleDepth[branch] * 0.12) * layout.scale;
      context.beginPath();
      context.moveTo(layout.originX, layout.eventY);
      for (let segment = 1; segment <= 7; segment += 1) {
        const amount = segment / 7;
        const jitter = Math.sin(this._particlePhase[branch] + segment * 5.17) * length * 0.028;
        context.lineTo(
          layout.originX + Math.cos(angle) * length * amount + Math.sin(angle) * jitter,
          layout.eventY + Math.sin(angle) * length * amount - Math.cos(angle) * jitter,
        );
      }
      context.stroke();
    }
    context.restore();
  }

  _drawMeteorTrail(glow, matter, layout, phase, quality = 1) {
    this._drawVolumetricMeteorTrail(glow, matter, layout, phase, quality);
  }

  _drawVolcanoVent(glow, matter, layout, phase) {
    const base = layout.surfaceY;
    const width = layout.min * 0.085 * layout.scale;
    matter.fillStyle = colorWithAlpha(this._palette.ground, 0.98);
    matter.beginPath();
    matter.moveTo(layout.originX - width * 1.8, base + 2);
    matter.lineTo(layout.originX - width * 0.34, base - width * 0.8);
    matter.lineTo(layout.originX + width * 0.3, base - width * 0.8);
    matter.lineTo(layout.originX + width * 1.9, base + 2);
    matter.closePath();
    matter.fill();
    const pulse = 0.55 + Math.sin(phase.time * 3.4) * 0.18;
    glow.fillStyle = colorWithAlpha(this._palette.flame, pulse * (1 - phase.dissipation * 0.3));
    glow.beginPath();
    glow.ellipse(layout.originX, base - width * 0.77, width * 0.33, width * 0.11, 0, 0, TAU);
    glow.fill();
  }

  _drawOverview(context, layout, phase, activeCount, quality) {
    const { width, height } = layout;
    const centerX = this._origin.x * width;
    const centerY = this._origin.y * height;
    const layers = this.settings.layers;
    let base = layout.min * 0.075 * layout.energyScale * this._behavior.scale;
    let scaledPreset = null;
    if (typeof LabData.scalePreset === 'function') {
      try {
        scaledPreset = LabData.scalePreset(this._preset, layout.min, this.settings.energy);
        base = scaledPreset.baseRadius;
      } catch (_) {
        scaledPreset = null;
      }
    }
    const overview = this._preset.overview || {};
    const luminous = finite(overview.luminous, this._behavior.fireball);
    const innerWave = finite(overview.innerWave, this._behavior.shock);
    const outerWave = finite(overview.outerWave, this._behavior.shock * 1.25);
    const waveProgress = Math.max(0.04, phase.shockProgress);
    const zones = [
      {
        enabled: layers.fireball,
        radius: (scaledPreset?.fireballRadius || base * Math.max(0.3, luminous)) * (0.15 + phase.fireGrowth * 0.85),
        color: this._palette.flame,
        label: 'FIREBALL · CORE',
        dash: [],
      },
      {
        enabled: layers.thermal,
        radius: base * (1.05 + luminous * 0.8) * (0.25 + phase.fireGrowth * 0.75),
        color: this._palette.thermal,
        label: 'THERMAL · INNER ZONE',
        dash: [3, 5],
      },
      {
        enabled: layers.shock,
        radius: base * (1.55 + innerWave * 1.25) * waveProgress,
        color: this._palette.shock,
        label: 'PRESSURE · STRONG WAVE',
        dash: [8, 6],
      },
      {
        enabled: layers.shock,
        radius: (scaledPreset?.shockRadius || base * (2.45 + outerWave * 1.35)) * waveProgress,
        color: this._palette.grid,
        label: 'PRESSURE · LIGHT WAVE',
        dash: [2, 7],
      },
    ];

    if (layers.grid) this._drawOverviewGrid(context, layout);
    context.save();
    context.textBaseline = 'middle';
    context.font = `${Math.max(9, Math.min(12, width / 95))}px "JetBrains Mono", ui-monospace, monospace`;
    for (let index = zones.length - 1; index >= 0; index -= 1) {
      const zone = zones[index];
      if (!zone.enabled || zone.radius < 1) continue;
      const radius = Math.min(layout.min * 0.72, zone.radius);
      const fill = context.createRadialGradient(centerX, centerY, Math.max(0, radius * 0.72), centerX, centerY, radius);
      fill.addColorStop(0, colorWithAlpha(zone.color, 0));
      fill.addColorStop(0.88, colorWithAlpha(zone.color, 0.018 + index * 0.008));
      fill.addColorStop(1, colorWithAlpha(zone.color, 0.075));
      context.fillStyle = fill;
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, TAU);
      context.fill();
      context.setLineDash(zone.dash);
      context.strokeStyle = colorWithAlpha(zone.color, index < 2 ? 0.62 : 0.44);
      context.lineWidth = index < 2 ? 1.4 : 1;
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, TAU);
      context.stroke();
      this._drawZoneLabel(context, centerX, centerY, radius, zone.label, zone.color, width, height, index);
    }
    context.setLineDash([]);

    const centerGlow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(4, base * 0.32));
    centerGlow.addColorStop(0, colorWithAlpha(this._palette.core, 0.92 * phase.fireAlpha));
    centerGlow.addColorStop(0.45, colorWithAlpha(this._palette.flame, 0.45 * phase.fireAlpha));
    centerGlow.addColorStop(1, colorWithAlpha(this._palette.flame, 0));
    context.fillStyle = centerGlow;
    context.beginPath();
    context.arc(centerX, centerY, Math.max(4, base * 0.32), 0, TAU);
    context.fill();
    context.fillStyle = colorWithAlpha(this._palette.text, 0.72);
    context.fillText('EVENT ORIGIN · ABSTRACT', clamp(centerX + 12, 14, width - 190), clamp(centerY - 12, 16, height - 16));

    if ((layers.dust || layers.cloud) && (phase.surface > 0.01 || phase.cloud > 0.01)) {
      this._drawOverviewPlume(context, layout, phase, activeCount, quality);
    }
    this._drawOverviewHeader(context, layout, phase);
    context.restore();
  }

  _drawOverviewGrid(context, layout) {
    const { width, height } = layout;
    context.save();
    context.strokeStyle = colorWithAlpha(this._palette.grid, 0.12);
    context.lineWidth = 1;
    const spacing = Math.max(32, Math.round(layout.min / 12), width / 72, height / 72);
    for (let x = ((width / 2) % spacing); x < width; x += spacing) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = ((height / 2) % spacing); y < height; y += spacing) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    context.strokeStyle = colorWithAlpha(this._palette.grid, 0.25);
    context.beginPath();
    context.moveTo(0, height * 0.5);
    context.lineTo(width, height * 0.5);
    context.moveTo(width * 0.5, 0);
    context.lineTo(width * 0.5, height);
    context.stroke();
    context.restore();
  }

  _drawZoneLabel(context, centerX, centerY, radius, label, color, width, height, index) {
    const angle = -0.56 + index * 0.18;
    const anchorX = centerX + Math.cos(angle) * radius;
    const anchorY = centerY + Math.sin(angle) * radius;
    const labelX = clamp(anchorX + 12, 12, width - 190);
    const labelY = clamp(anchorY, 16, height - 16);
    context.setLineDash([]);
    context.strokeStyle = colorWithAlpha(color, 0.36);
    context.beginPath();
    context.moveTo(anchorX, anchorY);
    context.lineTo(labelX - 4, labelY);
    context.stroke();
    context.fillStyle = colorWithAlpha(color, 0.85);
    context.fillText(label, labelX, labelY);
  }

  _drawOverviewPlume(context, layout, phase, activeCount, quality) {
    const centerX = this._origin.x * layout.width;
    const centerY = this._origin.y * layout.height;
    const directionX = layout.windX || 0.001;
    const directionY = layout.windY || -0.08;
    const particulate = finite(this._preset.overview?.particulate, Math.max(this._behavior.dust, this._behavior.cloud));
    const length = layout.min * (0.07 + layout.windStrength * 0.32)
      * (0.35 + phase.rise * 0.65)
      * clamp(particulate, 0.2, 1.8);
    const magnitude = Math.hypot(directionX, directionY) || 1;
    const ux = directionX / magnitude;
    const uy = directionY / magnitude;
    const perpendicularX = -uy;
    const perpendicularY = ux;
    const points = Math.max(16, Math.min(180, Math.round(activeCount * 0.09 * quality)));
    context.save();
    for (let index = 0; index < points; index += 1) {
      const amount = this._particleDepth[index];
      const spread = (this._particleBias[index]) * layout.min * 0.035 * (0.2 + amount);
      const x = centerX + ux * length * amount + perpendicularX * spread;
      const y = centerY + uy * length * amount + perpendicularY * spread;
      const radius = 1 + this._particleSize[index] * (1 + amount * 2.4);
      context.fillStyle = colorWithAlpha(this._palette.dust, 0.08 + (1 - amount) * 0.16);
      context.beginPath();
      context.arc(x, y, radius, 0, TAU);
      context.fill();
    }
    context.strokeStyle = colorWithAlpha(this._palette.text, 0.48);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.lineTo(centerX + ux * Math.max(32, length * 0.55), centerY + uy * Math.max(32, length * 0.55));
    context.stroke();
    context.fillStyle = colorWithAlpha(this._palette.text, 0.72);
    context.fillText('PARTICULATE DRIFT · QUALITATIVE', clamp(centerX + ux * length * 0.6 + 8, 12, layout.width - 225), clamp(centerY + uy * length * 0.6, 16, layout.height - 16));
    context.restore();
  }

  _drawOverviewHeader(context, layout, phase) {
    const name = this._preset.name || this._preset.title || 'Selected event';
    context.save();
    context.textBaseline = 'top';
    context.fillStyle = colorWithAlpha(this._palette.text, 0.9);
    context.font = `600 ${Math.max(11, Math.min(15, layout.width / 76))}px Inter, system-ui, sans-serif`;
    context.fillText('EFFECTS OVERVIEW / NORMALIZED 0—1', 18, 18);
    context.font = `${Math.max(9, Math.min(11, layout.width / 100))}px "JetBrains Mono", ui-monospace, monospace`;
    context.fillStyle = colorWithAlpha(this._palette.text, 0.55);
    context.fillText(`${String(name).toUpperCase()} · T ${phase.normalized.toFixed(2)}`, 18, 40);
    context.fillText('ABSTRACT ZONES · NO MAP / UNITS / TARGET DATA', 18, 58);
    context.restore();
  }

  _phaseName(phase) {
    if (phase.currentPhaseId && Array.isArray(LabData.PHASES)) {
      const definition = LabData.PHASES.find((item) => item.id === phase.currentPhaseId);
      if (definition) return definition.label || definition.shortLabel;
    }
    const t = phase.normalized;
    if (t <= 0.001) return 'Ready';
    if (t < 0.08) return this._behavior.key === 'volcanic' ? 'Initial eruption' : 'Detonation / flash';
    if (t < 0.23) return 'Fireball expansion';
    if (t < 0.4) return 'Shock & surface interaction';
    if (t < 0.62) return 'Column rise';
    if (t < 0.82) return 'Cloud formation';
    return 'Drift & dissipation';
  }

  _drawExportHud(context, layout, phase, time) {
    const presetName = this._preset.name || this._preset.title || this.settings.presetId;
    const padding = Math.max(12, layout.min * 0.022);
    const boxHeight = Math.max(46, layout.min * 0.075);
    context.save();
    context.fillStyle = 'rgba(3,5,8,0.68)';
    context.fillRect(padding, padding, Math.min(layout.width - padding * 2, 430), boxHeight);
    context.fillStyle = colorWithAlpha(this._palette.text, 0.92);
    context.font = `600 ${Math.max(11, layout.min * 0.021)}px Inter, system-ui, sans-serif`;
    context.textBaseline = 'top';
    context.fillText('EXPLOSION DYNAMICS LAB', padding * 1.65, padding * 1.45);
    context.font = `${Math.max(9, layout.min * 0.015)}px "JetBrains Mono", ui-monospace, monospace`;
    context.fillStyle = colorWithAlpha(this._palette.text, 0.62);
    const line = `${String(presetName).toUpperCase()} · ${this._phaseName(phase).toUpperCase()} · ${time.toFixed(1)} S · SEED ${this.settings.seed}`;
    context.fillText(line.slice(0, 78), padding * 1.65, padding * 1.45 + Math.max(17, layout.min * 0.027));
    context.restore();
  }

  _drawWatermark(context, layout) {
    const size = Math.max(9, Math.min(12, layout.min * 0.017));
    const padding = Math.max(12, layout.min * 0.022);
    context.save();
    context.font = `500 ${size}px "JetBrains Mono", ui-monospace, monospace`;
    context.textAlign = 'right';
    context.textBaseline = 'bottom';
    context.fillStyle = 'rgba(255,255,255,0.58)';
    context.fillText('ERIC BARKER · COMPUTATIONAL STUDIO', layout.width - padding, layout.height - padding);
    context.restore();
  }
}

export default ExplosionRenderer;
