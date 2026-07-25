import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EVENT_FLUID_PROFILES,
  RESEARCH_FLUID_DEFAULTS,
  RESEARCH_FLUID_DIAGNOSTICS,
  RESEARCH_FLUID_PROFILES,
  RESEARCH_FLUID_SHADER_SOURCES,
  RESEARCH_FLUID_SOURCE_PRIMITIVES,
  RESEARCH_FLUID_TIERS,
  ResearchFluidEngine,
} from "../scripts/fluid-engine.js";
import { EVENT_PRESETS, PALETTES } from "../scripts/data.js";

const tiers = Object.values(RESEARCH_FLUID_TIERS);
assert.deepEqual(tiers.map(({ id }) => id), ["mobile", "balanced", "high"]);
for (const tier of tiers) {
  assert.ok(Number.isInteger(tier.gridLongSide) && tier.gridLongSide >= 64 && tier.gridLongSide <= 320);
  assert.ok(Number.isInteger(tier.pressureIterations) && tier.pressureIterations >= 6 && tier.pressureIterations <= 24);
  assert.ok(Number.isInteger(tier.raySteps) && tier.raySteps >= 8 && tier.raySteps <= 40);
  assert.ok(Number.isInteger(tier.tracerCount) && tier.tracerCount >= 128 && tier.tracerCount <= 2048);
  assert.ok(Number.isInteger(tier.detailResolution) && tier.detailResolution >= 8 && tier.detailResolution <= 48);
  assert.ok(Number.isFinite(tier.fixedStep) && tier.fixedStep > 0 && tier.fixedStep <= 1 / 24);
  assert.equal(tier.fixedStep, 1 / 30, `${tier.id} must preserve the shared deterministic timestep`);
}
for (const field of ["gridLongSide", "pressureIterations", "raySteps", "tracerCount", "detailResolution"]) {
  assert.ok(tiers[0][field] < tiers[1][field] && tiers[1][field] < tiers[2][field], `${field} tiers must be ordered`);
}

assert.strictEqual(EVENT_FLUID_PROFILES, RESEARCH_FLUID_PROFILES, "Descriptive profile alias must remain canonical");
assert.deepEqual(Object.keys(RESEARCH_FLUID_PROFILES), EVENT_PRESETS.map(({ id }) => id));
assert.deepEqual(
  new Set(Object.values(RESEARCH_FLUID_PROFILES).map(({ eventFamilyId }) => eventFamilyId)),
  new Set(["conventional-compact", "industrial-combustion", "ground-coupled", "meteor", "volcanic", "fictional-plasma", "nuclear-scale"]),
  "All seven rendering families must be represented",
);

const primitiveEntries = Object.entries(RESEARCH_FLUID_SOURCE_PRIMITIVES);
assert.equal(primitiveEntries.length, 12, "The complete normalized source-primitive vocabulary is required");
assert.equal(new Set(primitiveEntries.map(([, bit]) => bit)).size, primitiveEntries.length);
for (const [primitive, bit] of primitiveEntries) {
  assert.ok(Number.isInteger(bit) && bit > 0 && (bit & (bit - 1)) === 0, `${primitive}: primitive mask must be one bit`);
}

const profileIds = new Set();
const profileKinds = new Set();
const sourceMasks = new Set();
const profileFingerprints = new Set();
const usedPrimitives = new Set();
for (const preset of EVENT_PRESETS) {
  const profile = RESEARCH_FLUID_PROFILES[preset.id];
  assert.ok(profile && Object.isFrozen(profile), `${preset.id}: immutable fluid profile missing`);
  assert.equal(profile.presetId, preset.id);
  assert.equal(profile.profileId, preset.researchModel.id);
  assert.equal(profile.eventFamilyId, preset.eventFamilyId);
  assert.equal(profile.physicalFamilyId, preset.physicalFamilyId);
  assert.ok(!profileIds.has(profile.profileId), `${preset.id}: duplicate fluid profile ID`);
  assert.ok(!profileKinds.has(profile.profileKind), `${preset.id}: duplicate shader profile kind`);
  profileIds.add(profile.profileId);
  profileKinds.add(profile.profileKind);
  assert.deepEqual(profile.sourcePrimitives, preset.researchModel.sourcePrimitives);
  assert.ok(profile.sourcePrimitives.length >= 3, `${preset.id}: generic source architecture`);
  const sourceMask = profile.sourcePrimitives.reduce((mask, primitive) => {
    assert.ok(RESEARCH_FLUID_SOURCE_PRIMITIVES[primitive], `${preset.id}: unknown source primitive ${primitive}`);
    usedPrimitives.add(primitive);
    return mask | RESEARCH_FLUID_SOURCE_PRIMITIVES[primitive];
  }, 0) >>> 0;
  assert.ok(!sourceMasks.has(sourceMask), `${preset.id}: source primitive mask duplicates another preset`);
  sourceMasks.add(sourceMask);

  for (const [sectionName, section, keys] of [
    ["source", profile.source, ["centerX", "centerY", "radius", "onsetEnd", "sustainEnd", "radial", "vertical", "turbulence", "heat", "smoke", "incandescent", "dust"]],
    ["physics", profile.physics, ["buoyancy", "densityLoading", "windCoupling", "vorticity", "velocityRetention", "cooling", "smokeConversion", "scalarRetention"]],
    ["volume", profile.volume, ["depth", "opacity", "shadow", "bloom", "distortion", "erosion", "noiseScale", "dustVisibility", "exposure", "toneMap", "backgroundIllumination", "emissionCurve"]],
    ["quality", profile.quality, ["grid", "pressure", "rays", "tracers", "detail"]],
  ]) {
    assert.ok(Object.isFrozen(section), `${preset.id}: ${sectionName} settings must be immutable`);
    for (const key of keys) assert.ok(Number.isFinite(section[key]), `${preset.id}: ${sectionName}.${key} missing`);
  }
  for (const value of Object.values(profile.quality)) assert.ok(value >= 0.5 && value <= 1.75, `${preset.id}: unsafe performance multiplier`);

  const fingerprint = JSON.stringify({
    sources: profile.sourcePrimitives,
    source: profile.source,
    physics: profile.physics,
    volume: profile.volume,
    quality: profile.quality,
  });
  assert.ok(!profileFingerprints.has(fingerprint), `${preset.id}: duplicates another complete fluid profile`);
  profileFingerprints.add(fingerprint);
}
assert.deepEqual(usedPrimitives, new Set(Object.keys(RESEARCH_FLUID_SOURCE_PRIMITIVES)), "Every source primitive must be exercised");

