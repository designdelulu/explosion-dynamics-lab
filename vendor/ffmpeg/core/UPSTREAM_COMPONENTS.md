# FFmpeg WebAssembly upstream components and source ledger

This file accompanies the vendored `@ffmpeg/core` 0.12.10 ESM loader and
single-thread WebAssembly binary. The package manifest declares the core
`GPL-2.0-or-later`; the retained text is in `LICENSE.GPL-2.0.txt`.

The binary was published as part of ffmpeg.wasm release `v12.15`. Its embedded
configuration string and the release Dockerfile show `--enable-gpl` and the
linked libraries below. The authoritative build definition is:

<https://github.com/ffmpegwasm/ffmpeg.wasm/blob/v12.15/Dockerfile>

| Component in the combined core | Release build revision | License / notice | Source |
| --- | --- | --- | --- |
| FFmpeg | `n5.1.4` | GPL-2.0-or-later for this `--enable-gpl` build; [local summary](licenses/FFmpeg-LICENSE.md) | <https://github.com/FFmpeg/FFmpeg/tree/n5.1.4> |
| x264 | `4-cores` branch | GPL version 2 or later; [local `COPYING`](licenses/x264-COPYING.txt) | <https://github.com/ffmpegwasm/x264/tree/4-cores> |
| x265 | `3.4` branch | GPL version 2; [local `COPYING`](licenses/x265-COPYING.txt) | <https://github.com/ffmpegwasm/x265/tree/3.4> |
| libvpx | `v1.13.1` | BSD-3-Clause; [local notice](licenses/libvpx-LICENSE.txt) | <https://github.com/ffmpegwasm/libvpx/tree/v1.13.1> |
| LAME | `master` as referenced by the release build | LGPL-2.0-or-later library; [local `COPYING`](licenses/LAME-COPYING.txt) and [use notice](licenses/LAME-LICENSE.txt) | <https://github.com/ffmpegwasm/lame> |
| Ogg | `v1.3.4` | BSD-3-Clause; [local notice](licenses/Ogg-COPYING.txt) | <https://github.com/ffmpegwasm/Ogg/tree/v1.3.4> |
| Theora | `v1.1.1` | BSD-3-Clause; [local notice](licenses/Theora-COPYING.txt) | <https://github.com/ffmpegwasm/theora/tree/v1.1.1> |
| Opus | `v1.3.1` | BSD-3-Clause; [local notice](licenses/Opus-COPYING.txt) | <https://github.com/ffmpegwasm/opus/tree/v1.3.1> |
| Vorbis | `v1.3.3` | BSD-3-Clause; [local notice](licenses/Vorbis-COPYING.txt) | <https://github.com/ffmpegwasm/vorbis/tree/v1.3.3> |
| zlib | `v1.2.11` | Zlib; [local notice](licenses/zlib-README.txt) | <https://github.com/ffmpegwasm/zlib/tree/v1.2.11> |
| libwebp | `v1.3.2` | BSD-3-Clause; [local notice](licenses/WebP-COPYING.txt) | <https://github.com/ffmpegwasm/libwebp/tree/v1.3.2> |
| FreeType | `VER-2-10-4` | [FreeType License](licenses/FreeType-FTL.txt) or [GPL-2.0-only](licenses/FreeType-GPLv2.txt) | <https://github.com/ffmpegwasm/freetype2/tree/VER-2-10-4> |
| FriBidi | `v1.0.9` | LGPL-2.1-or-later; [local `COPYING`](licenses/FriBidi-COPYING.txt) | <https://github.com/fribidi/fribidi/tree/v1.0.9> |
| HarfBuzz | `5.2.0` | MIT; [local notice](licenses/HarfBuzz-COPYING.txt) | <https://github.com/harfbuzz/harfbuzz/tree/5.2.0> |
| libass | `0.15.0` | ISC; [local notice](licenses/libass-COPYING.txt) | <https://github.com/libass/libass/tree/0.15.0> |
| zimg | `release-3.0.5` | WTFPL-2.0; [local `COPYING`](licenses/zimg-COPYING.txt) | <https://github.com/sekrit-twc/zimg/tree/release-3.0.5> |
| Emscripten-generated runtime | Emscripten `3.1.40` build image | MIT/NCSA terms; [local license](licenses/Emscripten-LICENSE.txt) | <https://github.com/emscripten-core/emscripten/tree/3.1.40> |

FFmpeg's own license explanation confirms that enabling GPL code and linking
x264/x265 makes the resulting FFmpeg build GPL-covered:

<https://github.com/FFmpeg/FFmpeg/blob/n5.1.4/LICENSE.md>

The ffmpeg.wasm wrapper/build source corresponding to the published package is:

- <https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15>
- <https://github.com/ffmpegwasm/ffmpeg.wasm/archive/refs/tags/v12.15.tar.gz>

The upstream Dockerfile pins the versions shown above except LAME, which it
references by the mutable `master` branch. Before public redistribution, the
site owner should retain this ledger and the package license files and should
review whether a locally hosted corresponding-source bundle or other source
offer is required for the intended distribution. This ledger is factual
attribution, not legal advice.
