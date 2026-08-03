/**
 * ResearchFluidEngine
 * -------------------
 * A deterministic, normalized 2.5D WebGL2 fluid study for the educational
 * Explosion Dynamics Lab. The engine intentionally exposes no real-world
 * quantities, locations, construction parameters, or damage calculations.
 *
 * By default the solver owns a hidden transparent WebGL2 canvas that a facade
 * can composite into an existing Canvas2D scene. A caller-provided research
 * canvas is used as-is: the engine never hides, repositions, or styles it.
 */

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const TAU = Math.PI * 2;
const MAX_OUTPUT_DIMENSION = 4096;
const MAX_SEEK_SECONDS = 120;

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

function mixDetailBits(value) {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function wrappedDetailCell(value, size) {
  return ((value % size) + size) % size;
}

function detailPotential(x, y, z, channel, size, seed) {
  const wrappedX = wrappedDetailCell(x, size);
  const wrappedY = wrappedDetailCell(y, size);
  const wrappedZ = wrappedDetailCell(z, size);
  let value = seed >>> 0;
  value ^= Math.imul(wrappedX + 1, 0x9e3779b1);
  value ^= Math.imul(wrappedY + 1, 0x85ebca77);
  value ^= Math.imul(wrappedZ + 1, 0xc2b2ae3d);
  value ^= Math.imul(channel + 1, 0x27d4eb2f);
  return mixDetailBits(value) / 0xffffffff;
}

function encodeSignedDetail(value) {
  return Math.round((clamp(value, -1, 1) * 0.5 + 0.5) * 255);
}

function buildCurlDetailVolume(size, seed) {
  const data = new Uint8Array(size * size * size * 4);
  let offset = 0;
  for (let z = 0; z < size; z += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        // Curl of a seeded periodic vector potential. The central differences
        // make this low-resolution 3D field divergence-free before interpolation.
        const curlX = (
          detailPotential(x, y + 1, z, 2, size, seed)
          - detailPotential(x, y - 1, z, 2, size, seed)
          - detailPotential(x, y, z + 1, 1, size, seed)
          + detailPotential(x, y, z - 1, 1, size, seed)
        ) * 0.5;
        const curlY = (
          detailPotential(x, y, z + 1, 0, size, seed)
          - detailPotential(x, y, z - 1, 0, size, seed)
          - detailPotential(x + 1, y, z, 2, size, seed)
          + detailPotential(x - 1, y, z, 2, size, seed)
        ) * 0.5;
        const curlZ = (
          detailPotential(x + 1, y, z, 1, size, seed)
          - detailPotential(x - 1, y, z, 1, size, seed)
          - detailPotential(x, y + 1, z, 0, size, seed)
          + detailPotential(x, y - 1, z, 0, size, seed)
        ) * 0.5;
        data[offset] = encodeSignedDetail(curlX);
        data[offset + 1] = encodeSignedDetail(curlY);
        data[offset + 2] = encodeSignedDetail(curlZ);
        data[offset + 3] = Math.round(
          detailPotential(x, y, z, 3, size, seed ^ 0xa511e9b3) * 255,
        );
        offset += 4;
      }
    }
  }
  return data;
}

export const RESEARCH_FLUID_TIERS = Object.freeze({
  mobile: Object.freeze({
    id: 'mobile',
    label: 'Mobile',
    gridLongSide: 112,
    gridShortSideMinimum: 64,
    pressureIterations: 8,
    raySteps: 16,
    tracerCount: 256,
    detailResolution: 16,
    fixedStep: 1 / 30,
    velocityDecay: 0.989,
    scalarDecay: 0.997,
    vorticity: 0.19,
  }),
  balanced: Object.freeze({
    id: 'balanced',
    label: 'Balanced',
    gridLongSide: 176,
    gridShortSideMinimum: 88,
    pressureIterations: 13,
    raySteps: 26,
    tracerCount: 512,
    detailResolution: 24,
    fixedStep: 1 / 30,
    velocityDecay: 0.993,
    scalarDecay: 0.998,
    vorticity: 0.28,
  }),
  high: Object.freeze({
    id: 'high',
    label: 'High',
    gridLongSide: 256,
    gridShortSideMinimum: 128,
    pressureIterations: 19,
    raySteps: 38,
    tracerCount: 1024,
    detailResolution: 32,
    fixedStep: 1 / 30,
    velocityDecay: 0.995,
    scalarDecay: 0.999,
    vorticity: 0.36,
  }),
});

/**
 * Normalized visual source primitives. These identifiers select artistic field
 * shapes only; they do not encode materials, construction, real dimensions, or
 * predictive blast quantities.
 */
export const RESEARCH_FLUID_SOURCE_PRIMITIVES = Object.freeze({
  'radial-impulse': 1,
  'directional-impulse': 2,
  'ring-source': 4,
  'ground-sheet': 8,
  'vertical-jet': 16,
  'multiple-offset-kernels': 32,
  'pulsed-column': 64,
  'ejecta-curtain': 128,
  'elongated-trail': 256,
  'sustained-combustion-region': 512,
  'turbulent-source-cluster': 1024,
  'paired-cap-vortices': 2048,
});

const BASE_PROFILE = Object.freeze({
  eventFamilyId: 'nuclear-scale',
  eventFamily: 'Nuclear scale · research airburst',
  physicalFamilyId: 'nuclear-scale',
  profileKind: 9,
  tracerType: 'thermal',
  sourcePrimitives: Object.freeze(['radial-impulse', 'vertical-jet', 'paired-cap-vortices']),
  source: Object.freeze({
    centerX: 0.5,
    centerY: 0.31,
    radius: 0.065,
    aspectX: 1,
    aspectY: 0.82,
    groundLevel: 0.18,
    onsetEnd: 0.055,
    sustainEnd: 0.43,
    pulseFrequency: 3.2,
    stageOffset: 0.03,
    radial: 1,
    vertical: 1,
    directional: 0,
    turbulence: 0.65,
    heat: 1,
    smoke: 1,
    incandescent: 1,
    dust: 0.4,
    directionX: 0,
    directionY: 1,
    offsetX: 0,
    offsetY: 0,
    ringRadius: 1.2,
    ejecta: 0,
    trailLength: 0,
    clusterSpread: 1,
    capScale: 1,
    capRoll: 1,
  }),
  physics: Object.freeze({
    buoyancy: 1,
    densityLoading: 1,
    windCoupling: 1,
    vorticity: 1,
    velocityRetention: 1,
    cooling: 1,
    smokeConversion: 1,
    scalarRetention: 1,
  }),
  volume: Object.freeze({
    scaleX: 1,
    scaleY: 1,
    depth: 1,
    opacity: 1,
    shadow: 1,
    bloom: 1,
    distortion: 1,
    erosion: 1,
    noiseScale: 1,
    dustVisibility: 1,
    exposure: 1,
    toneMap: 0,
    backgroundIllumination: 0,
    emissionCurve: 1,
  }),
  quality: Object.freeze({ grid: 1, pressure: 1, rays: 1, tracers: 1, detail: 1 }),
  // A padded active region decouples the visible event from the fixed solver
  // texture. mode 0 preserves the existing field coordinates exactly. mode 1
  // compresses source coordinates into the central active region and expands
  // the matching render transform, leaving an absorbing computational margin
  // outside the visible plume instead of relying on a silhouette mask.
  domain: Object.freeze({
    mode: 0,
    padding: 0,
    renderOverscan: 1,
    renderScale: 1,
    renderExtent: null,
    riskMargin: 0.06,
    densityThreshold: 0.14,
  }),
  // Ground-coupling research controls. mode 0 is exactly inert. An opted-in
  // profile can keep the surface sheet horizontal for longer, taper it before
  // the plume lifts, vary its radial lobes deterministically, and separate
  // surface heat/dust from the rising thermal feed. These are normalized
  // visual controls, not blast-pressure or damage quantities.
  groundCoupling: Object.freeze({
    mode: 0,
    radialImpulse: 0,
    spreadWidth: 1,
    heightFalloff: 1,
    horizontalRetention: 1,
    verticalDamping: 1,
    spreadStart: 0,
    spreadEnd: 0,
    angularVariation: 0,
    asymmetry: 0,
    surfaceHeat: 0,
    baseDust: 0,
    transitionLift: 0,
    lateGroundDrift: 0,
  }),
  // Broad-plume research controls. mode 0 keeps a preset on its exact prior
  // behavior; mode 1 is the existing historical-scale Tsar path, mode 2 gives
  // low-yield its compact shaping path, and mode 3 identifies the separately
  // balanced ground-coupled path. All enabled modes share the generic force
  // mechanism but retain independent immutable values.
  // feedTaperStart/feedTaperEnd/lateralJitter/turbulenceBlend are the central
  // -stem taper/breakup controls (2026-07 shockwave/stem/performance pass);
  // feedTaperStart/End default to the original hardcoded coreBand taper
  // window (0.85-1.05) so any future preset that enables plume mode without
  // overriding them keeps the prior behavior exactly.
  plume: Object.freeze({
    mode: 0, expansion: 0, vortex: 0, persistence: 0, widen: 0,
    feedTaperStart: 0.85, feedTaperEnd: 1.05, lateralJitter: 0, turbulenceBlend: 0,
  }),
  // Shockwave shell-layering research controls. mode 0 is inert, mode 1 keeps
  // the established three explicit Tsar bands, and mode 2 selects the compact
  // deterministic contour family used only by low-yield. The dense family is
  // described by quality-specific counts plus bounded radius, spacing, width,
  // strength, angular-continuity, depth, onset, and fade variation.
  shockwave: Object.freeze({
    mode: 0,
    ringB: Object.freeze({ radiusOffset: 0, widthScale: 1, strength: 0, phaseOffset: 0 }),
    ringC: Object.freeze({ radiusOffset: 0, widthScale: 1, strength: 0, phaseOffset: 0 }),
    ringD: Object.freeze({ radiusOffset: 0, widthScale: 1, strength: 0, phaseOffset: 0 }),
    irregularity: 0,
    fadeStart: 1,
    fadeSpan: 0.001,
    denseBandsHigh: 0,
    denseBandsBalanced: 0,
    denseBandsMobile: 0,
    denseInnerRadius: 0,
    denseOuterRadius: 0,
    denseSpacingVariation: 0,
    denseWidthMin: 0,
    denseWidthMax: 0,
    denseInnerStrength: 0,
    denseOuterStrength: 0,
    denseSegmentVariation: 0,
    denseDepthContrast: 0,
    denseOnsetSpread: 0,
    denseFadeVariation: 0,
    denseIrregularity: 0,
    denseFadeStart: 0,
    denseFadeSpan: 0,
  }),
  // Smoke-material research controls (2026-07 Tsar smoke-material pass). mode 0
  // keeps a preset byte-identical to before this mechanism; low-yield and Tsar
  // opt in independently. sootAbsorption/dustAbsorption give soot
  // and lofted dust independent optical-depth coefficients instead of one
  // shared density-to-alpha curve; detailBoost adds an energy-weighted third
  // curl-detail octave; warmCoolContrast widens the lit/shadowed dynamic range.
  material: Object.freeze({
    mode: 0,
    sootAbsorption: 1,
    dustAbsorption: 1,
    detailBoost: 0,
    warmCoolContrast: 0,
    // Material absorption and color separation must not implicitly purchase
    // the expensive third curl-detail octave. Profiles opt into it explicitly.
    detailOctaveMode: 0,
    interiorDepth: 0,
  }),
  // Late-stage dissipation research controls (2026-07 Tsar dissipation pass).
  // mode 0 keeps every shipped preset byte-identical to before this pass; only
  // the Tsar historical reference opts in. lateStart/finalStart are fractions
  // of normalized simulation time marking when a gradual, continuous
  // dissipation ramp begins and reaches its strongest effect (never a hard
  // cutoff). sourceTaperEnd tapers new source injection to zero ahead of
  // finalStart, so the field only depletes rather than being topped up.
  // retentionFloorSmoke/retentionFloorDust are the per-step scalar retention
  // targets the ramp eases toward (soot persists longer than lofted dust).
  // outwardBoost adds late lateral dispersion; buoyancyFalloff reduces late
  // lift so the cloud drifts and settles instead of continuing to rise;
  // motionDamp relaxes the residual plume-shaping forces (widening/feed/ring
  // vortices) so the silhouette actually settles before it thins.
  dissipation: Object.freeze({
    mode: 0,
    lateStart: 1,
    finalStart: 1,
    sourceTaperEnd: 1,
    retentionFloorSmoke: 1,
    retentionFloorDust: 1,
    outwardBoost: 0,
    buoyancyFalloff: 0,
    motionDamp: 0,
    // A late tail can retain a small amount of resolved velocity and add a
    // very broad deterministic roll/shear after the source has shut off.
    // Zero keeps the pre-tail behaviour exactly intact.
    lateVelocityRetention: 1,
    lateCurl: 0,
    lateShear: 0,
    latePhaseRate: 0,
  }),
  // Early-core research controls (2026-07 Tsar core/tracer polish). mode 0
  // keeps a preset byte-identical to before this mechanism; low-yield and Tsar
  // opt in independently. highlightThreshold/highlightSharpness
  // reproduce the original white-hot highlight term exactly at their default
  // values (1.5, 2.0); structureBlend folds self-shadow and turbulence detail
  // into the highlight so it reads as irregular thermal pockets instead of a
  // flat plateau; bloomGateScale suppresses bloom specifically in low-gradient
  // (flat) regions of the temperature field.
  core: Object.freeze({ mode: 0, highlightThreshold: 1.5, highlightSharpness: 2.0, structureBlend: 0, bloomGateScale: 0 }),
  // Tracer-material research controls (2026-07 Tsar core/tracer polish). mode
  // 0 keeps a preset byte-identical to before this mechanism; low-yield and
  // Tsar opt in independently. occlusionStrength adds a Beer-Lambert
  // falloff on top of the existing density-weighted tracer visibility so
  // dense smoke buries tracers instead of merely dimming them a little;
  // sizeVariance/brightnessVariance give each tracer a stable per-particle
  // random offset instead of one uniform size and brightness.
  tracerMaterial: Object.freeze({
    mode: 0, occlusionStrength: 0, sizeVariance: 0, brightnessVariance: 0, minSizeFloor: 0,
  }),
  // Domain-edge envelope research control (2026-07 Tsar dissipation-artifact
  // fix). mode 0 keeps every shipped preset byte-identical to before this
  // pass (the original independent side/top rectangle envelope in
  // edgeExtinction()). Organic profiles supply their own warped envelope and
  // low-density response; mode 0 remains byte-identical for neutral presets.
  edge: Object.freeze({
    mode: 0,
    center: 0.5,
    centerAsymmetry: 0,
    leftRadius: 0.42,
    rightRadius: 0.42,
    topRadius: 0.46,
    leftWobble: 0,
    rightWobble: 0,
    topWobble: 0,
    fadeStart: 0.55,
    fadeEnd: 1,
    distanceWobble: 0,
    lowDensityStart: 0,
    lowDensityEnd: 1,
    lowDensityAttenuation: 0,
  }),
});

function defineFluidProfile(presetId, profileId, overrides = {}) {
  return deepFreeze({
    ...BASE_PROFILE,
    ...overrides,
    presetId,
    profileId,
    physicalFamilyId: overrides.physicalFamilyId || overrides.eventFamilyId || BASE_PROFILE.physicalFamilyId,
    sourcePrimitives: [...(overrides.sourcePrimitives || BASE_PROFILE.sourcePrimitives)],
    source: { ...BASE_PROFILE.source, ...(overrides.source || {}) },
    physics: { ...BASE_PROFILE.physics, ...(overrides.physics || {}) },
    volume: { ...BASE_PROFILE.volume, ...(overrides.volume || {}) },
    quality: { ...BASE_PROFILE.quality, ...(overrides.quality || {}) },
    domain: { ...BASE_PROFILE.domain, ...(overrides.domain || {}) },
    groundCoupling: { ...BASE_PROFILE.groundCoupling, ...(overrides.groundCoupling || {}) },
    plume: { ...BASE_PROFILE.plume, ...(overrides.plume || {}) },
    shockwave: {
      ...BASE_PROFILE.shockwave,
      ...(overrides.shockwave || {}),
      ringB: { ...BASE_PROFILE.shockwave.ringB, ...(overrides.shockwave?.ringB || {}) },
      ringC: { ...BASE_PROFILE.shockwave.ringC, ...(overrides.shockwave?.ringC || {}) },
      ringD: { ...BASE_PROFILE.shockwave.ringD, ...(overrides.shockwave?.ringD || {}) },
    },
    material: { ...BASE_PROFILE.material, ...(overrides.material || {}) },
    dissipation: { ...BASE_PROFILE.dissipation, ...(overrides.dissipation || {}) },
    core: { ...BASE_PROFILE.core, ...(overrides.core || {}) },
    tracerMaterial: { ...BASE_PROFILE.tracerMaterial, ...(overrides.tracerMaterial || {}) },
    edge: { ...BASE_PROFILE.edge, ...(overrides.edge || {}) },
  });
}

/**
 * Per-preset GPU profiles. Values are dimensionless art-direction controls.
 * The flagship profile intentionally retains the original source branch as a
 * named regression/default while every other profile combines different,
 * deterministically offset field primitives.
 */