const flagshipProfile = RESEARCH_FLUID_PROFILES["low-yield-nuclear-airburst"];
assert.equal(flagshipProfile.profileId, "nuclear-airburst-fluid-v1");
assert.equal(flagshipProfile.profileKind, 9);
assert.equal(flagshipProfile.preserveResearchSource, true);
assert.deepEqual(flagshipProfile.sourcePrimitives, ["radial-impulse", "vertical-jet", "paired-cap-vortices"]);

assert.equal(RESEARCH_FLUID_DIAGNOSTICS.beauty, 0);
assert.equal(RESEARCH_FLUID_DIAGNOSTICS.final, RESEARCH_FLUID_DIAGNOSTICS.beauty);
assert.equal(RESEARCH_FLUID_DIAGNOSTICS.velocity, 1);
assert.equal(RESEARCH_FLUID_DIAGNOSTICS.temperature, 2);
assert.equal(RESEARCH_FLUID_DIAGNOSTICS.smoke, 3);
assert.equal(RESEARCH_FLUID_DIAGNOSTICS.density, RESEARCH_FLUID_DIAGNOSTICS.smoke);
assert.equal(RESEARCH_FLUID_DIAGNOSTICS.smokeDensity, RESEARCH_FLUID_DIAGNOSTICS.smoke);
assert.equal(RESEARCH_FLUID_DIAGNOSTICS.incandescent, 4);
assert.equal(RESEARCH_FLUID_DIAGNOSTICS.incandescentDensity, RESEARCH_FLUID_DIAGNOSTICS.incandescent);
assert.equal(RESEARCH_FLUID_DIAGNOSTICS.pressure, 5);
assert.equal(RESEARCH_FLUID_DIAGNOSTICS.divergence, 6);
assert.equal(RESEARCH_FLUID_DIAGNOSTICS.vorticity, 7);
assert.equal(RESEARCH_FLUID_DIAGNOSTICS.tracers, 8);
assert.equal(RESEARCH_FLUID_DEFAULTS.presetId, "low-yield-nuclear-airburst");
assert.equal(RESEARCH_FLUID_DEFAULTS.tier, "balanced");

// --- Tsar-scale broad-plume research proof of concept (2026-07) ---------------
// The plume research controls must remain opt-in: every profile except the
// Tsar historical reference keeps mode 0 so its simulated behavior is
// byte-identical to before this pass.
for (const [presetId, profile] of Object.entries(RESEARCH_FLUID_PROFILES)) {
  assert.ok(profile.plume && typeof profile.plume === "object", `${presetId}: plume config missing`);
  for (const key of ["mode", "expansion", "vortex", "persistence", "widen"]) {
    assert.ok(Number.isFinite(profile.plume[key]), `${presetId}: plume.${key} must be finite`);
  }
  if (presetId === "tsar-bomba-scale-reference") {
    assert.equal(profile.plume.mode, 1, "Tsar must enable the broad-plume mode");
    assert.ok(profile.plume.expansion > 0, "Tsar expansion must be active");
    assert.ok(profile.plume.vortex > 0, "Tsar vortex population must be active");
    assert.ok(profile.plume.persistence > 0, "Tsar persistence must be active");
    // Source must broaden the plume: radial injection at least matches vertical
    // so the column is no longer a pencil jet.
    assert.ok(profile.source.radial >= profile.source.vertical, "Tsar radial injection must not be dominated by vertical");
  } else {
    assert.equal(profile.plume.mode, 0, `${presetId}: broad-plume mode must remain off for non-Tsar presets`);
  }
}
// The shaders and engine bindings must carry the plume uniforms.
for (const uniform of ["uPlumeMode", "uPlumeParams"]) {
  assert.match(
    `${RESEARCH_FLUID_SHADER_SOURCES.forceFragment}\n${RESEARCH_FLUID_SHADER_SOURCES.scalarFragment}`,
    new RegExp(`uniform[^;]*\\b${uniform}\\b`),
    `${uniform}: plume uniform missing from shaders`,
  );
}

// --- Tsar-scale smoke-material research proof of concept (2026-07) -----------
// Same opt-in contract as the plume controls above: every profile except the
// Tsar historical reference keeps material.mode 0, so its rendering is
// byte-identical to before this pass.
for (const [presetId, profile] of Object.entries(RESEARCH_FLUID_PROFILES)) {
  assert.ok(profile.material && typeof profile.material === "object", `${presetId}: material config missing`);
  for (const key of ["mode", "sootAbsorption", "dustAbsorption", "detailBoost", "warmCoolContrast"]) {
    assert.ok(Number.isFinite(profile.material[key]), `${presetId}: material.${key} must be finite`);
  }
  if (presetId === "tsar-bomba-scale-reference") {
    assert.equal(profile.material.mode, 1, "Tsar must enable the smoke-material mode");
    assert.ok(profile.material.sootAbsorption > profile.material.dustAbsorption, "Tsar soot must absorb more strongly than lofted dust");
    assert.ok(profile.material.detailBoost > 0, "Tsar energy-weighted detail octave must be active");
    assert.ok(profile.material.warmCoolContrast > 0, "Tsar lit/shadowed contrast widening must be active");
  } else {
    assert.equal(profile.material.mode, 0, `${presetId}: smoke-material mode must remain off for non-Tsar presets`);
    assert.equal(profile.material.sootAbsorption, 1, `${presetId}: default soot absorption must stay neutral`);
    assert.equal(profile.material.dustAbsorption, 1, `${presetId}: default dust absorption must stay neutral`);
  }
}
// The volume shader and engine bindings must carry the material uniforms.
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /uniform\s+float\s+uMaterialMode\b/,
  "uMaterialMode: material uniform missing from the volume shader",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /uniform\s+vec4\s+uMaterialParams\b/,
  "uMaterialParams: material uniform missing from the volume shader",
);
// Every new material term must be reachable only through the uMaterialMode
// gate, and must algebraically collapse to the prior expression when it is 0.
for (const gatedTerm of [
  /uMaterialMode > 0\.5\s*\?\s*smokeDensity \* uMaterialParams\.x \+ dustDensity \* uMaterialParams\.y\s*:\s*smoke/,
  /int detailOctaves = uMaterialMode > 0\.5 \? 3 : 2;/,
  /float contrastBoost = uMaterialMode > 0\.5 \? uMaterialParams\.w : 0\.0;/,
]) {
  assert.match(RESEARCH_FLUID_SHADER_SOURCES.volumeFragment, gatedTerm, `Material technique not properly gated behind uMaterialMode: ${gatedTerm}`);
}

