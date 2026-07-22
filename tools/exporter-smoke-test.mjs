import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  detectExportCapabilities,
  isIsoBmffMp4,
} from "../scripts/exporter.js";

function asciiBytes(value) {
  assert.equal(value.length, 4, `ISO-BMFF identifiers must be four characters: ${value}`);
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function concatenate(...chunks) {
  const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function isoBox(type, payload = new Uint8Array()) {
  const result = new Uint8Array(8 + payload.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, result.length, false);
  result.set(asciiBytes(type), 4);
  result.set(payload, 8);
  return result;
}

function ftypBox(majorBrand, compatibleBrands = []) {
  const minorVersion = new Uint8Array(4);
  new DataView(minorVersion.buffer).setUint32(0, 0x00000200, false);
  return isoBox(
    "ftyp",
    concatenate(asciiBytes(majorBrand), minorVersion, ...compatibleBrands.map(asciiBytes)),
  );
}

const standardMp4 = new Blob([ftypBox("isom", ["iso6", "mp42"]), isoBox("free")], {
  type: "video/mp4",
});
assert.equal(await isIsoBmffMp4(standardMp4), true, "A standard isom/mp42 MP4 header was rejected");

const compatibleBrandMp4 = new Blob(
  [isoBox("free"), ftypBox("qt  ", ["avc1", "mp41"])],
  { type: "application/octet-stream" },
);
assert.equal(
  await isIsoBmffMp4(compatibleBrandMp4),
  true,
  "A valid compatible MP4 brand after an allowed leading box was rejected",
);

const renamedWebm = new Blob(
  [Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81)],
  { type: "video/mp4" },
);
assert.equal(await isIsoBmffMp4(renamedWebm), false, "A MIME-renamed WebM was accepted as MP4");

const truncatedFtyp = new Blob([ftypBox("isom", ["mp42"]).subarray(0, 12)], {
  type: "video/mp4",
});
assert.equal(await isIsoBmffMp4(truncatedFtyp), false, "A truncated ftyp box was accepted as MP4");

const forgedOversizeFtypBytes = ftypBox("isom", ["mp42"]);
new DataView(forgedOversizeFtypBytes.buffer).setUint32(0, 1000, false);
const forgedOversizeFtyp = new Blob([forgedOversizeFtypBytes], { type: "video/mp4" });
assert.equal(
  await isIsoBmffMp4(forgedOversizeFtyp),
  false,
  "An ftyp box whose declared size exceeds the Blob was accepted as MP4",
);

const unsupportedBrand = new Blob([ftypBox("qt  ", ["qt  "])], { type: "video/mp4" });
assert.equal(await isIsoBmffMp4(unsupportedBrand), false, "An unsupported ISO-BMFF brand was accepted as MP4");

const globalKeysBefore = Reflect.ownKeys(globalThis);
const capabilitiesBefore = detectExportCapabilities();
const capabilitiesAfter = detectExportCapabilities();
const globalKeysAfter = Reflect.ownKeys(globalThis);

assert.deepEqual(capabilitiesAfter, capabilitiesBefore, "Capability detection must be deterministic in Node");
assert.deepEqual(globalKeysAfter, globalKeysBefore, "Capability detection must not add or remove globals");
assert.equal(capabilitiesBefore.canvasCapture, false);
assert.equal(capabilitiesBefore.mediaRecorder, false);
assert.equal(capabilitiesBefore.canQueryMimeTypes, false);
assert.equal(capabilitiesBefore.supported, false);
assert.equal(capabilitiesBefore.nativeMp4, false);
assert.equal(capabilitiesBefore.nativeMp4MimeType, null);
assert.deepEqual(capabilitiesBefore.supportedMp4MimeTypes, []);
assert.equal(capabilitiesBefore.webmIntermediate, false);
assert.equal(capabilitiesBefore.webmMimeType, null);
assert.deepEqual(capabilitiesBefore.supportedWebmMimeTypes, []);
assert.equal(capabilitiesBefore.canAttemptFfmpegFallback, false);
assert.ok(Object.isFrozen(capabilitiesBefore), "Capability results must be immutable");
assert.ok(Object.isFrozen(capabilitiesBefore.supportedMp4MimeTypes));
assert.ok(Object.isFrozen(capabilitiesBefore.supportedWebmMimeTypes));

const [workerSource, coreSource, exporterSource] = await Promise.all([
  readFile(new URL("../vendor/ffmpeg/ffmpeg/worker.js", import.meta.url), "utf8"),
  readFile(new URL("../vendor/ffmpeg/core/ffmpeg-core.js", import.meta.url), "utf8"),
  readFile(new URL("../scripts/exporter.js", import.meta.url), "utf8"),
]);
assert.match(workerSource, /await import[\s\S]*\.default/, "The wrapper worker must load an ESM default export");
assert.match(coreSource, /export default createFFmpegCore;/, "The vendored core must be the matching ESM build");
assert.match(exporterSource, /recordDeterministicCanvas[\s\S]*finally\s*\{[\s\S]*mediaTrack\.stop\(\)/, "Every recorder path must stop all capture tracks in finally");
assert.match(exporterSource, /transcodeWebmToMp4[\s\S]*finally\s*\{[\s\S]*safeDeleteFfmpegFile[\s\S]*ffmpeg\.terminate\(\)/, "FFmpeg files, worker, and WASM memory must be released in finally");
assert.match(exporterSource, /exportMp4[\s\S]*finally\s*\{[\s\S]*exportInProgress\s*=\s*false/, "Export lock must be released after success, failure, or cancellation");

console.log("Explosion Dynamics Lab exporter smoke test: PASS");
console.log("  genuine ISO-BMFF MP4 structures and compatible brands accepted");
console.log("  renamed WebM, truncated data, and unsupported brands rejected");
console.log("  Node capability detection is deterministic, immutable, and side-effect-free");
console.log("  capture tracks, FFmpeg files/worker memory, and export lock have finally-path cleanup");
console.log("  vendored module worker and FFmpeg core use a compatible ESM contract");
