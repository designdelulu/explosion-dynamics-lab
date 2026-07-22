import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EVENT_PRESETS } from "../scripts/data.js";
import { ExplosionRenderer } from "../scripts/renderer.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(projectRoot, relativePath), "utf8");

const [html, css, app, renderer, buildInfo, apache] = await Promise.all([
  read("index.html"),
  read("assets/styles.css"),
  read("scripts/app.js"),
  read("scripts/renderer.js"),
  read("scripts/build-info.js"),
  read(".htaccess"),
]);

assert.match(app, /query\.get\("debugFluid"\)\s*===\s*"1"/, "debugFluid URL gate missing");
assert.match(app, /query\.get\("compareRenderers"\)\s*===\s*"1"/, "comparison URL gate missing");
assert.match(app, /DEVELOPER_RENDER_MODE\s*\?\s*RESEARCH_PRESET_ID\s*:\s*DEFAULT_PRESET_ID/, "developer URLs must auto-select the flagship");
assert.match(app, /document\.createElement\("canvas"\)[\s\S]*proceduralCompareCanvas/, "comparison must create a dedicated procedural canvas");
assert.match(app, /new ExplosionRenderer\(proceduralCompareCanvas,\s*\{ reducedMotion \}\)/, "comparison renderer must not receive a research canvas");
assert.match(app, /Math\.floor\([\s\S]*\*\s*30[\s\S]*\/\s*30/, "comparison sampling must use the shared 30 Hz timestep");
assert.match(app, /proceduralRenderer\?\.configure\(settings\)/, "both comparison renderers must share settings");
assert.match(app, /!DEBUG_FLUID\s*\|\|\s*!isResearchModel/, "normal visits must keep diagnostics hidden");
assert.match(app, /debugMetrics:\s*DEBUG_FLUID/, "debug mode must enable real field metric collection");
assert.match(app, /if\s*\(!rendered\)\s*throw new Error\("Research fluid PNG export/, "PNG must not silently substitute the procedural renderer");
assert.match(app, /if\s*\(!rendered\)\s*throw new Error\("Research fluid MP4 frame export/, "MP4 must not silently substitute the procedural renderer");
assert.match(app, /downloadPng\(\)[\s\S]*finally\s*\{[\s\S]*releaseExportResources/, "PNG export must release its fluid session in finally");
assert.match(app, /startVideoExport\(\)[\s\S]*finally\s*\{[\s\S]*releaseExportResources/, "MP4 export must release its fluid session in finally");
assert.match(app, /Effects Overview · ANALYTICAL/, "Comparison mode must label Overview as an intentional analytical view");
assert.match(app, /comparisonFallback\.hidden\s*=\s*overviewActive\s*\|\|\s*!stats\.rendererFallback/, "Overview must never expose a fluid fallback warning");
assert.match(app, /state\.exporting\s*=\s*true;[\s\S]*elements\.controls\.inert\s*=\s*true/, "MP4 export must lock mutable simulation controls");
assert.match(app, /state\.exporting\s*=\s*false;[\s\S]*elements\.controls\.inert\s*=\s*controlsWereInert/, "MP4 export must restore the prior control state");
assert.match(app, /const exportFilename\s*=\s*filename\("mp4",\s*preset,\s*exportSeed\)/, "MP4 filename metadata must be frozen before rendering");

for (const id of [
  "fluidDebugOverlay",
  "rendererComparison",
  "debugActiveRenderer",
  "debugWebgl",
  "debugGrid",
  "debugPressure",
  "debugTimestep",
  "debugSteps",
  "debugVelocity",
  "debugTemperature",
  "debugSmoke",
  "debugVorticity",
  "debugPreset",
  "debugEventFamily",
  "debugFluidProfile",
  "debugSourcePrimitives",
  "debugVolumeSlices",
  "debugTracers",
  "debugFallback",
  "debugBuildSource",
  "debugBuildRevision",
  "debugBuildDeployed",
  "debugRendererVersion",
  "debugAssetVersion",
  "debugManifestHash",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `Missing developer UI #${id}`);
}
assert.match(html, /id="fluidDebugOverlay"[^>]*hidden/, "debug overlay must be hidden by default");
assert.match(html, /id="rendererComparison"[^>]*hidden/, "comparison labels must be hidden by default");
for (const mode of ["velocity", "temperature", "smoke", "incandescent", "pressure", "divergence", "vorticity", "tracers"]) {
  assert.match(html, new RegExp(`<option value=["']${mode}["']`), `Missing ${mode} debug view`);
}

assert.match(css, /body\.compare-renderers #proceduralCompareCanvas[\s\S]*width:\s*50%/, "procedural pane must receive half the viewport");
assert.match(css, /body\.compare-renderers #simCanvas,[\s\S]*#researchCanvas[\s\S]*left:\s*50%[\s\S]*width:\s*50%/, "research pane must receive the other half viewport");
assert.doesNotMatch(css, /body\.compare-renderers[\s\S]{0,120}clip-path/, "comparison must not crop two full-width scenes");

assert.match(renderer, /fluidExportRequired[\s\S]*requestsFluidRenderer\(this\._preset[\s\S]*Research fluid export unavailable/, "Every profiled Cinematic export must fail closed without the fluid engine");
assert.match(renderer, /liveFluidRendered[\s\S]*finally[\s\S]*_researchFluidRendered\s*=\s*liveFluidRendered/, "offscreen export must restore live renderer status");
assert.match(renderer, /releaseExportResources\(\)[\s\S]*_disposeResearchEngine\(false\)/, "Renderer must expose explicit offscreen fluid cleanup");
assert.match(renderer, /_disposeResearchEngine\(isLive\)[\s\S]*destroy\?\.\(\)[\s\S]*=\s*null/, "Fluid cleanup must destroy and dereference the engine");
assert.match(renderer, /_drawMeteorEarly\(glow,\s*matter[\s\S]*_drawGroundCoupledEarly\(glow,\s*matter/, "Meteor impact ejecta must composite through the opaque matter layer");
assert.match(renderer, /_behavior\.key\s*===\s*'nuclearAir'[\s\S]*_drawFireball\(glow,\s*layout,\s*phase,\s*quality\)/, "Research Airburst must preserve its accepted analytical fireball envelope");
assert.match(apache, /Cache-Control\s+"no-cache, must-revalidate"/, "HTML must revalidate after deployment");
assert.match(apache, /deployment-manifest\.json[\s\S]*Cache-Control\s+"no-store"/, "deployment manifest must never be cached");
assert.match(apache, /(?:releases\|vendor-releases)[\s\S]*31536000, immutable/, "content-addressed production assets must be immutable");

for (const source of [html, app, renderer]) {
  assert.doesNotMatch(source, /\?v=/, "source modules must not carry manual cache versions");
}
assert.match(html, /name="explosion-lab-build" content="development"/, "source build identity meta missing");
assert.match(html, /href="assets\/styles\.css"/, "source stylesheet reference missing");
assert.match(html, /src="scripts\/app\.js"/, "source entry module missing");
assert.match(app, /data\.js["'][\s\S]*renderer\.js["'][\s\S]*exporter\.js["'][\s\S]*build-info\.js["']/, "source dependency graph is incomplete");
assert.match(renderer, /data\.js["'][\s\S]*fluid-engine\.js["']/, "renderer dependency graph is incomplete");
for (const property of ["source", "build", "deployedAt", "rendererVersion", "assetVersion", "manifestHash"]) {
  assert.match(buildInfo, new RegExp(`${property}:`), `Source build identity is missing ${property}`);
}
assert.match(buildInfo, /rendererVersion:\s*"gpu-fluid-families-r3"/, "Source renderer version was not bumped for family profiles");
assert.match(app, /__EXPLOSION_DYNAMICS_LAB_BUILD__\s*=\s*BUILD_INFO/, "developer modes must expose build identity for verification");

const headlessRenderer = new ExplosionRenderer(null);
for (const preset of EVENT_PRESETS) {
  headlessRenderer.configure({ presetId: preset.id, viewMode: "overview" });
  const overview = headlessRenderer.getStats();
  assert.equal(overview.visualizationMode, "overview", `${preset.id}: Overview mode not reported`);
  assert.equal(overview.activeRenderer, "ANALYTICAL OVERVIEW", `${preset.id}: Overview should be an intentional analytical renderer`);
  assert.equal(overview.researchRequested, false, `${preset.id}: Overview must not request the Cinematic solver`);
  assert.equal(overview.rendererFallback, false, `${preset.id}: Overview must not be reported as a fallback`);
  assert.equal(overview.fluidFallbackReason, null, `${preset.id}: Overview must not invent a fallback reason`);

  headlessRenderer.configure({ presetId: preset.id, viewMode: "cinematic" });
  const cinematic = headlessRenderer.getStats();
  assert.equal(cinematic.researchRequested, true, `${preset.id}: Cinematic mode must request its GPU profile`);
  assert.equal(cinematic.rendererFallback, true, `${preset.id}: unsupported headless GPU must fail closed visibly`);
  assert.equal(cinematic.fluidProfile, preset.researchModel.id, `${preset.id}: diagnostics lost the fluid profile`);
}
let exportDestroyCalls = 0;
headlessRenderer._fluidExport = { destroy() { exportDestroyCalls += 1; } };
headlessRenderer._fluidExportMeta = { selectedTier: "balanced" };
assert.equal(headlessRenderer.releaseExportResources(), true);
assert.equal(exportDestroyCalls, 1, "Export fluid engine was not destroyed exactly once");
assert.equal(headlessRenderer.getStats().fluidSessionCount, 0, "Export fluid engine remained referenced after cleanup");
headlessRenderer.destroy();

console.log("Explosion Dynamics Lab developer-mode contract test: PASS");
console.log("  URL-gated real-field diagnostics remain hidden on normal visits");
console.log("  split renderers share one 30 Hz state without cropping either camera");
console.log("  all 12 Cinematic PNG/MP4 routes fail closed; Overview remains intentional, not fallback");
console.log("  offscreen export GPU resources are destroyed and dereferenced in finally paths");
console.log("  content-addressed build identity and HTML revalidation are wired together");