// --- Tsar-scale late-dissipation research proof of concept (2026-07) --------
// Same opt-in contract as the plume/material controls above: every profile
// except the Tsar historical reference keeps dissipation.mode 0 (a fully
// neutral envelope — lateStart/finalStart/sourceTaperEnd at 1, retention
// floors at 1, no outward boost/buoyancy falloff/motion damp), so its
// simulation is byte-identical to before this pass.
for (const [presetId, profile] of Object.entries(RESEARCH_FLUID_PROFILES)) {
  assert.ok(profile.dissipation && typeof profile.dissipation === "object", `${presetId}: dissipation config missing`);
  for (const key of [
    "mode", "lateStart", "finalStart", "sourceTaperEnd",
    "retentionFloorSmoke", "retentionFloorDust", "outwardBoost", "buoyancyFalloff", "motionDamp",
  ]) {
    assert.ok(Number.isFinite(profile.dissipation[key]), `${presetId}: dissipation.${key} must be finite`);
  }
  if (presetId === "tsar-bomba-scale-reference") {
    const d = profile.dissipation;
    assert.equal(d.mode, 1, "Tsar must enable the late-dissipation mode");
    assert.ok(d.lateStart > 0 && d.lateStart < 1, "Tsar lateStart must fall strictly within the mature phase");
    assert.ok(d.finalStart > d.lateStart && d.finalStart <= 1, "Tsar finalStart must follow lateStart and not exceed the timeline");
    assert.ok(d.sourceTaperEnd > d.lateStart, "Tsar source taper must begin no earlier than the dissipation ramp");
    assert.ok(d.retentionFloorSmoke < 1 && d.retentionFloorSmoke > 0, "Tsar smoke retention floor must be a real decay target");
    assert.ok(d.retentionFloorDust < d.retentionFloorSmoke, "Tsar dust must clear faster than smoke (independent decay)");
    assert.ok(d.outwardBoost > 0, "Tsar late outward dispersion must be active");
    assert.ok(d.buoyancyFalloff > 0, "Tsar late buoyancy falloff must be active");
    assert.ok(d.motionDamp > 0, "Tsar residual motion damp must be active");
  } else {
    const d = profile.dissipation;
    assert.equal(d.mode, 0, `${presetId}: late-dissipation mode must remain off for non-Tsar presets`);
    assert.equal(d.lateStart, 1, `${presetId}: dissipation.lateStart must stay neutral (1)`);
    assert.equal(d.finalStart, 1, `${presetId}: dissipation.finalStart must stay neutral (1)`);
    assert.equal(d.retentionFloorSmoke, 1, `${presetId}: dissipation.retentionFloorSmoke must stay neutral (1)`);
    assert.equal(d.retentionFloorDust, 1, `${presetId}: dissipation.retentionFloorDust must stay neutral (1)`);
    assert.equal(d.outwardBoost, 0, `${presetId}: dissipation.outwardBoost must stay neutral (0)`);
    assert.equal(d.buoyancyFalloff, 0, `${presetId}: dissipation.buoyancyFalloff must stay neutral (0)`);
    assert.equal(d.motionDamp, 0, `${presetId}: dissipation.motionDamp must stay neutral (0)`);
  }
}
// The velocity/scalar/tracer shaders must all carry the dissipation uniforms
// (declared once in the shared SOURCE_PROFILE_UNIFORMS block).
for (const uniform of ["uDissipationMode", "uDissipationParams", "uDissipationParams2"]) {
  assert.match(
    `${RESEARCH_FLUID_SHADER_SOURCES.forceFragment}\n${RESEARCH_FLUID_SHADER_SOURCES.scalarFragment}\n${RESEARCH_FLUID_SHADER_SOURCES.tracerAdvectFragment}`,
    new RegExp(`uniform[^;]*\\b${uniform}\\b`),
    `${uniform}: dissipation uniform missing from shaders`,
  );
}
// Every new dissipation term must be reachable only through the
// uDissipationMode gate, and must algebraically collapse to the prior
// expression when it is 0 (dissipationProgress()/dissipationSourceTaper()/
// dissipationMotionDamp() all return their inert value unless the mode is set).
for (const gatedTerm of [
  /if \(uDissipationMode < 0\.5\) return 0\.0;/,
  /if \(uDissipationMode < 0\.5\) return 1\.0;/,
  /float sustain = profileSustainEnvelope\(\) \* dissipationSourceTaper\(\);/,
  /float buoyancyFalloff = uDissipationMode > 0\.5/,
  /if \(uDissipationMode > 0\.5\) \{\s*\n\s*float outwardProgress = dissipationProgress\(\);/,
  /float tracerDissipation = uDissipationMode > 0\.5 \? mix\(1\.0, 0\.35, dissipationProgress\(\)\) : 1\.0;/,
]) {
  assert.match(
    `${RESEARCH_FLUID_SHADER_SOURCES.forceFragment}\n${RESEARCH_FLUID_SHADER_SOURCES.scalarFragment}\n${RESEARCH_FLUID_SHADER_SOURCES.tracerAdvectFragment}`,
    gatedTerm,
    `Dissipation technique not properly gated behind uDissipationMode: ${gatedTerm}`,
  );
}
assert.equal(
  (RESEARCH_FLUID_SHADER_SOURCES.forceFragment.match(/float sustain = profileSustainEnvelope\(\) \* dissipationSourceTaper\(\);/g) || []).length,
  1,
  "Velocity shader must taper exactly one sustain envelope",
);
assert.equal(
  (RESEARCH_FLUID_SHADER_SOURCES.scalarFragment.match(/float sustain = profileSustainEnvelope\(\) \* dissipationSourceTaper\(\);/g) || []).length,
  1,
  "Scalar shader must taper exactly one sustain envelope",
);

// --- Tsar-scale core/tracer polish (2026-07) ---------------------------------
// Same opt-in contract as the plume/material/dissipation controls above:
// every profile except the Tsar historical reference keeps core.mode 0 (the
// default threshold/sharpness/structureBlend/bloomGateScale of 1.5, 2.0, 0, 0
// reduce every gated formula below to its pre-pass expression) and
// tracerMaterial.mode 0 (occlusion/size/brightness variance all neutral).
for (const [presetId, profile] of Object.entries(RESEARCH_FLUID_PROFILES)) {
  assert.ok(profile.core && typeof profile.core === "object", `${presetId}: core config missing`);
  for (const key of ["mode", "highlightThreshold", "highlightSharpness", "structureBlend", "bloomGateScale"]) {
    assert.ok(Number.isFinite(profile.core[key]), `${presetId}: core.${key} must be finite`);
  }
  if (presetId === "tsar-bomba-scale-reference") {
    const c = profile.core;
    assert.equal(c.mode, 1, "Tsar must enable core-polish mode");
    assert.ok(c.highlightThreshold > 1.5, "Tsar highlight threshold must be raised above the default plateau point");
    assert.ok(c.highlightSharpness > 2.0, "Tsar highlight roll-off must be steeper than the default");
    assert.ok(c.structureBlend > 0 && c.structureBlend <= 1, "Tsar structure blend must be active and bounded");
    assert.ok(c.bloomGateScale > 0, "Tsar bloom gradient gate must be active");
  } else {
    const c = profile.core;
    assert.equal(c.mode, 0, `${presetId}: core-polish mode must remain off for non-Tsar presets`);
    assert.equal(c.highlightThreshold, 1.5, `${presetId}: core.highlightThreshold must stay neutral (1.5)`);
    assert.equal(c.highlightSharpness, 2.0, `${presetId}: core.highlightSharpness must stay neutral (2.0)`);
    assert.equal(c.structureBlend, 0, `${presetId}: core.structureBlend must stay neutral (0)`);
    assert.equal(c.bloomGateScale, 0, `${presetId}: core.bloomGateScale must stay neutral (0)`);
  }

  assert.ok(profile.tracerMaterial && typeof profile.tracerMaterial === "object", `${presetId}: tracerMaterial config missing`);
  for (const key of ["mode", "occlusionStrength", "sizeVariance", "brightnessVariance"]) {
    assert.ok(Number.isFinite(profile.tracerMaterial[key]), `${presetId}: tracerMaterial.${key} must be finite`);
  }
  if (presetId === "tsar-bomba-scale-reference") {
    const t = profile.tracerMaterial;
    assert.equal(t.mode, 1, "Tsar must enable tracer-occlusion mode");
    assert.ok(t.occlusionStrength > 0, "Tsar tracer occlusion must be active");
    assert.ok(t.sizeVariance > 0 && t.sizeVariance < 1, "Tsar tracer size variance must be active and bounded (< 1 keeps size positive)");
    assert.ok(t.brightnessVariance > 0 && t.brightnessVariance < 1, "Tsar tracer brightness variance must be active and bounded (< 1 keeps brightness positive)");
  } else {
    const t = profile.tracerMaterial;
    assert.equal(t.mode, 0, `${presetId}: tracer-occlusion mode must remain off for non-Tsar presets`);
    assert.equal(t.occlusionStrength, 0, `${presetId}: tracerMaterial.occlusionStrength must stay neutral (0)`);
    assert.equal(t.sizeVariance, 0, `${presetId}: tracerMaterial.sizeVariance must stay neutral (0)`);
    assert.equal(t.brightnessVariance, 0, `${presetId}: tracerMaterial.brightnessVariance must stay neutral (0)`);
  }
}
// The volume shader must carry the core uniforms; the tracer display vertex
// shader must carry the tracer-material uniforms.
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /uniform\s+float\s+uCoreMode\b/,
  "uCoreMode: core uniform missing from the volume shader",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /uniform\s+vec4\s+uCoreParams\b/,
  "uCoreParams: core uniform missing from the volume shader",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.tracerVertex,
  /uniform\s+float\s+uTracerMaterialMode\b/,
  "uTracerMaterialMode: tracer-material uniform missing from the tracer display shader",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.tracerVertex,
  /uniform\s+vec4\s+uTracerMaterialParams\b/,
  "uTracerMaterialParams: tracer-material uniform missing from the tracer display shader",
);
// Every new core/tracer term must be reachable only through its mode gate,
// and must algebraically collapse to the prior expression when the mode is 0.
for (const gatedTerm of [
  /float coreThreshold = uCoreMode > 0\.5 \? uCoreParams\.x : 1\.5;/,
  /float coreSharpness = uCoreMode > 0\.5 \? uCoreParams\.y : 2\.0;/,
  /float bloomGate = uCoreMode > 0\.5 \? clamp\(sqrt\(bloomVariance\) \* uCoreParams\.w, 0\.0, 1\.0\) : 1\.0;/,
]) {
  assert.match(RESEARCH_FLUID_SHADER_SOURCES.volumeFragment, gatedTerm, `Core technique not properly gated behind uCoreMode: ${gatedTerm}`);
}
for (const gatedTerm of [
  /float occlusion = uTracerMaterialMode > 0\.5\s*\n\s*\? mix\(exp\(-plume \* uTracerMaterialParams\.x\), 1\.0, diagnostic\)\s*\n\s*: 1\.0;/,
  /float brightnessJitter = uTracerMaterialMode > 0\.5/,
  /float sizeJitter = uTracerMaterialMode > 0\.5/,
]) {
  assert.match(RESEARCH_FLUID_SHADER_SOURCES.tracerVertex, gatedTerm, `Tracer-material technique not properly gated behind uTracerMaterialMode: ${gatedTerm}`);
}
// Shader branches must collapse to no-ops when disabled: the emission bonus,
// bloom gate, tracer occlusion, and tracer size/brightness jitter must all
// read exactly 1.0 (or the documented neutral constant) for every non-Tsar
// preset's mode value of 0, per the JS-side binding defaults below.
{
  const engineSourceForGating = readFileSync(new URL("../scripts/fluid-engine.js", import.meta.url), "utf8");
  assert.match(
    engineSourceForGating,
    /const core = this\.profile\.core\s*\n\s*\|\|\s*\{ mode: 0, highlightThreshold: 1\.5, highlightSharpness: 2\.0, structureBlend: 0, bloomGateScale: 0 \};/,
    "Default core fallback (used when a profile omits core:) must match the neutral values asserted above",
  );
  assert.match(
    engineSourceForGating,
    /const tracerMaterial = this\.profile\.tracerMaterial\s*\n\s*\|\|\s*\{ mode: 0, occlusionStrength: 0, sizeVariance: 0, brightnessVariance: 0 \};/,
    "Default tracerMaterial fallback (used when a profile omits tracerMaterial:) must match the neutral values asserted above",
  );
}

