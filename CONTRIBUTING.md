# Contributing to Explosion Dynamics Lab

Thanks for helping improve the lab. Contributions should strengthen the
educational visualization, rendering quality, accessibility, documentation, or
browser compatibility without turning the project into a predictive or
operational blast tool.

## Safety scope

Do not add explosive construction, materials or ratios, trigger systems,
weapon design, delivery systems, targeting, real maps or coordinates, casualty
estimates, damage optimization, or exact engineering predictions. Presets and
controls must remain dimensionless artistic or educational approximations.

## Development workflow

1. Fork and clone the repository.
2. Create a focused branch.
3. Serve the repository over HTTP, for example with
   `python3 -m http.server 4173`.
4. Make a small, reviewable change.
5. Run `./scripts/deploy-production.sh test`.
6. Test affected Cinematic and Overview presets in a current browser.
7. Open a pull request using the repository template.

For renderer changes, test deterministic replay, timeline seeking, wind,
reduced motion, Mobile/Balanced/High tiers, PNG export, and genuine MP4 export.
Check the console for shader, framebuffer, and context errors. Include before
and after screenshots when appearance changes.

## Code and documentation

- Keep source dependency-free and compatible with native ES modules.
- Preserve the fixed 30 Hz simulation step and deterministic seed behavior.
- Keep Canvas as an explicit analytical or compatibility layer, not a silent
  substitute during GPU export.
- Document new source primitives, profiles, shader assumptions, third-party
  assets, and known limitations.
- Do not commit generated `dist/`, exports, recordings, debug screenshots, or
  local deployment records.

By contributing, you agree that your contribution is licensed under the
project's MIT license, except for files under `vendor/`, which retain their own
upstream terms.
