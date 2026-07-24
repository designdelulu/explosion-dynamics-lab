import {
  DEFAULT_ENVIRONMENT_ID,
  DEFAULT_PALETTE_ID,
  DEFAULT_PRESET_ID,
  DEFAULT_TIME_ID,
  ENVIRONMENTS,
  EVENT_PRESETS,
  PALETTES,
  PHASES,
  PRESET_BY_ID,
  TIME_SETTINGS,
  buildPhaseTimeline,
  clamp,
  getPhaseAtTime,
  safeSlug
} from "./data.js";
import { ExplosionRenderer } from "./renderer.js";
import {
  createDownload,
  detectExportCapabilities,
  exportMp4
} from "./exporter.js";
import { BUILD_INFO } from "./build-info.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const query = new URLSearchParams(window.location.search);
const DEBUG_FLUID = query.get("debugFluid") === "1";
const DEBUG_CAMERA = query.get("debugCamera") === "1";
const COMPARE_RENDERERS = query.get("compareRenderers") === "1";
const DEVELOPER_RENDER_MODE = DEBUG_FLUID || COMPARE_RENDERERS;
const RESEARCH_PRESET_ID = "low-yield-nuclear-airburst";
const DIRECT_PRESET_ID = PRESET_BY_ID[query.get("preset")] ? query.get("preset") : null;
const DIRECT_VIEW_MODE = ["cinematic", "overview"].includes(query.get("mode"))
  ? query.get("mode")
  : null;
const DIRECT_QUALITY = ["mobile", "balanced", "high"].includes(query.get("quality"))
  ? query.get("quality")
  : null;
const DIRECT_FLOW_MODE = ["off", "flow", "field"].includes(query.get("flow"))
  ? query.get("flow")
  : null;
const VISUAL_DEV = query.get("visualDev") === "1";
const directSeedValue = Number(query.get("seed"));
const DIRECT_SEED = Number.isInteger(directSeedValue) && directSeedValue >= 1 && directSeedValue <= 999999999
  ? directSeedValue
  : null;
const INITIAL_PRESET_ID = DIRECT_PRESET_ID
  || (DEVELOPER_RENDER_MODE ? RESEARCH_PRESET_ID : DEFAULT_PRESET_ID);
const DEBUG_FIELDS = new Set([
  "beauty",
  "velocity",
  "temperature",
  "smoke",
  "incandescent",
  "pressure",
  "divergence",
  "vorticity",
  "tracers"
]);

// ---------------------------------------------------------------------------
// Camera interaction tuning. The renderer exposes a distance (zoom) scalar and
// a single orbit-style angle around the event origin — there is no separate
// pitch axis, so "orbit" here means horizontal rotation only. All values are
// frame-rate-independent (exponential damping keyed off real elapsed time),
// so behavior matches across displays and load. Drag threshold is wider for
// coarse (touch/pen) pointers, which register more incidental jitter than a
// mouse.
// ---------------------------------------------------------------------------
const CAMERA_DEFAULT = Object.freeze({ distance: 100, angle: 0, originX: 0.5, originY: 0.66 });
const CAMERA_DISTANCE_RANGE = [50, 150];
const CAMERA_ANGLE_RANGE = [-35, 35];
const CAMERA_DRAG_THRESHOLD_FINE = 6;
const CAMERA_DRAG_THRESHOLD_COARSE = 10;
const CAMERA_EASE_RATE = 10; // 1/s — used for reset/slider/zoom easing
const CAMERA_ANGLE_INERTIA_DECAY = 2.6; // 1/s — release-coast deceleration
const CAMERA_ANGLE_MAX_RELEASE_VELOCITY = 220; // deg/s, clamp on flick release
const CAMERA_SNAP_EPSILON = 0.02;
const CAMERA_VELOCITY_EPSILON = 0.05;

