import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(projectRoot, relativePath), "utf8");

const [html, css, app] = await Promise.all([
  read("index.html"),
  read("assets/styles.css"),
  read("scripts/app.js"),
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
  /pointerGesture\.pointerType\s*===\s*"touch"\s*\|\|\s*pointerGesture\.pointerType\s*===\s*"pen"\s*\n\s*\?\s*CAMERA_DRAG_THRESHOLD_COARSE\s*\n\s*:\s*CAMERA_DRAG_THRESHOLD_FINE/,
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
assert.match(app, /CAMERA_ANGLE_RANGE\s*=\s*\[-35,\s*35\]/, "Bounded orbit angle range changed unexpectedly");
assert.match(app, /CAMERA_DISTANCE_RANGE\s*=\s*\[50,\s*150\]/, "Bounded zoom distance range changed unexpectedly");
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

// --- Reset Camera ------------------------------------------------------------
assert.match(app, /function resetCamera\(\)/, "Reset Camera function missing");
assert.match(app, /CAMERA_DEFAULT\s*=\s*Object\.freeze\(\{\s*distance:\s*100,\s*angle:\s*0,\s*originX:\s*0\.5,\s*originY:\s*0\.66\s*\}\)/, "Camera default changed unexpectedly");
assert.match(app, /resetCamera\.addEventListener\("click",\s*resetCamera\)|elements\.resetCamera\?\.addEventListener\("click",\s*resetCamera\)/, "Reset Camera button must be wired up");
assert.match(app, /event\.key\.toLowerCase\(\)\s*===\s*"c"\s*\)\s*\{\s*resetCamera\(\);/, "Reset Camera keyboard shortcut (C) missing");

// --- Camera state lifecycle: never reset by unrelated actions --------------
for (const fn of [
  /function applyPreset\(presetId[\s\S]*?\n\}/,
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
