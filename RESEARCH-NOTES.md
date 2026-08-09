# Explosion Dynamics Lab — Research Notes

## Scope and provenance

These notes cover only post-detonation atmospheric visualization: shock optics, hot-gas motion, smoke, dust, turbulence, participating-media rendering, and real-time numerical methods. They do **not** adapt or expose explosive materials, construction, charge geometry, triggering, weapon design, object destruction, targeting, casualty modeling, real-world damage calculations, or optimization. All application controls remain normalized visual controls.

The exact papers were read from author/publisher copies. Local reference copies now live under `research/papers/` (git-ignored, third-party copyrighted, excluded from the production allowlist — the URLs below are the durable pointer):

- Gary D. Yngve, James F. O'Brien, and Jessica K. Hodgins, *Animating Explosions* (SIGGRAPH 2000 author preprint): <https://arxiv.org/pdf/2303.10541>
- Ronald Fedkiw, Jos Stam, and Henrik Wann Jensen, *Visual Simulation of Smoke* (SIGGRAPH 2001): <https://graphics.stanford.edu/papers/smoke/smoke.pdf>
- Duc Quang Nguyen, Ronald Fedkiw, and Henrik Wann Jensen, *Physically Based Modeling and Animation of Fire* (SIGGRAPH 2002): <https://graphics.stanford.edu/papers/fire-sg02/fire_final.pdf>
- Nick Rasmussen, Duc Quang Nguyen, Willi Geiger, and Ronald Fedkiw, *Smoke Simulation for Large Scale Phenomena* (SIGGRAPH 2003): <https://graphics.stanford.edu/papers/smoke-sig03/smoke.pdf>
- Andrew Selle, Nick Rasmussen, and Ronald Fedkiw, *A Vortex Particle Method for Smoke, Water and Explosions* (SIGGRAPH 2005): <https://physbam.stanford.edu/~fedkiw/papers/stanford2005-01.pdf>

The papers were text-extracted and rendered for visual inspection. The implementation is an educational visual model, not an engineering or predictive blast model.

## Paper-to-browser mapping

## Volume-domain boundary audit (2026-07)

The Cinematic renderer uses a bounded two-dimensional scalar/velocity field
and reconstructs a layered 2.5D volume from it. That is appropriate for a
browser experiment, but a bounded numerical field must not become a visible
geometric container. The Ground Burst proof-of-concept exposed four distinct
boundaries that had been conflated:

1. **Solver boundary.** The scalar and velocity textures end at `[0, 1]`.
   The pressure solve and advection use finite edge samples; that is a
   computational constraint, not a cloud shape.
2. **Volume reconstruction boundary.** The ray marcher maps field coordinates
   to the current event transform. A depth/curl offset can leave the field even
   when the undistorted pixel is inside it. Sampling that offset with a clamped
   texture lookup repeats an edge texel into a flat wall.
3. **Extinction envelope.** The profile edge modes are an optical treatment for
   sparse residue. They can soften an unavoidable limit, but cannot safely
   carry medium- or high-density material without becoming a visible oval or
   capsule.
4. **Camera and analytical-overlay boundary.** The Canvas pressure front is
   analytical and can naturally continue past the visible smoke. The viewport
   may crop either layer; neither fact licenses a smaller unrelated smoke box.

The reusable contract is therefore: retain an inactive padded margin in the
fixed solver field, map the active region through a matching render transform,
discard out-of-field ray samples rather than clamp them, and use organic
extinction only for low-density residue. The camera may crop naturally, while
the developer diagnostics report active-density bounds, solver-edge risk, the
visible field extent, and viewport clearance. The analytical shock remains in
event space rather than being clipped to smoke.

This is a visual-containment technique for normalized fields only. It does not
represent physical pressure, yield, atmospheric extent, or real-world smoke
transport.

## Castle Bravo visual-refinement diagnosis (2026-08)

The Castle Bravo baseline was captured on branch
`castle-bravo-visual-refinement` with the deterministic default seed `1842`,
Cinematic mode, GPU FLUID/WebGL2, and the Balanced/High desktop, tablet, and
Mobile viewports. Evidence is retained locally under
`scratch/castle-bravo-visual-refinement/` and is not release material.

### Dominant visual defects

1. **Early thermal body:** t0.5–t12 becomes a near-white, high-opacity wall or
   ball. The hot body has little soot/dust separation, weak internal shadow, and
   insufficient temperature-to-smoke handoff. This is a Castle profile material
   balance problem, not a missing renderer mechanism.
2. **Mature silhouette:** t20–t30 resolves as a highly symmetric clover/twin-lobe
   crown above a narrow central feed. It does not yet read as a broad, rolling
   surface-test cap with a substantial stem. The current profile leaves the
   reusable paired-cap circulation and generic source kernels at their neutral
   plume settings; no profile-specific expansion, vortex-ring, stem breakup, or
   feed taper is active.
3. **Late motion:** t42 is almost an empty horizon. The profile has no explicit
   late dissipation/settling tail, so the visible field loses its body without a
   substantial, slowly deforming haze. The target needs gradual thinning with
   continued curl/shear, not a frozen cloud or a hard fade.
4. **Historical identity:** the current look is an overexposed generic nuclear
   volume and does not yet establish Castle Bravo between the lower-yield
   references and Tsar. Broad cap mass, heavy lower particulate material, and
   surface-coupled depth are present in the intended source vocabulary but are
   not yet expressed by this profile's controls.

### Boundary diagnosis

The merged reusable architecture is functioning, but Castle Bravo is not opted
into it. At Balanced 1440×900, active density reaches `x 0.01–0.99` and
`y 0.00–0.99` around t5, with edge density `3.702`; the High capture reaches
the full x range with edge density `4.000`. The profile still reports
`legacy · 0.71 × 1.00 · 0% margin`, `domain.mode=0`, and `edge.mode=0`. The
same risk is visible across tablet and Mobile captures, although Mobile also
legitimately crops more of the large event.

The lower field contact is compatible with the physical ground plane. The
simultaneous top/side contact at the dense mid-phase is computational boundary
pressure: it is not a legitimate cap silhouette and is not normal viewport
cropping. The current flat/white appearance is therefore partly architectural
(no padded active region and no clearance) and partly profile-specific (source
and material saturation). No new extinction mask is justified by this baseline;
the first boundary correction is the existing padded-domain transform plus
validity-aware sampling, with the event allowed to crop naturally on Mobile.

### Controls selected for the refinement

The existing reusable controls that can address the defects are:

- profile-local `domain` configuration for solver margin, render extent, and
  event-space clearance;
- `source` and `physics` values for the broad early body, vertical rise, density
  loading, cooling, and surface particulate balance;
- `plume` mode for outward expansion, paired large-scale rolls, persistence,
  cap widening, feed taper, seeded stem breakup, and turbulence blending;
- `volume`, `core`, and `material` values for exposure roll-off, opacity,
  self-shadow, soot/dust optical depth, warm/cool separation, and depth;
- profile-local `dissipation` values for source taper, buoyancy relaxation,
  late velocity retention, curl, shear, and gradual final clearing.

The analytical shock remains in shared event space. It will be tuned only if
the post-boundary comparison proves a Castle-specific smoke/shock scale
mismatch; no additional shock bands are assumed from this diagnosis. Shared
tiers, ray budgets, Ground Burst, Airburst, Tsar, camera behavior, and exports
remain regression boundaries for the pass.

## Castle Bravo visual-refinement result (2026-08)

The fresh GPU baseline confirmed the diagnosis. The successful candidate keeps
the approved boundary architecture and makes Castle Bravo profile-local rather
than changing shared renderer behavior. The historical-scale `plume.mode=1`
probe was not retained: with Castle Bravo's surface-source balance it drove the
visible smoke toward an under-filled/off-screen state before a readable cap
could form. The retained `plume.mode=3` path is the existing broad,
ground-coupled path, constrained with Castle-specific values; this is not a new
mask or a Ground Burst configuration copy.

### Retained Castle Bravo controls

- Source/physics: `centerY=0.21`, `groundLevel=0.18`, `radius=0.084`,
  `aspectX=1.38`, `aspectY=0.88`, `radial=1.12`, `vertical=1.44`,
  `turbulence=1.55`, `heat=1.2`, `smoke=1.48`, `dust=1.78`,
  `buoyancy=1.0`, `densityLoading=1.15`, `vorticity=1.48`,
  `cooling=0.82`, and `smokeConversion=1.0`.
- Ground coupling: `mode=1`, `radialImpulse=0.26`, `spreadWidth=0.34`,
  `heightFalloff=1.55`, `horizontalRetention=0.92`,
  `verticalDamping=0.78`, `spreadStart=0.006`, `spreadEnd=0.16`,
  `angularVariation=0.3`, `asymmetry=0.22`, `surfaceHeat=0.68`,
  `baseDust=1.25`, `transitionLift=0.58`, `lateGroundDrift=0.05`.
- Plume: `mode=3`, `expansion=0.016`, `vortex=0.42`, `persistence=0.08`,
  `widen=0.06`, `feedTaperStart=0.5`, `feedTaperEnd=0.72`,
  `lateralJitter=0.5`, `turbulenceBlend=0.28`.