const elements = {
  canvas: $("#simCanvas"),
  researchCanvas: $("#researchCanvas"),
  rendererComparison: $("#rendererComparison"),
  comparisonResearchLabel: $("#comparisonResearchLabel"),
  comparisonFallback: $("#comparisonFallback"),
  fluidDebugOverlay: $("#fluidDebugOverlay"),
  debugFluidView: $("#debugFluidView"),
  debugActiveRenderer: $("#debugActiveRenderer"),
  debugWebgl: $("#debugWebgl"),
  debugGrid: $("#debugGrid"),
  debugPressure: $("#debugPressure"),
  debugTimestep: $("#debugTimestep"),
  debugSteps: $("#debugSteps"),
  debugVelocity: $("#debugVelocity"),
  debugTemperature: $("#debugTemperature"),
  debugSmoke: $("#debugSmoke"),
  debugVorticity: $("#debugVorticity"),
  debugPreset: $("#debugPreset"),
  debugEventFamily: $("#debugEventFamily"),
  debugFluidProfile: $("#debugFluidProfile"),
  debugSourcePrimitives: $("#debugSourcePrimitives"),
  debugVolumeSlices: $("#debugVolumeSlices"),
  debugTracers: $("#debugTracers"),
  debugFallback: $("#debugFallback"),
  debugBuildSource: $("#debugBuildSource"),
  debugBuildRevision: $("#debugBuildRevision"),
  debugBuildDeployed: $("#debugBuildDeployed"),
  debugRendererVersion: $("#debugRendererVersion"),
  debugAssetVersion: $("#debugAssetVersion"),
  debugManifestHash: $("#debugManifestHash"),
  intro: $("#introCard"),
  dismissIntro: $("#dismissIntro"),
  heroDetonate: $("#heroDetonate"),
  floatingAction: $("#floatingActionButton"),
  controls: $("#controlPanel"),
  panelToggle: $("#panelToggle"),
  panelClose: $("#panelClose"),
  interfaceButton: $("#interfaceButton"),
  preset: $("#presetSelect"),
  presetDescription: $("#presetDescription"),
  detonate: $("#detonateButton"),
  play: $("#playButton"),
  restart: $("#restartButton"),
  replay: $("#replayButton"),
  timeline: $("#timelineRange"),
  timelineOutput: $("#timelineOutput"),
  phaseTrack: $("#phaseTrack"),
  speed: $("#speedSelect"),
  energy: $("#energyRange"),
  energyOutput: $("#energyOutput"),
  burst: $("#burstSelect"),
  altitude: $("#altitudeRange"),
  altitudeOutput: $("#altitudeOutput"),
  windDirection: $("#windDirectionRange"),
  windDirectionOutput: $("#windDirectionOutput"),
  windStrength: $("#windStrengthRange"),
  windStrengthOutput: $("#windStrengthOutput"),
  environment: $("#environmentSelect"),
  timeOfDay: $("#timeOfDaySelect"),
  cameraDistance: $("#cameraDistanceRange"),
  cameraDistanceOutput: $("#cameraDistanceOutput"),
  cameraAngle: $("#cameraAngleRange"),
  cameraAngleOutput: $("#cameraAngleOutput"),
  resetCamera: $("#resetCameraButton"),
  placeEvent: $("#placeEventButton"),
  cameraDebugOverlay: $("#cameraDebugOverlay"),
  debugCameraInterfaceMode: $("#debugCameraInterfaceMode"),
  debugCameraPointerType: $("#debugCameraPointerType"),
  debugCameraPointerCount: $("#debugCameraPointerCount"),
  debugCameraGesture: $("#debugCameraGesture"),
  debugCameraThreshold: $("#debugCameraThreshold"),
  debugCameraAngle: $("#debugCameraAngle"),
  debugCameraAngleTarget: $("#debugCameraAngleTarget"),
  debugCameraDistance: $("#debugCameraDistance"),
  debugCameraDistanceTarget: $("#debugCameraDistanceTarget"),
  debugCameraVelocity: $("#debugCameraVelocity"),
  debugCameraTarget: $("#debugCameraTarget"),
  debugCameraPlaceMode: $("#debugCameraPlaceMode"),
  debugCameraResetCount: $("#debugCameraResetCount"),
  density: $("#densityRange"),
  densityOutput: $("#densityOutput"),
  flowMode: $("#flowModeSelect"),
  quality: $("#qualitySelect"),
  researchDiagnostics: $("#researchDiagnostics"),
  diagnostic: $("#diagnosticSelect"),
  diagnosticBackend: $("#diagnosticBackend"),
  diagnosticTier: $("#diagnosticTier"),
  diagnosticGrid: $("#diagnosticGrid"),
  diagnosticStep: $("#diagnosticStep"),
  diagnosticPressure: $("#diagnosticPressure"),
  diagnosticRays: $("#diagnosticRays"),
  diagnosticTracers: $("#diagnosticTracers"),
  diagnosticMemory: $("#diagnosticMemory"),
  diagnosticNote: $("#diagnosticNote"),
  palette: $("#paletteSelect"),
  seed: $("#seedInput"),
  randomizeSeed: $("#randomizeSeedButton"),
  pngInterface: $("#pngInterfaceToggle"),
  png: $("#pngButton"),
  mp4: $("#mp4Button"),
  exportCapability: $("#exportCapability"),
  phaseMetric: $("#phaseMetric"),
  timeMetric: $("#timeMetric"),
  fpsMetric: $("#fpsMetric"),
  toast: $("#toast"),
  exportDialog: $("#exportDialog"),
  exportForm: $("#exportForm"),
  exportClose: $("#exportCloseButton"),
  exportOptions: $("#exportOptions"),
  exportDuration: $("#exportDuration"),
  exportFullDuration: $("#exportFullDuration"),
  exportResolution: $("#exportResolution"),
  exportFps: $("#exportFps"),
  exportStartMode: $("#exportStartMode"),
  exportRoute: $("#exportRoute"),
  exportInterface: $("#exportInterfaceToggle"),
  exportWatermark: $("#exportWatermarkToggle"),
  startExport: $("#startExportButton"),
  exportProgress: $("#exportProgress"),
  exportStage: $("#exportStage"),
  exportDetail: $("#exportDetail"),
  exportProgressBar: $("#exportProgressBar"),
  exportPercent: $("#exportPercent"),
  cancelExport: $("#cancelExportButton"),
  exportError: $("#exportError"),
  exportErrorMessage: $("#exportErrorMessage"),
  recovery: $("#webmRecoveryLink"),
  exportRetry: $("#exportRetryButton")
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const compactQuery = window.matchMedia("(max-width: 760px), (pointer: coarse)");
let compactDevice = compactQuery.matches;

// ---------------------------------------------------------------------------
// Interface-mode capability system. One central resolver classifies the
// session from real input capabilities plus layout constraints — never from
// the user agent string and never from viewport width alone. CSS consumes the
// result through body classes (mode-*, panel-sheet, keyboard-detected,
// has-detonated) so breakpoint logic stays in one place.
//   touch-compact   — phones / narrow touch layouts (bottom-sheet controls)
//   touch-tablet    — wide touch-only devices such as iPads without pointers
//   hybrid          — touch plus fine pointer/hover (touch laptops, iPad with
//                     trackpad); touch-first behavior, keyboard hints only
//                     after a real key press
//   desktop-pointer — no touch capability at all
// ---------------------------------------------------------------------------
const capabilityQueries = {
  anyCoarse: window.matchMedia("(any-pointer: coarse)"),
  anyFine: window.matchMedia("(any-pointer: fine)"),
  anyHover: window.matchMedia("(any-hover: hover)"),
  portrait: window.matchMedia("(orientation: portrait)")
};
let interfaceMode = "desktop-pointer";
let keyboardDetected = false;

function resolveInterfaceMode() {
  const touch = capabilityQueries.anyCoarse.matches || (navigator.maxTouchPoints || 0) > 0;
  if (!touch) return "desktop-pointer";
  if (window.innerWidth <= 760) return "touch-compact";
  return (capabilityQueries.anyFine.matches || capabilityQueries.anyHover.matches)
    ? "hybrid"
    : "touch-tablet";
}

function interfaceModeIsTouch() {
  return interfaceMode !== "desktop-pointer";
}

/**
 * Geometry check for desktop/hybrid layouts: does the open panel actually
 * obstruct the event? Uses the live panel rectangle and the current event
 * origin rather than a hardcoded device category.
 */
function panelObscuresSimulation() {
  if (!panelOpen) return false;
  const rect = elements.controls.getBoundingClientRect();
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const coverage = (rect.width * rect.height) / (viewportWidth * viewportHeight);
  const eventX = state.originX * viewportWidth;
  const coversEvent = eventX > rect.left - viewportWidth * 0.05
    && eventX < rect.right + viewportWidth * 0.05;
  return coverage > 0.4 || coversEvent;
}

function applyInterfaceMode() {
  interfaceMode = resolveInterfaceMode();
  const body = document.body;
  body.classList.toggle("mode-touch-compact", interfaceMode === "touch-compact");
  body.classList.toggle("mode-touch-tablet", interfaceMode === "touch-tablet");
  body.classList.toggle("mode-hybrid", interfaceMode === "hybrid");
  body.classList.toggle("mode-desktop-pointer", interfaceMode === "desktop-pointer");
  // Sheet presentation whenever the panel would otherwise dominate the
  // simulation: all narrow layouts, and portrait touch layouts of any width.
  body.classList.toggle(
    "panel-sheet",
    window.innerWidth <= 760 || (interfaceModeIsTouch() && capabilityQueries.portrait.matches)
  );
  updateFloatingAction();
}
let qualityWasChosenByUser = Boolean(DIRECT_QUALITY);
let proceduralCompareCanvas = null;
if (COMPARE_RENDERERS) {
  proceduralCompareCanvas = document.createElement("canvas");
  proceduralCompareCanvas.id = "proceduralCompareCanvas";
  proceduralCompareCanvas.setAttribute("aria-hidden", "true");
  elements.researchCanvas.before(proceduralCompareCanvas);
  document.body.classList.add("compare-renderers");
  elements.rendererComparison.hidden = false;
}
if (DEBUG_FLUID) {
  document.body.classList.add("debug-fluid");
  elements.fluidDebugOverlay.hidden = false;
}
if (DEBUG_CAMERA && elements.cameraDebugOverlay) {
  elements.cameraDebugOverlay.hidden = false;
}
if (DEVELOPER_RENDER_MODE) {
  window.__EXPLOSION_DYNAMICS_LAB_BUILD__ = BUILD_INFO;
  console.info("Explosion Dynamics Lab build identity", BUILD_INFO);
}
const renderer = new ExplosionRenderer(elements.canvas, {
  reducedMotion,
  researchCanvas: elements.researchCanvas
});
const proceduralRenderer = proceduralCompareCanvas
  ? new ExplosionRenderer(proceduralCompareCanvas, { reducedMotion })
  : null;

const state = {
  presetId: DEFAULT_PRESET_ID,
  paletteId: DEFAULT_PALETTE_ID,
  environment: DEFAULT_ENVIRONMENT_ID,
  timeOfDay: DEFAULT_TIME_ID,
  viewMode: DIRECT_VIEW_MODE || "cinematic",
  flowMode: DIRECT_FLOW_MODE || "off",
  burst: "surface",
  energy: 1,
  altitude: 0.02,
  windDirection: 90,
  windStrength: 24,
  cameraDistance: CAMERA_DEFAULT.distance,
  cameraDistanceTarget: CAMERA_DEFAULT.distance,
  cameraAngle: CAMERA_DEFAULT.angle,
  cameraAngleTarget: CAMERA_DEFAULT.angle,
  cameraAngleVelocity: 0,
  density: compactDevice ? 75 : 100,
  quality: DIRECT_QUALITY || (compactDevice ? "mobile" : "balanced"),
  diagnostic: DEBUG_FLUID && DEBUG_FIELDS.has(query.get("field")) ? query.get("field") : "beauty",
  seed: DIRECT_SEED || 1842,
  originX: 0.5,
  originY: 0.66,
  layers: {
    flash: true,
    fireball: true,
    shock: true,
    thermal: true,
    dust: true,
    cloud: true,
    debris: true,
    grid: true
  },
  time: 0,
  playing: false,
  speed: 1,
  exporting: false
};

/*
 * Art-direction multipliers surfaced by the hidden ?visualDev=1 panel. Every
 * value is a look multiplier over the shipped appearance (1 = shipped look);
 * none exposes real-world damage, optimization, or targeting parameters.
 */
const visualTuning = {
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
  envIllumination: 1
};

function buildVisualDevPanel() {
  const panel = document.createElement("aside");
  panel.id = "visualDevPanel";
  panel.setAttribute("aria-label", "Visual development art-direction controls");
  panel.style.cssText = [
    "position:fixed", "right:12px", "bottom:12px", "z-index:60", "width:250px",
    "max-height:70vh", "overflow-y:auto", "background:rgba(6,8,12,0.92)",
    "border:1px solid rgba(140,160,190,0.25)", "border-radius:10px",
    "padding:12px 14px", "font:11px/1.5 'JetBrains Mono', ui-monospace, monospace",
    "color:#dce3ec"
  ].join(";");
  const heading = document.createElement("strong");
  heading.textContent = "VISUAL DEV · look multipliers";
  heading.style.cssText = "display:block;margin-bottom:8px;font-size:11px;letter-spacing:0.06em;";
  panel.append(heading);
  const groups = [
    ["Shock band count", "shockBands", 0, 2],
    ["Shock band spacing", "shockSpacing", 0.4, 2],
    ["Shock opacity", "shockOpacity", 0, 2],
    ["Refraction intensity", "refraction", 0, 2.5],
    ["Trail persistence", "trailPersistence", 0.4, 2.2],
    ["Flow-line density", "flowDensity", 0, 2.5],
    ["Flow-line lifetime", "flowLifetime", 0.4, 2.2],
    ["Structural-line intensity", "structuralIntensity", 0, 2.5],
    ["Environment detail", "environmentDetail", 0.3, 2],
    ["City density", "cityDensity", 0.3, 2],
    ["Dust response", "dustResponse", 0, 2],
    ["Structural response", "structureResponse", 0, 2],
    ["Mushroom cap width", "capWidth", 0.6, 1.6],
    ["Stem thickness", "stemThickness", 0.6, 1.6],
    ["Camera pullback", "cameraPullback", 0.6, 1.4],
    ["Exposure", "exposure", 0.5, 1.6],
    ["Environment illumination", "envIllumination", 0.2, 2]
  ];
  for (const [label, key, min, max] of groups) {
    const row = document.createElement("label");
    row.style.cssText = "display:block;margin-bottom:6px;";
    const caption = document.createElement("span");
    caption.style.cssText = "display:flex;justify-content:space-between;gap:8px;";
    const name = document.createElement("span");
    name.textContent = label;
    const value = document.createElement("output");
    value.textContent = visualTuning[key].toFixed(2);
    caption.append(name, value);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = "0.05";
    slider.value = String(visualTuning[key]);
    slider.style.cssText = "width:100%;";
    slider.addEventListener("input", () => {
      visualTuning[key] = Number(slider.value);
      value.textContent = visualTuning[key].toFixed(2);
      scheduleRendererFrame({ configure: true });
    });
    row.append(caption, slider);
    panel.append(row);
  }
  const note = document.createElement("p");
  note.textContent = "Art-direction only. No physical, damage, or targeting values.";
  note.style.cssText = "margin-top:8px;opacity:0.6;";
  panel.append(note);
  document.body.append(panel);
}

let timeline = [];
let lastFrame = performance.now();
let lastMetricUpdate = 0;
let lastDetonation = -Infinity;
let toastTimer = 0;
let panelOpen = !compactDevice;
let detonationPending = false;
let floatingActionMode = "hidden";
let pageWasPlaying = false;
let exportController = null;
let recoveryUrl = "";
let pointerGesture = null;
let animationRequest = 0;
let rendererFramePending = false;
let rendererConfigurePending = false;
let placeEventMode = false;
let cameraResetCount = 0;
const activePointers = new Map();

function analytics(eventName, parameters = {}) {
  if (typeof window.gtag !== "function") return;
  window.gtag("event", eventName, parameters);
}

function replaceUrlParameter(name, value) {
  const nextUrl = new URL(window.location.href);
  if (value === null || value === undefined || value === "") nextUrl.searchParams.delete(name);
  else nextUrl.searchParams.set(name, String(value));
  window.history.replaceState(null, "", nextUrl);
}

function showToast(message, duration = 2300) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), duration);
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function populateSelect(select, items) {
  const fragment = document.createDocumentFragment();
  items.forEach((item) => fragment.append(option(item.id, item.name)));
  select.replaceChildren(fragment);
}

