/**
 * Shared, dependency-free data and deterministic math for Explosion Dynamics Lab.
 *
 * Values in this module are dimensionless art-direction inputs. They are not
 * pressure, thermal, damage, safety-distance, or engineering calculations.
 */

export const SAFETY_DISCLAIMER =
  "Educational visualization only. All effects, distances, timings, and scales are simplified approximations and must not be used for safety, engineering, emergency planning, targeting, or real-world predictions.";

export const SAFETY_SCOPE =
  "This project provides no construction methods, material recipes, real-world maps or targets, casualty estimates, or operational guidance.";

// First load should demonstrate the upgraded research renderer. Direct preset
// links are resolved by app.js before this default is applied.
export const DEFAULT_PRESET_ID = "low-yield-nuclear-airburst";
export const DEFAULT_PALETTE_ID = "natural-fire";
export const DEFAULT_ENVIRONMENT_ID = "flat-range";
export const DEFAULT_TIME_ID = "dusk";

export const clamp = (value, min = 0, max = 1) => {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  const numeric = Number.isFinite(Number(value)) ? Number(value) : lower;
  return Math.min(upper, Math.max(lower, numeric));
};

export const lerp = (start, end, amount) => start + (end - start) * amount;

export const invLerp = (start, end, value) =>
  start === end ? 0 : (value - start) / (end - start);

export const smoothstep = (edge0, edge1, value) => {
  const t = clamp(invLerp(edge0, edge1, value));
  return t * t * (3 - 2 * t);
};

export const easeInCubic = (value) => clamp(value) ** 3;

export const easeOutCubic = (value) => 1 - (1 - clamp(value)) ** 3;

export const easeInOutCubic = (value) => {
  const t = clamp(value);
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
};

export const easeOutExpo = (value) => {
  const t = clamp(value);
  return t === 1 ? 1 : 1 - 2 ** (-10 * t);
};

export const EASING = Object.freeze({
  linear: (value) => clamp(value),
  inCubic: easeInCubic,
  outCubic: easeOutCubic,
  inOutCubic: easeInOutCubic,
  outExpo: easeOutExpo,
  smoothstep: (value) => smoothstep(0, 1, value)
});

/** Convert any label to a conservative filename/URL component. */
export function safeSlug(value, fallback = "event") {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  if (slug) return slug;
  const safeFallback = String(fallback ?? "event")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return safeFallback || "event";
}

/** Stable 32-bit FNV-1a hash for seed labels. */
export function hashString(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function hashSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return Math.trunc(seed) >>> 0;
  if (typeof seed === "bigint") return Number(seed & 0xffffffffn) >>> 0;
  return hashString(seed);
}