- Volume/material/core: `opacity=0.78`, `shadow=1.45`, `bloom=0.68`,
  `exposure=0.82`, `toneMap=0.32`, `noiseScale=1.1`, `material.mode=1`,
  `sootAbsorption=1.45`, `dustAbsorption=0.65`, `warmCoolContrast=0.75`,
  `interiorDepth=0.75`, `detailOctaveMode=0`, `core.mode=1`,
  `highlightThreshold=2.65`, `highlightSharpness=3.0`,
  `structureBlend=0.6`, and `bloomGateScale=8.0`.
- Late motion: `lateStart=0.62`, `sourceTaperEnd=0.84`, `finalStart=0.94`,
  `retentionFloorSmoke=0.9997`, `retentionFloorDust=0.999`,
  `outwardBoost=0.04`, `buoyancyFalloff=0.3`, `motionDamp=0.42`,
  `lateVelocityRetention=0.992`, `lateCurl=0.006`, `lateShear=0.004`,
  and `latePhaseRate=0.05`.

### Boundary and visual result

Castle Bravo now uses `domain.mode=1`, `padding=0.09`, `renderOverscan=1.05`,
profile-local `renderScale={mobile:1, balanced:0.76, high:0.82}`, and
`renderExtent={x:1.08, y:1.02}`. `edge.mode=0` and
`lowDensityAttenuation=0` remain neutral. No additional extinction mask was
needed. At representative Balanced desktop checkpoints, diagnostics reported
edge density `0.000` at t0.5, t5, t12, t20, t30, and t42, with boundary-risk
margin between `1.9%` and `10.1%`; the visible extent reported
`padded · 1.08 × 1.02 · 9% margin`. The small late/mobile edge values in the
responsive matrix are natural field occupancy inside the padded margin, not a
flat wall or capsule. The lower horizon contact remains the physical ground
plane. The shock stays shared and coherent: approximately `0.99×` horizontal
shock/render extent from t12 onward, without adding bands.

The candidate changes the early body from a white saturated wall to a broad,
gray/thermally structured body; produces a substantial connected stem and a
large, irregular rolling cap by t20–t30; preserves soot/dust depth and a
warm/cool lower separation; and retains a visible, deforming final haze instead
of dropping to an empty horizon. Mobile lets the large cloud crop naturally;
the event is not shrunk to fit the portrait frame.

Evidence is retained locally, uncommitted, under
`scratch/castle-bravo-visual-refinement/`, including `diagnostics/baseline.json`,
`diagnostics/candidate.json`, and `comparison.html`. The comparison is intended
for user visual review. Ground Burst, Airburst, Tsar, camera, replay/reset,
export parity, and the shared solver architecture remain regression boundaries;
no approved preset was edited by this pass.

## Nuclear Ground Burst artistic tuning (2026-08)

The post-containment baseline keeps the approved padded-domain transform intact
(`padding=0.10`, active scale `0.80`, effective overscan `1.30`, render extent
`1.65 × 1.50`, and validity-aware ray sampling). The remaining defect is in the
profile's visual material and motion balance rather than in the computational
boundary.

At t1–t9 the scalar smoke channel forms a broad, high-opacity horizontal layer
while the incandescent channel has already decayed. The volume therefore reads
as pale and uniform even though the field is spatially valid. The main causes
are the Ground profile's strong density loading (`1.55`), rapid smoke conversion
(`1.62`), modest buoyancy (`0.88`), and a material transfer that uses little
low-frequency variation when the third detail octave is disabled. The cap feed
also remains visually subordinate to the dense ground sheet.

The tuning pass is restricted to the Ground profile's source/physics, material,
volume, core, plume, and dissipation values. It must keep `detailOctaveMode=0`,
the approved boundary architecture, the restrained Ground shockwave, and all
non-target profiles byte-neutral.

### 1. *Animating Explosions*

Relevant concepts:

- Section 1 separates a short, compressible shock event from slower visible fireball and dust motion. That motivates the browser hybrid: an inexpensive analytical shock/flash phase followed by an incompressible GPU plume simulation.
- Section 3.1, equations (1)–(5), expresses conservation of mass, momentum, and energy for compressible viscous flow. A browser cannot resolve the paper's acoustic time scale economically, so these equations are **not** copied as a predictive solver. Their qualitative consequences—an outward density discontinuity, pressure-driven radial motion, heating, then slower buoyant flow—define the early-to-late handoff.
- Section 3.2, equation (6), uses centered spatial differences on a regular grid. The GPU solver likewise samples immediate texel neighbors for divergence, pressure gradients, curl, and scalar gradients.
- Section 5, especially Figure 8, treats shock-wave refraction as a density-gradient optical effect. The paper gives the Dale–Gladstone relation `eta - 1 = k rho`; the application adapts this only as a bounded, normalized screen-space displacement proportional to the analytical shell gradient. No real density or calibrated constant is exposed.
- Section 5 describes massless tracers following the simulated velocity and taking color from local temperature. The application keeps tracers as diagnostic/detail particles only; field density remains the primary visible structure.
- Section 5 also connects high dynamic range, blackbody-style fireball color, radiative contrast reduction, and smoke formation during cooling. These guide exposure adaptation, restrained bloom, tone mapping, and the incandescent-to-smoke transition.
- Section 6 notes that a slower, dissipative integration becomes appropriate after the pressure wave has left the volume. This supports a deliberate transition from the analytical shell to a semi-Lagrangian incompressible plume.
- Figures 9, 10, and 12 are visual references for fluid-coupled tracers, evolving structure, and the staged rise from luminous fireball to cap-and-column silhouette.

Explicit exclusions:

- Section 3.4's detonation regions, pressures, temperatures, geometry, and triggering are not implemented or exposed.
- Section 4, equations (7)–(14), object forces, solid coupling, fracture, and destruction are excluded.
- Table 1's dimensional charge/yield inputs and all damage-oriented figures are excluded.

### 2. *Visual Simulation of Smoke*

Relevant concepts:

- Section 2, equations (1) and (2), supplies the incompressible Euler target: `div(u) = 0` and `du/dt = -(u dot grad)u - grad(p) + f` after normalized constant density.
- Section 2, equation (3), advances an intermediate velocity without pressure. Equations (4) and (5) then solve a pressure Poisson equation and subtract the pressure gradient. The WebGL2 implementation follows this projection split with ping-pong textures, a Jacobi pressure solve, and a projection pass.
- Section 2, equations (6) and (7), passively advects temperature and smoke density. The browser implementation semi-Lagrangian-advects a packed scalar field containing temperature, smoke, incandescent material, and dust.
- Section 2, equation (8), combines downward density loading with upward temperature buoyancy. The browser adapts this as a normalized force `f_y = buoyancy * T - weight * (smoke + dust)` plus a normalized horizontal wind field.
- Section 3, equations (9)–(11), defines vorticity `omega = curl(u)`, the normalized gradient of its magnitude, and confinement force `f_conf = epsilon h (N x omega)`. In the 2.5D slice this becomes the standard perpendicular 2D confinement force and restores rolling structure lost to linear texture filtering.
- Section 4's staggered-grid discussion and two-grid update motivate finite-difference neighbor sampling and ping-pong GPU buffers. For WebGL simplicity the browser uses a collocated velocity texture rather than a face-centered MAC grid; projection and bounded time steps compensate for the compromise.
- Section 4's semi-Lagrangian backtrace is the core advection method. The paper's monotonic cubic interpolant (Appendix B) is not used at interactive tiers; bilinear hardware interpolation is cheaper, while confinement and multiscale reconstruction restore detail.
- Section 4 reports that visually acceptable pressure fields can use an approximate iterative solve. Browser quality tiers vary Jacobi iterations rather than aiming for engineering convergence.
- Section 5.1 maps density to extinction and multiplies transmittance along the light path. The volume shader uses Beer–Lambert opacity and short light-direction density probes for approximate self-shadowing.
- Section 5, equation (12), gives a Henyey–Greenstein phase function; equations (13)–(15) describe deeper participating-media integration. The real-time shader uses a single-scattering approximation with a restrained forward lobe instead of photon mapping.
- Figures 3, 5, 6, 7, and 8 establish the target behaviors: preserved vortices, entrainment, rising billows, persistent evolution, and reduced numerical dissipation.

### 3. *Physically Based Modeling and Animation of Fire*

Relevant concepts:

