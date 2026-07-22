import assert from "node:assert/strict";
import {
  DEFAULT_ENVIRONMENT_ID,
  DEFAULT_PALETTE_ID,
  DEFAULT_PRESET_ID,
  DEFAULT_TIME_ID,
  ENVIRONMENT_BY_ID,
  ENVIRONMENTS,
  EVENT_RENDERER_MODELS,
  EVENT_PRESETS,
  PALETTE_BY_ID,
  PALETTES,
  PHASES,
  PRESET_BY_ID,
  PRESETS,
  SAFETY_DISCLAIMER,
  SAFETY_SCOPE,
  TIME_BY_ID,
  TIME_SETTINGS,
  buildPhaseTimeline,
  clamp,
  cubeRootScale,
  getPhaseAtTime,
  getPhaseProgress,
  hashSeed,
  hashString,
  mulberry32,
  normalizeTimelineTime,
  normalizedCubeRootScale,
  phaseWeight,
  randomFromSeed,
  safeSlug,
  scalePreset,
  valueNoise1D,
  valueNoise2D
} from "../scripts/data.js";

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const uniqueIds = (items, label) => {
  const ids = items.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, `${label} IDs must be unique`);
  for (const id of ids) assert.equal(id, safeSlug(id), `${label} ID is not a safe slug: ${id}`);
};

assert.equal(EVENT_PRESETS.length, 12, "Exactly 12 educational presets are required");
assert.strictEqual(PRESETS, EVENT_PRESETS, "PRESETS should be the canonical preset alias");
assert.ok(PALETTES.length >= 6 && PALETTES.length <= 7, "Expected 6–7 palettes");
assert.ok(ENVIRONMENTS.length >= 6, "Expected at least six generic environments");
assert.ok(TIME_SETTINGS.length >= 4, "Expected multiple time-of-day settings");
uniqueIds(EVENT_PRESETS, "Preset");
uniqueIds(PALETTES, "Palette");
uniqueIds(ENVIRONMENTS, "Environment");
uniqueIds(TIME_SETTINGS, "Time setting");
uniqueIds(PHASES, "Phase");

assert.ok(PRESET_BY_ID[DEFAULT_PRESET_ID], "Default preset must exist");
assert.ok(PALETTE_BY_ID[DEFAULT_PALETTE_ID], "Default palette must exist");
assert.ok(ENVIRONMENT_BY_ID[DEFAULT_ENVIRONMENT_ID], "Default environment must exist");
assert.ok(TIME_BY_ID[DEFAULT_TIME_ID], "Default time setting must exist");

const allowedCategories = new Set([
  "conventional",
  "industrial-visual",
  "atmospheric-archetype",
  "subsurface-visual",
  "cosmic",
  "geologic",
  "fictional",
  "nuclear-scale-visual"
]);
const requiredPresetIds = [
  "compact-conventional",
  "large-conventional",
  "industrial-fireball",
  "fuel-air-visual-archetype",
  "underground-detonation",
  "meteor-airburst",
  "meteor-ground-impact",
  "volcanic-eruption",
  "fictional-plasma-burst",
  "low-yield-nuclear-airburst",
  "nuclear-ground-burst",
  "extreme-historical-scale"
];
assert.deepEqual(
  EVENT_PRESETS.map(({ id }) => id),
  requiredPresetIds,
  "The safe educational preset set changed unexpectedly"
);

const researchPreset = PRESET_BY_ID["low-yield-nuclear-airburst"];
assert.equal(researchPreset.name, "Nuclear Airburst — Research Model", "Flagship research-model name changed");
assert.equal(researchPreset.researchModel?.engine, "webgl2-fluid-2.5d", "Flagship must select the WebGL2 2.5D engine");
assert.equal(researchPreset.researchModel?.fixedStep, 1 / 30, "Flagship fixed timestep changed");
assert.deepEqual(
  researchPreset.researchModel?.normalizedFields,
  ["velocity", "temperature", "smoke", "incandescent", "dust"],
  "Flagship normalized field contract changed"
);
assert.deepEqual(
  researchPreset.researchModel?.diagnostics,
  ["velocity", "temperature", "smoke", "incandescent", "pressure", "divergence", "vorticity", "tracers"],
  "Flagship diagnostics contract changed"
);
assert.deepEqual(
  researchPreset.researchModel?.sourcePrimitives,
  ["radial-impulse", "vertical-jet", "paired-cap-vortices"],
  "Flagship source architecture must remain the preserved Research Model branch"
);
assert.equal(DEFAULT_PRESET_ID, "low-yield-nuclear-airburst", "First load must feature the upgraded Research Model");
assert.equal(
  EVENT_PRESETS.filter(({ researchModel }) => Boolean(researchModel)).length,
  EVENT_PRESETS.length,
  "Every Cinematic preset must route through the research engine"
);
assert.equal(Object.keys(EVENT_RENDERER_MODELS).length, EVENT_PRESETS.length, "Every preset needs renderer routing metadata");