function currentPreset() {
  return PRESET_BY_ID[state.presetId] || PRESET_BY_ID[DEFAULT_PRESET_ID];
}

function normalizeBurstType(type) {
  if (["subsurface"].includes(type)) return "underground";
  if (["high-air", "low-air", "airburst", "hovering-fictional"].includes(type)) return "air";
  if (["atmospheric"].includes(type)) return "atmospheric";
  return "surface";
}

function altitudeToControl(value) {
  return Math.round(clamp((Number(value) + 0.2) / 0.95, 0, 1) * 100);
}

function controlToAltitude(value) {
  return clamp(Number(value) / 100 * 0.95 - 0.2, -0.2, 0.75);
}

function altitudeLabel(value) {
  if (value < -0.06) return "Subsurface";
  if (value < 0.05) return "Surface";
  if (value < 0.25) return "Low";
  if (value < 0.5) return "Elevated";
  return "High atmosphere";
}

function directionLabel(degrees) {
  const labels = ["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest"];
  return labels[Math.round((Number(degrees) % 360) / 45) % 8];
}

function strengthLabel(value) {
  if (value < 10) return "Calm";
  if (value < 34) return "Light";
  if (value < 67) return "Moderate";
  return "Strong";
}

function distanceLabel(value) {
  if (value < 76) return "Near";
  if (value > 124) return "Far";
  return "Medium";
}

function setPanel(open, remember = true, { suppressCloseFocus = false } = {}) {
  const focusWasInside = elements.controls.contains(document.activeElement);
  panelOpen = Boolean(open);
  elements.controls.classList.toggle("is-closed", !panelOpen);
  elements.controls.setAttribute("aria-hidden", panelOpen ? "false" : "true");
  elements.controls.inert = !panelOpen;
  elements.panelToggle.setAttribute("aria-expanded", String(panelOpen));
  elements.panelToggle.textContent = panelOpen ? "Hide controls" : "Controls";
  if (!panelOpen && focusWasInside && !suppressCloseFocus) elements.panelToggle.focus();
  if (remember) {
    try { localStorage.setItem("explosion-lab-panel", panelOpen ? "open" : "closed"); } catch {}
  }
  updateFloatingAction();
}

function setInterfaceVisible(visible) {
  document.body.classList.toggle("interface-visible", visible);
  elements.interfaceButton.setAttribute("aria-pressed", String(!visible));
  elements.interfaceButton.setAttribute("aria-label", visible ? "Hide interface" : "Show interface");
  elements.interfaceButton.textContent = visible ? "Hide UI" : "Show UI";
  showToast(visible ? "Interface visible" : "Interface hidden · press H to restore");
}

function dismissIntro() {
  elements.intro.classList.add("is-dismissed");
  try { sessionStorage.setItem("explosion-lab-intro", "dismissed"); } catch {}
  updateFloatingAction();
}

/**
 * Compact launch control shown only while the Event Controls panel is
 * closed (and only on the bottom-sheet layout, via the stylesheet's
 * 760px media query). Label follows simulation state: Detonate before
 * first launch, hidden during playback, Resume when paused mid-event,
 * Replay after completion.
 */
function updateFloatingAction() {
  const button = elements.floatingAction;
  if (!button) return;
  const introVisible = !elements.intro.classList.contains("is-dismissed");
  let mode = "hidden";
  if (interfaceModeIsTouch()
    && !panelOpen && !introVisible && !detonationPending && !state.exporting && !state.playing) {
    if (state.time <= 0) mode = "detonate";
    else if (state.time >= currentPreset().duration) mode = "replay";
    else mode = "resume";
  }
  if (mode === floatingActionMode) return;
  floatingActionMode = mode;
  const hidden = mode === "hidden";
  button.classList.toggle("is-hidden", hidden);
  button.setAttribute("aria-hidden", hidden ? "true" : "false");
  button.tabIndex = hidden ? -1 : 0;
  if (!hidden) {
    button.dataset.action = mode;
    button.querySelector(".floating-action__label").textContent =
      mode === "detonate" ? "Detonate" : mode === "replay" ? "Replay" : "Resume";
  }
}

function configureRenderer() {
  const settings = {
    presetId: state.presetId,
    paletteId: state.paletteId,
    environment: state.environment,
    timeOfDay: state.timeOfDay,
    viewMode: state.viewMode,
    burst: state.burst,
    energy: state.energy,
    altitude: state.altitude,
    windDirection: state.windDirection,
    windStrength: state.windStrength,
    cameraDistance: state.cameraDistance,
    cameraAngle: state.cameraAngle,
    density: state.density,
    quality: state.quality,
    flowMode: state.flowMode,
    diagnostic: state.diagnostic,
    debugMetrics: DEBUG_FLUID,
    seed: state.seed,
    layers: { ...state.layers },
    tuning: { ...visualTuning }
  };
  renderer.configure(settings);
  proceduralRenderer?.configure(settings);
  setRendererOrigin(state.originX, state.originY);
}

function comparisonSampleTime(time) {
  if (!COMPARE_RENDERERS) return time;
  return Math.floor(Math.max(0, Number(time) || 0) * 30 + 1e-7) / 30;
}

function renderLive(time = state.time) {
  const sampleTime = comparisonSampleTime(time);
  const researchRendered = renderer.render(sampleTime);
  const proceduralRendered = proceduralRenderer?.render(sampleTime) ?? true;
  return researchRendered && proceduralRendered;
}

function resizeRenderers() {
  const researchResized = renderer.resize();
  const proceduralResized = proceduralRenderer?.resize() ?? true;
  return researchResized && proceduralResized;
}

function setRendererOrigin(x, y) {
  renderer.setOrigin(x, y);
  proceduralRenderer?.setOrigin(x, y);
}

function destroyRenderers() {
  renderer.destroy?.();
  proceduralRenderer?.destroy?.();
}

function scheduleRendererFrame({ configure = false } = {}) {
  rendererFramePending = true;
  rendererConfigurePending ||= configure;
}

function takeScheduledRendererWork() {
  const work = {
    configure: rendererConfigurePending,
    render: rendererFramePending
  };
  rendererConfigurePending = false;
  rendererFramePending = false;
  return work;
}

function flushRendererWork({ forceConfigure = false, render = true } = {}) {
  const work = takeScheduledRendererWork();
  const shouldConfigure = forceConfigure || work.configure;
  if (shouldConfigure) configureRenderer();
  if (render && (work.render || shouldConfigure)) return renderLive(state.time);
  return true;
}

function rebuildPhaseTrack() {
  const preset = currentPreset();
  elements.phaseTrack.replaceChildren();
  timeline.forEach((phase) => {
    const segment = document.createElement("span");
    const definition = PHASES.find(({ id }) => id === phase.id);
    segment.dataset.phase = phase.id;
    segment.title = definition?.label || phase.id;
    segment.style.flex = `${Math.max(0.18, phase.duration)} 1 0`;
    elements.phaseTrack.append(segment);
  });
  elements.timeline.max = String(preset.duration);
  elements.timeline.value = String(state.time);
}

function updateTimelineUi() {
  const preset = currentPreset();
  const duration = preset.duration;
  state.time = clamp(state.time, 0, duration);
  elements.timeline.value = String(state.time);
  elements.timelineOutput.textContent = `${state.time.toFixed(1)} / ${duration.toFixed(1)} s`;
  elements.timeMetric.textContent = `${state.time.toFixed(1).padStart(4, "0")} s`;
  const activePhase = getPhaseAtTime(timeline, state.time);
  const phaseDefinition = PHASES.find(({ id }) => id === activePhase?.id);
  elements.phaseMetric.textContent = phaseDefinition?.shortLabel || (state.time >= duration ? "Complete" : "Ready");
  $$("span", elements.phaseTrack).forEach((segment) => {
    const phase = timeline.find(({ id }) => id === segment.dataset.phase);
    segment.classList.toggle("is-past", Boolean(phase && state.time > phase.end));
    segment.classList.toggle("is-current", Boolean(phase && state.time >= phase.start && state.time <= phase.end));
  });
  updateFloatingAction();
}

function updateControlOutputs() {
  elements.energyOutput.textContent = `${state.energy.toFixed(2)}×`;
  elements.altitudeOutput.textContent = altitudeLabel(state.altitude);
  elements.windDirectionOutput.textContent = directionLabel(state.windDirection);
  elements.windStrengthOutput.textContent = strengthLabel(state.windStrength);
  elements.cameraDistanceOutput.textContent = distanceLabel(state.cameraDistance);
  elements.cameraAngleOutput.textContent = `${Math.round(state.cameraAngle)}°`;
  elements.densityOutput.textContent = `${Math.round(state.density)}%`;
}

/**
 * Restores the camera (distance, angle, origin/target) to its shared default.
 * Eases back over a few frames via updateCameraAnimation rather than jumping
 * instantly. Never touches simulation time, playback, or preset state.
 */
function resetCamera() {
  state.cameraDistanceTarget = CAMERA_DEFAULT.distance;
  state.cameraAngleTarget = CAMERA_DEFAULT.angle;
  state.cameraAngleVelocity = 0;
  state.originX = CAMERA_DEFAULT.originX;
  state.originY = CAMERA_DEFAULT.originY;
  setRendererOrigin(state.originX, state.originY);
  cameraResetCount += 1;
  showToast("Camera reset");
}

