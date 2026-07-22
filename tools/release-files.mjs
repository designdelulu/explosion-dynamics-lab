export const ROOT_SOURCE_FILES = Object.freeze([
  ".htaccess",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "explosion-dynamics-lab-social.png",
]);

export const RUNTIME_SOURCE_FILES = Object.freeze([
  "assets/styles.css",
  "scripts/app.js",
  "scripts/build-info.js",
  "scripts/data.js",
  "scripts/exporter.js",
  "scripts/fluid-engine.js",
  "scripts/renderer.js",
]);

export const VENDOR_SOURCE_FILES = Object.freeze([
  "vendor/ffmpeg/ffmpeg/classes.js",
  "vendor/ffmpeg/ffmpeg/const.js",
  "vendor/ffmpeg/ffmpeg/errors.js",
  "vendor/ffmpeg/ffmpeg/index.js",
  "vendor/ffmpeg/ffmpeg/types.js",
  "vendor/ffmpeg/ffmpeg/utils.js",
  "vendor/ffmpeg/ffmpeg/worker.js",
  "vendor/ffmpeg/ffmpeg/package.json",
  "vendor/ffmpeg/ffmpeg/LICENSE.MIT.txt",
  "vendor/ffmpeg/core/ffmpeg-core.js",
  "vendor/ffmpeg/core/ffmpeg-core.wasm",
  "vendor/ffmpeg/core/package.json",
  "vendor/ffmpeg/core/LICENSE.GPL-2.0.txt",
  "vendor/ffmpeg/core/UPSTREAM_COMPONENTS.md",
  "vendor/ffmpeg/core/licenses/FFmpeg-LICENSE.md",
  "vendor/ffmpeg/core/licenses/x264-COPYING.txt",
  "vendor/ffmpeg/core/licenses/x265-COPYING.txt",
  "vendor/ffmpeg/core/licenses/libvpx-LICENSE.txt",
  "vendor/ffmpeg/core/licenses/LAME-COPYING.txt",
  "vendor/ffmpeg/core/licenses/LAME-LICENSE.txt",
  "vendor/ffmpeg/core/licenses/Ogg-COPYING.txt",
  "vendor/ffmpeg/core/licenses/Theora-COPYING.txt",
  "vendor/ffmpeg/core/licenses/Opus-COPYING.txt",
  "vendor/ffmpeg/core/licenses/Vorbis-COPYING.txt",
  "vendor/ffmpeg/core/licenses/zlib-README.txt",
  "vendor/ffmpeg/core/licenses/WebP-COPYING.txt",
  "vendor/ffmpeg/core/licenses/FreeType-FTL.txt",
  "vendor/ffmpeg/core/licenses/FreeType-GPLv2.txt",
  "vendor/ffmpeg/core/licenses/FriBidi-COPYING.txt",
  "vendor/ffmpeg/core/licenses/HarfBuzz-COPYING.txt",
  "vendor/ffmpeg/core/licenses/libass-COPYING.txt",
  "vendor/ffmpeg/core/licenses/zimg-COPYING.txt",
  "vendor/ffmpeg/core/licenses/Emscripten-LICENSE.txt",
]);

export const SOURCE_INPUT_FILES = Object.freeze([
  "index.html",
  ...ROOT_SOURCE_FILES,
  ...RUNTIME_SOURCE_FILES,
  ...VENDOR_SOURCE_FILES,
]);

export const OBSOLETE_REMOTE_PATHS = Object.freeze([
  "assets/styles.css",
  "scripts/app.js",
  "scripts/build-info.js",
  "scripts/data.js",
  "scripts/exporter.js",
  "scripts/fluid-engine.js",
  "scripts/renderer.js",
]);

// These paths were observed in the July 2026 wrong-root upload, or are stable
// probes for the same class of mistake. A production verification is not
// complete until they return 404. Keep this list intentionally explicit: the
// verifier must never crawl, guess a hosting path, or download server content
// back into the authoritative standalone source.
export const REMOTE_PATHS_REQUIRED_ABSENT = Object.freeze([
  ...OBSOLETE_REMOTE_PATHS,
  "README.md",
  "AUDIT-REPORT.md",
  "LOCAL-COPY-RECONCILIATION.json",
  "RESEARCH-NOTES.md",
  "research/README.md",
  "tools/build-production.mjs",
  "tools/verify-production.mjs",
  "scripts/deploy-production.sh",
  "dist/production/explosion-dynamics-lab/index.html",
  "dist/production/explosion-dynamics-lab/deployment-manifest.json",
  "dist/production/explosion-dynamics-lab/releases/9ee57c1fc18a1267/scripts/app.js",
  "dist/production/explosion-dynamics-lab/vendor-releases/9593b373261a5c1a/ffmpeg/core/ffmpeg-core.wasm",
  "dist/packages/explosion-dynamics-lab-9ee57c1fc18a1267.tar.gz",
]);

export const REQUIRED_UPLOAD_ROOT_ENTRIES = Object.freeze([
  ".htaccess",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "deployment-manifest.json",
  "explosion-dynamics-lab-social.png",
  "index.html",
  "releases",
  "vendor-releases",
]);

export const DEPLOYMENT_EXCLUSIONS = Object.freeze([
  ".git/",
  ".gitignore",
  ".DS_Store",
  ".idea/",
  ".vscode/",
  "AUDIT-REPORT.md",
  "LOCAL-COPY-RECONCILIATION.json",
  "README.md",
  "RESEARCH-NOTES.md",
  "research/",
  "tools/",
  "node_modules/",
  "dist/",
  "exports/",
  "recordings/",
  "browser-test-artifacts/",
  "debug-screenshots/",
  "*.png exports (the named social image remains allowlisted)",
  "*.mp4",
  "*.webm",
  "*.mov",
  "*.tmp",
]);
