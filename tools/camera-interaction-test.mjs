import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(projectRoot, relativePath), "utf8");

const [html, css, app, renderer] = await Promise.all([
  read("index.html"),
  read("assets/styles.css"),
  read("scripts/app.js"),
  read("scripts/renderer.js"),
]);

// --- Root-cause fix: a plain tap/click must never reposition the event -----
// unless the user has explicitly armed "Place event" mode first.
assert.doesNotMatch(
  app,
  /if\s*\(isTap\)\s*\{\s*const rect/,
  "A plain tap must not unconditionally reposition the event origin"
);
assert.match(
  app,
  /if\s*\(isTap\s*&&\s*placeEventMode\)\s*\{[\s\S]*?state\.originX\s*=[\s\S]*?setPlaceEventMode\(false\)/,
  "Tap-to-place must require explicit placeEventMode and disarm itself after one placement"
);
assert.match(app, /function setPlaceEventMode\(active\)/, "Explicit place-event mode function missing");
assert.match(app, /placeEventMode\s*=\s*Boolean\(active\)/, "Place-event mode must be an explicit boolean flag");

// --- Tap-vs-drag threshold, pointer-type aware -----------------------------
assert.match(app, /CAMERA_DRAG_THRESHOLD_FINE\s*=\s*6/, "Fine-pointer drag threshold changed unexpectedly");
assert.match(app, /CAMERA_DRAG_THRESHOLD_COARSE\s*=\s*10/, "Coarse-pointer drag threshold changed unexpectedly");
assert.match(
  app,
  /const isCoarsePointer\s*=\s*pointerGesture\.pointerType\s*===\s*"touch"\s*\|\|\s*pointerGesture\.pointerType\s*===\s*"pen";[\s\S]{0,80}CAMERA_DRAG_THRESHOLD_COARSE[\s\S]{0,20}CAMERA_DRAG_THRESHOLD_FINE/,
  "Drag threshold must widen for touch/pen pointers"
);
assert.match(
  app,
  /const isDragRelease\s*=\s*event\.type\s*===\s*"pointerup"[\s\S]*?&&\s*gesture\.moved;/,
  "A released drag must be distinguished from a tap"
);
assert.doesNotMatch(app, /addEventListener\("touchstart"/, "Interaction must stay unified on Pointer Events, not raw touch events");
assert.doesNotMatch(app, /addEventListener\("click",\s*\(event\)\s*=>\s*\{[\s\S]{0,40}canvas/i, "Canvas must not bind a raw click listener for camera/placement");

// --- Pointer capture, multi-touch, and cancel safety -----------------------
assert.match(app, /setPointerCapture\?\.\(event\.pointerId\)/, "Pointer capture must be used during drag");
assert.match(app, /try\s*\{\s*elements\.canvas\.setPointerCapture\?\.\(event\.pointerId\);\s*\}\s*catch/, "Pointer capture failure must not abort gesture tracking (Safari/touch edge cases)");
assert.match(app, /wasMultiPointer\s*=\s*activePointers\.size\s*>\s*1\s*\|\|\s*Boolean\(gesture\?\.multi\)/, "Multi-touch must never register as a tap");
assert.match(
  app,
  /event\.type\s*===\s*"pointercancel"\s*\)\s*\{[\s\S]*?state\.cameraAngleVelocity\s*=\s*0;/,
  "Pointer cancellation must clean up without imparting camera motion"
);

// --- Damping / inertia / bounded orbit -------------------------------------
assert.match(app, /function updateCameraAnimation\(delta\)/, "Frame-rate-independent camera easing function missing");
assert.match(app, /state\.exporting\)\s*return false;/, "Camera animation must freeze during export");
assert.match(app, /CAMERA_ANGLE_INERTIA_DECAY/, "Release-coast inertia decay missing");
assert.match(app, /CAMERA_ANGLE_MAX_RELEASE_VELOCITY/, "Release-coast velocity must be clamped");
assert.match(app, /CAMERA_ANGLE_RANGE\s*=\s*\[-50,\s*50\]/, "Bounded orbit angle range changed unexpectedly");
assert.match(
  app,
  /if\s*\(next\s*<=\s*CAMERA_ANGLE_RANGE\[0\]\s*\|\|\s*next\s*>=\s*CAMERA_ANGLE_RANGE\[1\]\)\s*\{[\s\S]*?state\.cameraAngleVelocity\s*=\s*0;/,
  "Orbit coast must stop dead at its bounds instead of bouncing past them"
);
assert.match(app, /const cameraAnimating\s*=\s*updateCameraAnimation\(delta\);/, "Camera easing must run every animation frame");
assert.match(
  app,
  /\(scheduledWork\.render\s*\|\|\s*cameraAnimating\)\s*&&\s*!state\.exporting/,
  "Camera coast must be able to render while playback is paused"
);

// --- Orbit/zoom sensitivity: viewport-normalized, named, not magic numbers -
assert.match(app, /CAMERA_ORBIT_DEGREES_PER_WIDTH_FINE\s*=\s*110/, "Fine-pointer orbit sensitivity changed unexpectedly");
assert.match(app, /CAMERA_ORBIT_DEGREES_PER_WIDTH_COARSE\s*=\s*130/, "Coarse-pointer orbit sensitivity changed unexpectedly");
assert.ok(
  130 > 110,
  "Coarse-pointer sensitivity must be stronger than fine-pointer sensitivity"
);
assert.match(
  app,
  /pointerGesture\.startAngle\s*\+\s*\(deltaX\s*\/\s*pointerGesture\.canvasWidth\)\s*\*\s*degreesPerWidth/,
  "Orbit sensitivity must be normalized to canvas width (fraction), not raw pixels"
);
assert.doesNotMatch(app, /startAngle\s*\+\s*deltaX\s*\*\s*0\.12/, "Old raw-pixel orbit mapping must be fully replaced");
assert.match(app, /CAMERA_PINCH_DISTANCE_SENSITIVITY\s*=\s*0\.3/, "Pinch zoom sensitivity changed unexpectedly");
assert.match(app, /CAMERA_WHEEL_DISTANCE_STEP\s*=\s*8/, "Wheel zoom sensitivity changed unexpectedly");

// --- Preset-aware zoom bounds: data-driven, not hard-coded in pointer code -
assert.match(app, /function cameraDistanceRangeForPreset\(preset\s*=\s*currentPreset\(\)\)/, "Zoom bounds must be resolved from the current preset, not hard-coded per gesture");
assert.match(
  app,
  /CAMERA_DISTANCE_RANGE_BY_FAMILY\s*=\s*Object\.freeze\(\{[\s\S]*?"nuclear-scale":\s*\[45,\s*220\][\s\S]*?\}\)/,
  "Nuclear-scale (including Tsar) must allow much wider pullback"
);
assert.doesNotMatch(
  app,
  /presetId\s*===\s*["']tsar-bomba-scale-reference["']/,
  "Zoom bounds must be resolved generically (by family), never hard-coded to the Tsar preset ID in pointer handlers"
);
const perGestureRangeLookups = app.match(/(?:const|let)\s+distanceRange\s*=\s*cameraDistanceRangeForPreset\(\)/g) || [];
assert.ok(
  perGestureRangeLookups.length >= 3,
  `Pinch, wheel, and setCamera should each resolve zoom bounds from the current preset (found ${perGestureRangeLookups.length})`
);
assert.match(app, /distanceLabel\(value,\s*range\s*=\s*cameraDistanceRangeForPreset\(\)\)/, "Near/Medium/Far label must be relative to the active family's range, not fixed absolute numbers");

// --- Renderer-side authoritative safety clamp must actually admit the wider
// app-level values (otherwise the app range is a no-op) -------------------
assert.match(renderer, /next\.cameraDistance\s*=\s*clamp\(next\.cameraDistance,\s*35,\s*220\)/, "Renderer's outer distance safety clamp must accommodate the widened family bounds");
assert.match(renderer, /next\.cameraAngle\s*=\s*clamp\(next\.cameraAngle,\s*-58,\s*58\)/, "Renderer's outer angle safety clamp must accommodate CAMERA_ANGLE_RANGE with headroom");
assert.match(
  renderer,
  /cameraScale\s*=\s*clamp\(1\.55\s*-\s*this\.settings\.cameraDistance\s*\/\s*180,\s*0\.40,\s*1\.35\)/,
  "Camera-scale floor must be lowered so distance 180-220 has real visual effect (divisor/180-reference unchanged so distance<=180 renders identically to before)"
);
assert.match(
  renderer,
  /const mobilePortrait = this\.settings\.quality === 'mobile' && height > width;[\s\S]*?this\._preset\?\.researchModel\?\.mobilePortraitPullback/,
  "Mobile portrait headroom must be profile-driven rather than a preset-ID renderer special case",
);
assert.match(
  await read("scripts/data.js"),
  /mobilePortraitPullback:\s*1\.1/,
  "Low-yield must reserve the audited mobile-portrait headroom",
);
assert.match(
  renderer,
  /angleOffset\s*=\s*\(this\.settings\.cameraAngle\s*\/\s*45\)\s*\*\s*width\s*\*\s*0\.056/,
  "Angle-to-parallax coefficient must be strengthened so drags produce visible perspective change"
);
assert.match(
  renderer,
  /this\.settings\.cameraAngle\s*\/\s*45\)\s*\*\s*height\s*\*\s*0\.04,\s*height\s*\*\s*0\.58,\s*height\s*\*\s*0\.88\)/,
  "Horizon-shift coefficient must scale with the angle change while staying inside its existing ground-plane clamp"
);
// --- Reset Camera ------------------------------------------------------------
assert.match(app, /function resetCamera\(\)/, "Reset Camera function missing");
assert.match(app, /CAMERA_DEFAULT\s*=\s*Object\.freeze\(\{\s*distance:\s*100,\s*angle:\s*0,\s*originX:\s*0\.5,\s*originY:\s*0\.66\s*\}\)/, "Camera default changed unexpectedly");
assert.match(app, /resetCamera\.addEventListener\("click",\s*resetCamera\)|elements\.resetCamera\?\.addEventListener\("click",\s*resetCamera\)/, "Reset Camera button must be wired up");
assert.match(app, /event\.key\.toLowerCase\(\)\s*===\s*"c"\s*\)\s*\{\s*resetCamera\(\);/, "Reset Camera keyboard shortcut (C) missing");

// --- Camera state lifecycle: never reset by unrelated actions --------------
// applyPreset is allowed to re-CLAMP distance into the new preset's family
// zoom bounds (state.cameraDistance = clamp(state.cameraDistance, ...)) —
// that preserves the user's camera as closely as the new event's scale
// allows. It must never assign a fixed default, and angle (universal range,
// no per-family clamping needed) must not be touched at all.
{
  const match = app.match(/function applyPreset\(presetId[\s\S]*?\n\}/);
  assert.ok(match, "Could not locate applyPreset for camera-preservation check");
  assert.doesNotMatch(match[0], /state\.cameraAngle\s*=/, "applyPreset must not touch camera angle");
  assert.doesNotMatch(match[0], /state\.cameraDistance\s*=\s*CAMERA_DEFAULT/, "applyPreset must not reset camera distance to a fixed default");
  assert.match(
    match[0],
    /state\.cameraDistance\s*=\s*clamp\(state\.cameraDistance,\s*distanceRange\[0\],\s*distanceRange\[1\]\)/,
    "applyPreset must only re-clamp the existing camera distance into the new family's bounds, not replace it"
  );
}
for (const fn of [
  /function restart\(play[\s\S]*?\n\}/,
  /function startDetonationSequence\(\)[\s\S]*?\n\}/,
]) {
  const match = app.match(fn);
  assert.ok(match, `Could not locate lifecycle function for camera-preservation check: ${fn}`);
  assert.doesNotMatch(match[0], /state\.cameraAngle\s*=/, `${fn} must not reset camera angle`);
  assert.doesNotMatch(match[0], /state\.cameraDistance\s*=/, `${fn} must not reset camera distance`);
}

// --- Export uses the live camera, never a silently different one -----------
assert.match(app, /renderer\.renderTo\(exportCanvas,\s*state\.time/, "PNG export must render the live camera/settings state");

// --- Developer diagnostics (?debugCamera=1) ---------------------------------
assert.match(app, /DEBUG_CAMERA\s*=\s*query\.get\("debugCamera"\)\s*===\s*"1"/, "debugCamera URL gate missing");
assert.match(app, /function updateCameraDebugOverlay\(/, "Camera debug overlay updater missing");
assert.match(html, /id="cameraDebugOverlay"[^>]*hidden/, "Camera debug overlay must be hidden by default");
for (const id of [
  "debugCameraInterfaceMode",
  "debugCameraPointerType",
  "debugCameraPointerCount",
  "debugCameraGesture",
  "debugCameraThreshold",
  "debugCameraAngle",
  "debugCameraAngleTarget",
  "debugCameraDistance",
  "debugCameraDistanceTarget",
  "debugCameraVelocity",
  "debugCameraTarget",
  "debugCameraPlaceMode",
  "debugCameraResetCount",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `Missing camera diagnostic #${id}`);
}

// --- Developer API for deterministic tests ----------------------------------
assert.match(app, /resetCamera:\s*\(\)\s*=>\s*\{/, "Test API must expose resetCamera");
assert.match(app, /setPlaceEventMode:\s*\(active\)\s*=>\s*\{/, "Test API must expose setPlaceEventMode");
assert.match(app, /setCamera:\s*\(distance,\s*angle\)\s*=>\s*\{/, "Test API must expose a deterministic setCamera");

// --- Controls markup ----------------------------------------------------------
assert.match(html, /id="resetCameraButton"/, "Reset camera control missing from Event Controls");
assert.match(html, /id="placeEventButton"[^>]*aria-pressed="false"/, "Place event toggle control missing or not a proper toggle");
assert.doesNotMatch(
  html,
  /Click or tap to reposition the event/,
  "Canvas accessibility instructions must not describe the old implicit click-to-recenter behavior"
);

// --- Cursor feedback and no global pinch-zoom disabling ---------------------
assert.match(css, /#simCanvas\s*\{[\s\S]*?cursor:\s*grab;/, "Canvas needs a grab cursor affordance");
assert.match(css, /#simCanvas\.camera-dragging\s*\{\s*cursor:\s*grabbing;/, "Dragging must show a grabbing cursor");
assert.match(css, /#simCanvas\.place-event-mode\s*\{\s*cursor:\s*crosshair;/, "Armed placement mode must show a distinct cursor");
assert.doesNotMatch(css, /touch-action:\s*none/, "Page-wide pinch zoom must not be disabled globally");
assert.match(css, /touch-action:\s*pan-y/, "Canvas must preserve native vertical page scroll");

console.log("Explosion Dynamics Lab camera interaction contract test: PASS");
console.log("  tap/click no longer implicitly repositions the event; Place event is explicit and single-shot");
console.log("  pointer-type-aware drag threshold, pointer capture, and multi-touch tap suppression verified");
console.log("  bounded, frame-rate-independent orbit easing with release-coast inertia and export freeze verified");
console.log("  Reset Camera (button + keyboard C) and camera state lifecycle preservation verified");
console.log("  ?debugCamera=1 developer overlay and deterministic test API verified");