const shaders = RESEARCH_FLUID_SHADER_SOURCES;
const engineSource = readFileSync(new URL("../scripts/fluid-engine.js", import.meta.url), "utf8");
for (const uniform of [
  "uSourceMask", "uProfileKind", "uSourceShape", "uSourceTiming", "uSourceMotion",
  "uSourceScalar", "uSourceVector", "uSourceAux", "uSeedOffsetsA", "uSeedOffsetsB",
  "uProfilePhysics", "uProfileDecay",
]) {
  assert.match(`${shaders.forceFragment}\n${shaders.scalarFragment}`, new RegExp(`uniform[^;]*\\b${uniform}\\b`), `${uniform}: source-profile uniform missing`);
  assert.match(engineSource, new RegExp(`["']${uniform}["']`), `${uniform}: source-profile binding missing`);
}
for (const uniform of ["uVolumeProfile0", "uVolumeProfile1", "uVolumeProfile2"]) {
  assert.match(shaders.volumeFragment, new RegExp(`uniform\\s+vec4\\s+${uniform}\\b`), `${uniform}: renderer-profile uniform missing`);
  assert.match(engineSource, new RegExp(`_uniform4f\\(\\s*program,\\s*["']${uniform}["']`), `${uniform}: renderer-profile binding missing`);
}
for (const uniform of [
  "uPaletteBackground", "uPaletteEmber", "uPaletteFlame", "uPaletteHot", "uPaletteCore",
  "uPaletteSmoke", "uPaletteSmokeLight", "uPaletteCloud", "uPaletteDust",
]) {
  assert.match(shaders.volumeFragment, new RegExp(`uniform\\s+vec3\\s+${uniform}\\b`), `${uniform}: GPU palette uniform missing`);
  assert.match(shaders.volumeFragment, new RegExp(`\\b${uniform}\\b[\\s\\S]*\\b${uniform}\\b`), `${uniform}: palette uniform declared but not used`);
  assert.match(engineSource, new RegExp(`_uniform3f\\(\\s*program,\\s*["']${uniform}["']`), `${uniform}: GPU palette binding missing`);
}
assert.match(engineSource, /profile\.quality\.grid|quality\.grid/, "Per-profile grid multiplier is not consumed");
assert.match(engineSource, /profile\.quality\.pressure|quality\.pressure/, "Per-profile pressure multiplier is not consumed");
assert.match(engineSource, /profile\.quality\.rays|quality\.rays/, "Per-profile volume-slice multiplier is not consumed");
assert.match(engineSource, /profile\.quality\.tracers|quality\.tracers/, "Per-profile tracer multiplier is not consumed");
assert.match(engineSource, /profile\.quality\.detail|quality\.detail/, "Per-profile detail multiplier is not consumed");
assert.match(shaders.advectFragment, /previous\s*=\s*vUv\s*-\s*velocity\s*\*\s*uDt/, "semi-Lagrangian backtrace missing");
assert.match(shaders.forceFragment, /temperature\s*\*\s*uBuoyancy/, "temperature buoyancy missing");
assert.match(shaders.forceFragment, /smoke\s*\*\s*uDensityLoading/, "density loading missing");
assert.match(shaders.forceFragment, /uWind\s*\*\s*uDt/, "normalized wind force missing");
assert.match(shaders.forceFragment, /curlGradient[\s\S]*uVorticity/, "vorticity confinement missing");
assert.match(shaders.forceFragment, /leftTangent[\s\S]*rightTangent[\s\S]*circulation/, "paired-vortex cap circulation missing");
assert.match(shaders.forceFragment, /entrainment[\s\S]*velocity\.x/, "column entrainment missing");
assert.match(shaders.forceFragment, /uProfileKind\s*==\s*9[\s\S]*original centered impulse\/updraft math intact/, "Nuclear Airburst regression branch changed");
assert.match(shaders.forceFragment, /trailKernel\s*\*\s*entry\s*\*\s*onset/, "Meteor entry impulse must precede impact staging");
assert.match(shaders.forceFragment, /ejectaKernel\s*\*\s*onset\s*\*\s*stagedImpact/, "Meteor ejecta force must begin at impact stage");
assert.match(shaders.forceFragment, /sourceEnabled\(SOURCE_MULTIPLE\)[\s\S]*sourceEnabled\(SOURCE_TURBULENT\)[\s\S]*clusterKernel/, "Cluster turbulence must obey declared source primitives");
assert.match(shaders.forceFragment, /sampler3D\s+uCurlDetail/, "force pass must sample the bounded 3D curl field");
assert.match(shaders.scalarFragment, /incandescent[\s\S]*uSmokeConversion/, "incandescent-to-smoke conversion missing");
assert.match(shaders.scalarFragment, /temperature\s*=\s*max[\s\S]*exp\(-uCooling/, "cooling missing");
assert.match(shaders.scalarFragment, /pow\(normalizedHeat,\s*4\.0\)/, "bounded fourth-power radiative cooling missing");
assert.match(shaders.scalarFragment, /sampler3D\s+uCurlDetail/, "scalar source must reuse the bounded 3D detail field");
assert.match(shaders.scalarFragment, /ring\s*\*\s*\(sourceEnabled\(SOURCE_RING\)/, "Ring scalar injection must obey its primitive mask");
assert.match(shaders.scalarFragment, /ground\s*\*\s*\(sourceEnabled\(SOURCE_GROUND\)/, "Ground-sheet scalar injection must obey its primitive mask");
assert.match(shaders.scalarFragment, /ejecta\s*\*\s*uSourceAux\.y\s*\*\s*\(sourceEnabled\(SOURCE_EJECTA\)/, "Ejecta scalar injection must obey its primitive mask");
assert.match(shaders.scalarFragment, /withoutTrail\s*\*\s*stagedImpact\s*\+\s*stagedTrail/, "Meteor scalar sources must hand off from entry to impact");
assert.match(shaders.divergenceFragment, /right\.x\s*-\s*left\.x/, "velocity divergence missing");
assert.match(shaders.jacobiFragment, /left\s*\+\s*right\s*\+\s*bottom\s*\+\s*top\s*-\s*divergence/, "Jacobi pressure solve missing");
assert.match(shaders.projectFragment, /velocity\s*-=\s*vec2\(right\s*-\s*left/, "pressure projection missing");
assert.match(shaders.tracerAdvectFragment, /sampleField\(uVelocity,\s*state\.xy\)/, "tracers must sample projected velocity");
assert.match(shaders.tracerAdvectFragment, /uSeed/, "tracer respawn must be seeded");
assert.match(shaders.tracerAdvectFragment, /sampleCurlDetail\(\s*uCurlDetail/, "tracers must reuse the bounded 3D detail field");
assert.match(shaders.tracerAdvectFragment, /sourceLane\s*=\s*index\s*&\s*3u/, "Combined primitive tracers must use deterministic source lanes");
assert.match(shaders.tracerAdvectFragment, /center\s*-\s*direction\s*\*\s*abs\(randomAlong\)/, "Meteor tracers must form a one-sided incoming trail");
assert.match(shaders.tracerAdvectFragment, /uTracerType\s*==\s*4[\s\S]*position\.y\s*-=/, "Ash tracers need a settling approximation");
assert.match(shaders.tracerVertex, /texelFetch\(uTracers/, "tracer display must use GPU state");
assert.match(shaders.tracerVertex, /2\.4\s*\*\s*lifetimeScale[\s\S]*4\.8\s*\*\s*lifetimeScale/, "Tracer display and simulation lifetimes must agree");
assert.match(shaders.volumeFragment, /1\.0\s*-\s*exp\(-opticalDepth\)/, "exponential opacity missing");
assert.match(shaders.volumeFragment, /heatRamp/, "temperature-driven color ramp missing");
assert.match(shaders.volumeFragment, /heatRamp[\s\S]*uPaletteEmber[\s\S]*uPaletteFlame[\s\S]*uPaletteHot[\s\S]*uPaletteCore/, "Selected palette must drive the GPU temperature ramp");
assert.match(shaders.volumeFragment, /darkParticulate[\s\S]*uPaletteSmoke[\s\S]*uPaletteDust/, "Smoke and dust palette colors must affect GPU volume density");
assert.match(shaders.volumeFragment, /selfShadow/, "self-shadowing missing");
assert.match(shaders.volumeFragment, /toLightLength\s*>\s*0\.00001/, "light-vector normalization must guard its zero-length case");
assert.match(shaders.volumeFragment, /toneMap/, "cinematic tone mapping missing");
assert.match(shaders.volumeFragment, /temperatureGradient[\s\S]*distortedUv/, "heat distortion must follow temperature gradients");
assert.match(shaders.volumeFragment, /float\s+erosion[\s\S]*density\s*=\s*max/, "multiscale density erosion missing");
assert.match(shaders.volumeFragment, /velocityGlyph/, "velocity diagnostic must draw vectors");
assert.match(shaders.volumeFragment, /sampler2D\s+uDivergence/, "volume diagnostics must bind real divergence");
assert.match(shaders.volumeFragment, /sampleField\(uDivergence,\s*localUv\)/, "divergence diagnostic must sample the projected field");
assert.match(shaders.volumeFragment, /scalar\.b\s*\*\s*0\.72/, "incandescent-density diagnostic missing");
assert.match(shaders.volumeFragment, /diagnostic\.rgb\s*\*\s*diagnostic\.a/, "diagnostics must use premultiplied alpha");
assert.match(shaders.volumeFragment, /MAX_RAY_STEPS/, "bounded volume ray march missing");
assert.match(shaders.volumeFragment, /-0\.8333333333/, "Kolmogorov-style k^-5\/6 velocity amplitude missing");
assert.match(shaders.volumeFragment, /sampler3D\s+uCurlDetail/, "volume pass must use a low-resolution 3D curl texture");
assert.match(shaders.volumeFragment, /sampleCurlDetail\(uCurlDetail,\s*detailCoordinate\)/, "volume layers must sample the 3D curl texture");
assert.doesNotMatch(shaders.volumeFragment, /seededCurl|randomCell|mixBits/, "ray march must not run procedural hash cascades per layer");
assert.doesNotMatch(shaders.volumeFragment, /phaseVisibility[\s\S]*phaseVisibility/, "phase handoff must not suppress radiance and alpha twice");
assert.match(shaders.volumeFragment, /\(1\.0\s*-\s*transmittance\)\s*\*\s*atmosphericFade/, "density must govern final opacity");
assert.match(shaders.metricsFragment, /length\(velocity\)\s*\/\s*1\.4/, "velocity metric encoding missing");
assert.match(shaders.metricsFragment, /scalar\.r\s*\/\s*4\.0/, "temperature metric encoding missing");
assert.match(shaders.metricsFragment, /scalar\.g\s*\/\s*4\.0/, "smoke metric encoding missing");
assert.match(shaders.metricsFragment, /abs\(sampleField\(uCurl/, "vorticity metric encoding missing");

const stepSource = engineSource.slice(
  engineSource.indexOf("  _stepSimulation(stepTime, dt)"),
  engineSource.indexOf("  _draw(programName", engineSource.indexOf("  _stepSimulation(stepTime, dt)")),
);
const projectedStateSource = stepSource.slice(stepSource.indexOf("this._draw('project'"));
assert.match(projectedStateSource, /this\._draw\('curl',\s*targets\.curl/, "curl diagnostics must refresh after projection");
assert.match(projectedStateSource, /this\._draw\('divergence',\s*targets\.divergence/, "divergence diagnostics must refresh after projection");
assert.match(engineSource, /gl\.readPixels\([\s\S]*gl\.UNSIGNED_BYTE,[\s\S]*this\._metricPixels/, "debug metrics must use reusable RGBA8 readback");
assert.match(engineSource, /diagnostic\s*!==\s*RESEARCH_FLUID_DIAGNOSTICS\.beauty/, "normal beauty rendering must not force metric readback");

// Importing and constructing the engine in a non-browser test runner must fail
// closed to the Canvas fallback instead of throwing or allocating indefinitely.
const unavailableEngine = new ResearchFluidEngine({ tier: "balanced", seed: 1842 });
const unavailableStats = unavailableEngine.getStats();
assert.equal(unavailableStats.available, false);
assert.equal(unavailableStats.webgl2Available, false);
assert.match(unavailableStats.reason, /(canvas|webgl2)/i);
assert.equal(unavailableStats.tracerCount, RESEARCH_FLUID_TIERS.balanced.tracerCount);
assert.equal(unavailableStats.fixedStep, 1 / 30);
assert.equal(unavailableStats.simulationTimestep, 1 / 30);
assert.equal(unavailableStats.fluidSteps, 0);
assert.equal(unavailableStats.velocityMagnitude, 0);
assert.equal(unavailableStats.currentVelocityMagnitude, 0);
assert.equal(unavailableStats.maximumTemperature, 0);
assert.equal(unavailableStats.currentMaximumTemperature, 0);
assert.equal(unavailableStats.smokeDensity, 0);
assert.equal(unavailableStats.currentSmokeDensity, 0);
assert.equal(unavailableStats.vorticityMagnitude, 0);
assert.equal(unavailableStats.currentVorticityMagnitude, 0);
assert.equal(unavailableStats.lastGlError, null);
unavailableEngine.destroy();
assert.equal(unavailableEngine.destroyed, true);

assert.throws(
  () => new ResearchFluidEngine({ presetId: "unknown-event-profile" }),
  /Unknown fluid preset profile/,
  "Unknown presets must fail closed instead of silently using the nuclear profile",
);
assert.throws(
  () => new ResearchFluidEngine({
    presetId: "compact-conventional",
    profileId: "nuclear-airburst-fluid-v1",
  }),
  /does not belong to preset/,
  "Preset/profile mismatches must fail closed",
);

const tierSwitchEngine = new ResearchFluidEngine({
  presetId: "compact-conventional",
  profileId: "compact-conventional-fluid-v1",
  tier: "balanced",
});
let requestedResizeTier = null;
tierSwitchEngine.available = true;
tierSwitchEngine.resize = (_width, _height, tier) => {
  requestedResizeTier = tier;
  return true;
};
tierSwitchEngine.configure({ tier: "high" });
assert.equal(requestedResizeTier, "high", "Tier reallocation reverted to the previous tier");
tierSwitchEngine.available = false;
tierSwitchEngine.destroy();

const effectivePerformanceFingerprints = new Set();
for (const [index, preset] of EVENT_PRESETS.entries()) {
  const profile = RESEARCH_FLUID_PROFILES[preset.id];
  const palette = PALETTES[index % PALETTES.length];
  const engine = new ResearchFluidEngine({
    presetId: preset.id,
    profileId: preset.researchModel.id,
    eventFamily: preset.eventFamily,
    eventFamilyId: preset.eventFamilyId,
    physicalFamilyId: preset.physicalFamilyId,
    sourcePrimitives: preset.researchModel.sourcePrimitives,
    paletteId: palette.id,
    palette,
    tier: "balanced",
    seed: 1842,
  });
  const stats = engine.getStats();
  assert.equal(stats.presetId, preset.id);
  assert.equal(stats.profileId, preset.researchModel.id);
  assert.equal(stats.fluidProfile, preset.researchModel.id);
  assert.equal(stats.eventFamilyId, preset.eventFamilyId);
  assert.equal(stats.physicalFamilyId, preset.physicalFamilyId);
  assert.deepEqual(stats.sourcePrimitives, preset.researchModel.sourcePrimitives);
  assert.equal(stats.sourcePrimitiveMask, preset.researchModel.sourcePrimitives.reduce(
    (mask, primitive) => mask | RESEARCH_FLUID_SOURCE_PRIMITIVES[primitive],
    0,
  ) >>> 0);
  assert.equal(stats.tracerType, profile.tracerType);
  assert.equal(stats.paletteId, palette.id);
  assert.deepEqual(stats.performanceProfile, profile.quality);
  assert.ok(Number.isInteger(stats.gridLongSide) && stats.gridLongSide >= 72 && stats.gridLongSide <= 320);
  assert.ok(Number.isInteger(stats.gridShortSideMinimum) && stats.gridShortSideMinimum >= 48);
  assert.ok(Number.isInteger(stats.pressureIterations) && stats.pressureIterations >= 6 && stats.pressureIterations <= 24);
  assert.ok(Number.isInteger(stats.raySteps) && stats.raySteps >= 8 && stats.raySteps <= 40);
  assert.equal(stats.volumeSlices, stats.raySteps);
  assert.ok(Number.isInteger(stats.tracerCount) && stats.tracerCount >= 128 && stats.tracerCount <= 2048);
  assert.ok(Number.isInteger(stats.detailResolution) && stats.detailResolution >= 12 && stats.detailResolution <= 40);
  effectivePerformanceFingerprints.add([
    stats.gridLongSide,
    stats.pressureIterations,
    stats.raySteps,
    stats.tracerCount,
    stats.detailResolution,
  ].join("|"));
  engine.destroy();
  assert.equal(engine.destroyed, true);
}
assert.ok(effectivePerformanceFingerprints.size >= 8, "Per-profile performance settings are not materially adaptive");

// --- Tsar-scale shockwave shell-layering + stem taper/breakup (2026-07) -----
// Same opt-in contract as the plume/material/dissipation/core controls above:
// every profile except the Tsar historical reference keeps
// shockwave.mode 0 (all three secondary bands neutral: zero strength, unit
// width) and plume.feedTaperStart/feedTaperEnd/lateralJitter/turbulenceBlend
// at their neutral defaults (0.85, 1.05, 0, 0 — the exact pre-pass hardcoded
// coreBand taper window), so simulation is byte-identical to before this pass.
for (const [presetId, profile] of Object.entries(RESEARCH_FLUID_PROFILES)) {
  assert.ok(profile.shockwave && typeof profile.shockwave === "object", `${presetId}: shockwave config missing`);
  for (const ringKey of ["ringB", "ringC", "ringD"]) {
    const ring = profile.shockwave[ringKey];
    assert.ok(ring && typeof ring === "object", `${presetId}: shockwave.${ringKey} config missing`);
    for (const key of ["radiusOffset", "widthScale", "strength", "phaseOffset"]) {
      assert.ok(Number.isFinite(ring[key]), `${presetId}: shockwave.${ringKey}.${key} must be finite`);
    }
  }
  for (const key of ["mode", "irregularity", "fadeStart", "fadeSpan"]) {
    assert.ok(Number.isFinite(profile.shockwave[key]), `${presetId}: shockwave.${key} must be finite`);
  }
  for (const key of ["feedTaperStart", "feedTaperEnd", "lateralJitter", "turbulenceBlend"]) {
    assert.ok(Number.isFinite(profile.plume[key]), `${presetId}: plume.${key} must be finite`);
  }
  if (presetId === "tsar-bomba-scale-reference") {
    const s = profile.shockwave;
    assert.equal(s.mode, 1, "Tsar must enable the shockwave shell-layering mode");
    for (const ringKey of ["ringB", "ringC", "ringD"]) {
      assert.ok(s[ringKey].strength > 0, `Tsar shockwave.${ringKey}.strength must be active`);
      assert.ok(s[ringKey].widthScale > 0, `Tsar shockwave.${ringKey}.widthScale must be positive`);
    }
    // Radii must be distinct (nested, not stacked on the primary ring) and
    // widths/strengths must not all match (avoid uniform-looking rings).
    const radii = ["ringB", "ringC", "ringD"].map((key) => s[key].radiusOffset);
    assert.equal(new Set(radii).size, 3, "Tsar shockwave band radius offsets must be distinct");
    const widths = ["ringB", "ringC", "ringD"].map((key) => s[key].widthScale);
    assert.equal(new Set(widths).size, 3, "Tsar shockwave band widths must be distinct (avoid equal-width rings)");
    const strengths = ["ringB", "ringC", "ringD"].map((key) => s[key].strength);
    assert.equal(new Set(strengths).size, 3, "Tsar shockwave band strengths must be distinct (avoid identical alpha)");
    assert.ok(s.fadeStart > 0 && s.fadeStart < 1, "Tsar shockwave fadeStart must fall within the timeline");
    assert.ok(s.fadeSpan > 0, "Tsar shockwave fadeSpan must be a real softening window, not an abrupt cutoff");
    assert.ok(
      s.fadeStart + s.fadeSpan < profile.dissipation.lateStart,
      "Tsar shockwave bands must fully soften out before the late-dissipation ramp begins",
    );

    const p = profile.plume;
    assert.ok(p.feedTaperStart > 0 && p.feedTaperStart < 1, "Tsar feedTaperStart must fall within the timeline");
    assert.ok(p.feedTaperEnd > p.feedTaperStart, "Tsar feedTaperEnd must follow feedTaperStart");
    assert.ok(p.feedTaperStart < 0.85, "Tsar coreBand must taper earlier than the old end-of-timeline default (0.85)");
    assert.ok(p.lateralJitter > 0, "Tsar stem lateral decorrelation must be active");
    assert.ok(p.turbulenceBlend > 0, "Tsar stem turbulence blend must be active");
  } else {
    const s = profile.shockwave;
    assert.equal(s.mode, 0, `${presetId}: shockwave mode must remain off for non-Tsar presets`);
    for (const ringKey of ["ringB", "ringC", "ringD"]) {
      assert.equal(s[ringKey].strength, 0, `${presetId}: shockwave.${ringKey}.strength must stay neutral (0)`);
      assert.equal(s[ringKey].widthScale, 1, `${presetId}: shockwave.${ringKey}.widthScale must stay neutral (1)`);
      assert.equal(s[ringKey].radiusOffset, 0, `${presetId}: shockwave.${ringKey}.radiusOffset must stay neutral (0)`);
    }
    const p = profile.plume;
    assert.equal(p.feedTaperStart, 0.85, `${presetId}: plume.feedTaperStart must stay at the pre-pass default (0.85)`);
    assert.equal(p.feedTaperEnd, 1.05, `${presetId}: plume.feedTaperEnd must stay at the pre-pass default (1.05)`);
    assert.equal(p.lateralJitter, 0, `${presetId}: plume.lateralJitter must stay neutral (0)`);
    assert.equal(p.turbulenceBlend, 0, `${presetId}: plume.turbulenceBlend must stay neutral (0)`);
  }
}
// The scalar/velocity shaders must carry the new uniforms (declared once in
// the shared SOURCE_PROFILE_UNIFORMS block).
for (const uniform of ["uShockwaveMode", "uShockwaveRingB", "uShockwaveRingC", "uShockwaveRingD", "uShockwaveAux", "uPlumeStemParams"]) {
  assert.match(
    `${RESEARCH_FLUID_SHADER_SOURCES.forceFragment}\n${RESEARCH_FLUID_SHADER_SOURCES.scalarFragment}`,
    new RegExp(`uniform[^;]*\\b${uniform}\\b`),
    `${uniform}: uniform missing from shaders`,
  );
}
// The three secondary bands must be reachable only through uShockwaveMode,
// and must collapse to zero (not affecting the pre-existing single-ring
// behavior) when it is 0.
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.scalarFragment,
  /if \(uShockwaveMode < 0\.5\) return 0\.0;/,
  "Shockwave layers not properly gated behind uShockwaveMode",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.scalarFragment,
  /float ring = profileRingKernel\(vUv\) \+ profileShockwaveLayers\(vUv\);/,
  "Shockwave layers must be summed into the same ring term feeding thermalKernel",
);
// The force shader's velocity-shaping ring term must remain the single
// primary ring only — the new bands are density-only shell structure and
// must not become new pressure/velocity sources.
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.forceFragment,
  /float ringKernel = profileRingKernel\(vUv\);/,
  "Force shader must keep using only the primary ring for velocity shaping",
);
// profileShockwaveLayers() is defined in the shared SOURCE_PROFILE_FUNCTIONS
// block (so it necessarily appears, unused, in forceFragment's source text
// too) but must never be invoked there to compute a velocity term.
assert.doesNotMatch(
  RESEARCH_FLUID_SHADER_SOURCES.forceFragment,
  /=\s*profileShockwaveLayers\(|\+\s*profileShockwaveLayers\(/,
  "Shockwave shell bands must stay density-only and not feed the velocity/force pass",
);

// --- Dense-phase raymarch performance optimization (2026-07) ----------------
// Skipping the lighting/shading math for near-empty raymarch layers must
// stay a bounded, unconditional (not Tsar-gated — output-equivalent for
// every preset) optimization: the alpha threshold gate must wrap only the
// shading math, while transmittance/shadowColumn keep updating from
// density/alpha every step regardless, so loop iteration count and
// early-exit timing are unaffected — verified structurally since this
// session has no browser profiler to measure the real FPS effect.
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /if \(alpha > 0\.0006\) \{/,
  "Dense-phase shading skip must be present and bounded by a small alpha threshold",
);
{
  const volume = RESEARCH_FLUID_SHADER_SOURCES.volumeFragment;
  const skipStart = volume.indexOf("if (alpha > 0.0006) {");
  const loopEnd = volume.indexOf("if (transmittance < 0.012) break;");
  assert.ok(skipStart > 0 && loopEnd > skipStart, "Shading skip must precede the per-step early-exit check");
  const between = volume.slice(skipStart, loopEnd);
  assert.match(
    between,
    /transmittance \*= 1\.0 - alpha;/,
    "transmittance must still update unconditionally after the shading-skip block, every step",
  );
  assert.match(
    between,
    /shadowColumn \+= density \* inverseSteps;/,
    "shadowColumn must still update unconditionally after the shading-skip block, every step",
  );
  // Both unconditional updates must sit after the shading block closes, not
  // inside it, so they run regardless of whether shading was skipped.
  const closeBrace = between.lastIndexOf("}\n    transmittance *= 1.0 - alpha;");
  assert.ok(closeBrace >= 0, "transmittance update must sit immediately after the shading-skip block closes");
}

console.log("Explosion Dynamics Lab fluid contract test: PASS");
console.log(`  ${tiers.length} bounded tiers × ${EVENT_PRESETS.length} preset profiles across seven event families`);
console.log("  primitive diversity, profile budgets, palette-driven volume uniforms, fluid evolution, and GPU tracers verified");
console.log("  non-WebGL runtime fails closed to the existing Canvas renderer");
console.log("  Tsar shockwave shell-layering and stem taper/breakup gating verified Tsar-only");
console.log("  dense-phase raymarch shading-skip bounded and structurally deterministic across every preset");