export const RESEARCH_FLUID_PROFILES = deepFreeze({
  'compact-conventional': defineFluidProfile(
    'compact-conventional',
    'compact-conventional-fluid-v1',
    {
      eventFamilyId: 'conventional-compact', eventFamily: 'Conventional · compact blast', profileKind: 0,
      tracerType: 'debris',
      sourcePrimitives: ['radial-impulse', 'ground-sheet', 'multiple-offset-kernels', 'turbulent-source-cluster'],
      source: { centerY: 0.19, radius: 0.048, aspectX: 1.55, aspectY: 0.62, onsetEnd: 0.038, sustainEnd: 0.2, radial: 1.35, vertical: 0.22, turbulence: 1.1, heat: 1.15, smoke: 0.58, incandescent: 1.08, dust: 1.35, clusterSpread: 1.25 },
      physics: { buoyancy: 0.5, densityLoading: 1.22, windCoupling: 0.48, vorticity: 1.28, velocityRetention: 0.974, cooling: 1.65, smokeConversion: 1.18, scalarRetention: 0.992 },
      volume: { scaleX: 1.3, scaleY: 0.74, depth: 0.72, opacity: 1.28, shadow: 0.86, bloom: 0.72, distortion: 0.72, erosion: 1.3, noiseScale: 1.45, dustVisibility: 1.42, exposure: 1.02, backgroundIllumination: 0.08, emissionCurve: 0.86 },
      quality: { grid: 0.82, pressure: 0.75, rays: 0.72, tracers: 0.72, detail: 0.75 },
    },
  ),
  'large-conventional': defineFluidProfile(
    'large-conventional',
    'large-conventional-fluid-v1',
    {
      eventFamilyId: 'conventional-compact', eventFamily: 'Conventional · large blast', profileKind: 1,
      tracerType: 'debris',
      sourcePrimitives: ['radial-impulse', 'ground-sheet', 'vertical-jet', 'multiple-offset-kernels', 'turbulent-source-cluster'],
      source: { centerY: 0.2, radius: 0.063, aspectX: 1.42, aspectY: 0.7, onsetEnd: 0.052, sustainEnd: 0.3, radial: 1.25, vertical: 0.48, turbulence: 1.05, heat: 1.12, smoke: 0.82, incandescent: 1, dust: 1.4, clusterSpread: 1.35 },
      physics: { buoyancy: 0.65, densityLoading: 1.2, windCoupling: 0.62, vorticity: 1.22, velocityRetention: 0.98, cooling: 1.42, smokeConversion: 1.2, scalarRetention: 0.994 },
      volume: { scaleX: 1.18, scaleY: 0.82, depth: 0.82, opacity: 1.12, shadow: 0.98, bloom: 0.82, distortion: 0.8, erosion: 1.2, noiseScale: 1.32, dustVisibility: 1.38, exposure: 0.96, backgroundIllumination: 0.1, emissionCurve: 0.9 },
      quality: { grid: 0.9, pressure: 0.88, rays: 0.82, tracers: 0.86, detail: 0.88 },
    },
  ),
  'industrial-fireball': defineFluidProfile(
    'industrial-fireball',
    'industrial-fireball-fluid-v1',
    {
      eventFamilyId: 'industrial-combustion', eventFamily: 'Industrial · rolling fireball', profileKind: 2,
      tracerType: 'ember',
      sourcePrimitives: ['sustained-combustion-region', 'multiple-offset-kernels', 'vertical-jet', 'turbulent-source-cluster'],
      source: { centerY: 0.22, radius: 0.072, aspectX: 1.28, aspectY: 0.92, onsetEnd: 0.09, sustainEnd: 0.68, pulseFrequency: 2.2, radial: 0.48, vertical: 0.9, turbulence: 1.22, heat: 1.12, smoke: 1.42, incandescent: 1.35, dust: 0.38, clusterSpread: 1.48 },
      physics: { buoyancy: 0.82, densityLoading: 1.12, windCoupling: 0.9, vorticity: 1.42, velocityRetention: 0.991, cooling: 0.66, smokeConversion: 1.38, scalarRetention: 0.999 },
      volume: { scaleX: 1.32, scaleY: 0.98, depth: 1.12, opacity: 1.3, shadow: 1.35, bloom: 1.22, distortion: 1.18, erosion: 0.82, noiseScale: 1.14, dustVisibility: 0.48, exposure: 1.08, backgroundIllumination: 0.2, emissionCurve: 0.78 },
      quality: { grid: 0.96, pressure: 0.94, rays: 1, tracers: 1.12, detail: 1 },
    },
  ),
  'fuel-air-visual-archetype': defineFluidProfile(
    'fuel-air-visual-archetype',
    'fuel-air-style-fluid-v1',
    {
      eventFamilyId: 'industrial-combustion', eventFamily: 'Industrial · expansive fireball', profileKind: 3,
      tracerType: 'ember',
      sourcePrimitives: ['sustained-combustion-region', 'ring-source', 'multiple-offset-kernels', 'turbulent-source-cluster'],
      source: { centerY: 0.27, radius: 0.082, aspectX: 1.62, aspectY: 0.76, onsetEnd: 0.1, sustainEnd: 0.6, pulseFrequency: 1.75, radial: 0.82, vertical: 0.65, turbulence: 1.25, heat: 1.18, smoke: 1.15, incandescent: 1.32, dust: 0.55, ringRadius: 1.55, clusterSpread: 1.62 },
      physics: { buoyancy: 1.02, densityLoading: 1.02, windCoupling: 0.82, vorticity: 1.35, velocityRetention: 0.99, cooling: 0.72, smokeConversion: 1.3, scalarRetention: 0.998 },
      volume: { scaleX: 1.24, scaleY: 0.92, depth: 1.22, opacity: 1.18, shadow: 1.18, bloom: 1.25, distortion: 1.2, erosion: 0.92, noiseScale: 1.08, dustVisibility: 0.68, exposure: 1.06, backgroundIllumination: 0.24, emissionCurve: 0.76 },
      quality: { grid: 0.98, pressure: 0.94, rays: 1.04, tracers: 1.04, detail: 1 },
    },
  ),
  'underground-detonation': defineFluidProfile(
    'underground-detonation',
    'underground-fluid-v1',
    {
      eventFamilyId: 'ground-coupled', eventFamily: 'Ground-coupled · underground', profileKind: 4,
      tracerType: 'particulate',
      sourcePrimitives: ['vertical-jet', 'ground-sheet', 'ejecta-curtain', 'multiple-offset-kernels', 'turbulent-source-cluster'],
      source: { centerY: 0.14, groundLevel: 0.18, radius: 0.055, aspectX: 1.25, aspectY: 0.62, onsetEnd: 0.075, sustainEnd: 0.52, radial: 0.75, vertical: 1.55, turbulence: 1.42, heat: 0.38, smoke: 0.92, incandescent: 0.25, dust: 2.25, ejecta: 1.65, clusterSpread: 1.2 },
      physics: { buoyancy: 0.78, densityLoading: 1.55, windCoupling: 0.68, vorticity: 1.52, velocityRetention: 0.982, cooling: 1.24, smokeConversion: 1.05, scalarRetention: 0.998 },
      volume: { scaleX: 1.08, scaleY: 1.25, depth: 1.08, opacity: 1.55, shadow: 1.55, bloom: 0.38, distortion: 0.46, erosion: 1.15, noiseScale: 1.38, dustVisibility: 2, exposure: 0.78, toneMap: 0.25, backgroundIllumination: 0.04, emissionCurve: 1.15 },
      quality: { grid: 0.94, pressure: 1, rays: 1, tracers: 1.28, detail: 1.08 },
    },
  ),
  'meteor-airburst': defineFluidProfile(
    'meteor-airburst',
    'meteor-airburst-fluid-v1',
    {
      eventFamilyId: 'meteor', eventFamily: 'Meteor · atmospheric airburst', profileKind: 5,
      tracerType: 'trail',
      sourcePrimitives: ['elongated-trail', 'directional-impulse', 'ring-source', 'multiple-offset-kernels'],
      source: { centerY: 0.47, radius: 0.06, aspectX: 1.72, aspectY: 0.66, onsetEnd: 0.045, sustainEnd: 0.38, stageOffset: 0.08, radial: 0.74, vertical: 0.32, directional: 1.38, turbulence: 0.82, heat: 1.45, smoke: 0.62, incandescent: 1.18, dust: 0.08, directionX: 0.66, directionY: -0.75, ringRadius: 1.75, trailLength: 2.7, clusterSpread: 1.35 },
      physics: { buoyancy: 0.7, densityLoading: 0.75, windCoupling: 1.35, vorticity: 1.05, velocityRetention: 0.988, cooling: 1.3, smokeConversion: 0.94, scalarRetention: 0.996 },
      volume: { scaleX: 1.38, scaleY: 0.86, depth: 0.88, opacity: 0.92, shadow: 0.72, bloom: 1.38, distortion: 1.18, erosion: 1.32, noiseScale: 1.4, dustVisibility: 0.12, exposure: 1.22, backgroundIllumination: 0.34, emissionCurve: 0.74 },
      quality: { grid: 0.9, pressure: 0.88, rays: 0.9, tracers: 1.18, detail: 0.92 },
    },
  ),
  'meteor-ground-impact': defineFluidProfile(
    'meteor-ground-impact',
    'meteor-impact-fluid-v1',
    {
      eventFamilyId: 'meteor', eventFamily: 'Meteor · ground impact', profileKind: 6,
      tracerType: 'ejecta',
      sourcePrimitives: ['elongated-trail', 'directional-impulse', 'vertical-jet', 'ejecta-curtain', 'ground-sheet'],
      source: { centerY: 0.18, groundLevel: 0.18, radius: 0.065, aspectX: 1.28, aspectY: 0.72, onsetEnd: 0.052, sustainEnd: 0.55, stageOffset: 0.065, radial: 1.18, vertical: 1.58, directional: 1.25, turbulence: 1.15, heat: 1.02, smoke: 0.88, incandescent: 0.92, dust: 2.05, directionX: 0.58, directionY: -0.82, ejecta: 1.92, trailLength: 2.35, clusterSpread: 1.28 },
      physics: { buoyancy: 0.84, densityLoading: 1.5, windCoupling: 0.82, vorticity: 1.4, velocityRetention: 0.982, cooling: 1.25, smokeConversion: 1.05, scalarRetention: 0.998 },
      volume: { scaleX: 1.2, scaleY: 1.34, depth: 1.18, opacity: 1.48, shadow: 1.48, bloom: 0.78, distortion: 0.86, erosion: 1.15, noiseScale: 1.3, dustVisibility: 1.9, exposure: 0.9, toneMap: 0.18, backgroundIllumination: 0.12, emissionCurve: 0.94 },
      quality: { grid: 1, pressure: 1.04, rays: 1.04, tracers: 1.42, detail: 1.12 },
    },
  ),
  'volcanic-eruption': defineFluidProfile(
    'volcanic-eruption',
    'volcanic-column-fluid-v1',
    {
      eventFamilyId: 'volcanic', eventFamily: 'Volcanic eruption', profileKind: 7,
      tracerType: 'ash',
      sourcePrimitives: ['pulsed-column', 'vertical-jet', 'turbulent-source-cluster', 'ground-sheet'],
      source: { centerY: 0.2, groundLevel: 0.18, radius: 0.052, aspectX: 0.72, aspectY: 1.58, onsetEnd: 0.14, sustainEnd: 1.25, pulseFrequency: 5.4, radial: 0.18, vertical: 1.42, turbulence: 1.5, heat: 0.48, smoke: 1.72, incandescent: 0.38, dust: 1.65, clusterSpread: 1.15 },
      physics: { buoyancy: 0.94, densityLoading: 1.25, windCoupling: 1.45, vorticity: 1.55, velocityRetention: 0.994, cooling: 0.82, smokeConversion: 1.12, scalarRetention: 0.9997 },
      volume: { scaleX: 1.3, scaleY: 1.34, depth: 1.2, opacity: 1.5, shadow: 1.62, bloom: 0.42, distortion: 0.55, erosion: 0.88, noiseScale: 1.18, dustVisibility: 1.55, exposure: 0.8, toneMap: 0.3, backgroundIllumination: 0.06, emissionCurve: 1.1 },
      quality: { grid: 1.04, pressure: 1.08, rays: 1.12, tracers: 1.38, detail: 1.2 },
    },
  ),
  'fictional-plasma-burst': defineFluidProfile(
    'fictional-plasma-burst',
    'fictional-plasma-fluid-v1',
    {
      eventFamilyId: 'fictional-plasma', eventFamily: 'Fictional · plasma', profileKind: 8,
      tracerType: 'plasma-filament',
      sourcePrimitives: ['radial-impulse', 'ring-source', 'multiple-offset-kernels', 'turbulent-source-cluster'],
      source: { centerY: 0.42, radius: 0.062, aspectX: 1, aspectY: 1, onsetEnd: 0.05, sustainEnd: 0.34, pulseFrequency: 7.2, radial: 1.35, vertical: 0.08, turbulence: 1.75, heat: 1.75, smoke: 0.12, incandescent: 1.85, dust: 0.02, ringRadius: 1.62, clusterSpread: 1.65 },
      physics: { buoyancy: 0.18, densityLoading: 0.3, windCoupling: 0.16, vorticity: 1.75, velocityRetention: 0.968, cooling: 1.9, smokeConversion: 0.28, scalarRetention: 0.984 },
      volume: { scaleX: 1.02, scaleY: 1.02, depth: 0.82, opacity: 0.58, shadow: 0.32, bloom: 1.85, distortion: 1.8, erosion: 1.55, noiseScale: 1.85, dustVisibility: 0.02, exposure: 1.45, toneMap: 0.45, backgroundIllumination: 0.5, emissionCurve: 0.62 },
      quality: { grid: 0.9, pressure: 0.82, rays: 0.86, tracers: 1.5, detail: 1.18 },
    },
  ),
  'low-yield-nuclear-airburst': defineFluidProfile(
    'low-yield-nuclear-airburst',
    'nuclear-airburst-fluid-v1',
    {
      eventFamilyId: 'nuclear-scale', eventFamily: 'Nuclear scale · research airburst', profileKind: 9,
      tracerType: 'thermal',
      sourcePrimitives: ['radial-impulse', 'vertical-jet', 'paired-cap-vortices'],
      preserveResearchSource: true,
      // 2026-07 low-yield POC: the preserved source branch now consumes these
      // normalized profile weights relative to its original defaults. Radial
      // motion leads vertical motion, the source is modestly wider, and curl
      // coupling is stronger without becoming a scaled-down historical plume.
      source: {
        centerY: 0.255, radius: 0.068, aspectX: 1.06, aspectY: 0.86,
        radial: 1.07, vertical: 0.92, turbulence: 1.05,
        heat: 0.54, smoke: 1, incandescent: 1.12, dust: 0.34,
        capScale: 1.24, capRoll: 1.27,
      },
      physics: {
        buoyancy: 0.88, vorticity: 1.12, velocityRetention: 0.991,
        cooling: 0.9, smokeConversion: 0.78, scalarRetention: 0.998,
      },
      volume: {
        scaleX: 1.06, scaleY: 0.68, depth: 1.12, opacity: 0.76,
        shadow: 1.45, bloom: 0.86, distortion: 1.08, erosion: 1.14,
        noiseScale: 1.16, dustVisibility: 0.58, exposure: 0.92,
        toneMap: 0.38, backgroundIllumination: 0.24, emissionCurve: 1,
      },
      plume: {
        mode: 2, expansion: 0.012, vortex: 0.04, persistence: 0.015, widen: 0.018,
        feedTaperStart: 0.08, feedTaperEnd: 0.24,
        lateralJitter: 0.32, turbulenceBlend: 0.15,
      },
      material: {
        mode: 1, sootAbsorption: 1.22, dustAbsorption: 0.72,
        detailBoost: 0.35, warmCoolContrast: 0.45, detailOctaveMode: 1,
      },
      shockwave: {
        mode: 2,
        ringB: { radiusOffset: -0.22, widthScale: 1.15, strength: 0.24, phaseOffset: 0.01 },
        ringC: { radiusOffset: 0.14, widthScale: 0.82, strength: 0.18, phaseOffset: 0.035 },
        ringD: { radiusOffset: 0, widthScale: 1, strength: 0, phaseOffset: 0 },
        irregularity: 0.035,
        fadeStart: 0.28,
        fadeSpan: 0.12,
        denseBandsHigh: 10,
        denseBandsBalanced: 9,
        denseBandsMobile: 7,
        denseInnerRadius: 0.27,
        denseOuterRadius: 0.94,
        denseSpacingVariation: 0.42,
        denseWidthMin: 0.04,
        denseWidthMax: 0.095,
        denseInnerStrength: 0.11,
        denseOuterStrength: 0.34,
        denseSegmentVariation: 1,
        denseDepthContrast: 0.52,
        denseOnsetSpread: 0.055,
        denseFadeVariation: 0.045,
        denseIrregularity: 0.068,
        denseFadeStart: 0.12,
        denseFadeSpan: 0.15,
      },
      core: {
        mode: 1, highlightThreshold: 2.32, highlightSharpness: 3.08,
        structureBlend: 0.79, bloomGateScale: 8.8,
      },
      tracerMaterial: {
        mode: 1, occlusionStrength: 1.8, sizeVariance: 0.35,
        brightnessVariance: 0.32, minSizeFloor: 1.45,
      },
      // This airburst reaches the responsive volume boundary while the dense
      // shock contours are still visible. Unlike the broad historical cap,
      // use a slightly tighter, asymmetric and more strongly warped envelope
      // so only thin edge residue dissolves; the central plume remains intact.
      edge: {
        mode: 2,
        center: 0.5,
        centerAsymmetry: 1.24,
        leftRadius: 0.43,
        rightRadius: 0.39,
        topRadius: 0.42,
        leftWobble: 0.09,
        rightWobble: -0.07,
        topWobble: 0.1,
        fadeStart: 0.5,
        fadeEnd: 1.02,
        distanceWobble: 0.34,
        lowDensityStart: 0.028,
        lowDensityEnd: 0.16,
        lowDensityAttenuation: 0.78,
      },
    },
  ),
  'nuclear-ground-burst': defineFluidProfile(
    'nuclear-ground-burst',
    'nuclear-ground-fluid-v1',
    {
      eventFamilyId: 'nuclear-scale', physicalFamilyId: 'ground-coupled', eventFamily: 'Nuclear scale · ground-coupled', profileKind: 10,
      tracerType: 'particulate',
      sourcePrimitives: ['radial-impulse', 'ground-sheet', 'vertical-jet', 'ejecta-curtain', 'multiple-offset-kernels'],
      source: {
        centerY: 0.19, groundLevel: 0.18, radius: 0.058,
        aspectX: 1.18, aspectY: 0.76, onsetEnd: 0.055, sustainEnd: 0.36,
        radial: 0.22, vertical: 2.02, turbulence: 2.05,
        heat: 1.0, smoke: 0.46, incandescent: 1.35, dust: 1.85,
        ejecta: 1.65, clusterSpread: 1.8, capScale: 1.48, capRoll: 2.75,
      },
      physics: { buoyancy: 1.42, densityLoading: 0.68, windCoupling: 1.18, vorticity: 2.0, velocityRetention: 0.968, cooling: 1.0, smokeConversion: 0.58, scalarRetention: 0.9995 },
      volume: { scaleX: 1.16, scaleY: 1.2, depth: 1.18, opacity: 0.43, shadow: 2.85, bloom: 0.78, distortion: 1.18, erosion: 1.38, noiseScale: 1.56, dustVisibility: 1.1, exposure: 1.03, toneMap: 0.36, backgroundIllumination: 0.12, emissionCurve: 1 },
      // The ground profile keeps its higher solver/detail budgets, but the
      // padded render extent does not require the historical 29-step raymarch
      // on Balanced. The profile-local 0.64 ray factor keeps the two-octave
      // material path readable without lowering any shared tier or other
      // preset's quality.
      // High-quality Ground Burst remains visually full through the existing
      // two-octave material path, while the profile-local ray factor avoids
      // the shared renderer's 30+ step spike on this heavy volume.
      quality: { grid: 1.04, pressure: 1.08, rays: 0.64, tracers: 1.32, detail: 1.12 },
      domain: {
        mode: 1,
        // A ten-percent solver margin keeps the ground-coupled plume away
        // from its finite texture border while retaining enough interior
        // resolution for the existing Balanced profile.
        padding: 0.10,
        renderOverscan: 1.04,
        // The boundary contract is profile-local. Balanced renders the
        // padded field at a modest offscreen resolution and lets the CSS
        // canvas upscale it; High keeps more native pixels and Mobile remains
        // native so portrait composition is not softened.
        // Ground Burst's high tier retains the larger solver and tracer
        // budgets, but the expensive padded volume is rendered at a modest
        // profile-local scale so a 31-step native raymarch cannot monopolize
        // the GPU. Shared tiers and other presets remain unchanged.
        renderScale: { mobile: 1, balanced: 0.62, high: 0.72 },
        // The smoke/shock event space is wider than the portrait viewport.
        // This is a render extent only: it does not enlarge the solver grid
        // or change source energy. Keeping the horizontal radius at the
        // padded-domain cap lets the analytical ground front continue beyond
        // the screen without outrunning a smaller smoke container.
        renderExtent: { x: 1.65, y: 1.5 },
        riskMargin: 0.07,
        densityThreshold: 0.14,
      },
      groundCoupling: {
        mode: 1,
        radialImpulse: 0.58,
        // Keep the physical surface front broad, but stop the source kernel
        // from loading an almost viewport-wide horizontal sheet before the
        // rising column has time to form. This is a Ground-only width control;
        // the default remains neutral for every other source profile.
        spreadWidth: 0.43,
        heightFalloff: 1.7,
        horizontalRetention: 0.972,
        verticalDamping: 0.68,
        spreadStart: 0.006,
        spreadEnd: 0.14,
        angularVariation: 0.42,
        asymmetry: 0.32,
        surfaceHeat: 1.05,
        baseDust: 1.5,
        transitionLift: 0.45,
        lateGroundDrift: 0.085,
      },
      core: {
        mode: 1, highlightThreshold: 0.32, highlightSharpness: 1.9,
        structureBlend: 1.08, bloomGateScale: 7.5,
      },
      plume: {
        mode: 3,
        expansion: 0.028,
        vortex: 0.98,
        persistence: 0.62,
        widen: 0.055,
        feedTaperStart: 0.2,
        feedTaperEnd: 0.42,
        lateralJitter: 0.98,
        turbulenceBlend: 0.64,
      },
      material: {
        mode: 1,
        sootAbsorption: 2.35,
        dustAbsorption: 0.5,
        detailBoost: 0.95,
        warmCoolContrast: 1.02,
        detailOctaveMode: 0,
        interiorDepth: 1.2,
      },
      shockwave: {
        mode: 1,
        ringB: { radiusOffset: -0.26, widthScale: 1.45, strength: 0.2, phaseOffset: 0.012 },
        ringC: { radiusOffset: 0.16, widthScale: 0.9, strength: 0.12, phaseOffset: 0.04 },
        ringD: { radiusOffset: 0, widthScale: 1, strength: 0, phaseOffset: 0 },
        irregularity: 0.075,
        fadeStart: 0.3,
        fadeSpan: 0.13,
      },
      tracerMaterial: {
        mode: 1,
        occlusionStrength: 2.25,
        sizeVariance: 0.46,
        brightnessVariance: 0.4,
        minSizeFloor: 1.65,
      },
      dissipation: {
        mode: 2,
        // Begin the ground-tail handoff just after the cap rollout. The
        // previous 0.70 gate left a bright, straight residual stem through
        // t20 even though its feed had already tapered off.
        lateStart: 0.5,
        finalStart: 1,
        sourceTaperEnd: 0.82,
        retentionFloorSmoke: 1,
        retentionFloorDust: 0.9994,
        outwardBoost: 0.05,
        buoyancyFalloff: 0.42,
        motionDamp: 0.58,
        lateVelocityRetention: 0.9993,
        lateCurl: 0.0085,
        lateShear: 0.0065,
        latePhaseRate: 0.06,
      },
      edge: {
        mode: 3,
        center: 0.5,
        centerAsymmetry: 1.4,
        leftRadius: 0.46,
        rightRadius: 0.41,
        topRadius: 0.44,
        leftWobble: 0.12,
        rightWobble: -0.09,
        topWobble: 0.11,
        fadeStart: 0.42,
        fadeEnd: 0.94,
        distanceWobble: 0.28,
        lowDensityStart: 0.035,
        lowDensityEnd: 0.19,
        lowDensityAttenuation: 0.18,
      },
    },
  ),
  'extreme-historical-scale': defineFluidProfile(
    'extreme-historical-scale',
    'extreme-historical-fluid-v1',
    {
      eventFamilyId: 'nuclear-scale', eventFamily: 'Nuclear scale · extreme historical', profileKind: 11,
      tracerType: 'atmospheric',
      sourcePrimitives: ['radial-impulse', 'ring-source', 'vertical-jet', 'multiple-offset-kernels', 'paired-cap-vortices'],
      source: { centerY: 0.37, radius: 0.092, aspectX: 1.15, aspectY: 0.92, onsetEnd: 0.055, sustainEnd: 0.78, pulseFrequency: 1.4, radial: 1.22, vertical: 1.38, turbulence: 1.48, heat: 1.42, smoke: 1.45, incandescent: 1.3, dust: 0.75, ringRadius: 1.75, clusterSpread: 1.62, capScale: 1.32 },
      physics: { buoyancy: 0.98, densityLoading: 1.12, windCoupling: 1.42, vorticity: 1.5, velocityRetention: 0.996, cooling: 0.68, smokeConversion: 1.08, scalarRetention: 0.9997 },
      volume: { scaleX: 1.34, scaleY: 1.4, depth: 1.42, opacity: 1.34, shadow: 1.5, bloom: 1.52, distortion: 1.28, erosion: 0.88, noiseScale: 0.92, dustVisibility: 1, exposure: 1.18, toneMap: 0.08, backgroundIllumination: 0.44, emissionCurve: 0.78 },
      quality: { grid: 1.12, pressure: 1.16, rays: 1.18, tracers: 1.42, detail: 1.25 },
    },
  ),
  // Historical visual-reference profiles. Each uses only broad public visual
  // characteristics (flash duration, cloud proportion, dust loading, timeline
  // pacing); none encodes device, yield-engineering, or targeting information.
  'early-fission-test-scale': defineFluidProfile(
    'early-fission-test-scale',
    'early-fission-reference-fluid-v1',
    {
      eventFamilyId: 'nuclear-scale', eventFamily: 'Nuclear scale · early fission reference', profileKind: 12,
      tracerType: 'particulate',
      sourcePrimitives: ['radial-impulse', 'ground-sheet', 'vertical-jet', 'paired-cap-vortices'],
      source: { centerY: 0.21, groundLevel: 0.18, radius: 0.06, aspectX: 1.18, aspectY: 0.8, onsetEnd: 0.05, sustainEnd: 0.46, radial: 1.15, vertical: 1.2, turbulence: 1.05, heat: 1.18, smoke: 1.05, incandescent: 1.05, dust: 1.6, capScale: 0.88, capRoll: 0.85 },
      physics: { buoyancy: 0.84, densityLoading: 1.3, windCoupling: 0.92, vorticity: 1.3, velocityRetention: 0.988, cooling: 1.05, smokeConversion: 1.15, scalarRetention: 0.998 },
      volume: { scaleX: 1.34, scaleY: 1.12, depth: 1.05, opacity: 1.3, shadow: 1.35, bloom: 1.02, distortion: 1.02, erosion: 1.08, noiseScale: 1.22, dustVisibility: 1.6, exposure: 1.05, toneMap: 0.08, backgroundIllumination: 0.2, emissionCurve: 0.88 },
      quality: { grid: 1, pressure: 1, rays: 1, tracers: 1.1, detail: 1 },
    },
  ),
  'hiroshima-scale-reference': defineFluidProfile(
    'hiroshima-scale-reference',
    'hiroshima-scale-reference-fluid-v1',
    {
      eventFamilyId: 'nuclear-scale', eventFamily: 'Nuclear scale · early airburst reference', profileKind: 13,
      tracerType: 'thermal',
      sourcePrimitives: ['radial-impulse', 'vertical-jet', 'multiple-offset-kernels', 'paired-cap-vortices'],
      source: { centerY: 0.33, radius: 0.06, aspectX: 0.95, aspectY: 0.9, onsetEnd: 0.05, sustainEnd: 0.42, radial: 1.05, vertical: 1.32, turbulence: 0.95, heat: 1.22, smoke: 1.02, incandescent: 1.1, dust: 0.42, clusterSpread: 1.1, capScale: 0.96, capRoll: 1.05 },
      physics: { buoyancy: 0.94, densityLoading: 0.98, windCoupling: 0.98, vorticity: 1.18, velocityRetention: 0.992, cooling: 0.85, smokeConversion: 1.05, scalarRetention: 0.999 },
      volume: { scaleX: 1.32, scaleY: 1.22, depth: 1.05, opacity: 1.12, shadow: 1.22, bloom: 1.18, distortion: 1.1, erosion: 1, noiseScale: 1.12, dustVisibility: 0.55, exposure: 1.1, backgroundIllumination: 0.3, emissionCurve: 0.82 },
      quality: { grid: 1, pressure: 1, rays: 1.02, tracers: 1.08, detail: 1 },
    },
  ),
  'castle-bravo-scale-reference': defineFluidProfile(
    'castle-bravo-scale-reference',
    'castle-bravo-scale-reference-fluid-v1',
    {
      eventFamilyId: 'nuclear-scale', eventFamily: 'Nuclear scale · thermonuclear surface reference', profileKind: 14,
      tracerType: 'atmospheric',
      sourcePrimitives: ['radial-impulse', 'ring-source', 'ground-sheet', 'vertical-jet', 'paired-cap-vortices'],
      source: { centerY: 0.2, groundLevel: 0.18, radius: 0.088, aspectX: 1.5, aspectY: 0.85, onsetEnd: 0.06, sustainEnd: 0.72, pulseFrequency: 1.6, radial: 1.26, vertical: 1.4, turbulence: 1.35, heat: 1.35, smoke: 1.6, incandescent: 1.22, dust: 1.72, ringRadius: 1.6, capScale: 1.42, capRoll: 1.3 },
      physics: { buoyancy: 0.96, densityLoading: 1.32, windCoupling: 1.3, vorticity: 1.42, velocityRetention: 0.995, cooling: 0.72, smokeConversion: 1.15, scalarRetention: 0.9996 },
      volume: { scaleX: 1.36, scaleY: 1.34, depth: 1.35, opacity: 1.42, shadow: 1.55, bloom: 1.32, distortion: 1.22, erosion: 0.92, noiseScale: 1.02, dustVisibility: 1.55, exposure: 1.1, toneMap: 0.1, backgroundIllumination: 0.34, emissionCurve: 0.84 },
      quality: { grid: 1.08, pressure: 1.1, rays: 1.12, tracers: 1.3, detail: 1.15 },
    },
  ),
  'tsar-bomba-scale-reference': defineFluidProfile(
    'tsar-bomba-scale-reference',
    'tsar-bomba-scale-reference-fluid-v1',
    {
      eventFamilyId: 'nuclear-scale', eventFamily: 'Nuclear scale · largest historical reference', profileKind: 15,
      tracerType: 'atmospheric',
      sourcePrimitives: ['radial-impulse', 'ring-source', 'vertical-jet', 'turbulent-source-cluster', 'paired-cap-vortices'],
      // 2026-07 Tsar research pass: balance radial against vertical injection so
      // the column is no longer a pencil jet, lower the source so the cap has
      // vertical room, convert incandescence to smoke sooner (smoke body, not a
      // persistent white fireball), and feed more smoke overall.
      source: { centerY: 0.32, radius: 0.112, aspectX: 1.2, aspectY: 0.92, onsetEnd: 0.06, sustainEnd: 0.97, pulseFrequency: 1.2, radial: 1.42, vertical: 1.12, turbulence: 1.45, heat: 1.4, smoke: 1.72, incandescent: 1.12, dust: 0.42, ringRadius: 1.85, clusterSpread: 1.7, capScale: 1.62, capRoll: 1.46 },
      physics: { buoyancy: 1.0, densityLoading: 1.02, windCoupling: 1.3, vorticity: 1.5, velocityRetention: 0.997, cooling: 0.66, smokeConversion: 1.32, scalarRetention: 0.9998 },
      // Roll off the highlights (higher toneMap, lower exposure/bloom) so the
      // hot phase reads as a structured fireball instead of a flat white disc.
      volume: { scaleX: 1.4, scaleY: 1.42, depth: 1.48, opacity: 1.48, shadow: 1.5, bloom: 1.15, distortion: 1.32, erosion: 0.82, noiseScale: 0.86, dustVisibility: 0.58, exposure: 1.0, toneMap: 0.24, backgroundIllumination: 0.46, emissionCurve: 0.88 },
      quality: { grid: 1.14, pressure: 1.18, rays: 1.2, tracers: 1.44, detail: 1.28 },
      // feedTaperStart/End (2026-07 shockwave/stem/performance pass): the
      // audited hard vertical seam came from coreBand staying fed almost to
      // the end of the timeline (old 0.85-1.05 taper, ~t46-54) while the
      // mature cap is fully formed by ~30s (0.6) — moving the taper to
      // 0.32-0.62 (~t17-33) lets the column break up right after cap
      // formation instead of holding one straight painted line through the
      // whole dense mid-timeline. lateralJitter/turbulenceBlend drive the
      // stemBreakup decorrelation (off-center drift + medium-scale
      // turbulence folded into the corridor) over that same window.
      plume: {
        mode: 1, expansion: 0.65, vortex: 1.0, persistence: 0.78, widen: 0.6,
        feedTaperStart: 0.32, feedTaperEnd: 0.62, lateralJitter: 0.35, turbulenceBlend: 0.16,
      },
      // 2026-07 shockwave shell-layering pass: the audited defect was that
      // profileRingKernel contributed exactly one fixed-radius band at flat
      // 0.5 weight, so t10-t20 read as an outer sphere plus at most two faint
      // arcs. Three secondary bands (ringB/C/D) nest around the primary ring
      // at different radii, widths, and strengths so the structure reads as
      // layered shell rather than one uniform line; small phaseOffsets stage
      // their onset so they build up rather than all appearing/fading in
      // lockstep, and fadeStart/fadeSpan ease them out well before the
      // mature-phase dissipation ramp begins (lateStart 0.6 below) so they
      // never compete with or mask genuine late-timeline clearing.
      shockwave: {
        mode: 1,
        ringB: { radiusOffset: -0.32, widthScale: 1.35, strength: 0.42, phaseOffset: 0.015 },
        ringC: { radiusOffset: 0.22, widthScale: 0.75, strength: 0.34, phaseOffset: 0.05 },
        ringD: { radiusOffset: -0.55, widthScale: 1.9, strength: 0.24, phaseOffset: 0.03 },
        irregularity: 0.05,
        fadeStart: 0.44,
        fadeSpan: 0.14,
      },
      // 2026-07 smoke-material pass: soot absorbs more strongly than lofted
      // dust (independent optical-depth coefficients instead of one shared
      // curve), an energy-weighted third detail octave adds medium-scale
      // billowing, and warmCoolContrast widens the lit/shadowed range for
      // readable internal depth.
      material: { mode: 1, sootAbsorption: 1.6, dustAbsorption: 0.35, detailBoost: 1.4, warmCoolContrast: 0.85, detailOctaveMode: 1 },
      // 2026-07 core/tracer polish: t5-t10 was reading as a flat white
      // capsule because the white-hot highlight term saturated to its
      // maximum (pow(...)=1.0) across most of the amplified Tsar core
      // temperature range. Raising the threshold and sharpness narrows full
      // saturation to genuinely the hottest voxels; structureBlend folds in
      // self-shadow and turbulence detail so the highlight breaks into
      // irregular thermal pockets instead of one uniform plateau;
      // bloomGateScale suppresses bloom specifically where the local
      // temperature gradient is flat (the plateau itself) while leaving
      // bloom around real edges untouched.
      core: { mode: 1, highlightThreshold: 2.35, highlightSharpness: 3.2, structureBlend: 0.8, bloomGateScale: 11 },
      // 2026-07 late-dissipation pass: the approved broad plume/persistence
      // fix kept the cloud fully intact through mature cap formation (correct)
      // but never relaxed afterward, so the field never lost mass. The mature
      // cap is fully formed by ~30s (verified against the approved evidence),
      // so beginning at normalized time 0.6 (~32s) the ramp eases source
      // injection and plume-shaping motion toward zero and lets scalar
      // retention ease down from its near-unity mature value toward real
      // per-step decay, reaching its strongest effect by 0.94 (~51s) with a
      // few remaining seconds to finish clearing before the timeline ends —
      // smooth and continuous, no hard cutoff, and inert for the entire
      // mature phase before lateStart.
      dissipation: {
        mode: 1,
        lateStart: 0.6,
        finalStart: 0.94,
        sourceTaperEnd: 0.72,
        // NOTE: this is a per-(dt*60) retention, i.e. effectively
        // retentionFloor^60 per real second — small departures from 1.0
        // compound enormously (0.999 -> ~94%/sec retention; 0.997 ->
        // ~86%/sec; 0.99 -> ~55%/sec). The mature-phase value (persistence
        // mix at target 1.0) already computes to ~93%/sec (~6.6% loss/sec);
        // it was invisible before only because continuous source injection
        // outpaced it. Tapering the source is what actually exposes real
        // dissipation; retentionFloorSmoke only needs a small nudge below
        // that mature value, not a large new decay rate on top of it.
        retentionFloorSmoke: 0.9993,
        retentionFloorDust: 0.998,
        // Kept small: a strong outward push was driving mass into the
        // existing side/top boundary guard band, which absorbs far more
        // aggressively than the scalar retention floor — that combination
        // was the real cause of the field vanishing almost instantly
        // instead of thinning gradually in place.
        outwardBoost: 0.1,
        buoyancyFalloff: 0.5,
        motionDamp: 0.72,
        // Keep the late cloud advecting while its scalar field thins. These
        // are deliberately much weaker than formation-stage plume forces:
        // they preserve cap coherence while introducing slow, deterministic
        // lobe drift and edge shear rather than boiling noise.
        lateVelocityRetention: 0.999,
        lateCurl: 0.0065,
        lateShear: 0.0045,
        latePhaseRate: 0.052,
      },
      // 2026-07 core/tracer polish: tracers rendered above smoke regardless
      // of how buried they were and shared one fixed size/brightness, which
      // read as a layer of repetitive dots sitting on top of the volume
      // instead of embedded within it. occlusionStrength adds a
      // Beer-Lambert-style falloff (exp(-localDensity * occlusionStrength))
      // on top of the existing density-weighted visibility so dense smoke
      // suppresses tracers, thin smoke lets them through, and medium density
      // partially attenuates. sizeVariance/brightnessVariance give each
      // tracer a stable per-particle random offset instead of one uniform
      // size and brightness.
      // minSizeFloor (2026-07 dissipation-artifact addendum): at the shared
      // 1.0px baseSize floor, TRACER_FRAGMENT's radial coverage falloff has
      // no subpixels to work with — a tracer at minimum size is visually
      // indistinguishable from a solid square pixel regardless of the
      // falloff math. Raising the floor for Tsar only gives that falloff
      // room to actually render round.
      tracerMaterial: {
        mode: 1, occlusionStrength: 2.6, sizeVariance: 0.5, brightnessVariance: 0.45, minSizeFloor: 1.8,
      },
      // 2026-07 dissipation-artifact fix: the shared side/top boundary
      // envelope (edgeExtinction()) is an independent-per-axis rectangle.
      // Invisible while the fireball/plume saturate the interior, but once
      // the broader lateral turbulence from the stem-breakup fix and the
      // extended shockwave bands leave low, near-uniform residual density
      // sitting inside that envelope for longer, its own axis-aligned
      // isocontour becomes the visible silhouette — a faint square/
      // rectangular cloud during and after late dissipation. mode 1 switches
      // Tsar only to the merged organic superellipse envelope.
      edge: {
        mode: 1,
        // Explicitly preserve the approved historical envelope that was
        // previously implicit in the mode-1 shader branch.
        center: 0.5,
        centerAsymmetry: 1.6,
        leftRadius: 0.42,
        rightRadius: 0.42,
        topRadius: 0.46,
        leftWobble: 0.05,
        rightWobble: -0.04,
        topWobble: 0.06,
        fadeStart: 0.55,
        fadeEnd: 1,
        distanceWobble: 0.22,
      },
    },
  ),
});

// Descriptive alias for consumers that do not use the legacy research naming.
export const EVENT_FLUID_PROFILES = RESEARCH_FLUID_PROFILES;

const FLUID_PROFILE_BY_ID = Object.freeze(Object.fromEntries(
  Object.values(RESEARCH_FLUID_PROFILES).map((profile) => [profile.profileId, profile]),
));

function resolveFluidProfile(presetId, profileId) {
  const normalizedPresetId = String(presetId || '');
  const presetProfile = RESEARCH_FLUID_PROFILES[normalizedPresetId];
  if (!presetProfile) {
    throw new RangeError(`Unknown fluid preset profile: ${normalizedPresetId || '<empty>'}.`);
  }
  if (!profileId) return presetProfile;
  const requestedProfile = FLUID_PROFILE_BY_ID[String(profileId)];
  if (!requestedProfile || requestedProfile.presetId !== normalizedPresetId) {
    throw new RangeError(`Fluid profile ${String(profileId)} does not belong to preset ${normalizedPresetId}.`);
  }
  return requestedProfile;
}

function normalizeSourcePrimitives(value, profile) {
  const requested = Array.isArray(value) ? value : profile.sourcePrimitives;
  const unique = [];
  for (const primitive of requested) {
    const id = String(primitive || '').toLowerCase();
    if (!RESEARCH_FLUID_SOURCE_PRIMITIVES[id] || unique.includes(id)) continue;
    unique.push(id);
  }
  return Object.freeze(unique.length ? unique : [...profile.sourcePrimitives]);
}

function sourcePrimitiveMask(primitives) {
  return primitives.reduce(
    (mask, primitive) => mask | (RESEARCH_FLUID_SOURCE_PRIMITIVES[primitive] || 0),
    0,
  ) >>> 0;
}

const TRACER_TYPE_IDS = Object.freeze({
  thermal: 0,
  debris: 1,
  particulate: 2,
  ember: 3,
  ash: 4,
  ejecta: 5,
  'plasma-filament': 6,
  trail: 7,
  atmospheric: 8,
});

function seededProfileOffsets(seed, profileKind) {
  const values = [];
  for (let index = 0; index < 8; index += 1) {
    const mixed = mixDetailBits(
      (seed >>> 0)
      ^ Math.imul(profileKind + 1, 0x9e3779b1)
      ^ Math.imul(index + 17, 0x85ebca77),
    );
    values.push(mixed / 0xffffffff * 2 - 1);
  }
  return values;
}

const DEFAULT_FLUID_PALETTE = deepFreeze({
  id: 'research-natural',
  background: [0.025, 0.029, 0.035],
  core: [1, 0.96, 0.78],
  hot: [1, 0.66, 0.15],
  flame: [1, 0.19, 0.018],
  ember: [0.34, 0.018, 0.004],
  smoke: [0.025, 0.029, 0.035],
  smokeLight: [0.22, 0.2, 0.18],
  cloud: [0.22, 0.2, 0.18],
  dust: [0.36, 0.27, 0.19],
  plasma: [0.48, 0.9, 1],
  thermal: [1, 0.34, 0.08],
});

function normalizedColor(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) {
    const maximum = Math.max(...value.slice(0, 3).map((channel) => Math.abs(finite(channel, 0))));
    const divisor = maximum > 1 ? 255 : 1;
    return Object.freeze(value.slice(0, 3).map((channel, index) =>
      clamp(finite(channel, fallback[index] * divisor) / divisor, 0, 1)));
  }
  const text = String(value || '').trim();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let body = hex[1];
    if (body.length === 3) body = body.split('').map((part) => part + part).join('');
    const numeric = Number.parseInt(body, 16);
    return Object.freeze([
      ((numeric >> 16) & 255) / 255,
      ((numeric >> 8) & 255) / 255,
      (numeric & 255) / 255,
    ]);
  }
  const rgb = text.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const channels = rgb[1].split(',').slice(0, 3).map((channel) => finite(channel.trim(), 0));
    if (channels.length === 3) return Object.freeze(channels.map((channel) => clamp(channel / 255, 0, 1)));
  }
  return fallback;
}

function normalizeFluidPalette(value, previous = DEFAULT_FLUID_PALETTE) {
  const palette = value && typeof value === 'object' ? value : {};
  const read = (keys, fallback) => {
    for (const key of keys) {
      if (palette[key] !== undefined) return normalizedColor(palette[key], fallback);
    }
    return fallback;
  };
  return deepFreeze({
    id: String(palette.id || previous.id || DEFAULT_FLUID_PALETTE.id),
    background: read(['background', 'skyTop'], previous.background),
    core: read(['core', 'flash'], previous.core),
    hot: read(['hot', 'core', 'flash'], previous.hot),
    flame: read(['flame'], previous.flame),
    ember: read(['ember'], previous.ember),
    smoke: read(['smoke'], previous.smoke),
    smokeLight: read(['smokeLight', 'cloud'], previous.smokeLight),
    cloud: read(['cloud', 'smoke'], previous.cloud),
    dust: read(['dust'], previous.dust),
    plasma: read(['plasma', 'accent', 'shock'], previous.plasma),
    thermal: read(['thermal', 'flame'], previous.thermal),
  });
}

export const RESEARCH_FLUID_DIAGNOSTICS = Object.freeze({
  beauty: 0,
  final: 0,
  velocity: 1,
  temperature: 2,
  density: 3,
  smoke: 3,
  smokeDensity: 3,
  incandescent: 4,
  incandescentDensity: 4,
  pressure: 5,
  divergence: 6,
  vorticity: 7,
  tracers: 8,
});

export const RESEARCH_FLUID_DEFAULTS = Object.freeze({
  presetId: 'low-yield-nuclear-airburst',
  profileId: 'nuclear-airburst-fluid-v1',
  eventFamilyId: 'nuclear-scale',
  physicalFamilyId: 'nuclear-scale',
  sourcePrimitives: RESEARCH_FLUID_PROFILES['low-yield-nuclear-airburst'].sourcePrimitives,
  palette: DEFAULT_FLUID_PALETTE,
  seed: 1842,
  energy: 1,
  altitude: 0.23,
  windDirection: 90,
  windStrength: 24,
  duration: 29.5,
  reducedMotion: false,
  sourceStrength: 1,
  buoyancy: 0.62,
  densityLoading: 0.16,
  cooling: 0.22,
  smokeConversion: 0.78,
  dissipation: 0.995,
  tier: 'balanced',
  diagnostic: 'beauty',
});