const expectedFamilies = new Set([
  "conventional-compact",
  "industrial-combustion",
  "ground-coupled",
  "meteor",
  "volcanic",
  "fictional-plasma",
  "nuclear-scale"
]);
assert.deepEqual(
  new Set(EVENT_PRESETS.map(({ eventFamilyId }) => eventFamilyId)),
  expectedFamilies,
  "The seven event families changed unexpectedly"
);
const fluidProfileIds = new Set();
const sourceArchitectures = new Set();
const familyCounts = new Map();
const requiredPrimitiveByPreset = Object.freeze({
  "compact-conventional": "ground-sheet",
  "industrial-fireball": "sustained-combustion-region",
  "underground-detonation": "ejecta-curtain",
  "meteor-ground-impact": "elongated-trail",
  "volcanic-eruption": "pulsed-column",
  "fictional-plasma-burst": "ring-source",
  "nuclear-ground-burst": "ground-sheet",
  "extreme-historical-scale": "paired-cap-vortices",
});

const allPhaseIds = new Set();
const fingerprints = new Set();
for (const preset of EVENT_PRESETS) {
  const rendererModel = EVENT_RENDERER_MODELS[preset.id];
  assert.ok(rendererModel, `${preset.id}: renderer routing metadata missing`);
  assert.equal(rendererModel.profileId, preset.researchModel?.id, `${preset.id}: data and renderer profile IDs differ`);
  assert.equal(rendererModel.familyId, preset.eventFamilyId, `${preset.id}: renderer family differs from preset family`);
  assert.deepEqual(rendererModel.sourcePrimitives, preset.researchModel?.sourcePrimitives, `${preset.id}: renderer sources differ from preset sources`);
  assert.ok(allowedCategories.has(preset.category), `${preset.id}: unreviewed category`);
  assert.ok(preset.name.length >= 8, `${preset.id}: missing display name`);
  assert.ok(preset.description.length >= 70, `${preset.id}: description is too terse`);
  assert.ok(preset.educationalNote.length >= 70, `${preset.id}: educational note is too terse`);
  assert.ok(preset.safetyNote.length >= 65, `${preset.id}: safety note is too terse`);
  assert.equal(preset.disclaimer, SAFETY_DISCLAIMER, `${preset.id}: safety disclaimer mismatch`);
  assert.equal(preset.safetyScope, SAFETY_SCOPE, `${preset.id}: safety scope mismatch`);
  assert.match(
    `${preset.disclaimer} ${preset.safetyScope}`,
    /simplified approximations[\s\S]*targeting[\s\S]*real-world predictions[\s\S]*no construction methods/i,
    `${preset.id}: safety boundaries are incomplete`
  );
  assert.ok(isFiniteNumber(preset.relativeVisualEnergy) && preset.relativeVisualEnergy > 0, `${preset.id}: invalid visual energy`);
  assert.ok(isFiniteNumber(preset.duration) && preset.duration >= 5 && preset.duration <= 60, `${preset.id}: invalid duration`);
  assert.ok(Array.isArray(preset.energyRange) && preset.energyRange.length === 2, `${preset.id}: invalid display-energy range`);
  assert.ok(ENVIRONMENT_BY_ID[preset.defaultEnvironmentId], `${preset.id}: missing environment`);
  assert.ok(TIME_BY_ID[preset.defaultTimeId], `${preset.id}: missing time setting`);
  assert.ok(PALETTE_BY_ID[preset.defaultPaletteId], `${preset.id}: missing palette`);
  assert.ok(isFiniteNumber(preset.defaultAltitude) && preset.defaultAltitude >= -0.25 && preset.defaultAltitude <= 0.75, `${preset.id}: altitude must remain normalized`);
  assert.equal(preset.researchModel?.engine, "webgl2-fluid-2.5d", `${preset.id}: Cinematic research engine missing`);
  assert.equal(preset.researchModel?.fixedStep, 1 / 30, `${preset.id}: deterministic fixed timestep changed`);
  assert.equal(preset.researchModel?.familyId, preset.eventFamilyId, `${preset.id}: family routing mismatch`);
  assert.ok(Array.isArray(preset.researchModel?.sourcePrimitives), `${preset.id}: source primitive list missing`);
  assert.ok(preset.researchModel.sourcePrimitives.length >= 3, `${preset.id}: source architecture is too generic`);
  assert.equal(
    new Set(preset.researchModel.sourcePrimitives).size,
    preset.researchModel.sourcePrimitives.length,
    `${preset.id}: duplicate source primitive`
  );
  assert.ok(!fluidProfileIds.has(preset.researchModel.id), `${preset.id}: fluid profile duplicates another preset`);
  fluidProfileIds.add(preset.researchModel.id);
  const sourceArchitecture = [...preset.researchModel.sourcePrimitives].sort().join("|");
  assert.ok(!sourceArchitectures.has(sourceArchitecture), `${preset.id}: source architecture duplicates another preset`);
  sourceArchitectures.add(sourceArchitecture);
  familyCounts.set(preset.eventFamilyId, (familyCounts.get(preset.eventFamilyId) || 0) + 1);
  if (requiredPrimitiveByPreset[preset.id]) {
    assert.ok(
      preset.researchModel.sourcePrimitives.includes(requiredPrimitiveByPreset[preset.id]),
      `${preset.id}: representative family primitive missing`,
    );
  }

  const { low, balanced, high } = preset.particleBudget;
  assert.ok([low, balanced, high].every(Number.isInteger), `${preset.id}: particle budgets must be integers`);
  assert.ok(low >= 200 && low <= balanced && balanced <= high, `${preset.id}: particle budgets must be ordered`);
  assert.ok(high <= 8000, `${preset.id}: particle budget exceeds the bounded ceiling`);

  const coefficients = Object.values(preset.render);
  assert.ok(coefficients.length >= 12, `${preset.id}: render model is incomplete`);
  assert.ok(coefficients.every(isFiniteNumber), `${preset.id}: render coefficients must be finite`);
  assert.ok(coefficients.every((value) => value >= 0 && value <= 2), `${preset.id}: render coefficient out of range`);

  const timeline = buildPhaseTimeline(preset);
  assert.ok(timeline.length >= 7, `${preset.id}: expected at least seven visual phases`);
  assert.equal(timeline[0].start, 0, `${preset.id}: timeline must begin at zero`);
  assert.ok(timeline.some(({ id }) => id === "detonation"), `${preset.id}: missing onset`);
  assert.ok(timeline.some(({ id }) => id === "dissipation"), `${preset.id}: missing dissipation`);
  for (const phase of timeline) {
    allPhaseIds.add(phase.id);
    assert.ok(isFiniteNumber(phase.start) && isFiniteNumber(phase.end), `${preset.id}/${phase.id}: non-finite phase`);
    assert.ok(phase.start >= 0 && phase.end > phase.start && phase.end <= preset.duration, `${preset.id}/${phase.id}: invalid phase bounds`);
    assert.ok(phase.normalizedStart >= 0 && phase.normalizedEnd <= 1, `${preset.id}/${phase.id}: invalid normalized phase`);
    assert.ok(getPhaseProgress(phase, phase.start) === 0, `${preset.id}/${phase.id}: invalid start progress`);
    assert.ok(getPhaseProgress(phase, phase.end) === 1, `${preset.id}/${phase.id}: invalid end progress`);
    assert.ok(isFiniteNumber(phaseWeight(phase, (phase.start + phase.end) / 2)), `${preset.id}/${phase.id}: invalid phase weight`);
  }
  assert.ok(getPhaseAtTime(timeline, 0), `${preset.id}: no phase at start`);

  const scaled = scalePreset(preset, 720, 1);
  for (const [name, value] of Object.entries(scaled)) {
    assert.ok(isFiniteNumber(value) && value >= 0, `${preset.id}: invalid scaled ${name}`);
  }
  assert.ok(scaled.normalized <= 1, `${preset.id}: normalized scale escaped 0..1`);
  assert.ok(scaled.shockRadius > scaled.baseRadius, `${preset.id}: shock radius should exceed base radius`);

  const fingerprint = JSON.stringify({
    duration: preset.duration,
    phases: preset.phases.map(({ id, start, end }) => [id, start, end]),
    render: preset.render
  });
  assert.ok(!fingerprints.has(fingerprint), `${preset.id}: preset behavior duplicates another preset`);
  fingerprints.add(fingerprint);
}

