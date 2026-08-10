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
  classifyBoundaryRisk,
} from "../scripts/fluid-engine.js";
import { EVENT_PRESETS, PALETTES } from "../scripts/data.js";

const LOW_YIELD_ID = "low-yield-nuclear-airburst";
const GROUND_BURST_ID = "nuclear-ground-burst";
const CASTLE_BRAVO_ID = "castle-bravo-scale-reference";
const TSAR_ID = "tsar-bomba-scale-reference";
const HIROSHIMA_ID = "hiroshima-scale-reference";
const EARLY_FISSION_ID = "early-fission-test-scale";
const UNDERGROUND_ID = "underground-detonation";
const VOLCANIC_ID = "volcanic-eruption";
const RESEARCH_MODE_IDS = new Set([LOW_YIELD_ID, GROUND_BURST_ID, TSAR_ID]);
const GROUND_COUPLED_IDS = new Set([GROUND_BURST_ID, CASTLE_BRAVO_ID, EARLY_FISSION_ID, UNDERGROUND_ID, VOLCANIC_ID]);

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
const volcanicProfile = RESEARCH_FLUID_PROFILES[VOLCANIC_ID];
const flagshipPreset = EVENT_PRESETS.find(({ id }) => id === LOW_YIELD_ID);
const groundBurstPreset = EVENT_PRESETS.find(({ id }) => id === GROUND_BURST_ID);
const tsarPreset = EVENT_PRESETS.find(({ id }) => id === TSAR_ID);
assert.equal(flagshipProfile.profileId, "nuclear-airburst-fluid-v1");
assert.equal(flagshipProfile.profileKind, 9);
assert.equal(flagshipProfile.preserveResearchSource, true);
assert.deepEqual(flagshipProfile.sourcePrimitives, ["radial-impulse", "vertical-jet", "paired-cap-vortices"]);
assert.equal(flagshipProfile.source.heat, 0.54, "Low-yield temperature source must retain the narrowed heat plateau");
assert.equal(flagshipProfile.source.incandescent, 1.12, "Low-yield incandescence must preserve the white-hot center");
assert.equal(flagshipProfile.source.turbulence, 1.05, "Low-yield source turbulence must retain the stem-decorrelation tune");
assert.equal(flagshipProfile.volume.bloom, 0.86, "Low-yield bloom must retain the structured-core tune");
assert.equal(flagshipPreset?.researchModel?.mobilePortraitPullback, 1.1,
  "Low-yield audited mobile-portrait headroom must remain unchanged");
assert.equal(groundBurstPreset?.researchModel?.mobilePortraitPullback, undefined,
  "Ground Burst must retain neutral global mobile framing after the portrait fit audit");
assert.equal(groundBurstPreset?.render?.atmosphericWash, 0.22,
  "Ground Burst must use an explicit local flash wash without changing other presets");
assert.equal(volcanicProfile.source.sustainEnd, 1.25, "Volcanic Eruption source persistence must remain explicit");
assert.deepEqual(
  volcanicProfile.physics,
  { buoyancy: 0.94, densityLoading: 1.25, windCoupling: 1.45, vorticity: 1.55, velocityRetention: 0.994, cooling: 0.82, smokeConversion: 1.12, scalarRetention: 0.9997 },
  "Volcanic Eruption physics must remain profile-local and bounded",
);
assert.equal(volcanicProfile.volume.exposure, 0.88, "Volcanic Eruption exposure must retain the restrained readability lift");
assert.deepEqual(
  volcanicProfile.quality,
  { grid: 1.04, pressure: 1.08, rays: 1.12, tracers: 1.38, detail: 1.2 },
  "Volcanic Eruption quality multipliers must remain unchanged",
);
for (const preset of EVENT_PRESETS.filter(({ id }) => id !== GROUND_BURST_ID)) {
  assert.equal(preset.render?.atmosphericWash, undefined,
    `${preset.id}: atmospheric wash override must remain neutral`);
}
assert.equal(tsarPreset?.researchModel?.mobilePortraitPullback, undefined,
  "Tsar mobile framing must remain unchanged");
assert.equal(
  EVENT_PRESETS.filter(({ researchModel }) => researchModel?.mobilePortraitPullback !== undefined).length,
  1,
  "Ground Burst tuning must not spread the low-yield mobile framing override to other presets",
);

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

// --- Reusable padded-domain contract (2026-07) ------------------------------
for (const [presetId, profile] of Object.entries(RESEARCH_FLUID_PROFILES)) {
  assert.ok(profile.domain && typeof profile.domain === "object", `${presetId}: domain config missing`);
  for (const key of ["mode", "padding", "renderOverscan", "riskMargin", "densityThreshold"]) {
    assert.ok(Number.isFinite(profile.domain[key]), `${presetId}: domain.${key} must be finite`);
  }
  assert.ok(profile.domain.renderScale !== undefined, `${presetId}: domain.renderScale missing`);
  if (presetId === CASTLE_BRAVO_ID) {
    assert.equal(profile.domain.mode, 1, "Castle Bravo must activate the reusable padded-domain path");
    assert.equal(profile.domain.padding, 0.09, "Castle Bravo boundary padding must remain profile-local");
    assert.equal(profile.domain.renderOverscan, 1.05, "Castle Bravo render overscan must remain profile-local");
    assert.deepEqual(profile.domain.renderScale, { mobile: 1, balanced: 0.76, high: 0.82 });
    assert.deepEqual(profile.domain.renderExtent, { x: 1.08, y: 1.02 });
    assert.ok(profile.domain.riskMargin > 0 && profile.domain.densityThreshold > 0);
  } else if (presetId === GROUND_BURST_ID) {
    assert.equal(profile.domain.mode, 1, "Ground Burst must activate the reusable padded-domain path");
    assert.ok(profile.domain.padding > 0 && profile.domain.padding < 0.3);
    assert.ok(profile.domain.renderOverscan > 1);
    assert.deepEqual(profile.domain.renderScale, { mobile: 1, balanced: 0.62, high: 0.72 });
    assert.equal(profile.domain.padding, 0.10, "Ground Burst boundary padding is locked at ten percent");
    assert.equal(profile.domain.renderExtent?.x, 1.65, "Ground Burst horizontal render extent is locked");
    assert.equal(profile.domain.renderExtent?.y, 1.5, "Ground Burst vertical render extent is locked");
    assert.equal(profile.quality.rays, 0.64, "Ground Burst High ray simplification must remain profile-local");
    assert.ok(profile.domain.renderExtent?.x >= 1.5 && profile.domain.renderExtent?.x <= 1.65);
    assert.ok(profile.domain.renderExtent?.y >= 1.2 && profile.domain.renderExtent?.y <= 1.5);
    assert.ok(profile.domain.riskMargin > 0 && profile.domain.densityThreshold > 0);
  } else if (presetId === EARLY_FISSION_ID) {
    assert.equal(profile.domain.mode, 1, "Early Fission must use the audited padded-domain path");
    assert.equal(profile.domain.padding, 0.08, "Early Fission boundary padding must remain profile-local");
    assert.equal(profile.domain.renderOverscan, 1.04, "Early Fission render overscan must remain profile-local");
    assert.equal(profile.domain.renderScale, 1, "Early Fission must retain the shared tier render scale");
    assert.deepEqual(profile.domain.renderExtent, { x: 1.12, y: 1.16 });
    assert.ok(profile.domain.riskMargin > 0 && profile.domain.densityThreshold > 0);
  } else if (presetId === VOLCANIC_ID) {
    assert.equal(profile.domain.mode, 1, "Volcanic Eruption must reserve reusable vertical solver headroom");
    assert.equal(profile.domain.padding, 0.10, "Volcanic Eruption padding must remain profile-local");
    assert.equal(profile.domain.renderOverscan, 1.04, "Volcanic Eruption render overscan must remain profile-local");
    assert.equal(profile.domain.renderScale, 1, "Volcanic Eruption must retain the shared tier render scale");
    assert.deepEqual(profile.domain.renderExtent, { x: 1.12, y: 1.42 });
    assert.ok(profile.domain.riskMargin > 0 && profile.domain.densityThreshold > 0);
  } else {
    assert.equal(profile.domain.mode, 0, `${presetId}: domain path must remain neutral pending its own audit`);
    assert.equal(profile.domain.padding, 0, `${presetId}: domain padding must remain neutral`);
    assert.equal(profile.domain.renderOverscan, 1, `${presetId}: render overscan must remain neutral`);
    assert.equal(profile.domain.renderScale, 1, `${presetId}: render resolution scale must remain neutral`);
    assert.equal(profile.domain.renderExtent, null, `${presetId}: render extent must remain neutral`);
  }
}
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /float fieldSampleValidity\(vec2 uv\)[\s\S]*?sampleField\(uScalar, layerUv\) \* sampleValidity/,
  "Volume reconstruction must reject out-of-field distorted samples instead of extending clamped boundary texels",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.forceFragment,
  /uniform float uDomainActiveScale;/,
  "Padded-domain source/force transform uniform missing",
);
assert.doesNotMatch(
  `${RESEARCH_FLUID_SHADER_SOURCES.forceFragment}\n${RESEARCH_FLUID_SHADER_SOURCES.volumeFragment}`,
  /nuclear-ground-burst/,
  "Generic padded-domain shader logic must not branch on preset IDs",
);
assert.match(
  readFileSync(new URL("../scripts/fluid-engine.js", import.meta.url), "utf8"),
  /activeDensityBounds|boundaryRisk|riskCells/,
  "Occupancy-aware boundary diagnostics must expose active bounds and risk cells",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /float sampleValidity = fieldSampleValidity\(layerUv\);[\s\S]*?sampleField\(uScalar, layerUv\) \* sampleValidity/,
  "Medium/high-density clipping diagnostics must sample only valid field coordinates",
);
assert.match(
  readFileSync(new URL("../scripts/renderer.js", import.meta.url), "utf8"),
  /shockToRenderRadius:[\s\S]*?shockToVerticalRadius:/,
  "Shock/smoke alignment must expose horizontal and vertical event-space ratios",
);
const rendererBoundarySource = readFileSync(new URL("../scripts/renderer.js", import.meta.url), "utf8");
assert.match(rendererBoundarySource, /getRenderResolutionScale\?\.\(\)/, "Profile render-resolution scale is not consumed by the renderer");
assert.match(rendererBoundarySource, /outputWidth = Math\.max\(1, Math\.round\(width \* dpr \* outputScale\)\)/, "Fluid output scale must be tier/profile aware");
assert.match(rendererBoundarySource, /renderDomain\?\.volumeScale[\s\S]*?renderDomain\?\.sourceCenter/, "Developer stats must retain render-domain geometry for alignment diagnostics");
const engineBoundarySource = readFileSync(new URL("../scripts/fluid-engine.js", import.meta.url), "utf8");
assert.match(engineBoundarySource, /activeDensityBounds = activeCells > 0/, "Occupancy bounds must be computed from active scalar cells");
assert.match(engineBoundarySource, /maxDensityAtEdge\s*[=:][\s\S]*?touchesMediumDensity\s*[=:]/, "Boundary diagnostics must distinguish edge density from camera cropping");
assert.match(engineBoundarySource, /computationalRiskPercent[\s\S]*?physicalGroundContact/, "Ground contact must be separated from computational boundary risk");
assert.match(engineBoundarySource, /getRenderResolutionScale\(\)/, "Fluid engine must expose the profile render scale without preset-ID logic");
assert.match(engineBoundarySource, /renderExtent: domain\.renderExtent ?/, "Render extent must be reported as part of the reusable domain contract");
const appBoundarySource = readFileSync(new URL("../scripts/app.js", import.meta.url), "utf8");
assert.match(appBoundarySource, /computationalEdgeDensity[\s\S]*?physicalGroundContact/, "Developer HUD must label computational edges separately from ground contact");