const FULLSCREEN_VERTEX = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 position = vec2(
    gl_VertexID == 1 ? 3.0 : -1.0,
    gl_VertexID == 2 ? 3.0 : -1.0
  );
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FIELD_SAMPLING = `
vec4 sampleField(sampler2D field, vec2 uv) {
  ivec2 dimensions = textureSize(field, 0);
  vec2 size = vec2(dimensions);
  vec2 position = clamp(uv, 0.5 / size, 1.0 - 0.5 / size) * size - 0.5;
  ivec2 base = ivec2(floor(position));
  vec2 fraction = fract(position);
  ivec2 maximum = dimensions - 1;
  ivec2 p00 = clamp(base, ivec2(0), maximum);
  ivec2 p10 = clamp(base + ivec2(1, 0), ivec2(0), maximum);
  ivec2 p01 = clamp(base + ivec2(0, 1), ivec2(0), maximum);
  ivec2 p11 = clamp(base + ivec2(1, 1), ivec2(0), maximum);
  vec4 lower = mix(texelFetch(field, p00, 0), texelFetch(field, p10, 0), fraction.x);
  vec4 upper = mix(texelFetch(field, p01, 0), texelFetch(field, p11, 0), fraction.x);
  return mix(lower, upper, fraction.y);
}

float boundaryMask(vec2 uv) {
  // Wider, softer damping margins on the open sides and top behave like an
  // absorbing outflow boundary; the ground margin stays narrow so surface
  // interaction is preserved.
  vec2 lower = smoothstep(vec2(0.0), vec2(0.03, 0.018), uv);
  vec2 upper = smoothstep(vec2(0.0), vec2(0.03, 0.06), 1.0 - uv);
  return lower.x * lower.y * upper.x * upper.y;
}
`;

const SEEDED_HASH = `
uint mixBits(uint value) {
  value ^= value >> 16;
  value *= 0x7feb352du;
  value ^= value >> 15;
  value *= 0x846ca68bu;
  value ^= value >> 16;
  return value;
}
`;

const DETAIL_SAMPLING = `
vec4 sampleCurlDetail(sampler3D field, vec3 position) {
  return texture(field, fract(position));
}

vec3 decodeCurlDetail(vec4 encoded) {
  return encoded.xyz * 2.0 - 1.0;
}
`;

const SOURCE_PROFILE_UNIFORMS = `
uniform uint uSourceMask;
uniform int uProfileKind;
uniform vec4 uSourceShape;
uniform vec4 uSourceTiming;
uniform vec4 uSourceMotion;
uniform vec4 uSourceScalar;
uniform vec4 uSourceVector;
uniform vec4 uSourceAux;
uniform vec4 uSeedOffsetsA;
uniform vec4 uSeedOffsetsB;
uniform vec4 uProfilePhysics;
uniform vec4 uProfileDecay;
uniform vec4 uProfileAux;
// The active scalar region may occupy the padded center of the fixed solver
// texture. 1.0 keeps legacy coordinates; smaller values preserve visible
// source motion while reserving an absorbing computational margin.
uniform float uDomainActiveScale;
// Ground Burst-specific surface coupling, inert unless uGroundCouplingMode is
// enabled by the immutable profile. A packs radial impulse, source-height
// falloff, horizontal retention, and near-ground vertical damping. B packs
// radial phase start/end, deterministic lobe variation, and left/right
// asymmetry. C packs surface heat, base dust, transition lift, and late drift.
uniform float uGroundCouplingMode;
uniform float uGroundSpreadWidth;
uniform vec4 uGroundCouplingA;
uniform vec4 uGroundCouplingB;
uniform vec4 uGroundCouplingC;
// Profile-gated broad-plume research controls. uPlumeMode 0 is inert, mode 1
// is the historical-scale variant, mode 2 is the compact low-yield variant,
// and mode 3 is the independently balanced ground-coupled variant.
// uPlumeParams packs
// (expansion, vortexStrength, persistence, columnWiden).
uniform float uPlumeMode;
uniform vec4 uPlumeParams;
// Central-stem taper/breakup controls, inert under the same uPlumeMode gate as
// uPlumeParams above. Packs (feedTaperStart,
// feedTaperEnd, lateralJitter, turbulenceBlend) — see the coreBand/
// stemBreakup usage in FORCE_FRAGMENT for what each term does.
uniform vec4 uPlumeStemParams;
// Tsar-scale late-dissipation research controls. uDissipationMode is 0 for
// every shipped preset except the Tsar historical reference, so this block is
// inert (byte-identical behavior) for all other events. uDissipationParams
// packs (lateStart, finalStart, retentionFloorSmoke, retentionFloorDust);
// uDissipationParams2 packs (sourceTaperEnd, outwardBoost, buoyancyFalloff,
// motionDamp); uDissipationParams3 packs (lateVelocityRetention, lateCurl,
// lateShear, latePhaseRate) — all in normalized-time / unitless-blend terms.
uniform float uDissipationMode;
uniform vec4 uDissipationParams;
uniform vec4 uDissipationParams2;
uniform vec4 uDissipationParams3;
// Profile-gated scalar shockwave layering. Modes 1 and 2 retain the three
// explicit subordinate-ring slots; the additional low-yield mode-2 contour
// family is declared and evaluated only by the volume compositor.
uniform float uShockwaveMode;
uniform vec4 uShockwaveRingB;
uniform vec4 uShockwaveRingC;
uniform vec4 uShockwaveRingD;
uniform vec4 uShockwaveAux;
`;

const SOURCE_PROFILE_FUNCTIONS = `
const uint SOURCE_RADIAL = 1u;
const uint SOURCE_DIRECTIONAL = 2u;
const uint SOURCE_RING = 4u;
const uint SOURCE_GROUND = 8u;
const uint SOURCE_VERTICAL = 16u;
const uint SOURCE_MULTIPLE = 32u;
const uint SOURCE_PULSED = 64u;
const uint SOURCE_EJECTA = 128u;
const uint SOURCE_TRAIL = 256u;
const uint SOURCE_SUSTAINED = 512u;
const uint SOURCE_TURBULENT = 1024u;
const uint SOURCE_PAIRED_CAP = 2048u;

bool sourceEnabled(uint primitive) {
  return (uSourceMask & primitive) != 0u;
}

vec2 safeDirection(vec2 direction) {
  float magnitude = length(direction);
  return magnitude > 0.00001 ? direction / magnitude : vec2(0.0, 1.0);
}

vec2 profileSourceCenter() {
  return uSourceCenter + uSourceVector.zw;
}

float ellipticalKernel(vec2 delta, float radius, vec2 aspect) {
  vec2 scaled = delta / max(vec2(0.002), radius * max(aspect, vec2(0.12)));
  return exp(-dot(scaled, scaled));
}

float profileBaseKernel(vec2 uv) {
  return ellipticalKernel(
    uv - profileSourceCenter(),
    uSourceShape.x,
    uSourceShape.yz
  );
}

float profileMultiKernel(vec2 uv) {
  float radius = uSourceShape.x * 0.68;
  float spread = uSourceShape.x * uSourceAux.w;
  vec2 center = profileSourceCenter();
  float a = ellipticalKernel(uv - center - uSeedOffsetsA.xy * spread, radius, vec2(1.15, 0.72));
  float b = ellipticalKernel(uv - center - uSeedOffsetsA.zw * spread, radius * 0.86, vec2(0.72, 1.08));
  float c = ellipticalKernel(uv - center - uSeedOffsetsB.xy * spread, radius * 0.72, vec2(1.3, 0.66));
  float d = ellipticalKernel(uv - center - uSeedOffsetsB.zw * spread, radius * 0.58, vec2(0.8, 1.2));
  return clamp(a * 0.82 + b * 0.68 + c * 0.58 + d * 0.44, 0.0, 1.65);
}

float profileRingKernel(vec2 uv) {
  vec2 delta = uv - profileSourceCenter();
  vec2 scaled = delta / max(vec2(0.002), uSourceShape.x * uSourceShape.yz);
  float distanceFromRing = abs(length(scaled) - uSourceAux.x);
  return exp(-distanceFromRing * distanceFromRing * 9.5);
}

// One nested secondary/tertiary/quaternary shell band around the primary
// ring above. Inert unless uShockwaveMode is set (Tsar historical reference
// only). angleSeed differentiates the angular wobble phase per band so
// nested rings do not wobble in unison, which would just read as one thick
// ring instead of layered structure.
float profileShockwaveBand(vec2 uv, vec4 band, float angleSeed) {
  vec2 delta = uv - profileSourceCenter();
  vec2 scaled = delta / max(vec2(0.002), uSourceShape.x * uSourceShape.yz);
  float angle = atan(scaled.y, scaled.x);
  float wobble = uShockwaveAux.x * (
    sin(angle * 3.0 + angleSeed) * 0.5
    + sin(angle * 7.0 - angleSeed * 1.6) * 0.3
    + sin(angle * 11.0 + angleSeed * 2.3) * 0.2
  );
  float ringRadius = max(0.02, uSourceAux.x + band.x) * (1.0 + wobble);
  float distanceFromRing = abs(length(scaled) - ringRadius);
  float sharpness = 9.5 / max(0.15, band.y * band.y);
  float shell = exp(-distanceFromRing * distanceFromRing * sharpness);
  float onset = smoothstep(band.w, band.w + 0.05, uNormalizedTime);
  float fade = 1.0 - smoothstep(
    uShockwaveAux.y + band.w * 0.4,
    uShockwaveAux.y + uShockwaveAux.z,
    uNormalizedTime
  );
  return shell * band.z * onset * clamp(fade, 0.0, 1.0);
}

// Mode 0 collapses exactly to zero. Modes 1 and 2 retain the established
// explicit scalar rings; mode 2 adds its dense family only in the volume
// compositor so the approved low-yield simulation field remains unchanged.
float profileShockwaveLayers(vec2 uv) {
  if (uShockwaveMode < 0.5) return 0.0;
  return profileShockwaveBand(uv, uShockwaveRingB, 1.7)
    + profileShockwaveBand(uv, uShockwaveRingC, 3.4)
    + profileShockwaveBand(uv, uShockwaveRingD, 5.1);
}

float profileGroundKernel(vec2 uv) {
  float vertical = (uv.y - uSourceShape.w) / max(0.006, uSourceShape.x * 0.28);
  float widthScale = uGroundCouplingMode > 0.5
    ? clamp(uGroundSpreadWidth, 0.42, 1.2)
    : 1.0;
  float horizontal = (uv.x - profileSourceCenter().x) / max(0.02, uSourceShape.x * 4.8 * widthScale);
  return exp(-vertical * vertical - horizontal * horizontal);
}

float profileVerticalKernel(vec2 uv) {
  vec2 center = profileSourceCenter();
  float horizontal = (uv.x - center.x) / max(0.006, uSourceShape.x * 0.42);
  float lower = smoothstep(uSourceShape.w - 0.025, uSourceShape.w + 0.02, uv.y);
  float upper = 1.0 - smoothstep(center.y + uSourceShape.x * 5.0, center.y + uSourceShape.x * 8.5, uv.y);
  return exp(-horizontal * horizontal) * lower * upper;
}

float profileTrailKernel(vec2 uv) {
  vec2 direction = safeDirection(uSourceVector.xy);
  vec2 normal = vec2(-direction.y, direction.x);
  vec2 delta = uv - profileSourceCenter();
  float along = dot(delta, direction);
  float across = dot(delta, normal);
  float halfLength = max(uSourceShape.x, uSourceShape.x * uSourceAux.z);
  float outside = max(abs(along) - halfLength, 0.0);
  float directionalTaper = mix(
    0.08,
    1.0,
    1.0 - smoothstep(-halfLength * 0.16, halfLength * 0.62, along)
  );
  return directionalTaper * exp(
    -across * across / max(0.00008, uSourceShape.x * uSourceShape.x * 0.24)
    -outside * outside / max(0.00012, uSourceShape.x * uSourceShape.x)
  );
}

float profileEjectaKernel(vec2 uv) {
  vec2 delta = uv - vec2(profileSourceCenter().x, uSourceShape.w);
  float radius = max(0.012, uSourceShape.x * (1.1 + uNormalizedTime * 4.4));
  float shell = abs(length(delta / vec2(1.35, 0.72)) - radius);
  float upper = smoothstep(-0.012, 0.025, delta.y);
  return exp(-shell * shell / max(0.00006, radius * radius * 0.12)) * upper;
}

float profilePulseEnvelope() {
  float wave = 0.5 + 0.5 * sin(
    uTime * max(0.2, uSourceTiming.z) + uSeedOffsetsB.w * 6.28318530718
  );
  return 0.28 + wave * wave * 0.72;
}

float profileOnsetEnvelope() {
  float afterOnset = step(0.000001, uTime);
  return exp(-uNormalizedTime / max(0.004, uSourceTiming.x)) * afterOnset;
}

float profileSustainEnvelope() {
  float start = smoothstep(0.0, 0.012, uNormalizedTime);
  float end = 1.0 - smoothstep(uSourceTiming.y, uSourceTiming.y + 0.24, uNormalizedTime);
  return start * end;
}

float profileStageEnvelope() {
  return smoothstep(uSourceTiming.w, uSourceTiming.w + 0.028, uNormalizedTime);
}

// 0 through the entire mature phase, easing smoothly to 1 between lateStart
// and finalStart; inert (always 0) unless uDissipationMode is set.
float dissipationProgress() {
  if (uDissipationMode < 0.5) return 0.0;
  return smoothstep(uDissipationParams.x, uDissipationParams.y, uNormalizedTime);
}

// 1 through the mature phase, easing to 0 by sourceTaperEnd so new source
// injection stops ahead of the final near-clearing state instead of
// continuing to top up the field while it is trying to dissipate.
float dissipationSourceTaper() {
  if (uDissipationMode < 0.5) return 1.0;
  return 1.0 - smoothstep(uDissipationParams.x, uDissipationParams2.x, uNormalizedTime);
}

// 1 through the mature phase, easing down to (1 - motionDamp) so residual
// plume-shaping motion (widening / feed / ring vortices) settles before the
// silhouette thins, instead of still actively churning at the final frame.
float dissipationMotionDamp() {
  if (uDissipationMode < 0.5) return 1.0;
  return mix(1.0, 1.0 - clamp(uDissipationParams2.w, 0.0, 0.98), dissipationProgress());
}

float dissipationVelocityRetention() {
  if (uDissipationMode < 0.5) return uProfileDecay.x;
  float target = clamp(uDissipationParams3.x, uProfileDecay.x, 1.0);
  return mix(uProfileDecay.x, target, dissipationProgress());
}

float profileCombinedKernelWithoutTrail(vec2 uv) {
  float result = profileBaseKernel(uv) * (sourceEnabled(SOURCE_RADIAL) ? 1.0 : 0.0);
  result = max(result, profileRingKernel(uv) * (sourceEnabled(SOURCE_RING) ? 1.0 : 0.0));
  result = max(result, profileGroundKernel(uv) * (sourceEnabled(SOURCE_GROUND) ? 1.0 : 0.0));
  result = max(result, profileVerticalKernel(uv) * (sourceEnabled(SOURCE_VERTICAL) ? 0.72 : 0.0));
  result = max(result, profileBaseKernel(uv) * (sourceEnabled(SOURCE_SUSTAINED) ? 1.15 : 0.0));
  result += profileMultiKernel(uv) * (sourceEnabled(SOURCE_MULTIPLE) ? 0.72 : 0.0);
  result += profileMultiKernel(uv) * (sourceEnabled(SOURCE_TURBULENT) ? 0.24 : 0.0);
  return clamp(result, 0.0, 2.2);
}

float profileCombinedKernel(vec2 uv) {
  float result = profileCombinedKernelWithoutTrail(uv);
  result = max(result, profileTrailKernel(uv) * (sourceEnabled(SOURCE_TRAIL) ? 1.0 : 0.0));
  return clamp(result, 0.0, 2.2);
}
`;

const ADVECT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
out vec4 outputValue;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform float uDt;
uniform vec4 uDecay;
${FIELD_SAMPLING}
void main() {
  vec2 velocity = sampleField(uVelocity, vUv).xy;
  vec2 previous = vUv - velocity * uDt;
  outputValue = sampleField(uSource, previous) * uDecay;
}`;

const CURL_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outputValue;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
${FIELD_SAMPLING}
void main() {
  float left = sampleField(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
  float right = sampleField(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
  float bottom = sampleField(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
  float top = sampleField(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
  float curl = 0.5 * ((right - left) - (top - bottom));
  outputValue = vec4(curl, abs(curl), 0.0, 1.0);
}`;