- Section 4.2, equations (8)–(11), repeats the intermediate-velocity and pressure-projection formulation for an incompressible hot-gas field. This is the numerical backbone of the later plume phase.
- Section 4.2, equation (14), models buoyancy as proportional to temperature above ambient. The application stores normalized excess temperature and applies upward force without exposing temperatures or real units.
- Section 4.2, equation (15), supplies the same grid-scaled vorticity-confinement force used for coherent rolls.
- Section 4.3, equation (16), uses an advected age/reaction coordinate. The application adapts only the safe numerical idea: an advected cooling/age progression converts incandescent density into smoke. It does not model fuel, reactions, ignition, or combustion chemistry.
- Section 4.3, equation (17), couples semi-Lagrangian transport to a radiative-style cooling term proportional to the fourth power of normalized temperature. The shader uses a bounded fourth-power cooling approximation and transfers cooled incandescent density into smoke.
- Section 4.3, equation (18), passively advects smoke/soot density.
- Section 5 and equation (19) motivate approximate anisotropic scattering. Equations (20) and (21) describe radiative transport and ray-segment accumulation; the browser uses a short fixed-step front-to-back approximation.
- Section 5.2, equation (22), is Planck's blackbody spectral-radiance formula. The application uses a compact temperature-to-RGB approximation inspired by it, then applies cinematic exposure and tone mapping rather than spectral integration.
- Section 5.2, equation (23), and the discussion of chromatic adaptation motivate the brief exposure-adapted flash and warm-to-neutral evolution.
- Figures 2, 3, 6, and 7 guide the temperature-history look, firelight illuminating smoke, outward expansion of hot flow, and visual fullness from field motion.

Explicit exclusions:

- Sections 3.1–3.3's fuel types, reaction fronts, flame speeds, solid fuels, ignition, and injection parameters are not implemented or exposed.
- Object ignition and interaction examples in Section 6 are excluded.

### 4. *Smoke Simulation for Large Scale Phenomena*

Relevant concepts:

- Section 3.1, equations (1) and (2), uses high-resolution two-dimensional incompressible flow with semi-Lagrangian advection, pressure projection, buoyancy, and vorticity confinement. Each Cinematic event family uses a bounded vertical 2D field for principal motion.
- Section 3.2 and Figure 3 reconstruct a volume by interpolating vertical flow slices, including a cylindrical arrangement for approximately axial phenomena. The volume shader interprets the 2D vertical field as a family of radial/layered slices and offsets samples by depth to build a non-flat 2.5D cloud.
- Section 3.3 defines a Kolmogorov energy spectrum proportional to `epsilon^(2/3) k^(-5/3)` above the inertial frequency. The browser uses a seeded, low-resolution divergence-free curl field with octave amplitudes following a `k^(-5/3)`-inspired energy falloff. It perturbs reconstruction and tracer motion but never replaces the principal fluid field.
- Section 3.3 recommends blending multiple differently sized/temporal fields to reduce visible periodicity. The shader samples one seeded periodic 3D curl volume at two octave scales with distinct spatial, depth, and slow deterministic time offsets.
- Section 3.4 advects noninteracting particles by `dx/dt = u`. GPU tracers sample the selected family field only for visible detail and diagnostics; unlike the original paper, particles are not the primary density representation.
- Section 4's view-dependent volume idea motivates spending ray-march samples in screen space rather than maintaining a full browser-sized 3D grid.
- Section 4.1's ellipsoidal particle splatting informs stretched wisps only at the detail layer, not the plume silhouette.
- Section 4.2 calls for direct illumination, incandescence, self-shadowing, and diffuse scattering in a participating medium. The shader approximates these with light-direction density probes, internal emission, and a low-cost scattering term.
- Section 4.3 maps density to opacity with `a = 1 - exp(-tau D(x) dz)` and composites front-to-back with equation (3), `A_(n+1) = A_n + a(1-A_n)`. The browser ray marcher implements this exponential opacity and early termination.
- Figures 1 and 4 are the closest visual references for the flagship: a broad but irregular rolling cap, dense outer gray smoke, incandescent interior, a connected rising column, and multiple spatial scales without an obvious particle sphere.

### 5. *A Vortex Particle Method for Smoke, Water and Explosions*

Relevant concepts:

- Section 3 augments an underlying incompressible grid solve with a set of Lagrangian *vortex particles*, each carrying a vorticity vector, and reconstructs their induced velocity. The application does not run a full vortex-particle solver; instead the Tsar reference profile evaluates a small, fixed set of analytic Gaussian vortices as a normalized force cue so the grid's existing vorticity confinement has coherent large-scale structure to sustain rather than nothing to amplify.
- Section 4 (vorticity forcing) motivates adding rotational structure the grid alone loses to numerical dissipation. The browser adaptation adds this only as a bounded velocity contribution, then clamps total speed, so it remains a stable visual cue and not an energy source.
- Figure 2's explosion recipe seeds vortices tangent to an upward-expanding cylinder during the expansion phase, which produces the rolling, turbulent, asymmetric cauliflower body rather than a smooth rising tube. The Tsar profile mirrors this qualitatively: a short-lived, rising, four-vortex population with unequal strengths and seed-jittered radii/heights, so the silhouette rolls asymmetrically and never shows two mirrored curls.
- Figure 5's stability observation — too strong a confinement/vortex weight (ε≈2) can prevent the plume from rising at all, while a moderate weight preserves rolling — sets the design ceiling. The Tsar `plume.vortex` strength is kept in the moderate range and gated behind an explicit profile flag.

Explicit exclusions:

- The paper's water, free-surface, and rigid-coupling applications are out of scope.
- No detonation energetics, yield, pressure, or damage quantities are taken from the explosion examples; only the qualitative "vortices tangent to a rising cylinder" motion cue is adapted.

## Tsar-scale broad-plume proof of concept (2026-07)

A single-preset vertical slice targeted only the **Tsar Bomba-Scale Historical Reference** profile (`tsar-bomba-scale-reference`), which previously collapsed into a thin rising line late in its long timeline. Root cause, traced through the live path: vertical-dominant source injection plus inward entrainment, with grid vorticity confinement having no large-scale rotational structure to sustain, and long-timeline scalar dissipation thinning the visible body — so the tracer detail layer, not a broad field, dominated the late silhouette.

The fix is fully opt-in and gated on a new `plume.mode` profile flag (`uPlumeMode` in the force and scalar shaders). Every other profile keeps `mode 0`, so its simulated behavior is byte-identical to before this pass — verified by `tools/fluid-contract-test.mjs`. Tsar-specific changes:

1. **Source rebalance** (`RESEARCH_FLUID_PROFILES`): radial injection raised to meet vertical (`radial 1.42` vs `vertical 1.12`), source lowered (`centerY 0.32`) and widened so the column is a body, not a pencil jet.
2. **Gas-expansion outward turning** and altitude-dependent **column widening** in `FORCE_FRAGMENT`, weighted by local plume presence (Nguyen/Fedkiw/Jensen 2002, Fig 6–7).
3. **Rising asymmetric analytic vortex ring** in `FORCE_FRAGMENT` (Selle/Rasmussen/Fedkiw 2005, Fig 2), with a total-speed clamp for stability (Fig 5).
4. **Late-density persistence** in `SCALAR_FRAGMENT`: smoke dissipation nudged toward unity for the Tsar reference only, so the monumental cloud retains mass across its timeline (low-dissipation CG smoke, Fedkiw/Stam/Jensen 2001).
5. **Softened boundary guard** for the Tsar profile so the broad umbrella's outer edges finish rolling instead of being absorbed at the domain margins.
6. **Highlight roll-off** in the volume profile (higher `toneMap`, lower `exposure`/`bloom`) so the hot phase reads as a structured fireball, not a flat white disc.

Environment (shared, but scoped by mode string in `scripts/renderer.js`, not by preset): the prototype triangle mountains and the always-on perspective grid were replaced on natural-terrain environments with continuous multi-octave noise ridges and atmospheric perspective. The analytical reference grid is retained for the scientific dark-grid stage and overview mode (`naturalGround = !environment.includes('grid')`).

Not generalized to the other eleven presets in this pass, by request; see the release report for the generalization recommendation.

## Tsar-scale smoke-material proof of concept (2026-07)

A second single-preset vertical slice, scoped only to the smoke **material**
(opacity, transfer function, medium-scale turbulence, and lighting contrast)
of the same Tsar broad-plume body established above. The plume's large-scale
structure, boundary behavior, and camera framing from the prior pass are
unchanged; this pass only changes how density becomes color and alpha inside
the already-approved silhouette.

### Read-only audit of the active path

Traced `VOLUME_FRAGMENT` (`scripts/fluid-engine.js`) end to end before
changing anything:

- Density-to-opacity is already Beer–Lambert exponential
  (`alpha = 1 - exp(-opticalDepth)`), not linear or thresholded — no change
  needed there.
- Soot (`scalar.g`) and dust (`scalar.a`) were summed into one `smoke` value
  *before* the optical-depth multiply, so both shared exactly one
  density-to-alpha coefficient (`uVolumeProfile0.y`, i.e. `volume.opacity`).
  This is the root cause of the "one universal material" look: dust and soot
  can already differ in *weight* (`volume.dustVisibility`) and *color*
  (`dustMix` blends `uPaletteSmoke`/`uPaletteDust`), but never in how strongly
  a unit of their density attenuates light.
- Depth decorrelation already exists: each ray-marched layer samples a 3D
  curl-detail texture at a *depth-varying* z-coordinate and offsets its own
  sample UV (`layerUv.x += depth * (...)`, `layerUv.y += depth*depth * (...)`,
  plus a curl-driven offset) — layers are not simple repeated 2D slices. The
  detail loop runs exactly 2 octaves at a flat `k^(-5/6)` amplitude with no
  dependence on local flow energy.