/**
 * "Place event" is an explicit, user-armed mode for repositioning the
 * abstract event origin. It replaces the old implicit behavior where any
 * plain tap on the canvas silently recentered the scene — that made normal
 * camera taps feel unstable. Placement is single-shot: it disarms itself
 * after one placement so accidental future taps can't move the event again.
 */
function setPlaceEventMode(active) {
  placeEventMode = Boolean(active);
  elements.placeEvent.setAttribute("aria-pressed", String(placeEventMode));
  elements.canvas.classList.toggle("place-event-mode", placeEventMode);
  if (placeEventMode) showToast("Tap the canvas once to place the event");
}

function updateCameraAnimation(delta) {
  if (state.exporting) return false;
  let changed = false;

  if (Math.abs(state.cameraAngleVelocity) > CAMERA_VELOCITY_EPSILON) {
    let next = state.cameraAngle + state.cameraAngleVelocity * delta;
    if (next <= CAMERA_ANGLE_RANGE[0] || next >= CAMERA_ANGLE_RANGE[1]) {
      next = clamp(next, CAMERA_ANGLE_RANGE[0], CAMERA_ANGLE_RANGE[1]);
      state.cameraAngleVelocity = 0; // bounded — stop dead at the limit, no bounce
    } else {
      state.cameraAngleVelocity *= Math.exp(-CAMERA_ANGLE_INERTIA_DECAY * delta);
    }
    state.cameraAngle = next;
    state.cameraAngleTarget = next;
    changed = true;
  } else if (Math.abs(state.cameraAngleTarget - state.cameraAngle) > CAMERA_SNAP_EPSILON) {
    state.cameraAngle += (state.cameraAngleTarget - state.cameraAngle) * (1 - Math.exp(-CAMERA_EASE_RATE * delta));
    changed = true;
  } else if (state.cameraAngle !== state.cameraAngleTarget) {
    state.cameraAngle = state.cameraAngleTarget;
    changed = true;
  }

  if (Math.abs(state.cameraDistanceTarget - state.cameraDistance) > CAMERA_SNAP_EPSILON) {
    state.cameraDistance += (state.cameraDistanceTarget - state.cameraDistance) * (1 - Math.exp(-CAMERA_EASE_RATE * delta));
    changed = true;
  } else if (state.cameraDistance !== state.cameraDistanceTarget) {
    state.cameraDistance = state.cameraDistanceTarget;
    changed = true;
  }

  if (changed) {
    elements.cameraAngle.value = String(Math.round(state.cameraAngle));
    elements.cameraDistance.value = String(Math.round(state.cameraDistance));
    updateControlOutputs();
    configureRenderer();
  }
  return changed;
}

function updateCameraDebugOverlay(gestureLabel) {
  if (!DEBUG_CAMERA || !elements.cameraDebugOverlay) return;
  elements.debugCameraInterfaceMode.textContent = interfaceMode;
  elements.debugCameraPointerType.textContent = pointerGesture?.pointerType || "none";
  elements.debugCameraPointerCount.textContent = String(activePointers.size);
  elements.debugCameraGesture.textContent = gestureLabel || (pointerGesture?.moved ? "drag" : pointerGesture ? "pending" : "idle");
  elements.debugCameraThreshold.textContent = pointerGesture?.moved ? "crossed" : "not crossed";
  elements.debugCameraAngle.textContent = `${state.cameraAngle.toFixed(2)}°`;
  elements.debugCameraAngleTarget.textContent = `${state.cameraAngleTarget.toFixed(2)}°`;
  elements.debugCameraDistance.textContent = state.cameraDistance.toFixed(2);
  elements.debugCameraDistanceTarget.textContent = state.cameraDistanceTarget.toFixed(2);
  elements.debugCameraVelocity.textContent = `${state.cameraAngleVelocity.toFixed(2)}°/s`;
  elements.debugCameraTarget.textContent = `${state.originX.toFixed(3)}, ${state.originY.toFixed(3)}`;
  elements.debugCameraPlaceMode.textContent = placeEventMode ? "armed" : "off";
  elements.debugCameraResetCount.textContent = String(cameraResetCount);
}

function setPlaying(playing) {
  state.playing = Boolean(playing) && state.time < currentPreset().duration;
  elements.play.textContent = state.playing ? "Pause" : "Play";
  elements.play.setAttribute("aria-pressed", String(state.playing));
  updateFloatingAction();
}

function applyPreset(presetId, { announce = true, track = true } = {}) {
  if (state.exporting) return;
  const preset = PRESET_BY_ID[presetId] || PRESET_BY_ID[DEFAULT_PRESET_ID];
  state.presetId = preset.id;
  state.paletteId = preset.defaultPaletteId;
  state.environment = preset.defaultEnvironmentId;
  state.timeOfDay = preset.defaultTimeId;
  state.burst = normalizeBurstType(preset.burstType);
  state.energy = clamp(1, preset.energyRange[0], preset.energyRange[1]);
  state.altitude = preset.defaultAltitude;
  state.time = 0;
  setPlaying(false);
  timeline = buildPhaseTimeline(preset);

  elements.preset.value = preset.id;
  elements.presetDescription.innerHTML = `<strong>${preset.shortName}.</strong> ${preset.description} ${preset.safetyNote}`;
  elements.palette.value = state.paletteId;
  elements.environment.value = state.environment;
  elements.timeOfDay.value = state.timeOfDay;
  elements.burst.value = state.burst;
  elements.energy.min = String(preset.energyRange[0]);
  elements.energy.max = String(preset.energyRange[1]);
  elements.energy.value = String(state.energy);
  elements.altitude.value = String(altitudeToControl(state.altitude));
  const isResearchModel = Boolean(preset.researchModel);
  elements.researchDiagnostics.hidden = !DEBUG_FLUID || !isResearchModel || state.viewMode !== "cinematic";
  if (!isResearchModel) state.diagnostic = "beauty";
  elements.diagnostic.value = state.diagnostic;
  if (elements.debugFluidView) elements.debugFluidView.value = state.diagnostic;
  rebuildPhaseTrack();
  updateControlOutputs();
  updateTimelineUi();
  configureRenderer();
  renderLive(state.time);
  if (announce) showToast(`${preset.name} loaded`);
  if (track) analytics("preset_selected", { preset: preset.id });
}

function startDetonationSequence() {
  document.body.classList.add("has-detonated");
  state.time = 0;
  configureRenderer();
  setPlaying(true);
  updateTimelineUi();
  analytics("detonation_triggered", { preset: state.presetId, view_mode: state.viewMode });
  showToast(`${currentPreset().shortName} · sequence started`);
}

/**
 * On the bottom-sheet layout the open panel covers the viewport, so the
 * opening flash would play behind it. Close the panel first, then start
 * the sequence once the dismissal transition has cleared — never while
 * the panel still obscures the simulation. All selected settings live in
 * `state` and are untouched by closing the panel.
 */
function beginDetonationAfterPanelClears() {
  detonationPending = true;
  const focusWasInside = elements.controls.contains(document.activeElement);
  setPanel(false, true, { suppressCloseFocus: true });
  if (focusWasInside) elements.canvas.focus({ preventScroll: true });
  let fallbackTimer = 0;
  let settled = false;
  const begin = () => {
    if (settled) return;
    settled = true;
    elements.controls.removeEventListener("transitionend", onTransitionEnd);
    window.clearTimeout(fallbackTimer);
    detonationPending = false;
    // If the panel was reopened during dismissal, never start behind it.
    if (panelOpen || !elements.controls.classList.contains("is-closed")) {
      updateFloatingAction();
      return;
    }
    startDetonationSequence();
  };
  const onTransitionEnd = (event) => {
    if (event.target === elements.controls && event.propertyName === "transform") begin();
  };
  elements.controls.addEventListener("transitionend", onTransitionEnd);
  // Safety fallback in case transitionend never fires; reduced motion
  // collapses the panel near-instantly, so start on the next frames.
  fallbackTimer = window.setTimeout(begin, reducedMotion ? 60 : 360);
}

function detonate() {
  if (detonationPending) return false;
  const now = performance.now();
  if (now - lastDetonation < 650) {
    showToast("Event reset is cooling down");
    return false;
  }
  lastDetonation = now;
  dismissIntro();
  // Touch layouts always clear the panel first; pointer layouts clear it only
  // when the open panel genuinely obstructs the event (live geometry, not a
  // hardcoded device class).
  if (panelOpen && (interfaceModeIsTouch() || panelObscuresSimulation())) {
    beginDetonationAfterPanelClears();
  } else {
    startDetonationSequence();
  }
  return true;
}

function restart(play = false) {
  state.time = 0;
  configureRenderer();
  setPlaying(play);
  updateTimelineUi();
  renderLive(state.time);
}

function updateSettingsFromControls() {
  if (state.exporting) return;
  const previousQuality = state.quality;
  const previousSeed = state.seed;
  state.energy = Number(elements.energy.value);
  state.burst = elements.burst.value;
  state.altitude = controlToAltitude(elements.altitude.value);
  state.windDirection = Number(elements.windDirection.value);
  state.windStrength = Number(elements.windStrength.value);
  state.environment = elements.environment.value;
  state.timeOfDay = elements.timeOfDay.value;
  // Slider input is direct/immediate (matches keyboard-arrow accessibility
  // expectations); setting target === current avoids updateCameraAnimation
  // fighting the new value on the next frame.
  state.cameraDistance = Number(elements.cameraDistance.value);
  state.cameraDistanceTarget = state.cameraDistance;
  state.cameraAngle = Number(elements.cameraAngle.value);
  state.cameraAngleTarget = state.cameraAngle;
  state.cameraAngleVelocity = 0;
  state.density = Number(elements.density.value);
  state.quality = elements.quality.value;
  if (elements.flowMode) {
    state.flowMode = ["off", "flow", "field"].includes(elements.flowMode.value)
      ? elements.flowMode.value
      : "off";
  }
  state.diagnostic = elements.diagnostic.value;
  if (elements.debugFluidView) elements.debugFluidView.value = state.diagnostic;
  state.paletteId = elements.palette.value;
  state.seed = clamp(Math.trunc(Number(elements.seed.value) || 1), 1, 999999999);
  elements.seed.value = String(state.seed);
  state.layers = Object.fromEntries($$("[data-layer]").map((input) => [input.dataset.layer, input.checked]));
  if (state.quality !== previousQuality) replaceUrlParameter("quality", state.quality);
  if (state.seed !== previousSeed) replaceUrlParameter("seed", state.seed);
  replaceUrlParameter("flow", state.flowMode === "off" ? null : state.flowMode);
  updateControlOutputs();
  scheduleRendererFrame({ configure: true });
}