const groundContactOnly = classifyBoundaryRisk({
  activeCells: 100,
  riskCells: 24,
  physicalGroundContactCells: 24,
  maxDensityAtEdge: { left: 0, right: 0, bottom: 0.52, top: 0 },
  touchesMediumDensity: { left: false, right: false, bottom: true, top: false },
  groundCoupled: true,
});
assert.equal(groundContactOnly.computationalRiskCells, 0,
  "Ground-coupled bottom contact must not count as computational risk");
assert.equal(groundContactOnly.computationalEdgeDensity, 0,
  "Ground-coupled bottom density must not populate computational edge density");
assert.equal(groundContactOnly.physicalGroundContact.density, 0.52,
  "Ground contact density must remain available to diagnostics");
assert.equal(groundContactOnly.physicalGroundContact.touchesMediumDensity, true,
  "Ground contact medium-density state must remain available to diagnostics");

const groundWithTopContact = classifyBoundaryRisk({
  activeCells: 100,
  riskCells: 24,
  physicalGroundContactCells: 12,
  maxDensityAtEdge: { left: 0, right: 0, bottom: 0.52, top: 0.21 },
  touchesMediumDensity: { left: false, right: false, bottom: true, top: true },
  groundCoupled: true,
});
assert.equal(groundWithTopContact.computationalRiskCells, 12,
  "Ground-coupled top contact must remain computational risk");
assert.equal(groundWithTopContact.computationalEdgeDensity, 0.21,
  "Ground-coupled top density must populate computational edge density");

const nonGroundBottomContact = classifyBoundaryRisk({
  activeCells: 100,
  riskCells: 24,
  physicalGroundContactCells: 24,
  maxDensityAtEdge: { left: 0, right: 0, bottom: 0.52, top: 0 },
  touchesMediumDensity: { left: false, right: false, bottom: true, top: false },
  groundCoupled: false,
});
assert.equal(nonGroundBottomContact.computationalRiskCells, 24,
  "Non-ground profiles must not receive a bottom-contact exemption");
assert.equal(nonGroundBottomContact.computationalEdgeDensity, 0.52,
  "Non-ground bottom density must remain computational edge risk");

// --- Ground-coupled source path (2026-07) -----------------------------------
for (const [presetId, profile] of Object.entries(RESEARCH_FLUID_PROFILES)) {
  assert.ok(profile.groundCoupling && typeof profile.groundCoupling === "object",
    `${presetId}: groundCoupling config missing`);
  for (const key of [
    "mode", "radialImpulse", "spreadWidth", "heightFalloff", "horizontalRetention",
    "verticalDamping", "spreadStart", "spreadEnd", "angularVariation",
    "asymmetry", "surfaceHeat", "baseDust", "transitionLift",
    "lateGroundDrift",
  ]) {
    assert.ok(Number.isFinite(profile.groundCoupling[key]),
      `${presetId}: groundCoupling.${key} must be finite`);
  }
  const ground = profile.groundCoupling;
  assert.equal(
    ground.mode,
    GROUND_COUPLED_IDS.has(presetId) ? 1 : 0,
    `${presetId}: diagnostic ground-contact semantics must follow profile coupling mode`,
  );
  if (presetId === CASTLE_BRAVO_ID) {
    assert.equal(ground.mode, 1, "Castle Bravo must activate only the reusable ground-coupling path for its surface interaction");
    assert.ok(ground.radialImpulse > 0 && ground.radialImpulse < 0.42);
    assert.ok(ground.spreadWidth > 0 && ground.spreadWidth < 0.42);
    assert.ok(ground.heightFalloff > 1);
    assert.ok(ground.horizontalRetention > 0 && ground.horizontalRetention < 1);
    assert.ok(ground.verticalDamping > 0 && ground.verticalDamping < 1);
    assert.ok(ground.spreadStart >= 0 && ground.spreadStart < ground.spreadEnd && ground.spreadEnd < 0.5);
    assert.ok(ground.angularVariation > 0 && ground.asymmetry > 0);
    assert.ok(ground.surfaceHeat > 0 && ground.baseDust > ground.surfaceHeat);
    assert.ok(ground.transitionLift > 0 && ground.lateGroundDrift > 0);
  } else if (presetId === GROUND_BURST_ID) {
    assert.equal(ground.mode, 1, "Ground Burst alone must activate ground coupling");
    assert.ok(ground.radialImpulse > 0);
    assert.ok(ground.spreadWidth >= 0.42 && ground.spreadWidth < 1,
      "Ground Burst surface kernel must retain a bounded, profile-local width");
    assert.ok(ground.heightFalloff > 1);
    assert.ok(ground.horizontalRetention > profile.physics.velocityRetention && ground.horizontalRetention < 1);
    assert.ok(ground.verticalDamping > 0 && ground.verticalDamping < 1);
    assert.ok(ground.spreadStart >= 0 && ground.spreadStart < ground.spreadEnd && ground.spreadEnd < 0.5);
    assert.ok(ground.angularVariation > 0 && ground.asymmetry > 0);
    assert.ok(ground.surfaceHeat > 0 && ground.baseDust > ground.surfaceHeat);
    assert.ok(ground.transitionLift > 0 && ground.lateGroundDrift > 0);
    assert.equal(profile.physicalFamilyId, "ground-coupled");
  } else if (presetId === EARLY_FISSION_ID) {
    assert.equal(ground.mode, 1, "Early Fission must use the profile-local ground-coupling path");
    assert.ok(ground.radialImpulse > 0 && ground.radialImpulse < 0.42);
    assert.ok(ground.spreadWidth > 0 && ground.spreadWidth < 0.42);
    assert.ok(ground.heightFalloff > 1);
    assert.ok(ground.horizontalRetention > 0 && ground.horizontalRetention < 1);
    assert.ok(ground.verticalDamping > 0 && ground.verticalDamping < 1);
    assert.ok(ground.spreadStart >= 0 && ground.spreadStart < ground.spreadEnd && ground.spreadEnd < 0.5);
    assert.ok(ground.angularVariation > 0 && ground.asymmetry > 0);
    assert.ok(ground.surfaceHeat > 0 && ground.baseDust > ground.surfaceHeat);
    assert.ok(ground.transitionLift > 0 && ground.lateGroundDrift > 0);
  } else if (presetId === UNDERGROUND_ID) {
    assert.equal(ground.mode, 1, "Underground Detonation must report physical ground contact separately");
    assert.ok(ground.radialImpulse > 0 && ground.radialImpulse < 0.42);
    assert.ok(ground.spreadWidth > 0 && ground.spreadWidth < 0.42);
    assert.ok(ground.heightFalloff > 1);
    assert.ok(ground.horizontalRetention > 0 && ground.horizontalRetention < 1);
    assert.ok(ground.verticalDamping > 0 && ground.verticalDamping < 1);
    assert.ok(ground.spreadStart >= 0 && ground.spreadStart < ground.spreadEnd && ground.spreadEnd < 0.5);
    assert.ok(ground.angularVariation > 0 && ground.asymmetry > 0);
    assert.ok(ground.surfaceHeat > 0 && ground.baseDust > ground.surfaceHeat);
    assert.ok(ground.transitionLift > 0 && ground.lateGroundDrift > 0);
  } else if (presetId === VOLCANIC_ID) {
    assert.equal(ground.mode, 1, "Volcanic Eruption must report lower contact as physical ground interaction");
    assert.equal(ground.radialImpulse, 0.18);
    assert.equal(ground.spreadWidth, 0.36);
    assert.equal(ground.heightFalloff, 1.8);
    assert.equal(ground.horizontalRetention, 0.94);
    assert.equal(ground.verticalDamping, 0.76);
    assert.equal(ground.spreadStart, 0.008);
    assert.equal(ground.spreadEnd, 0.18);
    assert.equal(ground.angularVariation, 0.42);
    assert.equal(ground.asymmetry, 0.28);
    assert.equal(ground.surfaceHeat, 0.28);
    assert.equal(ground.baseDust, 1.3);
    assert.equal(ground.transitionLift, 0.70);
    assert.equal(ground.lateGroundDrift, 0.05);
  } else {
    assert.equal(ground.mode, 0, `${presetId}: ground coupling must remain neutral`);
    assert.equal(ground.radialImpulse, 0);
    assert.equal(ground.angularVariation, 0);
    assert.equal(ground.surfaceHeat, 0);
    assert.equal(ground.baseDust, 0);
    assert.equal(ground.lateGroundDrift, 0);
  }
}
for (const uniform of [
  "uGroundCouplingMode", "uGroundSpreadWidth", "uGroundCouplingA", "uGroundCouplingB", "uGroundCouplingC",
]) {
  assert.match(
    `${RESEARCH_FLUID_SHADER_SOURCES.forceFragment}\n${RESEARCH_FLUID_SHADER_SOURCES.scalarFragment}`,
    new RegExp(`uniform[^;]*\\b${uniform}\\b`),
    `${uniform}: ground-coupling uniform missing`,
  );
}
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.forceFragment,
  /if \(uGroundCouplingMode > 0\.5 && sourceEnabled\(SOURCE_GROUND\)\)/,
  "Ground-layer velocity shaping must be profile-gated",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.scalarFragment,
  /if \(uGroundCouplingMode > 0\.5\) \{[\s\S]*?float irregularGround/,
  "Ground heat/dust separation must be profile-gated",
);
assert.doesNotMatch(
  `${RESEARCH_FLUID_SHADER_SOURCES.forceFragment}\n${RESEARCH_FLUID_SHADER_SOURCES.scalarFragment}`,
  /nuclear-ground-burst/,
  "Generic shader logic must not branch on the Ground Burst preset ID",
);