- Self-shadowing is already tied to accumulated optical depth
  (`shadowColumn` grows through the front-to-back loop; `selfShadow =
  exp(-shadowColumn * ...)`), and front/rear layers already receive
  independent lighting through that same accumulation plus a sky-occlusion
  probe. The dynamic range between shadowed and lit smoke was narrow (small
  mix weights), which reads as flatter than the mechanism actually supports.
- Bloom is already gated to genuine incandescent emission only (neighbor
  sampling multiplies by `neighbor.b`), not a generic brightness bleed — no
  change needed there.
- Tone mapping already mixes ACES and Reinhard curves
  (`uVolumeProfile2.y`), so the previously-noted "t7 bright/flat" look is a
  balance issue in the existing profile values, not a missing tone-mapping
  system.

Conclusion: the rendering *mechanisms* the task asks for (exponential
transmittance, front/back self-shadow, depth decorrelation, gated bloom,
tone-mapped composite) were already present and reasonably sophisticated.
The gap was narrower than the task brief implied — mainly one shared
material coefficient, an energy-flat (rather than energy-weighted) detail
octave, and under-differentiated lighting contrast weights. The three
techniques below are targeted at exactly those three gaps rather than
replacing working machinery.

### Techniques selected (Tsar-gated via a new `material` profile block)

Mirrors the existing `plume.mode` pattern exactly: `BASE_PROFILE.material =
{ mode: 0, sootAbsorption: 1, dustAbsorption: 1, detailBoost: 0,
warmCoolContrast: 0 }` for every preset; only Tsar sets `mode: 1` with tuned
values. A single `uMaterialMode` uniform (0 for every other preset) gates all
three shader changes; when it is 0, every new term reduces algebraically to
the prior expression, so non-Tsar rendering is byte-identical.

1. **Material-separated transfer function.** Staubli/Sigg/Peikert/Gubler/Gross,
   *Volume Rendering of Smoke Propagation CFD Data* (2007), §3: the optical
   model gives each material its own optical-density coefficient
   (`D = (Km/3) * ys * c_p`) rather than one shared density→opacity curve.
   Browser adaptation: soot density and dust density each get an independent
   multiplier (`uMaterialParams.x/.y`, Tsar: soot 1.6, dust 0.35) *before* the
   exponential optical-depth term, while the unweighted sum is kept for the
   existing color-mixing code path. Rejected alternative: a full 2D/3D
   pre-integrated lookup table (the paper's own approach for a *linear*
   transfer function) — unnecessary complexity for two materials with a
   single scalar coefficient each, and this repo's transfer function is
   already exponential, not linear, so the paper's specific pre-integration
   trick doesn't directly transfer. Expected cost: two extra multiplies per
   ray step, no new texture samples.

2. **Energy-weighted third detail octave.** Kim/Thürey/James/Gross-style
   wavelet turbulence (paper 08) and Bridson/Hourihan/Nordenstam, *Curl-Noise
   for Procedural Fluid Flow* (2007, paper 09), §2.2's octave superposition
   with a Kolmogorov-inspired falloff (already used for the existing 2
   octaves). Browser adaptation: a third, finer curl-detail octave whose
   amplitude is scaled by local flow energy (`abs(centerCurl)`) instead of
   the flat `k^(-5/6)` term the first two octaves use — detail concentrates
   where the flow is actually turbulent (medium-scale billows, cauliflower
   lobes) instead of coating the whole plume in uniform noise. Rejected
   alternative: a true offline wavelet decomposition (paper 08's core
   method) — requires a multi-resolution simulation grid this engine doesn't
   have; the existing curl-noise-octave infrastructure already approximates
   the same visual goal (energy-aware band-limited detail) far more cheaply.
   Expected cost: one additional 3D texture sample per ray step, Tsar only.

3. **Widened lit/shadowed contrast.** Fedkiw/Stam/Jensen, *Visual Simulation
   of Smoke* (2001) §5.1 (Beer–Lambert self-shadowing, already in place) and
   Pegoraro/Parker, *Physically-Based Realistic Fire Rendering* (2006) §3.2's
   radiative-transfer view that absorption dominates a low-albedo medium —
   the existing mechanism was correct but under-weighted. Browser
   adaptation: a single `warmCoolContrast` scalar (Tsar: 0.85) widens the
   existing `litWeight`/`smokeColor` mix coefficients (more temperature and
   self-shadow influence, a darker unlit base) rather than introducing a new
   lighting model. Rejected alternative: Pegoraro/Parker's full spectral
   absorption/emission/blackbody path-tracer — far too expensive for
   real-time raymarching and requires per-wavelength data this engine
   doesn't track; the existing `heatRamp` already approximates blackbody
   color, so only the contrast *weighting* needed adjustment, not a new
   radiative model. The "t7 bright/flat" complaint from the prior POC's
   known-issues list is addressed by this same contrast widening rather than
   a separate tone-mapping change, since tone mapping was already adequate
   (see audit above).

### Not selected this pass

- A full pre-integrated 2D/3D transfer-function lookup table (paper 16's
  core technique) — the two-coefficient approach above gets the same
  material-separation benefit at a fraction of the complexity for an
  exponential (not linear) transfer function.
