# Fuel-Air Visual Archetype: Redesign Diagnosis

Status: pre-implementation diagnosis on `fuel-air-visual-refinement` at
`c6a96a5611be7b6848da60c47a89ba451a36f4e1`.

## Visual definition

Fuel-Air is an artistic, educational post-event visualization archetype. Its
identity is a broad, lateral, low-to-mid-altitude atmospheric combustion cloud:
a thick connected body made from several unequal, overlapping lobes, with an
irregular perimeter, strong lateral rolling motion, hot residual pockets, and
darker smoky material inside and behind it. The lobes must merge into one
event-scale cloud rather than read as separate fireballs.

The silhouette should remain distinct from a nuclear mushroom, Ground Burst,
Volcanic Eruption, Underground Detonation, and a compact conventional fireball.
It should not establish a clean stem/cap hierarchy, a centered torus, a flat
disk, a rectangular container, or a smooth perfect sphere. Its late state should
remain a broad fragmented smoky field with curl and lateral drift.

This definition is strictly visual. It contains no operational weapon,
construction, mixture, ignition, targeting, damage, casualty, or performance
guidance.

## Why the current profile becomes a capsule or mushroom

The current Fuel-Air profile is `profileKind: 3` with the generic profile path.
Its source primitives name a sustained region, ring, offset kernels, and a
turbulent cluster, but `profileCombinedKernelWithoutTrail()` still resolves
them through one `profileBaseKernel()` centered at `profileSourceCenter()`, a
single ring around that same center, and a shared `profileMultiKernel()` added
on top. The accumulated scalar field therefore starts as one centered reservoir
with secondary detail, not as several independently advected centers.

The current source motion repeats the same bias. The generic branch derives one
`primitiveRadial` direction from the source center, adds only a small vertical
kernel contribution, and uses the multi-kernel primarily as a turbulence weight.
There is no profile-specific lateral lobe motion or relative roll. Once the
source has merged, the solver sees one dominant body and buoyancy lifts it as a
single unit. In a 2D projected density field this produces the observed broad
capsule/barrel: smooth central mass, symmetric sides, and a top that is limited
by the solver ceiling rather than folded by internal lobe motion.

### Mode 0 — current neutral path

Mode 0 is deliberately inert for the reusable plume mechanism. That preserves
the generic source/force/scalar behavior, but it also means Fuel-Air receives no
dedicated multi-center transport. Its existing ring and kernel names do not
change the fact that the field is centered and radially organized.

### Mode 1 — historical-scale plume path

Mode 1 is the historical broad-plume path. It introduces a rising analytic
vortex population, a widening corridor, ceiling return, and a paired cap-style
circulation when the corresponding source primitive is enabled. Those controls
assume an upward-developing umbrella. Applying that geometry to Fuel-Air would
add a cap-like crown and reinforce vertical organization rather than create a
low, broad rolling body.

### Mode 2 — compact low-yield plume path

Mode 2 combines altitude-dependent outward expansion with a centered `coreBand`
vertical feed and a small set of rising analytic vortices. The feed is useful
for a compact plume identity, but it creates a central stem/corridor. Increasing
its expansion or vortex strength makes the surrounding body look like a
mushroom cap around that corridor; reducing it leaves a smooth compact
fireball. Neither setting supplies Fuel-Air's required overlapping lateral
centers.

### Mode 3 — ground-coupled plume path

Mode 3 is the separately balanced ground-coupled path. Its surface flow,
transition lift, near-ground damping, and generic central feed are designed for
Ground Burst and related profiles. Reusing it for Fuel-Air would make the cloud
read as a ground-fed stem or a Ground Burst variant. It also treats the lower
region as a meaningful coupled surface layer, which is not the intended identity
for this profile.

## Minimum architecture difference

The smallest sufficient change is one new profile-gated Fuel-Air cloud mode,
selected through immutable profile configuration rather than a preset-ID check.
The mode should:

1. inject three to five deterministic, unequal, horizontally distributed
   source lobes with small vertical and phase offsets;
2. keep the lobes wide enough to merge into one connected thermal body;
3. add lobe-relative lateral drift and rolling motion that persists into the
   developing and mature phases;
4. use a modest vertical lift bias without a centered `coreBand`, cap torus, or
   rising umbrella assumption;
5. apply a deterministic asymmetry from the existing seed offsets; and
6. remain inert for every other profile and for the existing plume modes.

The mode can reuse the existing solver, curl detail, pressure projection,
scalar channels, tracer path, volume compositor, late-dissipation controls, and
padded-domain architecture. It does not require a new solver, a boundary mask,
or an extra render pass. If domain occupancy remains high after the silhouette
is corrected, Fuel-Air may opt into the existing padded active region with
profile-local padding and render extent; all four outer solver boundaries are
computational-risk boundaries for this profile, while the profile does not
claim a legitimate ground-contact exemption.

## Staged acceptance sequence

- Source stage: verify merged, irregular connected hot volumes before adding
  plume forces.
- Plume stage: add lateral roll, widening, and asymmetry without introducing a
  stem/cap hierarchy.
- Domain stage: use the existing padding/overscan/extent controls only if the
  top, bottom, left, or right diagnostics show actual solver occupancy.
- Material stage: use existing soot/dust absorption, warm/cool contrast,
  interior depth, low-density visibility, opacity, exposure, shadow, bloom, and
  erosion/distortion controls after the silhouette is stable.
- Late stage: use profile-local dissipation/retention so the broad cloud keeps
  lateral curl while thinning gradually.

Mobile at 390x844 is a first-class acceptance target after each retained
structural stage. The target is a large, readable, internally layered cloud
with natural offscreen continuation, not a camera pullback that hides solver
limitations.