function normalizedMetric(value) {
  return Number.isFinite(value) ? Number(value).toFixed(4) : "—";
}

function updateFluidDebugOverlay(stats) {
  if (!DEBUG_FLUID || !elements.fluidDebugOverlay) return;
  const metrics = stats.fieldMetrics || stats.fluidMetrics || {};
  elements.debugActiveRenderer.textContent = stats.activeRenderer || "INITIALIZING";
  elements.debugWebgl.textContent = stats.webgl2Available === true
    ? "yes"
    : stats.webgl2Available === false ? "no" : "checking";
  elements.debugGrid.textContent = stats.fluidGrid || "—";
  elements.debugPressure.textContent = Number.isFinite(stats.pressureIterations)
    ? String(stats.pressureIterations)
    : "—";
  const timestep = stats.fluidFixedStep ?? stats.fixedStep;
  elements.debugTimestep.textContent = Number.isFinite(timestep)
    ? `${Number(timestep).toFixed(5)} s`
    : "—";
  const steps = stats.fluidSimulationSteps ?? stats.fluidStep;
  elements.debugSteps.textContent = Number.isFinite(steps) ? String(steps) : "0";
  elements.debugVelocity.textContent = normalizedMetric(
    metrics.maxVelocity ?? metrics.velocityMagnitude ?? stats.maxVelocity
  );
  elements.debugTemperature.textContent = normalizedMetric(
    metrics.maxTemperature ?? metrics.maximumTemperature ?? stats.maxTemperature
  );
  elements.debugSmoke.textContent = normalizedMetric(
    metrics.maxSmoke ?? metrics.smokeDensity ?? stats.maxSmoke
  );
  elements.debugVorticity.textContent = normalizedMetric(
    metrics.maxVorticity ?? metrics.vorticityMagnitude ?? stats.maxVorticity
  );
  elements.debugPreset.textContent = stats.activePreset || currentPreset().name;
  elements.debugEventFamily.textContent = stats.eventFamily || currentPreset().eventFamily || "Unclassified";
  elements.debugFluidProfile.textContent = stats.fluidProfile || currentPreset().researchModel?.id || "—";
  const sourcePrimitives = Array.isArray(stats.sourcePrimitives)
    ? stats.sourcePrimitives
    : currentPreset().researchModel?.sourcePrimitives || [];
  elements.debugSourcePrimitives.textContent = sourcePrimitives.length ? sourcePrimitives.join(" · ") : "none";
  elements.debugVolumeSlices.textContent = Number.isFinite(stats.volumeSlices ?? stats.rayMarchSteps)
    ? String(stats.volumeSlices ?? stats.rayMarchSteps)
    : "—";
  elements.debugTracers.textContent = Number.isFinite(stats.tracerCount)
    ? `${stats.tracerCount}${stats.tracerType ? ` · ${stats.tracerType}` : ""}`
    : "—";
  const glFailure = stats.lastGlError
    ? `WebGL ${stats.lastGlError.name || stats.lastGlError.code || "error"}${stats.lastGlError.stage ? ` during ${stats.lastGlError.stage}` : ""}`
    : "";
  elements.debugFallback.textContent = stats.rendererFallback
    ? stats.fluidFallbackReason || glFailure || "Fluid renderer unavailable"
    : stats.fluidFallbackReason || "none";
  elements.debugBuildSource.textContent = BUILD_INFO.source;
  elements.debugBuildRevision.textContent = BUILD_INFO.build;
  elements.debugBuildDeployed.textContent = BUILD_INFO.deployedAt;
  elements.debugRendererVersion.textContent = BUILD_INFO.rendererVersion;
  elements.debugAssetVersion.textContent = BUILD_INFO.assetVersion;
  elements.debugManifestHash.textContent = BUILD_INFO.manifestHash;
}

function updateRendererComparisonStatus(stats) {
  if (!COMPARE_RENDERERS || !elements.comparisonResearchLabel) return;
  const overviewActive = stats.visualizationMode === "overview"
    || stats.activeRenderer === "ANALYTICAL OVERVIEW";
  const fluidActive = stats.activeRenderer === "GPU FLUID";
  elements.comparisonResearchLabel.textContent = overviewActive
    ? "Effects Overview · ANALYTICAL"
    : fluidActive ? "Research Fluid Model · GPU FLUID" : "Research Fluid Model · FALLBACK";
  const glFailure = stats.lastGlError
    ? `${stats.lastGlError.name || stats.lastGlError.code || "WebGL error"}${stats.lastGlError.stage ? ` during ${stats.lastGlError.stage}` : ""}`
    : "";
  const reason = stats.fluidFallbackReason || glFailure;
  elements.comparisonFallback.hidden = overviewActive || !stats.rendererFallback || !reason;
  elements.comparisonFallback.textContent = reason ? `Fallback reason: ${reason}` : "";
}

function animationFrame(now) {
  const scheduledWork = takeScheduledRendererWork();
  if (scheduledWork.configure) configureRenderer();
  const delta = clamp((now - lastFrame) / 1000, 0, 0.08);
  lastFrame = now;
  // Camera easing/inertia runs every frame, independent of playback state, so
  // orbit coast and Reset Camera animate smoothly even while paused.
  const cameraAnimating = updateCameraAnimation(delta);
  if (state.playing && !state.exporting) {
    state.time += delta * state.speed;
    if (state.time >= currentPreset().duration) {
      state.time = currentPreset().duration;
      setPlaying(false);
    }
    renderLive(state.time);
    updateTimelineUi();
  } else if ((scheduledWork.render || cameraAnimating) && !state.exporting) {
    renderLive(state.time);
  }
  updateCameraDebugOverlay();
  if (now - lastMetricUpdate > 500) {
    const stats = renderer.getStats?.({ includeFieldMetrics: DEBUG_FLUID }) || {};
    elements.fpsMetric.textContent = Number.isFinite(stats.fps) ? String(Math.round(stats.fps)) : "—";
    updateFluidDebugOverlay(stats);
    updateRendererComparisonStatus(stats);
    if (!elements.researchDiagnostics.hidden) {
      elements.diagnosticBackend.textContent = stats.fluidBackend || "Initializing";
      elements.diagnosticTier.textContent = stats.fluidTier || state.quality;
      elements.diagnosticGrid.textContent = stats.fluidGrid || "—";
      elements.diagnosticStep.textContent = Number.isFinite(stats.fluidStep) ? String(stats.fluidStep) : "0";
      elements.diagnosticPressure.textContent = Number.isFinite(stats.pressureIterations) ? String(stats.pressureIterations) : "—";
      elements.diagnosticRays.textContent = Number.isFinite(stats.volumeSlices ?? stats.rayMarchSteps)
        ? String(stats.volumeSlices ?? stats.rayMarchSteps)
        : "—";
      elements.diagnosticTracers.textContent = Number.isFinite(stats.tracerCount) ? String(stats.tracerCount) : "—";
      elements.diagnosticMemory.textContent = stats.gpuMemory || "—";
      elements.diagnosticNote.textContent = stats.fluidFallbackReason
        ? stats.fluidBackend === "WebGL2 fluid"
          ? `Adaptive quality fallback: ${stats.fluidFallbackReason}. The normalized WebGL2 fluid model remains active; all values are dimensionless.`
          : `WebGL2 research model unavailable: ${stats.fluidFallbackReason}. The deterministic Canvas 2D model remains active. All values are dimensionless.`
        : "All fields are dimensionless visual values. No pressure, yield, distance, damage, or safety prediction is computed.";
    }
    lastMetricUpdate = now;
  }
  animationRequest = window.requestAnimationFrame(animationFrame);
}

function filename(extension, preset = currentPreset(), seed = state.seed) {
  return `explosion-dynamics-${safeSlug(preset.shortName)}-seed-${seed}.${extension}`;
}

async function canvasToBlob(canvas, type = "image/png") {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas export returned no data.")), type);
  });
}

async function downloadPng() {
  try {
    flushRendererWork({ forceConfigure: true });
    const exportPreset = currentPreset();
    const exportSeed = state.seed;
    const exportFilename = filename("png", exportPreset, exportSeed);
    const interfaceIncluded = elements.pngInterface.checked;
    const exportCanvas = document.createElement("canvas");
    const rect = elements.canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    exportCanvas.width = Math.max(1, Math.round(rect.width * ratio));
    exportCanvas.height = Math.max(1, Math.round(rect.height * ratio));
    const rendered = renderer.renderTo(exportCanvas, state.time, {
      includeInterface: interfaceIncluded,
      watermark: true,
      exportMode: true
    });
    if (!rendered) throw new Error("Research fluid PNG export unavailable on this device.");
    const blob = await canvasToBlob(exportCanvas);
    createDownload(blob, exportFilename);
    analytics("png_exported", { preset: exportPreset.id, interface_included: interfaceIncluded });
    showToast("PNG downloaded");
  } catch (error) {
    console.error("PNG export failed:", error);
    showToast("PNG export could not be completed");
  } finally {
    renderer.releaseExportResources?.();
  }
}

