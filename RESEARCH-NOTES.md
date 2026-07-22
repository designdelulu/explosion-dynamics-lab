# Explosion Dynamics Lab — Research Notes

## Scope and provenance

These notes cover only post-detonation atmospheric visualization: shock optics, hot-gas motion, smoke, dust, turbulence, participating-media rendering, and real-time numerical methods. They do **not** adapt or expose explosive materials, construction, charge geometry, triggering, weapon design, object destruction, targeting, casualty modeling, real-world damage calculations, or optimization. All application controls remain normalized visual controls.

The requested local `research/` directory was not present in the workspace or supplied attachments on 2026-07-22. To avoid blocking the implementation, the exact papers were read from author/publisher copies:

- Gary D. Yngve, James F. O'Brien, and Jessica K. Hodgins, *Animating Explosions* (SIGGRAPH 2000 author preprint): <https://arxiv.org/pdf/2303.10541>
- Ronald Fedkiw, Jos Stam, and Henrik Wann Jensen, *Visual Simulation of Smoke* (SIGGRAPH 2001): <https://graphics.stanford.edu/papers/smoke/smoke.pdf>
- Duc Quang Nguyen, Ronald Fedkiw, and Henrik Wann Jensen, *Physically Based Modeling and Animation of Fire* (SIGGRAPH 2002): <https://graphics.stanford.edu/papers/fire-sg02/fire_final.pdf>
- Nick Rasmussen, Duc Quang Nguyen, Willi Geiger, and Ronald Fedkiw, *Smoke Simulation for Large Scale Phenomena* (SIGGRAPH 2003): <https://graphics.stanford.edu/papers/smoke-sig03/smoke.pdf>

All 29 pages were text-extracted and rendered for visual inspection. The implementation is an educational visual model, not an engineering or predictive blast model.

## Paper-to-browser mapping

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