// --- Profile-gated broad-plume research controls (2026-07) -------------------
// Low-yield, Ground Burst, Castle Bravo, and Tsar opt in with distinct scales;
// all other presets remain byte-identical and neutral.
for (const [presetId, profile] of Object.entries(RESEARCH_FLUID_PROFILES)) {
  assert.ok(profile.plume && typeof profile.plume === "object", `${presetId}: plume config missing`);
  for (const key of ["mode", "expansion", "vortex", "persistence", "widen"]) {
    assert.ok(Number.isFinite(profile.plume[key]), `${presetId}: plume.${key} must be finite`);
  }
  if (presetId === LOW_YIELD_ID) {
    assert.equal(profile.plume.mode, 2, "Low-yield must enable its separate mode 2 with standard absorbing boundaries");
    assert.ok(profile.plume.expansion > 0 && profile.plume.expansion < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.expansion);
    assert.ok(profile.plume.vortex > 0 && profile.plume.vortex < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.vortex);
    assert.ok(profile.plume.persistence > 0 && profile.plume.persistence < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.persistence);
    assert.ok(profile.plume.widen > 0 && profile.plume.widen < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.widen);
    assert.ok(profile.source.radius > 0.065, "Low-yield source must widen from the preserved neutral radius");
    assert.ok(profile.source.radial > profile.source.vertical, "Low-yield radial injection must lead vertical feed");
  } else if (presetId === GROUND_BURST_ID) {
    assert.equal(profile.plume.mode, 3, "Ground Burst alone must enable the ground-coupled plume mode");
    assert.ok(profile.plume.expansion > 0 && profile.plume.expansion < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.expansion);
    assert.ok(profile.plume.vortex > 0 && profile.plume.vortex < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.vortex);
    assert.ok(profile.plume.persistence > 0 && profile.plume.persistence < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.persistence);
    assert.ok(profile.plume.widen > 0 && profile.plume.widen < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.widen);
    assert.ok(profile.source.vertical > profile.source.radial, "Ground Burst must retain stronger upward lift than radial source injection");
    assert.equal(profile.source.radial, 0.18, "Ground Burst radial source remains narrowed and profile-local");
    assert.equal(profile.source.vertical, 2.02, "Ground Burst vertical feed remains explicitly strong");
    assert.equal(profile.source.capScale, 1.3, "Ground Burst cap scale remains modest and profile-local");
    assert.equal(profile.source.capRoll, 2.75, "Ground Burst cap underside roll remains profile-local");
    assert.equal(profile.plume.vortex, 0.98, "Ground Burst cap vortex rollout remains profile-local");
    assert.equal(profile.plume.feedTaperEnd, 0.7, "Ground Burst stem feed hands off before the mature cap flattens");
  } else if (presetId === EARLY_FISSION_ID) {
    assert.equal(profile.plume.mode, 3, "Early Fission must use the ground-coupled broad-plume mode");
    assert.ok(profile.plume.expansion > 0 && profile.plume.expansion < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.expansion);
    assert.ok(profile.plume.vortex > 0 && profile.plume.vortex < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.vortex);
    assert.ok(profile.plume.persistence > 0 && profile.plume.persistence < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.persistence);
    assert.ok(profile.plume.widen > 0 && profile.plume.widen < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.widen);
    assert.ok(profile.source.vertical > profile.source.radial, "Early Fission must rise before lateral rollout");
    assert.ok(profile.plume.feedTaperStart > 0 && profile.plume.feedTaperStart < profile.plume.feedTaperEnd);
    assert.ok(profile.plume.feedTaperEnd < 0.8);
  } else if (presetId === UNDERGROUND_ID) {
    assert.equal(profile.plume.mode, 3, "Underground Detonation must use the ground-coupled plume mode");
    assert.ok(profile.plume.expansion > 0);
    assert.ok(profile.plume.vortex > 0);
    assert.ok(profile.plume.persistence > 0 && profile.plume.persistence < 1);
    assert.ok(profile.plume.widen > 0);
    assert.ok(profile.source.vertical > profile.source.radial, "Underground Detonation must retain a vertically driven breakthrough");
    assert.equal(profile.plume.feedTaperStart, 0.4);
    assert.equal(profile.plume.feedTaperEnd, 0.72);
    assert.ok(profile.plume.lateralJitter > 0 && profile.plume.turbulenceBlend > 0);
  } else if (presetId === VOLCANIC_ID) {
    assert.equal(profile.plume.mode, 3, "Volcanic Eruption must use the ground-aware plume mode");
    assert.equal(profile.plume.expansion, 0.0025);
    assert.equal(profile.plume.vortex, 0.08);
    assert.equal(profile.plume.persistence, 0.74);
    assert.equal(profile.plume.widen, 0.010);
    assert.equal(profile.plume.feedTaperStart, 0.74);
    assert.equal(profile.plume.feedTaperEnd, 1.02);
    assert.equal(profile.plume.lateralJitter, 0.32);
    assert.equal(profile.plume.turbulenceBlend, 0.36);
    assert.ok(profile.source.vertical > profile.source.radial,
      "Volcanic Eruption must retain a vertical vent bias");
    assert.equal(profile.source.capScale, 0.82);
    assert.equal(profile.source.capRoll, 0.45);
    assert.equal(profile.source.capVertical, 0.36);
  } else if (presetId === CASTLE_BRAVO_ID) {
    assert.equal(profile.plume.mode, 3, "Castle Bravo must use the ground-coupled broad-plume mode");
    assert.ok(profile.plume.expansion > 0 && profile.plume.expansion < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.expansion);
    assert.ok(profile.plume.vortex > 0 && profile.plume.vortex < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.vortex);
    assert.ok(profile.plume.persistence > 0 && profile.plume.persistence < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.persistence);
    assert.ok(profile.plume.widen > 0 && profile.plume.widen < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.widen);
    assert.ok(profile.source.vertical > profile.source.radial, "Castle Bravo must rise before its mature lateral rollout");
    assert.ok(profile.plume.lateralJitter > 0 && profile.plume.turbulenceBlend > 0);
    assert.ok(profile.plume.feedTaperStart > 0 && profile.plume.feedTaperStart < profile.plume.feedTaperEnd);
    assert.ok(profile.plume.feedTaperEnd < 0.8);
  } else if (presetId === TSAR_ID) {
    assert.equal(profile.plume.mode, 1, "Tsar must retain its existing historical-scale plume mode 1");
    assert.ok(profile.plume.expansion > 0, "Tsar expansion must be active");
    assert.ok(profile.plume.vortex > 0, "Tsar vortex population must be active");
    assert.ok(profile.plume.persistence > 0, "Tsar persistence must be active");
    // Source must broaden the plume: radial injection at least matches vertical
    // so the column is no longer a pencil jet.
    assert.ok(profile.source.radial >= profile.source.vertical, "Tsar radial injection must not be dominated by vertical");
  } else if (presetId === HIROSHIMA_ID) {
    assert.equal(profile.plume.mode, 1, "Hiroshima must use the historical persistence path");
    assert.ok(profile.plume.expansion > 0 && profile.plume.expansion < 0.02, "Hiroshima expansion must remain compact");
    assert.ok(profile.plume.vortex > 0 && profile.plume.vortex < 0.1, "Hiroshima vortex force must remain compact");
    assert.ok(profile.plume.persistence > 0 && profile.plume.persistence < RESEARCH_FLUID_PROFILES[TSAR_ID].plume.persistence);
    assert.ok(profile.plume.widen > 0 && profile.plume.widen < 0.02, "Hiroshima widening must remain compact");
    assert.ok(profile.plume.feedTaperStart > 0.5 && profile.plume.feedTaperStart < profile.plume.feedTaperEnd);
    assert.ok(profile.plume.feedTaperEnd < 0.95);
    assert.ok(profile.plume.lateralJitter > 0 && profile.plume.lateralJitter < 0.2);
    assert.ok(profile.plume.turbulenceBlend > 0 && profile.plume.turbulenceBlend < 0.1);
  } else {
    assert.equal(profile.plume.mode, 0, `${presetId}: broad-plume mode must remain neutral`);
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

// --- Profile-gated smoke-material controls (2026-07) -------------------------
for (const [presetId, profile] of Object.entries(RESEARCH_FLUID_PROFILES)) {
  assert.ok(profile.material && typeof profile.material === "object", `${presetId}: material config missing`);
  for (const key of ["mode", "sootAbsorption", "dustAbsorption", "detailBoost", "warmCoolContrast", "lowDensityVisibility", "detailOctaveMode", "interiorDepth"]) {
    assert.ok(Number.isFinite(profile.material[key]), `${presetId}: material.${key} must be finite`);
  }
  if (presetId === LOW_YIELD_ID) {
    assert.equal(profile.material.mode, 1, "Low-yield must enable restrained smoke material");
    assert.ok(profile.material.sootAbsorption > profile.material.dustAbsorption);
    assert.ok(profile.material.detailBoost > 0 && profile.material.detailBoost < RESEARCH_FLUID_PROFILES[TSAR_ID].material.detailBoost);
    assert.ok(profile.material.warmCoolContrast > 0 && profile.material.warmCoolContrast < RESEARCH_FLUID_PROFILES[TSAR_ID].material.warmCoolContrast);
    assert.equal(profile.material.interiorDepth, 0, "Low-yield must not inherit Ground Burst interior-depth shading");
    assert.equal(profile.material.detailOctaveMode, 1, "Low-yield's approved detail octave must remain explicit");
  } else if (presetId === GROUND_BURST_ID) {
    assert.equal(profile.material.mode, 1, "Ground Burst must enable independent dust/soot material");
    assert.ok(profile.material.sootAbsorption > profile.material.dustAbsorption);
    assert.ok(profile.material.dustAbsorption > 0 && profile.material.dustAbsorption < 1,
      "Ground Burst dust must retain translucent outer layers");
    assert.ok(profile.material.detailBoost > 0 && profile.material.detailBoost < RESEARCH_FLUID_PROFILES[TSAR_ID].material.detailBoost);
    assert.ok(profile.material.warmCoolContrast > 0 && profile.material.warmCoolContrast <= 1.2);
    assert.equal(profile.material.detailOctaveMode, 0, "Ground Burst material separation must not buy the third detail octave");
    assert.ok(profile.material.interiorDepth > 0 && profile.material.interiorDepth <= 1.5,
      "Ground Burst must use the existing view-ray depth sample for material separation");
    assert.equal(profile.material.interiorDepth, 1.2, "Ground Burst depth separation remains on the existing two-octave path");
    assert.equal(profile.material.detailOctaveMode, 0, "Ground Burst must not reactivate the third detail octave");
  } else if (presetId === CASTLE_BRAVO_ID) {
    assert.equal(profile.material.mode, 1, "Castle Bravo must enable independent soot/dust optical depth");
    assert.ok(profile.material.sootAbsorption > profile.material.dustAbsorption);
    assert.ok(profile.material.dustAbsorption > 0 && profile.material.dustAbsorption < 1);
    assert.equal(profile.material.detailOctaveMode, 0, "Castle Bravo must retain the two-octave detail budget");
    assert.equal(profile.material.detailBoost, 0, "Castle Bravo must not purchase a third detail octave indirectly");
    assert.ok(profile.material.warmCoolContrast > 0 && profile.material.warmCoolContrast <= 1.2);
    assert.ok(profile.material.interiorDepth > 0 && profile.material.interiorDepth <= 1.5);
  } else if (presetId === TSAR_ID) {
    assert.equal(profile.material.mode, 1, "Tsar must enable the smoke-material mode");
    assert.ok(profile.material.sootAbsorption > profile.material.dustAbsorption, "Tsar soot must absorb more strongly than lofted dust");
    assert.ok(profile.material.detailBoost > 0, "Tsar energy-weighted detail octave must be active");
    assert.ok(profile.material.warmCoolContrast > 0, "Tsar lit/shadowed contrast widening must be active");
    assert.equal(profile.material.detailOctaveMode, 1, "Tsar approved detail octave must remain explicit");
    assert.equal(profile.material.interiorDepth, 0, "Tsar must retain its established material path");
  } else if (presetId === HIROSHIMA_ID) {
    assert.equal(profile.material.mode, 1, "Hiroshima must enable structured smoke material");
    assert.ok(profile.material.sootAbsorption > profile.material.dustAbsorption);
    assert.equal(profile.material.detailBoost, 0, "Hiroshima must retain the two-octave detail budget");
    assert.ok(profile.material.warmCoolContrast > 0, "Hiroshima must separate warm and cool material");
    assert.equal(profile.material.detailOctaveMode, 0, "Hiroshima must not activate a third detail octave");
    assert.ok(profile.material.interiorDepth > 0, "Hiroshima must use the existing interior-depth weighting");
  } else if (presetId === EARLY_FISSION_ID) {
    assert.equal(profile.material.mode, 1, "Early Fission must enable structured smoke material");
    assert.ok(profile.material.sootAbsorption > profile.material.dustAbsorption);
    assert.equal(profile.material.detailBoost, 0, "Early Fission must retain the two-octave detail path");
    assert.ok(profile.material.warmCoolContrast > 0);
    assert.equal(profile.material.detailOctaveMode, 0, "Early Fission must not activate a third detail octave");
    assert.ok(profile.material.interiorDepth > 0);
  } else if (presetId === UNDERGROUND_ID) {
    assert.equal(profile.material.mode, 1, "Underground Detonation must enable particulate depth material");
    assert.ok(profile.material.sootAbsorption > profile.material.dustAbsorption);
    assert.ok(profile.material.detailBoost >= 0 && profile.material.detailBoost < 0.5);
    assert.ok(profile.material.warmCoolContrast > 0);
    assert.ok(profile.material.lowDensityVisibility > 0 && profile.material.lowDensityVisibility <= 0.4,
      "Underground Detonation weak particulate visibility must remain a restrained profile-local lift");
    assert.equal(profile.material.detailOctaveMode, 0, "Underground Detonation must retain the two-octave detail path");
    assert.ok(profile.material.interiorDepth > 0);
  } else if (presetId === VOLCANIC_ID) {
    assert.equal(profile.material.mode, 1, "Volcanic Eruption must enable separated ash/soot material");
    assert.equal(profile.material.sootAbsorption, 1.45);
    assert.equal(profile.material.dustAbsorption, 0.72);
    assert.equal(profile.material.detailBoost, 0.10);
    assert.equal(profile.material.warmCoolContrast, 0.34);
    assert.equal(profile.material.lowDensityVisibility, 0.16);
    assert.equal(profile.material.detailOctaveMode, 0,
      "Volcanic Eruption must retain the two-octave detail budget");
    assert.equal(profile.material.interiorDepth, 0.38);
  } else {
    assert.equal(profile.material.mode, 0, `${presetId}: smoke-material mode must remain neutral`);
    assert.equal(profile.material.sootAbsorption, 1, `${presetId}: default soot absorption must stay neutral`);
    assert.equal(profile.material.dustAbsorption, 1, `${presetId}: default dust absorption must stay neutral`);
    assert.equal(profile.material.lowDensityVisibility, 0, `${presetId}: low-density visibility must stay neutral`);
    assert.equal(profile.material.detailOctaveMode, 0, `${presetId}: detail octave must stay neutral`);
    assert.equal(profile.material.interiorDepth, 0, `${presetId}: interior depth must stay neutral`);
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
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /uniform\s+float\s+uDetailOctaveMode\b/,
  "uDetailOctaveMode: independent detail uniform missing from the volume shader",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /uniform\s+float\s+uMaterialInteriorDepth\b/,
  "uMaterialInteriorDepth: Ground-only depth separation uniform missing from the volume shader",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /uniform\s+float\s+uMaterialLowDensityVisibility\b/,
  "uMaterialLowDensityVisibility: weak-particulate transfer uniform missing from the volume shader",
);
// Every new material term must be reachable only through the uMaterialMode
// gate, and must algebraically collapse to the prior expression when it is 0.
for (const gatedTerm of [
  /uMaterialMode > 0\.5\s*\?\s*smokeDensity \* uMaterialParams\.x \+ dustDensity \* uMaterialParams\.y\s*:\s*smoke/,
  /float contrastBoost = uMaterialMode > 0\.5 \? uMaterialParams\.w : 0\.0;/,
]) {
  assert.match(RESEARCH_FLUID_SHADER_SOURCES.volumeFragment, gatedTerm, `Material technique not properly gated behind uMaterialMode: ${gatedTerm}`);
}
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /int detailOctaves = uDetailOctaveMode > 0\.5 \? 3 : 2;/,
  "The expensive third detail octave must be independently profile-gated",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /float interiorBlend = clamp\([\s\S]*?uMaterialInteriorDepth[\s\S]*?\);/,
  "Ground material depth must reuse the sampled view-ray shadow instead of a third detail octave",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /float frontLayer = 1\.0 - smoothstep\([\s\S]*?float rearLayer = smoothstep\([\s\S]*?float middleLayer = clamp\([\s\S]*?uMaterialInteriorDepth/,
  "Ground material depth must separate front, middle, and rear layers on the existing ray",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /density \*= 1\.0 \+ depthContrast \* \([\s\S]*?middleLayer[\s\S]*?frontLayer[\s\S]*?rearLayer/,
  "Ground material depth must add only bounded layer weighting, not another sample path",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /float lowDensitySignal = 1\.0 - smoothstep\(0\.035, 0\.22, smoke\);[\s\S]*?opticalDepth \* \(1\.0 \+ lowDensityLift \* lowDensitySignal\)/,
  "Underground weak-particulate visibility must use a bounded low-density optical transfer",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /float lowDensityLift = uMaterialMode > 0\.5\s*\?[\s\S]*?uMaterialLowDensityVisibility[\s\S]*?:\s*0\.0;/,
  "Weak-particulate visibility must remain gated to opt-in material profiles",
);

// --- Ground Burst wind/shear streaks (2026-08) -----------------------------
// The late flow overlay is intentionally opt-in and profile-owned. Its strand
// family must remain deterministic, visibly multi-line at every tier, and
// independent from the shockwave/raymarch budgets.
const windStreaks = groundBurstPreset?.researchModel?.windStreaks;
assert.ok(windStreaks && typeof windStreaks === "object", "Ground Burst wind-streak profile missing");
assert.equal(windStreaks.mode, 1, "Ground Burst must opt into the wind-streak overlay");
assert.ok(windStreaks.onset < windStreaks.peak && windStreaks.peak < windStreaks.fadeStart);
assert.ok(windStreaks.fadeStart < windStreaks.fadeEnd && windStreaks.fadeEnd <= 1,
  "Wind streaks must fully fade by the end of the normalized timeline");
for (const [tierId, tier] of Object.entries(windStreaks).filter(([key]) => ["high", "balanced", "mobile"].includes(key))) {
  assert.ok(Number.isInteger(tier.count) && tier.count >= 5 && tier.count <= 12,
    `${tierId}: wind streak count must remain in the 5–12 visual range`);
  assert.ok(tier.spanMin > 0 && tier.spanMin < tier.spanMax);
  assert.ok(tier.widthMin > 0 && tier.widthMin < tier.widthMax);
  assert.ok(tier.opacityMin > 0 && tier.opacityMin < tier.opacityMax && tier.opacityMax <= 0.25);
  assert.ok(tier.curvature > 0 && tier.amplitude > 0);
  assert.ok(Number.isInteger(tier.segments) && tier.segments >= 6 && tier.segments <= 18);
  assert.ok(tier.dropout > 0 && tier.dropout < 0.7);
  assert.ok(tier.fadeJitter >= 0 && tier.fadeJitter <= 0.3);
}
assert.equal(windStreaks.high.count, 11);
assert.equal(windStreaks.balanced.count, 8);
assert.equal(windStreaks.mobile.count, 6);
assert.match(rendererBoundarySource, /_drawWindStreakOverlay\(/, "Profile-gated wind-streak renderer path missing");
assert.match(rendererBoundarySource, /wind-strand:\$\{strand\}/, "Wind-strand variation must be seed-deterministic");
assert.match(rendererBoundarySource, /wind-segment:\$\{strand\}:\$\{segment\}/, "Wind-strand segmentation must be seed-deterministic");
assert.match(rendererBoundarySource, /fadeJitter|strandFadeStart/, "Wind strands must have deterministic per-strand fade variation");
assert.match(rendererBoundarySource, /windStreakProfile\?\.mode > 0/, "Wind streaks must remain profile-gated");
assert.doesNotMatch(rendererBoundarySource, /nuclear-ground-burst/, "Generic renderer must not hard-code the Ground Burst preset ID");
for (const preset of EVENT_PRESETS.filter(({ id }) => id !== GROUND_BURST_ID)) {
  assert.equal(preset.researchModel?.windStreaks, undefined,
    `${preset.id}: wind-streak profile must remain neutral`);
}

// --- Profile-gated late dissipation (2026-07) --------------------------------
// Tsar, Ground Burst, and Underground Detonation use profile-local late tails.
// Every other profile keeps the neutral envelope.
for (const [presetId, profile] of Object.entries(RESEARCH_FLUID_PROFILES)) {
  assert.ok(profile.dissipation && typeof profile.dissipation === "object", `${presetId}: dissipation config missing`);
  for (const key of [
    "mode", "lateStart", "finalStart", "sourceTaperEnd",
    "retentionFloorSmoke", "retentionFloorDust", "outwardBoost", "buoyancyFalloff", "motionDamp",
    "lateVelocityRetention", "lateCurl", "lateShear", "latePhaseRate",
  ]) {
    assert.ok(Number.isFinite(profile.dissipation[key]), `${presetId}: dissipation.${key} must be finite`);
  }
  if (presetId === TSAR_ID) {
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
    assert.ok(d.lateVelocityRetention > profile.physics.velocityRetention && d.lateVelocityRetention < 1,
      "Tsar late tail must retain a bounded amount of resolved velocity");
    assert.ok(d.lateCurl > 0 && d.lateShear > 0 && d.latePhaseRate > 0,
      "Tsar late tail must add deterministic curl and shear, not opacity-only dissipation");
  } else if (presetId === GROUND_BURST_ID) {
    const d = profile.dissipation;
    assert.equal(d.mode, 2, "Ground Burst alone must enable its ground-tail dissipation mode");
    assert.ok(d.lateStart > 0.45 && d.lateStart < d.sourceTaperEnd,
      "Ground Burst late motion must begin after cap rollout, before a residual stem freezes");
    assert.ok(d.sourceTaperEnd < d.finalStart && d.finalStart === 1);
    assert.equal(d.retentionFloorSmoke, 1, "Ground Burst soot tail must retain faint elevated wisps");
    assert.ok(d.retentionFloorDust < d.retentionFloorSmoke, "Ground Burst dust must thin faster than soot");
    assert.ok(d.outwardBoost > 0 && d.outwardBoost < RESEARCH_FLUID_PROFILES[TSAR_ID].dissipation.outwardBoost);
    assert.ok(d.lateCurl > 0 && d.lateShear > 0 && d.latePhaseRate > 0);
    assert.ok(d.lateVelocityRetention > profile.physics.velocityRetention && d.lateVelocityRetention < 1);
  } else if (presetId === CASTLE_BRAVO_ID) {
    const d = profile.dissipation;
    assert.equal(d.mode, 1, "Castle Bravo must enable a gradual late-motion tail");
    assert.ok(d.lateStart > 0.5 && d.lateStart < d.sourceTaperEnd);
    assert.ok(d.sourceTaperEnd < d.finalStart && d.finalStart <= 1);
    assert.ok(d.retentionFloorSmoke < 1 && d.retentionFloorSmoke > 0);
    assert.ok(d.retentionFloorDust < d.retentionFloorSmoke && d.retentionFloorDust > 0);
    assert.ok(d.outwardBoost > 0 && d.buoyancyFalloff > 0 && d.motionDamp > 0);
    assert.ok(d.lateVelocityRetention > profile.physics.velocityRetention && d.lateVelocityRetention < 1);
    assert.ok(d.lateCurl > 0 && d.lateShear > 0 && d.latePhaseRate > 0);
  } else if (presetId === HIROSHIMA_ID) {
    const d = profile.dissipation;
    assert.equal(d.mode, 1, "Hiroshima must enable a restrained late-motion tail");
    assert.ok(d.lateStart > 0.5 && d.lateStart < d.sourceTaperEnd);
    assert.ok(d.sourceTaperEnd < d.finalStart && d.finalStart <= 1);
    assert.ok(d.retentionFloorSmoke < 1 && d.retentionFloorSmoke > 0);
    assert.ok(d.retentionFloorDust < d.retentionFloorSmoke && d.retentionFloorDust > 0);
    assert.ok(d.motionDamp > 0 && d.outwardBoost >= 0);
    assert.ok(d.lateVelocityRetention > profile.physics.velocityRetention && d.lateVelocityRetention < 1);
    assert.ok(d.lateCurl > 0 && d.lateShear > 0 && d.latePhaseRate > 0);
  } else if (presetId === EARLY_FISSION_ID) {
    const d = profile.dissipation;
    assert.equal(d.mode, 1, "Early Fission must enable a profile-local late-motion tail");
    assert.equal(profile.source.sustainEnd, 0.8, "Early Fission source sustain must extend beyond the previous late-phase handoff");
    assert.equal(d.lateStart, 0.76, "Early Fission late dissipation must begin after the source handoff");
    assert.ok(d.lateStart > 0.5 && d.lateStart < d.sourceTaperEnd);
    assert.equal(d.finalStart, 1);
    assert.equal(d.sourceTaperEnd, 1);
    assert.equal(d.retentionFloorSmoke, 1, "Early Fission smoke must retain its late visual mass");
    assert.ok(d.retentionFloorDust < d.retentionFloorSmoke && d.retentionFloorDust > 0);
    assert.ok(d.motionDamp > 0 && d.outwardBoost > 0);
    assert.ok(d.lateVelocityRetention > profile.physics.velocityRetention && d.lateVelocityRetention < 1);
    assert.ok(d.lateCurl > 0 && d.lateShear > 0 && d.latePhaseRate > 0);
  } else if (presetId === UNDERGROUND_ID) {
    const d = profile.dissipation;
    assert.equal(d.mode, 1, "Underground Detonation must use a gradual particulate late tail");
    assert.equal(profile.source.sustainEnd, 0.64, "Underground Detonation sustain must preserve the upper vent without extending mature geometry");
    assert.equal(d.lateStart, 0.60, "Underground Detonation late dissipation must begin before the final particulate fade");
    assert.equal(d.finalStart, 0.96);
    assert.equal(d.sourceTaperEnd, 0.72);
    assert.ok(d.retentionFloorSmoke < 1 && d.retentionFloorSmoke > 0);
    assert.ok(d.retentionFloorDust < d.retentionFloorSmoke && d.retentionFloorDust > 0);
    assert.ok(d.outwardBoost > 0 && d.buoyancyFalloff > 0 && d.motionDamp > 0);
    assert.ok(d.lateVelocityRetention > profile.physics.velocityRetention && d.lateVelocityRetention < 1);
    assert.ok(d.lateCurl > 0 && d.lateShear > 0 && d.latePhaseRate > 0);
  } else {
    const d = profile.dissipation;
    assert.equal(d.mode, 0, `${presetId}: late-dissipation mode must remain off for non-target presets`);
    assert.equal(d.lateStart, 1, `${presetId}: dissipation.lateStart must stay neutral (1)`);
    assert.equal(d.finalStart, 1, `${presetId}: dissipation.finalStart must stay neutral (1)`);
    assert.equal(d.retentionFloorSmoke, 1, `${presetId}: dissipation.retentionFloorSmoke must stay neutral (1)`);
    assert.equal(d.retentionFloorDust, 1, `${presetId}: dissipation.retentionFloorDust must stay neutral (1)`);
    assert.equal(d.outwardBoost, 0, `${presetId}: dissipation.outwardBoost must stay neutral (0)`);
    assert.equal(d.buoyancyFalloff, 0, `${presetId}: dissipation.buoyancyFalloff must stay neutral (0)`);
    assert.equal(d.motionDamp, 0, `${presetId}: dissipation.motionDamp must stay neutral (0)`);
    assert.equal(d.lateVelocityRetention, 1, `${presetId}: dissipation.lateVelocityRetention must stay neutral (1)`);
    assert.equal(d.lateCurl, 0, `${presetId}: dissipation.lateCurl must stay neutral (0)`);
    assert.equal(d.lateShear, 0, `${presetId}: dissipation.lateShear must stay neutral (0)`);
    assert.equal(d.latePhaseRate, 0, `${presetId}: dissipation.latePhaseRate must stay neutral (0)`);
  }
}
// The velocity/scalar/tracer shaders must all carry the dissipation uniforms
// (declared once in the shared SOURCE_PROFILE_UNIFORMS block).
for (const uniform of ["uDissipationMode", "uDissipationParams", "uDissipationParams2", "uDissipationParams3"]) {
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
  /float dissipationVelocityRetention\(\) \{\s*\n\s*if \(uDissipationMode < 0\.5\) return uProfileDecay\.x;/,
  /float retainedVelocity = dissipationVelocityRetention\(\);/,
  /if \(uGroundCouplingMode > 0\.5\)[\s\S]*?velocity\.x \*= pow\(clamp\(horizontalRetention, 0\.9, 1\.0\), uDt \* 60\.0\);/,
  /velocity \+= broadCurl \* uDissipationParams3\.y/,
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

// --- Profile-gated core/tracer polish (2026-07) ------------------------------
for (const [presetId, profile] of Object.entries(RESEARCH_FLUID_PROFILES)) {
  assert.ok(profile.core && typeof profile.core === "object", `${presetId}: core config missing`);
  for (const key of ["mode", "highlightThreshold", "highlightSharpness", "structureBlend", "bloomGateScale"]) {
    assert.ok(Number.isFinite(profile.core[key]), `${presetId}: core.${key} must be finite`);
  }
  if (presetId === LOW_YIELD_ID) {
    const c = profile.core;
    const tsarCore = RESEARCH_FLUID_PROFILES[TSAR_ID].core;
    assert.equal(c.mode, 1, "Low-yield must enable core-polish mode");
    assert.deepEqual(
      c,
      { mode: 1, highlightThreshold: 2.32, highlightSharpness: 3.08, structureBlend: 0.79, bloomGateScale: 8.8 },
      "Low-yield core separation must retain the approved final-pass values",
    );
    assert.ok(c.highlightThreshold > 1.5 && c.highlightThreshold < tsarCore.highlightThreshold);
    assert.ok(c.highlightSharpness > 2 && c.highlightSharpness < tsarCore.highlightSharpness);
    assert.ok(c.structureBlend > 0 && c.structureBlend < tsarCore.structureBlend);
    assert.ok(c.bloomGateScale > 0 && c.bloomGateScale < tsarCore.bloomGateScale);
  } else if (presetId === GROUND_BURST_ID) {
    const c = profile.core;
    assert.equal(c.mode, 1, "Ground Burst must enable structured-core mode");
    assert.ok(c.highlightThreshold >= 0.2 && c.highlightThreshold <= 0.8,
      "Ground Burst highlight must engage at the measured surface-flash range");
    assert.ok(c.highlightSharpness >= 1.5 && c.highlightSharpness < 2.5,
      "Ground Burst highlight roll-off must retain thermal pockets without a plateau");
    assert.ok(c.structureBlend > 0 && c.structureBlend <= 1.2);
    assert.ok(c.bloomGateScale > 0 && c.bloomGateScale < RESEARCH_FLUID_PROFILES[TSAR_ID].core.bloomGateScale);
  } else if (presetId === CASTLE_BRAVO_ID) {
    const c = profile.core;
    assert.equal(c.mode, 1, "Castle Bravo must enable structured-core roll-off");
    assert.ok(c.highlightThreshold > 1.5, "Castle Bravo must narrow the white-hot plateau");
    assert.ok(c.highlightSharpness > 2, "Castle Bravo must sharpen the retained thermal structure");
    assert.ok(c.structureBlend > 0 && c.structureBlend <= 1);
    assert.ok(c.bloomGateScale > 0 && c.bloomGateScale < RESEARCH_FLUID_PROFILES[TSAR_ID].core.bloomGateScale);
  } else if (presetId === HIROSHIMA_ID) {
    const c = profile.core;
    assert.equal(c.mode, 1, "Hiroshima must enable structured-core roll-off");
    assert.ok(c.highlightThreshold > 1.5);
    assert.ok(c.highlightSharpness > 2);
    assert.ok(c.structureBlend > 0 && c.structureBlend <= 1);
    assert.ok(c.bloomGateScale > 0 && c.bloomGateScale < RESEARCH_FLUID_PROFILES[TSAR_ID].core.bloomGateScale);
  } else if (presetId === EARLY_FISSION_ID) {
    const c = profile.core;
    assert.equal(c.mode, 1, "Early Fission must enable structured-core roll-off");
    assert.ok(c.highlightThreshold > 1.5);
    assert.ok(c.highlightSharpness > 2);
    assert.ok(c.structureBlend > 0 && c.structureBlend <= 1);
    assert.ok(c.bloomGateScale > 0 && c.bloomGateScale < RESEARCH_FLUID_PROFILES[TSAR_ID].core.bloomGateScale);
  } else if (presetId === UNDERGROUND_ID) {
    const c = profile.core;
    assert.equal(c.mode, 1, "Underground Detonation must enable a structured particulate core");
    assert.equal(c.highlightThreshold, 0.42);
    assert.equal(c.highlightSharpness, 1.9);
    assert.equal(c.structureBlend, 0.62);
    assert.equal(c.bloomGateScale, 5.2);
  } else if (presetId === TSAR_ID) {
    const c = profile.core;
    assert.equal(c.mode, 1, "Tsar must enable core-polish mode");
    assert.ok(c.highlightThreshold > 1.5, "Tsar highlight threshold must be raised above the default plateau point");
    assert.ok(c.highlightSharpness > 2.0, "Tsar highlight roll-off must be steeper than the default");
    assert.ok(c.structureBlend > 0 && c.structureBlend <= 1, "Tsar structure blend must be active and bounded");
    assert.ok(c.bloomGateScale > 0, "Tsar bloom gradient gate must be active");
  } else {
    const c = profile.core;
    assert.equal(c.mode, 0, `${presetId}: core-polish mode must remain neutral`);
    assert.equal(c.highlightThreshold, 1.5, `${presetId}: core.highlightThreshold must stay neutral (1.5)`);
    assert.equal(c.highlightSharpness, 2.0, `${presetId}: core.highlightSharpness must stay neutral (2.0)`);
    assert.equal(c.structureBlend, 0, `${presetId}: core.structureBlend must stay neutral (0)`);
    assert.equal(c.bloomGateScale, 0, `${presetId}: core.bloomGateScale must stay neutral (0)`);
  }

  assert.ok(profile.tracerMaterial && typeof profile.tracerMaterial === "object", `${presetId}: tracerMaterial config missing`);
  for (const key of ["mode", "occlusionStrength", "sizeVariance", "brightnessVariance", "minSizeFloor"]) {
    assert.ok(Number.isFinite(profile.tracerMaterial[key]), `${presetId}: tracerMaterial.${key} must be finite`);
  }
  if (presetId === LOW_YIELD_ID) {
    const t = profile.tracerMaterial;
    const tsarTracer = RESEARCH_FLUID_PROFILES[TSAR_ID].tracerMaterial;
    assert.equal(t.mode, 1, "Low-yield must enable tracer-material mode");
    assert.ok(t.occlusionStrength > 0 && t.occlusionStrength < tsarTracer.occlusionStrength);
    assert.ok(t.sizeVariance > 0 && t.sizeVariance < tsarTracer.sizeVariance);
    assert.ok(t.brightnessVariance > 0 && t.brightnessVariance < tsarTracer.brightnessVariance);
    assert.ok(t.minSizeFloor > 1 && t.minSizeFloor < tsarTracer.minSizeFloor);
  } else if (presetId === GROUND_BURST_ID) {
    const t = profile.tracerMaterial;
    assert.equal(t.mode, 1, "Ground Burst must enable tracer occlusion and deterministic variance");
    assert.ok(t.occlusionStrength > RESEARCH_FLUID_PROFILES[LOW_YIELD_ID].tracerMaterial.occlusionStrength);
    assert.ok(t.occlusionStrength < RESEARCH_FLUID_PROFILES[TSAR_ID].tracerMaterial.occlusionStrength);
    assert.ok(t.sizeVariance > 0 && t.sizeVariance < 1);
    assert.ok(t.brightnessVariance > 0 && t.brightnessVariance < 1);
    assert.ok(t.minSizeFloor > 1 && t.minSizeFloor < RESEARCH_FLUID_PROFILES[TSAR_ID].tracerMaterial.minSizeFloor);
  } else if (presetId === CASTLE_BRAVO_ID) {
    const s = profile.shockwave;
    assert.equal(s.mode, 0, "Castle Bravo must retain the shared neutral shockwave treatment");
    for (const ringKey of ["ringB", "ringC", "ringD"]) {
      assert.equal(s[ringKey].strength, 0, `Castle Bravo shockwave.${ringKey}.strength must stay neutral`);
      assert.equal(s[ringKey].widthScale, 1, `Castle Bravo shockwave.${ringKey}.widthScale must stay neutral`);
      assert.equal(s[ringKey].radiusOffset, 0, `Castle Bravo shockwave.${ringKey}.radiusOffset must stay neutral`);
    }
    assert.equal(s.irregularity, 0);
    assert.equal(s.fadeStart, 1);
    assert.equal(s.fadeSpan, 0.001);
    const p = profile.plume;
    assert.ok(p.feedTaperStart > 0 && p.feedTaperStart < p.feedTaperEnd);
    assert.ok(p.feedTaperEnd < 0.8, "Castle Bravo stem feed must hand off before the late tail");
  } else if (presetId === TSAR_ID) {
    const t = profile.tracerMaterial;
    assert.equal(t.mode, 1, "Tsar must enable tracer-occlusion mode");
    assert.ok(t.occlusionStrength > 0, "Tsar tracer occlusion must be active");
    assert.ok(t.sizeVariance > 0 && t.sizeVariance < 1, "Tsar tracer size variance must be active and bounded (< 1 keeps size positive)");
    assert.ok(t.brightnessVariance > 0 && t.brightnessVariance < 1, "Tsar tracer brightness variance must be active and bounded (< 1 keeps brightness positive)");
    assert.ok(t.minSizeFloor > 1.0, "Tsar tracer minSizeFloor must raise the point-size floor above the pre-pass 1.0px minimum");
  } else {
    const t = profile.tracerMaterial;
    assert.equal(t.mode, 0, `${presetId}: tracer-occlusion mode must remain neutral`);
    assert.equal(t.occlusionStrength, 0, `${presetId}: tracerMaterial.occlusionStrength must stay neutral (0)`);
    assert.equal(t.sizeVariance, 0, `${presetId}: tracerMaterial.sizeVariance must stay neutral (0)`);
    assert.equal(t.brightnessVariance, 0, `${presetId}: tracerMaterial.brightnessVariance must stay neutral (0)`);
    assert.equal(t.minSizeFloor, 0, `${presetId}: tracerMaterial.minSizeFloor must stay neutral (0)`);
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
  /if \(uTracerMaterialMode > 0\.5\) \{\s*\n\s*baseSize = max\(baseSize, uTracerMaterialParams\.w\);\s*\n\s*\}/,
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
    /const tracerMaterial = this\.profile\.tracerMaterial\s*\n\s*\|\|\s*\{ mode: 0, occlusionStrength: 0, sizeVariance: 0, brightnessVariance: 0, minSizeFloor: 0 \};/,
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
assert.match(
  shaders.forceFragment,
  /uProfileKind\s*==\s*9[\s\S]*float sourceFeedTaper = uPlumeMode > 1\.5[\s\S]*uSourceMotion\.x[\s\S]*uSourceMotion\.y \* sourceFeedTaper[\s\S]*uSourceMotion\.w\s*\/\s*0\.65/,
  "Nuclear Airburst branch must taper its preserved vertical feed and consume profile-specific motion weights",
);
assert.match(
  shaders.scalarFragment,
  /uProfileKind\s*==\s*9[\s\S]*uSourceScalar\.x[\s\S]*uSourceScalar\.z[\s\S]*uSourceScalar\.y[\s\S]*secondaryRings/,
  "Nuclear Airburst branch must consume profile-specific scalar separation and shock layering",
);
assert.match(
  shaders.scalarFragment,
  /uProfileKind\s*==\s*9[\s\S]*float corridorWander = uSeedOffsetsA\.x \* uPlumeStemParams\.z[\s\S]*float lowYieldCore = exp\([\s\S]*float thermalPockets = clamp\([\s\S]*float thermalStructure = thermalPockets \* thermalPockets \* thermalPockets[\s\S]*temperature \+= source \* lowYieldCore \* thermalStructure[\s\S]*incandescent \+= source \* lowYieldCore \* thermalPockets/,
  "Nuclear Airburst source must retain deterministic corridor wander and nonlinear thermal separation",
);
for (const shaderSource of Object.values(RESEARCH_FLUID_SHADER_SOURCES)) {
  assert.doesNotMatch(shaderSource, /low-yield-nuclear-airburst|tsar-bomba-scale-reference/, "Generic shader logic must not contain preset IDs");
}
assert.match(shaders.forceFragment, /trailKernel\s*\*\s*entry\s*\*\s*onset/, "Meteor entry impulse must precede impact staging");
assert.match(shaders.forceFragment, /ejectaKernel\s*\*\s*onset\s*\*\s*stagedImpact/, "Meteor ejecta force must begin at impact stage");
assert.match(shaders.forceFragment, /sourceEnabled\(SOURCE_MULTIPLE\)[\s\S]*sourceEnabled\(SOURCE_TURBULENT\)[\s\S]*clusterKernel/, "Cluster turbulence must obey declared source primitives");
assert.match(shaders.forceFragment, /sampler3D\s+uCurlDetail/, "force pass must sample the bounded 3D curl field");
assert.match(shaders.scalarFragment, /incandescent[\s\S]*uSmokeConversion/, "incandescent-to-smoke conversion missing");
assert.match(shaders.scalarFragment, /temperature\s*=\s*max[\s\S]*exp\(-uCooling/, "cooling missing");
assert.match(shaders.scalarFragment, /pow\(normalizedHeat,\s*4\.0\)/, "bounded fourth-power radiative cooling missing");
assert.match(shaders.scalarFragment, /sampler3D\s+uCurlDetail/, "scalar source must reuse the bounded 3D detail field");
assert.match(shaders.scalarFragment, /sourceRing\s*\*\s*\(sourceEnabled\(SOURCE_RING\)/, "Primary ring scalar injection must obey its primitive mask");
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
assert.match(shaders.volumeFragment, /1\.0\s*-\s*exp\(-opticalDepth/, "exponential opacity missing");
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
assert.match(shaders.metricsFragment, /scalar\.g\s*\*\s*0\.9\s*\+\s*scalar\.a\s*\*\s*0\.72/, "combined smoke/dust occupancy metric encoding missing");
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

// --- Profile-gated shockwave layering + stem taper/breakup (2026-07) --------
for (const [presetId, profile] of Object.entries(RESEARCH_FLUID_PROFILES)) {
  assert.ok(profile.shockwave && typeof profile.shockwave === "object", `${presetId}: shockwave config missing`);
  for (const ringKey of ["ringB", "ringC", "ringD"]) {
    const ring = profile.shockwave[ringKey];
    assert.ok(ring && typeof ring === "object", `${presetId}: shockwave.${ringKey} config missing`);
    for (const key of ["radiusOffset", "widthScale", "strength", "phaseOffset"]) {
      assert.ok(Number.isFinite(ring[key]), `${presetId}: shockwave.${ringKey}.${key} must be finite`);
    }
  }
  for (const key of [
    "mode", "irregularity", "fadeStart", "fadeSpan",
    "denseBandsHigh", "denseBandsBalanced", "denseBandsMobile",
    "denseInnerRadius", "denseOuterRadius", "denseSpacingVariation",
    "denseWidthMin", "denseWidthMax", "denseInnerStrength", "denseOuterStrength",
    "denseSegmentVariation", "denseDepthContrast", "denseOnsetSpread", "denseFadeVariation",
    "denseIrregularity", "denseFadeStart", "denseFadeSpan",
  ]) {
    assert.ok(Number.isFinite(profile.shockwave[key]), `${presetId}: shockwave.${key} must be finite`);
  }
  for (const key of ["feedTaperStart", "feedTaperEnd", "lateralJitter", "turbulenceBlend"]) {
    assert.ok(Number.isFinite(profile.plume[key]), `${presetId}: plume.${key} must be finite`);
  }
  if (presetId === LOW_YIELD_ID) {
    const s = profile.shockwave;
    assert.equal(s.mode, 2, "Low-yield alone must enable the dense contour-family mode");
    assert.deepEqual(
      [s.denseBandsMobile, s.denseBandsBalanced, s.denseBandsHigh],
      [7, 9, 10],
      "Low-yield must retain dense layering in every quality tier",
    );
    assert.ok(s.denseInnerRadius > 0 && s.denseInnerRadius < s.denseOuterRadius);
    assert.ok(s.denseOuterRadius < 1, "Dense echoes must stay inside the primary leading shock");
    assert.ok(s.denseSpacingVariation > 0, "Dense echoes need nonuniform spacing");
    assert.ok(s.denseWidthMin > 0 && s.denseWidthMin < s.denseWidthMax);
    assert.ok(s.denseInnerStrength > 0 && s.denseInnerStrength < s.denseOuterStrength);
    assert.ok(s.denseSegmentVariation > 0, "Dense echoes need partial angular visibility");
    assert.ok(s.denseDepthContrast > 0, "Dense echoes need front/rear depth modulation");
    assert.ok(s.denseOnsetSpread > 0, "Dense echoes must not appear in lockstep");
    assert.ok(s.denseFadeVariation > 0, "Dense echoes must not fade in lockstep");
    assert.deepEqual(
      [s.ringB, s.ringC, s.ringD, s.irregularity, s.fadeStart, s.fadeSpan],
      [
        { radiusOffset: -0.22, widthScale: 1.15, strength: 0.24, phaseOffset: 0.01 },
        { radiusOffset: 0.14, widthScale: 0.82, strength: 0.18, phaseOffset: 0.035 },
        { radiusOffset: 0, widthScale: 1, strength: 0, phaseOffset: 0 },
        0.035,
        0.28,
        0.12,
      ],
      "Low-yield scalar rings must retain every approved main value",
    );
    assert.ok(s.denseIrregularity > s.irregularity);
    assert.ok(s.denseFadeStart > 0 && s.denseFadeStart < 0.2);
    assert.ok(
      s.denseFadeStart + s.denseFadeSpan < 0.3,
      "Low-yield dense echoes must clear by the late plume",
    );

    const p = profile.plume;
    const tsarPlume = RESEARCH_FLUID_PROFILES[TSAR_ID].plume;
    assert.deepEqual(
      p,
      {
        mode: 2,
        expansion: 0.012,
        vortex: 0.04,
        persistence: 0.015,
        widen: 0.018,
        feedTaperStart: 0.08,
        feedTaperEnd: 0.24,
        lateralJitter: 0.32,
        turbulenceBlend: 0.15,
      },
      "Low-yield stem and plume controls must retain the approved final-pass values",
    );
    assert.ok(p.feedTaperStart > 0 && p.feedTaperStart < p.feedTaperEnd);
    assert.ok(p.feedTaperStart < tsarPlume.feedTaperStart, "Low-yield feed must taper earlier than Tsar");
    assert.ok(p.feedTaperEnd < tsarPlume.feedTaperEnd, "Low-yield feed must finish tapering earlier than Tsar");
    assert.ok(p.lateralJitter > 0 && p.lateralJitter < tsarPlume.lateralJitter);
    assert.ok(p.turbulenceBlend > 0 && p.turbulenceBlend < tsarPlume.turbulenceBlend);
  } else if (presetId === GROUND_BURST_ID) {
    const s = profile.shockwave;
    assert.equal(s.mode, 1, "Ground Burst must use restrained explicit subordinate shock bands");
    assert.ok(s.ringB.strength > 0 && s.ringC.strength > 0);
    assert.equal(s.ringD.strength, 0, "Ground Burst must not create a dense multi-ring target");
    assert.ok(s.ringB.strength < RESEARCH_FLUID_PROFILES[TSAR_ID].shockwave.ringB.strength);
    assert.ok(s.ringC.strength < RESEARCH_FLUID_PROFILES[TSAR_ID].shockwave.ringC.strength);
    assert.ok(s.irregularity > RESEARCH_FLUID_PROFILES[TSAR_ID].shockwave.irregularity);
    for (const key of [
      "denseBandsHigh", "denseBandsBalanced", "denseBandsMobile",
      "denseInnerRadius", "denseOuterRadius", "denseSpacingVariation",
      "denseWidthMin", "denseWidthMax", "denseInnerStrength", "denseOuterStrength",
      "denseSegmentVariation", "denseDepthContrast", "denseOnsetSpread",
      "denseFadeVariation", "denseIrregularity", "denseFadeStart", "denseFadeSpan",
    ]) {
      assert.equal(s[key], 0, `Ground Burst must not enable dense Airburst shockwave ${key}`);
    }
    const p = profile.plume;
    assert.equal(p.mode, 3);
    assert.ok(p.feedTaperStart > 0 && p.feedTaperStart < p.feedTaperEnd);
    assert.ok(p.feedTaperEnd < 0.8,
      "Ground Burst stem feed must hand off before the late atmospheric tail");
    assert.ok(p.lateralJitter > RESEARCH_FLUID_PROFILES[TSAR_ID].plume.lateralJitter,
      "Ground Burst stem needs stronger lateral deformation than Tsar");
    assert.ok(p.turbulenceBlend > RESEARCH_FLUID_PROFILES[TSAR_ID].plume.turbulenceBlend,
      "Ground Burst stem needs stronger dust-rich turbulence than Tsar");
  } else if (presetId === CASTLE_BRAVO_ID) {
    const edge = profile.edge;
    assert.equal(edge.mode, 0, "Castle Bravo must not add an extinction mask");
    assert.equal(edge.lowDensityAttenuation, 0, "Castle Bravo must retain neutral sparse-edge attenuation");
  } else if (presetId === TSAR_ID) {
    const s = profile.shockwave;
    assert.deepEqual(
      s,
      {
        mode: 1,
        ringB: { radiusOffset: -0.32, widthScale: 1.35, strength: 0.42, phaseOffset: 0.015 },
        ringC: { radiusOffset: 0.22, widthScale: 0.75, strength: 0.34, phaseOffset: 0.05 },
        ringD: { radiusOffset: -0.55, widthScale: 1.9, strength: 0.24, phaseOffset: 0.03 },
        irregularity: 0.05,
        fadeStart: 0.44,
        fadeSpan: 0.14,
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
      },
      "Tsar shockwave values must remain exactly unchanged",
    );
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
  } else if (presetId === HIROSHIMA_ID) {
    const s = profile.shockwave;
    assert.equal(s.mode, 0, "Hiroshima must retain the shared neutral shockwave treatment");
    for (const ringKey of ["ringB", "ringC", "ringD"]) {
      assert.equal(s[ringKey].strength, 0, `Hiroshima shockwave.${ringKey}.strength must stay neutral`);
      assert.equal(s[ringKey].widthScale, 1, `Hiroshima shockwave.${ringKey}.widthScale must stay neutral`);
      assert.equal(s[ringKey].radiusOffset, 0, `Hiroshima shockwave.${ringKey}.radiusOffset must stay neutral`);
    }
    const p = profile.plume;
    assert.equal(p.feedTaperStart, 0.68, "Hiroshima stem feed taper must remain profile-local");
    assert.equal(p.feedTaperEnd, 0.88, "Hiroshima stem feed handoff must remain profile-local");
    assert.equal(p.lateralJitter, 0.1, "Hiroshima stem lateral decorrelation must remain profile-local");
    assert.equal(p.turbulenceBlend, 0.035, "Hiroshima stem turbulence blend must remain profile-local");
  } else if (presetId === EARLY_FISSION_ID) {
    const s = profile.shockwave;
    assert.equal(s.mode, 0, "Early Fission must retain the shared neutral shockwave treatment");
    for (const ringKey of ["ringB", "ringC", "ringD"]) {
      assert.equal(s[ringKey].strength, 0, `Early Fission shockwave.${ringKey}.strength must stay neutral`);
      assert.equal(s[ringKey].widthScale, 1, `Early Fission shockwave.${ringKey}.widthScale must stay neutral`);
      assert.equal(s[ringKey].radiusOffset, 0, `Early Fission shockwave.${ringKey}.radiusOffset must stay neutral`);
    }
    const p = profile.plume;
    assert.equal(p.feedTaperStart, 0.46, "Early Fission stem feed taper must remain profile-local");
    assert.equal(p.feedTaperEnd, 0.7, "Early Fission stem feed handoff must remain profile-local");
    assert.equal(p.lateralJitter, 0.4, "Early Fission stem lateral decorrelation must remain profile-local");
    assert.equal(p.turbulenceBlend, 0.22, "Early Fission stem turbulence blend must remain profile-local");
  } else if (presetId === UNDERGROUND_ID) {
    const s = profile.shockwave;
    assert.equal(s.mode, 0, "Underground Detonation must retain the neutral shockwave treatment");
    for (const ringKey of ["ringB", "ringC", "ringD"]) {
      assert.equal(s[ringKey].strength, 0, `Underground Detonation shockwave.${ringKey}.strength must stay neutral`);
      assert.equal(s[ringKey].widthScale, 1, `Underground Detonation shockwave.${ringKey}.widthScale must stay neutral`);
      assert.equal(s[ringKey].radiusOffset, 0, `Underground Detonation shockwave.${ringKey}.radiusOffset must stay neutral`);
    }
    const p = profile.plume;
    assert.equal(p.feedTaperStart, 0.4);
    assert.equal(p.feedTaperEnd, 0.72);
    assert.equal(p.lateralJitter, 0.46);
    assert.equal(p.turbulenceBlend, 0.32);
  } else if (presetId === VOLCANIC_ID) {
    const s = profile.shockwave;
    assert.equal(s.mode, 0, "Volcanic Eruption must retain the neutral shockwave treatment");
    for (const ringKey of ["ringB", "ringC", "ringD"]) {
      assert.equal(s[ringKey].strength, 0, `Volcanic Eruption shockwave.${ringKey}.strength must stay neutral`);
      assert.equal(s[ringKey].widthScale, 1, `Volcanic Eruption shockwave.${ringKey}.widthScale must stay neutral`);
      assert.equal(s[ringKey].radiusOffset, 0, `Volcanic Eruption shockwave.${ringKey}.radiusOffset must stay neutral`);
    }
    const p = profile.plume;
    assert.equal(p.feedTaperStart, 0.74);
    assert.equal(p.feedTaperEnd, 1.02);
    assert.equal(p.lateralJitter, 0.32);
    assert.equal(p.turbulenceBlend, 0.36);
  } else {
    const s = profile.shockwave;
    assert.equal(s.mode, 0, `${presetId}: shockwave mode must remain neutral`);
    for (const ringKey of ["ringB", "ringC", "ringD"]) {
      assert.equal(s[ringKey].strength, 0, `${presetId}: shockwave.${ringKey}.strength must stay neutral (0)`);
      assert.equal(s[ringKey].widthScale, 1, `${presetId}: shockwave.${ringKey}.widthScale must stay neutral (1)`);
      assert.equal(s[ringKey].radiusOffset, 0, `${presetId}: shockwave.${ringKey}.radiusOffset must stay neutral (0)`);
    }
    for (const key of [
      "denseBandsHigh", "denseBandsBalanced", "denseBandsMobile",
      "denseInnerRadius", "denseOuterRadius", "denseSpacingVariation",
      "denseWidthMin", "denseWidthMax", "denseInnerStrength", "denseOuterStrength",
      "denseSegmentVariation", "denseDepthContrast", "denseOnsetSpread", "denseFadeVariation",
      "denseIrregularity", "denseFadeStart", "denseFadeSpan",
    ]) {
      assert.equal(s[key], 0, `${presetId}: shockwave.${key} must stay neutral (0)`);
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
for (const uniform of [
  "uShockwaveMode", "uShockwaveRingB", "uShockwaveRingC", "uShockwaveRingD",
  "uShockwaveAux", "uPlumeStemParams",
]) {
  assert.match(
    `${RESEARCH_FLUID_SHADER_SOURCES.forceFragment}\n${RESEARCH_FLUID_SHADER_SOURCES.scalarFragment}`,
    new RegExp(`uniform[^;]*\\b${uniform}\\b`),
    `${uniform}: uniform missing from shaders`,
  );
}
// Both subordinate paths must be reachable only through uShockwaveMode, and
// mode 0 must collapse to zero without affecting the primary ring.
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.scalarFragment,
  /if \(uShockwaveMode < 0\.5\) return 0\.0;/,
  "Shockwave layers not properly gated behind uShockwaveMode",
);
assert.doesNotMatch(
  RESEARCH_FLUID_SHADER_SOURCES.scalarFragment,
  /for\s*\([^)]*dense/i,
  "Dense contour family must remain a constant-cost procedural formulation, not one branch per band",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.scalarFragment,
  /float secondaryRings = profileShockwaveLayers\(vUv\);/,
  "Dense mode must preserve the approved low-yield scalar-ring injection",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.scalarFragment,
  /float sourceRing = profileRingKernel\(vUv\);[\s\S]*?float shockwaveLayers = profileShockwaveLayers\(vUv\);[\s\S]*?\+ shockwaveLayers \* 0\.5/,
  "The generic primitive branch must retain profile-gated subordinate rings independently of SOURCE_RING",
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
for (const uniform of [
  "uShockwaveMode", "uShockwaveVolumeShape", "uShockwaveAux",
  "uShockwaveDenseA", "uShockwaveDenseB", "uShockwaveDenseC",
]) {
  assert.match(
    RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
    new RegExp(`uniform[^;]*\\b${uniform}\\b`),
    `${uniform}: dense volume-compositor uniform missing`,
  );
}
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /if \(uShockwaveMode < 1\.5\) return 0\.0;/,
  "Volume contours must activate only in dense shockwave mode 2",
);
for (const requiredDenseTerm of [
  /float spacingWarp = uShockwaveDenseA\.w/,
  /float width = mix\(uShockwaveDenseB\.x, uShockwaveDenseB\.y, bandHash\);/,
  /float continuity = mix\(/,
  /float depthVisibility = mix\(/,
  /float onsetDelay = 0\.006 \+ uShockwaveDenseC\.z/,
  /float fadeStart = uShockwaveAux\.y/,
]) {
  assert.match(
    RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
    requiredDenseTerm,
    `Dense volume-contour variation missing: ${requiredDenseTerm}`,
  );
}
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /denseShockwaveContour\(\s*distortedUv,\s*clamp\(transmittance, 0\.0, 1\.0\)\s*\)/,
  "Dense contours must consume real plume transmittance for occlusion",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /float shockOpacity = shockwaveContour \* 0\.12 \* atmosphericFade;/,
  "Dense contours must contribute bounded composite alpha without changing volume density",
);
assert.doesNotMatch(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /low-yield-nuclear-airburst|uProfileKind\s*==\s*9/,
  "Generic volume rendering must remain profile-driven with no low-yield preset-ID gate",
);

// --- Dense-phase raymarch performance optimization reverted (2026-07) -------
// The alpha-threshold shading skip added earlier in this branch was global
// (not Tsar-gated) and never visually verified — a subsequent in-browser
// check found a square/rectangular residual-smoke artifact on this branch
// and flagged the skip as an unmeasured suspect. It has been reverted:
// shading math must run unconditionally for every raymarch layer again,
// matching production. This asserts the revert stuck (no reintroduction).
assert.doesNotMatch(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /if \(alpha > 0\.0006\)/,
  "Dense-phase shading skip must stay reverted — it was unverified and a suspect in the square-residue defect",
);
{
  const volume = RESEARCH_FLUID_SHADER_SOURCES.volumeFragment;
  const depthIndex = volume.indexOf("float alpha = 1.0 - exp(-opticalDepth");
  const accumulateIndex = volume.indexOf("accumulated += transmittance * alpha * layerColor;");
  const loopEnd = volume.indexOf("if (transmittance < 0.012) break;");
  assert.ok(depthIndex > 0 && accumulateIndex > depthIndex && loopEnd > accumulateIndex);
  const between = volume.slice(depthIndex, loopEnd);
  assert.doesNotMatch(between, /\{\s*\n\s*\/\/ One midpoint probe/, "Shading math must not be wrapped in a conditional block");
}

// --- Profile-gated domain-edge organic envelopes (2026-07) ------------------
// edgeExtinction()'s default path multiplies an independent horizontal
// falloff by an independent vertical falloff — a rounded-rectangle
// (Chebyshev) envelope. Invisible while density saturates the interior, but
// the visible isocontour of a near-uniform low-density residue, which is
// exactly the low-yield responsive residue and Tsar's late-dissipation tail.
// uEdgeMode gates merged profile-supplied envelopes. Low-yield and Tsar retain
// their approved superellipse paths; Ground Burst uses mode 3, which starts
// vertical extinction only in the upper domain so the surface base survives.
// Every other preset retains the original independent-axis product.
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /uniform float uEdgeMode;/,
  "uEdgeMode uniform missing from volumeFragment",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /if \(uEdgeMode > 0\.5\) \{[\s\S]*?ellipseDistance[\s\S]*?\n  \}/,
  "Profile-driven organic superellipse envelope missing from edgeExtinction()",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /if \(uEdgeMode > 2\.5\) \{[\s\S]*?float capRollout[\s\S]*?float topStart = 1\.0 - profile\.w;/,
  "Ground Burst upper-domain edge path must preserve the lower ground field",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /float side = smoothstep\(0\.0, profile\.x, uv\.x\)\s*\n\s*\* smoothstep\(0\.0, profile\.y, 1\.0 - uv\.x\);/,
  "Original independent-axis rectangle envelope must remain as the default (uEdgeMode 0) path",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /vec4 edgeProfile = edgeExtinctionProfile\(boundaryWobble, sideAsymmetry\);[\s\S]*?for \(int index = 0;/,
  "Invariant edge center/radii must be prepared once before the volume ray loop",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /#ifdef BALANCED_EDGE_FAST_POWER[\s\S]*?approximatePow2p6[\s\S]*?#else[\s\S]*?pow\(abs\(normalized\.x\), 2\.6\)[\s\S]*?#endif/,
  "Balanced edge-power approximation and exact High/Mobile fallback must remain compile-time exclusive",
);
assert.match(
  engineSource,
  /this\.tier\.id === 'balanced' \? BALANCED_VOLUME_FRAGMENT : VOLUME_FRAGMENT/,
  "Only the Balanced tier may compile the fitted edge-power shader variant",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.scalarFragment,
  /float historicalBoundary = step\(0\.5, uPlumeMode\) \* \(1\.0 - step\(1\.5, uPlumeMode\)\);[\s\S]*float sideMargin = mix\(0\.12, 0\.075, historicalBoundary\);[\s\S]*float topMargin = mix\(0\.055, 0\.035, historicalBoundary\);/,
  "Only historical-scale plume mode 1 may use the narrow Tsar boundary guards",
);
for (const [presetId, profile] of Object.entries(RESEARCH_FLUID_PROFILES)) {
  assert.ok(profile.edge && typeof profile.edge === "object", `${presetId}: edge config missing`);
  for (const key of [
    "mode", "center", "centerAsymmetry", "leftRadius", "rightRadius", "topRadius",
    "leftWobble", "rightWobble", "topWobble", "fadeStart", "fadeEnd",
    "distanceWobble", "lowDensityStart", "lowDensityEnd", "lowDensityAttenuation",
  ]) {
    assert.ok(Number.isFinite(profile.edge[key]), `${presetId}: edge.${key} must be finite`);
  }
  if (presetId === LOW_YIELD_ID) {
    const edge = profile.edge;
    assert.equal(edge.mode, 2, "Low-yield alone must enable its responsive organic edge envelope");
    assert.ok(edge.leftRadius !== edge.rightRadius, "Low-yield boundary must be asymmetric, not an oval mask");
    assert.ok(edge.distanceWobble > 0 && edge.lowDensityAttenuation > 0,
      "Low-yield must fade sparse boundary smoke more strongly than dense plume material");
    assert.ok(edge.lowDensityStart < edge.lowDensityEnd, "Low-yield low-density response must be a smooth interval");
  } else if (presetId === GROUND_BURST_ID) {
    const edge = profile.edge;
    assert.equal(edge.mode, 3, "Ground Burst alone must enable the ground-preserving organic edge path");
    assert.ok(edge.leftRadius !== edge.rightRadius, "Ground Burst boundary must stay asymmetric");
    assert.ok(edge.leftWobble !== edge.rightWobble && edge.distanceWobble > 0);
    assert.ok(edge.lowDensityStart < edge.lowDensityEnd);
    assert.ok(edge.lowDensityAttenuation > 0 && edge.lowDensityAttenuation < RESEARCH_FLUID_PROFILES[LOW_YIELD_ID].edge.lowDensityAttenuation);
  } else if (presetId === TSAR_ID) {
    assert.equal(profile.edge.mode, 1, "Tsar must enable the organic domain-edge envelope");
    assert.equal(profile.edge.lowDensityAttenuation, 0, "Tsar approved edge response must remain unchanged");
  } else {
    assert.equal(profile.edge.mode, 0, `${presetId}: edge mode must remain off for non-target presets`);
    assert.equal(profile.edge.lowDensityAttenuation, 0, `${presetId}: edge low-density attenuation must stay neutral`);
  }
}
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /float lowDensityWeight = \(1\.0 - lowDensityResponse\) \* uEdgeProfile3\.y;[\s\S]*?layerFade \*= mix\(1\.0, layerFade, lowDensityWeight\);/,
  "Low-density-selective boundary attenuation must affect smoke only",
);
assert.match(
  RESEARCH_FLUID_SHADER_SOURCES.volumeFragment,
  /densityOpacity \* domainFade[\s\S]*?mix\(shockOpacity \* domainFade, shockOpacity, step\(1\.5, uShockwaveMode\)\)/,
  "Dense analytical shock contours must remain outside smoke-edge extinction",
);

console.log("Explosion Dynamics Lab fluid contract test: PASS");
console.log(`  ${tiers.length} bounded tiers × ${EVENT_PRESETS.length} preset profiles across seven event families`);
console.log("  primitive diversity, profile budgets, palette-driven volume uniforms, fluid evolution, and GPU tracers verified");
console.log("  non-WebGL runtime fails closed to the existing Canvas renderer");
console.log("  low-yield mode 2, Castle/Ground Burst ground-coupled mode 3, and Tsar historical mode 1 remain profile-isolated");
console.log("  Castle Bravo plume, material, core, late motion, boundary, and neutral shock/edge treatment remain profile-gated");
console.log("  Ground Burst ground coupling, material, shockwave, edge, and late motion remain profile-gated");
console.log("  dense-phase raymarch shading skip remains absent; organic edge envelopes remain profile-gated");