const FORCE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
in vec2 vUv;
out vec4 outputValue;
uniform sampler2D uVelocity;
uniform sampler2D uScalar;
uniform sampler2D uCurl;
uniform sampler3D uCurlDetail;
uniform vec2 uTexel;
uniform float uDt;
uniform float uTime;
uniform float uNormalizedTime;
uniform float uEnergy;
uniform float uBuoyancy;
uniform float uDensityLoading;
uniform float uVorticity;
uniform float uReducedMotion;
uniform vec2 uWind;
uniform vec2 uSourceCenter;
${SOURCE_PROFILE_UNIFORMS}
${FIELD_SAMPLING}
${DETAIL_SAMPLING}
${SOURCE_PROFILE_FUNCTIONS}
void main() {
  vec4 velocitySample = sampleField(uVelocity, vUv);
  vec2 velocity = velocitySample.xy;
  vec4 scalar = sampleField(uScalar, vUv);

  float temperature = scalar.r;
  float smoke = scalar.g;
  float incandescent = scalar.b;
  float dust = scalar.a;
  // Late-dissipation buoyancy falloff (inert unless uDissipationMode is set):
  // only the buoyant lift terms relax, not the density-loading sink, so the
  // cloud stops climbing and settles into drift instead of sinking unnaturally.
  float buoyancyFalloff = uDissipationMode > 0.5
    ? mix(1.0, 1.0 - clamp(uDissipationParams2.z, 0.0, 0.95), dissipationProgress())
    : 1.0;
  float buoyantLift = (temperature * uBuoyancy * uProfilePhysics.x + incandescent * 0.14) * buoyancyFalloff;
  float densitySink = smoke * uDensityLoading * uProfilePhysics.y
    + dust * uDensityLoading * uProfilePhysics.y * 1.7;
  float lift = buoyantLift - densitySink;
  velocity.y += lift * uDt;
  velocity += uWind * uDt * uProfilePhysics.z * (0.18 + smoke * 0.08);

  float curlCenter = sampleField(uCurl, vUv).r;
  float curlLeft = abs(sampleField(uCurl, vUv - vec2(uTexel.x, 0.0)).r);
  float curlRight = abs(sampleField(uCurl, vUv + vec2(uTexel.x, 0.0)).r);
  float curlBottom = abs(sampleField(uCurl, vUv - vec2(0.0, uTexel.y)).r);
  float curlTop = abs(sampleField(uCurl, vUv + vec2(0.0, uTexel.y)).r);
  vec2 curlGradient = vec2(curlRight - curlLeft, curlTop - curlBottom);
  float gradientLength = length(curlGradient);
  if (gradientLength > 0.00001) {
    vec2 direction = curlGradient / gradientLength;
    velocity += vec2(direction.y, -direction.x) * curlCenter * uVorticity * uProfilePhysics.w * uDt;
  }

  float motionScale = mix(1.0, 0.58, uReducedMotion);
  vec3 turbulence = decodeCurlDetail(sampleCurlDetail(
    uCurlDetail,
    vec3(vUv * vec2(4.7, 6.1) + vec2(uTime * 0.011, -uTime * 0.007), uTime * 0.009)
  ));
  float afterOnset = step(0.000001, uTime);
  float impulseEnvelope = exp(-uNormalizedTime * 36.0) * afterOnset;
  float rollingEnvelope = smoothstep(0.0, 0.025, uNormalizedTime)
    * (1.0 - smoothstep(0.28, 0.62, uNormalizedTime));
  vec2 sourceDelta = vUv - uSourceCenter;
  // The preserved low-yield branch historically used BASE_PROFILE.radius
  // (0.065) implicitly. Dividing by that neutral value lets its immutable
  // profile widen or narrow the source without changing the baseline formula
  // when the profile leaves radius untouched.
  float sourceRadius = (0.045 + 0.038 * sqrt(uEnergy))
    * (uSourceShape.x / 0.065);
  float sourceKernel = exp(-dot(sourceDelta, sourceDelta) / max(0.0005, sourceRadius * sourceRadius));

  if (uProfileKind == 9) {
    // Named profile path for Nuclear Airburst — Research Model. The original
    // centered impulse/updraft formula is preserved at neutral profile values;
    // source motion weights now let this one immutable profile rebalance
    // radial lift, vertical feed, and curl coupling without an ID check or a
    // global behavior change.
    vec2 radial = sourceDelta / max(length(sourceDelta), 0.006);
    float sourceFeedTaper = uPlumeMode > 1.5
      ? 1.0 - smoothstep(uPlumeStemParams.x, uPlumeStemParams.y, uNormalizedTime)
      : 1.0;
    velocity += radial * sourceKernel * impulseEnvelope * (0.46 + 0.16 * uEnergy)
      * uSourceMotion.x * motionScale * uDt * 60.0;
    velocity.y += sourceKernel * rollingEnvelope * (0.20 + 0.13 * uEnergy)
      * uSourceMotion.y * sourceFeedTaper * motionScale * uDt;
    velocity += turbulence.xy * sourceKernel * (impulseEnvelope + rollingEnvelope * 0.42)
      * 0.026 * (uSourceMotion.w / 0.65) * motionScale * uDt * 60.0;
  } else {
    vec2 primitiveCenter = profileSourceCenter();
    vec2 primitiveDelta = vUv - primitiveCenter;
    vec2 primitiveRadial = primitiveDelta / max(length(primitiveDelta), 0.006);
    vec2 direction = safeDirection(uSourceVector.xy);
    float onset = profileOnsetEnvelope();
    float sustain = profileSustainEnvelope() * dissipationSourceTaper();
    float pulse = (sourceEnabled(SOURCE_PULSED) || uProfileKind == 8)
      ? profilePulseEnvelope() : 1.0;
    float stage = profileStageEnvelope();
    float stagedImpact = sourceEnabled(SOURCE_TRAIL) && sourceEnabled(SOURCE_EJECTA)
      ? stage : 1.0;
    float entry = 1.0 - stage;
    float baseKernel = profileBaseKernel(vUv);
    float multiKernel = profileMultiKernel(vUv);
    float ringKernel = profileRingKernel(vUv);
    float groundKernel = profileGroundKernel(vUv);
    float verticalKernel = profileVerticalKernel(vUv);
    float trailKernel = profileTrailKernel(vUv);
    float ejectaKernel = profileEjectaKernel(vUv);
    float activeKernel = profileCombinedKernel(vUv);
    float radialWeight = baseKernel * (sourceEnabled(SOURCE_RADIAL) ? 1.0 : 0.0)
      + ringKernel * (sourceEnabled(SOURCE_RING) ? 0.72 : 0.0);
    velocity += primitiveRadial * radialWeight * onset * stagedImpact * uSourceMotion.x
      * (0.34 + 0.12 * uEnergy) * motionScale * uDt * 60.0;
    velocity += direction * trailKernel * entry * onset * uSourceMotion.z
      * 0.42 * motionScale * uDt * 60.0
      * (sourceEnabled(SOURCE_DIRECTIONAL) ? 1.0 : 0.0);
    velocity.y += verticalKernel * sustain * pulse * stagedImpact * uSourceMotion.y
      * 0.18 * motionScale * uDt
      * (sourceEnabled(SOURCE_VERTICAL) || sourceEnabled(SOURCE_PULSED) ? 1.0 : 0.0);
    float legacyGroundCoupling = uGroundCouplingMode > 0.5 ? 0.0 : 1.0;
    velocity.x += sign(primitiveDelta.x + uSeedOffsetsA.x * 0.04) * groundKernel
      * onset * stagedImpact * uSourceMotion.x * 0.18 * motionScale * uDt * 60.0
      * (sourceEnabled(SOURCE_GROUND) ? legacyGroundCoupling : 0.0);
    vec2 ejectaDirection = safeDirection(vec2(
      primitiveDelta.x * 1.25 + uSeedOffsetsB.x * 0.03,
      abs(primitiveDelta.y) + 0.12
    ));
    velocity += ejectaDirection * ejectaKernel * onset * stagedImpact * uSourceAux.y
      * 0.32 * motionScale * uDt * 60.0
      * (sourceEnabled(SOURCE_EJECTA) ? 1.0 : 0.0);
    float clusterActivity = (onset + sustain * 0.58) * pulse * stagedImpact;
    float clusterKernel = multiKernel * (
      (sourceEnabled(SOURCE_MULTIPLE) ? 0.65 : 0.0)
      + (sourceEnabled(SOURCE_TURBULENT) ? 0.45 : 0.0)
    );
    velocity += turbulence.xy * (activeKernel * 0.5 + clusterKernel)
      * clusterActivity * uSourceMotion.w * 0.025 * motionScale * uDt * 60.0;

    if (uGroundCouplingMode > 0.5 && sourceEnabled(SOURCE_GROUND)) {
      // A sustained, height-weighted surface outflow replaces the one-frame
      // symmetric sheet for the opted-in ground profile. Multiple seeded
      // frequencies vary the left/right lobes without drawing a permanent
      // ring, while the phase taper hands motion to the rising plume.
      // Smoke and dust share one resolved velocity field, so the lateral
      // surface impulse is weighted by the local particulate mix: dust keeps
      // the full ground-directed spread, while soot retains a narrower lift
      // corridor instead of becoming a wall-wide horizontal slab.
      float groundMaterialBias = clamp(
        dust / max(0.0001, dust + smoke),
        0.0,
        1.0
      );
      float groundFlowScale = mix(0.52, 1.0, groundMaterialBias);
      float heightAboveGround = max(0.0, vUv.y - uSourceShape.w);
      float heightScale = max(0.012, uSourceShape.x * uGroundCouplingA.y);
      float groundHeightWeight = exp(
        -heightAboveGround * heightAboveGround / (heightScale * heightScale)
      );
      float spreadPhase = smoothstep(
        uGroundCouplingB.x,
        uGroundCouplingB.x + 0.025,
        uNormalizedTime
      ) * (1.0 - smoothstep(
        uGroundCouplingB.y,
        uGroundCouplingB.y + 0.14,
        uNormalizedTime
      ));
      float groundDistance = abs(primitiveDelta.x) / max(0.01, uSourceShape.x);
      float seededLobes = 1.0 + uGroundCouplingB.z * (
        sin(groundDistance * 4.7 + uSeedOffsetsA.z * 4.1) * 0.58
        + sin(groundDistance * 9.3 - uSeedOffsetsB.y * 3.7) * 0.42
      );
      float sideBias = 1.0 + sign(primitiveDelta.x + 0.0001)
        * uGroundCouplingB.w * uSeedOffsetsA.x;
      float coupledGround = groundKernel * groundHeightWeight
        * (onset + sustain * 0.48) * spreadPhase;
      velocity.x += sign(primitiveDelta.x + uSeedOffsetsB.x * 0.018)
        * coupledGround * seededLobes * sideBias
        * uGroundCouplingA.x * uSourceMotion.x
        * 0.22 * groundFlowScale * motionScale * uDt * 60.0;
      // Suppress the vertical component only inside the surface layer. The
      // same field transitions into a modest off-center lift above it, so the
      // stem emerges from the base rather than detaching or forming a seam.
      velocity.y *= mix(1.0, uGroundCouplingA.w, groundHeightWeight * spreadPhase);
      float transitionBand = smoothstep(
        uSourceShape.w + uSourceShape.x * 0.3,
        uSourceShape.w + uSourceShape.x * 1.9,
        vUv.y
      ) * (1.0 - smoothstep(
        uSourceShape.w + uSourceShape.x * 4.0,
        uSourceShape.w + uSourceShape.x * 6.2,
        vUv.y
      ));
      velocity.y += activeKernel * transitionBand * sustain
        * uGroundCouplingC.z * motionScale * uDt;
      velocity += turbulence.xy * coupledGround * uGroundCouplingB.z
        * 0.01 * groundFlowScale * motionScale * uDt * 60.0;
    }
  }

  // A paired vortex ring in the vertical slice supplies the cap's toroidal
  // circulation: both inner branches rise, while the outer branches roll
  // downward and entrain nearby air. Projection keeps this field divergence
  // controlled; it is a normalized atmospheric motion cue, not a blast model.
  float capDevelopment = smoothstep(0.025, 0.34, uNormalizedTime);
  float capEnvelope = smoothstep(0.02, 0.09, uNormalizedTime)
    * (1.0 - smoothstep(0.72, 1.15, uNormalizedTime));
  float plumeActivity = clamp(
    temperature * 0.24 + smoke * 0.62 + incandescent * 0.34,
    0.0,
    1.0
  );
  // Once the plume leaves the source, the same deterministic 3D curl field
  // perturbs the resolved velocity rather than merely decorating the rendered
  // density. Advection therefore carries the asymmetry into the silhouette.
  float capEnabled = sourceEnabled(SOURCE_PAIRED_CAP) ? 1.0 : 0.0;
  velocity += turbulence.xy * plumeActivity * capEnvelope * capEnabled
    * 0.0045 * uDomainActiveScale * motionScale * uDt * 60.0;
  vec2 capCenter = uSourceCenter + vec2(
    uWind.x * capDevelopment * 0.42,
    mix(0.075, 0.43, capDevelopment)
  ) * uDomainActiveScale;
  // Profile-scaled cap geometry: capScale (uProfileAux.x) widens the paired
  // vortex separation and radius so large historical archetypes develop a
  // broader, deeper cap while the preserved research profile stays identical.
  float capGeometryScale = mix(1.0, uProfileAux.x, 0.55);
  float capHalfWidth = mix(0.052, 0.155, capDevelopment) * capGeometryScale * uDomainActiveScale;
  float vortexRadius = mix(0.055, 0.13, capDevelopment) * mix(1.0, uProfileAux.x, 0.4) * uDomainActiveScale;
  vec2 leftDelta = vUv - (capCenter - vec2(capHalfWidth, 0.0));
  vec2 rightDelta = vUv - (capCenter + vec2(capHalfWidth, 0.0));
  vec2 leftScaled = leftDelta / vec2(vortexRadius, vortexRadius * 0.82);
  vec2 rightScaled = rightDelta / vec2(vortexRadius, vortexRadius * 0.82);
  float leftWeight = exp(-dot(leftScaled, leftScaled));
  float rightWeight = exp(-dot(rightScaled, rightScaled));
  vec2 leftTangent = vec2(-leftDelta.y, leftDelta.x)
    / max(length(leftDelta), 0.004);
  vec2 rightTangent = vec2(rightDelta.y, -rightDelta.x)
    / max(length(rightDelta), 0.004);
  float circulation = (0.078 + 0.032 * uEnergy) * capEnvelope * motionScale
    * capEnabled * uProfileAux.x * uDomainActiveScale;
  velocity += (leftTangent * leftWeight + rightTangent * rightWeight)
    * circulation * uDt;

  // Gentle lateral inflow around the rising column makes entrainment legible;
  // the paired vortices above provide the corresponding outer return motion.
  float columnBand = smoothstep(uSourceCenter.y - 0.02 * uDomainActiveScale, uSourceCenter.y + 0.04 * uDomainActiveScale, vUv.y)
    * (1.0 - smoothstep(capCenter.y - 0.02 * uDomainActiveScale, capCenter.y + 0.08 * uDomainActiveScale, vUv.y));
  float sideDistance = abs(vUv.x - capCenter.x);
  float entrainment = exp(-sideDistance * sideDistance / max(0.002, capHalfWidth * capHalfWidth * 2.8));
  velocity.x += (capCenter.x - vUv.x) * columnBand * entrainment
    * capEnvelope * capEnabled * 0.19 * motionScale * uDt;

  // Stable-stratification ceiling: buoyant rise weakens with altitude and the
  // surviving upflow turns outward, so cap and umbrella structures develop
  // inside the simulated volume instead of piling flat against its upper
  // boundary. Normalized visual behavior only — not an atmospheric model.
  float ceilingJitter = turbulence.z * 0.07 * uDomainActiveScale;
  float ceiling = smoothstep(
    0.5 + (0.58 - 0.5) * uDomainActiveScale + ceilingJitter,
    0.5 + (0.88 - 0.5) * uDomainActiveScale + ceilingJitter,
    vUv.y
  );
  float upflow = max(velocity.y, 0.0);
  float ceilingRelax = min(1.0, 2.8 * uDt);
  velocity.y -= upflow * ceiling * ceilingRelax;
  velocity.x += sign(vUv.x - uSourceCenter.x + uSeedOffsetsA.y * 0.03 * uDomainActiveScale)
    * upflow * ceiling * 0.5 * ceilingRelax;
  // Outer umbrella roll: spread material at the stable ceiling curls gently
  // downward away from the stem, rounding the crown into cap vortices.
  float rimDistance = abs(vUv.x - uSourceCenter.x);
  velocity.y -= ceiling * smoothstep(0.09 * uDomainActiveScale, 0.26 * uDomainActiveScale, rimDistance)
    * (smoke + dust * 0.6) * 0.55 * uProfileAux.y * uDt;

  // ---- Profile-gated broad turbulent plume (research mechanism) ----
  // Inert unless uPlumeMode is set. Low-yield and Tsar opt in with separate
  // modes and magnitudes. Combines
  // three paper-grounded mechanisms to break the narrow rising tube into a
  // broad, coherent, asymmetric mushroom body:
  //   1. Gas-expansion outward turning (Nguyen/Fedkiw/Jensen 2002, Fig 6-7):
  //      reacting/rising material turns outward, giving visual fullness.
  //   2. A rising, scale-separated, ASYMMETRIC vortex-particle population
  //      (Selle/Rasmussen/Fedkiw 2005, Fig 2 recipe: vortices seeded tangent
  //      to an upward cylinder during expansion), evaluated analytically as a
  //      handful of Gaussian vortices so grid confinement has large-scale
  //      structure to sustain instead of amplifying nothing.
  //   3. Altitude-dependent column widening so the stem thickens with height.
  // All quantities are normalized visual motion cues — no blast/damage model.
  if (uPlumeMode > 0.5) {
    float plumeActivity = clamp(temperature * 0.2 + smoke * 0.72 + incandescent * 0.32, 0.0, 1.2);
    float heightAbove = clamp((vUv.y - uSourceCenter.y) / (0.52 * uDomainActiveScale), 0.0, 1.2);
    float lateral = vUv.x - uSourceCenter.x;
    float lateralSign = sign(lateral + uSeedOffsetsA.x * 0.015 * uDomainActiveScale + 0.0001);
    // Late-dissipation motion damp: relaxes residual widening/feed/ring
    // vortex forces toward rest so the silhouette settles before it thins.
    // Always 1.0 unless uDissipationMode is set.
    float motionDamp = dissipationMotionDamp();

    // 1 + 3 · Expansion / column widening: outward push that grows with
    // altitude, weighted by local plume presence, so a cauliflower body and a
    // thick stem develop instead of a pencil column. This must fade out once
    // the cap has formed — an unbounded per-step outward force integrated
    // over a long timeline keeps diluting the same mass across an
    // ever-larger area, thinning the cloud toward invisibility instead of
    // leaving a broad, persistent silhouette. developPhase confines the
    // active widening to cap formation; feedPhase keeps the stem fed a
    // little longer before also relaxing.
    float developPhase = smoothstep(0.02, 0.14, uNormalizedTime)
      * (1.0 - smoothstep(0.55, 0.9, uNormalizedTime));
    // Stem taper/breakup (uPlumeStemParams: feedTaperStart, feedTaperEnd,
    // lateralJitter, turbulenceBlend). The audited seam came from coreBand
    // staying centered at lateral=0 and fully fed almost to the end of the
    // timeline (old hardcoded 0.85-1.05 taper) — a single deterministic
    // narrow band reads as a straight structural line rather than organic
    // turbulence, especially since this is a 2D density field (no depth
    // slices to decorrelate it across). feedTaperStart/End move that taper
    // to right after cap formation instead. stemBreakup ramps up in the runup
    // to the taper and stays engaged through it: it offsets the corridor off
    // dead-center using the same curl-detail turbulence sample already
    // computed above (free — no extra texture read), widens the band while
    // its own feedPhase strength is easing down, and blends a portion of
    // that turbulence directly into the corridor's velocity so the feed
    // hands off to organic motion instead of just switching off.
    float feedTaperStart = uPlumeStemParams.x;
    float feedTaperEnd = uPlumeStemParams.y;
    float feedPhase = smoothstep(0.02, 0.1, uNormalizedTime)
      * (1.0 - smoothstep(feedTaperStart, feedTaperEnd, uNormalizedTime));
    float stemBreakup = smoothstep(feedTaperStart * 0.45, feedTaperStart, uNormalizedTime);
    float widenBand = smoothstep(0.015, 0.12, heightAbove)
      * (1.0 - smoothstep(0.85, 1.15, heightAbove));
    float expansion = plumeActivity * widenBand
      * (0.35 + heightAbove * 0.85) * developPhase;
    velocity.x += lateralSign * expansion * uPlumeParams.x * motionScale * uDt * 60.0 * motionDamp;
    // A gentle upward feed inside the widened core keeps the stem continuous
    // with the cap rather than pinching off early. lateralOffset decorrelates
    // the corridor away from a perfectly fixed x=0 line as breakup ramps up;
    // widthGrow relaxes the band from a narrow column into a broader, softer
    // one over the same window instead of holding one fixed width until it
    // simply cuts off.
    float corridorAsymmetry = uSeedOffsetsA.x * 0.24 * (0.4 + 0.6 * heightAbove);
    float groundStemDrift = uGroundCouplingMode > 0.5
      ? (uSeedOffsetsB.x * 0.055 + turbulence.x * 0.018) * uDomainActiveScale
        * (1.0 - smoothstep(0.62, 1.1, heightAbove))
      : 0.0;
    float lateralOffset = (turbulence.z + corridorAsymmetry)
      * uPlumeStemParams.z * stemBreakup;
    float coreLateral = lateral - lateralOffset - groundStemDrift;
    float widthGrow = mix(1.0, 2.4, stemBreakup);
    if (uGroundCouplingMode > 0.5) {
      // The ground column begins as a broad, heavy base and narrows only
      // modestly as it hands material into the cap. This is distinct from the
      // compact Airburst corridor and avoids a tornado-like stem.
      widthGrow *= mix(1.6, 1.08, smoothstep(0.12, 0.82, heightAbove));
    }
    float coreBand = exp(
      -coreLateral * coreLateral
      / max(0.004, uSourceShape.x * uSourceShape.x * 9.0 * widthGrow * widthGrow)
    );
    float groundFeedWeight = uGroundCouplingMode > 0.5
      ? mix(1.28, 0.86, smoothstep(0.08, 0.9, heightAbove))
      : 1.0;
    velocity.y += coreBand * plumeActivity * uPlumeParams.w * groundFeedWeight
      * (0.4 + 0.6 * (1.0 - heightAbove)) * feedPhase * motionScale * uDt * 30.0 * motionDamp;
    // Medium-scale turbulence reaching into the central corridor specifically
    // (rather than only the generic vortex-ring/cluster terms elsewhere) so
    // the column develops internal asymmetric motion as it breaks up, instead
    // of thinning out as one smooth, still-coherent taper.
    velocity += turbulence.xy * coreBand * plumeActivity
      * uPlumeStemParams.w * stemBreakup * motionScale * uDt * 60.0 * motionDamp;

    // 2 · Rising asymmetric vortex-particle ring. A small set of analytic
    // Gaussian vortices climbs with the plume; seeded offsets make radii,
    // heights and strengths unequal so the silhouette rolls asymmetrically
    // and never shows two mirrored curls.
    // Vortex positions are transformed as a complete offset below. Keeping
    // ringRise in the source coordinate system avoids applying the padded
    // domain scale twice to its vertical motion.
    float ringRise = mix(0.08, 0.46, smoothstep(0.02, 0.5, uNormalizedTime));
    float ringLife = smoothstep(0.015, 0.08, uNormalizedTime)
      * (1.0 - smoothstep(0.72, 1.15, uNormalizedTime));
    float ringStrength = uPlumeParams.y * ringLife * motionScale * motionDamp;
    if (ringStrength > 0.0001) {
      // Four vortices: two forming the primary cap torus (unequal), two
      // smaller secondary rolls higher up. Offsets come from the existing
      // deterministic seed vectors, so replay is exact.
      vec4 vxA = vec4( 0.11 + uSeedOffsetsA.y * 0.03,  ringRise + uSeedOffsetsA.z * 0.05,  1.00, 0.085);
      vec4 vxB = vec4(-0.13 + uSeedOffsetsA.w * 0.03,  ringRise + uSeedOffsetsB.x * 0.05, -0.86, 0.10);
      vec4 vxC = vec4( 0.07 + uSeedOffsetsB.y * 0.025, ringRise + 0.14 + uSeedOffsetsB.z * 0.04,  0.62, 0.06);
      vec4 vxD = vec4(-0.06 + uSeedOffsetsB.w * 0.025, ringRise + 0.17 + uSeedOffsetsA.x * 0.04, -0.54, 0.055);
      vec2 acc = vec2(0.0);
      for (int i = 0; i < 4; i++) {
        vec4 vtx = i == 0 ? vxA : i == 1 ? vxB : i == 2 ? vxC : vxD;
        vec2 center = uSourceCenter + vec2(vtx.x, vtx.y) * uDomainActiveScale;
        vec2 d = vUv - center;
        float r2 = vtx.w * vtx.w * uDomainActiveScale * uDomainActiveScale;
        float w = exp(-dot(d, d) / max(0.0006, r2));
        vec2 tangent = vec2(-d.y, d.x) / max(length(d), 0.004);
        acc += tangent * (vtx.z * w);
      }
      velocity += acc * ringStrength * (0.06 + 0.03 * uEnergy) * uDomainActiveScale * uDt * 60.0;
    }
    float speedCap = length(velocity);
    if (speedCap > 1.55) velocity *= 1.55 / speedCap;
  }

  // Late-dissipation outward dispersion (inert unless uDissipationMode is
  // set): a gentle radial push that grows only during the dissipation ramp,
  // helping the cloud fragment and spread into thin wisps instead of holding
  // together as a single coherent mass while it loses density.
  if (uDissipationMode > 0.5) {
    float outwardProgress = dissipationProgress();
    if (outwardProgress > 0.0005) {
      vec2 fromCenter = vUv - uSourceCenter;
      vec2 outwardDir = fromCenter / max(length(fromCenter), 0.02);
      velocity += outwardDir * uDissipationParams2.y * outwardProgress * uDomainActiveScale * motionScale * uDt * 0.6;

      if (uGroundCouplingMode > 0.5) {
        // Ground dust keeps a weak horizontal tail after the main radial
        // impulse has ended. Height weighting prevents this from pushing the
        // elevated cap outward or manufacturing new late smoke.
        float lateGroundHeight = exp(
          -pow(max(0.0, vUv.y - uSourceShape.w)
            / max(0.012, uSourceShape.x * uGroundCouplingA.y * 1.35), 2.0)
        );
        velocity.x += sign(fromCenter.x + uSeedOffsetsB.w * 0.012)
          * lateGroundHeight * uGroundCouplingC.w * outwardProgress
          * (0.5 + dust * 0.5) * uDomainActiveScale * motionScale * uDt;
        velocity.y *= mix(1.0, 0.82, lateGroundHeight * outwardProgress);
      }

      // The scalar-loss tail must remain a real flow, not a frozen density
      // field whose opacity is merely reduced. A broad seed-stable roll plus
      // altitude-aware shear keeps existing late mass exchanging positions
      // without sourcing new density or disturbing mature cap formation.
      float lateMaterial = smoothstep(0.018, 0.14, smoke + dust * 0.45);
      float slowPhase = uTime * uDissipationParams3.w + uSeedOffsetsB.z * 6.28318530718;
      vec2 broadCurl = vec2(
        sin((vUv.y - uSourceCenter.y) * 5.4 + slowPhase),
        -sin((vUv.x - uSourceCenter.x) * 4.8 - slowPhase * 0.73)
      );
      velocity += broadCurl * uDissipationParams3.y * lateMaterial * uDomainActiveScale
        * outwardProgress * motionScale * uDt * 60.0;
      float heightShear = clamp((vUv.y - uSourceCenter.y) / 0.58, 0.0, 1.0) - 0.42;
      velocity.x += heightShear * (0.55 + 0.45 * sin(slowPhase + vUv.y * 3.1)) * uDomainActiveScale
        * uDissipationParams3.z * lateMaterial * outwardProgress
        * motionScale * uDt * 60.0;
    }
  }

  float retainedVelocity = dissipationVelocityRetention();
  if (uGroundCouplingMode > 0.5) {
    float nearGround = exp(
      -pow(max(0.0, vUv.y - uSourceShape.w)
        / max(0.012, uSourceShape.x * uGroundCouplingA.y), 2.0)
    );
    float horizontalRetention = mix(
      retainedVelocity,
      max(retainedVelocity, uGroundCouplingA.z),
      nearGround
    );
    velocity.x *= pow(clamp(horizontalRetention, 0.9, 1.0), uDt * 60.0);
    velocity.y *= pow(clamp(retainedVelocity, 0.9, 1.0), uDt * 60.0);
  } else {
    velocity *= pow(clamp(retainedVelocity, 0.9, 1.0), uDt * 60.0);
  }
  velocity *= boundaryMask(vUv);
  float speed = length(velocity);
  if (speed > 1.4) velocity *= 1.4 / speed;
  outputValue = vec4(velocity, 0.0, 1.0);
}`;

const SCALAR_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
in vec2 vUv;
out vec4 outputValue;
uniform sampler2D uScalar;
uniform sampler3D uCurlDetail;
uniform float uDt;
uniform float uTime;
uniform float uNormalizedTime;
uniform float uEnergy;
uniform float uSourceStrength;
uniform float uCooling;
uniform float uSmokeConversion;
uniform float uDissipation;
uniform float uReducedMotion;
uniform vec2 uSourceCenter;
${SOURCE_PROFILE_UNIFORMS}
${FIELD_SAMPLING}
${DETAIL_SAMPLING}
${SOURCE_PROFILE_FUNCTIONS}
void main() {
  vec4 scalar = max(sampleField(uScalar, vUv), vec4(0.0));
  float temperature = scalar.r;
  float smoke = scalar.g;
  float incandescent = scalar.b;
  float dust = scalar.a;

  float conversion = incandescent * (1.0 - exp(-uSmokeConversion * uProfileDecay.z * uDt));
  incandescent = max(0.0, incandescent - conversion);
  smoke += conversion * 0.72;
  float normalizedHeat = clamp(temperature * 0.5, 0.0, 1.5);
  float radiativeLoss = uCooling * uProfileDecay.y * uDt * 0.18 * pow(normalizedHeat, 4.0);
  temperature = max(0.0,
    temperature * exp(-uCooling * uProfileDecay.y * uDt * (0.42 + smoke * 0.08)) - radiativeLoss
  );
  // Profile persistence (uPlumeParams.z): an opted-in cloud may retain visible
  // mass across its mature phase, so smoke dissipation is nudged toward unity
  // by a preset-specific amount (inert elsewhere). Deferred
  // dissipation is a documented CG smoke technique (Fedkiw/Stam/Jensen 2001:
  // low numerical dissipation keeps large plumes alive). The persistence
  // TARGET itself eases from 1.0 down to a real per-step floor once the
  // late-dissipation ramp begins (uDissipationParams.z), so the mature phase
  // is byte-identical to before this pass and only the tail actually decays.
  float dissipationT = dissipationProgress();
  float smokeRetention = uDissipation * uProfileDecay.w;
  if (uPlumeMode > 0.5) {
    float persistenceTarget = uDissipationMode > 0.5
      ? mix(1.0, uDissipationParams.z, dissipationT)
      : 1.0;
    smokeRetention = mix(smokeRetention, persistenceTarget, clamp(uPlumeParams.z, 0.0, 0.9));
  }
  smoke *= pow(clamp(smokeRetention, 0.9, 1.0), uDt * 60.0);
  // Lofted dust gets its own late-dissipation floor (uDissipationParams.w),
  // tuned lower than smoke's so dust clears/settles first — the two fields no
  // longer share one decay curve.
  float dustRetention = uDissipation * uProfileDecay.w - 0.0015;
  if (uDissipationMode > 0.5) dustRetention = mix(dustRetention, uDissipationParams.w, dissipationT);
  dust *= pow(clamp(dustRetention, 0.8, 1.0), uDt * 60.0);
  incandescent *= exp(-uCooling * uProfileDecay.y * uDt * 1.65);

  // Open-boundary guard band: material entering the outer side/top margins is
  // absorbed instead of piling against the domain wall, so the plume can
  // never form a flat wall-shaped silhouette. The ground boundary is exempt —
  // surface interaction keeps its material.
  // The top margin absorbs far more gently than the sides so a developed cap
  // resting near the stratification ceiling persists through the late
  // timeline instead of being silently destroyed.
  // Mode 1 is the historical-scale variant. Its cap spreads wider and higher
  // than other events, so its side/top guard bands are narrowed; mode 2
  // (low-yield shaping) deliberately retains the normal absorbing boundary.
  float historicalBoundary = step(0.5, uPlumeMode) * (1.0 - step(1.5, uPlumeMode));
  float sideMargin = mix(0.12, 0.075, historicalBoundary);
  float topMargin = mix(0.055, 0.035, historicalBoundary);
  float sideGuard = smoothstep(0.0, sideMargin, vUv.x)
    * smoothstep(0.0, sideMargin, 1.0 - vUv.x);
  float topGuard = smoothstep(0.0, topMargin, 1.0 - vUv.y);
  float topRetain = mix(0.965, 0.985, historicalBoundary);
  float guardRetention = mix(pow(0.8, uDt * 60.0), 1.0, sideGuard)
    * mix(pow(topRetain, uDt * 60.0), 1.0, topGuard);
  temperature *= guardRetention;
  smoke *= guardRetention;
  incandescent *= guardRetention;
  dust *= guardRetention;

  float afterOnset = step(0.000001, uTime);
  float flashEnvelope = exp(-uNormalizedTime * 54.0) * afterOnset;
  float fireEnvelope = smoothstep(0.0, 0.012, uNormalizedTime)
    * (1.0 - smoothstep(0.18, 0.43, uNormalizedTime));
  float smokeEnvelope = smoothstep(0.015, 0.08, uNormalizedTime)
    * (1.0 - smoothstep(0.42, 0.82, uNormalizedTime));
  vec2 delta = vUv - uSourceCenter;
  // As in FORCE_FRAGMENT, 0.065 is the preserved branch's neutral source
  // radius. The ratio is exactly 1 for the old profile and only changes when
  // that profile explicitly supplies a new source width.
  float radius = (0.042 + 0.044 * sqrt(uEnergy))
    * (uSourceShape.x / 0.065);
  float core = exp(-dot(delta, delta) / max(0.0005, radius * radius));
  float shellDistance = abs(length(delta) - radius * (1.2 + uNormalizedTime * 2.2));
  float shell = exp(-shellDistance * shellDistance / max(0.0002, radius * radius * 0.18));
  float sourceDetail = sampleCurlDetail(
    uCurlDetail,
    vec3(vUv * vec2(6.3, 8.1) + vec2(uTime * 0.009, 0.0), uTime * 0.006)
  ).a * 2.0 - 1.0;
  float spectral = 0.78 + sourceDetail * 0.32;
  float motionScale = mix(1.0, 0.72, uReducedMotion);
  float source = max(0.0, uSourceStrength * spectral * motionScale);

  if (uProfileKind == 9) {
    // Preserve the established Research Model scalar branch, with its neutral
    // values reducing exactly to the original injection. Profile scalar
    // weights provide low-yield-only heat/material separation, while the
    // existing shockwave block adds subordinate bands without entering
    // generic shader logic by preset ID.
    float corridorWander = uSeedOffsetsA.x * uPlumeStemParams.z
      * smoothstep(0.06, 0.18, uNormalizedTime) * 0.1;
    vec2 lowYieldDelta = delta - vec2(corridorWander, 0.0);
    float lowYieldCore = exp(
      -dot(lowYieldDelta, lowYieldDelta) / max(0.0005, radius * radius)
    );
    float lateSmoke = smoothstep(0.05, 0.13, uNormalizedTime)
      * (1.0 - smoothstep(0.5, 0.92, uNormalizedTime));
    // Reuse the source-detail sample as deterministic low-yield thermal
    // pockets. The previous preserved source multiplied one smooth Gaussian
    // by a narrow 0.46–1.10 spectral range every step, which diffused into a
    // flat uniformly white orb. This wider, profile-weighted modulation
    // leaves a white-hot center but opens orange and shadowed pockets without
    // another texture read or any change to generic/Tsar source injection.
    float thermalPockets = clamp(
      0.68 + sourceDetail * 0.58 * (uSourceMotion.w / 0.65),
      0.12,
      1.35
    );
    float thermalStructure = thermalPockets * thermalPockets * thermalPockets;
    temperature += source * lowYieldCore * thermalStructure * (flashEnvelope * 2.2 + fireEnvelope * 0.42)
      * uSourceScalar.x * uDt * 8.0;
    incandescent += source * lowYieldCore * thermalPockets * (flashEnvelope * 1.5 + fireEnvelope * 0.7)
      * uSourceScalar.z * uDt * 3.4;
    smoke += source * lowYieldCore * lateSmoke * uSourceScalar.y * uDt * 0.8;

    // The preserved branch predates profileShockwaveLayers(). Calling the
    // shared helper here keeps the approved explicit low-yield rings
    // byte-for-byte. Dense mode 2 adds no further scalar terms; its contour
    // family is composited in the volume pass, where real accumulated
    // transmittance hides rear/internal segments behind opaque smoke.
    float secondaryRings = profileShockwaveLayers(vUv);
    temperature += source * secondaryRings * uDt * 0.34;
    incandescent += source * secondaryRings * uDt * 0.12;
    smoke += source * secondaryRings * uDt * 0.035;

    // The dust shell is a generic visual interaction cue. Airburst altitude keeps
    // it deliberately subordinate to the rising thermal/smoke volume.
    float lowerRegion = 1.0 - smoothstep(uSourceCenter.y + 0.12, uSourceCenter.y + 0.34, vUv.y);
    dust += source * shell * lowerRegion * smokeEnvelope
      * (uSourceScalar.w / 0.4) * uDt * 0.12;
  } else {
    float onset = profileOnsetEnvelope();
    float sustain = profileSustainEnvelope() * dissipationSourceTaper();
    float stage = profileStageEnvelope();
    float pulse = (sourceEnabled(SOURCE_PULSED) || uProfileKind == 8)
      ? profilePulseEnvelope() : 1.0;
    float combined = profileCombinedKernel(vUv);
    float withoutTrail = profileCombinedKernelWithoutTrail(vUv);
    float multi = profileMultiKernel(vUv);
    float ground = profileGroundKernel(vUv);
    float ejecta = profileEjectaKernel(vUv);
    float trail = profileTrailKernel(vUv);
    float sourceRing = profileRingKernel(vUv);
    float shockwaveLayers = profileShockwaveLayers(vUv);
    float combustion = sourceEnabled(SOURCE_SUSTAINED) ? sustain : fireEnvelope;
    float hotEnvelope = onset * 1.45 + combustion * pulse * 0.72;
    float matterEnvelope = sustain * (0.35 + pulse * 0.65);
    float stagedImpact = sourceEnabled(SOURCE_TRAIL) && sourceEnabled(SOURCE_EJECTA)
      ? stage : 1.0;
    float entry = 1.0 - stage;
    float stagedTrail = sourceEnabled(SOURCE_TRAIL)
      ? trail * (sourceEnabled(SOURCE_EJECTA) ? entry : mix(1.0, entry, 0.65))
      : 0.0;
    float stagedCombined = sourceEnabled(SOURCE_TRAIL) && sourceEnabled(SOURCE_EJECTA)
      ? clamp(withoutTrail * stagedImpact + stagedTrail, 0.0, 2.2)
      : combined;
    float thermalKernel = clamp(
      stagedCombined
        + sourceRing * (sourceEnabled(SOURCE_RING) ? 0.5 : 0.0)
        + shockwaveLayers * 0.5
        + stagedTrail * 0.72,
      0.0,
      2.4
    );
    float particulateKernel = clamp(
      stagedCombined * 0.55
        + multi * (
          (sourceEnabled(SOURCE_MULTIPLE) ? 0.45 : 0.0)
          + (sourceEnabled(SOURCE_TURBULENT) ? 0.18 : 0.0)
        ) * stagedImpact
        + ground * (sourceEnabled(SOURCE_GROUND) ? 0.8 : 0.0) * stagedImpact
        + ejecta * uSourceAux.y * (sourceEnabled(SOURCE_EJECTA) ? 1.0 : 0.0) * stagedImpact,
      0.0,
      2.8
    );
    if (uGroundCouplingMode > 0.5) {
      // Keep the surface flash broad but short-lived and irregular; do not
      // feed the whole ground sheet through the same high-temperature kernel
      // as the vertical plume. The base/offset kernels supply the hot core,
      // while the ground and ejecta kernels primarily supply particulate
      // material. This is the white-barrel fix and is inert for all other
      // profiles.
      float seededThermalPockets = clamp(
        0.62 + sourceDetail * 0.64
          + sin((vUv.x - uSourceCenter.x) * 31.0 + uSeedOffsetsA.w * 5.2) * 0.18,
        0.12,
        1.38
      );
      float groundRipple = uSourceShape.x * (
        sourceDetail * 0.24
          + sin((vUv.x - uSourceCenter.x) * 38.0 + uSeedOffsetsB.z * 4.8) * 0.12
      );
      float irregularGround = max(
        ground * 0.28,
        profileGroundKernel(vUv + vec2(0.0, groundRipple))
      );
      float structuredCore = clamp(
        profileBaseKernel(vUv)
          + multi * 0.35
          + profileVerticalKernel(vUv) * 0.04,
        0.0,
        1.5
      );
      float groundFlashEnvelope = exp(
        -uNormalizedTime / 0.022
      ) * step(0.000001, uTime);
      float surfaceFlash = irregularGround * groundFlashEnvelope * uGroundCouplingC.x
        * seededThermalPockets;
      float groundHotEnvelope = onset * 1.2
        + combustion * pulse * 0.32
          * (1.0 - smoothstep(0.12, 0.32, uNormalizedTime));
      float risingHeat = structuredCore * groundHotEnvelope
        * seededThermalPockets;
      temperature += source * (risingHeat + surfaceFlash * 2.3)
        * uSourceScalar.x * uDt * 1.65;
      incandescent += source * (
        risingHeat * 0.72 + surfaceFlash * 1.15
      ) * uSourceScalar.z * uDt * 1.2;
      smoke += source * clamp(
        structuredCore * 0.72 + multi * 0.38 + irregularGround * 0.16,
        0.0,
        2.0
      ) * matterEnvelope * uSourceScalar.y * uDt * 0.88;
      dust += source * clamp(
        irregularGround * uGroundCouplingC.y
          + ejecta * uSourceAux.y
          + multi * 0.46
          + structuredCore * 0.22,
        0.0,
        3.0
      ) * matterEnvelope * uSourceScalar.w * uDt * 0.7;
    } else {
      temperature += source * thermalKernel * hotEnvelope * uSourceScalar.x * uDt * 3.2;
      incandescent += source * thermalKernel * hotEnvelope * uSourceScalar.z * uDt * 2.4;
      smoke += source * stagedCombined * matterEnvelope * uSourceScalar.y * uDt * 0.92;
      dust += source * particulateKernel * matterEnvelope * uSourceScalar.w * uDt * 0.72;
    }
  }

  outputValue = clamp(vec4(temperature, smoke, incandescent, dust), 0.0, 4.0);
}`;

const DIVERGENCE_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outputValue;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
${FIELD_SAMPLING}
void main() {
  vec2 left = sampleField(uVelocity, vUv - vec2(uTexel.x, 0.0)).xy;
  vec2 right = sampleField(uVelocity, vUv + vec2(uTexel.x, 0.0)).xy;
  vec2 bottom = sampleField(uVelocity, vUv - vec2(0.0, uTexel.y)).xy;
  vec2 top = sampleField(uVelocity, vUv + vec2(0.0, uTexel.y)).xy;
  float divergence = 0.5 * ((right.x - left.x) + (top.y - bottom.y));
  outputValue = vec4(divergence, 0.0, 0.0, 1.0);
}`;

const JACOBI_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outputValue;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
${FIELD_SAMPLING}
void main() {
  float left = sampleField(uPressure, vUv - vec2(uTexel.x, 0.0)).r;
  float right = sampleField(uPressure, vUv + vec2(uTexel.x, 0.0)).r;
  float bottom = sampleField(uPressure, vUv - vec2(0.0, uTexel.y)).r;
  float top = sampleField(uPressure, vUv + vec2(0.0, uTexel.y)).r;
  float divergence = sampleField(uDivergence, vUv).r;
  float pressure = (left + right + bottom + top - divergence) * 0.25;
  outputValue = vec4(pressure, 0.0, 0.0, 1.0);
}`;

const PROJECT_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outputValue;
uniform sampler2D uVelocity;
uniform sampler2D uPressure;
uniform vec2 uTexel;
${FIELD_SAMPLING}
void main() {
  float left = sampleField(uPressure, vUv - vec2(uTexel.x, 0.0)).r;
  float right = sampleField(uPressure, vUv + vec2(uTexel.x, 0.0)).r;
  float bottom = sampleField(uPressure, vUv - vec2(0.0, uTexel.y)).r;
  float top = sampleField(uPressure, vUv + vec2(0.0, uTexel.y)).r;
  vec2 velocity = sampleField(uVelocity, vUv).xy;
  velocity -= vec2(right - left, top - bottom) * 0.5;
  velocity *= boundaryMask(vUv);
  outputValue = vec4(velocity, 0.0, 1.0);
}`;

// Debug metrics are encoded into an RGBA8 framebuffer before readback. This
// keeps readPixels deterministic across rgba16f and rgba32f solver targets
// without depending on implementation-specific floating-point read formats.
const METRICS_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outputValue;
uniform sampler2D uVelocity;
uniform sampler2D uScalar;
uniform sampler2D uCurl;
${FIELD_SAMPLING}
void main() {
  vec2 velocity = sampleField(uVelocity, vUv).xy;
  vec4 scalar = max(sampleField(uScalar, vUv), vec4(0.0));
  float vorticity = abs(sampleField(uCurl, vUv).r);
  outputValue = vec4(
    clamp(length(velocity) / 1.4, 0.0, 1.0),
    clamp(scalar.r / 4.0, 0.0, 1.0),
    clamp((scalar.g * 0.9 + scalar.a * 0.72) / 4.0, 0.0, 1.0),
    clamp(vorticity / 1.4, 0.0, 1.0)
  );
}`;

const TRACER_ADVECT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
in vec2 vUv;
out vec4 outputValue;
uniform sampler2D uTracers;
uniform sampler2D uVelocity;
uniform sampler3D uCurlDetail;
uniform float uDt;
uniform float uTime;
uniform float uNormalizedTime;
uniform float uReducedMotion;
uniform vec2 uSourceCenter;
uniform uint uSeed;
uniform int uTracerType;
${SOURCE_PROFILE_UNIFORMS}
${FIELD_SAMPLING}
${SEEDED_HASH}
${DETAIL_SAMPLING}
${SOURCE_PROFILE_FUNCTIONS}

float tracerRandom(uint index, uint generation, uint salt) {
  uint value = index * 0x9e3779b9u;
  value ^= generation * 0x85ebca6bu;
  value ^= uSeed + salt * 0xc2b2ae35u;
  return float(mixBits(value)) / 4294967295.0;
}