/** Mulberry32 is compact, deterministic, and suitable for visual variation. */
export function mulberry32(seed = 0) {
  let state = hashSeed(seed);
  return function nextRandom() {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomFromSeed = (seed, stream = 0) =>
  mulberry32(`${String(seed)}:${String(stream)}`);

function latticeRandom(x, y, seed) {
  let value = hashSeed(seed);
  value ^= Math.imul(x | 0, 0x27d4eb2d);
  value ^= Math.imul(y | 0, 0x165667b1);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

/** Smooth deterministic value noise in the 0..1 range. */
export function valueNoise1D(x, seed = 0) {
  const coordinate = Number.isFinite(Number(x)) ? Number(x) : 0;
  const x0 = Math.floor(coordinate);
  const blend = smoothstep(0, 1, coordinate - x0);
  return lerp(latticeRandom(x0, 0, seed), latticeRandom(x0 + 1, 0, seed), blend);
}

/** Smooth deterministic 2D value noise in the 0..1 range. */
export function valueNoise2D(x, y, seed = 0) {
  const px = Number.isFinite(Number(x)) ? Number(x) : 0;
  const py = Number.isFinite(Number(y)) ? Number(y) : 0;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const tx = smoothstep(0, 1, px - x0);
  const ty = smoothstep(0, 1, py - y0);
  const top = lerp(latticeRandom(x0, y0, seed), latticeRandom(x0 + 1, y0, seed), tx);
  const bottom = lerp(
    latticeRandom(x0, y0 + 1, seed),
    latticeRandom(x0 + 1, y0 + 1, seed),
    tx
  );
  return lerp(top, bottom, ty);
}

/** Dimensionless cube-root relationship used only for broad visual scaling. */
export function cubeRootScale(value, reference = 1) {
  const safeValue = Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
  const safeReference = Math.max(Number.EPSILON, Math.abs(Number(reference)) || 1);
  return Math.cbrt(safeValue / safeReference);
}

/** Map a value through a cube-root curve into a bounded 0..1 display range. */
export function normalizedCubeRootScale(value, min = 0, max = 1) {
  const lower = Math.max(0, Math.min(Number(min) || 0, Number(max) || 0));
  const upper = Math.max(lower + Number.EPSILON, Math.max(Number(min) || 0, Number(max) || 0));
  const bounded = clamp(Number(value), lower, upper);
  const rootMin = Math.cbrt(lower);
  const rootMax = Math.cbrt(upper);
  return clamp(invLerp(rootMin, rootMax, Math.cbrt(bounded)));
}

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const PHASES = deepFreeze([
  { id: "detonation", label: "Event Onset", shortLabel: "Onset" },
  { id: "peak-flash", label: "Peak Flash", shortLabel: "Flash" },
  { id: "fireball-expansion", label: "Fireball Expansion", shortLabel: "Fireball" },
  { id: "shock-front", label: "Shock Front", shortLabel: "Shock" },
  { id: "surface-interaction", label: "Surface Interaction", shortLabel: "Surface" },
  { id: "dust-debris", label: "Dust & Debris", shortLabel: "Debris" },
  { id: "column-rise", label: "Column Rise", shortLabel: "Column" },
  { id: "cloud-formation", label: "Cloud Formation", shortLabel: "Cloud" },
  { id: "mushroom-development", label: "Cloud-Cap Development", shortLabel: "Cloud Cap" },
  { id: "atmospheric-drift", label: "Atmospheric Drift", shortLabel: "Drift" },
  { id: "dissipation", label: "Dissipation", shortLabel: "Dissipation" }
]);

const PHASE_ID_SET = new Set(PHASES.map(({ id }) => id));

const phaseList = (entries) =>
  entries.map(([id, start, end, intensity = 1, curve = "smoothstep"]) => ({
    id,
    start,
    end,
    intensity,
    curve
  }));

const DEFAULT_RENDER = Object.freeze({
  flash: 1,
  fireballRadius: 1,
  fireballGrowth: 1,
  shockRadius: 1,
  shockThickness: 1,
  surfaceInteraction: 0.5,
  debris: 0.5,
  dust: 0.5,
  smoke: 0.5,
  columnRise: 0.5,
  cloudSpread: 0.5,
  turbulence: 0.5,
  windResponse: 0.5,
  atmosphericLight: 0.7,
  heatDistortion: 0.5,
  cameraShake: 0.5
});

/**
 * Renderer routing metadata is deliberately descriptive rather than physical.
 * The named source primitives are normalized visual building blocks consumed
 * by the WebGL2 engine; none corresponds to a material, device, or engineering
 * parameter. Keeping this map beside the presets makes renderer selection,
 * diagnostics, exports, and tests share one authoritative contract.
 */
export const EVENT_RENDERER_MODELS = deepFreeze({
  "compact-conventional": {
    familyId: "conventional-compact",
    family: "Conventional · compact blast",
    profileId: "compact-conventional-fluid-v1",
    sourcePrimitives: ["radial-impulse", "ground-sheet", "multiple-offset-kernels", "turbulent-source-cluster"]
  },
  "large-conventional": {
    familyId: "conventional-compact",
    family: "Conventional · large blast",
    profileId: "large-conventional-fluid-v1",
    sourcePrimitives: ["radial-impulse", "ground-sheet", "vertical-jet", "multiple-offset-kernels", "turbulent-source-cluster"]
  },
  "industrial-fireball": {
    familyId: "industrial-combustion",
    family: "Industrial · rolling fireball",
    profileId: "industrial-fireball-fluid-v1",
    sourcePrimitives: ["sustained-combustion-region", "multiple-offset-kernels", "vertical-jet", "turbulent-source-cluster"]
  },
  "fuel-air-visual-archetype": {
    familyId: "industrial-combustion",
    family: "Industrial · expansive fireball",
    profileId: "fuel-air-style-fluid-v1",
    sourcePrimitives: ["sustained-combustion-region", "ring-source", "multiple-offset-kernels", "turbulent-source-cluster"]
  },
  "underground-detonation": {
    familyId: "ground-coupled",
    family: "Ground-coupled · underground",
    profileId: "underground-fluid-v1",
    sourcePrimitives: ["vertical-jet", "ground-sheet", "ejecta-curtain", "multiple-offset-kernels", "turbulent-source-cluster"]
  },
  "meteor-airburst": {
    familyId: "meteor",
    family: "Meteor · atmospheric airburst",
    profileId: "meteor-airburst-fluid-v1",
    sourcePrimitives: ["elongated-trail", "directional-impulse", "ring-source", "multiple-offset-kernels"]
  },
  "meteor-ground-impact": {
    familyId: "meteor",
    family: "Meteor · ground impact",
    profileId: "meteor-impact-fluid-v1",
    sourcePrimitives: ["elongated-trail", "directional-impulse", "vertical-jet", "ejecta-curtain", "ground-sheet"]
  },
  "volcanic-eruption": {
    familyId: "volcanic",
    family: "Volcanic eruption",
    profileId: "volcanic-column-fluid-v1",
    sourcePrimitives: ["pulsed-column", "vertical-jet", "turbulent-source-cluster", "ground-sheet"]
  },
  "fictional-plasma-burst": {
    familyId: "fictional-plasma",
    family: "Fictional · plasma",
    profileId: "fictional-plasma-fluid-v1",
    sourcePrimitives: ["radial-impulse", "ring-source", "multiple-offset-kernels", "turbulent-source-cluster"]
  },
  "low-yield-nuclear-airburst": {
    familyId: "nuclear-scale",
    family: "Nuclear scale · research airburst",
    profileId: "nuclear-airburst-fluid-v1",
    sourcePrimitives: ["radial-impulse", "vertical-jet", "paired-cap-vortices"]
  },
  "nuclear-ground-burst": {
    familyId: "nuclear-scale",
    physicalFamilyId: "ground-coupled",
    family: "Nuclear scale · ground-coupled",
    profileId: "nuclear-ground-fluid-v1",
    sourcePrimitives: ["radial-impulse", "ground-sheet", "vertical-jet", "ejecta-curtain", "multiple-offset-kernels"]
  },
  "extreme-historical-scale": {
    familyId: "nuclear-scale",
    family: "Nuclear scale · extreme historical",
    profileId: "extreme-historical-fluid-v1",
    sourcePrimitives: ["radial-impulse", "ring-source", "vertical-jet", "multiple-offset-kernels", "paired-cap-vortices"]
  }
});

function createPreset(config) {
  const phases = config.phases.map((phase) => ({ ...phase }));
  const duration = Math.max(config.duration, ...phases.map(({ end }) => end));
  const rendererModel = EVENT_RENDERER_MODELS[config.id];
  if (!rendererModel) throw new Error(`Missing renderer model for preset: ${config.id}`);
  const existingResearchModel = config.researchModel || {};
  return deepFreeze({
    ...config,
    eventFamily: rendererModel.family,
    eventFamilyId: rendererModel.familyId,
    physicalFamilyId: rendererModel.physicalFamilyId || rendererModel.familyId,
    researchModel: {
      engine: "webgl2-fluid-2.5d",
      fixedStep: 1 / 30,
      normalizedFields: ["velocity", "temperature", "smoke", "incandescent", "dust"],
      diagnostics: ["velocity", "temperature", "smoke", "incandescent", "pressure", "divergence", "vorticity", "tracers"],
      ...existingResearchModel,
      id: rendererModel.profileId,
      familyId: rendererModel.familyId,
      sourcePrimitives: [...rendererModel.sourcePrimitives]
    },
    duration,
    disclaimer: SAFETY_DISCLAIMER,
    safetyScope: SAFETY_SCOPE,
    render: { ...DEFAULT_RENDER, ...config.render },
    phases
  });
}

export const PALETTES = deepFreeze([
  {
    id: "natural-fire",
    name: "Natural Fire",
    background: "#07090b",
    flash: "#fff9dc",
    core: "#fff1a8",
    flame: "#ff6b24",
    ember: "#d72f16",
    smoke: "#332b2a",
    dust: "#80614a",
    shock: "#dcecff",
    accent: "#ff9b45"
  },
  {
    id: "white-hot",
    name: "Nuclear White-Hot",
    background: "#06070b",
    flash: "#ffffff",
    core: "#f7fbff",
    flame: "#ffd36a",
    ember: "#ff713d",
    smoke: "#343541",
    dust: "#8b7465",
    shock: "#cbe8ff",
    accent: "#eef8ff"
  },
  {
    id: "amber-smoke",
    name: "Amber & Smoke",
    background: "#0c0907",
    flash: "#fff2c2",
    core: "#ffc866",
    flame: "#d9782d",
    ember: "#9f3e20",
    smoke: "#3b302b",
    dust: "#8a6645",
    shock: "#e7cba5",
    accent: "#d9a15b"
  },
  {
    id: "infrared",
    name: "Infrared",
    background: "#070309",
    flash: "#fff4dd",
    core: "#ffdc72",
    flame: "#ff3b47",
    ember: "#a80058",
    smoke: "#260e2a",
    dust: "#68234a",
    shock: "#ff83b2",
    accent: "#ff4f78"
  },
  {
    id: "scientific-false-color",
    name: "Scientific False Color",
    background: "#03091a",
    flash: "#f4ffff",
    core: "#4fffea",
    flame: "#ffd34e",
    ember: "#ff4f8a",
    smoke: "#15234c",
    dust: "#5268a5",
    shock: "#62c7ff",
    accent: "#72f3d1"
  },
  {
    id: "electric-plasma",
    name: "Electric Plasma",
    background: "#050414",
    flash: "#ffffff",
    core: "#bdf8ff",
    flame: "#7b78ff",
    ember: "#e248ff",
    smoke: "#191735",
    dust: "#4f447c",
    shock: "#51e8ff",
    accent: "#a88cff"
  },
  {
    id: "monochrome-documentary",
    name: "Monochrome Documentary",
    background: "#090a0b",
    flash: "#ffffff",
    core: "#e8e8e5",
    flame: "#bdbdb8",
    ember: "#777875",
    smoke: "#303230",
    dust: "#696a64",
    shock: "#d8dcdb",
    accent: "#bfc3c1"
  }
]);

export const ENVIRONMENTS = deepFreeze([
  {
    id: "abstract-city",
    name: "Abstract City",
    description: "A fictional low-detail skyline used only to provide visual scale.",
    ground: "#171b20",
    horizon: "#38414a",
    dustTint: "#70757a",
    surface: "urban-abstract",
    reflective: false,
    fictional: true
  },
  {
    id: "desert",
    name: "Desert Plain",
    description: "A generic open sand plain with no geographic location.",
    ground: "#4c3b2d",
    horizon: "#8a694d",
    dustTint: "#b4875e",
    surface: "sand",
    reflective: false,
    fictional: true
  },
  {
    id: "ocean",
    name: "Open Ocean",
    description: "An abstract water horizon for atmospheric visualization.",
    ground: "#071c2d",
    horizon: "#315b73",
    dustTint: "#a7d7e8",
    surface: "water",
    reflective: true,
    fictional: true
  },
  {
    id: "mountain-valley",
    name: "Mountain Valley",
    description: "A procedural, unlocated valley silhouette.",
    ground: "#18201f",
    horizon: "#43504d",
    dustTint: "#777568",
    surface: "rock",
    reflective: false,
    fictional: true
  },
  {
    id: "flat-range",
    name: "Open Visualization Range",
    description: "A generic flat horizon designed for clear phase comparison.",
    ground: "#22221f",
    horizon: "#55564e",
    dustTint: "#85816e",
    surface: "dry-earth",
    reflective: false,
    fictional: true
  },
  {
    id: "dark-grid",
    name: "Dark Visualization Grid",
    description: "A non-geographic scientific reference grid with no real-world targets.",
    ground: "#071015",
    horizon: "#102733",
    dustTint: "#3e7180",
    surface: "grid",
    reflective: false,
    fictional: true
  }
]);

export const TIME_SETTINGS = deepFreeze([
  { id: "dawn", name: "Dawn", ambient: 0.52, skyTop: "#25304d", skyBottom: "#bd7f69", starOpacity: 0.08, bloom: 1.05 },
  { id: "day", name: "Day", ambient: 0.88, skyTop: "#48759a", skyBottom: "#b4c7cc", starOpacity: 0, bloom: 0.82 },
  { id: "dusk", name: "Dusk", ambient: 0.38, skyTop: "#151a34", skyBottom: "#805f62", starOpacity: 0.18, bloom: 1.16 },
  { id: "night", name: "Night", ambient: 0.16, skyTop: "#040814", skyBottom: "#101b2a", starOpacity: 0.72, bloom: 1.32 },
  { id: "documentary", name: "Documentary Neutral", ambient: 0.44, skyTop: "#272a2b", skyBottom: "#5e605d", starOpacity: 0, bloom: 0.9 }
]);

export const EVENT_PRESETS = deepFreeze([
  createPreset({
    id: "compact-conventional",
    name: "Compact Conventional Blast",
    shortName: "Compact Blast",
    category: "conventional",
    burstType: "surface",
    description: "A brief, localized visual event with a sharp flash, fast pressure ring, and debris-led fade.",
    educationalNote: "Small visible events develop quickly; dust and fragments can remain after the luminous phase ends.",
    safetyNote: "A qualitative visual archetype only, with no materials, construction, or damage guidance.",
    relativeVisualEnergy: 1,
    energyLabel: "Compact display scale",
    energyRange: [0.7, 1.4],
    duration: 7.2,
    defaultEnvironmentId: "flat-range",
    defaultTimeId: "dusk",
    defaultPaletteId: "natural-fire",
    defaultAltitude: 0.02,
    particleBudget: { low: 360, balanced: 760, high: 1450 },
    render: { flash: 0.72, fireballRadius: 0.54, fireballGrowth: 1.48, shockRadius: 0.74, shockThickness: 0.42, surfaceInteraction: 0.86, debris: 1.15, dust: 0.72, smoke: 0.38, columnRise: 0.24, cloudSpread: 0.2, turbulence: 0.74, windResponse: 0.24, atmosphericLight: 0.46, heatDistortion: 0.42, cameraShake: 0.68 },
    overview: { luminous: 0.38, innerWave: 0.62, outerWave: 0.78, particulate: 0.42 },
    phases: phaseList([
      ["detonation", 0, 0.16, 1, "outExpo"],
      ["peak-flash", 0, 0.24, 0.72, "outExpo"],
      ["fireball-expansion", 0.06, 0.92, 0.72, "outCubic"],
      ["shock-front", 0.1, 1.8, 0.82, "outCubic"],
      ["surface-interaction", 0.18, 2.2, 0.82],
      ["dust-debris", 0.22, 4.3, 1],
      ["dissipation", 2.7, 7.2, 0.76]
    ])
  }),
  createPreset({
    id: "large-conventional",
    name: "Large Conventional Blast",
    shortName: "Large Blast",
    category: "conventional",
    burstType: "surface",
    description: "A broader surface event with a sustained fireball, distinct shock front, and heavier rising dust.",
    educationalNote: "The rendered radius grows more slowly than the dimensionless display-energy input through cube-root-style scaling.",
    safetyNote: "Display scale is deliberately abstract and is not a prediction of real effects.",
    relativeVisualEnergy: 6,
    energyLabel: "Large display scale",
    energyRange: [0.7, 1.35],
    duration: 11.8,
    defaultEnvironmentId: "flat-range",
    defaultTimeId: "day",
    defaultPaletteId: "amber-smoke",
    defaultAltitude: 0.02,
    particleBudget: { low: 620, balanced: 1320, high: 2500 },
    render: { flash: 0.9, fireballRadius: 0.82, fireballGrowth: 1.18, shockRadius: 1.02, shockThickness: 0.62, surfaceInteraction: 1.08, debris: 1.24, dust: 1.05, smoke: 0.74, columnRise: 0.58, cloudSpread: 0.46, turbulence: 0.86, windResponse: 0.42, atmosphericLight: 0.65, heatDistortion: 0.7, cameraShake: 0.9 },
    overview: { luminous: 0.48, innerWave: 0.82, outerWave: 1.05, particulate: 0.7 },
    phases: phaseList([
      ["detonation", 0, 0.22, 1, "outExpo"],
      ["peak-flash", 0, 0.38, 0.9, "outExpo"],
      ["fireball-expansion", 0.08, 1.75, 0.9, "outCubic"],
      ["shock-front", 0.14, 3.3, 1, "outCubic"],
      ["surface-interaction", 0.25, 4.4, 1.05],
      ["dust-debris", 0.3, 7.1, 1.12],
      ["column-rise", 1.2, 7.8, 0.58],
      ["cloud-formation", 2.4, 8.8, 0.5],
      ["dissipation", 6.3, 11.8, 0.8]
    ])
  }),
  createPreset({
    id: "industrial-fireball",
    name: "Industrial Fireball",
    shortName: "Industrial Fireball",
    category: "industrial-visual",
    burstType: "surface-fireball",
    description: "A slow, rolling fireball visualization that transitions into layered dark smoke and drifting embers.",
    educationalNote: "Hot buoyant gases can continue rising well after the brightest flame has dimmed.",
    safetyNote: "This generic scene contains no facility layout, material inventory, or incident-planning data.",
    relativeVisualEnergy: 9,
    energyLabel: "Sustained fireball scale",
    energyRange: [0.65, 1.3],
    duration: 18.5,
    defaultEnvironmentId: "abstract-city",
    defaultTimeId: "night",
    defaultPaletteId: "natural-fire",
    defaultAltitude: 0.03,
    particleBudget: { low: 760, balanced: 1680, high: 3200 },
    render: { flash: 0.42, fireballRadius: 1.04, fireballGrowth: 0.68, shockRadius: 0.66, shockThickness: 0.8, surfaceInteraction: 0.72, debris: 0.38, dust: 0.42, smoke: 1.4, columnRise: 1.02, cloudSpread: 0.78, turbulence: 1.12, windResponse: 0.86, atmosphericLight: 0.78, heatDistortion: 1.12, cameraShake: 0.42 },
    overview: { luminous: 0.72, innerWave: 0.52, outerWave: 0.68, particulate: 1.02 },
    phases: phaseList([
      ["detonation", 0, 0.32, 0.72, "outExpo"],
      ["peak-flash", 0.02, 0.54, 0.42, "outExpo"],
      ["fireball-expansion", 0.08, 4.8, 1.12, "outCubic"],
      ["shock-front", 0.2, 3.4, 0.58, "outCubic"],
      ["surface-interaction", 0.35, 5.7, 0.66],
      ["column-rise", 1.1, 12.6, 1.02],
      ["cloud-formation", 3.1, 15.2, 1.2],
      ["atmospheric-drift", 6.5, 18.5, 0.86],
      ["dissipation", 11, 18.5, 0.92]
    ])
  }),
  createPreset({
    id: "fuel-air-visual-archetype",
    name: "Fuel-Air-Style Visual Archetype",
    shortName: "Expansive Fireball",
    category: "atmospheric-archetype",
    burstType: "low-air",
    description: "A broad, diffuse visual pulse with a spreading luminous volume and a slower rolling pressure front.",
    educationalNote: "This is an artistic archetype for comparing expansion shapes, not a model of any composition or device.",
    safetyNote: "No substances, ratios, ignition methods, construction details, or performance claims are included.",
    relativeVisualEnergy: 12,
    energyLabel: "Broad atmospheric scale",
    energyRange: [0.7, 1.25],
    duration: 14.6,
    defaultEnvironmentId: "desert",
    defaultTimeId: "dusk",
    defaultPaletteId: "amber-smoke",
    defaultAltitude: 0.12,
    particleBudget: { low: 680, balanced: 1480, high: 2860 },
    render: { flash: 0.58, fireballRadius: 1.28, fireballGrowth: 0.78, shockRadius: 1.26, shockThickness: 1.16, surfaceInteraction: 0.46, debris: 0.2, dust: 0.58, smoke: 0.96, columnRise: 0.72, cloudSpread: 1.08, turbulence: 0.82, windResponse: 0.72, atmosphericLight: 0.9, heatDistortion: 1.02, cameraShake: 0.56 },
    overview: { luminous: 1.02, innerWave: 1.08, outerWave: 1.34, particulate: 0.72 },
    phases: phaseList([
      ["detonation", 0, 0.3, 0.8, "outExpo"],
      ["peak-flash", 0, 0.48, 0.58, "outExpo"],
      ["fireball-expansion", 0.05, 3.65, 1.22, "outCubic"],
      ["shock-front", 0.18, 5.8, 1.16, "outCubic"],
      ["surface-interaction", 0.8, 4.7, 0.42],
      ["column-rise", 1.4, 9.6, 0.72],
      ["cloud-formation", 3.2, 11.7, 0.88],
      ["atmospheric-drift", 5.8, 14.6, 0.7],
      ["dissipation", 9.2, 14.6, 0.82]
    ])
  }),
  createPreset({
    id: "underground-detonation",
    name: "Underground Detonation",
    shortName: "Underground Event",
    category: "subsurface-visual",
    burstType: "subsurface",
    description: "A muted subsurface onset followed by ground heave, radial ejecta, and a dense dust column.",
    educationalNote: "Surface displacement and dust dominate this stylized view because the luminous source begins below the reference plane.",
    safetyNote: "This generic visualization omits depth calculations, geology guidance, construction, and real-world siting.",
    relativeVisualEnergy: 7,
    energyLabel: "Subsurface display scale",
    energyRange: [0.75, 1.3],
    duration: 15.4,
    defaultEnvironmentId: "desert",
    defaultTimeId: "day",
    defaultPaletteId: "monochrome-documentary",
    defaultAltitude: -0.18,
    particleBudget: { low: 820, balanced: 1820, high: 3440 },
    render: { flash: 0.16, fireballRadius: 0.22, fireballGrowth: 0.42, shockRadius: 0.74, shockThickness: 0.88, surfaceInteraction: 1.52, debris: 1.5, dust: 1.56, smoke: 0.62, columnRise: 1.18, cloudSpread: 0.64, turbulence: 1.24, windResponse: 0.48, atmosphericLight: 0.28, heatDistortion: 0.2, cameraShake: 1.16 },
    overview: { luminous: 0.12, innerWave: 0.72, outerWave: 0.84, particulate: 1.42 },
    phases: phaseList([
      ["detonation", 0, 0.4, 0.74, "outExpo"],
      ["surface-interaction", 0.08, 3.8, 1.5, "outCubic"],
      ["shock-front", 0.22, 3.2, 0.68, "outCubic"],
      ["dust-debris", 0.12, 8.2, 1.5],
      ["column-rise", 0.8, 11.8, 1.2],
      ["cloud-formation", 3.5, 13.2, 0.72],
      ["atmospheric-drift", 7.2, 15.4, 0.48],
      ["dissipation", 9.8, 15.4, 0.9]
    ])
  }),
  createPreset({
    id: "meteor-airburst",
    name: "Meteor Airburst",
    shortName: "Meteor Airburst",
    category: "cosmic",
    burstType: "high-air",
    description: "An atmospheric streak culminates in a bright elevated pulse, layered shock rings, and a drifting high cloud.",
    educationalNote: "An airburst can transfer visible energy to the atmosphere without forming a surface crater in this simplified scene.",
    safetyNote: "Trajectory and scale are fictionalized; this is not an impact-risk or emergency-planning model.",
    relativeVisualEnergy: 28,
    energyLabel: "Large atmospheric display scale",
    energyRange: [0.65, 1.25],
    duration: 20.8,
    defaultEnvironmentId: "mountain-valley",
    defaultTimeId: "dawn",
    defaultPaletteId: "white-hot",
    defaultAltitude: 0.58,
    particleBudget: { low: 700, balanced: 1540, high: 2940 },
    render: { flash: 1.42, fireballRadius: 0.92, fireballGrowth: 1.36, shockRadius: 1.44, shockThickness: 0.72, surfaceInteraction: 0.14, debris: 0.08, dust: 0.12, smoke: 0.68, columnRise: 0.38, cloudSpread: 1.22, turbulence: 0.92, windResponse: 1.2, atmosphericLight: 1.46, heatDistortion: 0.78, cameraShake: 0.62 },
    overview: { luminous: 0.9, innerWave: 1.18, outerWave: 1.48, particulate: 0.36 },
    phases: phaseList([
      ["detonation", 0, 0.18, 1, "outExpo"],
      ["peak-flash", 0, 0.84, 1.42, "outExpo"],
      ["fireball-expansion", 0.06, 2.45, 0.92, "outCubic"],
      ["shock-front", 0.12, 7.4, 1.42, "outCubic"],
      ["surface-interaction", 1.4, 5.6, 0.18],
      ["cloud-formation", 1.8, 12.4, 0.72],
      ["atmospheric-drift", 4.2, 20.8, 1.18],
      ["dissipation", 12.1, 20.8, 0.8]
    ])
  }),
  createPreset({
    id: "meteor-ground-impact",
    name: "Meteor Ground Impact",
    shortName: "Meteor Impact",
    category: "cosmic",
    burstType: "impact",
    description: "A fictional ground impact with a brief flash, radial ejecta curtain, expanding dust front, and towering plume.",
    educationalNote: "Unlike the airburst preset, surface interaction and displaced material dominate the later visual phases.",
    safetyNote: "No real location, impact probability, hazard radius, or emergency-planning output is provided.",
    relativeVisualEnergy: 55,
    energyLabel: "Major impact display scale",
    energyRange: [0.6, 1.2],
    duration: 27.2,
    defaultEnvironmentId: "desert",
    defaultTimeId: "dusk",
    defaultPaletteId: "amber-smoke",
    defaultAltitude: 0,
    particleBudget: { low: 1120, balanced: 2480, high: 4680 },
    render: { flash: 1.12, fireballRadius: 0.86, fireballGrowth: 1.16, shockRadius: 1.32, shockThickness: 0.84, surfaceInteraction: 1.64, debris: 1.7, dust: 1.62, smoke: 0.92, columnRise: 1.42, cloudSpread: 1.08, turbulence: 1.34, windResponse: 0.72, atmosphericLight: 1.06, heatDistortion: 0.68, cameraShake: 1.42 },
    overview: { luminous: 0.7, innerWave: 1.12, outerWave: 1.38, particulate: 1.52 },
    phases: phaseList([
      ["detonation", 0, 0.24, 1, "outExpo"],
      ["peak-flash", 0, 0.58, 1.12, "outExpo"],
      ["fireball-expansion", 0.04, 2.2, 0.86, "outCubic"],
      ["shock-front", 0.12, 6.8, 1.3, "outCubic"],
      ["surface-interaction", 0.05, 8.6, 1.62, "outCubic"],
      ["dust-debris", 0.08, 15.4, 1.7],
      ["column-rise", 0.9, 19.8, 1.4],
      ["cloud-formation", 4.1, 23.4, 1.12],
      ["atmospheric-drift", 10.2, 27.2, 0.7],
      ["dissipation", 18.2, 27.2, 0.86]
    ])
  }),
  createPreset({
    id: "volcanic-eruption",
    name: "Volcanic Eruption",
    shortName: "Volcanic Eruption",
    category: "geologic",
    burstType: "vent",
    description: "A sustained geological eruption with incandescent fragments, a turbulent ash column, and a spreading high cloud.",
    educationalNote: "This preset emphasizes prolonged buoyant rise and ash motion rather than a single dominant pressure pulse.",
    safetyNote: "The volcano is fictional and the display is not for monitoring, forecasting, evacuation, or hazard planning.",
    relativeVisualEnergy: 18,
    energyLabel: "Sustained eruption display scale",
    energyRange: [0.65, 1.35],
    duration: 34,
    defaultEnvironmentId: "mountain-valley",
    defaultTimeId: "dawn",
    defaultPaletteId: "natural-fire",
    defaultAltitude: 0.08,
    particleBudget: { low: 1280, balanced: 2820, high: 5300 },
    render: { flash: 0.18, fireballRadius: 0.34, fireballGrowth: 0.24, shockRadius: 0.34, shockThickness: 1.2, surfaceInteraction: 0.88, debris: 1.28, dust: 1.18, smoke: 1.58, columnRise: 1.62, cloudSpread: 1.38, turbulence: 1.5, windResponse: 1.28, atmosphericLight: 0.42, heatDistortion: 0.46, cameraShake: 0.44 },
    overview: { luminous: 0.22, innerWave: 0.26, outerWave: 0.34, particulate: 1.62 },
    phases: phaseList([
      ["detonation", 0, 1.2, 0.42, "outCubic"],
      ["surface-interaction", 0, 9.4, 0.86],
      ["dust-debris", 0.15, 19.5, 1.28],
      ["column-rise", 0.3, 27.6, 1.62],
      ["cloud-formation", 4.2, 31.5, 1.5],
      ["atmospheric-drift", 9.5, 34, 1.26],
      ["dissipation", 24, 34, 0.68]
    ])
  }),
  createPreset({
    id: "fictional-plasma-burst",
    name: "Fictional Plasma Burst",
    shortName: "Plasma Burst",
    category: "fictional",
    burstType: "hovering-fictional",
    description: "A deliberately fictional electric sphere that branches, implodes, and leaves a cool luminous afterglow.",
    educationalNote: "The exaggerated electrical motion demonstrates procedural noise and layered additive light, not known event physics.",
    safetyNote: "This preset is explicitly imaginary and makes no real-world energy or performance claim.",
    relativeVisualEnergy: 20,
    energyLabel: "Fictional display scale",
    energyRange: [0.55, 1.5],
    duration: 10.2,
    defaultEnvironmentId: "dark-grid",
    defaultTimeId: "night",
    defaultPaletteId: "electric-plasma",
    defaultAltitude: 0.28,
    particleBudget: { low: 580, balanced: 1260, high: 2380 },
    render: { flash: 1.18, fireballRadius: 0.74, fireballGrowth: 0.92, shockRadius: 0.92, shockThickness: 0.28, surfaceInteraction: 0.06, debris: 0.02, dust: 0.04, smoke: 0.16, columnRise: 0.08, cloudSpread: 0.38, turbulence: 1.7, windResponse: 0.12, atmosphericLight: 1.62, heatDistortion: 0.96, cameraShake: 0.3 },
    overview: { luminous: 0.94, innerWave: 0.68, outerWave: 0.9, particulate: 0.2 },
    phases: phaseList([
      ["detonation", 0, 0.46, 0.84, "inOutCubic"],
      ["peak-flash", 0.34, 1.08, 1.18, "outExpo"],
      ["fireball-expansion", 0.08, 3.4, 0.82, "inOutCubic"],
      ["shock-front", 0.72, 4.8, 0.74, "outCubic"],
      ["cloud-formation", 2.2, 6.7, 0.32],
      ["atmospheric-drift", 3.6, 8.8, 0.18],
      ["dissipation", 5.2, 10.2, 1.08, "outCubic"]
    ])
  }),
  createPreset({
    id: "low-yield-nuclear-airburst",
    name: "Nuclear Airburst — Research Model",
    shortName: "Research Airburst",
    category: "nuclear-scale-visual",
    burstType: "airburst",
    description: "A research-inspired, normalized atmospheric visualization with an analytical shock phase and a WebGL2 velocity, temperature, and density field driving the later plume.",
    educationalNote: "The airburst treatment adapts published computer-graphics methods for post-detonation smoke, fire, fluid motion, and volume rendering. It is deliberately simplified and non-predictive.",
    safetyNote: "No device design, burst optimization, targeting, damage, casualty, or real-world prediction is provided.",
    researchModel: {
      id: "nuclear-airburst-fluid-v1",
      engine: "webgl2-fluid-2.5d",
      fixedStep: 1 / 30,
      normalizedFields: ["velocity", "temperature", "smoke", "incandescent", "dust"],
      diagnostics: ["velocity", "temperature", "smoke", "incandescent", "pressure", "divergence", "vorticity", "tracers"]
    },
    relativeVisualEnergy: 90,
    energyLabel: "Low nuclear-scale visual category",
    energyRange: [0.65, 1.25],
    duration: 29.5,
    defaultEnvironmentId: "dark-grid",
    defaultTimeId: "day",
    defaultPaletteId: "white-hot",
    defaultAltitude: 0.32,
    particleBudget: { low: 1180, balanced: 2580, high: 4880 },
    render: { flash: 1.72, fireballRadius: 1.18, fireballGrowth: 1.42, shockRadius: 1.5, shockThickness: 0.52, surfaceInteraction: 0.48, debris: 0.14, dust: 0.54, smoke: 1.12, columnRise: 1.48, cloudSpread: 1.42, turbulence: 1.24, windResponse: 0.82, atmosphericLight: 1.7, heatDistortion: 1.38, cameraShake: 1.08 },
    overview: { luminous: 0.92, innerWave: 1.2, outerWave: 1.52, particulate: 0.68 },
    phases: phaseList([
      ["detonation", 0, 0.16, 1, "outExpo"],
      ["peak-flash", 0, 1.15, 1.7, "outExpo"],
      ["fireball-expansion", 0.04, 4.4, 1.34, "outCubic"],
      ["shock-front", 0.12, 9.2, 1.48, "outCubic"],
      ["surface-interaction", 0.9, 7.2, 0.46],
      ["column-rise", 1.6, 20.8, 1.46],
      ["cloud-formation", 5, 25.8, 1.42],
      ["mushroom-development", 8.4, 27.6, 1.42],
      ["atmospheric-drift", 13.2, 29.5, 0.8],
      ["dissipation", 22, 29.5, 0.62]
    ])
  }),
  createPreset({
    id: "nuclear-ground-burst",
    name: "Nuclear Ground Burst",
    shortName: "Ground-Burst Visual",
    category: "nuclear-scale-visual",
    burstType: "ground-burst",
    description: "An approximate nuclear-scale ground event emphasizing surface dust, a dense rising column, and wind-driven particulate layers.",
    educationalNote: "Compared with the airburst scene, stronger contact with the abstract surface produces more visible dust in the model.",
    safetyNote: "No device design, targeting, fallout forecast, damage, casualty, or safety-distance calculation is included.",
    relativeVisualEnergy: 180,
    energyLabel: "Major nuclear-scale visual category",
    energyRange: [0.6, 1.2],
    duration: 37,
    defaultEnvironmentId: "flat-range",
    defaultTimeId: "dusk",
    defaultPaletteId: "white-hot",
    defaultAltitude: 0,
    particleBudget: { low: 1600, balanced: 3520, high: 6600 },
    render: { flash: 1.8, fireballRadius: 1.32, fireballGrowth: 1.28, shockRadius: 1.58, shockThickness: 0.66, surfaceInteraction: 1.54, debris: 1.28, dust: 1.68, smoke: 1.46, columnRise: 1.56, cloudSpread: 1.5, turbulence: 1.4, windResponse: 1.22, atmosphericLight: 1.82, heatDistortion: 1.42, cameraShake: 1.44 },
    overview: { luminous: 1, innerWave: 1.3, outerWave: 1.62, particulate: 1.48 },
    phases: phaseList([
      ["detonation", 0, 0.2, 1, "outExpo"],
      ["peak-flash", 0, 1.35, 1.8, "outExpo"],
      ["fireball-expansion", 0.04, 5.6, 1.44, "outCubic"],
      ["shock-front", 0.14, 11.6, 1.56, "outCubic"],
      ["surface-interaction", 0.08, 12.8, 1.52],
      ["dust-debris", 0.2, 23.4, 1.64],
      ["column-rise", 1.4, 27.8, 1.58],
      ["cloud-formation", 5.3, 32.5, 1.5],
      ["mushroom-development", 9.6, 34.8, 1.48],
      ["atmospheric-drift", 14.8, 37, 1.22],
      ["dissipation", 28, 37, 0.7]
    ])
  }),
  createPreset({
    id: "extreme-historical-scale",
    name: "Extreme Historical-Scale Nuclear Visualization",
    shortName: "Extreme Historical Scale",
    category: "nuclear-scale-visual",
    burstType: "high-air",
    description: "A deliberately compressed visualization of the upper historical scale of atmospheric nuclear testing, shown in an abstract environment.",
    educationalNote: "Cube-root-style display scaling keeps the event viewable; screen size is not proportional to real energy or effects.",
    safetyNote: "Historical scale is contextual only. No device design, optimization, targeting, damage, casualty, or planning information is provided.",
    relativeVisualEnergy: 900,
    energyLabel: "Extreme historical visual category",
    energyRange: [0.5, 1],
    duration: 47.5,
    defaultEnvironmentId: "dark-grid",
    defaultTimeId: "night",
    defaultPaletteId: "white-hot",
    defaultAltitude: 0.48,
    particleBudget: { low: 1900, balanced: 4200, high: 7800 },
    render: { flash: 2, fireballRadius: 1.72, fireballGrowth: 1.12, shockRadius: 1.86, shockThickness: 0.88, surfaceInteraction: 0.86, debris: 0.34, dust: 1.02, smoke: 1.7, columnRise: 1.86, cloudSpread: 1.82, turbulence: 1.5, windResponse: 1.34, atmosphericLight: 2, heatDistortion: 1.68, cameraShake: 1.62 },
    overview: { luminous: 1.2, innerWave: 1.54, outerWave: 1.9, particulate: 1.12 },
    phases: phaseList([
      ["detonation", 0, 0.22, 1, "outExpo"],
      ["peak-flash", 0, 2.1, 2, "outExpo"],
      ["fireball-expansion", 0.05, 8.2, 1.72, "outCubic"],
      ["shock-front", 0.18, 17.5, 1.86, "outCubic"],
      ["surface-interaction", 1.2, 14.4, 0.82],
      ["dust-debris", 1.5, 25.5, 0.9],
      ["column-rise", 2.2, 37.8, 1.86],
      ["cloud-formation", 7.4, 42.2, 1.82],
      ["mushroom-development", 12.8, 45.2, 1.86],
      ["atmospheric-drift", 20, 47.5, 1.32],
      ["dissipation", 37, 47.5, 0.64]
    ])
  })
]);

// Alias retained for terse imports in the renderer.
export const PRESETS = EVENT_PRESETS;

export const PRESET_BY_ID = Object.freeze(
  Object.fromEntries(EVENT_PRESETS.map((preset) => [preset.id, preset]))
);
export const PALETTE_BY_ID = Object.freeze(
  Object.fromEntries(PALETTES.map((palette) => [palette.id, palette]))
);
export const ENVIRONMENT_BY_ID = Object.freeze(
  Object.fromEntries(ENVIRONMENTS.map((environment) => [environment.id, environment]))
);
export const TIME_BY_ID = Object.freeze(
  Object.fromEntries(TIME_SETTINGS.map((setting) => [setting.id, setting]))
);

/**
 * Return a sorted timeline with normalized positions. Accepts a preset, a
 * phase array, or an object containing `phases`; overlapping phases are valid.
 */
export function buildPhaseTimeline(source, explicitDuration) {
  const phases = Array.isArray(source) ? source : source?.phases;
  if (!Array.isArray(phases)) throw new TypeError("A preset or phase array is required.");
  const inferredDuration = Math.max(0, ...phases.map((phase) => Number(phase.end) || 0));
  const duration = Math.max(
    Number.EPSILON,
    Number.isFinite(Number(explicitDuration))
      ? Number(explicitDuration)
      : Number(source?.duration) || inferredDuration
  );
  return phases
    .map((phase) => {
      if (!PHASE_ID_SET.has(phase.id)) throw new RangeError(`Unknown timeline phase: ${phase.id}`);
      const start = clamp(Number(phase.start), 0, duration);
      const end = clamp(Number(phase.end), start, duration);
      return Object.freeze({
        ...phase,
        start,
        end,
        duration: end - start,
        normalizedStart: start / duration,
        normalizedEnd: end / duration
      });
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

export function normalizeTimelineTime(time, duration, loop = false) {
  const safeDuration = Math.max(Number.EPSILON, Number(duration) || 0);
  const safeTime = Number.isFinite(Number(time)) ? Number(time) : 0;
  if (!loop) return clamp(safeTime, 0, safeDuration);
  return ((safeTime % safeDuration) + safeDuration) % safeDuration;
}

export function getPhaseProgress(phase, time) {
  if (!phase || !Number.isFinite(Number(phase.start)) || !Number.isFinite(Number(phase.end))) return 0;
  if (phase.end <= phase.start) return Number(time) >= phase.end ? 1 : 0;
  return clamp(invLerp(phase.start, phase.end, Number(time) || 0));
}

/** The most recently started active phase, useful for one-line status labels. */
export function getPhaseAtTime(source, time) {
  const timeline = Array.isArray(source) && source.every((entry) => "normalizedStart" in entry)
    ? source
    : buildPhaseTimeline(source);
  const currentTime = Number.isFinite(Number(time)) ? Number(time) : 0;
  const active = timeline.filter((phase) => currentTime >= phase.start && currentTime <= phase.end);
  return active.length ? active[active.length - 1] : null;
}

/** Soft phase envelope for blending overlapping visual systems. */
export function phaseWeight(phase, time, edgeFraction = 0.16) {
  const progress = getPhaseProgress(phase, time);
  if (progress <= 0 || progress >= 1) return 0;
  const edge = clamp(edgeFraction, 0.01, 0.49);
  const fadeIn = smoothstep(0, edge, progress);
  const fadeOut = 1 - smoothstep(1 - edge, 1, progress);
  return clamp(fadeIn * fadeOut * (Number(phase.intensity) || 1), 0, 2);
}

/**
 * Produce viewport-relative radii from a preset's dimensionless display index.
 * These values intentionally describe pixels and normalized display scale only.
 */
export function scalePreset(presetOrId, viewportMin = 720, energyMultiplier = 1) {
  const preset = typeof presetOrId === "string" ? PRESET_BY_ID[presetOrId] : presetOrId;
  if (!preset) throw new RangeError(`Unknown event preset: ${String(presetOrId)}`);
  const viewport = clamp(Number(viewportMin), 240, 4096);
  const multiplier = clamp(Number(energyMultiplier), 0.25, 2);
  const energy = preset.relativeVisualEnergy * multiplier;
  const normalized = normalizedCubeRootScale(energy, 0.5, 900);
  const baseRadius = viewport * lerp(0.035, 0.155, normalized);
  return Object.freeze({
    energy,
    normalized,
    baseRadius,
    fireballRadius: baseRadius * preset.render.fireballRadius,
    shockRadius: baseRadius * (2.2 + preset.render.shockRadius * 1.35),
    cloudHeight: baseRadius * (1.6 + preset.render.columnRise * 1.8),
    cloudWidth: baseRadius * (1.25 + preset.render.cloudSpread * 1.45),
    surfaceRadius: baseRadius * (1 + preset.render.surfaceInteraction * 1.4)
  });
}