function resetExportDialog() {
  elements.exportOptions.hidden = false;
  elements.exportProgress.hidden = true;
  elements.exportError.hidden = true;
  elements.exportClose.disabled = false;
  elements.exportProgressBar.value = 0;
  elements.exportPercent.value = "0%";
  elements.exportPercent.textContent = "0%";
}

function openExportDialog() {
  resetExportDialog();
  if (compactDevice) {
    elements.exportResolution.value = "1280x720";
    elements.exportDuration.value = "5";
  }
  if (typeof elements.exportDialog.showModal === "function") elements.exportDialog.showModal();
  else elements.exportDialog.setAttribute("open", "");
}

function progressCopy(stage, detail) {
  const copies = {
    preparing: ["Preparing simulation", "Building a deterministic render session…"],
    recording: ["Recording frames", detail || "Rendering the event at a fixed simulation timestep…"],
    loading_ffmpeg: ["Loading local encoder", "Loading FFmpeg only now, after your MP4 request…"],
    encoding: ["Encoding MP4", detail || "Converting the temporary recording locally on this device…"],
    validating: ["Finalizing file", "Checking MP4 container bytes, dimensions, and playback metadata…"],
    finalizing: ["Finalizing file", "Checking MP4 container bytes, dimensions, and playback metadata…"],
    complete: ["Export complete", "Your genuine MP4 is ready to download."],
    cancelling: ["Cancelling export", "Cleaning temporary recording and encoder resources…"]
  };
  return copies[stage] || [stage || "Working", detail || "Processing locally…"];
}

function updateExportProgress(update = {}) {
  const [title, defaultDetail] = progressCopy(update.stage, update.detail);
  const reported = update.percent ?? (Number(update.progress) * 100);
  const percent = clamp(Math.round(Number(reported) || 0), 0, 100);
  if (elements.exportStage.textContent !== title) elements.exportStage.textContent = title;
  if (elements.exportDetail.textContent !== defaultDetail) elements.exportDetail.textContent = defaultDetail;
  elements.exportProgressBar.value = percent;
  elements.exportPercent.value = `${percent}%`;
  elements.exportPercent.textContent = `${percent}%`;
}

function clearRecoveryUrl() {
  if (recoveryUrl) URL.revokeObjectURL(recoveryUrl);
  recoveryUrl = "";
  elements.recovery.hidden = true;
  elements.recovery.removeAttribute("href");
}

function showExportError(error) {
  elements.exportOptions.hidden = true;
  elements.exportProgress.hidden = true;
  elements.exportError.hidden = false;
  elements.exportClose.disabled = false;
  elements.exportErrorMessage.textContent = error?.name === "AbortError"
    ? "The export was cancelled. The live simulator has been restored."
    : `${error?.message || "The encoder did not return a playable MP4."} Try 5 seconds at 720p or another modern browser.`;
  clearRecoveryUrl();
  if (error?.recoveryBlob instanceof Blob) {
    recoveryUrl = URL.createObjectURL(error.recoveryBlob);
    elements.recovery.href = recoveryUrl;
    elements.recovery.download = filename("webm");
    elements.recovery.hidden = false;
  }
  elements.exportRetry.focus({ preventScroll: true });
}

async function startVideoExport() {
  if (state.exporting) return;
  flushRendererWork({ forceConfigure: true });
  clearRecoveryUrl();
  const preset = currentPreset();
  const exportSeed = state.seed;
  const exportFilename = filename("mp4", preset, exportSeed);
  const includeInterface = elements.exportInterface.checked;
  const includeWatermark = elements.exportWatermark.checked;
  const exportRoute = elements.exportRoute.value;
  const controlsWereInert = elements.controls.inert;
  const [width, height] = elements.exportResolution.value.split("x").map(Number);
  const fps = Number(elements.exportFps.value);
  let startTime = elements.exportStartMode.value === "current" ? state.time : 0;
  if (preset.duration - startTime < 1) startTime = 0;
  const requestedDuration = elements.exportDuration.value === "full"
    ? preset.duration
    : Number(elements.exportDuration.value);
  const durationLimit = compactDevice ? 10 : 30;
  const remainingDuration = Math.max(1 / fps, preset.duration - startTime);
  const duration = Math.max(1 / fps, Math.min(requestedDuration, durationLimit, remainingDuration));
  const previousState = { time: state.time, playing: state.playing };
  state.exporting = true;
  elements.controls.inert = true;
  setPlaying(false);
  elements.exportOptions.hidden = true;
  elements.exportProgress.hidden = false;
  elements.exportError.hidden = true;
  elements.exportClose.disabled = true;
  updateExportProgress({ stage: "preparing", percent: 1 });
  exportController = new AbortController();
  elements.cancelExport.focus({ preventScroll: true });
  analytics("mp4_export_started", {
    preset: preset.id,
    resolution: `${width}x${height}`,
    duration,
    fps,
    route: exportRoute
  });

  try {
    const result = await exportMp4({
      width,
      height,
      fps,
      duration,
      startTime,
      includeInterface,
      watermark: includeWatermark,
      route: exportRoute,
      signal: exportController.signal,
      onProgress: updateExportProgress,
      renderFrame(targetCanvas, simulationTime, frameIndex, metadata = {}) {
        const rendered = renderer.renderTo(targetCanvas, simulationTime, {
          includeInterface,
          watermark: includeWatermark,
          exportMode: true,
          frameIndex,
          ...metadata
        });
        if (!rendered) throw new Error("Research fluid MP4 frame export unavailable on this device.");
      }
    });
    updateExportProgress({ stage: "complete", percent: 100 });
    createDownload(result.blob, exportFilename);
    analytics("mp4_export_completed", {
      preset: preset.id,
      route: result.route,
      mime_type: result.mimeType || "video/mp4",
      resolution: `${width}x${height}`,
      duration,
      fps
    });
    window.setTimeout(() => {
      if (elements.exportDialog.open) elements.exportDialog.close();
      resetExportDialog();
    }, 850);
  } catch (error) {
    if (error?.name !== "AbortError") console.error("MP4 export failed:", error);
    analytics("mp4_export_failed", {
      preset: preset.id,
      route: exportRoute,
      error_type: error?.name || "ExportError"
    });
    showExportError(error);
  } finally {
    state.exporting = false;
    elements.controls.inert = controlsWereInert;
    state.time = previousState.time;
    setPlaying(previousState.playing);
    exportController = null;
    try {
      renderer.releaseExportResources?.();
    } catch (error) {
      console.error("Export renderer cleanup failed:", error);
    }
    renderLive(state.time);
    updateTimelineUi();
  }
}

function bindControls() {
  elements.dismissIntro.addEventListener("click", dismissIntro);
  elements.heroDetonate.addEventListener("click", detonate);
  elements.detonate.addEventListener("click", detonate);
  elements.play.addEventListener("click", () => {
    if (state.time >= currentPreset().duration) state.time = 0;
    setPlaying(!state.playing);
  });
  elements.restart.addEventListener("click", () => restart(false));
  elements.replay.addEventListener("click", () => restart(true));
  elements.resetCamera?.addEventListener("click", resetCamera);
  elements.placeEvent?.addEventListener("click", () => setPlaceEventMode(!placeEventMode));
  elements.preset.addEventListener("change", () => {
    applyPreset(elements.preset.value);
    replaceUrlParameter("preset", state.presetId);
  });
  elements.debugFluidView?.addEventListener("change", () => {
    const mode = DEBUG_FIELDS.has(elements.debugFluidView.value)
      ? elements.debugFluidView.value
      : "beauty";
    state.diagnostic = mode;
    elements.diagnostic.value = mode;
    const nextUrl = new URL(window.location.href);
    if (mode === "beauty") nextUrl.searchParams.delete("field");
    else nextUrl.searchParams.set("field", mode);
    window.history.replaceState(null, "", nextUrl);
    configureRenderer();
    renderLive(state.time);
  });
  elements.speed.addEventListener("change", () => { state.speed = Number(elements.speed.value); });
  elements.timeline.addEventListener("input", () => {
    state.time = Number(elements.timeline.value);
    setPlaying(false);
    updateTimelineUi();
    scheduleRendererFrame();
  });
  $$('input[name="viewMode"]').forEach((input) => input.addEventListener("change", () => {
    if (!input.checked) return;
    state.viewMode = input.value;
    replaceUrlParameter("mode", state.viewMode);
    elements.researchDiagnostics.hidden = !DEBUG_FLUID || !currentPreset().researchModel || state.viewMode !== "cinematic";
    configureRenderer();
    renderLive(state.time);
    analytics("view_mode_changed", { view_mode: state.viewMode });
  }));
  [
    elements.energy,
    elements.burst,
    elements.altitude,
    elements.windDirection,
    elements.windStrength,
    elements.environment,
    elements.timeOfDay,
    elements.cameraDistance,
    elements.cameraAngle,
    elements.density,
    elements.flowMode,
    elements.quality,
    elements.diagnostic,
    elements.palette,
    elements.seed,
    ...$$("[data-layer]")
  ].forEach((control) => {
    control.addEventListener("input", updateSettingsFromControls);
    control.addEventListener("change", updateSettingsFromControls);
  });
  elements.quality.addEventListener("change", () => { qualityWasChosenByUser = true; });
  elements.randomizeSeed.addEventListener("click", () => {
    const randomSeed = window.crypto?.getRandomValues
      ? window.crypto.getRandomValues(new Uint32Array(1))[0] % 999999999 || 1
      : Math.floor(Math.random() * 999999998) + 1;
    elements.seed.value = String(randomSeed);
    updateSettingsFromControls();
    showToast(`New visual seed · ${randomSeed}`);
  });
  elements.panelToggle.addEventListener("click", () => setPanel(!panelOpen));
  elements.panelClose.addEventListener("click", () => setPanel(false));
  elements.floatingAction.addEventListener("click", () => {
    if (floatingActionMode === "replay") {
      restart(true);
    } else if (floatingActionMode === "resume") {
      if (state.time >= currentPreset().duration) state.time = 0;
      setPlaying(true);
    } else if (floatingActionMode === "detonate") {
      detonate();
    }
  });
  elements.interfaceButton.addEventListener("click", () => setInterfaceVisible(!document.body.classList.contains("interface-visible")));
  elements.png.addEventListener("click", downloadPng);
  elements.mp4.addEventListener("click", openExportDialog);
  elements.exportClose.addEventListener("click", () => {
    if (state.exporting) return;
    if (typeof elements.exportDialog.close === "function") elements.exportDialog.close();
    else {
      elements.exportDialog.removeAttribute("open");
      clearRecoveryUrl();
      resetExportDialog();
    }
  });
  elements.startExport.addEventListener("click", startVideoExport);
  elements.cancelExport.addEventListener("click", () => {
    updateExportProgress({ stage: "cancelling", percent: elements.exportProgressBar.value });
    exportController?.abort();
  });
  elements.exportRetry.addEventListener("click", () => {
    resetExportDialog();
    elements.startExport.focus({ preventScroll: true });
  });
  elements.exportForm.addEventListener("submit", (event) => event.preventDefault());
  elements.exportDialog.addEventListener("cancel", (event) => {
    if (!state.exporting) return;
    event.preventDefault();
    showToast("Cancel the active export before closing");
  });
  elements.exportDialog.addEventListener("close", () => {
    clearRecoveryUrl();
    resetExportDialog();
  });
  $$('[data-analytics="related_experiment_selected"]').forEach((link) => link.addEventListener("click", () => {
    analytics("related_experiment_selected", { destination: link.getAttribute("href") });
  }));
}

