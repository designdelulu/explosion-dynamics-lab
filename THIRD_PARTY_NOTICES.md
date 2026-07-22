# Third-party notices

Explosion Dynamics Lab's first-party implementation is released under the MIT
License in [`LICENSE`](LICENSE), copyright © 2026 Eric Barker. That project
license applies to the first-party implementation only. It excludes the
third-party files under `vendor/` and does not relicense them.

## Vendored FFmpeg WebAssembly fallback

The following packages are included so a browser that cannot record a valid
native MP4 can perform an on-demand, local conversion. They are served from the
same origin and are loaded only after the user requests an MP4 export that takes
the FFmpeg route.

| Vendored component | Version | License declared by retained package metadata | Local license |
| --- | ---: | --- | --- |
| `@ffmpeg/ffmpeg` browser wrapper | 0.12.15 | MIT | [`vendor/ffmpeg/ffmpeg/LICENSE.MIT.txt`](vendor/ffmpeg/ffmpeg/LICENSE.MIT.txt) |
| `@ffmpeg/core` single-thread core | 0.12.10 | GPL-2.0-or-later | [`vendor/ffmpeg/core/LICENSE.GPL-2.0.txt`](vendor/ffmpeg/core/LICENSE.GPL-2.0.txt) |

The wrapper's retained manifest is
[`vendor/ffmpeg/ffmpeg/package.json`](vendor/ffmpeg/ffmpeg/package.json). Its
JavaScript entry point and relative worker modules live in that directory.

The core's retained manifest is
[`vendor/ffmpeg/core/package.json`](vendor/ffmpeg/core/package.json). Its
ESM `ffmpeg-core.js` loader and `ffmpeg-core.wasm` binary are governed by the
terms declared in that manifest and the included GPL license text. The binary
also statically links FFmpeg and codec, image, text, and compression libraries.
Their release revisions, license identifiers, notice locations, and source
links are recorded in the deployed
[`UPSTREAM_COMPONENTS.md`](vendor/ffmpeg/core/UPSTREAM_COMPONENTS.md) ledger.
The exact upstream copyright, license, and disclaimer files referenced by that
ledger are retained locally under [`vendor/ffmpeg/core/licenses/`](vendor/ffmpeg/core/licenses/)
and are part of the required website deployment allowlist.

The upstream project published `@ffmpeg/ffmpeg` 0.12.15 together with
`@ffmpeg/core` 0.12.10 in its `v12.15` release:

- Release record and source tag:
  <https://github.com/ffmpegwasm/ffmpeg.wasm/releases/tag/v12.15>
- Source repository: <https://github.com/ffmpegwasm/ffmpeg.wasm>
- Tagged wrapper/build source archive:
  <https://github.com/ffmpegwasm/ffmpeg.wasm/archive/refs/tags/v12.15.tar.gz>

That tagged archive contains the build definition, which fetches several
separate dependency repositories; it is not by itself a combined archive of
every linked library. The component ledger links those inputs individually and
notes the one mutable branch used by the upstream release build.

The retained package manifests and license files are authoritative for the
vendored copies. Anyone redistributing or changing these files should review
and comply with those actual terms, preserve the manifests and notices, and
continue to provide the corresponding source access or offer required by the
applicable license. Public redistributors should review whether the linked
source ledger is sufficient for their distribution method or whether they must
host a complete corresponding-source bundle. Do not assume the first-party MIT
License replaces or weakens the vendored core's GPL-2.0-or-later terms.

When updating either package, keep compatible wrapper/core versions together,
retain the new distribution's manifests and complete license/notices, and
update this file and its corresponding-source link to match the artifacts
actually distributed.