- True wavelet turbulence (paper 08's offline multi-resolution decomposition)
  — the existing curl-detail octave system is the pragmatic real-time
  substitute already used by this engine; a genuine wavelet solve would
  require a second simulation grid.
- Tracer occlusion changes. Audited (`TRACER_VERTEX`/`TRACER_FRAGMENT`,
  `scripts/fluid-engine.js`): tracer alpha is currently proxied by the local
  scalar density *at the tracer's own position* (`plume * 0.34`), so a tracer
  embedded in dense smoke gets brighter, not hidden by smoke between it and
  the camera — there is no true occlusion by intervening density. A correct
  fix would sample the volume pass's already-composited destination alpha
  (same framebuffer, drawn immediately before the tracer pass) as an
  occlusion factor. Left unimplemented this pass: `_renderTracerPoints` and
  both tracer shaders are shared, unguarded code used by every preset, so
  this would need its own profile-gated flag and shader branch, pushing past
  the three-technique budget for a single pass; flagged here as a
  well-scoped, low-risk follow-up rather than folded in as a fourth
  technique.

## Tsar-scale core/tracer polish (2026-07)

A narrowly scoped visual-polish pass targeting two specific defects visible
in the approved broad-plume/smoke-material/late-dissipation build: the
t5–t10 early core reading as a flat white capsule instead of a structured
fireball, and tracers ignoring occlusion by intervening smoke. Plume
structure, dissipation timing, camera behavior, terrain, and every non-Tsar
preset are unchanged.

### Read-only audit of the active path

Captured the approved build at t2.5/5/7/10/15/30/50/54 (Tsar preset, seed
1842, three viewports) before changing anything. t2.5–t10 rendered as a
uniform, hard-edged white/light-grey mass with no visible internal shading —
not merely bright, genuinely flat, with a sharp transition to background
rather than a soft volumetric falloff.

Traced `VOLUME_FRAGMENT`'s per-layer emission term (`scripts/fluid-engine.js`):

- The "overexposed white-hot core" bonus term
  (`emission += uPaletteCore * pow(clamp((temperature - 1.5) * 0.85, 0, 1), 2.0)
  * (0.4 + incandescent * 0.45)`) is **not** gated by `uMaterialMode` or any
  other flag — it runs identically for every preset. Its saturation point
  (`pow(...) == 1.0`) is reached at `temperature >= 2.68`. The developer
  diagnostics panel reports Tsar's measured max temperature at t7 as `2.9176`
  — comfortably past that point across a wide spatial area, not a narrow
  peak — so the term outputs flat, maximum `uPaletteCore` over most of the
  visible core instead of a graded highlight. This is the root cause of the
  flat-white-blob appearance: excessive incandescence combined with a
  highlight roll-off that saturates far too early for Tsar's amplified
  source (`heat: 1.4`), not a missing mechanism.
- The same term ignores `selfShadow` and `detailModulation` entirely — both
  are already computed per layer and used elsewhere in the same function —
  so even self-occluded, turbulent interior voxels receive the identical
  full-strength highlight as exposed, laminar ones. This removes the
  internal depth/irregularity a real fireball would show.
- Bloom (`accumulated += bloom * 0.018 * ...`) samples 8 neighbor texels and
  adds `heatRamp(neighborHeat) * neighbor.b` unconditionally. Over a broad,
  already-flat hot region every neighbor sample is roughly equal, so bloom
  adds a second, spatially uniform layer of brightening on top of an already
  uniform highlight — reinforcing the plateau instead of softening real
  edges.
- Tone mapping, exponential opacity, and self-shadowing itself were already
  correct (confirmed by the smoke-material audit above); the defect is
  specifically in the two unguarded terms above, not the broader pipeline.

Tracer audit (`TRACER_VERTEX`, `scripts/fluid-engine.js`) confirmed exactly
what the smoke-material pass's deferred follow-up (above) predicted: alpha
is `plume * 0.34` — local density at the tracer's own position, with no
attenuation from smoke between the tracer and the camera. Cropped, magnified
comparisons at t10 showed tracers rendering at identical, undimmed
brightness whether they sat in thin edge smoke or deep in the densest part
of the core. `gl_PointSize` is a fixed `baseSize * typeSize` with no
per-particle randomization, so every tracer in a given type is pixel-for-
pixel identical in size and brightness — the "repetitive dots" complaint.

### Techniques selected (Tsar-gated via new `core` and `tracerMaterial` profile blocks)

Mirrors the existing `plume`/`material`/`dissipation` pattern exactly:
`BASE_PROFILE.core = { mode: 0, highlightThreshold: 1.5, highlightSharpness:
2.0, structureBlend: 0, bloomGateScale: 0 }` and `BASE_PROFILE.tracerMaterial
= { mode: 0, occlusionStrength: 0, sizeVariance: 0, brightnessVariance: 0 }`
for every preset; only Tsar sets `mode: 1` with tuned values. `uCoreMode`/
`uTracerMaterialMode` gate all new shader terms; at their default values
every gated expression collapses algebraically to the prior formula, so
non-Tsar rendering is byte-identical (asserted directly in
`tools/fluid-contract-test.mjs`).

1. **Highlight threshold/sharpness + self-shadow/turbulence structure
   blend.** Raises the white-core saturation point from `temperature >= 2.68`
   to `>= 3.58` (Tsar: `highlightThreshold: 2.35`, `highlightSharpness: 3.2`)
   so full saturation is reached only by genuinely the hottest voxels instead
   of most of the visible core, and multiplies the term by
   `selfShadow * (0.6 + 0.4 * detailModulation)` (Tsar: `structureBlend:
   0.8`) so occluded and turbulent regions darken relative to exposed,
   laminar ones — breaking the flat plateau into irregular thermal pockets
   using data the shader already computes, no new texture samples. Confirmed
   visually: t5/t7/t10 now show a shaded dome with turbulent ring structure
   and dark interior pockets instead of a flat capsule.
2. **Bloom gradient gate.** Computes the variance of the same 8 neighbor
   heat samples bloom already reads and scales the bloom contribution by
   `sqrt(variance) * bloomGateScale` (Tsar: `11`), so bloom is suppressed in
   flat (low-gradient) regions — exactly the plateau this pass fixes — while
   staying at full strength around genuine edges. No new samples; reuses the
   existing 8-tap loop.
3. **Beer-Lambert tracer occlusion.** Adds `exp(-plume * occlusionStrength)`
   (Tsar: `2.6`) as a multiplicative attenuation on top of the existing
   density-weighted visibility, reusing the same local density sample the
   volume renderer's own opacity curve is built from rather than a second
   pass. This is the follow-up the smoke-material audit explicitly deferred.
   Skipped in diagnostic tracer view (`uDiagnostic == 8`), matching the
   existing `edgeFade` bypass for verification.
4. **Per-tracer size/brightness jitter.** A stable hash of each tracer's
   index and generation (same hash family already used for respawn
   placement in `TRACER_ADVECT_FRAGMENT`, duplicated locally in
   `TRACER_VERTEX` since the two are separate shader programs) drives a
   `±sizeVariance`/`±brightnessVariance` (Tsar: `0.5`/`0.45`) offset per
   particle, so tracers of the same type are no longer pixel-identical.

### Not selected this pass

- Palette edits (`uPaletteHot` collapsing to nearly `uPaletteCore` for the
  active "Natural Fire" palette, narrowing the orange mid-tone band) — the
  palette is shared across every preset and palette selection is a
  user-facing control independent of the preset; a Tsar-only override would
  need its own gating mechanism this pass doesn't introduce. The threshold/
  structure changes above already resolve the flat-plateau defect (the
  actual acceptance criterion) without touching shared palette data.
- Reworking the temperature/incandescent field's cooling rate. The measured
  max temperature (`2.9176`) is high but not literally unbounded, and the
  highlight-term fix above resolves the visible symptom without touching
  simulation-affecting scalars (`uProfilePhysics`, `uProfileDecay`), which
  the task scope explicitly excludes (no plume/dissipation-timing changes).
- Tracer count, generation logic, or position distribution — unchanged;
  only display-time occlusion/size/brightness and the existing
  dissipation-aware lifetime (already correct per t54 evidence) were
  touched, per the "do not increase global tracer budgets" constraint.

## Low-yield Nuclear Airburst visual proof of concept (2026-07)

The production-wide preset audit selected **Nuclear Airburst — Research
Model** (`low-yield-nuclear-airburst`) as the next isolated rollout target.
Deterministic browser evidence at seed `1842`, Cinematic mode, Balanced and
High, and 1440 × 900 / 768 × 1024 / 1024 × 768 confirms five related defects:

1. **Flat early core.** The preserved profile leaves `core.mode` at zero, so
   the original highlight threshold (`1.5`), sharpness (`2.0`), unstructured
   highlight multiplier, and ungated bloom saturate most of the early
   temperature field into one white disk. Its volume profile also has no tone
   mapping and only modest self-shadowing, while the preserved scalar source
   injects a centered Gaussian core with no profile width/material weighting.
2. **Straight blue-gray stem.** The preserved force branch supplies a centered
   radial impulse and vertical rolling updraft. Its only resolved asymmetry is
   a weak curl-detail perturbation (`BASE_PROFILE.source.turbulence: 0.65`);
   `plume.mode` is off, so there is no early lateral expansion, widened
   `coreBand`, feed taper, lateral jitter, or turbulence handoff. The unoccluded
   fixed-size thermal tracers remain concentrated along the same central feed.
3. **Narrow triangular middle cloud.** Paired cap vortices are active and were
   previously widened, but inward column entrainment plus vertical-dominant
   retained motion leaves too little broad body for those vortices to roll.
   The cap rises out of the visible field while the surviving scalar mass
   narrows back toward the center, producing the triangular t12–t15 silhouette.
4. **Limited material depth.** `material.mode` is off, so soot and lofted dust
   share the same optical-depth response, only two detail octaves are sampled,
   and warm/cool contrast remains neutral. The result is a smooth blue-gray
   mid-tone with weak front/middle/rear separation.
5. **Sparse shock structure.** The analytical compositor retains its primary
   early shell, but the low-yield fluid profile has no subordinate density
   bands. The preserved `uProfileKind == 9` scalar-injection branch predates
   `profileShockwaveLayers()` and bypasses the generic primitive branch where
   Tsar consumes it, so enabling `shockwave.mode` alone would be inert.

The implementation remains within the existing immutable profile architecture.
The preserved low-yield source branch will consume normalized profile width,
radial/vertical/turbulence, and scalar weights relative to its current neutral
defaults; the shock-layer helper will be called from that existing branch
behind `uShockwaveMode`. Low-yield will opt into separately tuned `plume`,
`core`, `material`, `shockwave`, and `tracerMaterial` blocks. Tsar values are
reference bounds only and are not copied. Because the baseline final frame is
already clean and shows no rectangular field, `edge.mode` and
`dissipation.mode` remain off unless the tuned evidence creates a new late
artifact.

Expected tracked changes are limited to `scripts/fluid-engine.js`,
`tools/fluid-contract-test.mjs`, and this implementation map. Browser captures,
performance logs, comparisons, and generated exports remain under ignored
`scratch/low-yield-airburst-visual-poc/`.

## Low-yield dense shockwave pass (2026-07)

The approved rollout still read as sparse because its profile exposed only the
shared three explicit subordinate-ring slots, enabled two of them at strengths
`0.24` and `0.18`, and left the third disabled. Those fixed shells were
density-only additions close to the primary radius; they did not populate the
interior bubble, varied only through a shared angular wobble, and faded as one
small group. The analytical compositor continued to supply the clearest outer
shock, so the final image usually resolved as one leading shell plus two faint
echoes rather than a layered compression field.

The retained solution uses `shockwave.mode: 2` only for
`low-yield-nuclear-airburst`. Mode 1 and its three explicit bands remain
unchanged for Tsar. The new mode evaluates one deterministic warped radial
coordinate in the volume compositor, maps it to the nearest contour, and
derives stable per-contour width/strength variation from the contour index and
seed. This produces ten internal echoes in High, nine in Balanced, and seven
in Mobile without a per-band shader loop. The family spans the interior
`0.27–0.94` of the primary radius, biases strength toward the leading region,
and varies spacing, width, angular continuity, front/rear visibility, onset,
and fade.

Mode 2 preserves the approved `0.24` and `0.18` explicit scalar rings,
including their original irregularity and fade values, so temperature,
incandescent, smoke, velocity, pressure, plume, and primary-ring simulation
remain unchanged. The dense family exists only in the contour compositor,
which samples the real ray-marched transmittance: rear segments are buried
more strongly, front segments retain limited contrast, and fully opaque
fireball or smoke still occludes every echo. Internal echoes begin in stages,
soften from roughly t3.5, and are mostly cleared around t8; no smoke/plume
dissipation value is changed.

## Nuclear Ground Burst visual proof of concept (2026-07)

The next isolated rollout target is **Nuclear Ground Burst**
(`nuclear-ground-burst`). Deterministic seed-`1842` Cinematic evidence at
1440 × 900 High/Balanced, 768 × 1024 Balanced, 1024 × 768 Balanced, and
390 × 844 Mobile confirms six connected defects:

1. **Rectangular white ground barrel.** The generic scalar branch merges the
   broad `ground-sheet`, narrow `vertical-jet`, offset kernels, and base
   Gaussian into one `stagedCombined` maximum, then gives that same smooth
   field the full heat/incandescent envelope. Ground Burst's high heat,
   incandescence, opacity, bloom, and low tone-map value saturate the merged
   sheet/jet into a flat white strip that grows into a rectangular cylinder.
2. **Weak ground spread.** The ground-sheet force is a symmetric signed-x
   impulse driven only by the short onset envelope. Its fixed Gaussian width
   has no source-height weighting, sustained ground-layer retention, phase
   taper, or deterministic lobe variation, so the analytical reflected wave
   reads more clearly than resolved radial dust motion.
3. **Smooth centered column.** Ground Burst leaves `plume.mode` off. Its
   strong vertical source therefore stays inside the narrow
   `profileVerticalKernel()` corridor without feed taper, lateral drift,
   widening, or a turbulence handoff. Generic inward entrainment reinforces
   that centered corridor as it rises.
4. **Weak material separation.** `material.mode`, `core.mode`, and
   `tracerMaterial.mode` are all off. Dust and soot share one optical-depth
   curve, the white-hot highlight has no structural modulation or bloom
   gradient gate, and bright fixed-size tracers remain visible through dense
   particulate material.
5. **Boxed mature and late field.** `edge.mode` is off, so the volume uses the
   independent side/top extinction product whose low-density isocontour is a
   rounded rectangle. Ground Burst's large scale, high opacity, and retained
   scalar field expose that computational envelope across desktop and mobile.
6. **Static fade instead of organic dissipation.** `dissipation.mode` is off.
   The source remains active deep into the timeline, dust and soot share the
   default decay path, and resolved velocity receives no late curl, shear, or
   ground-directed drift. The boxed field therefore thins in place and then
   clears completely instead of separating into ground haze and elevated
   wisps.

The implementation remains profile-gated. Ground Burst receives a dedicated
ground-coupling block that separates the low surface flash and dust sheet from
the rising thermal feed, retains horizontal velocity close to the surface,
adds seeded lobe asymmetry, and tapers radial forcing as the plume lifts. It
also opts into separately tuned plume, material, core, shockwave, tracer,
organic-edge, and late-motion controls. The existing Airburst and Tsar
mechanisms are used only as architectural references: the dense Airburst
contour family, its compact source branch, and Tsar's historical expansion,
vortex, persistence, and late-tail values are not reused.

Expected tracked changes are limited to `scripts/fluid-engine.js`,
`scripts/data.js` only if Mobile evidence retains a Ground Burst portrait
pullback, `tools/fluid-contract-test.mjs`, and this implementation map.
Captures, comparisons, performance logs, and test exports remain under ignored
`scratch/nuclear-ground-burst-visual-poc/`.

## Browser numerical design

The shared event-family simulation uses deterministic fixed steps and a WebGL2 field pipeline. Source injection is selected from bounded normalized primitives—radial and directional impulses, rings, ground sheets, vertical jets, offset kernels, pulsed columns, ejecta curtains, trails, sustained visual-combustion regions, and turbulent clusters—without introducing materials or engineering inputs:

1. Inject the selected preset's seeded primitive stack and scalar channels.
2. Semi-Lagrangian-advect velocity plus packed temperature, smoke, incandescent, and dust density.
3. Compute curl and apply profile-specific buoyancy, density loading, normalized wind, drag/settling, bounded vorticity confinement, and primitive forces. Paired cap circulation remains specific to the preserved Research Airburst and related nuclear cap profiles.
4. Add the bounded source, apply ambient plus normalized fourth-power radiative cooling, convert incandescent density into smoke, and dissipate scalars.
5. Compute divergence.
6. Approximately solve the pressure Poisson equation with tier-dependent Jacobi iterations.
7. Subtract the pressure gradient to obtain the projected velocity.
8. Advect seeded GPU tracers through that projected field for diagnostics/detail only.
9. Reconstruct a layered/radial visible volume, add seeded low-resolution curl detail, and ray-march density with exponential opacity, emission, self-shadowing, scattering, bloom, distortion, and tone mapping.

The early shock shell, reflected ground arc, exposure-adapted flash, and refractive displacement are analytical because resolving a compressible acoustic shock on the same interactive grid would require impractically small time steps. They fade into the projected incompressible field rather than continuing as the main plume motion.

## Active implementation map

The July 2026 production audit traced every adapted method into the live render path rather than counting comments or unused code:

| Adapted method | Active source location |
| --- | --- |
| Deterministic fixed stepping and replay | `scripts/fluid-engine.js` — `ResearchFluidEngine.seek()` and `_resetState()` |
| Velocity/scalar semi-Lagrangian advection | `ADVECT_FRAGMENT`, dispatched twice by `_stepSimulation()` |
| Temperature, smoke, incandescent, and dust fields | RGBA scalar ping-pong targets created by `_allocateTargets()`; source/cooling/conversion in `SCALAR_FRAGMENT` |
| Buoyancy, density loading, wind, entrainment, cap circulation, and advected asymmetry | `FORCE_FRAGMENT`, dispatched by `_stepSimulation()` |
| Curl and vorticity confinement | `CURL_FRAGMENT` plus the curl-gradient force in `FORCE_FRAGMENT`; the derived curl texture is refreshed after projection |
| Divergence and pressure projection | `DIVERGENCE_FRAGMENT`, `JACOBI_FRAGMENT`, and `PROJECT_FRAGMENT` inside `_stepSimulation()` |
| GPU tracer detail | `TRACER_ADVECT_FRAGMENT` samples the projected velocity; `_renderTracerPoints()` draws the bounded tracer pool |
| Layered/radial 2.5D reconstruction and volume integration | `VOLUME_FRAGMENT`, dispatched by `ResearchFluidEngine.render()` |
| Exponential transmittance, emission, attenuation, scattering, self-shadow, bloom, and tone mapping | `VOLUME_FRAGMENT` front-to-back ray loop and final composite |
| Analytical flash, shell, reflected wave, and early refraction | `scripts/renderer.js` — `_drawAtmosphericLight()`, `_drawShock()`, and `_drawResearchRefraction()` |
| Same-engine PNG and MP4 frames | `ExplosionRenderer.renderTo()`; `scripts/exporter.js` supplies exact frame timestamps and never substitutes the legacy animation |
| Real field verification | `METRICS_FRAGMENT`, `_collectDebugMetrics()`, post-projection diagnostic textures, and `getStats()`; enabled only by developer diagnostics |

The collocated grid and finite Jacobi iteration count do not enforce engineering-grade incompressibility. Neighbor differences also omit a dimensional grid-spacing calibration, so fine motion can vary somewhat by quality tier. Those are deliberate real-time compromises and are not presented as physical prediction.

## Determinism and quality tiers

- Simulation time advances on a fixed timestep. Seeking backward, replaying, changing the seed, or changing the tier resets the field and deterministically re-simulates from time zero.
- Live rendering and fixed-timestep MP4 export call the same simulation and volume-rendering path; export does not use a simplified animation.
- **Mobile:** reduced field, pressure iterations, tracer count, and ray-march steps.
- **Balanced:** default field and rendering resolution.
- **High:** larger field, more pressure iterations, more tracers, and more ray-march/light samples.
- If WebGL2 or floating-point render targets are unavailable, the existing deterministic Canvas 2D renderer remains the graceful fallback. Effects Overview intentionally remains an analytical Canvas view and is reported separately from a renderer failure.

## Safety boundary in the interface

No new dimensional or predictive controls are introduced. Every profile exposes only the existing normalized educational controls plus visualization quality. Developer diagnostics are URL-gated and display the event family, fluid profile, source primitives, and actively simulated dimensionless velocity, relative temperature, smoke density, incandescent density, pressure, post-projection divergence, vorticity, and advected tracers; the overlay also reports sampled field maxima and the active fallback reason. The diagnostics never expose blast pressure, yield, damage radius, material selection, construction, geometry, triggering, targeting, casualties, or optimization.

## Hiroshima-scale visual diagnosis (2026-08)

The fresh deterministic seed-1842 Cinematic baseline was captured in Chrome with
WebGL2, GPU FLUID, and no fallback at 1440 × 900 Balanced/High, 768 × 1024
Balanced, 1024 × 768 Balanced, and 390 × 844 Mobile. The baseline is a
profile-specific risk case, not a shared-renderer failure:

1. **Near-edge risk without a visible wall.** During roughly t3–t12 the sampled
   field expands to approximately `x 0.02–0.98` and `y 0.99`, with 13–24% of
   active cells inside the legacy risk margin. Direct solver-edge density stays
   `0.000` at every captured checkpoint, so the images do not show a flat roof,
   hard side wall, capsule, or rectangular extinction contour. The root cause
   is Hiroshima retaining `domain.mode: 0` while its generic radial/vertical
   source and analytical shock occupy nearly the full normalized field. A small
   profile-local padded-domain configuration is justified to restore clearance;
   it is a render-coordinate margin, not a source shrink or decorative mask.
2. **Generic narrow-column silhouette.** The t5–t15 body is bright and mostly
   cylindrical, with a narrow stem and a cap that arrives as a weak, left-biased
   ring rather than a connected compact mushroom. The root cause is the neutral
   `plume.mode: 0` path: Hiroshima has no feed taper, widening, lateral jitter,
   profile persistence, or tunable vortex/expansion values, so the generic
   vertical primitive and paired cap vortices remain too orderly.
3. **Compressed early and internal material.** The t0.5 thermal body is close to
   a smooth white orb and the mature t15–t20 mass has limited warm/cool or
   front/middle/rear separation. The root cause is the neutral material/core
   path (`material.mode: 0`, `core.mode: 0`, `warmCoolContrast: 0`): soot and
   dust use one optical curve, the highlight has no structural pockets, and
   the current profile's `shadow: 1.22` / `exposure: 1.10` leaves the smoke
   body visually flatter than its field density suggests.
4. **Weak mature handoff and late tail.** At t20 the cap remains small relative
   to the long stem and its underside is hard to read; by t30 the field is
   nearly inactive (`smoke density ≈ 0.03–0.05`) and the cloud has little
   continuing curl/shear. The root cause is the neutral `dissipation.mode: 0`
   path combined with a short `sustainEnd: 0.42`, `cooling: 0.85`, and no
   profile-specific late velocity retention/curl/shear. Hiroshima therefore
   loses readable mass before its compact historical silhouette has time to
   settle into a living late haze.
5. **Shockwave is coherent but over-assertive early.** The analytical shell
   tracks the shared event-space volume (`~1.48× horizontal at mature times`)
   and does not mismatch smoke or create a boundary. Its t0.5–t9 rings are
   visually dominant only because the Hiroshima fluid body is still generic and
   under-structured. No extra shockwave bands are warranted by this diagnosis;
   the first correction belongs in Hiroshima's source, plume, material, and
   late-tail profile controls.

The approved reusable boundary architecture remains unchanged. The candidate
was evaluated against only existing profile controls: a possible modest padded
domain, profile-local plume shaping and persistence, a structured early
core/material path with no third detail octave, and a restrained late-motion
tail. Ground Burst, Nuclear Airburst, Castle Bravo, Tsar, camera, wind,
overlays, and shock systems remain regression locks.

## Hiroshima refinement decision (2026-08)

Controlled profile-only A/B checks rejected the padded-domain experiment and
the high-force historical plume experiment: the first enlarged the rendered
composition, while the second produced a generic disk and a rectangular-looking
cap. A lower-force A/B retained the compact scale while making the cap/stem
handoff readable. The retained candidate leaves `domain.mode: 0`, `edge.mode: 0`,
and all shockwave values neutral because the direct edge-density diagnostic
remained `0.000` and no computational wall was visible. It uses the existing
historical plume path at restrained values: expansion `0.005`, vortex `0.015`,
persistence `0.36`, and widening `0.007`.

The stem handoff uses feed taper `0.68–0.88`, lateral jitter `0.1`, and
turbulence blend `0.035`; these remain well below the larger historical
profiles and are profile-local rather than shared renderer changes.

The retained source/cap balance is `radius: 0.061`, `sustainEnd: 0.46`,
`turbulence: 1.06`, `clusterSpread: 1.16`, `capScale: 1.14`, `capRoll: 1.28`,
and `capVertical: 0.46`. Material/core structure uses soot `0.94`, dust `0.78`,
warm/cool contrast `0.25`, interior depth `0.15`, highlight threshold `1.8`,
sharpness `2.4`, structure blend `0.35`, and bloom gate `5.5`; `detailOctaveMode`
stays `0`. The late tail is profile-local and restrained (`lateStart: 0.72`,
`finalStart: 0.95`, `sourceTaperEnd: 0.84`, smoke floor `0.9995`, dust floor
`0.9988`, late velocity retention `0.994`, curl `0.002`, shear `0.0015`).

## Early Fission Test Scale visual diagnosis (2026-08)

The fresh deterministic seed-1842 Cinematic baseline was captured in Chrome
with WebGL2, GPU FLUID, no fallback, and no app-origin console errors at
1440 × 900 Balanced/High, 768 × 1024 Balanced, 1024 × 768 Balanced, and
390 × 844 Mobile. The preset timeline ends at 26 seconds, so `t24` and final
`t26` replace the requested `t30` checkpoint.

1. **Profile-local solver-roof risk.** The profile starts with the neutral
   `domain.mode: 0`, `edge.mode: 0`, legacy visible extent, and no padded
   render coordinate margin. At t15 the active field reaches `y 0.00` in all
   desktop/tablet views and reports edge risk from `0.153` to `0.392`; at t20
   it remains near the top with edge risk up to `0.173`. Side bounds stay well
   inside the field (`x` approximately `0.11–0.89` at t15), so the dominant
   risk is the computational roof rather than a physical ground contact or a
   side-wall artifact. The visible plume does not yet form a clean rectangular
   wall, but the diagnostics justify the existing padded-domain architecture
   for this profile. No new extinction mask is indicated.
2. **Featureless early thermal body.** At t0.5 the source reads as a smooth,
   pale dome with a narrow white vertical nozzle. By t5 the thermal column is
   nearly a full-height bright cylinder. The cause is the inherited neutral
   core/material path (`core.mode: 0`, `material.mode: 0`, warm/cool contrast
   `0`, interior depth `0`) combined with high dust visibility `1.6`, opacity
   `1.3`, and shadow `1.35`; there is no structured highlight gate or
   soot/dust optical separation to break the body into readable material.
3. **Weak stem/cap handoff.** The neutral plume path (`plume.mode: 0`) leaves
   the vertical source feed at its generic taper and supplies no profile-local
   expansion, vortex, widening, lateral jitter, or turbulence blend. The
   result is a thin, straight, cylindrical stem that does not hand off into a
   rising cap. At t12–t15 the visible lower cloud is a flat, surface-level
   horizontal ring/skirt, while the upper shaft continues toward the solver
   roof. The cause is the small `capScale: 0.88`, `capRoll: 0.85`, `capVertical:
   0.43` source balance plus neutral ground coupling; the physical surface
   contact is legitimate, but the cap shape is not yet convincing.
4. **Insufficient late persistence.** With `dissipation.mode: 0`, the field
   becomes sparse by t20 and inactive by t24–t26 across the captured views.
   The short source sustain (`0.46`), cooling `1.05`, and lack of profile-local
   late velocity retention/curl/shear leave little active cloud after the
   surface ring. This is an artistic persistence/deformation defect, not a
   boundary extinction mask.
5. **Shockwave is coherent but over-dominant by comparison.** The neutral
   analytical shockwave remains event-space coherent (`shock/render` reaches
   about `2.46×` horizontally on desktop and `3.10×` on Mobile) and does not
   show a smoke/shock scale mismatch. Its rings dominate the early composition
   because the fluid body is too pale, cylindrical, and under-structured; no
   additional bands are justified.

The dominant correction path is therefore profile-local: configure the
approved padded domain only to restore roof clearance; then tune source/cap
balance, the existing plume/ground-coupling controls, structured core/material
separation, and a restrained late tail. Global renderer quality, ray/slice
budgets, camera, shockwave, wind, overlays, and all approved neighboring
profiles remain regression locks.

## Early Fission Test Scale candidate refinement (2026-08)

The retained local candidate activates the approved padded-domain path with
`padding: 0.08`, `renderOverscan: 1.04`, `renderExtent: 1.12 × 1.16`,
`riskMargin: 0.07`, and `densityThreshold: 0.14`; `edge.mode` and shockwave
remain neutral. Representative desktop/tablet checkpoints report no visible
solver roof or side wall and `edge: 0.000`; late edge-risk readings are
associated with sparse lower ground material rather than a box silhouette.

The profile-only artistic pass adds the existing ground-coupled source path and
multiple offset kernels. Retained source values are `radius: 0.062`,
`aspectX: 1.16`, `aspectY: 0.82`, `sustainEnd: 0.72`, `radial: 1.08`,
`vertical: 1.30`, `turbulence: 1.18`, `heat: 1.16`, `smoke: 1.25`,
`incandescent: 1.0`, `dust: 1.3`, `capScale: 1.06`, `capRoll: 1.1`,
`capVertical: 0.48`, and `clusterSpread: 1.14`. Physics retains buoyancy
`1.22`, density loading `0.78`, vorticity `1.45`, velocity retention `0.992`,
cooling `0.88`, smoke conversion `1.05`, and scalar retention `0.9997`.

The retained ground-coupling values are radial impulse `0.18`, spread width
`0.32`, height falloff `1.6`, horizontal retention `0.94`, vertical damping
`0.8`, spread window `0.006–0.13`, angular variation `0.32`, asymmetry `0.22`,
surface heat `0.54`, base dust `1.15`, transition lift `0.62`, and late ground
drift `0.04`. Plume mode `3` uses expansion `0.012`, vortex `0.32`, persistence
`0.72`, widening `0.045`, feed taper `0.46–0.70`, lateral jitter `0.4`, and
turbulence blend `0.22`.

Material/core values are soot absorption `1.18`, dust absorption `0.68`,
warm/cool contrast `0.42`, interior depth `0.2`, detail boost `0`,
`detailOctaveMode: 0`, highlight threshold `1.7`, sharpness `2.3`, structure
blend `0.42`, and bloom gate `5.8`. The late tail uses `lateStart: 0.72`,
`finalStart: 1.0`, `sourceTaperEnd: 1.0`, smoke floor `1.0`, dust floor
`0.9998`, outward boost `0.02`, buoyancy falloff `0.25`, motion damping `0.5`,
late velocity retention `0.9985`, curl `0.0015`, shear `0.001`, and phase rate
`0.035`.

Controlled A/B checks rejected a higher persistence-only pass and a
motion-reduction pass: the former kept mass but still lost compact upper
structure, while the latter weakened the mature t15 cap. The retained
direction clearly improves the baseline's smooth cylinder and flat skirt, but
the remaining specific defect is late-tail compactness: after approximately
t19–t20 the cap/stem mass spreads into a low ground haze and the final frame
does not retain a strong upper cloud. This remains a profile-specific artistic
defect; no renderer-wide, camera, shockwave, wind, or quality change is
indicated.

## Underground Detonation visual diagnosis (2026-08)

The fresh deterministic seed-1842 Cinematic baseline was captured in one
hardware-accelerated Chrome session with WebGL2, GPU FLUID, no fallback, no
reported GL error, and no application-origin error at 1440 × 900
Balanced/High, 768 × 1024 Balanced, 1024 × 768 Balanced, and 390 × 844 Mobile.
The preset timeline ends at `15.4 s`; the requested t20/t30 checkpoints were
therefore replaced by `t14.4` (late) and `t15.4` (final).

1. **The profile is still on a legacy fluid path.** Underground currently has
   `domain.mode: 0`, zero padding, neutral render overscan/extent,
   `groundCoupling.mode: 0`, `plume.mode: 0`, `material.mode: 0`,
   `dissipation.mode: 0`, `core.mode: 0`, `edge.mode: 0`, and a neutral
   shockwave profile. The preset metadata identifies the event as
   ground-coupled and below-surface (`defaultAltitude: -0.18`), but the fluid
   profile has not yet opted into the reusable padded/ground-aware systems.
   This explains both the legacy visible-volume diagnostic and why the newer
   ground-contact distinction is not active for this profile.
2. **The nonzero aggregate edge signal is lower physical contact, not a roof or
   side wall.** Direct per-edge readback found top, left, and right density at
   `0.000` at representative stages in every viewport. The only nonzero edge
   was bottom: desktop High reached approximately `0.408` at t9 and `0.533`
   at t12; tablet portrait reached `0.361` and `0.502`; tablet landscape
   reached `0.298` and `0.392`; Mobile reached `0.157` at t9 and `0.141` at
   t12. The bottom signal receded by late/final checkpoints. No screenshot
   showed a flat computational roof, hard side wall, capsule, rectangular
   haze slab, or fallback. Because `groundCoupling.mode` is still neutral,
   the aggregate legacy edge field currently overstates computational risk by
   treating expected lower contact as computational. The retained correction
   should activate existing ground semantics and report bottom contact
   separately; it must not add a mask or enlarge the domain solely to erase
   this physical contact.
3. **The early breakthrough reads as a smooth vertical pillar.** At t0.5 the
   source is a narrow dark column with a faint surface ring. From t3 through
   t9 the upper material becomes a broad, smooth, nearly symmetric dark wall
   with a narrow bright center feed and a bright lower ejecta skirt. The
   current source values (`vertical: 1.55`, `dust: 2.25`, `ejecta: 1.65`) are
   directionally appropriate, but the neutral plume/ground paths provide no
   profile-local rollout, asymmetry, or feed handoff to break the cylindrical
   silhouette.
4. **Ground interaction is heavy but visually homogeneous.** The base remains
   attached to the surface and the radial ground response is visible, yet the
   skirt is broad and smooth rather than articulated ejecta. Neutral material
   shading combined with `opacity: 1.55`, `shadow: 1.55`, `dustVisibility: 2`,
   and `exposure: 0.78` compresses front/middle/rear particulate depth into a
   dark wall with a pale lower sheet. There is no soot/dust separation,
   warm/cool contrast, or interior-depth weighting in the fluid profile.
5. **The late state loses the upper event too quickly.** At t12 the upper
   column is already faint; t14.4 and t15.4 are dominated by low haze and a
   barely legible vertical remnant. Neutral dissipation, scalar retention
   without profile-local motion controls, and the data timeline's
   `dissipation` phase cause the material to lose readable upper structure
   rather than deforming through a sustained particulate tail. This is an
   artistic late-motion/material problem, not boundary extinction.
6. **Mobile is readable early but under-composed late.** At 390 × 844 the
   breakthrough remains centered and the event continues naturally offscreen
   without exposing a solver container. The t3/t7 column is comparatively
   small in the portrait frame, while t12/final reduce to a low, faint haze;
   the problem is loss of useful late material, not excessive camera pullback
   or a visible computational boundary. A profile-local composition change is
   not yet justified before testing the existing plume/material/late controls.
7. **The shock treatment is coherent but visually over-assertive by contrast.**
   The neutral analytical shock remains in the shared event space and reports
   no smoke/shock boundary mismatch. Its early presence reads strongly only
   because the fluid body is smooth and under-layered. No additional bands are
   justified by this baseline.

The smallest existing-system correction path is therefore profile-local:
activate the reusable ground-aware/padded-domain path only as needed to encode
the already-observed physical contact and preserve top/side clearance; then
introduce restrained ground-coupled plume shaping, structured particulate
material, and a late-motion tail. Source scale, camera, shockwave, wind,
overlays, quality budgets, and all approved neighboring presets remain
regression locks. The result must remain subsurface-driven rather than
converging on Ground Burst, Meteor Impact, Volcanic Eruption, or a generic
conventional explosion.

## Underground Detonation candidate refinement (2026-08)

The retained candidate did not require a domain change. Repeated representative
readback kept top, left, and right edge density at `0.000`; the only material
contact was the expected lower ground plane. `domain.mode` therefore remains
`0` with neutral padding, overscan, and render extent. `groundCoupling.mode` is
now `1`, so the same lower contact is reported as physical ground contact and
does not inflate computational-edge risk. The neutral analytical shockwave,
camera, mobile framing, and quality budgets remain unchanged.

The profile-local structural pass uses the existing reusable paths: source
`sustainEnd: 0.64`, physics `buoyancy: 0.82`, `densityLoading: 1.48`,
`windCoupling: 0.72`, `vorticity: 1.58`, `velocityRetention: 0.985`,
`cooling: 1.16`, and `smokeConversion: 1.08`; volume `depth: 1.14`,
`opacity: 1.28`, `shadow: 1.38`, `bloom: 0.46`, `distortion: 0.58`,
`erosion: 1.22`, `noiseScale: 1.30`, `dustVisibility: 1.55`, `exposure: 0.88`,
`backgroundIllumination: 0.06`, and `emissionCurve: 1.08`. Ground coupling
uses radial impulse `0.26`, spread width `0.34`, height falloff `1.8`,
horizontal retention `0.93`, vertical damping `0.76`, spread `0.008–0.16`,
angular variation `0.48`, asymmetry `0.38`, surface heat `0.36`, base dust
`1.4`, transition lift `0.74`, and late ground drift `0.08`.

Plume mode `3` uses expansion `0.008`, vortex `0.42`, persistence `0.82`,
widening `0.028`, feed taper `0.40–0.72`, lateral jitter `0.46`, and
turbulence blend `0.32`. Material mode `1` uses soot absorption `1.35`, dust
absorption `0.75`, detail boost `0.15`, warm/cool contrast `0.34`, interior
depth `0.28`, and `detailOctaveMode: 0`. Core mode `1` uses threshold `0.42`,
sharpness `1.9`, structure blend `0.62`, and bloom gate `5.2`.

The late tail is a restrained profile-local handoff: `lateStart: 0.60`,
`finalStart: 0.96`, `sourceTaperEnd: 0.72`, smoke floor `0.998`, dust floor
`0.994`, outward boost `0.02`, buoyancy falloff `0.20`, motion damping `0.38`,
late velocity retention `0.995`, curl `0.006`, shear `0.004`, and phase rate
`0.045`. Compared with the baseline, the upper vent remains legible longer and
continues to deform while the lower particulate remains attached to the
surface. The final state retains a faint upper remnant rather than clearing to
only low haze; no frozen cap or new containment silhouette was observed.

The final candidate remains a compact subsurface breakthrough rather than a
classic mushroom: its distinctive cues are the heavy ground skirt, asymmetric
vertical vent, soot/dust depth, and subordinate upper haze. The remaining
visual judgment is whether the final upper remnant has enough contrast on
Mobile; no further autonomous browser tuning is justified without a human
visual decision.