function bindCanvasInteraction() {
  // Camera gesture model: a plain tap/click never moves anything by default —
  // only an explicit "Place event" arm (setPlaceEventMode) lets a tap
  // reposition the origin, once. Ordinary drag orbits (horizontal delta ->
  // cameraAngle), two-finger pinch and ctrl/meta/shift+wheel zoom (distance).
  // A drag only begins once movement crosses a pointer-type-aware threshold,
  // so a tap can never be misread as a large camera change. Release velocity
  // feeds updateCameraAnimation() for a short inertial coast; pointercancel
  // never coasts, it just stops.
  elements.canvas.addEventListener("pointerdown", (event) => {
    // Capture failure (seen on some Safari/touch edge cases when a pointer
    // isn't recognized as active yet) must never abort gesture tracking —
    // fall through to plain event listening instead.
    try { elements.canvas.setPointerCapture?.(event.pointerId); } catch {}
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 1) {
      state.cameraAngleVelocity = 0;
      const now = performance.now();
      pointerGesture = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        startAngle: state.cameraAngle,
        startDistance: state.cameraDistance,
        sampleTime: now,
        sampleAngle: state.cameraAngle,
        velocitySample: 0,
        moved: false,
        multi: false
      };
      elements.canvas.classList.add("camera-dragging");
    } else if (activePointers.size === 2) {
      const points = [...activePointers.values()];
      pointerGesture = {
        pointerId: null,
        pointerType: event.pointerType,
        startX: 0,
        startY: 0,
        startAngle: state.cameraAngle,
        startDistance: state.cameraDistance,
        pinchStart: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        moved: true,
        multi: true
      };
    }
    updateCameraDebugOverlay("pointerdown");
  });

  elements.canvas.addEventListener("pointermove", (event) => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!pointerGesture) return;
    if (activePointers.size >= 2) {
      const points = [...activePointers.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (pointerGesture.pinchStart) {
        state.cameraDistanceTarget = clamp(
          pointerGesture.startDistance - (distance - pointerGesture.pinchStart) * 0.15,
          CAMERA_DISTANCE_RANGE[0],
          CAMERA_DISTANCE_RANGE[1]
        );
        pointerGesture.moved = true;
        scheduleRendererFrame();
      }
      updateCameraDebugOverlay("pinch");
      return;
    }
    const deltaX = event.clientX - pointerGesture.startX;
    const deltaY = event.clientY - pointerGesture.startY;
    const threshold = pointerGesture.pointerType === "touch" || pointerGesture.pointerType === "pen"
      ? CAMERA_DRAG_THRESHOLD_COARSE
      : CAMERA_DRAG_THRESHOLD_FINE;
    if (Math.hypot(deltaX, deltaY) > threshold) pointerGesture.moved = true;
    if (pointerGesture.moved) {
      const nextAngle = clamp(pointerGesture.startAngle + deltaX * 0.12, CAMERA_ANGLE_RANGE[0], CAMERA_ANGLE_RANGE[1]);
      state.cameraAngle = nextAngle;
      state.cameraAngleTarget = nextAngle;
      elements.cameraAngle.value = String(Math.round(nextAngle));
      updateControlOutputs();
      scheduleRendererFrame({ configure: true });
      // Rolling velocity sample (short window) so a released flick can coast
      // instead of stopping dead — but only after enough time has passed to
      // avoid a divide-by-near-zero on very close pointermove events.
      const now = performance.now();
      const elapsedMs = now - pointerGesture.sampleTime;
      if (elapsedMs > 8) {
        pointerGesture.velocitySample = (nextAngle - pointerGesture.sampleAngle) / (elapsedMs / 1000);
        pointerGesture.sampleTime = now;
        pointerGesture.sampleAngle = nextAngle;
      }
    }
    updateCameraDebugOverlay("drag");
  });

  const finishPointer = (event) => {
    const gesture = pointerGesture;
    const wasMultiPointer = activePointers.size > 1 || Boolean(gesture?.multi);
    const isTap = event.type === "pointerup"
      && event.button === 0
      && event.isPrimary
      && !wasMultiPointer
      && gesture?.pointerId === event.pointerId
      && !gesture.moved;
    const isDragRelease = event.type === "pointerup"
      && !wasMultiPointer
      && gesture?.pointerId === event.pointerId
      && gesture.moved;
    activePointers.delete(event.pointerId);
    if (isTap && placeEventMode) {
      const rect = elements.canvas.getBoundingClientRect();
      state.originX = clamp((event.clientX - rect.left) / rect.width, 0.12, 0.88);
      state.originY = clamp((event.clientY - rect.top) / rect.height, 0.4, 0.82);
      setRendererOrigin(state.originX, state.originY);
      renderLive(state.time);
      setPlaceEventMode(false);
      showToast("Event placed");
    } else if (isDragRelease) {
      state.cameraAngleVelocity = clamp(
        gesture.velocitySample || 0,
        -CAMERA_ANGLE_MAX_RELEASE_VELOCITY,
        CAMERA_ANGLE_MAX_RELEASE_VELOCITY
      );
    } else if (event.type === "pointercancel") {
      // Clean up without imparting motion — a cancelled gesture should never
      // cause the camera to keep moving on its own.
      state.cameraAngleVelocity = 0;
    }
    if (activePointers.size === 1) {
      const [remainingId, point] = activePointers.entries().next().value;
      pointerGesture = {
        pointerId: remainingId,
        pointerType: gesture?.pointerType,
        startX: point.x,
        startY: point.y,
        startAngle: state.cameraAngle,
        startDistance: state.cameraDistance,
        sampleTime: performance.now(),
        sampleAngle: state.cameraAngle,
        velocitySample: 0,
        moved: true,
        multi: wasMultiPointer
      };
    } else if (!activePointers.size) {
      pointerGesture = null;
      elements.canvas.classList.remove("camera-dragging");
    }
    updateCameraDebugOverlay(event.type);
  };
  elements.canvas.addEventListener("pointerup", finishPointer);
  elements.canvas.addEventListener("pointercancel", finishPointer);
  elements.canvas.addEventListener("wheel", (event) => {
    // Regular wheel gestures continue to the educational page. Trackpad pinch
    // (reported with ctrl/meta) and Shift+wheel control the simulation camera.
    if (!(event.ctrlKey || event.metaKey || event.shiftKey)) return;
    event.preventDefault();
    state.cameraDistanceTarget = clamp(
      state.cameraDistanceTarget + Math.sign(event.deltaY) * 4,
      CAMERA_DISTANCE_RANGE[0],
      CAMERA_DISTANCE_RANGE[1]
    );
    scheduleRendererFrame();
  }, { passive: false });
}

function bindKeyboard() {
  document.addEventListener("keydown", (event) => {
    // A real key press is the only reliable evidence a keyboard exists —
    // never inferred from device dimensions. Reveals the shortcut legend for
    // this session (used by hybrid/touch modes that hide it by default).
    if (!keyboardDetected && event.isTrusted) {
      keyboardDetected = true;
      document.body.classList.add("keyboard-detected");
    }
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    const interactive = target instanceof Element && Boolean(target.closest("button, a, summary, [role='button'], [contenteditable='true']"));
    if (editing || interactive || elements.exportDialog.open || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    if (event.code === "Space") {
      event.preventDefault();
      if (state.time >= currentPreset().duration) state.time = 0;
      setPlaying(!state.playing);
    } else if (event.key.toLowerCase() === "d") {
      detonate();
    } else if (event.key.toLowerCase() === "r") {
      restart(true);
    } else if (event.key.toLowerCase() === "h") {
      setInterfaceVisible(!document.body.classList.contains("interface-visible"));
    } else if (event.key.toLowerCase() === "v") {
      state.viewMode = state.viewMode === "cinematic" ? "overview" : "cinematic";
      replaceUrlParameter("mode", state.viewMode);
      const radio = $(`input[name="viewMode"][value="${state.viewMode}"]`);
      if (radio) radio.checked = true;
      elements.researchDiagnostics.hidden = !DEBUG_FLUID || !currentPreset().researchModel || state.viewMode !== "cinematic";
      configureRenderer();
      renderLive(state.time);
      analytics("view_mode_changed", { view_mode: state.viewMode });
    } else if (event.key.toLowerCase() === "p") {
      downloadPng();
    } else if (event.key.toLowerCase() === "e") {
      openExportDialog();
    } else if (event.key.toLowerCase() === "c") {
      resetCamera();
    } else if (event.key === "Escape" && placeEventMode) {
      setPlaceEventMode(false);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      state.time = clamp(state.time + direction * (event.shiftKey ? 1 : 0.2), 0, currentPreset().duration);
      setPlaying(false);
      updateTimelineUi();
      renderLive(state.time);
    }
  });
}

function bindResearchCanvasLifecycle() {
  if (!elements.researchCanvas?.addEventListener) return;
  elements.researchCanvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    scheduleRendererFrame();
  }, false);
  elements.researchCanvas.addEventListener("webglcontextrestored", () => {
    scheduleRendererFrame({ configure: true });
  }, false);
}