void main() {
  uint index = uint(gl_FragCoord.x);
  vec4 state = texelFetch(uTracers, ivec2(int(index), 0), 0);
  uint generation = uint(max(0.0, floor(state.w + 0.5)));
  float lifetimeScale = uTracerType == 4 || uTracerType == 5 ? 1.5 : (uTracerType == 6 ? 0.62 : 1.0);
  // Late-dissipation tracer taper (inert unless uDissipationMode is set):
  // shortens tracer lifetime as the volume clears so particles age out and
  // no longer dominate the frame once the smoke itself has thinned.
  float tracerDissipation = uDissipationMode > 0.5 ? mix(1.0, 0.35, dissipationProgress()) : 1.0;
  float lifetime = mix(1.7, 4.8, tracerRandom(index, generation, 7u)) * lifetimeScale * tracerDissipation;
  bool invalid = state.w < 0.5
    || state.z + uDt >= lifetime
    || any(lessThan(state.xy, vec2(0.012)))
    || any(greaterThan(state.xy, vec2(0.988)));

  if (invalid) {
    generation = state.w < 0.5 ? 1u : generation + 1u;
    float angle = 6.28318530718 * tracerRandom(index, generation, 11u);
    float radius = mix(0.008, 0.074, sqrt(tracerRandom(index, generation, 17u)));
    vec2 ellipse = vec2(cos(angle), sin(angle) * 0.72);
    vec2 center = profileSourceCenter();
    vec2 position = center + ellipse * radius;
    float randomAlong = tracerRandom(index, generation, 23u) * 2.0 - 1.0;
    float randomAcross = tracerRandom(index, generation, 29u) * 2.0 - 1.0;
    uint sourceLane = index & 3u;
    bool stagedImpact = sourceEnabled(SOURCE_TRAIL) && sourceEnabled(SOURCE_EJECTA);
    bool entryActive = uNormalizedTime < uSourceTiming.w + 0.028;
    bool useTrail = sourceEnabled(SOURCE_TRAIL)
      && ((stagedImpact && entryActive) || (!stagedImpact && sourceLane < 2u));
    if (uProfileKind != 9 && useTrail) {
      vec2 direction = safeDirection(uSourceVector.xy);
      vec2 normal = vec2(-direction.y, direction.x);
      position = center - direction * abs(randomAlong) * uSourceShape.x * uSourceAux.z
        + normal * randomAcross * uSourceShape.x * 0.34;
    } else if (uProfileKind != 9 && sourceEnabled(SOURCE_EJECTA)
      && (sourceLane == 0u || (sourceLane == 3u && !sourceEnabled(SOURCE_MULTIPLE)))) {
      position = vec2(
        center.x + randomAlong * uSourceShape.x * (2.2 + uSourceAux.y),
        uSourceShape.w + abs(randomAcross) * uSourceShape.x * 0.46
      );
    } else if (uProfileKind != 9 && sourceEnabled(SOURCE_GROUND) && sourceLane == 1u) {
      position = vec2(
        center.x + randomAlong * uSourceShape.x * 3.2,
        uSourceShape.w + abs(randomAcross) * uSourceShape.x * 0.14
      );
    } else if (uProfileKind != 9 && (sourceEnabled(SOURCE_VERTICAL) || sourceEnabled(SOURCE_PULSED))
      && sourceLane == 2u) {
      position = vec2(
        center.x + randomAcross * uSourceShape.x * 0.42,
        mix(uSourceShape.w, center.y + uSourceShape.x * 1.8, tracerRandom(index, generation, 31u))
      );
    } else if (uProfileKind != 9 && sourceEnabled(SOURCE_RING) && sourceLane < 3u) {
      float ringRadius = uSourceShape.x * uSourceAux.x;
      position = center + vec2(cos(angle), sin(angle) * uSourceShape.z) * ringRadius;
    } else if (uProfileKind != 9
      && (sourceEnabled(SOURCE_MULTIPLE) || sourceEnabled(SOURCE_TURBULENT))) {
      vec2 chosenOffset = (index & 1u) == 0u ? uSeedOffsetsA.xy : uSeedOffsetsA.zw;
      position = center + chosenOffset * uSourceShape.x * uSourceAux.w + ellipse * radius * 0.58;
    } else if (uProfileKind != 9 && (sourceEnabled(SOURCE_VERTICAL) || sourceEnabled(SOURCE_PULSED))) {
      position = vec2(
        center.x + randomAcross * uSourceShape.x * 0.42,
        mix(uSourceShape.w, center.y + uSourceShape.x * 1.8, tracerRandom(index, generation, 31u))
      );
    }
    position = clamp(position, vec2(0.015), vec2(0.985));
    outputValue = vec4(position, 0.0, float(generation));
    return;
  }

  vec2 velocity = sampleField(uVelocity, state.xy).xy;
  float tracerPhase = float((index * 47u + generation * 131u) & 1023u) / 1023.0;
  vec2 detailCurl = decodeCurlDetail(sampleCurlDetail(
    uCurlDetail,
    vec3(
      state.xy * vec2(7.1, 9.3) + vec2(uTime * 0.013, -uTime * 0.008),
      tracerPhase + uTime * 0.007
    )
  )).xy;
  float motionScale = mix(1.0, 0.5, uReducedMotion);
  vec2 position = state.xy + velocity * uDt * motionScale
    + detailCurl * uDt * 0.0018 * motionScale;
  if (uTracerType == 4) position.y -= uDt * 0.0065;
  if (uTracerType == 5) position.y -= uDt * 0.009;
  outputValue = vec4(position, state.z + uDt, float(generation));
}`;

const TRACER_VERTEX = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 vTracerColor;
uniform sampler2D uTracers;
uniform sampler2D uScalar;
uniform vec2 uResolution;
uniform vec2 uOrigin;
uniform vec2 uVolumeScale;
uniform vec2 uSourceCenter;
uniform float uReducedMotion;
uniform int uDiagnostic;
uniform int uTracerType;
uniform vec4 uLayerVisibility;
uniform vec3 uTracerColorA;
uniform vec3 uTracerColorB;
uniform vec3 uTracerColorC;
uniform uint uSeed;
// Tracer-material research controls (2026-07 Tsar core/tracer polish, plus
// the 2026-07 dissipation-artifact addendum's minSizeFloor).
// uTracerMaterialMode is 0 for every shipped preset (byte-identical
// rendering) and 1 only for the Tsar historical reference. uTracerMaterialParams
// packs (occlusionStrength, sizeVariance, brightnessVariance, minSizeFloor).
uniform float uTracerMaterialMode;
uniform vec4 uTracerMaterialParams;
${SEEDED_HASH}

float tracerDisplayRandom(uint index, uint generation, uint salt) {
  uint value = index * 0x9e3779b9u;
  value ^= generation * 0x85ebca6bu;
  value ^= uSeed + salt * 0xc2b2ae35u;
  return float(mixBits(value)) / 4294967295.0;
}

void main() {
  vec4 state = texelFetch(uTracers, ivec2(gl_VertexID, 0), 0);
  bool enabled = state.w >= 0.5 && (uDiagnostic == 0 || uDiagnostic == 8);
  vec2 screenUv = uOrigin + (state.xy - uSourceCenter) * uVolumeScale;
  bool visible = enabled
    && all(greaterThanEqual(screenUv, vec2(0.0)))
    && all(lessThanEqual(screenUv, vec2(1.0)));
  if (!visible) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    gl_PointSize = 1.0;
    vTracerColor = vec4(0.0);
    return;
  }

  vec4 scalar = texture(uScalar, state.xy);
  float diagnostic = float(uDiagnostic == 8);
  float maskedPlume = scalar.g * 0.32 * uLayerVisibility.y
    + scalar.a * 0.28 * uLayerVisibility.z
    + scalar.r * 0.18 * uLayerVisibility.w
    + scalar.b * 0.72 * uLayerVisibility.x;
  float rawPlume = scalar.g * 0.32 + scalar.a * 0.28
    + scalar.r * 0.18 + scalar.b * 0.72;
  float plume = clamp(mix(maskedPlume, rawPlume, diagnostic), 0.0, 1.0);
  float lifetimeScale = uTracerType == 4 || uTracerType == 5 ? 1.5 : (uTracerType == 6 ? 0.62 : 1.0);
  float ageFade = 1.0 - smoothstep(2.4 * lifetimeScale, 4.8 * lifetimeScale, state.z);
  // Tracer points share the domain-edge extinction of the volume (beauty
  // view only — diagnostics keep full visibility for verification).
  float edgeFade = smoothstep(0.0, 0.12, state.x) * smoothstep(0.0, 0.12, 1.0 - state.x)
    * smoothstep(0.0, 0.16, 1.0 - state.y) * smoothstep(0.0, 0.03, state.y);
  // Tsar-only (uTracerMaterialMode): dense smoke should bury a tracer, not
  // just dim it a little — occlusion adds a Beer-Lambert-style falloff on
  // top of the existing density-weighted visibility above (exp(-density *
  // occlusionStrength)), so thin smoke still reveals tracers, medium density
  // partially attenuates them, and dense smoke suppresses them almost
  // entirely, reusing the same local density sample the volume renderer
  // already computes rather than a second expensive pass. Left at 1.0 (and
  // skipped in diagnostic view, matching edgeFade above) for every other
  // preset.
  uint tracerIndex = uint(gl_VertexID);
  uint tracerGeneration = uint(max(0.0, floor(state.w + 0.5)));
  float occlusion = uTracerMaterialMode > 0.5
    ? mix(exp(-plume * uTracerMaterialParams.x), 1.0, diagnostic)
    : 1.0;
  // Tsar-only: a stable per-particle brightness offset (hashed from the
  // tracer's index/generation, so it stays consistent frame to frame instead
  // of flickering) breaks up the repetitive-dot look.
  float brightnessJitter = uTracerMaterialMode > 0.5
    ? mix(1.0 - uTracerMaterialParams.z, 1.0 + uTracerMaterialParams.z,
        tracerDisplayRandom(tracerIndex, tracerGeneration, 53u))
    : 1.0;
  float alpha = mix(plume * 0.34, 0.88, diagnostic) * ageFade
    * mix(edgeFade, 1.0, diagnostic) * occlusion * brightnessJitter;
  vec3 warm = mix(uTracerColorA, uTracerColorB,
    clamp(scalar.r + scalar.b, 0.0, 1.0));
  float particulate = clamp(scalar.a * 0.75 + scalar.g * 0.22, 0.0, 1.0);
  vec3 typed = (uTracerType == 1 || uTracerType == 2 || uTracerType == 4 || uTracerType == 5)
    ? mix(warm, uTracerColorC, particulate)
    : (uTracerType == 6 ? mix(uTracerColorC, uTracerColorB, clamp(scalar.b, 0.0, 1.0)) : warm);
  vec3 color = mix(typed, vec3(0.48, 0.9, 1.0), diagnostic);
  vTracerColor = vec4(color, alpha);
  gl_Position = vec4(screenUv * 2.0 - 1.0, 0.0, 1.0);
  float baseSize = clamp(min(uResolution.x, uResolution.y) * 0.003, 1.0, 3.2);
  // Tsar-only: at the shared 1.0px floor above, TRACER_FRAGMENT's radial
  // coverage falloff has no subpixels to work with, so a tracer at minimum
  // size reads as a solid square regardless of the falloff math. Raising the
  // floor gives that falloff room to actually render round. Left at the
  // original floor (uTracerMaterialParams.w defaults to 0, so max() is a
  // no-op) for every other preset.
  if (uTracerMaterialMode > 0.5) {
    baseSize = max(baseSize, uTracerMaterialParams.w);
  }
  float typeSize = uTracerType == 4 || uTracerType == 5 ? 0.82 : (uTracerType == 6 ? 0.68 : 1.0);
  // Tsar-only: a stable per-particle size offset, same hash family as the
  // brightness jitter above but a different salt so the two vary independently.
  float sizeJitter = uTracerMaterialMode > 0.5
    ? mix(1.0 - uTracerMaterialParams.y, 1.0 + uTracerMaterialParams.y,
        tracerDisplayRandom(tracerIndex, tracerGeneration, 41u))
    : 1.0;
  gl_PointSize = baseSize * typeSize * sizeJitter * mix(0.72, 1.18, diagnostic) * mix(1.0, 0.86, uReducedMotion);
}`;

const TRACER_FRAGMENT = `#version 300 es
precision highp float;
in vec4 vTracerColor;
out vec4 outputColor;
void main() {
  vec2 centered = gl_PointCoord * 2.0 - 1.0;
  float coverage = 1.0 - smoothstep(0.22, 1.0, dot(centered, centered));
  float alpha = vTracerColor.a * coverage;
  outputColor = vec4(vTracerColor.rgb * alpha, alpha);
}`;

const VOLUME_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
in vec2 vUv;
out vec4 outputColor;
uniform sampler2D uVelocity;
uniform sampler2D uScalar;
uniform sampler2D uCurl;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform sampler3D uCurlDetail;
uniform vec2 uTexel;
uniform vec2 uResolution;
uniform vec2 uOrigin;
uniform vec2 uVolumeScale;
uniform vec2 uSourceCenter;
uniform vec4 uPhase;
uniform float uTime;
uniform float uExposure;
uniform float uReducedMotion;
uniform int uDiagnostic;
uniform int uRaySteps;
uniform uint uSeed;
uniform vec4 uLayerVisibility;
uniform vec4 uVolumeProfile0;
uniform vec4 uVolumeProfile1;
uniform vec4 uVolumeProfile2;
uniform float uDomainDensityThreshold;
// Material absorption is independent from high-frequency detail. Profiles can
// keep soot/dust separation while leaving uDetailOctaveMode at 0 and retaining
// the two-octave cost of the original volume path.
uniform float uMaterialMode;
uniform vec4 uMaterialParams;
uniform float uDetailOctaveMode;
// Ground Burst may use the already-sampled view-ray depth to separate front,
// middle, and rear particulate layers without purchasing another detail
// octave. Zero keeps every other profile's material path unchanged.
uniform float uMaterialInteriorDepth;
// Early-core research controls (2026-07 Tsar core/tracer polish). uCoreMode
// is 0 for every shipped preset (byte-identical rendering) and 1 only for
// the Tsar historical reference. uCoreParams packs (highlightThreshold,
// highlightSharpness, structureBlend, bloomGateScale). Defaults (1.5, 2.0,
// 0.0, 0.0) reduce every formula below to its original, pre-pass value.
uniform float uCoreMode;
uniform vec4 uCoreParams;
// Low-yield dense shock contours. Mode 2 is bound only by the low-yield
// profile; every other preset receives mode 0 or the unchanged explicit mode
// 1 and exits before evaluating the contour family. Shape packs (source
// radius, aspect X, aspect Y, source-ring scale); Aux packs (irregularity,
// fade start, fade span, normalized time). Dense A/B/C match the compact
// profile definition used by the source architecture.
uniform float uShockwaveMode;
uniform vec4 uShockwaveVolumeShape;
uniform vec4 uShockwaveAux;
uniform vec4 uShockwaveDenseA;
uniform vec4 uShockwaveDenseB;
uniform vec4 uShockwaveDenseC;
// Profile-driven domain-edge extinction. Mode 0 retains the original
// independent-axis guard; positive modes use a profile-supplied warped
// superellipse so low-density smoke cannot reveal the simulation rectangle.
uniform float uEdgeMode;
uniform vec4 uEdgeProfile0;
uniform vec4 uEdgeProfile1;
uniform vec4 uEdgeProfile2;
uniform vec4 uEdgeProfile3;
uniform vec3 uPaletteBackground;
uniform vec3 uPaletteEmber;
uniform vec3 uPaletteFlame;
uniform vec3 uPaletteHot;
uniform vec3 uPaletteCore;
uniform vec3 uPaletteSmoke;
uniform vec3 uPaletteSmokeLight;
uniform vec3 uPaletteCloud;
uniform vec3 uPaletteDust;
${FIELD_SAMPLING}
${DETAIL_SAMPLING}

// Compact blackbody-style artistic ramp for normalized temperature/emission.
vec3 heatRamp(float temperature) {
  float t = pow(clamp(temperature * 0.48, 0.0, 1.0), max(0.35, uVolumeProfile2.w));
  vec3 ember = uPaletteEmber;
  vec3 orange = uPaletteFlame;
  vec3 gold = uPaletteHot;
  vec3 whiteHot = uPaletteCore;
  vec3 lower = mix(ember, orange, smoothstep(0.0, 0.42, t));
  vec3 upper = mix(gold, whiteHot, smoothstep(0.66, 1.0, t));
  return mix(lower, upper, smoothstep(0.38, 0.78, t));
}