assert.deepEqual(
  Object.fromEntries(familyCounts),
  {
    "conventional-compact": 2,
    "industrial-combustion": 2,
    "ground-coupled": 1,
    meteor: 2,
    volcanic: 1,
    "fictional-plasma": 1,
    "nuclear-scale": 3,
  },
  "Preset-to-family membership changed unexpectedly",
);

for (const { id } of PHASES) assert.ok(allPhaseIds.has(id), `No preset exercises phase: ${id}`);

for (const palette of PALETTES) {
  for (const key of ["background", "flash", "core", "flame", "smoke", "dust", "shock", "accent"]) {
    assert.match(palette[key], /^#[0-9a-f]{6}$/i, `${palette.id}: invalid ${key} color`);
  }
}
for (const environment of ENVIRONMENTS) {
  assert.equal(environment.fictional, true, `${environment.id}: environments must remain fictional/generic`);
  assert.match(environment.description, /(fictional|generic|abstract|unlocated|non-geographic)/i, `${environment.id}: generic scope should be explicit`);
}

const sequenceA = Array.from({ length: 16 }, mulberry32("repeatable-seed"));
const sequenceB = Array.from({ length: 16 }, mulberry32("repeatable-seed"));
const sequenceC = Array.from({ length: 16 }, mulberry32("different-seed"));
assert.deepEqual(sequenceA, sequenceB, "Mulberry32 replay is not deterministic");
assert.notDeepEqual(sequenceA, sequenceC, "Distinct seeds should produce distinct sequences");
assert.ok(sequenceA.every((value) => value >= 0 && value < 1), "RNG escaped 0..1");
assert.deepEqual(
  Array.from({ length: 8 }, randomFromSeed(1842, "embers")),
  Array.from({ length: 8 }, randomFromSeed(1842, "embers")),
  "Named RNG streams are not deterministic"
);
assert.equal(hashString("Explosion Dynamics Lab"), hashString("Explosion Dynamics Lab"), "String hash changed during one run");
assert.equal(hashSeed(0x1_0000_0001), 1, "Numeric seeds must normalize to uint32");
assert.equal(valueNoise1D(3.75, 44), valueNoise1D(3.75, 44), "1D noise is not deterministic");
assert.equal(valueNoise2D(-2.5, 8.125, 44), valueNoise2D(-2.5, 8.125, 44), "2D noise is not deterministic");
assert.ok(valueNoise1D(3.75, 44) >= 0 && valueNoise1D(3.75, 44) <= 1, "1D noise escaped 0..1");
assert.ok(valueNoise2D(-2.5, 8.125, 44) >= 0 && valueNoise2D(-2.5, 8.125, 44) <= 1, "2D noise escaped 0..1");

const scaleValues = [0.5, 1, 10, 100, 900].map((value) => normalizedCubeRootScale(value, 0.5, 900));
assert.ok(scaleValues.every((value, index) => index === 0 || value > scaleValues[index - 1]), "Normalized cube-root scale must be monotonic");
assert.equal(normalizedCubeRootScale(-10, 0.5, 900), 0, "Normalized scaling should clamp low inputs");
assert.equal(normalizedCubeRootScale(5000, 0.5, 900), 1, "Normalized scaling should clamp high inputs");
assert.equal(cubeRootScale(8, 1), 2, "Cube-root visual scaling regression");
assert.equal(clamp(Number.NaN, 2, 4), 2, "Clamp should safely handle NaN");
assert.equal(safeSlug("  Plasma / Burst: Seed #1842  "), "plasma-burst-seed-1842", "Safe filename slug regression");
assert.equal(normalizeTimelineTime(-1, 10), 0, "Timeline should clamp negative time");
assert.equal(normalizeTimelineTime(12, 10, true), 2, "Looped timeline normalization failed");

console.log("Explosion Dynamics Lab data smoke test: PASS");
console.log(`  ${EVENT_PRESETS.length} materially distinct, safety-scoped event presets`);
console.log(`  ${PALETTES.length} palettes, ${ENVIRONMENTS.length} generic environments, ${TIME_SETTINGS.length} time settings`);
console.log(`  ${allPhaseIds.size}/${PHASES.length} timeline phases covered`);
console.log(`  particle budgets bounded at ${Math.max(...EVENT_PRESETS.map(({ particleBudget }) => particleBudget.high)).toLocaleString()}`);
console.log("  deterministic RNG, noise, timeline, easing, and cube-root display scaling verified");