function initialize() {
  populateSelect(elements.preset, EVENT_PRESETS);
  populateSelect(elements.palette, PALETTES);
  populateSelect(elements.environment, ENVIRONMENTS);
  populateSelect(elements.timeOfDay, TIME_SETTINGS);
  elements.density.value = String(state.density);
  if (elements.flowMode) elements.flowMode.value = state.flowMode;
  elements.quality.value = state.quality;
  elements.seed.value = String(state.seed);
  elements.diagnostic.value = state.diagnostic;
  if (elements.debugFluidView) elements.debugFluidView.value = state.diagnostic;
  elements.windDirection.value = String(state.windDirection);
  elements.windStrength.value = String(state.windStrength);
  elements.cameraDistance.value = String(state.cameraDistance);
  elements.cameraAngle.value = String(state.cameraAngle);
  $$("input[name=\"viewMode\"]").forEach((input) => {
    input.checked = input.value === state.viewMode;
  });
  elements.exportFullDuration.textContent = compactDevice
    ? "Full event (up to 10 seconds)"
    : "Full event (up to 30 seconds)";

  applyInterfaceMode();
  let storedPanel = null;
  try { storedPanel = localStorage.getItem("explosion-lab-panel"); } catch {}
  const defaultPanelOpen = interfaceMode === "desktop-pointer";
  setPanel(COMPARE_RENDERERS ? false : (storedPanel ? storedPanel === "open" : defaultPanelOpen), false);
  try {
    if (sessionStorage.getItem("explosion-lab-intro") === "dismissed") dismissIntro();
  } catch {}
  if (DEVELOPER_RENDER_MODE) dismissIntro();

  bindControls();
  bindCanvasInteraction();
  bindKeyboard();
  bindResearchCanvasLifecycle();
  if (VISUAL_DEV) buildVisualDevPanel();
  applyPreset(INITIAL_PRESET_ID, {
    announce: false,
    track: false
  });
  resizeRenderers();
  renderLive(0);

  const capabilities = detectExportCapabilities();
  const nativeLabel = capabilities.nativeMp4MimeType
    ? `Native MP4 available (${capabilities.nativeMp4MimeType}).`
    : capabilities.webmMimeType
      ? "Native MP4 is unavailable; on-demand local FFmpeg conversion will be used."
      : "This browser does not expose a compatible video recorder; PNG export remains available.";
  elements.exportCapability.textContent = `${nativeLabel} Processing stays on this device.`;

  window.addEventListener("resize", () => {
    applyInterfaceMode();
    resizeRenderers();
    renderLive(state.time);
  }, { passive: true });
  // Recompute the interface mode when input capabilities or orientation
  // change mid-session (keyboard/trackpad attach, rotation, Split View);
  // simulation state is never reset by a mode change.
  [
    capabilityQueries.anyCoarse,
    capabilityQueries.anyFine,
    capabilityQueries.anyHover,
    capabilityQueries.portrait
  ].forEach((query) => query.addEventListener?.("change", applyInterfaceMode));
  // Mobile Safari resizes the visual viewport as browser chrome collapses or
  // the software keyboard appears; keep the canvas and layout in step.
  window.visualViewport?.addEventListener("resize", () => {
    applyInterfaceMode();
    resizeRenderers();
    renderLive(state.time);
  });
  compactQuery.addEventListener?.("change", (event) => {
    compactDevice = event.matches;
    if (!qualityWasChosenByUser) {
      state.quality = compactDevice ? "mobile" : "balanced";
      elements.quality.value = state.quality;
      configureRenderer();
    }
    resizeRenderers();
    renderLive(state.time);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pageWasPlaying = state.playing;
      setPlaying(false);
    } else {
      const shouldResume = pageWasPlaying && !state.exporting;
      pageWasPlaying = false;
      if (shouldResume) {
        setPlaying(true);
        lastFrame = performance.now();
      }
    }
  });
  window.addEventListener("pagehide", (event) => {
    exportController?.abort();
    clearRecoveryUrl();
    if (event.persisted) {
      pageWasPlaying = state.playing || pageWasPlaying;
      setPlaying(false);
      return;
    }
    window.cancelAnimationFrame(animationRequest);
    destroyRenderers();
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    resizeRenderers();
    renderLive(state.time);
    lastFrame = performance.now();
    const shouldResume = pageWasPlaying && !state.exporting;
    pageWasPlaying = false;
    if (shouldResume) setPlaying(true);
  });

  const setTestMode = (mode) => {
    state.viewMode = mode === "overview" ? "overview" : "cinematic";
    const radio = $(`input[name="viewMode"][value="${state.viewMode}"]`);
    if (radio) radio.checked = true;
    elements.researchDiagnostics.hidden = !DEBUG_FLUID || !currentPreset().researchModel || state.viewMode !== "cinematic";
    configureRenderer();
    renderLive(state.time);
    return state.viewMode;
  };

  window.__explosionLabTest = Object.freeze({
    interfaceMode: () => interfaceMode,
    presetIds: EVENT_PRESETS.map(({ id }) => id),
    getState: () => ({
      ...state,
      layers: { ...state.layers },
      placeEventMode,
      cameraResetCount,
      ...renderer.getStats?.()
    }),
    selectPreset: (id) => applyPreset(id, { announce: false, track: false }),
    detonate,
    pause: () => setPlaying(false),
    play: () => setPlaying(true),
    resetCamera: () => {
      resetCamera();
      return { distance: state.cameraDistanceTarget, angle: state.cameraAngleTarget };
    },
    setPlaceEventMode: (active) => {
      setPlaceEventMode(Boolean(active));
      return placeEventMode;
    },
    setCamera: (distance, angle) => {
      state.cameraDistance = clamp(Number(distance), CAMERA_DISTANCE_RANGE[0], CAMERA_DISTANCE_RANGE[1]);
      state.cameraDistanceTarget = state.cameraDistance;
      state.cameraAngle = clamp(Number(angle), CAMERA_ANGLE_RANGE[0], CAMERA_ANGLE_RANGE[1]);
      state.cameraAngleTarget = state.cameraAngle;
      state.cameraAngleVelocity = 0;
      elements.cameraDistance.value = String(state.cameraDistance);
      elements.cameraAngle.value = String(state.cameraAngle);
      updateControlOutputs();
      configureRenderer();
      renderLive(state.time);
      return { distance: state.cameraDistance, angle: state.cameraAngle };
    },
    setTime: (time) => {
      state.time = clamp(Number(time), 0, currentPreset().duration);
      setPlaying(false);
      updateTimelineUi();
      renderLive(state.time);
      return state.time;
    },
    renderFrame: () => renderLive(state.time),
    setMode: setTestMode,
    setViewMode: setTestMode,
    setQuality: (quality) => {
      if (!["mobile", "balanced", "high"].includes(quality)) throw new RangeError("Unsupported quality tier.");
      qualityWasChosenByUser = true;
      state.quality = quality;
      elements.quality.value = quality;
      configureRenderer();
      renderLive(state.time);
      return state.quality;
    },
    setWind: (direction, strength = state.windStrength) => {
      state.windDirection = ((Number(direction) % 360) + 360) % 360;
      state.windStrength = clamp(Number(strength), 0, 100);
      elements.windDirection.value = String(state.windDirection);
      elements.windStrength.value = String(state.windStrength);
      updateControlOutputs();
      configureRenderer();
      renderLive(state.time);
      return { direction: state.windDirection, strength: state.windStrength };
    },
    setPalette: (paletteId) => {
      if (!PALETTES.some(({ id }) => id === paletteId)) throw new RangeError("Unknown palette.");
      state.paletteId = paletteId;
      elements.palette.value = paletteId;
      configureRenderer();
      renderLive(state.time);
      return state.paletteId;
    },
    setSeed: (seed) => {
      state.seed = clamp(Math.trunc(Number(seed) || 1), 1, 999999999);
      elements.seed.value = String(state.seed);
      configureRenderer();
      renderLive(state.time);
      return state.seed;
    },
    setDiagnostic: (mode) => {
      elements.diagnostic.value = mode;
      state.diagnostic = elements.diagnostic.value;
      configureRenderer();
      return renderLive(state.time);
    },
    rendererStats: () => renderer.getStats?.(),
    exportStats: () => ({
      exporting: state.exporting,
      fluidSessionCount: renderer.getStats?.().fluidSessionCount ?? 0,
    }),
    releaseExportResources: () => renderer.releaseExportResources?.() ?? false,
    capabilities: () => detectExportCapabilities()
  });

  analytics("simulator_loaded", {
    preset: state.presetId,
    reduced_motion: reducedMotion,
    native_mp4: Boolean(capabilities.nativeMp4MimeType)
  });
  if (reducedMotion) showToast("Reduced motion detected · flashes and camera motion softened", 3200);
  animationRequest = window.requestAnimationFrame(animationFrame);
}

try {
  initialize();
} catch (error) {
  console.error("Explosion Dynamics Lab initialization failed:", error);
  elements.presetDescription.textContent = "The interactive renderer could not start. The educational guide below remains available.";
  showToast("Renderer unavailable · educational guide remains accessible", 5000);
}
