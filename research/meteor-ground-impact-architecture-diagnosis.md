# Meteor Ground Impact: Architecture Diagnosis

Status: retained redesign diagnosis and implementation record on
`meteor-ground-impact-visual-refinement` at
`c8e729cd68068c825eb21104f005eddb610586c0`.

## Visual definition

Meteor Ground Impact is a strictly artistic, educational surface-impact
archetype. Its visual sequence is:

`IMPACT → RADIAL EJECTA → ASYMMETRIC PARTICULATE MASSES → CHAOTIC RISING
IMPACT PLUME → LINGERING DUST / DEBRIS HAZE`

The event must show an external ground anchor, immediate outward ejecta,
several unequal overlapping near-ground masses, directional bias, an offset
and irregular rising plume, particulate cavities, and a broad late dust field.
It must not establish a nuclear stem/cap hierarchy, a volcanic vent, an
underground breakthrough, a floating Fuel-Air cloud, or a compact conventional
puff. The definition contains no operational, construction, targeting,
destructive-effect, or real-world impact guidance.

## Baseline failure

The current profile is `meteor-impact-fluid-v1`, `profileKind: 6`, with these
source primitives:

- `elongated-trail`
- `directional-impulse`
- `vertical-jet`
- `ejecta-curtain`
- `ground-sheet`

Its source is surface-anchored at normalized `groundLevel: 0.18`, but
`groundCoupling.mode` is 0 and `plume.mode` is 0. The source names therefore
describe intent without selecting a dedicated transport path.

The generic scalar path resolves `profileCombinedKernel()` from one centered
`profileBaseKernel()`, the same centered `profileVerticalKernel()`, and a
shared `profileMultiKernel()` used mostly as a detail weight. `profileEjectaKernel`
and `profileGroundKernel` add material around that center, but they do not
become independent advected source centers. The resulting field begins with a
real impact and early radial spread, then merges into one reservoir.

The generic force path reinforces that merge. It applies one centered radial
weight, one centered vertical feed, a legacy ground impulse when mode 0 is
active, and no profile-specific lobe transport. The later generic plume branch
is also neutral, while the common buoyancy/ceiling handling lifts the merged
reservoir as one body. In a projected 2.5D density field this creates the
observed smooth lower mass, narrow central column, and dark side-wall
appearance. The ground skirt is smooth because the legacy sheet has no seeded
unequal lobe persistence, and the late field thins quickly because dissipation
mode 0 leaves late motion/retention neutral.

Material mode 0 keeps soot, dust, warm/cool contrast, low-density visibility,
interior depth, and emission coupling neutral. That preserves old behavior but
provides little particulate depth once the field has merged. The current
profile also has no physical ground-coupling semantic exemption, so bottom
density at mature times is reported as computational contact even though the
visual source is surface-origin.

## Dedicated-mode design constraints

The smallest sufficient architecture is one immutable, profile-gated Meteor
impact mode using the existing solver, curl detail, scalar channels, pressure
projection, tracers, compositor, and diagnostics. It should:

1. resolve a small deterministic set of unequal radial/ground lobes from the
   existing seed offsets;
2. retain a primary impact center while giving one or two lobes stronger
   directional bias and different lift;
3. advect several overlapping particulate masses instead of one centered
   reservoir;
4. decentralize upward motion without creating separate columns or a centered
   core band;
5. use existing ground semantics only for actual surface-region contact;
6. remain neutral for every non-Meteor profile; and
7. use no new solver, pass, render target, or quality-budget increase.

Development is staged: source/ejecta identity first, decentralized plume
second, ground semantics/domain third, material depth fourth, and late motion
last. Each retained stage must be checked at 390×844 Mobile and against Nuclear
Ground Burst before proceeding.

## Retained profile-gated implementation

The retained candidate uses `impactPlume.mode: 1` only for Meteor Ground
Impact. Its normalized controls are `lobeSpread: 1`, `directionalBias: 0.72`,
`liftVariation: 0.58`, `breakup: 0.78`, `verticalSpread: 0.72`,
`groundPersistence: 0.64`, `lateralRoll: 0.74`, and `upperDrift: 0.48`.
The shader resolves four unequal deterministic lobe centers plus a small
central bridge from the existing
seed offsets: four low-to-mid ejecta masses and one laterally offset upper
mass. A small bridge remains for event coherence. The mode reuses the existing
curl-detail and scalar samples, tracer budget, pressure projection, and
rendering passes; it adds no texture read, solver, render target, or quality
tier.

Meteor uses `groundCoupling.mode: 1` for physical-contact classification only.
Its radial impulse, spread timing, angular variation, surface heat, base dust,
transition lift, and late ground drift are all neutral. The dedicated impact
branch runs before the generic ground-dynamics branch, so Nuclear Ground Burst
motion is not inherited. Profile-local domain padding is `0.14`, with render
overscan `1.04`, active scale `0.72`, render extent `1.35 × 1.18`, and risk
margin `0.07`; lower risk-margin cells are reported as physical ground contact,
while top/left/right remain computational-risk edges.

The existing material mode 1 is used conservatively (`sootAbsorption: 1.15`,
`dustAbsorption: 0.88`, `warmCoolContrast: 0.28`,
`lowDensityVisibility: 0.24`, `interiorDepth: 0.22`,
`detailOctaveMode: 0`). The existing late-dissipation mode 1 supplies the
impulsive event's tail (`lateStart: 0.42`, `finalStart: 1`,
`sourceTaperEnd: 0.68`, smoke/dust floors `0.9999`/`0.9995`, outward boost
`0.018`, buoyancy falloff `0.22`, motion damp `0.38`, velocity retention
`0.997`, curl/shear `0.005`/`0.003`, phase rate `0.04`). These controls thin
the existing particulate field and keep it moving; they do not create a new
late source.