vec3 toneMap(vec3 color) {
  color *= uExposure * uVolumeProfile2.x;
  vec3 aces = clamp((color * (2.51 * color + 0.03)) /
    (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
  vec3 reinhard = color / (vec3(1.0) + color);
  return mix(aces, reinhard, clamp(uVolumeProfile2.y, 0.0, 1.0));
}

// FIELD_SAMPLING deliberately clamps solver reads for stable finite-difference
// passes. The volume compositor must not turn that clamped texel into a visible
// wall when a distorted ray sample travels beyond the field, so it carries a
// separate validity term and contributes no density outside the real texture.
float fieldSampleValidity(vec2 uv) {
  return step(0.0, uv.x) * step(uv.x, 1.0)
    * step(0.0, uv.y) * step(uv.y, 1.0);
}

// Extinction toward the simulation-domain boundary. The ground edge keeps a
// deliberately narrow band to preserve surface contact on every preset.
//
// The default (uEdgeMode 0) path below multiplies an independent per-axis
// horizontal falloff by an independent per-axis vertical falloff. That
// product is mathematically a rounded rectangle (a Chebyshev/max-metric
// envelope) despite the smoothing at each edge — at high density the
// rectangle's interior plateau is fully saturated and invisible, but at low,
// near-uniform residual density (Tsar's late dissipation tail) the
// envelope's own axis-aligned isocontour becomes the visible silhouette,
// reading as a faint square/rectangular cloud. Left unfixed here (rather
// than gated) it is the only side/top boundary term every other preset also
// uses, and none of them have been audited against this specific low-density
// failure mode, so it stays byte-identical there.
// Center/radius terms depend on the pixel's one boundary-wobble sample, not
// ray depth, so prepare them once before the volume loop.
vec4 edgeExtinctionProfile(float wobble, float asymmetry) {
  if (uEdgeMode > 0.5) {
    return vec4(
      uEdgeProfile0.x + asymmetry * uEdgeProfile0.y,
      clamp(uEdgeProfile0.z + wobble * uEdgeProfile1.x, 0.3, 0.48),
      clamp(uEdgeProfile0.w + wobble * uEdgeProfile1.y, 0.3, 0.48),
      clamp(uEdgeProfile1.z + wobble * uEdgeProfile1.w, 0.32, 0.5)
    );
  }
  return vec4(
    clamp(0.2 + asymmetry + wobble * 0.06, 0.09, 0.34),
    clamp(0.2 - asymmetry - wobble * 0.05, 0.09, 0.34),
    clamp(0.26 + wobble * 0.07, 0.14, 0.38),
    0.0
  );
}

#ifdef BALANCED_EDGE_FAST_POWER
// Close fit for x^2.6 over the edge transition's useful range. Balanced uses
// this multiply/sqrt form to avoid two generic pow() calls per ray step.
float approximatePow2p6(float value) {
  float root = sqrt(value);
  return value * value * root * mix(1.0, root, 0.2);
}
#endif

float edgeExtinction(vec2 uv, vec4 profile, float wobble) {
  float ground = smoothstep(0.0, 0.04, uv.y);
  if (uEdgeMode > 2.5) {
    // Ground-coupled organic envelope. Unlike the airburst/historical
    // superellipse below, its vertical distance starts only in the upper
    // domain. The dense base therefore reaches the surface intact while
    // asymmetric warped sides and the cap dissolve before the computational
    // wall. A slightly wider low-altitude radius avoids replacing the box
    // with an oval or pinching the ground footprint into a vignette.
    float dx = uv.x - profile.x;
    float sideRadius = dx < 0.0 ? profile.y : profile.z;
    float lowerWiden = mix(1.1, 0.86, smoothstep(0.18, 0.48, uv.y));
    float capRollout = mix(1.0, 1.2, smoothstep(0.56, 0.84, uv.y));
    float normalizedX = dx / max(0.2, sideRadius * lowerWiden * capRollout);
    float topStart = 1.0 - profile.w;
    float normalizedY = max(0.0, uv.y - topStart) / max(0.2, profile.w);
    // The ground path is evaluated for every ray layer. A quartic fit keeps
    // its warped, asymmetric envelope while avoiding a per-layer sqrt/pow
    // pair; the legacy airburst/Tsar branches retain their established fit.
    float normalizedX2 = normalizedX * normalizedX;
    float normalizedY2 = normalizedY * normalizedY;
    float organicDistance = normalizedX2 * (1.0 + 0.45 * normalizedX2)
      + normalizedY2 * (1.0 + 0.45 * normalizedY2);
    organicDistance += wobble * uEdgeProfile2.z
      * mix(0.45, 1.0, smoothstep(0.2, 0.72, uv.y));
    float envelope = 1.0 - smoothstep(
      uEdgeProfile2.x,
      uEdgeProfile2.y,
      organicDistance
    );
    float mask = envelope * ground;
    return mask * mask * (3.0 - 2.0 * mask);
  }
  if (uEdgeMode > 0.5) {
    // Side and top falloff are merged into one warped superellipse distance
    // (rather than multiplied as independent axes), so the isocontour is a
    // continuous irregular curve, never a straight vertical or flat edge.
    float dx = uv.x - profile.x;
    float sideRadius = dx < 0.0 ? profile.y : profile.z;
    vec2 normalized = vec2(dx / sideRadius, (1.0 - uv.y) / profile.w);
#ifdef BALANCED_EDGE_FAST_POWER
    float ellipseDistance = approximatePow2p6(abs(normalized.x))
      + approximatePow2p6(abs(normalized.y));
#else
    float ellipseDistance = pow(abs(normalized.x), 2.6)
      + pow(abs(normalized.y), 2.6);
#endif
    ellipseDistance += wobble * uEdgeProfile2.z;
    float envelope = 1.0 - smoothstep(uEdgeProfile2.x, uEdgeProfile2.y, ellipseDistance);
    float mask = envelope * ground;
    return mask * mask * (3.0 - 2.0 * mask);
  }
  float side = smoothstep(0.0, profile.x, uv.x)
    * smoothstep(0.0, profile.y, 1.0 - uv.x);
  float top = smoothstep(0.0, profile.z, 1.0 - uv.y);
  float mask = side * top * ground;
  return mask * mask * (3.0 - 2.0 * mask);
}

float velocityGlyph(vec2 localUv, vec2 velocity) {
  float magnitude = length(velocity);
  if (magnitude < 0.002) return 0.0;
  vec2 direction = velocity / magnitude;
  vec2 normal = vec2(-direction.y, direction.x);
  vec2 glyphUv = fract(localUv * vec2(18.0, 14.0)) - 0.5;
  float along = dot(glyphUv, direction);
  float across = abs(dot(glyphUv, normal));
  float shaft = (1.0 - smoothstep(0.026, 0.058, across))
    * smoothstep(-0.34, -0.26, along)
    * (1.0 - smoothstep(0.18, 0.27, along));
  vec2 headUv = glyphUv - direction * 0.28;
  float headAlong = dot(headUv, direction);
  float headAcross = abs(dot(headUv, normal));
  float head = (1.0 - smoothstep(0.025, 0.064,
      abs(headAcross + headAlong * 0.78)))
    * smoothstep(-0.24, -0.18, headAlong)
    * (1.0 - smoothstep(-0.015, 0.01, headAlong));
  return max(shaft, head) * smoothstep(0.002, 0.075, magnitude);
}

vec4 diagnosticColor(
  vec2 localUv,
  vec4 scalar,
  vec2 velocity,
  float curl,
  float pressure,
  float divergence
) {
  float inside = step(0.0, localUv.x) * step(localUv.x, 1.0)
    * step(0.0, localUv.y) * step(localUv.y, 1.0);
  if (uDiagnostic == 1) {
    float magnitude = min(1.0, length(velocity) * 4.0);
    float glyph = velocityGlyph(localUv, velocity);
    vec3 directionColor = vec3(
      0.42 + velocity.x * 1.8,
      0.58 + velocity.y * 1.8,
      0.82
    );
    vec3 background = vec3(0.018, 0.035, 0.055) + magnitude * vec3(0.04, 0.09, 0.12);
    return vec4(mix(background, directionColor, glyph), inside * (0.72 + glyph * 0.28));
  }
  if (uDiagnostic == 2) {
    float value = clamp(scalar.r * 0.52, 0.0, 1.0);
    return vec4(heatRamp(scalar.r) * value, inside);
  }
  if (uDiagnostic == 3) {
    float value = clamp(scalar.g * 0.52, 0.0, 1.0);
    // Keep the developer field view density-weighted. An opaque inside
    // alpha made every sampled solver rectangle look full even when the
    // scalar was empty, which obscured occupancy diagnostics and suggested a
    // boundary that the visible composite did not actually contain.
    return vec4(vec3(value), inside * value);
  }
  if (uDiagnostic == 4) {
    float value = clamp(scalar.b * 0.72, 0.0, 1.0);
    return vec4(heatRamp(scalar.r + scalar.b) * value, inside);
  }
  if (uDiagnostic == 5) {
    float value = clamp(0.5 + pressure * 5.0, 0.0, 1.0);
    return vec4(value, 0.25 + 0.5 * (1.0 - abs(value - 0.5) * 2.0), 1.0 - value, inside);
  }
  if (uDiagnostic == 6) {
    float value = clamp(divergence * 12.0, -1.0, 1.0);
    return vec4(max(value, 0.0), 0.08 + abs(value) * 0.22, max(-value, 0.0), inside);
  }
  if (uDiagnostic == 7) {
    float value = clamp(curl * 8.0, -1.0, 1.0);
    return vec4(max(value, 0.0), 0.12 + abs(value) * 0.25, max(-value, 0.0), inside);
  }

  // The tracer diagnostic's actual particles are GPU-advected in a separate
  // ping-pong texture and composited as points after this field backdrop.
  float field = clamp(scalar.g * 0.36 + scalar.b * 0.42 + scalar.a * 0.2, 0.0, 1.0);
  vec3 color = vec3(0.06, 0.16, 0.2) * field;
  return vec4(color, inside * max(field * 0.62, 0.08));
}

float denseShockwaveContour(vec2 uv, float plumeTransmittance) {
  if (uShockwaveMode < 1.5) return 0.0;
  vec2 delta = uv - uSourceCenter;
  vec2 scaled = delta / max(
    vec2(0.002),
    uShockwaveVolumeShape.x * uShockwaveVolumeShape.yz
  );
  float radius = length(scaled);
  float angle = atan(scaled.y, scaled.x);
  float seedPhase = float(uSeed & 1023u) / 1023.0 * 6.28318530718;
  float normalizedTime = uShockwaveAux.w;

  // The leading contour expands from the source region across the visible
  // bubble during the early event. Subordinate radii remain strictly inside
  // it, so no generated band can detach outside the analytical primary shock.
  float sourceRingScale = uShockwaveVolumeShape.w / 1.2;
  float leadingRadius = sourceRingScale
    * (1.35 + normalizedTime * 46.0);
  float innerRadius = leadingRadius * uShockwaveDenseA.y;
  float outerRadius = leadingRadius * uShockwaveDenseA.z;
  float sharedBend = uShockwaveAux.x * (
    sin(angle * 2.0 + seedPhase) * 0.48
    + sin(angle * 5.0 - seedPhase * 1.3) * 0.32
    + sin(angle * 9.0 + seedPhase * 0.7) * 0.2
  );
  float bentRadius = radius * (1.0 + sharedBend);
  float radialPosition = (bentRadius - innerRadius)
    / max(0.02, outerRadius - innerRadius);
  float radialWindow = smoothstep(0.0, 0.035, radialPosition)
    * (1.0 - smoothstep(0.965, 1.0, radialPosition));
  radialPosition = clamp(radialPosition, 0.0, 1.0);

  float bandCount = max(1.0, uShockwaveDenseA.x);
  float spacingWarp = uShockwaveDenseA.w * (
    sin(radialPosition * 10.7 + seedPhase * 1.6) * 0.62
    + sin(radialPosition * 23.3 - seedPhase * 0.8) * 0.38
  );
  float contourCoordinate = pow(radialPosition, 1.28) * bandCount
    - 0.5 + spacingWarp;
  float contourIndex = floor(contourCoordinate + 0.5);
  float bandHash = fract(sin(
    contourIndex * 12.9898 + seedPhase * 23.117
  ) * 43758.5453);
  float angularWarp = uShockwaveAux.x * bandCount * 0.76 * (
    sin(
      angle * (2.0 + mod(contourIndex, 4.0))
      + contourIndex * 1.37
      + seedPhase
    ) * 0.68
    + sin(
      angle * (6.0 + mod(contourIndex, 3.0))
      - contourIndex * 0.83
      - seedPhase * 1.4
    ) * 0.32
  );
  float distanceFromBand = abs(
    contourCoordinate + angularWarp - contourIndex
  );
  float width = mix(uShockwaveDenseB.x, uShockwaveDenseB.y, bandHash);
  width = max(width, fwidth(contourCoordinate) * 0.72);
  float line = exp(
    -distanceFromBand * distanceFromBand
    / max(0.0004, width * width)
  );

  float broadSegment = 0.5 + 0.5 * sin(
    angle * (1.0 + mod(contourIndex, 3.0))
    + contourIndex * 1.11
    + seedPhase
  );
  float fineSegment = 0.5 + 0.5 * sin(
    angle * (4.0 + mod(contourIndex, 2.0))
    - contourIndex * 0.73
    - seedPhase * 0.8
  );
  float segmentMask = smoothstep(
    0.3,
    0.74,
    broadSegment * 0.72 + fineSegment * 0.28
  );
  float brokenSegment = mix(0.035, 1.0, segmentMask);
  float continuity = mix(
    1.0,
    brokenSegment,
    uShockwaveDenseC.x * mix(0.9, 1.0, bandHash)
  );
  float frontFacing = 0.5 + 0.5 * sin(
    angle + seedPhase * 0.37 + radialPosition * 1.5
  );
  float depthVisibility = mix(
    1.0,
    mix(0.32, 1.0, frontFacing),
    uShockwaveDenseC.y
  );

  float onsetDelay = 0.006 + uShockwaveDenseC.z
    * (1.0 - radialPosition)
    * mix(0.7, 1.18, bandHash);
  float onset = smoothstep(onsetDelay, onsetDelay + 0.022, normalizedTime);
  float fadeStart = uShockwaveAux.y
    - (1.0 - radialPosition) * uShockwaveDenseC.w * mix(0.55, 1.0, bandHash);
  float fadeEnd = uShockwaveAux.y + uShockwaveAux.z
    + bandHash * uShockwaveDenseC.w * 0.35;
  float fade = 1.0 - smoothstep(
    max(0.0, fadeStart),
    max(fadeStart + 0.01, fadeEnd),
    normalizedTime
  );
  float strength = mix(
    uShockwaveDenseB.z,
    uShockwaveDenseB.w,
    pow(radialPosition, 0.72)
  ) * mix(0.5, 1.28, bandHash);

  // Rear-facing segments use the accumulated volume transmittance and are
  // strongly buried by opaque plume material. Front segments retain a little
  // more contrast, but the square-root term still approaches zero as real
  // plume opacity approaches one.
  float occlusion = mix(
    plumeTransmittance,
    sqrt(plumeTransmittance),
    frontFacing * 0.62
  );
  return line * strength * continuity * depthVisibility
    * onset * clamp(fade, 0.0, 1.0) * radialWindow * occlusion;
}

void main() {
  vec2 localUv = uSourceCenter + (vUv - uOrigin) / max(uVolumeScale, vec2(0.0001));
  float inside = step(0.0, localUv.x) * step(localUv.x, 1.0)
    * step(0.0, localUv.y) * step(localUv.y, 1.0);
  if (inside <= 0.0) {
    outputColor = vec4(0.0);
    return;
  }

  vec4 centerScalar = sampleField(uScalar, localUv);
  vec2 centerVelocity = sampleField(uVelocity, localUv).xy;
  float centerCurl = sampleField(uCurl, localUv).r;
  float centerPressure = sampleField(uPressure, localUv).r;
  float centerDivergence = sampleField(uDivergence, localUv).r;
  if (uDiagnostic != 0) {
    vec4 diagnostic = diagnosticColor(
      localUv,
      centerScalar,
      centerVelocity,
      centerCurl,
      centerPressure,
      centerDivergence
    );
    outputColor = vec4(diagnostic.rgb * diagnostic.a, diagnostic.a);
    return;
  }

  float distortionAmount = mix(1.0, 0.35, uReducedMotion) * uVolumeProfile1.x
    * clamp(centerScalar.r * uLayerVisibility.w
      + centerScalar.b * uLayerVisibility.x, 0.0, 2.0);
  float temperatureLeft = sampleField(uScalar, localUv - vec2(uTexel.x, 0.0)).r;
  float temperatureRight = sampleField(uScalar, localUv + vec2(uTexel.x, 0.0)).r;
  float temperatureBottom = sampleField(uScalar, localUv - vec2(0.0, uTexel.y)).r;
  float temperatureTop = sampleField(uScalar, localUv + vec2(0.0, uTexel.y)).r;
  vec2 temperatureGradient = vec2(
    temperatureRight - temperatureLeft,
    temperatureTop - temperatureBottom
  );
  vec2 distortedUv = localUv + centerVelocity * distortionAmount * 0.008
    + temperatureGradient * distortionAmount * 0.012
    + vec2(centerCurl, -centerCurl) * uTexel * distortionAmount * 1.4;

  vec3 accumulated = vec3(0.0);
  float transmittance = 1.0;
  float shadowColumn = 0.0;
  vec4 sourceLightSample = sampleField(uScalar, uSourceCenter);
  float sourceHeat = sourceLightSample.r * uLayerVisibility.w
    + sourceLightSample.b * uLayerVisibility.x;
  vec3 sourceRadiance = heatRamp(sourceHeat)
    * clamp(sourceLightSample.b * uLayerVisibility.x + sourceHeat * 0.12, 0.0, 2.0);
  float seedPhase = float(uSeed & 1023u) / 1023.0;
  // Deterministic low-frequency boundary variation: the extinction border
  // drifts slowly and differs between seeds, never reading as one straight
  // fade distance on all sides.
  float boundaryWobble = decodeCurlDetail(sampleCurlDetail(
    uCurlDetail,
    vec3(localUv * vec2(1.3, 1.7), seedPhase + uTime * 0.0012)
  )).z;
  float sideAsymmetry = (fract(seedPhase * 7.31) - 0.5) * 0.06;
  vec4 edgeProfile = edgeExtinctionProfile(boundaryWobble, sideAsymmetry);
  float inverseSteps = 1.0 / float(max(uRaySteps, 1));
  const int MAX_RAY_STEPS = 48;
  for (int index = 0; index < MAX_RAY_STEPS; index += 1) {
    if (index >= uRaySteps) break;
    float layer = (float(index) + 0.5) * inverseSteps;
    float depth = layer * 2.0 - 1.0;
    float profileDepth = max(0.42, uVolumeProfile0.x);
    float radialWeight = sqrt(max(0.0, 1.0 - (depth * depth) / (profileDepth * profileDepth)));
    vec2 curlOffset = vec2(0.0);
    float densityDetail = 0.0;
    float detailNormalization = 0.0;
    // Two trilinear texture samples replace dozens of per-layer integer hashes.
    // Velocity amplitudes use k^(-5/6), the square-root analogue of a k^(-5/3)
    // energy spectrum. This is a bounded visual perturbation, not calibrated flow.
    // A third, finer octave is independently opt-in. Material coloration does
    // not imply this extra texture sample per ray layer.
    // amplitude follows local flow energy (|centerCurl|) rather than the flat
    // falloff above — wavelet-turbulence-style energy weighting that
    // concentrates fine billowing where the flow is actually turbulent instead
    // of coating the whole plume in uniform noise. detailOctaves stays 2 for
    // every other preset, so their loop is byte-identical to before this pass.
    int detailOctaves = uDetailOctaveMode > 0.5 ? 3 : 2;
    for (int octave = 0; octave < 3; octave += 1) {
      if (octave >= detailOctaves) break;
      float k = exp2(float(octave));
      float amplitude = pow(k, -0.8333333333);
      if (octave == 2) {
        amplitude *= uMaterialParams.z * clamp(abs(centerCurl) * 6.0, 0.0, 1.6);
      }
      vec3 detailCoordinate = vec3(
        distortedUv * vec2(4.7, 5.9) * k * uVolumeProfile1.z
          + vec2(depth * 0.37, -depth * 0.23) * k
          + vec2(uTime * 0.004, -uTime * 0.003),
        layer * (0.83 * k) + seedPhase + uTime * 0.0025
      );
      vec4 detailSample = sampleCurlDetail(uCurlDetail, detailCoordinate);
      curlOffset += decodeCurlDetail(detailSample).xy * amplitude;
      densityDetail += (detailSample.a * 2.0 - 1.0) * amplitude;
      detailNormalization += amplitude;
    }
    curlOffset /= max(detailNormalization, 0.0001);
    densityDetail /= max(detailNormalization, 0.0001);
    vec2 layerUv = distortedUv;
    layerUv.x += depth * (0.025 + centerCurl * 0.012);
    layerUv.y += depth * depth * 0.011 * uVolumeProfile1.y;
    layerUv += curlOffset * 0.019 * radialWeight;

    // Organic extinction toward the domain edges: clamped samples can never
    // duplicate into visible bands, and density dissolves long before the
    // computational boundary.
    float sampleValidity = fieldSampleValidity(layerUv);
    vec4 scalar = sampleField(uScalar, layerUv) * sampleValidity;
    float smokeDensity = max(0.0, scalar.g * 0.9 * uLayerVisibility.y);
    float dustDensity = max(0.0,
      scalar.a * 0.72 * uLayerVisibility.z * uVolumeProfile1.w
    );
    float smoke = smokeDensity + dustDensity;
    // Ground-coupled profiles use the envelope only for sparse residue. Medium
    // and high-density material is allowed to cross the warped envelope and
    // is constrained only by the padded render extent; otherwise the envelope
    // itself becomes a visible flat top or side wall. Legacy airburst/Tsar
    // modes retain their established envelope path.
    float layerFade = sampleValidity;
    if (uEdgeMode > 2.5) {
      float mediumDensity = smoothstep(
        uDomainDensityThreshold * 0.72,
        max(uDomainDensityThreshold * 1.55, uDomainDensityThreshold + 0.001),
        smoke
      );
      // Only sparse residue needs the organic boundary envelope. Dense
      // material takes the cheap validity path and cannot be attenuated into
      // a visible mask at the render edge.
      if (mediumDensity < 0.999) {
        float boundaryEnvelope = edgeExtinction(layerUv, edgeProfile, boundaryWobble);
        layerFade = mix(boundaryEnvelope * sampleValidity, sampleValidity, mediumDensity);
      }
    } else {
      float lowDensityResponse = smoothstep(
        uEdgeProfile2.w,
        max(uEdgeProfile2.w + 0.0001, uEdgeProfile3.x),
        smoke
      );
      float lowDensityWeight = (1.0 - lowDensityResponse) * uEdgeProfile3.y;
      float boundaryEnvelope = edgeExtinction(layerUv, edgeProfile, boundaryWobble);
      layerFade = boundaryEnvelope * sampleValidity;
      layerFade *= mix(1.0, layerFade, lowDensityWeight);
    }
    float incandescent = max(0.0, scalar.b * uLayerVisibility.x);
    float temperature = max(0.0,
      scalar.r * max(uLayerVisibility.x, uLayerVisibility.w)
    );
    float detailModulation = clamp(
      1.0 + densityDetail * 0.34 * radialWeight * uVolumeProfile1.y,
      0.62,
      1.38
    );
    // Tsar-only (uMaterialMode): soot and lofted dust get independent
    // optical-depth coefficients instead of sharing one density-to-alpha
    // curve — dense soot absorbs more per unit density, lofted dust less, so
    // medium density reads as layered translucency rather than one uniform
    // material. The unweighted smoke value is left untouched below for color
    // mixing (dustMix, etc). When uMaterialMode is 0 both coefficients are
    // 1.0 and opticalWeightedSmoke equals smoke exactly.
    float opticalWeightedSmoke = uMaterialMode > 0.5
      ? smokeDensity * uMaterialParams.x + dustDensity * uMaterialParams.y
      : smoke;
    // Ground Burst depth separation: reuse the existing ray position rather
    // than purchasing another texture read or detail octave. The front layer
    // stays a little clearer/warmer, the middle carries the strongest body,
    // and the rear layer falls back into cooler particulate. The uniform is
    // zero for every other preset, so their material path is unchanged.
    float frontLayer = 1.0 - smoothstep(-0.92, -0.08, depth);
    float rearLayer = smoothstep(0.08, 0.92, depth);
    float middleLayer = clamp(1.0 - max(frontLayer, rearLayer), 0.0, 1.0);
    float depthContrast = clamp(uMaterialInteriorDepth * 0.28, 0.0, 0.38);
    float density = (opticalWeightedSmoke + incandescent * 0.22) * radialWeight * detailModulation * layerFade;
    density *= 1.0 + depthContrast * (
      middleLayer * 0.25
      - frontLayer * 0.15
      - rearLayer * 0.2
    );
    float erosion = smoothstep(-0.62 / max(0.4, uVolumeProfile1.y), 0.38, densityDetail);
    density = max(0.0,
      density - (1.0 - erosion) * radialWeight * 0.026 * uVolumeProfile1.y
    );
    float opticalDepth = density * inverseSteps * 3.2 * uVolumeProfile0.y;
    float alpha = 1.0 - exp(-opticalDepth);

    // One midpoint probe approximates extinction along the fire-to-smoke light
    // path. Combined with accumulated view-ray density, this gives inexpensive
    // internal self-shadowing and lets incandescent material illuminate smoke.
    vec2 lightProbeUv = mix(layerUv, uSourceCenter, 0.5);
    vec4 lightProbe = sampleField(uScalar, lightProbeUv) * fieldSampleValidity(lightProbeUv);
    float lightDensity = lightProbe.g * 0.9 * uLayerVisibility.y
      + lightProbe.a * 0.72 * uLayerVisibility.z * uVolumeProfile1.w;
    float lightTransmittance = exp(-lightDensity * 0.92 * uVolumeProfile0.z);
    float selfShadow = exp(-shadowColumn * 2.3 * uVolumeProfile0.z) * lightTransmittance;
    // Directional sky light from upper-left with a short occlusion probe:
    // sunlit crowns stay bright while dense interiors fall into shadow.
    vec2 skyProbeUv = layerUv + vec2(-0.024, 0.05);
    vec4 skyProbe = sampleField(uScalar, skyProbeUv) * fieldSampleValidity(skyProbeUv);
    float skyOcclusion = exp(
      -(skyProbe.g * 0.9 + skyProbe.a * 0.62) * 1.5 * uVolumeProfile0.z
    );
    vec3 toLightVector = vec3(uSourceCenter - layerUv, -depth * 0.34);
    float toLightLength = length(toLightVector);
    vec3 toLight = toLightLength > 0.00001
      ? toLightVector / toLightLength
      : vec3(0.0, 0.0, 1.0);
    float forwardLobe = pow(max(0.0, dot(toLight, vec3(0.0, 0.0, 1.0))), 3.0);
    float dustMix = clamp(dustDensity / max(0.0001, smoke), 0.0, 1.0);
    vec3 darkParticulate = mix(uPaletteSmoke, uPaletteDust, dustMix);
    vec3 litParticulate = mix(uPaletteSmokeLight, uPaletteCloud, clamp(shadowColumn, 0.0, 1.0));
    // Tsar-only (uMaterialMode): widen the lit/shadowed dynamic range so
    // internal shadows read as genuinely dark and sky/fire-lit crowns read as
    // genuinely bright, instead of one flat mid-tone. contrastBoost is 0 for
    // every other preset, reducing every term below to its original value.
    float contrastBoost = uMaterialMode > 0.5 ? uMaterialParams.w : 0.0;
    float litWeight = clamp(
      temperature * (0.18 + contrastBoost * 0.35)
        + selfShadow * (0.3 + contrastBoost * 0.2)
        + skyOcclusion * 0.42,
      0.0,
      1.0
    );
    litWeight = clamp(
      litWeight
        + frontLayer * depthContrast * 0.2
        - rearLayer * depthContrast * 0.14,
      0.0,
      1.0
    );
    vec3 baseSmokeColor = mix(darkParticulate, litParticulate, litWeight);
    float depthShadow = smoothstep(
      0.06,
      0.86,
      shadowColumn * uVolumeProfile0.z
    );
    float interiorBlend = clamp(
      depthShadow * uMaterialInteriorDepth * 0.72,
      0.0,
      0.72
    );
    vec3 smokeColor = mix(baseSmokeColor, darkParticulate, interiorBlend)
      * (0.4 - contrastBoost * 0.12
        + (0.42 + contrastBoost * 0.1) * skyOcclusion
        + (0.24 + contrastBoost * 0.1) * selfShadow);
    smokeColor = mix(
      smokeColor,
      litParticulate,
      frontLayer * depthContrast * 0.12
    );
    smokeColor = mix(
      smokeColor,
      darkParticulate,
      rearLayer * depthContrast * 0.18
    );
    vec3 emission = heatRamp(temperature + incandescent * 0.75)
      * (1.0 - exp(-incandescent * 1.1)) * (0.62 + selfShadow * 0.3)
      * (0.72 + 0.28 * detailModulation);
    // Overexposed white-hot core where normalized temperature runs highest —
    // the early fireball keeps a saturated center inside a structured
    // orange-to-ember gradient instead of flattening into one white disk.
    // Tsar-only (uCoreMode): the default threshold/sharpness (1.5, 2.0)
    // saturate to a flat pow(...)=1.0 plateau across most of the Tsar core's
    // amplified temperature range, which is the flat-white-blob defect this
    // pass fixes. Raising the threshold and sharpness narrows the fully
    // saturated zone to genuinely the hottest voxels; structureBlend folds in
    // self-shadow and turbulence detail so occluded/turbulent pockets darken
    // instead of the whole core reading as one uniform highlight. When
    // uCoreMode is 0, coreThreshold/coreSharpness/coreStructure reduce to
    // (1.5, 2.0, 1.0) — identical to the pre-pass formula.
    float coreThreshold = uCoreMode > 0.5 ? uCoreParams.x : 1.5;
    float coreSharpness = uCoreMode > 0.5 ? uCoreParams.y : 2.0;
    float coreStructure = uCoreMode > 0.5
      ? mix(1.0, clamp(selfShadow * (0.6 + 0.4 * detailModulation), 0.0, 1.3), uCoreParams.z)
      : 1.0;
    emission += uPaletteCore
      * pow(clamp((temperature - coreThreshold) * 0.85, 0.0, 1.0), coreSharpness)
      * (0.4 + incandescent * 0.45)
      * coreStructure;
    // Every radiance source is masked by the same extinction as density —
    // saturated emission can never outline the domain where alpha has faded.
    emission *= layerFade;
    float edgeScatter = pow(max(0.0, 1.0 - radialWeight), 1.7) * smoke * 0.12 * layerFade;
    vec3 fireScatter = sourceRadiance * smoke * lightTransmittance
      * (0.085 + forwardLobe * 0.15) * layerFade;
    vec3 layerColor = smokeColor * smoke + emission + fireScatter
      + mix(uPaletteSmokeLight, uPaletteCore, 0.18) * edgeScatter;
    accumulated += transmittance * alpha * layerColor;
    transmittance *= 1.0 - alpha;
    shadowColumn += density * inverseSteps;
    if (transmittance < 0.012) break;
  }

  // Restrained neighboring emission produces a cheap bloom without making the
  // fluid simulation depend on output resolution.
  vec3 bloom = vec3(0.0);
  float bloomHeatSum = 0.0;
  float bloomHeatSumSq = 0.0;
  const vec2 directions[8] = vec2[8](
    vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0),
    vec2(0.707, 0.707), vec2(-0.707, 0.707), vec2(0.707, -0.707), vec2(-0.707, -0.707)
  );
  for (int index = 0; index < 8; index += 1) {
    vec2 neighborUv = distortedUv + directions[index] * uTexel * 3.5;
    vec4 neighbor = sampleField(uScalar, neighborUv) * fieldSampleValidity(neighborUv);
    float neighborHeat = neighbor.r * uLayerVisibility.w
      + neighbor.b * uLayerVisibility.x;
    bloom += heatRamp(neighborHeat) * neighbor.b * uLayerVisibility.x;
    bloomHeatSum += neighborHeat;
    bloomHeatSumSq += neighborHeat * neighborHeat;
  }
  // Tsar-only (uCoreMode): bloom is meant to spread light from real edges,
  // not thicken an already-flat, uniformly hot plateau. bloomGate measures
  // the local variance across the 8 neighbor samples above and suppresses
  // bloom where that variance is low (flat regions), while leaving it intact
  // around genuine gradients. When uCoreMode is 0, bloomGate is 1.0 and the
  // bloom contribution is unchanged from the pre-pass formula.
  float bloomVariance = max(0.0, bloomHeatSumSq / 8.0 - (bloomHeatSum / 8.0) * (bloomHeatSum / 8.0));
  float bloomGate = uCoreMode > 0.5 ? clamp(sqrt(bloomVariance) * uCoreParams.w, 0.0, 1.0) : 1.0;
  // Bloom is extracted after the same boundary extinction so it can never
  // spread clipped edge pixels back into view.
  accumulated += bloom * 0.018 * uPhase.x * uVolumeProfile0.w * bloomGate
    * edgeExtinction(distortedUv, edgeProfile, boundaryWobble);
  accumulated += uPaletteBackground * uVolumeProfile2.z * (1.0 - transmittance) * 0.12;
  float shockwaveContour = denseShockwaveContour(
    distortedUv,
    clamp(transmittance, 0.0, 1.0)
  );
  vec3 shockwaveColor = mix(uPaletteSmokeLight, uPaletteCore, 0.72);
  accumulated += shockwaveColor * shockwaveContour * 0.88;

  // Density governs opacity across the fire-to-cloud handoff. Phase values
  // modulate illumination and late dissipation gently; they no longer suppress
  // radiance and alpha together, which made the 4–8 second plume nearly vanish.
  float illuminationEnvelope = clamp(
    0.86 + uPhase.x * 0.1 + uPhase.y * 0.1 + uPhase.w * 0.04,
    0.78,
    1.08
  );
  float atmosphericFade = 1.0 - clamp(uPhase.z * 0.46, 0.0, 0.58);
  // The composite alpha shares the organic extinction (gently, as its square
  // root — per-layer density and emission already carry the full mask), so
  // the volume rectangle can never appear against the environment behind it.
  float localSmoke = max(0.0, centerScalar.g * 0.9 * uLayerVisibility.y)
    + max(0.0, centerScalar.a * 0.72 * uLayerVisibility.z * uVolumeProfile1.w);
  float domainEnvelope = edgeExtinction(localUv, edgeProfile, boundaryWobble);
  float denseDomainBlend = uEdgeMode > 2.5
    ? smoothstep(
      uDomainDensityThreshold * 0.72,
      max(uDomainDensityThreshold * 1.55, uDomainDensityThreshold + 0.001),
      localSmoke
    )
    : 0.0;
  float domainFade = sqrt(mix(domainEnvelope, 1.0, denseDomainBlend));
  float densityOpacity = (1.0 - transmittance) * atmosphericFade;
  float shockOpacity = shockwaveContour * 0.12 * atmosphericFade;
  float alpha = clamp(
    // Analytical dense shock contours remain independent of smoke-only edge
    // extinction: the organic plume fade cannot crop an approved outer band.
    densityOpacity * domainFade
      + mix(shockOpacity * domainFade, shockOpacity, step(1.5, uShockwaveMode)),
    0.0,
    0.98
  );
  vec3 mapped = toneMap(accumulated * illuminationEnvelope);
  outputColor = vec4(mapped * alpha, alpha);
}`;

// Keep tier selection at compile time: a runtime uniform branch caused this
// GPU/driver to predicate both power paths and erased the Balanced benefit.
const BALANCED_VOLUME_FRAGMENT = VOLUME_FRAGMENT.replace(
  '#version 300 es\n',
  '#version 300 es\n#define BALANCED_EDGE_FAST_POWER\n',
);

export const RESEARCH_FLUID_SHADER_SOURCES = Object.freeze({
  fullscreenVertex: FULLSCREEN_VERTEX,
  advectFragment: ADVECT_FRAGMENT,
  curlFragment: CURL_FRAGMENT,
  forceFragment: FORCE_FRAGMENT,
  scalarFragment: SCALAR_FRAGMENT,
  divergenceFragment: DIVERGENCE_FRAGMENT,
  jacobiFragment: JACOBI_FRAGMENT,
  projectFragment: PROJECT_FRAGMENT,
  metricsFragment: METRICS_FRAGMENT,
  tracerAdvectFragment: TRACER_ADVECT_FRAGMENT,
  tracerVertex: TRACER_VERTEX,
  tracerFragment: TRACER_FRAGMENT,
  volumeFragment: VOLUME_FRAGMENT,
});

function createResearchCanvas(providedCanvas) {
  // A visible research canvas supplied by the facade belongs to the caller.
  // Do not modify its hidden attribute, CSS, ARIA, dataset, or DOM placement.
  if (providedCanvas?.getContext) return providedCanvas;
  try {
    if (globalThis.document?.createElement) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      canvas.hidden = true;
      canvas.setAttribute('aria-hidden', 'true');
      canvas.dataset.renderer = 'research-fluid-webgl2';
      if (canvas.style) {
        canvas.style.position = 'fixed';
        canvas.style.left = '-10000px';
        canvas.style.top = '-10000px';
        canvas.style.width = '1px';
        canvas.style.height = '1px';
        canvas.style.pointerEvents = 'none';
      }
      return canvas;
    }
    if (typeof globalThis.OffscreenCanvas === 'function') return new OffscreenCanvas(1, 1);
  } catch {
    // Capability reporting below provides the actionable fallback reason.
  }
  return null;
}

function normalizeTier(value) {
  if (value && typeof value === 'object' && value.id && RESEARCH_FLUID_TIERS[value.id]) {
    return RESEARCH_FLUID_TIERS[value.id];
  }
  const id = String(value || RESEARCH_FLUID_DEFAULTS.tier).toLowerCase();
  if (id === 'low' || id === 'mobile') return RESEARCH_FLUID_TIERS.mobile;
  if (id === 'high') return RESEARCH_FLUID_TIERS.high;
  return RESEARCH_FLUID_TIERS.balanced;
}

function profileTier(value, profile) {
  const base = normalizeTier(value);
  const quality = profile?.quality || BASE_PROFILE.quality;
  return Object.freeze({
    ...base,
    gridLongSide: Math.round(clamp(base.gridLongSide * quality.grid, 72, 320)),
    gridShortSideMinimum: Math.round(clamp(base.gridShortSideMinimum * quality.grid, 48, 180)),
    pressureIterations: Math.round(clamp(base.pressureIterations * quality.pressure, 6, 24)),
    raySteps: Math.round(clamp(base.raySteps * quality.rays, 8, 48)),
    tracerCount: Math.round(clamp(base.tracerCount * quality.tracers, 160, 1536)),
    detailResolution: Math.round(clamp(base.detailResolution * quality.detail, 12, 40)),
    // Every event family retains the same deterministic solver clock.
    fixedStep: base.fixedStep,
    profileQuality: quality,
  });
}

function tierRuntimeSignature(tier) {
  return [
    tier.id,
    tier.gridLongSide,
    tier.gridShortSideMinimum,
    tier.pressureIterations,
    tier.raySteps,
    tier.tracerCount,
    tier.detailResolution,
    tier.fixedStep,
  ].join(':');
}

function normalizeDiagnostic(value) {
  if (Number.isInteger(value)) return clamp(value, 0, 8);
  const key = String(value || 'beauty').toLowerCase().replace(/[\s_-]+/g, '');
  if (key === 'final' || key === 'finalcomposite') return RESEARCH_FLUID_DIAGNOSTICS.beauty;
  if (key === 'density' || key === 'smoke' || key === 'smokedensity') {
    return RESEARCH_FLUID_DIAGNOSTICS.smoke;
  }
  if (key === 'incandescent' || key === 'incandescentdensity') {
    return RESEARCH_FLUID_DIAGNOSTICS.incandescent;
  }
  return {
    beauty: RESEARCH_FLUID_DIAGNOSTICS.beauty,
    velocity: RESEARCH_FLUID_DIAGNOSTICS.velocity,
    temperature: RESEARCH_FLUID_DIAGNOSTICS.temperature,
    pressure: RESEARCH_FLUID_DIAGNOSTICS.pressure,
    divergence: RESEARCH_FLUID_DIAGNOSTICS.divergence,
    vorticity: RESEARCH_FLUID_DIAGNOSTICS.vorticity,
    tracers: RESEARCH_FLUID_DIAGNOSTICS.tracers,
  }[key] ?? RESEARCH_FLUID_DIAGNOSTICS.beauty;
}

function diagnosticName(value) {
  return [
    'beauty',
    'velocity',
    'temperature',
    'smoke',
    'incandescent',
    'pressure',
    'divergence',
    'vorticity',
    'tracers',
  ][normalizeDiagnostic(value)] || 'beauty';
}

function glErrorName(gl, code) {
  const names = new Map([
    [gl.INVALID_ENUM, 'INVALID_ENUM'],
    [gl.INVALID_VALUE, 'INVALID_VALUE'],
    [gl.INVALID_OPERATION, 'INVALID_OPERATION'],
    [gl.INVALID_FRAMEBUFFER_OPERATION, 'INVALID_FRAMEBUFFER_OPERATION'],
    [gl.OUT_OF_MEMORY, 'OUT_OF_MEMORY'],
    [gl.CONTEXT_LOST_WEBGL, 'CONTEXT_LOST_WEBGL'],
  ]);
  return names.get(code) || `UNKNOWN_WEBGL_ERROR_${code}`;
}

function normalizeSettings(settings = {}, previous = RESEARCH_FLUID_DEFAULTS) {
  const windInput = finite(settings.windStrength, previous.windStrength);
  const windStrength = windInput > 1 ? windInput / 100 : windInput;
  const presetId = String(settings.presetId ?? previous.presetId);
  const requestedProfileId = settings.profileId ?? settings.fluidProfile
    ?? (presetId === previous.presetId ? previous.profileId : null);
  const profile = resolveFluidProfile(presetId, requestedProfileId);
  const sourcePrimitives = normalizeSourcePrimitives(
    settings.sourcePrimitives ?? (presetId === previous.presetId ? previous.sourcePrimitives : null),
    profile,
  );
  return {
    presetId,
    profileId: profile.profileId,
    eventFamily: String(settings.eventFamily ?? profile.eventFamily),
    eventFamilyId: String(settings.eventFamilyId ?? profile.eventFamilyId),
    physicalFamilyId: String(settings.physicalFamilyId ?? profile.physicalFamilyId),
    sourcePrimitives,
    sourcePrimitiveMask: sourcePrimitiveMask(sourcePrimitives),
    palette: normalizeFluidPalette(settings.palette, previous.palette || DEFAULT_FLUID_PALETTE),
    seed: (Math.max(1, Math.floor(finite(settings.seed, previous.seed))) >>> 0) || 1,
    energy: clamp(finite(settings.energy, previous.energy), 0.2, 2.5),
    altitude: clamp(finite(settings.altitude, previous.altitude), -0.15, 0.75),
    windDirection: ((finite(settings.windDirection, previous.windDirection) % 360) + 360) % 360,
    windStrength: clamp(windStrength, 0, 1),
    duration: clamp(finite(settings.duration, previous.duration), 5, 60),
    reducedMotion: settings.reducedMotion === undefined
      ? Boolean(previous.reducedMotion)
      : Boolean(settings.reducedMotion),
    sourceStrength: clamp(finite(settings.sourceStrength, previous.sourceStrength), 0.25, 1.8),
    buoyancy: clamp(finite(settings.buoyancy, previous.buoyancy), 0.1, 1.2),
    densityLoading: clamp(finite(settings.densityLoading, previous.densityLoading), 0.02, 0.5),
    cooling: clamp(finite(settings.cooling, previous.cooling), 0.04, 0.8),
    smokeConversion: clamp(finite(settings.smokeConversion, previous.smokeConversion), 0.1, 1.5),
    dissipation: clamp(finite(settings.dissipation, previous.dissipation), 0.94, 1),
    exposureBoost: clamp(finite(settings.exposureBoost, previous.exposureBoost ?? 1), 0.5, 1.6),
    capWidthBoost: clamp(finite(settings.capWidthBoost, previous.capWidthBoost ?? 1), 0.6, 1.6),
    tier: normalizeTier(settings.tier ?? previous.tier).id,
    diagnostic: settings.diagnostic ?? previous.diagnostic,
  };
}

function physicalSignature(settings, tier) {
  return [
    settings.presetId,
    settings.profileId,
    settings.eventFamilyId,
    settings.physicalFamilyId,
    settings.sourcePrimitives.join(','),
    settings.sourcePrimitiveMask,
    settings.seed,
    settings.energy,
    settings.altitude,
    settings.windDirection,
    settings.windStrength,
    settings.duration,
    Number(settings.reducedMotion),
    settings.sourceStrength,
    settings.buoyancy,
    settings.densityLoading,
    settings.cooling,
    settings.smokeConversion,
    settings.dissipation,
    settings.capWidthBoost,
    settings.profileId,
    tierRuntimeSignature(tier),
  ].join('|');
}

function makeGridDimensions(width, height, tier) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const aspect = safeWidth / safeHeight;
  let gridWidth;
  let gridHeight;
  if (aspect >= 1) {
    gridWidth = tier.gridLongSide;
    gridHeight = Math.max(tier.gridShortSideMinimum, Math.round(gridWidth / aspect));
  } else {
    gridHeight = tier.gridLongSide;
    gridWidth = Math.max(tier.gridShortSideMinimum, Math.round(gridHeight * aspect));
  }
  // Even dimensions make framebuffer inspection and future packed fallbacks simpler.
  return {
    width: Math.max(2, Math.round(gridWidth / 2) * 2),
    height: Math.max(2, Math.round(gridHeight / 2) * 2),
  };
}

function shaderLabel(type) {
  return type === 0x8b31 ? 'vertex' : 'fragment';
}

/**
 * Stateful normalized GPU fluid solver. Methods return booleans for capability
 * sensitive work and never throw during ordinary graceful fallback.
 */
export class ResearchFluidEngine {
  constructor(options = {}) {
    this.canvas = createResearchCanvas(options.canvas);
    this._ownsCanvas = !options.canvas;
    this.gl = null;
    this.available = false;
    this.destroyed = false;
    this.reason = this.canvas ? 'WebGL2 has not been initialized.' : 'Canvas creation is unavailable.';
    this.settings = normalizeSettings(options.settings || options, RESEARCH_FLUID_DEFAULTS);
    this.profile = resolveFluidProfile(this.settings.presetId, this.settings.profileId);
    this.tier = profileTier(options.tier ?? this.settings.tier, this.profile);
    this.settings.tier = this.tier.id;
    this.width = 1;
    this.height = 1;
    this.gridWidth = 0;
    this.gridHeight = 0;
    this.time = 0;
    this.simulationTime = 0;
    this.stepIndex = 0;
    this._format = null;
    this._programs = Object.create(null);
    this._targets = null;
    this._detailTexture = null;
    this._detailSize = 0;
    this._detailSignature = '';
    this._metricTarget = null;
    this._metricPixels = null;
    this._debugMetricsEnabled = Boolean(options.debugMetrics);
    this._debugMetricsActive = false;
    this._metricStepIndex = -1;
    this._metrics = {
      velocityMagnitude: 0,
      maximumTemperature: 0,
      smokeDensity: 0,
      vorticityMagnitude: 0,
      activeDensityBounds: null,
      boundaryRisk: null,
      sampledStep: null,
    };
    this._vao = null;
    this._signature = physicalSignature(this.settings, this.tier);
    this._contextLost = false;
    this._drawCalls = 0;
    this._simulationSteps = 0;
    this._resets = 0;
    this._lastDiagnostic = normalizeDiagnostic(this.settings.diagnostic);
    this._lastRaySteps = this.tier.raySteps;
    this._renderDomain = null;
    this._probeAttempts = [];
    this._lastGlError = null;
    this._boundContextLost = (event) => this._handleContextLost(event);
    this._boundContextRestored = () => this._handleContextRestored();

    this._installContextListeners();
    this._initializeContext();
    if (this.available) {
      this.resize(
        finite(options.width, 960),
        finite(options.height, 540),
        this.tier.id,
      );
    }
  }

  configure(partialSettings = {}) {
    if (this.destroyed || !partialSettings || typeof partialSettings !== 'object') return this;
    if (Object.prototype.hasOwnProperty.call(partialSettings, 'debugMetrics')) {
      this._debugMetricsEnabled = Boolean(partialSettings.debugMetrics);
    }
    const previousTier = this.tier;
    const previousTierSignature = tierRuntimeSignature(previousTier);
    const previousSignature = this._signature;
    this.settings = normalizeSettings(partialSettings, this.settings);
    this.profile = resolveFluidProfile(this.settings.presetId, this.settings.profileId);
    const desiredTier = profileTier(partialSettings.tier ?? this.settings.tier, this.profile);
    this.tier = desiredTier;
    this.settings.tier = desiredTier.id;
    this._lastDiagnostic = normalizeDiagnostic(this.settings.diagnostic);
    this._signature = physicalSignature(this.settings, this.tier);

    if (this.available && previousTierSignature !== tierRuntimeSignature(this.tier)) {
      // Let resize compare against the actually allocated tier so same-named
      // tiers with different per-profile budgets reallocate every dependent target.
      this.tier = previousTier;
      this.resize(this.width, this.height, desiredTier.id);
    } else if (this.available && previousSignature !== this._signature) {
      try {
        this._ensureDetailTexture();
        this._resetState();
      } catch (error) {
        this._runtimeFailure('Curl-detail texture allocation failed.', error);
      }
    }
    return this;
  }

  setDebugMetricsEnabled(enabled) {
    this._debugMetricsEnabled = Boolean(enabled);
    return this;
  }

  resize(width, height, tier = this.tier.id) {
    if (this.destroyed || !this.canvas) return false;
    const outputWidth = clamp(Math.round(finite(width, this.width || 1)), 1, MAX_OUTPUT_DIMENSION);
    const outputHeight = clamp(Math.round(finite(height, this.height || 1)), 1, MAX_OUTPUT_DIMENSION);
    const nextTier = profileTier(tier, this.profile);
    const dimensions = makeGridDimensions(outputWidth, outputHeight, nextTier);
    const gridChanged = dimensions.width !== this.gridWidth || dimensions.height !== this.gridHeight;
    const tierChanged = tierRuntimeSignature(nextTier) !== tierRuntimeSignature(this.tier);

    this.width = outputWidth;
    this.height = outputHeight;
    this.tier = nextTier;
    if (tierChanged) this._lastRaySteps = nextTier.raySteps;
    this.settings.tier = nextTier.id;
    this._signature = physicalSignature(this.settings, nextTier);
    if (this.canvas.width !== outputWidth) this.canvas.width = outputWidth;
    if (this.canvas.height !== outputHeight) this.canvas.height = outputHeight;

    if (!this.available || !this.gl) return false;
    if (gridChanged || tierChanged || !this._targets) {
      this.gridWidth = dimensions.width;
      this.gridHeight = dimensions.height;
      try {
        this._allocateTargets();
        this._resetState();
      } catch (error) {
        this._runtimeFailure('Fluid framebuffer allocation failed.', error);
        return false;
      }
    }
    return true;
  }

  seek(time) {
    const requestedTime = clamp(finite(time, 0), 0, MAX_SEEK_SECONDS);
    this.time = requestedTime;
    if (!this.available || this.destroyed || !this._targets) return false;
    const fixedStep = this.tier.fixedStep;
    const targetStep = Math.max(0, Math.floor(requestedTime / fixedStep + 1e-7));
    if (targetStep < this.stepIndex) this._resetState();
    if (targetStep === this.stepIndex) {
      this.time = requestedTime;
      this.simulationTime = this.stepIndex * fixedStep;
      return true;
    }

    try {
      while (this.stepIndex < targetStep) {
        const nextStep = this.stepIndex + 1;
        this._stepSimulation(nextStep * fixedStep, fixedStep);
        this.stepIndex = nextStep;
        this.simulationTime = nextStep * fixedStep;
        this._simulationSteps += 1;
      }
      this._assertNoGlError('fluid simulation');
      this.time = requestedTime;
      return true;
    } catch (error) {
      this._runtimeFailure('The WebGL2 fluid solver stopped unexpectedly.', error);
      return false;
    }
  }

  render(options = {}) {
    if (this.destroyed) return false;
    const width = finite(options.width, this.width);
    const height = finite(options.height, this.height);
    const requestedTier = typeof options.quality === 'string'
      ? profileTier(options.quality, this.profile)
      : this.tier;
    if (
      Math.round(width) !== this.width
      || Math.round(height) !== this.height
      || tierRuntimeSignature(requestedTier) !== tierRuntimeSignature(this.tier)
    ) {
      this.resize(width, height, requestedTier.id);
    }
    if (!this.available || !this.gl || !this._targets) return false;
    if (!this.seek(options.time ?? this.time)) return false;

    const gl = this.gl;
    const diagnostic = normalizeDiagnostic(options.diagnostic ?? this.settings.diagnostic);
    this._lastDiagnostic = diagnostic;
    const collectDebugMetrics = Boolean(
      options.debugMetrics
      || options.collectMetrics
      || this._debugMetricsEnabled
      || diagnostic !== RESEARCH_FLUID_DIAGNOSTICS.beauty
    );
    this._debugMetricsActive = collectDebugMetrics;
    const phase = options.phase || {};
    const layout = options.layout || {};
    const originX = clamp(finite(layout.originX, this.width * 0.5) / this.width, 0, 1);
    const topOriginY = finite(layout.eventY ?? layout.originY, this.height * 0.68);
    const originY = clamp(1 - topOriginY / this.height, 0, 1);
    const sceneScale = clamp(finite(layout.scale, 1), 0.45, 2.4);
    const minimumDimension = Math.min(this.width, this.height);
    const domain = this._domainState();
    // Preserve the established visible-volume caps for every profile that has
    // not opted into the padded-domain contract. The larger cap only gives an
    // opted-in profile room to map its already-padded active field.
    const maximumVolumeScaleX = domain.mode ? 1.65 : 1.15;
    const maximumVolumeScaleY = domain.mode ? 1.5 : 1.0;
    // An opted-in padded profile must render its solver field past the camera
    // viewport. Keeping the old compact minimum would merely move the same
    // rectangular boundary outward by a few pixels; the field edge would
    // remain a visible compositing primitive. The lower bound is a render
    // extent, not a source or event-scale change, so mobile can crop the
    // event naturally while preserving the physical ground plane.
    const minimumVolumeScaleX = domain.mode ? 1.08 : 0.06;
    const minimumVolumeScaleY = domain.mode ? 1.02 : 0.08;
    const volumeScale = [
      clamp(
        minimumDimension * 0.48 * sceneScale * this.profile.volume.scaleX
          * domain.renderOverscan / this.width,
        minimumVolumeScaleX,
        maximumVolumeScaleX,
      ),
      clamp(
        // The vertical cap keeps the full plume silhouette — stem, cap, and
        // umbrella roll — inside the frame even for the largest archetypes.
        minimumDimension * 0.78 * sceneScale * this.profile.volume.scaleY
          * domain.renderOverscan / this.height,
        minimumVolumeScaleY,
        maximumVolumeScaleY,
      ),
    ];
    if (domain.renderExtent) {
      volumeScale[0] = clamp(
        finite(domain.renderExtent.x, volumeScale[0]),
        minimumVolumeScaleX,
        maximumVolumeScaleX,
      );
      volumeScale[1] = clamp(
        finite(domain.renderExtent.y, volumeScale[1]),
        minimumVolumeScaleY,
        maximumVolumeScaleY,
      );
    }
    this._renderDomain = {
      mode: domain.mode,
      padding: domain.padding,
      activeScale: domain.activeScale,
      renderOverscan: domain.renderOverscan,
      outputScale: domain.renderScale,
      renderExtent: domain.renderExtent ? { ...domain.renderExtent } : null,
      edgeMode: Number(this.profile.edge?.mode || 0),
      materialMode: Number(this.profile.material?.mode || 0),
      detailOctaveMode: Number(this.profile.material?.detailOctaveMode || 0),
      riskMargin: domain.riskMargin,
      densityThreshold: domain.densityThreshold,
      sourceCenter: this._sourceCenter(),
      volumeScale: [...volumeScale],
      viewportFieldBounds: {
        left: this._sourceCenter()[0] - originX / volumeScale[0],
        right: this._sourceCenter()[0] + (1 - originX) / volumeScale[0],
        bottom: this._sourceCenter()[1] - originY / volumeScale[1],
        top: this._sourceCenter()[1] + (1 - originY) / volumeScale[1],
      },
    };
    const phaseValues = [
      clamp(finite(phase.fireAlpha ?? phase.fireGrowth, this._fallbackFirePhase()), 0, 2),
      clamp(finite(phase.cloud, this._fallbackCloudPhase()), 0, 2),
      clamp(finite(phase.dissipation, this._fallbackDissipationPhase()), 0, 1),
      clamp(finite(phase.rise, this._fallbackRisePhase()), 0, 1),
    ];
    const numericQuality = Number.isFinite(options.quality)
      ? clamp(Number(options.quality), 0.35, 1)
      : 1;
    const raySteps = Math.max(8, Math.min(48, Math.round(this.tier.raySteps * numericQuality)));
    this._lastRaySteps = raySteps;
    const requestedLayers = Array.isArray(options.layerVisibility)
      ? options.layerVisibility
      : [1, 1, 1, 1];
    const layerVisibility = [0, 1, 2, 3].map((index) => {
      const value = requestedLayers[index];
      return value === undefined ? 1 : clamp(finite(value, 1), 0, 1);
    });

    try {
      if (collectDebugMetrics) this._collectDebugMetrics(Boolean(options.forceMetrics));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this._draw('volume', null, (program) => {
        this._texture(program, 'uVelocity', this._targets.velocity.read.texture, 0);
        this._texture(program, 'uScalar', this._targets.scalar.read.texture, 1);
        this._texture(program, 'uCurl', this._targets.curl.texture, 2);
        this._texture(program, 'uPressure', this._targets.pressure.read.texture, 3);
        this._texture(program, 'uDivergence', this._targets.divergence.texture, 4);
        this._texture3D(program, 'uCurlDetail', this._detailTexture, 5);
        this._uniform2f(program, 'uTexel', 1 / this.gridWidth, 1 / this.gridHeight);
        this._uniform2f(program, 'uResolution', this.width, this.height);
        this._uniform2f(program, 'uOrigin', originX, originY);
        this._uniform2f(program, 'uVolumeScale', volumeScale[0], volumeScale[1]);
        const sourceCenter = this._sourceCenter();
        this._uniform2f(program, 'uSourceCenter', sourceCenter[0], sourceCenter[1]);
        this._uniform4f(program, 'uPhase', ...phaseValues);
        this._uniform1f(program, 'uTime', this.simulationTime);
        this._uniform1f(
          program,
          'uExposure',
          (1.02 + this.settings.energy * 0.12) * (this.settings.exposureBoost || 1),
        );
        this._uniform1f(program, 'uReducedMotion', this.settings.reducedMotion ? 1 : 0);
        this._uniform1i(program, 'uDiagnostic', diagnostic);
        this._uniform1i(program, 'uRaySteps', raySteps);
        this._uniform1ui(program, 'uSeed', this.settings.seed);
        this._uniform4f(program, 'uLayerVisibility', ...layerVisibility);
        this._bindVolumeShockwaveUniforms(program);
        this._bindVolumeProfileUniforms(program);
        this._bindPaletteUniforms(program);
      }, this.width, this.height);
      if (diagnostic === RESEARCH_FLUID_DIAGNOSTICS.beauty
        || diagnostic === RESEARCH_FLUID_DIAGNOSTICS.tracers) {
        this._renderTracerPoints({
          diagnostic,
          originX,
          originY,
          volumeScale,
          sourceCenter: this._sourceCenter(),
          layerVisibility,
        });
      }
      gl.flush();
      this._assertNoGlError('fluid volume render');
      return true;
    } catch (error) {
      this._runtimeFailure('The fluid volume render failed.', error);
      return false;
    }
  }

  getStats() {
    return {
      available: this.available,
      webgl2Available: Boolean(this.gl && !this._contextLost),
      reason: this.available ? null : this.reason,
      backend: this.available ? 'webgl2-fluid' : 'unavailable',
      presetId: this.settings.presetId,
      profileId: this.profile.profileId,
      fluidProfile: this.profile.profileId,
      eventFamily: this.settings.eventFamily || this.profile.eventFamily,
      eventFamilyId: this.settings.eventFamilyId || this.profile.eventFamilyId,
      physicalFamilyId: this.settings.physicalFamilyId || this.profile.physicalFamilyId,
      sourcePrimitives: [...this.settings.sourcePrimitives],
      sourcePrimitiveMask: this.settings.sourcePrimitiveMask,
      tracerType: this.profile.tracerType,
      paletteId: this.settings.palette.id,
      format: this._format?.label || null,
      tier: this.tier.id,
      gridLongSide: this.tier.gridLongSide,
      gridShortSideMinimum: this.tier.gridShortSideMinimum,
      performanceProfile: { ...this.profile.quality },
      width: this.width,
      height: this.height,
      gridWidth: this.gridWidth,
      gridHeight: this.gridHeight,
      fixedStep: this.tier.fixedStep,
      simulationTimestep: this.tier.fixedStep,
      time: this.time,
      simulationTime: this.simulationTime,
      stepIndex: this.stepIndex,
      fluidSteps: this.stepIndex,
      simulationSteps: this._simulationSteps,
      pressureIterations: this.tier.pressureIterations,
      raySteps: this._lastRaySteps,
      volumeSlices: this._lastRaySteps,
      tracerCount: this._targets?.tracers?.count ?? this.tier.tracerCount,
      detailTexture: this._detailSize > 0
        ? `${this._detailSize} × ${this._detailSize} × ${this._detailSize}`
        : null,
      detailTextureSize: this._detailSize,
      detailResolution: this.tier.detailResolution,
      estimatedGpuBytes: this._estimatedGpuBytes(),
      diagnostic: diagnosticName(this._lastDiagnostic),
      debugMetricsEnabled: this._debugMetricsActive || this._debugMetricsEnabled,
      metricsSampledStep: this._metrics.sampledStep,
      velocityMagnitude: this._metrics.velocityMagnitude,
      currentVelocityMagnitude: this._metrics.velocityMagnitude,
      maximumTemperature: this._metrics.maximumTemperature,
      currentMaximumTemperature: this._metrics.maximumTemperature,
      smokeDensity: this._metrics.smokeDensity,
      currentSmokeDensity: this._metrics.smokeDensity,
      vorticityMagnitude: this._metrics.vorticityMagnitude,
      currentVorticityMagnitude: this._metrics.vorticityMagnitude,
      metrics: { ...this._metrics },
      renderDomain: this._renderDomain ? { ...this._renderDomain } : null,
      drawCalls: this._drawCalls,
      resets: this._resets,
      contextLost: this._contextLost,
      lastGlError: this._lastGlError ? { ...this._lastGlError } : null,
      probeAttempts: this._probeAttempts.map((attempt) => ({ ...attempt })),
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._removeContextListeners();
    this._releaseResources();
    this.available = false;
    this.reason = 'Fluid engine destroyed.';
    this.gl = null;
  }

  _installContextListeners() {
    if (!this.canvas?.addEventListener) return;
    this.canvas.addEventListener('webglcontextlost', this._boundContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this._boundContextRestored, false);
  }

  _removeContextListeners() {
    if (!this.canvas?.removeEventListener) return;
    this.canvas.removeEventListener('webglcontextlost', this._boundContextLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this._boundContextRestored, false);
  }

  _initializeContext() {
    if (!this.canvas || this.destroyed) return false;
    let gl;
    try {
      gl = this.canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: this._ownsCanvas,
        desynchronized: true,
        powerPreference: 'high-performance',
      });
    } catch (error) {
      this.reason = `WebGL2 context creation failed: ${error?.message || error}`;
      return false;
    }
    if (!gl) {
      this.reason = 'WebGL2 is unavailable; use the existing Canvas2D renderer.';
      return false;
    }

    this.gl = gl;
    this._lastGlError = null;
    this._probeAttempts = [];
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this._format = this._probeFramebufferFormat();
    if (!this._format) {
      this.reason = 'Renderable floating-point or half-float framebuffers are unavailable.';
      this.gl = gl;
      return false;
    }

    try {
      this._vao = gl.createVertexArray();
      if (!this._vao) throw new Error('Unable to allocate a fullscreen vertex array.');
      gl.bindVertexArray(this._vao);
      this._programs = Object.create(null);
      const definitions = [
        ['advect', FULLSCREEN_VERTEX, ADVECT_FRAGMENT],
        ['curl', FULLSCREEN_VERTEX, CURL_FRAGMENT],
        ['force', FULLSCREEN_VERTEX, FORCE_FRAGMENT],
        ['scalar', FULLSCREEN_VERTEX, SCALAR_FRAGMENT],
        ['divergence', FULLSCREEN_VERTEX, DIVERGENCE_FRAGMENT],
        ['jacobi', FULLSCREEN_VERTEX, JACOBI_FRAGMENT],
        ['project', FULLSCREEN_VERTEX, PROJECT_FRAGMENT],
        ['metrics', FULLSCREEN_VERTEX, METRICS_FRAGMENT],
        ['tracerAdvect', FULLSCREEN_VERTEX, TRACER_ADVECT_FRAGMENT],
        ['tracerDisplay', TRACER_VERTEX, TRACER_FRAGMENT],
        [
          'volume',
          FULLSCREEN_VERTEX,
          this.tier.id === 'balanced' ? BALANCED_VOLUME_FRAGMENT : VOLUME_FRAGMENT,
        ],
      ];
      for (const [name, vertexSource, fragmentSource] of definitions) {
        this._programs[name] = this._createProgram(name, vertexSource, fragmentSource);
      }
      this.available = true;
      this.reason = null;
      this._contextLost = false;
      return true;
    } catch (error) {
      this._releaseResources();
      this.available = false;
      this.reason = `Fluid shader initialization failed: ${error?.message || error}`;
      return false;
    }
  }

  _probeFramebufferFormat() {
    const gl = this.gl;
    const candidates = [
      {
        label: 'rgba16f',
        internalFormat: gl.RGBA16F,
        format: gl.RGBA,
        type: gl.HALF_FLOAT,
        bytesPerChannel: 2,
      },
      {
        label: 'rgba32f',
        internalFormat: gl.RGBA32F,
        format: gl.RGBA,
        type: gl.FLOAT,
        bytesPerChannel: 4,
      },
    ];
    for (const candidate of candidates) {
      const texture = gl.createTexture();
      const framebuffer = gl.createFramebuffer();
      let status = 0;
      let errorCode = 0;
      try {
        for (let index = 0; index < 8 && gl.getError() !== gl.NO_ERROR; index += 1) {
          // Clear a bounded number of unrelated startup errors before probing.
        }
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          candidate.internalFormat,
          4,
          4,
          0,
          candidate.format,
          candidate.type,
          null,
        );
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        gl.viewport(0, 0, 4, 4);
        gl.clearColor(0.125, 0.25, 0.5, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        errorCode = gl.getError();
      } catch {
        status = 0;
        errorCode = -1;
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        if (framebuffer) gl.deleteFramebuffer(framebuffer);
        if (texture) gl.deleteTexture(texture);
      }
      const supported = status === gl.FRAMEBUFFER_COMPLETE && errorCode === gl.NO_ERROR;
      this._probeAttempts.push({
        label: candidate.label,
        supported,
        framebufferStatus: status,
        errorCode,
      });
      if (supported) return candidate;
    }
    return null;
  }

  _createProgram(name, vertexSource, fragmentSource) {
    const gl = this.gl;
    let vertex = null;
    let fragment = null;
    let program = null;
    let completed = false;
    try {
      vertex = this._compileShader(gl.VERTEX_SHADER, vertexSource, `${name} vertex`);
      fragment = this._compileShader(gl.FRAGMENT_SHADER, fragmentSource, `${name} fragment`);
      program = gl.createProgram();
      if (!program) throw new Error(`Unable to allocate the ${name} program.`);
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
      const log = gl.getProgramInfoLog(program) || '';
      if (!linked) throw new Error(`${name} program link failed${log ? `: ${log}` : '.'}`);
      completed = true;
      return { name, program, uniforms: new Map() };
    } finally {
      if (program && vertex) gl.detachShader(program, vertex);
      if (program && fragment) gl.detachShader(program, fragment);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      if (program && !completed) gl.deleteProgram(program);
    }
  }

  _compileShader(type, source, name) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error(`Unable to allocate the ${name} shader.`);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || 'No compiler log was provided.';
      gl.deleteShader(shader);
      throw new Error(`${name} (${shaderLabel(type)}) compile failed: ${log}`);
    }
    return shader;
  }

  _allocateTargets() {
    this._releaseTargets();
    this._releaseMetricResources();
    this._targets = Object.create(null);
    try {
      this._ensureDetailTexture();
      this._targets.velocity = this._createPair('velocity');
      this._targets.scalar = this._createPair('scalar');
      this._targets.pressure = this._createPair('pressure');
      this._targets.divergence = this._createTarget('divergence');
      this._targets.curl = this._createTarget('curl');
      this._targets.tracers = this._createPair('tracer', this.tier.tracerCount, 1);
      this._targets.tracers.count = this.tier.tracerCount;
    } catch (error) {
      this._releaseTargets();
      throw error;
    }
  }

  _createPair(label, width = this.gridWidth, height = this.gridHeight) {
    const read = this._createTarget(`${label}-a`, width, height);
    try {
      return {
        read,
        write: this._createTarget(`${label}-b`, width, height),
      };
    } catch (error) {
      this.gl.deleteFramebuffer(read.framebuffer);
      this.gl.deleteTexture(read.texture);
      throw error;
    }
  }

  _createTarget(label, width = this.gridWidth, height = this.gridHeight) {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      if (texture) gl.deleteTexture(texture);
      throw new Error(`Unable to allocate ${label}.`);
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this._format.internalFormat,
      width,
      height,
      0,
      this._format.format,
      this._format.type,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error(`${label} framebuffer is incomplete (${status}).`);
    }
    return { label, texture, framebuffer, width, height };
  }

  _createByteTarget(label, width, height) {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      if (texture) gl.deleteTexture(texture);
      throw new Error(`Unable to allocate ${label}.`);
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error(`${label} framebuffer is incomplete (${status}).`);
    }
    return { label, texture, framebuffer, width, height, bytesPerTexel: 4 };
  }

  _ensureMetricResources() {
    const pixelCount = this.gridWidth * this.gridHeight * 4;
    const targetMatches = this._metricTarget
      && this._metricTarget.width === this.gridWidth
      && this._metricTarget.height === this.gridHeight;
    if (!targetMatches) {
      this._releaseMetricResources();
      this._metricTarget = this._createByteTarget(
        'debug-metrics',
        this.gridWidth,
        this.gridHeight,
      );
    }
    if (!this._metricPixels || this._metricPixels.length !== pixelCount) {
      this._metricPixels = new Uint8Array(pixelCount);
    }
  }

  _collectDebugMetrics(force = false) {
    if (!this.gl || !this._targets) return;
    // Six updates per simulated second are enough for a readable developer HUD
    // and avoid turning a diagnostic readback into a normal-frame GPU stall.
    if (!force && this._metricStepIndex >= 0 && this.stepIndex - this._metricStepIndex < 5) return;
    this._ensureMetricResources();
    const gl = this.gl;
    const target = this._metricTarget;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    this._draw('metrics', target, (program) => {
      this._texture(program, 'uVelocity', this._targets.velocity.read.texture, 0);
      this._texture(program, 'uScalar', this._targets.scalar.read.texture, 1);
      this._texture(program, 'uCurl', this._targets.curl.texture, 2);
    }, target.width, target.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.readPixels(
      0,
      0,
      target.width,
      target.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this._metricPixels,
    );
    this._assertNoGlError('debug field metric readback');

    let velocityByte = 0;
    let temperatureByte = 0;
    let smokeByte = 0;
    let vorticityByte = 0;
    const domain = this._domainState();
    const densityThresholdByte = Math.round(domain.densityThreshold / 4 * 255);
    const riskMarginX = Math.max(1, Math.round(this.gridWidth * domain.riskMargin));
    const riskMarginY = Math.max(1, Math.round(this.gridHeight * domain.riskMargin));
    let activeCells = 0;
    let riskCells = 0;
    let minX = this.gridWidth;
    let maxX = -1;
    let minY = this.gridHeight;
    let maxY = -1;
    let leftEdge = 0;
    let rightEdge = 0;
    let bottomEdge = 0;
    let topEdge = 0;
    for (let offset = 0; offset < this._metricPixels.length; offset += 4) {
      velocityByte = Math.max(velocityByte, this._metricPixels[offset]);
      temperatureByte = Math.max(temperatureByte, this._metricPixels[offset + 1]);
      smokeByte = Math.max(smokeByte, this._metricPixels[offset + 2]);
      vorticityByte = Math.max(vorticityByte, this._metricPixels[offset + 3]);
      const cell = offset / 4;
      const x = cell % this.gridWidth;
      const y = Math.floor(cell / this.gridWidth);
      const density = this._metricPixels[offset + 2];
      if (density < densityThresholdByte) continue;
      activeCells += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (x < riskMarginX || x >= this.gridWidth - riskMarginX
        || y < riskMarginY || y >= this.gridHeight - riskMarginY) riskCells += 1;
      if (x === 0) leftEdge = Math.max(leftEdge, density);
      if (x === this.gridWidth - 1) rightEdge = Math.max(rightEdge, density);
      if (y === 0) bottomEdge = Math.max(bottomEdge, density);
      if (y === this.gridHeight - 1) topEdge = Math.max(topEdge, density);
    }
    this._metrics.velocityMagnitude = velocityByte / 255 * 1.4;
    this._metrics.maximumTemperature = temperatureByte / 255 * 4;
    this._metrics.smokeDensity = smokeByte / 255 * 4;
    this._metrics.vorticityMagnitude = vorticityByte / 255 * 1.4;
    const activeDensityBounds = activeCells > 0 ? {
      minX: minX / Math.max(1, this.gridWidth - 1),
      maxX: maxX / Math.max(1, this.gridWidth - 1),
      minY: minY / Math.max(1, this.gridHeight - 1),
      maxY: maxY / Math.max(1, this.gridHeight - 1),
      activeCells,
      threshold: domain.densityThreshold,
    } : null;
    this._metrics.activeDensityBounds = activeDensityBounds;
    const visibleBounds = this._renderDomain?.viewportFieldBounds || null;
    const viewportClearance = activeDensityBounds && visibleBounds ? {
      left: activeDensityBounds.minX - visibleBounds.left,
      right: visibleBounds.right - activeDensityBounds.maxX,
      bottom: activeDensityBounds.minY - visibleBounds.bottom,
      top: visibleBounds.top - activeDensityBounds.maxY,
    } : null;
    this._metrics.boundaryRisk = {
      margin: domain.riskMargin,
      activeCells,
      riskCells,
      riskPercent: activeCells > 0 ? riskCells / activeCells : 0,
      maxDensityAtEdge: {
        left: leftEdge / 255 * 4,
        right: rightEdge / 255 * 4,
        bottom: bottomEdge / 255 * 4,
        top: topEdge / 255 * 4,
      },
      touchesMediumDensity: {
        left: leftEdge >= densityThresholdByte,
        right: rightEdge >= densityThresholdByte,
        bottom: bottomEdge >= densityThresholdByte,
        top: topEdge >= densityThresholdByte,
      },
      // The viewport values distinguish natural offscreen continuation from a
      // scalar-grid collision. Negative clearance is permitted: it means the
      // camera has cropped an otherwise valid field, not that the renderer
      // has clipped the volume at a computational border.
      viewportClearance,
    };
    this._metrics.sampledStep = this.stepIndex;
    this._metricStepIndex = this.stepIndex;
  }

  _ensureDetailTexture() {
    const gl = this.gl;
    if (!gl) throw new Error('WebGL2 is unavailable for the curl-detail texture.');
    const size = clamp(Math.round(finite(this.tier.detailResolution, 16)), 8, 48);
    const signature = `${this.settings.seed}|${this.tier.id}|${size}`;
    if (this._detailTexture && this._detailSignature === signature) return;

    const data = buildCurlDetailVolume(size, this.settings.seed);
    const texture = gl.createTexture();
    if (!texture) throw new Error('Unable to allocate the 3D curl-detail texture.');
    let errorCode = gl.NO_ERROR;
    let uploadFailure = null;
    try {
      for (let index = 0; index < 8 && gl.getError() !== gl.NO_ERROR; index += 1) {
        // Clear a bounded number of unrelated startup errors before uploading.
      }
      gl.bindTexture(gl.TEXTURE_3D, texture);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.RGBA8,
        size,
        size,
        size,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        data,
      );
      errorCode = gl.getError();
    } catch (error) {
      uploadFailure = error;
    } finally {
      gl.bindTexture(gl.TEXTURE_3D, null);
    }
    if (uploadFailure || errorCode !== gl.NO_ERROR) {
      gl.deleteTexture(texture);
      if (uploadFailure) throw uploadFailure;
      throw new Error(`3D curl-detail upload failed (${errorCode}).`);
    }

    if (this._detailTexture) gl.deleteTexture(this._detailTexture);
    this._detailTexture = texture;
    this._detailSize = size;
    this._detailSignature = signature;
  }

  _resetState() {
    if (!this.gl || !this._targets) return;
    const gl = this.gl;
    for (const target of this._allTargets()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.time = 0;
    this.simulationTime = 0;
    this.stepIndex = 0;
    this._metricStepIndex = -1;
    this._metrics.velocityMagnitude = 0;
    this._metrics.maximumTemperature = 0;
    this._metrics.smokeDensity = 0;
    this._metrics.vorticityMagnitude = 0;
    this._metrics.activeDensityBounds = null;
    this._metrics.boundaryRisk = null;
    this._metrics.sampledStep = null;
    this._resets += 1;
  }

  _domainState() {
    const domain = this.profile.domain || BASE_PROFILE.domain;
    const mode = Number(domain.mode) > 0;
    const padding = mode ? clamp(finite(domain.padding, 0), 0, 0.3) : 0;
    const activeScale = mode ? Math.max(0.4, 1 - padding * 2) : 1;
    const renderOverscan = mode ? clamp(finite(domain.renderOverscan, 1), 1, 1.3) : 1;
    const renderScaleValue = domain.renderScale && typeof domain.renderScale === 'object'
      ? domain.renderScale[this.tier?.id || this.settings?.tier || 'balanced']
      : domain.renderScale;
    const renderScale = clamp(finite(renderScaleValue, 1), 0.55, 1);
    const renderExtent = domain.renderExtent && typeof domain.renderExtent === 'object'
      ? {
        x: clamp(finite(domain.renderExtent.x, 1), 0.5, 2),
        y: clamp(finite(domain.renderExtent.y, 1), 0.5, 2),
      }
      : null;
    return {
      mode: mode ? 1 : 0,
      padding,
      activeScale,
      renderOverscan: renderOverscan / activeScale,
      renderScale,
      renderExtent,
      riskMargin: clamp(finite(domain.riskMargin, 0.06), 0.02, 0.2),
      densityThreshold: clamp(finite(domain.densityThreshold, 0.14), 0.02, 1),
    };
  }

  getRenderResolutionScale() {
    return this._domainState().renderScale;
  }

  _sourceUniformState() {
    const source = this.profile.source;
    const domain = this._domainState();
    const coordinateScale = domain.activeScale;
    const mapY = (value) => 0.5 + (value - 0.5) * coordinateScale;
    const offsets = seededProfileOffsets(this.settings.seed, this.profile.profileKind);
    const researchRegression = Boolean(this.profile.preserveResearchSource);
    return {
      mask: this.settings.sourcePrimitiveMask,
      profileKind: this.profile.profileKind,
      shape: [source.radius * coordinateScale, source.aspectX, source.aspectY, mapY(source.groundLevel)],
      timing: [source.onsetEnd, source.sustainEnd, source.pulseFrequency, source.stageOffset],
      motion: [source.radial * coordinateScale, source.vertical * coordinateScale, source.directional * coordinateScale, source.turbulence * coordinateScale],
      scalar: [source.heat, source.smoke, source.incandescent, source.dust],
      vector: [
        source.directionX,
        source.directionY,
        (source.offsetX + offsets[6] * (researchRegression ? 0 : source.radius * 0.24)) * coordinateScale,
        (source.offsetY + offsets[7] * (researchRegression ? 0 : source.radius * 0.24) * 0.72) * coordinateScale,
      ],
      aux: [source.ringRadius, source.ejecta, source.trailLength, source.clusterSpread],
      offsetsA: offsets.slice(0, 4),
      offsetsB: offsets.slice(4, 8),
      physics: [
        this.profile.physics.buoyancy * coordinateScale,
        this.profile.physics.densityLoading * coordinateScale,
        this.profile.physics.windCoupling * coordinateScale,
        this.profile.physics.vorticity * coordinateScale,
      ],
      decay: [
        this.profile.physics.velocityRetention,
        this.profile.physics.cooling,
        this.profile.physics.smokeConversion,
        this.profile.physics.scalarRetention,
      ],
      profileAux: [
        source.capScale * clamp(finite(this.settings.capWidthBoost, 1), 0.6, 1.6),
        finite(source.capRoll, 1),
        0,
        0,
      ],
    };
  }

  _bindSourceProfileUniforms(program, state = this._sourceUniformState()) {
    this._uniform1ui(program, 'uSourceMask', state.mask);
    this._uniform1i(program, 'uProfileKind', state.profileKind);
    this._uniform4f(program, 'uSourceShape', ...state.shape);
    this._uniform4f(program, 'uSourceTiming', ...state.timing);
    this._uniform4f(program, 'uSourceMotion', ...state.motion);
    this._uniform4f(program, 'uSourceScalar', ...state.scalar);
    this._uniform4f(program, 'uSourceVector', ...state.vector);
    this._uniform4f(program, 'uSourceAux', ...state.aux);
    this._uniform4f(program, 'uSeedOffsetsA', ...state.offsetsA);
    this._uniform4f(program, 'uSeedOffsetsB', ...state.offsetsB);
    this._uniform4f(program, 'uProfilePhysics', ...state.physics);
    this._uniform4f(program, 'uProfileDecay', ...state.decay);
    this._uniform4f(program, 'uProfileAux', ...state.profileAux);
    this._uniform1f(program, 'uDomainActiveScale', this._domainState().activeScale);
    const groundCoupling = this.profile.groundCoupling || BASE_PROFILE.groundCoupling;
    this._uniform1f(program, 'uGroundCouplingMode', groundCoupling.mode > 0 ? 1 : 0);
    this._uniform1f(program, 'uGroundSpreadWidth', finite(groundCoupling.spreadWidth, 1));
    this._uniform4f(
      program,
      'uGroundCouplingA',
      finite(groundCoupling.radialImpulse, 0),
      finite(groundCoupling.heightFalloff, 1),
      finite(groundCoupling.horizontalRetention, 1),
      finite(groundCoupling.verticalDamping, 1),
    );
    this._uniform4f(
      program,
      'uGroundCouplingB',
      finite(groundCoupling.spreadStart, 0),
      finite(groundCoupling.spreadEnd, 0),
      finite(groundCoupling.angularVariation, 0),
      finite(groundCoupling.asymmetry, 0),
    );
    this._uniform4f(
      program,
      'uGroundCouplingC',
      finite(groundCoupling.surfaceHeat, 0),
      finite(groundCoupling.baseDust, 0),
      finite(groundCoupling.transitionLift, 0),
      finite(groundCoupling.lateGroundDrift, 0),
    );
    const plume = this.profile.plume || { mode: 0, expansion: 0, vortex: 0, persistence: 0, widen: 0 };
    this._uniform1f(program, 'uPlumeMode', clamp(finite(plume.mode, 0), 0, 3));
    this._uniform4f(
      program,
      'uPlumeParams',
      finite(plume.expansion, 0),
      finite(plume.vortex, 0),
      finite(plume.persistence, 0),
      finite(plume.widen, 0),
    );
    this._uniform4f(
      program,
      'uPlumeStemParams',
      finite(plume.feedTaperStart, 0.85),
      finite(plume.feedTaperEnd, 1.05),
      finite(plume.lateralJitter, 0),
      finite(plume.turbulenceBlend, 0),
    );
    const dissipation = this.profile.dissipation || {
      mode: 0, lateStart: 1, finalStart: 1, sourceTaperEnd: 1,
      retentionFloorSmoke: 1, retentionFloorDust: 1, outwardBoost: 0, buoyancyFalloff: 0, motionDamp: 0,
      lateVelocityRetention: 1, lateCurl: 0, lateShear: 0, latePhaseRate: 0,
    };
    this._uniform1f(program, 'uDissipationMode', dissipation.mode > 0 ? 1 : 0);
    this._uniform4f(
      program,
      'uDissipationParams',
      finite(dissipation.lateStart, 1),
      finite(dissipation.finalStart, 1),
      finite(dissipation.retentionFloorSmoke, 1),
      finite(dissipation.retentionFloorDust, 1),
    );
    this._uniform4f(
      program,
      'uDissipationParams2',
      finite(dissipation.sourceTaperEnd, 1),
      finite(dissipation.outwardBoost, 0),
      finite(dissipation.buoyancyFalloff, 0),
      finite(dissipation.motionDamp, 0),
    );
    this._uniform4f(
      program,
      'uDissipationParams3',
      finite(dissipation.lateVelocityRetention, 1),
      finite(dissipation.lateCurl, 0),
      finite(dissipation.lateShear, 0),
      finite(dissipation.latePhaseRate, 0),
    );
    const shockwave = this.profile.shockwave || BASE_PROFILE.shockwave;
    this._uniform1f(program, 'uShockwaveMode', clamp(finite(shockwave.mode, 0), 0, 2));
    const bindShockwaveRing = (name, ring) => {
      this._uniform4f(
        program,
        name,
        finite(ring?.radiusOffset, 0),
        finite(ring?.widthScale, 1),
        finite(ring?.strength, 0),
        finite(ring?.phaseOffset, 0),
      );
    };
    bindShockwaveRing('uShockwaveRingB', shockwave.ringB);
    bindShockwaveRing('uShockwaveRingC', shockwave.ringC);
    bindShockwaveRing('uShockwaveRingD', shockwave.ringD);
    this._uniform4f(
      program,
      'uShockwaveAux',
      finite(shockwave.irregularity, 0),
      finite(shockwave.fadeStart, 1),
      finite(shockwave.fadeSpan, 0.001),
      0,
    );
  }

  _bindVolumeProfileUniforms(program) {
    const volume = this.profile.volume;
    this._uniform4f(
      program,
      'uVolumeProfile0',
      volume.depth,
      volume.opacity,
      volume.shadow,
      volume.bloom,
    );
    this._uniform4f(
      program,
      'uVolumeProfile1',
      volume.distortion,
      volume.erosion,
      volume.noiseScale,
      volume.dustVisibility,
    );
    this._uniform4f(
      program,
      'uVolumeProfile2',
      volume.exposure,
      volume.toneMap,
      volume.backgroundIllumination,
      volume.emissionCurve,
    );
    this._uniform1f(program, 'uDomainDensityThreshold', this._domainState().densityThreshold);
    const material = this.profile.material || { mode: 0, sootAbsorption: 1, dustAbsorption: 1, detailBoost: 0, warmCoolContrast: 0, detailOctaveMode: 0, interiorDepth: 0 };
    this._uniform1f(program, 'uMaterialMode', material.mode > 0 ? 1 : 0);
    this._uniform1f(program, 'uDetailOctaveMode', material.detailOctaveMode > 0 ? 1 : 0);
    this._uniform1f(program, 'uMaterialInteriorDepth', finite(material.interiorDepth, 0));
    this._uniform4f(
      program,
      'uMaterialParams',
      finite(material.sootAbsorption, 1),
      finite(material.dustAbsorption, 1),
      finite(material.detailBoost, 0),
      finite(material.warmCoolContrast, 0),
    );
    const core = this.profile.core
      || { mode: 0, highlightThreshold: 1.5, highlightSharpness: 2.0, structureBlend: 0, bloomGateScale: 0 };
    this._uniform1f(program, 'uCoreMode', core.mode > 0 ? 1 : 0);
    this._uniform4f(
      program,
      'uCoreParams',
      finite(core.highlightThreshold, 1.5),
      finite(core.highlightSharpness, 2.0),
      finite(core.structureBlend, 0),
      finite(core.bloomGateScale, 0),
    );
    const edge = this.profile.edge || BASE_PROFILE.edge;
    this._uniform1f(program, 'uEdgeMode', clamp(finite(edge.mode, 0), 0, 3));
    this._uniform4f(
      program,
      'uEdgeProfile0',
      finite(edge.center, 0.5),
      finite(edge.centerAsymmetry, 0),
      finite(edge.leftRadius, 0.42),
      finite(edge.rightRadius, 0.42),
    );
    this._uniform4f(
      program,
      'uEdgeProfile1',
      finite(edge.leftWobble, 0),
      finite(edge.rightWobble, 0),
      finite(edge.topRadius, 0.46),
      finite(edge.topWobble, 0),
    );
    this._uniform4f(
      program,
      'uEdgeProfile2',
      finite(edge.fadeStart, 0.55),
      finite(edge.fadeEnd, 1),
      finite(edge.distanceWobble, 0),
      finite(edge.lowDensityStart, 0),
    );
    this._uniform4f(
      program,
      'uEdgeProfile3',
      finite(edge.lowDensityEnd, 1),
      finite(edge.lowDensityAttenuation, 0),
      0,
      0,
    );
  }

  _bindVolumeShockwaveUniforms(program) {
    const shockwave = this.profile.shockwave || BASE_PROFILE.shockwave;
    const source = this.profile.source;
    this._uniform1f(program, 'uShockwaveMode', clamp(finite(shockwave.mode, 0), 0, 2));
    this._uniform4f(
      program,
      'uShockwaveVolumeShape',
      finite(source.radius, 0.08),
      finite(source.aspectX, 1),
      finite(source.aspectY, 1),
      finite(source.ringRadius, 0.08),
    );
    this._uniform4f(
      program,
      'uShockwaveAux',
      finite(shockwave.denseIrregularity, 0),
      finite(shockwave.denseFadeStart, 0),
      finite(shockwave.denseFadeSpan, 0.001),
      clamp(this.simulationTime / Math.max(0.001, this.settings.duration), 0, 1),
    );
    const denseBandCount = this.tier.id === 'high'
      ? finite(shockwave.denseBandsHigh, 0)
      : this.tier.id === 'mobile'
        ? finite(shockwave.denseBandsMobile, 0)
        : finite(shockwave.denseBandsBalanced, 0);
    this._uniform4f(
      program,
      'uShockwaveDenseA',
      denseBandCount,
      finite(shockwave.denseInnerRadius, 0),
      finite(shockwave.denseOuterRadius, 0),
      finite(shockwave.denseSpacingVariation, 0),
    );
    this._uniform4f(
      program,
      'uShockwaveDenseB',
      finite(shockwave.denseWidthMin, 0),
      finite(shockwave.denseWidthMax, 0),
      finite(shockwave.denseInnerStrength, 0),
      finite(shockwave.denseOuterStrength, 0),
    );
    this._uniform4f(
      program,
      'uShockwaveDenseC',
      finite(shockwave.denseSegmentVariation, 0),
      finite(shockwave.denseDepthContrast, 0),
      finite(shockwave.denseOnsetSpread, 0),
      finite(shockwave.denseFadeVariation, 0),
    );
  }

  _bindPaletteUniforms(program) {
    const palette = this.settings.palette;
    this._uniform3f(program, 'uPaletteBackground', ...palette.background);
    this._uniform3f(program, 'uPaletteEmber', ...palette.ember);
    this._uniform3f(program, 'uPaletteFlame', ...palette.flame);
    this._uniform3f(program, 'uPaletteHot', ...palette.hot);
    this._uniform3f(program, 'uPaletteCore', ...palette.core);
    this._uniform3f(program, 'uPaletteSmoke', ...palette.smoke);
    this._uniform3f(program, 'uPaletteSmokeLight', ...palette.smokeLight);
    this._uniform3f(program, 'uPaletteCloud', ...palette.cloud);
    this._uniform3f(program, 'uPaletteDust', ...palette.dust);
  }

  _stepSimulation(stepTime, dt) {
    const gl = this.gl;
    const targets = this._targets;
    const texelX = 1 / this.gridWidth;
    const texelY = 1 / this.gridHeight;
    const normalizedTime = clamp(stepTime / this.settings.duration, 0, 1.5);
    const sourceCenter = this._sourceCenter();
    const sourceUniforms = this._sourceUniformState();
    const windAngle = this.settings.windDirection / 360 * TAU;
    // Softened coupling keeps late clouds drifting believably instead of
    // accelerating out of the simulation domain before the timeline ends.
    const wind = [
      Math.sin(windAngle) * this.settings.windStrength * 0.052,
      -Math.cos(windAngle) * this.settings.windStrength * 0.016,
    ];

    this._draw('advect', targets.velocity.write, (program) => {
      this._texture(program, 'uVelocity', targets.velocity.read.texture, 0);
      this._texture(program, 'uSource', targets.velocity.read.texture, 1);
      this._uniform1f(program, 'uDt', dt);
      this._uniform4f(program, 'uDecay', this.tier.velocityDecay, this.tier.velocityDecay, 1, 1);
    }, this.gridWidth, this.gridHeight);
    this._swap(targets.velocity);

    this._draw('advect', targets.scalar.write, (program) => {
      this._texture(program, 'uVelocity', targets.velocity.read.texture, 0);
      this._texture(program, 'uSource', targets.scalar.read.texture, 1);
      this._uniform1f(program, 'uDt', dt);
      this._uniform4f(program, 'uDecay',
        this.tier.scalarDecay,
        this.tier.scalarDecay,
        this.tier.scalarDecay,
        this.tier.scalarDecay,
      );
    }, this.gridWidth, this.gridHeight);
    this._swap(targets.scalar);

    this._draw('curl', targets.curl, (program) => {
      this._texture(program, 'uVelocity', targets.velocity.read.texture, 0);
      this._uniform2f(program, 'uTexel', texelX, texelY);
    }, this.gridWidth, this.gridHeight);

    this._draw('force', targets.velocity.write, (program) => {
      this._texture(program, 'uVelocity', targets.velocity.read.texture, 0);
      this._texture(program, 'uScalar', targets.scalar.read.texture, 1);
      this._texture(program, 'uCurl', targets.curl.texture, 2);
      this._texture3D(program, 'uCurlDetail', this._detailTexture, 3);
      this._uniform2f(program, 'uTexel', texelX, texelY);
      this._uniform1f(program, 'uDt', dt);
      this._uniform1f(program, 'uTime', stepTime);
      this._uniform1f(program, 'uNormalizedTime', normalizedTime);
      this._uniform1f(program, 'uEnergy', this.settings.energy);
      this._uniform1f(program, 'uBuoyancy', this.settings.buoyancy);
      this._uniform1f(program, 'uDensityLoading', this.settings.densityLoading);
      this._uniform1f(program, 'uVorticity', this.tier.vorticity);
      this._uniform1f(program, 'uReducedMotion', this.settings.reducedMotion ? 1 : 0);
      this._uniform2f(program, 'uWind', wind[0], wind[1]);
      this._uniform2f(program, 'uSourceCenter', sourceCenter[0], sourceCenter[1]);
      this._bindSourceProfileUniforms(program, sourceUniforms);
    }, this.gridWidth, this.gridHeight);
    this._swap(targets.velocity);

    this._draw('scalar', targets.scalar.write, (program) => {
      this._texture(program, 'uScalar', targets.scalar.read.texture, 0);
      this._texture3D(program, 'uCurlDetail', this._detailTexture, 1);
      this._uniform1f(program, 'uDt', dt);
      this._uniform1f(program, 'uTime', stepTime);
      this._uniform1f(program, 'uNormalizedTime', normalizedTime);
      this._uniform1f(program, 'uEnergy', this.settings.energy);
      this._uniform1f(program, 'uSourceStrength', this.settings.sourceStrength);
      this._uniform1f(program, 'uCooling', this.settings.cooling);
      this._uniform1f(program, 'uSmokeConversion', this.settings.smokeConversion);
      this._uniform1f(program, 'uDissipation', this.settings.dissipation);
      this._uniform1f(program, 'uReducedMotion', this.settings.reducedMotion ? 1 : 0);
      this._uniform2f(program, 'uSourceCenter', sourceCenter[0], sourceCenter[1]);
      this._bindSourceProfileUniforms(program, sourceUniforms);
    }, this.gridWidth, this.gridHeight);
    this._swap(targets.scalar);

    this._draw('divergence', targets.divergence, (program) => {
      this._texture(program, 'uVelocity', targets.velocity.read.texture, 0);
      this._uniform2f(program, 'uTexel', texelX, texelY);
    }, this.gridWidth, this.gridHeight);

    for (const pressureTarget of [targets.pressure.read, targets.pressure.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, pressureTarget.framebuffer);
      gl.viewport(0, 0, this.gridWidth, this.gridHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    for (let iteration = 0; iteration < this.tier.pressureIterations; iteration += 1) {
      this._draw('jacobi', targets.pressure.write, (program) => {
        this._texture(program, 'uPressure', targets.pressure.read.texture, 0);
        this._texture(program, 'uDivergence', targets.divergence.texture, 1);
        this._uniform2f(program, 'uTexel', texelX, texelY);
      }, this.gridWidth, this.gridHeight);
      this._swap(targets.pressure);
    }

    this._draw('project', targets.velocity.write, (program) => {
      this._texture(program, 'uVelocity', targets.velocity.read.texture, 0);
      this._texture(program, 'uPressure', targets.pressure.read.texture, 1);
      this._uniform2f(program, 'uTexel', texelX, texelY);
    }, this.gridWidth, this.gridHeight);
    this._swap(targets.velocity);

    // Projection changes the velocity field. Refresh both derived fields so
    // the renderer, debug views, and metric readback inspect the projected
    // state rather than the pre-projection force field.
    this._draw('curl', targets.curl, (program) => {
      this._texture(program, 'uVelocity', targets.velocity.read.texture, 0);
      this._uniform2f(program, 'uTexel', texelX, texelY);
    }, this.gridWidth, this.gridHeight);

    this._draw('divergence', targets.divergence, (program) => {
      this._texture(program, 'uVelocity', targets.velocity.read.texture, 0);
      this._uniform2f(program, 'uTexel', texelX, texelY);
    }, this.gridWidth, this.gridHeight);

    // Tracers are a bounded GPU-only detail layer. They sample the projected
    // velocity field but never write back into velocity, scalar, or pressure.
    this._draw('tracerAdvect', targets.tracers.write, (program) => {
      this._texture(program, 'uTracers', targets.tracers.read.texture, 0);
      this._texture(program, 'uVelocity', targets.velocity.read.texture, 1);
      this._texture3D(program, 'uCurlDetail', this._detailTexture, 2);
      this._uniform1f(program, 'uDt', dt);
      this._uniform1f(program, 'uTime', stepTime);
      this._uniform1f(program, 'uNormalizedTime', normalizedTime);
      this._uniform1f(program, 'uReducedMotion', this.settings.reducedMotion ? 1 : 0);
      this._uniform2f(program, 'uSourceCenter', sourceCenter[0], sourceCenter[1]);
      this._uniform1ui(program, 'uSeed', this.settings.seed);
      this._uniform1i(program, 'uTracerType', TRACER_TYPE_IDS[this.profile.tracerType] ?? 0);
      this._bindSourceProfileUniforms(program, sourceUniforms);
    }, targets.tracers.count, 1);
    this._swap(targets.tracers);
  }

  _draw(programName, target, configureUniforms, width, height) {
    const gl = this.gl;
    const program = this._programs[programName];
    if (!program) throw new Error(`Missing fluid program: ${programName}.`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer || null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(program.program);
    gl.bindVertexArray(this._vao);
    configureUniforms?.(program);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this._drawCalls += 1;
  }

  _renderTracerPoints({ diagnostic, originX, originY, volumeScale, sourceCenter, layerVisibility }) {
    const gl = this.gl;
    const program = this._programs.tracerDisplay;
    const tracers = this._targets?.tracers;
    if (!program || !tracers?.read || tracers.count <= 0) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(program.program);
    gl.bindVertexArray(this._vao);
    this._texture(program, 'uTracers', tracers.read.texture, 0);
    this._texture(program, 'uScalar', this._targets.scalar.read.texture, 1);
    this._uniform2f(program, 'uResolution', this.width, this.height);
    this._uniform2f(program, 'uOrigin', originX, originY);
    this._uniform2f(program, 'uVolumeScale', volumeScale[0], volumeScale[1]);
    this._uniform2f(program, 'uSourceCenter', sourceCenter[0], sourceCenter[1]);
    this._uniform1f(program, 'uReducedMotion', this.settings.reducedMotion ? 1 : 0);
    this._uniform1i(program, 'uDiagnostic', diagnostic);
    const tracerType = TRACER_TYPE_IDS[this.profile.tracerType] ?? 0;
    this._uniform1i(program, 'uTracerType', tracerType);
    this._uniform4f(program, 'uLayerVisibility', ...layerVisibility);
    this._uniform3f(program, 'uTracerColorA', ...this.settings.palette.ember);
    this._uniform3f(program, 'uTracerColorB', ...this.settings.palette.hot);
    this._uniform3f(
      program,
      'uTracerColorC',
      ...(tracerType === TRACER_TYPE_IDS['plasma-filament']
        ? this.settings.palette.plasma
        : this.settings.palette.dust),
    );
    this._uniform1ui(program, 'uSeed', this.settings.seed);
    const tracerMaterial = this.profile.tracerMaterial
      || { mode: 0, occlusionStrength: 0, sizeVariance: 0, brightnessVariance: 0, minSizeFloor: 0 };
    this._uniform1f(program, 'uTracerMaterialMode', tracerMaterial.mode > 0 ? 1 : 0);
    this._uniform4f(
      program,
      'uTracerMaterialParams',
      finite(tracerMaterial.occlusionStrength, 0),
      finite(tracerMaterial.sizeVariance, 0),
      finite(tracerMaterial.brightnessVariance, 0),
      finite(tracerMaterial.minSizeFloor, 0),
    );
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, tracers.count);
    gl.disable(gl.BLEND);
    this._drawCalls += 1;
  }

  _estimatedGpuBytes() {
    if (!this._targets || !this._format) return this._detailSize ** 3 * 4;
    const bytesPerTexel = 4 * (this._format.bytesPerChannel || 0);
    const fieldBytes = bytesPerTexel > 0 ? this._allTargets().reduce(
      (total, target) => total + target.width * target.height * bytesPerTexel,
      0,
    ) : 0;
    const metricBytes = this._metricTarget
      ? this._metricTarget.width * this._metricTarget.height * 4
      : 0;
    return fieldBytes + metricBytes + this._detailSize ** 3 * 4;
  }

  _assertNoGlError(stage) {
    const gl = this.gl;
    if (!gl) return;
    const firstCode = gl.getError();
    if (firstCode === gl.NO_ERROR) return;
    const codes = [firstCode];
    for (let index = 0; index < 7; index += 1) {
      const code = gl.getError();
      if (code === gl.NO_ERROR) break;
      codes.push(code);
    }
    const names = codes.map((code) => glErrorName(gl, code));
    this._lastGlError = {
      code: firstCode,
      name: names[0],
      codes,
      names,
      stage,
      stepIndex: this.stepIndex,
    };
    throw new Error(`WebGL2 ${names.join(', ')} during ${stage}.`);
  }

  _uniformLocation(program, name) {
    if (!program.uniforms.has(name)) {
      program.uniforms.set(name, this.gl.getUniformLocation(program.program, name));
    }
    return program.uniforms.get(name);
  }

  _uniform1f(program, name, value) {
    const location = this._uniformLocation(program, name);
    if (location !== null) this.gl.uniform1f(location, value);
  }

  _uniform1i(program, name, value) {
    const location = this._uniformLocation(program, name);
    if (location !== null) this.gl.uniform1i(location, value);
  }

  _uniform1ui(program, name, value) {
    const location = this._uniformLocation(program, name);
    if (location !== null) this.gl.uniform1ui(location, value >>> 0);
  }

  _uniform2f(program, name, x, y) {
    const location = this._uniformLocation(program, name);
    if (location !== null) this.gl.uniform2f(location, x, y);
  }

  _uniform3f(program, name, x, y, z) {
    const location = this._uniformLocation(program, name);
    if (location !== null) this.gl.uniform3f(location, x, y, z);
  }

  _uniform4f(program, name, x, y, z, w) {
    const location = this._uniformLocation(program, name);
    if (location !== null) this.gl.uniform4f(location, x, y, z, w);
  }

  _texture(program, name, texture, unit) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    this._uniform1i(program, name, unit);
  }

  _texture3D(program, name, texture, unit) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_3D, texture);
    this._uniform1i(program, name, unit);
  }

  _swap(pair) {
    const previousRead = pair.read;
    pair.read = pair.write;
    pair.write = previousRead;
  }

  _sourceCenter() {
    let rawCenter;
    if (this.profile.preserveResearchSource) {
      // Preserve the flagship's established generic low-airburst placement,
      // while allowing its profile anchor to lower the source without moving
      // the camera or affecting any other event. BASE_PROFILE.centerY is the
      // exact neutral point, so the original source position is unchanged
      // unless this isolated profile opts in.
      const profileOffsetY = finite(this.profile.source.centerY, BASE_PROFILE.source.centerY)
        - BASE_PROFILE.source.centerY;
      rawCenter = [0.5, clamp(0.27 + this.settings.altitude * 0.17 + profileOffsetY, 0.2, 0.48)];
    } else {
      // Other event families use normalized profile anchors. Altitude is only an
      // artistic offset inside the bounded field, never a real height or depth.
      const source = this.profile.source;
      const altitudeResponse = this.profile.physicalFamilyId === 'ground-coupled' ? 0.045 : 0.08;
      rawCenter = [
        clamp(source.centerX, 0.16, 0.84),
        clamp(source.centerY + this.settings.altitude * altitudeResponse, 0.08, 0.76),
      ];
    }
    const domain = this._domainState();
    return domain.mode > 0
      ? [
        0.5 + (rawCenter[0] - 0.5) * domain.activeScale,
        0.5 + (rawCenter[1] - 0.5) * domain.activeScale,
      ]
      : rawCenter;
  }

  _normalizedTime() {
    return clamp(this.time / this.settings.duration, 0, 1);
  }

  _fallbackFirePhase() {
    const t = this._normalizedTime();
    return Math.max(0, 1 - clamp((t - 0.05) / 0.34, 0, 1));
  }

  _fallbackCloudPhase() {
    const t = this._normalizedTime();
    return clamp((t - 0.12) / 0.4, 0, 1) * (1 - clamp((t - 0.82) / 0.18, 0, 0.45));
  }

  _fallbackDissipationPhase() {
    return clamp((this._normalizedTime() - 0.68) / 0.32, 0, 1);
  }

  _fallbackRisePhase() {
    return clamp((this._normalizedTime() - 0.06) / 0.58, 0, 1);
  }

  _allTargets() {
    if (!this._targets) return [];
    const targets = [];
    for (const key of ['velocity', 'scalar', 'pressure', 'tracers']) {
      const pair = this._targets[key];
      if (pair?.read) targets.push(pair.read);
      if (pair?.write) targets.push(pair.write);
    }
    if (this._targets.divergence) targets.push(this._targets.divergence);
    if (this._targets.curl) targets.push(this._targets.curl);
    return targets;
  }

  _releaseTargets() {
    if (!this.gl || !this._targets) {
      this._targets = null;
      return;
    }
    const gl = this.gl;
    const targets = this._allTargets();
    const framebuffers = new Set();
    const textures = new Set();
    for (const target of targets) {
      if (target.framebuffer) framebuffers.add(target.framebuffer);
      if (target.texture) textures.add(target.texture);
    }
    for (const framebuffer of framebuffers) gl.deleteFramebuffer(framebuffer);
    for (const texture of textures) gl.deleteTexture(texture);
    this._targets = null;
  }

  _releaseDetailTexture() {
    if (this.gl && this._detailTexture) this.gl.deleteTexture(this._detailTexture);
    this._detailTexture = null;
    this._detailSize = 0;
    this._detailSignature = '';
  }

  _releaseMetricResources() {
    if (this.gl && this._metricTarget) {
      if (this._metricTarget.framebuffer) this.gl.deleteFramebuffer(this._metricTarget.framebuffer);
      if (this._metricTarget.texture) this.gl.deleteTexture(this._metricTarget.texture);
    }
    this._metricTarget = null;
    this._metricPixels = null;
    this._metricStepIndex = -1;
  }

  _releaseResources() {
    if (!this.gl) {
      this._targets = null;
      this._detailTexture = null;
      this._detailSize = 0;
      this._detailSignature = '';
      this._metricTarget = null;
      this._metricPixels = null;
      this._metricStepIndex = -1;
      this._programs = Object.create(null);
      this._vao = null;
      return;
    }
    const gl = this.gl;
    this._releaseTargets();
    this._releaseDetailTexture();
    this._releaseMetricResources();
    for (const record of Object.values(this._programs || {})) {
      if (record?.program) gl.deleteProgram(record.program);
    }
    this._programs = Object.create(null);
    if (this._vao) gl.deleteVertexArray(this._vao);
    this._vao = null;
  }

  _runtimeFailure(message, error) {
    const reason = `${message}${error?.message ? ` ${error.message}` : ''}`.trim();
    try {
      this._releaseResources();
    } catch {
      // Preserve the original actionable failure if cleanup also encounters a
      // damaged context. Context destruction will reclaim any remaining handles.
    }
    this.available = false;
    this.reason = reason;
  }

  _handleContextLost(event) {
    event?.preventDefault?.();
    this._contextLost = true;
    this.available = false;
    this.reason = 'WebGL2 context lost; use Canvas2D until restoration completes.';
    const contextLostCode = this.gl?.CONTEXT_LOST_WEBGL ?? 0x9242;
    this._lastGlError = {
      code: contextLostCode,
      name: 'CONTEXT_LOST_WEBGL',
      codes: [contextLostCode],
      names: ['CONTEXT_LOST_WEBGL'],
      stage: 'webglcontextlost event',
      stepIndex: this.stepIndex,
    };
    this._targets = null;
    this._detailTexture = null;
    this._detailSize = 0;
    this._detailSignature = '';
    this._metricTarget = null;
    this._metricPixels = null;
    this._metricStepIndex = -1;
    this._programs = Object.create(null);
    this._vao = null;
  }

  _handleContextRestored() {
    if (this.destroyed) return;
    const restoreTime = this.time;
    this._contextLost = false;
    this.available = false;
    this.gl = null;
    if (this._initializeContext() && this.resize(this.width, this.height, this.tier.id)) {
      this.seek(restoreTime);
    }
  }
}

export default ResearchFluidEngine;
