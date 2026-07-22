# Explosion Dynamics Lab

An interactive hybrid WebGL2 and Canvas experiment for observing stylized
fireballs, shock fronts, surface interaction, rising columns, cloud formation,
and atmospheric drift across twelve high-energy visual archetypes.

[Open the live Explosion Dynamics Lab](https://www.ericbarker.co/explosion-dynamics-lab/)

[![Explosion Dynamics Lab showing an abstract fireball, shock front, and rising cloud](explosion-dynamics-lab-social.png)](https://www.ericbarker.co/explosion-dynamics-lab/)

## Highlights

- Twelve materially different conventional, industrial, cosmic, geologic,
  fictional, and approximate nuclear-scale timelines
- Cinematic profile and abstract effects-overview views
- Deterministic seeded scenes that can be paused, scrubbed, replayed, and
  rendered at a fixed export timestep
- Event-family GPU profiles for every Cinematic preset, driven by normalized
  velocity, temperature, smoke, incandescent, and dust fields; the improved
  **Nuclear Airburst — Research Model** remains its own preserved profile
- WebGL2 semi-Lagrangian advection, buoyancy, pressure projection, wind,
  cooling, vorticity confinement, 2.5D volume reconstruction, and GPU tracer
  particles, with the established Canvas renderer as a graceful fallback
- Fixed typed-array particle pools, adaptive detail, and a capped device pixel
  ratio for predictable browser memory use
- Pointer, touch, wheel, pinch, and keyboard interaction; responsive controls;
  page-visibility pausing; and reduced-motion treatment
- Local PNG export plus genuine MP4 export through a validated native route or
  an optional, lazy, same-origin FFmpeg WebAssembly fallback
- Semantic educational content, production metadata, and a visible safety
  disclaimer even when the renderer cannot start

## Educational scope and safety boundary

> Educational visualization only. All effects, distances, timings, and scales
> are simplified approximations and must not be used for safety, engineering,
> emergency planning, targeting, or real-world predictions.

This is a creative-coding visualization, not a weapon-design tool, blast
calculator, casualty estimator, professional engineering model, emergency
planning system, or military simulation. It deliberately provides no:

- explosive materials, mixtures, quantities, ratios, construction methods,
  detonators, triggers, weapon components, or nuclear-design information;
- address or coordinate search, maps, real targets, population or
  infrastructure overlays, casualty estimates, or delivery guidance;
- optimized parameter combinations, burst-height recommendations,
  building-level damage estimates, concealment advice, or claims of scientific,
  engineering, safety, or military accuracy.

All environments are fictional, generic, or abstract. The controls are rounded,
dimensionless display inputs. They do not expose real yield, pressure, thermal,
distance, damage, or hazard units.

## Presets

Each preset has its own duration, phase schedule, visual energy index, burst
geometry, particle budget, surface response, lighting, turbulence, wind
response, and camera treatment. They are behavioral presets, not color swaps.

| Preset | Visual behavior | Timeline |
| --- | --- | ---: |
| Compact Conventional Blast | Sharp onset, fast pressure ring, localized debris-led fade | 7.2 s |
| Large Conventional Blast | Broader fireball and shock front with heavier rising dust | 11.8 s |
| Industrial Fireball | Slow rolling flame, layered smoke, and drifting embers | 18.5 s |
| Fuel-Air-Style Visual Archetype | Broad diffuse pulse and slower atmospheric pressure front; no composition or construction details | 14.6 s |
| Underground Detonation | Muted onset, stylized ground heave, radial ejecta, and dense dust column | 15.4 s |
| Meteor Airburst | Elevated streak and flash, layered shock rings, and high-cloud drift without a crater | 20.8 s |
| Meteor Ground Impact | Fictional impact with ejecta curtain, dust front, and towering plume | 27.2 s |
| Volcanic Eruption | Sustained incandescent fragments, turbulent ash-like column, and spreading cloud | 34.0 s |
| Fictional Plasma Burst | Explicitly imaginary electric sphere, branching motion, implosion, and cool afterglow | 10.2 s |
| Nuclear Airburst — Research Model | Approximate elevated flash and shock followed by a field-driven fireball, rising column, rolling cap, cooling smoke, and wind deformation | 29.5 s |
| Nuclear Ground Burst | Approximate nuclear-scale surface event with denser dust and wind-driven particulate | 37.0 s |
| Extreme Historical-Scale Nuclear Visualization | Temporally compressed, abstract visualization of the upper historical atmospheric-test scale | 47.5 s |

The nuclear-scale entries use broad public visual archetypes only. They contain
no weapon-design, targeting, casualty, or operational information. The
fuel-air-style entry is likewise only a visual archetype and contains no
substance, ratio, ignition, or construction guidance.

## Use the lab

1. Choose a preset and press **Detonate**.
2. Pause or play the sequence, change its speed, or scrub the phase timeline.
3. Compare **Cinematic** and **Effects overview** views.
4. Adjust the abstract scene and render controls, or enter a seed to create a
   repeatable visual variation.
5. Download the current composition as a PNG or open **Export MP4** for a fixed-
   timestep video render.

### Views

- **Cinematic profile** is a side-on 2.5D scene showing the event against a
  fictional horizon. It emphasizes the fireball, reflected light, shock front,
  dust and debris, column rise, cloud development, drift, distortion, and
  restrained camera response.
- **Effects overview** is an abstract top-down instrument display. It separates
  normalized luminous, thermal, stronger-wave, lighter-wave, and particulate
  extents. Its rings are qualitative: there is no map, location, target,
  population, casualty, or damage layer.

### Controls and interaction

- **Timeline:** Detonate, Play/Pause, Restart, Replay, direct scrubbing, phase
  labels, and 0.25×, 0.5×, 1×, or 2× playback.
- **Event geometry:** preset-specific relative visual-energy range, air/surface/
  underground/atmospheric geometry, and qualitative altitude.
- **Atmosphere:** wind direction and strength, six generic environments, and
  five lighting/time treatments.
- **Camera and render:** camera distance and angle, 35–140% secondary-detail
  density, Mobile/Balanced/High quality, seven palettes, a numeric seed, and
  seed randomization.
- **Developer-only research diagnostics:** open `?debugFluid=1` to inspect the
  selected preset's live velocity, temperature, smoke,
  incandescent, pressure, divergence, vorticity, or GPU tracer fields together
  with solver telemetry. Normal visits never show this panel. These are
  normalized visual fields rather than real-world measurements.
- **Renderer comparison:** open `?compareRenderers=1` for a fixed-timestep,
  same-seed split screen with the original procedural model on the left and the
  research fluid model on the right. This mode is hidden on normal visits.
- **Layers:** initial flash, fireball, shock front, thermal glow, surface dust,
  cloud column, debris/ejecta, and reference grid.
- **Canvas:** click or tap to move the abstract origin; drag to change camera
  angle; use a two-finger pinch or Shift+wheel to change camera distance.
- **Interface:** controls collapse on compact screens, and the whole interface
  can be hidden for an unobstructed composition.

Keyboard shortcuts work when focus is not inside a form control:

| Key | Action |
| --- | --- |
| `D` | Detonate |
| `Space` | Play or pause |
| `R` | Restart and replay |
| `V` | Switch view |
| `H` | Hide or restore the interface |
| `P` | Download PNG |
| `E` | Open MP4 export |
| `Left` / `Right` | Scrub 0.2 seconds; hold Shift for 1 second |

A 650 ms cooldown prevents accidental rapid re-triggering.

## Rendering architecture

The project uses native ES modules and has no compilation step:

- `data.js` owns immutable presets, phase timelines, palettes, generic
  environments, easing functions, seeded random utilities, and display scaling.
- `renderer.js` remains the public compositor and evaluates the complete scene
  from `(seed, settings, time)`. It supplies the environment, analytical early
  flash/shock phase, export composition, bounded legacy detail, and fallback.
- `fluid-engine.js` owns the shared fixed-timestep WebGL2 solver and immutable
  per-preset source/render profiles. Ping-pong
  floating-point textures store projected velocity and scalar channels for
  temperature, smoke, incandescence, and dust. GPU particles sample the
  projected field as detail tracers and never drive the main silhouette.
- `app.js` owns UI state, accessibility behavior, input, the live
  `requestAnimationFrame` loop, visibility pausing, analytics hooks, and export
  orchestration.
- `exporter.js` requests frames at exact `1 / fps` timestamps, records them,
  validates the result, and restores the live playhead and play state.

The Canvas timeline is sampled from elapsed time. The research solver advances
only in deterministic `1 / 30 s` fixed steps and resets before a backward seek. Live,
scrubbed, PNG, and MP4 frames all use that solver and the same visible seed; the
offscreen export context is reused rather than replaced with a simplified
animation. Adaptive quality, viewport size, GPU precision, browser
rasterization, and codec behavior can change fine detail or file bytes, so
determinism is visual rather than a promise of cross-device bit identity.

### Research fluid method

Every Cinematic preset uses the shared safe 2.5D field pipeline, but each has a
distinct event-family profile. Profiles combine deterministic normalized source
primitives such as radial and directional impulses, ground sheets, vertical
jets, offset kernels, pulsed columns, ejecta curtains, elongated trails,
sustained visual-combustion regions, and turbulent clusters. The preserved
Research Airburst keeps its original paired cap-vortex configuration as a named
regression profile; that configuration is not applied to other events.

The volume shader reconstructs multiple depth slices, then applies a
lower-frequency seeded curl perturbation with velocity amplitudes proportional
to `k^(-5/6)`—the square-root counterpart of a `k^(-5/3)` energy spectrum—to
keep silhouettes asymmetric. Palette colors, opacity, shadows, erosion, detail
scale, bloom, distortion, exposure, and volume depth are GPU inputs rather than
Canvas-only decoration.

Each fixed step performs:

```text
q(x, t + dt) = q(x - u(x, t) dt, t)          semi-Lagrangian advection
u* = advect(u) + dt (buoyancy + wind + curl) applied forces
laplacian(p) = divergence(u*)                Jacobi pressure solve
u(t + dt) = u* - gradient(p)                 incompressible projection
alpha = 1 - exp(-density * stepLength)       volume opacity
```

Incandescent density cools and converts into smoke; temperature supplies
buoyancy and an artistic blackbody-style color ramp. The ray marcher adds
radial reconstruction, multiscale density detail, exponential opacity,
internal emission, approximate self-shadowing/scattering, restrained bloom,
heat distortion, and tone mapping. See [`RESEARCH-NOTES.md`](RESEARCH-NOTES.md)
for the paper-by-paper section/equation mapping and explicit exclusions.

The base adaptive tiers are intentionally bounded. Each event profile applies
bounded multipliers so short compact events do not pay the same cost as long,
particulate-heavy or extreme-scale scenes:

| Tier | Long grid side | 3D curl detail | Pressure iterations | Ray steps | GPU tracers |
| --- | ---: | ---: | ---: | ---: | ---: |
| Mobile | 112 | 16³ | 8 | 16 | 256 |
| Balanced | 176 | 24³ | 13 | 26 | 512 |
| High | 256 | 32³ | 19 | 38 | 1,024 |

### Normalized cube-root visual approximation

The broad scene scale uses a dimensionless cube-root curve to keep the twelve
very different display indices legible in one viewport. For display energy
`E = preset.relativeVisualEnergy × visualEnergyMultiplier`, the normalized term
is:

```text
n = clamp((cuberoot(E) - cuberoot(0.5)) /
          (cuberoot(900) - cuberoot(0.5)), 0, 1)
```

The base radius is then interpolated from 3.5% to 15.5% of the shorter viewport
dimension. Preset coefficients derive the visible fireball, shock, cloud, and
surface radii from that base. These values are pixels and normalized art-
direction relationships only. The curve is not calibrated to a real yield,
pressure, distance, thermal flux, damage radius, or safety boundary. The
flagship solves a small normalized incompressible visual field, but it is not
validated engineering CFD or a real-world predictive model.

## Run and test locally

Because the app uses ES modules, preview it through HTTP rather than opening
`index.html` as a `file:` URL.

Clone the public repository and start a local HTTP server:

```sh
git clone https://github.com/designdelulu/explosion-dynamics-lab.git
cd explosion-dynamics-lab
python3 -m http.server 4173
```

Visit `http://localhost:4173/`.

Run the dependency-free syntax and regression suite in another terminal:

```sh
./scripts/deploy-production.sh test
```

The suite checks all 12 preset contracts, safety scope, distinct phase
fingerprints, bounded detail budgets, deterministic random/noise helpers,
seven-family fluid-profile, source-primitive, palette-uniform, adaptive-budget,
GPU-tracer, and fixed-step numerical contracts; all-preset fail-closed exports;
developer URL gating and split-renderer synchronization; timeline
math, the normalized cube-root display curve, MP4 container rejection,
capability detection, metadata/structured-data invariants, social-image
dimensions, content-addressed release construction, manifest hashes, and the
one-way deployment guardrails.

For an interactive browser pass, trigger all presets; play, pause, restart,
replay, and scrub; repeat one seed; switch views and layers; move and zoom the
canvas; hide/restore the UI; export PNG; and inspect the console after repeated
detonations and preset changes. Also check a desktop viewport around 1440×900,
a mobile viewport around 390×844, and an emulated
`prefers-reduced-motion: reduce` session.

## PNG export

**Download PNG** renders the current timeline frame into a separate canvas. The
optional compact interface label can be included or hidden. A subtle Eric Barker
watermark is included, and the safe filename contains the preset slug and seed.
The operation stays in the browser and does not upload the image.

## Genuine MP4 export

The video dialog offers:

- 5, 10, or 15 seconds, or the preset's full timeline within the device cap;
- 1280×720 or 1920×1080;
- 24 or 30 FPS;
- restart-from-zero or start-at-current-playhead;
- interface label and Eric Barker attribution toggles; and
- automatic, native-only, or forced-FFmpeg routing.

The default is 10 seconds at 1280×720 and 30 FPS, restarting the event with the
interface hidden and attribution visible. Video is currently silent. Desktop
exports are capped at 30 seconds. Compact/touch devices default to 5 seconds at
720p and are capped at 10 seconds, so **Full event timeline** is intentionally
truncated for longer presets on those devices (and after 30 seconds on desktop).

Only one export can run at a time. Cancellation is supported, and success or
failure restores the original timeline position and play state.

### Route 1: native, detected and validated

The exporter requires `canvas.captureStream()` and `MediaRecorder`, then asks
`MediaRecorder.isTypeSupported()` about these candidates in order:

```text
video/mp4;codecs=avc1.42E01E
video/mp4;codecs=avc1.4D401F
video/mp4;codecs=avc1.640028
video/mp4
```

It uses only a MIME type reported by that browser. A `.mp4` name is not enough:
the completed Blob must contain a valid ISO Base Media File Format `ftyp` box
with an MP4-compatible brand, then load as video metadata with positive duration
and the expected dimensions. Failed candidates are rejected. A WebM Blob is
never renamed to `.mp4`.

### Route 2: lazy same-origin FFmpeg WebAssembly fallback

If native MP4 is unavailable—or **Force local FFmpeg fallback** is selected—the
browser first records a supported WebM intermediate. Only after that explicit
MP4 request does `exporter.js` dynamically import the local wrapper and load its
matching core and WebAssembly binary:

```text
vendor/ffmpeg/ffmpeg/index.js
vendor/ffmpeg/core/ffmpeg-core.js
vendor/ffmpeg/core/ffmpeg-core.wasm
```

The URLs are resolved relative to the same-origin exporter module; cross-origin
encoder URLs are rejected. The fallback first attempts H.264 with `yuv420p` and
fast-start metadata, then a compatible MPEG-4 Visual encode if the selected
local core lacks H.264. The resulting MP4 receives the same container and
playback-metadata validation as native output. Virtual input/output files are
deleted and the worker is terminated after success, cancellation, or failure.

No frame, video, seed, or simulator setting is sent to a conversion service. If
both routes fail after a WebM intermediate exists, the dialog offers that
original data as a correctly labeled `.webm` recovery download.

The repository vendors `@ffmpeg/ffmpeg` 0.12.15 and the single-thread ESM
`@ffmpeg/core` 0.12.10 at those paths. Their package manifests and license files
are retained as described in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). The wrapper is declared MIT;
the core is declared GPL-2.0-or-later. Those terms govern the respective vendor
files, which are excluded from this project's first-party MIT license. FFmpeg
and every statically linked upstream library are recorded in
[`vendor/ffmpeg/core/UPSTREAM_COMPONENTS.md`](vendor/ffmpeg/core/UPSTREAM_COMPONENTS.md).
The exact upstream copyright/license/disclaimer files are retained in its
`licenses/` directory and deployed with the binary.
FFmpeg is deliberately not loaded by the main page or by unrelated pages on
ericbarker.co.

### Test the native MP4 route

1. Start the local server above and open `http://localhost:4173/` in a browser
   that reports native MP4 recording support.
2. In DevTools Network, filter for `ffmpeg` and confirm no wrapper, core, or WASM
   request occurs at startup.
3. Open **Export MP4** and choose **5 seconds**, **1280 × 720**, **24 FPS**, and
   **Native MP4 only**. Start the export and play the downloaded file.
4. Repeat at **10 seconds**, **1280 × 720**, and **30 FPS**. Run a second export
   without reloading, and test cancellation separately.
5. Inspect a downloaded file with `ffprobe` (substitute its actual path):

```sh
ffprobe -v error \
  -show_entries format=format_name,duration \
  -show_entries stream=codec_name,width,height,r_frame_rate \
  -of default=noprint_wrappers=1 \
  /path/to/explosion-dynamics-compact-blast-seed-1842.mp4
```

`format_name` must include `mp4`, dimensions must match the selection, duration
must be close to the request, and the file must play. If **Native MP4 only**
shows the native-unavailable message, that browser cannot exercise this route;
do not record it as a passing native test.

### Test the FFmpeg fallback

1. Confirm the retained manifests report `@ffmpeg/ffmpeg` 0.12.15 and
   `@ffmpeg/core` 0.12.10, and that their local MIT and GPL license files remain
   beside the vendored code.
2. Start the same local server. Confirm the WASM response succeeds and is served
   as `application/wasm`:

```sh
curl -I http://localhost:4173/vendor/ffmpeg/core/ffmpeg-core.wasm
```

3. Reload with DevTools Network open. Confirm no `vendor/ffmpeg/` request occurs
   before an export is requested.
4. Select **Force local FFmpeg fallback**, **5 seconds**, **1280 × 720**, and
   **24 FPS**, then start the export. Confirm the wrapper, core, and WASM requests
   are same-origin and begin only now.
5. Play the `.mp4` and run the `ffprobe` command above. Repeat at 10 seconds and
   30 FPS, cancel one conversion, then run another export without reloading.
6. Temporarily test with the vendor path unavailable. Confirm the UI reports a
   friendly MP4 failure, offers a `.webm` recovery when an intermediate was
   completed, and leaves PNG and subsequent export attempts usable.

The deliberate missing-vendor check in step 6 is a failure-recovery test, not
the normal repository state. The FFmpeg success path has not been tested until
steps 1–5 complete with a genuine, playable MP4.

## Browser, mobile, accessibility, and privacy

The hybrid simulation targets current desktop Chrome, Edge, Firefox, and Safari
and recent mobile Safari/Chromium browsers. WebGL2 plus renderable floating- or
half-float framebuffers enables the family fluid fields; unsupported or lost
contexts fail closed to the existing Canvas visualization. Pointer Events
provide mouse, pen, and touch parity; mobile controls collapse without requiring
hover. The live renderer caps device pixel ratio, selects Mobile quality on a
compact first visit, and bounds every framebuffer and tracer pool.

Native MP4 support is a separate capability and varies by browser, operating
system, and codec build. The app detects it at runtime rather than inferring it
from a browser name. The WebM intermediate route likewise requires
`captureStream`, `MediaRecorder`, WebAssembly, Workers, Blob URLs, and a supported
WebM recorder MIME type.

The page includes a photosensitivity notice. With
`prefers-reduced-motion: reduce`, it softens and caps the flash, removes camera
shake, lowers distortion/motion intensity, and uses a lower render-density/DPR
ceiling while preserving the timeline and educational views. Keyboard focus,
visible focus styles, large touch targets, ARIA labels, live status messages,
and semantic explanatory HTML remain available.

Simulation and export pixels are processed locally. The production page can
send the documented coarse interaction events to the site's existing Google
Analytics configuration when `gtag` is available; it does not send frames,
videos, real locations, personal data, or target information.

## Current known limitations

- The vendored FFmpeg route is a comparatively large, memory-intensive download
  that begins only on demand. It depends on WebAssembly and Worker support; if
  it cannot load or encode, the app preserves a correctly labeled WebM recovery
  when recording reached that stage.
- Native MP4 recording support is inconsistent. A browser may expose
  `MediaRecorder` but no MP4 MIME type, or may claim a type and still produce a
  Blob that fails strict container/playback validation.
- 1080p and longer WebAssembly conversions can exceed memory or thermal limits
  on phones. Use 5 seconds at 720p, lower detail density, or a desktop browser.
- Video export is silent; there is no audio engine or audio-capture path.
- A cancelled export may have no recovery download if recording did not finish.
- Tier changes alter grid, pressure, ray-march, and tracer resolution, so the
  same seed is deterministic within a tier but does not promise identical fine
  structure across tiers, GPUs, or floating-point implementations.
- Backward seeks reset and replay fixed solver steps. Very late scrubs and
  restart-from-zero exports therefore cost more than nearby forward playback.
- The vertical field plus radial reconstruction is a 2.5D compromise: it cannot
  reproduce every fully 3D vortex interaction or viewpoint-dependent volume.
- The research solver is designed for broad atmospheric behavior, not calibrated
  measurements, professional prediction, or physically exact cloud evolution.

## Project structure

```text
explosion-dynamics-lab/
├── .github/                         # issue and pull-request templates
├── .gitignore
├── .htaccess
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── RESEARCH-NOTES.md                 # paper concepts, equations, safe mappings
├── SECURITY.md
├── THIRD_PARTY_NOTICES.md
├── index.html
├── explosion-dynamics-lab-social.png  # required 1200 × 630 production card
├── assets/
│   └── styles.css
├── scripts/
│   ├── app.js
│   ├── build-info.js                 # development identity; generated in releases
│   ├── data.js
│   ├── deploy-production.sh          # sole one-way deployment entry point
│   ├── exporter.js
│   ├── fluid-engine.js               # deterministic WebGL2 2.5D field solver
│   └── renderer.js
├── research/
│   └── README.md                     # local paper archive policy; never deployed
├── tools/
│   ├── build-production.mjs          # content-addressed production builder
│   ├── compare-local-copies.mjs      # reconciliation evidence generator
│   ├── developer-mode-contract-test.mjs
│   ├── release-files.mjs             # exact production allowlist/exclusions
│   ├── release-contract-test.mjs      # source/deployment boundary checks
│   ├── smoke-test.mjs                 # data and deterministic-model checks
│   ├── fluid-contract-test.mjs         # numerical/shader/tier contract checks
│   ├── exporter-smoke-test.mjs        # MP4 signature/capability checks
│   ├── static-audit.mjs               # HTML, metadata, JSON-LD, image checks
│   ├── verify-prepared-release.mjs     # current-source and upload-root guard
│   └── verify-production.mjs          # live HTTPS hash/header verifier
└── vendor/                            # lazy same-origin FFmpeg bundle
    └── ffmpeg/
        ├── ffmpeg/                    # @ffmpeg/ffmpeg 0.12.15 + MIT license
        └── core/                      # @ffmpeg/core, GPL + upstream notices
```

`README.md`, `RESEARCH-NOTES.md`, `research/`, `tools/`,
`.git/`, and local export/test artifacts are development material and are not
selected by the production builder. `THIRD_PARTY_NOTICES.md`, the vendor
component ledger, and all required upstream license files are explicit
production allowlist entries.

## Analytics events

The app calls the existing `window.gtag` only when it is available. Event names
are:

- `simulator_loaded`
- `detonation_triggered`
- `preset_selected`
- `view_mode_changed`
- `png_exported`
- `mp4_export_started`
- `mp4_export_completed`
- `mp4_export_failed`
- `related_experiment_selected`

Parameters are limited to coarse simulator state such as preset ID, view, export
route, resolution, duration, frame rate, MIME type, and reduced-motion/native-
capability flags. Export content and personal or geographic information are not
collected.

## Production deployment

> The public `explosion-dynamics-lab` repository is the authoritative source.
> Deploy generated artifacts only; do not maintain a second editable website
> copy.

The live server contains a deployment artifact under the domain's configured
web directory at the logical subdirectory `explosion-dynamics-lab/`. It is not
a development checkout and must never be downloaded or synchronized back into
the repository. Production currently runs at the canonical URL linked at the
top of this file.

### Build the reviewed SFTP package

Hosting credentials and physical server paths are never stored in this
repository. Build a reviewed upload package with:

```sh
./scripts/deploy-production.sh package
```

That command runs the complete dependency-free test suite, builds only the
explicit production allowlist, creates `deployment-manifest.json`, and writes a
disposable package under `dist/`. Upload the contents of the generated
`dist/production/explosion-dynamics-lab/` directory with SFTP/FileZilla or the
DreamHost file manager to the panel-confirmed domain web directory's
`explosion-dynamics-lab/` subdirectory. Use binary transfer. Upload
`vendor-releases/` and `releases/` first, `.htaccess` and
`deployment-manifest.json` next, and `index.html` last.

**Contents only is a hard deployment boundary.** The live lab directory must
receive `.htaccess`, `LICENSE`, `THIRD_PARTY_NOTICES.md`,
`deployment-manifest.json`, the social image, `index.html`, `releases/`, and
`vendor-releases/` directly. Never upload the standalone project root,
`dist/`, `dist/production/`, or an outer `explosion-dynamics-lab/` wrapper into
the live `explosion-dynamics-lab/` directory. The generated archive likewise
contains staged contents rather than that wrapper directory.

The package excludes `.git/`, `.gitignore`, docs, research PDFs and notes,
tests, tools, dependencies, editor/OS metadata, screenshots, browser artifacts,
recordings, PNG/MP4/WebM exports, caches, and temporary files. It explicitly
retains every required runtime module, inline WebGL shader module, CSS, social
image, legal notice, and local FFmpeg wrapper/core/WASM asset.

### Content-addressed caching and build identity

Production HTML references immutable paths shaped like:

```text
releases/<release-id>/scripts/app.js
releases/<release-id>/scripts/fluid-engine.js
vendor-releases/<vendor-id>/ffmpeg/core/ffmpeg-core.wasm
```

The release and vendor IDs are hashes generated from the allowlisted inputs.
`index.html` revalidates, `deployment-manifest.json` uses `no-store`, and hashed
runtime paths use a one-year immutable cache. The page does not register a
service worker. Root `assets/` and `scripts/` files from the old deployment are
listed as obsolete in the manifest and may be removed only after the new index
and release verify live.

Open the production diagnostic URL after upload:

<https://www.ericbarker.co/explosion-dynamics-lab/?debugFluid=1>

Its overlay reports the standalone source identity, Git commit when available,
deployment timestamp, renderer version, release/asset version, manifest hash,
and live GPU-fluid state. The same identity is logged to the console only in
developer modes. Normal production visits do not show the overlay or fetch a
diagnostic manifest.

### Verify production

After switching `index.html`, first verify the active release without treating
known cleanup work as a hash failure:

```sh
./scripts/deploy-production.sh verify-active
```

Then remove obsolete root `assets/` and `scripts/`, exposed development files,
the accidentally published `dist/` tree/package, and the other exact paths in
`deployment-manifest.json#remotePathsRequiredAbsent`. Do not remove the active
top-level `releases/` or `vendor-releases/`. Finish with the strict gate:

```sh
./scripts/deploy-production.sh verify
```

The verifier adds a unique cache-bypass query, fetches the local manifest's
exact expected files over HTTPS, compares byte lengths and SHA-256 hashes,
checks JavaScript/WASM MIME types, checks revalidation/immutable headers,
rejects the obsolete `?v=2` graph, and confirms that no service worker is
present. Strict verification also requires every obsolete, development-only,
and known wrong-root path to return 404, proving that old cached assets and the
nested `dist/production/explosion-dynamics-lab/` copy are no longer served. It
writes a successful remote receipt under `dist/production/`. Missing files, a
custom HTML 404, stale assets, an exposed cleanup path, or any hash mismatch
fail the command.

If DreamHost later enables Shell/SSH access and the assigned user, host, and
absolute Web directory have been confirmed, the same script offers a guarded
one-way `rsync` mode. It always performs a dry run first and requires the exact
prepared release ID in `EDL_RSYNC_CONFIRM`; the confirmation run verifies that
the staged source digest is still current instead of generating a new release.
It uploads the immutable assets before
switching `index.html`, verifies live, and only then removes obsolete remote
files. Never set `EDL_RSYNC_TARGET` from a guessed directory.

### Recovery

If local and production versions differ, do not copy the server files back.
Rebuild from the standalone source, confirm the manifest and DreamHost Web
directory, upload the package again with `index.html` last, then rerun the HTTPS
verifier. A previous content-addressed release can serve as a rollback until a
new release has passed verification. The canonical URL remains:

<https://www.ericbarker.co/explosion-dynamics-lab/>

## Contributing and security

Contributions are welcome when they preserve the educational scope,
deterministic rendering, accessibility, export integrity, and safety
restrictions. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull
request and follow the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Report
security issues privately as described in [`SECURITY.md`](SECURITY.md), not in
a public issue.

## License and credit

Built by [Eric Barker](https://www.ericbarker.co/).

The first-party implementation is available under the [MIT License](LICENSE),
copyright © 2026 Eric Barker. That license excludes `vendor/`. The vendored
`@ffmpeg/ffmpeg` 0.12.15 wrapper is declared MIT, while the vendored
`@ffmpeg/core` 0.12.10 is declared GPL-2.0-or-later. Their retained manifests,
license files, and corresponding-source information govern those artifacts;
see [Third-party notices](THIRD_PARTY_NOTICES.md).
