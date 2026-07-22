/**
 * Deterministic, browser-only MP4 export for Explosion Dynamics Lab.
 *
 * This module deliberately has no startup dependencies. FFmpeg is imported only
 * when an export explicitly takes the fallback route.
 */

export const MP4_MIME_CANDIDATES = Object.freeze([
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1.4D401F",
  "video/mp4;codecs=avc1.640028",
  "video/mp4",
]);

export const WEBM_MIME_CANDIDATES = Object.freeze([
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
]);

const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "iso7",
  "iso8",
  "iso9",
  "avc1",
  "mp41",
  "mp42",
  "M4V ",
  "M4VH",
  "MSNV",
  "dash",
]);

const ROUTES = new Set(["auto", "native", "ffmpeg"]);
const FFMPEG_MODULE_PATH = "../vendor/ffmpeg/ffmpeg/index.js";
const FFMPEG_CORE_PATH = "../vendor/ffmpeg/core/ffmpeg-core.js";
const FFMPEG_WASM_PATH = "../vendor/ffmpeg/core/ffmpeg-core.wasm";

let exportInProgress = false;

/** A friendly export failure. `recoveryBlob`, when present, is always WebM. */
export class Mp4ExportError extends Error {
  constructor(message, { code = "MP4_EXPORT_FAILED", cause, recoveryBlob = null } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "Mp4ExportError";
    this.code = code;
    this.recoveryBlob = recoveryBlob;
    this.recoveryMimeType = recoveryBlob?.type || null;
    this.recoveryFilename = recoveryBlob ? "explosion-dynamics-recovery.webm" : null;

    // Older Safari versions do not implement Error's `cause` option.
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

/**
 * Return synchronous capability information without fetching or importing FFmpeg.
 */
export function detectExportCapabilities() {
  const Canvas = globalThis.HTMLCanvasElement;
  const Recorder = globalThis.MediaRecorder;
  const canvasCapture = Boolean(Canvas?.prototype?.captureStream);
  const mediaRecorder = typeof Recorder === "function";
  const canQueryMimeTypes = mediaRecorder && typeof Recorder.isTypeSupported === "function";

  const supportedMp4MimeTypes = canQueryMimeTypes
    ? MP4_MIME_CANDIDATES.filter((mimeType) => safelySupportsMimeType(Recorder, mimeType))
    : [];
  const supportedWebmMimeTypes = canQueryMimeTypes
    ? WEBM_MIME_CANDIDATES.filter((mimeType) => safelySupportsMimeType(Recorder, mimeType))
    : [];

  return Object.freeze({
    canvasCapture,
    mediaRecorder,
    canQueryMimeTypes,
    supported: canvasCapture && mediaRecorder,
    nativeMp4: canvasCapture && supportedMp4MimeTypes.length > 0,
    nativeMp4MimeType: supportedMp4MimeTypes[0] || null,
    supportedMp4MimeTypes: Object.freeze(supportedMp4MimeTypes),
    webmIntermediate: canvasCapture && supportedWebmMimeTypes.length > 0,
    webmMimeType: supportedWebmMimeTypes[0] || null,
    supportedWebmMimeTypes: Object.freeze(supportedWebmMimeTypes),
    canAttemptFfmpegFallback: Boolean(
      canvasCapture &&
        supportedWebmMimeTypes.length &&
        globalThis.WebAssembly &&
        globalThis.Worker &&
        globalThis.Blob &&
        globalThis.URL,
    ),
  });
}

/**
 * Check for an ISO-BMFF `ftyp` box carrying an MP4-compatible brand.
 * This intentionally rejects a WebM Blob even if its MIME type was changed.
 */
export async function isIsoBmffMp4(blob) {
  if (!isBlobLike(blob) || blob.size < 16) return false;

  let bytes;
  try {
    bytes = new Uint8Array(await blob.slice(0, Math.min(blob.size, 4096)).arrayBuffer());
  } catch {
    return false;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  // `ftyp` is normally the first box. Permit only a few valid leading BMFF
  // boxes, rather than scanning arbitrary bytes for a misleading text match.
  for (let boxIndex = 0; boxIndex < 4 && offset + 8 <= bytes.length; boxIndex += 1) {
    const size32 = view.getUint32(offset, false);
    const type = ascii(bytes, offset + 4, 4);
    let headerSize = 8;
    let boxSize = size32;

    if (size32 === 1) {
      if (offset + 16 > bytes.length) return false;
      const high = view.getUint32(offset + 8, false);
      const low = view.getUint32(offset + 12, false);
      boxSize = high * 2 ** 32 + low;
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = blob.size - offset;
    }

    if (!Number.isSafeInteger(boxSize) || boxSize < headerSize) return false;
    if (boxSize > blob.size - offset) return false;

    if (type === "ftyp") {
      if (boxSize < headerSize + 8 || offset + headerSize + 4 > bytes.length) return false;
      const availableEnd = Math.min(offset + boxSize, bytes.length);
      const brands = [ascii(bytes, offset + headerSize, 4)];

      // Skip the four-byte minor version before reading compatible brands.
      for (let cursor = offset + headerSize + 8; cursor + 4 <= availableEnd; cursor += 4) {
        brands.push(ascii(bytes, cursor, 4));
      }

      return brands.some((brand) => MP4_BRANDS.has(brand));
    }

    if (!new Set(["free", "skip", "wide", "uuid"]).has(type)) return false;
    if (boxSize > bytes.length - offset) return false;
    offset += boxSize;
  }

  return false;
}

/**
 * Verify both the MP4 container signature and browser-loaded video metadata.
 * Resolves to a boolean; malformed, unplayable, or dimension/duration-mismatched
 * media resolves to false rather than leaking a browser media error.
 *
 * `expected` may contain width, height, duration, durationTolerance, timeoutMs,
 * and signal.
 */
export async function verifyPlayableMp4(blob, expected = {}) {
  if (!(await isIsoBmffMp4(blob))) return false;
  if (!globalThis.document?.createElement || !globalThis.URL?.createObjectURL) return false;

  const signal = expected.signal;
  if (signal?.aborted) throw createAbortError(signal.reason);

  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(blob);
  const timeoutMs = finiteOrDefault(expected.timeoutMs, 10_000);

  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;

  try {
    await waitForVideoMetadata(video, objectUrl, timeoutMs, signal);

    const width = video.videoWidth;
    const height = video.videoHeight;
    const duration = video.duration;
    if (!(width > 0 && height > 0 && Number.isFinite(duration) && duration > 0)) return false;

    if (Number.isFinite(expected.width) && Math.abs(width - expected.width) > 2) return false;
    if (Number.isFinite(expected.height) && Math.abs(height - expected.height) > 2) return false;

    if (Number.isFinite(expected.duration) && expected.duration > 0) {
      const tolerance = Number.isFinite(expected.durationTolerance)
        ? Math.max(0, expected.durationTolerance)
        : Math.max(1, expected.duration * 0.25);
      if (Math.abs(duration - expected.duration) > tolerance) return false;
    }

    return true;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return false;
  } finally {
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      // The detached probe is already harmless if load() is unavailable.
    }
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Trigger a browser download and return the sanitized filename that was used.
 * A WebM Blob is never allowed to masquerade behind an `.mp4` extension.
 */
export function createDownload(blob, filename) {
  if (!isBlobLike(blob)) throw new TypeError("createDownload requires a Blob.");
  if (!globalThis.document?.createElement || !globalThis.URL?.createObjectURL) {
    throw new Error("Downloads are not available in this environment.");
  }

  const safeFilename = sanitizeFilename(filename);
  if (/^video\/webm(?:;|$)/i.test(blob.type) && /\.mp4$/i.test(safeFilename)) {
    throw new TypeError("A WebM recovery file must use a .webm filename.");
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = safeFilename;
  anchor.rel = "noopener";
  anchor.hidden = true;
  document.body?.append(anchor);
  anchor.click();
  anchor.remove();

  // Delayed revocation gives Safari time to begin consuming the Blob URL.
  globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  return safeFilename;
}

/**
 * Export a deterministic timeline to a genuine MP4 Blob.
 *
 * Required options:
 *   renderFrame(canvas, simulationTimeSeconds, frameIndex, metadata)
 *   width, height, fps, duration
 *
 * Optional options:
 *   startTime = 0
 *   includeInterface = false
 *   watermark = false (passed through to renderFrame)
 *   route = "auto" | "native" | "ffmpeg"
 *   onProgress({ stage, progress, ...details })
 *   signal (AbortSignal)
 *
 * `renderFrame` must be pure with respect to the live simulation. It may be
 * asynchronous, but it must draw a complete frame onto the provided dedicated
 * export canvas using only the supplied fixed timestamp and metadata.
 *
 * Resolves to:
 *   { blob, mimeType: "video/mp4", route, width, height, fps, duration,
 *     frameCount, nativeMimeType?, intermediateMimeType? }
 */
export async function exportMp4(options = {}) {
  if (exportInProgress) {
    throw new Mp4ExportError("Another video export is already in progress.", {
      code: "EXPORT_IN_PROGRESS",
    });
  }

  const settings = normalizeOptions(options);
  exportInProgress = true;

  try {
    throwIfAborted(settings.signal);
    const capabilities = detectExportCapabilities();
    if (!capabilities.supported) {
      throw new Mp4ExportError("This browser cannot record an export canvas.", {
        code: "MEDIA_RECORDER_UNAVAILABLE",
      });
    }

    emitProgress(settings.onProgress, {
      stage: "preparing",
      progress: 0,
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      duration: settings.duration,
      frameCount: settings.frameCount,
    });

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = settings.width;
    exportCanvas.height = settings.height;
    exportCanvas.setAttribute("aria-hidden", "true");

    let lastNativeFailure = null;
    if (settings.route !== "ffmpeg") {
      const nativeCandidates = capabilities.supportedMp4MimeTypes;

      for (let attempt = 0; attempt < nativeCandidates.length; attempt += 1) {
        const mimeType = nativeCandidates[attempt];
        throwIfAborted(settings.signal);

        try {
          const nativeBlob = await recordDeterministicCanvas({
            canvas: exportCanvas,
            mimeType,
            route: "native",
            attempt: attempt + 1,
            attemptCount: nativeCandidates.length,
            settings,
          });

          emitProgress(settings.onProgress, {
            stage: "finalizing",
            progress: 0.5,
            route: "native",
          });

          const valid = await verifyPlayableMp4(nativeBlob, {
            width: settings.width,
            height: settings.height,
            duration: settings.duration,
            signal: settings.signal,
          });

          if (valid) {
            emitProgress(settings.onProgress, {
              stage: "complete",
              progress: 1,
              route: "native",
            });
            return Object.freeze({
              blob: nativeBlob,
              mimeType: "video/mp4",
              route: "native",
              nativeMimeType: mimeType,
              width: settings.width,
              height: settings.height,
              fps: settings.fps,
              duration: settings.duration,
              frameCount: settings.frameCount,
            });
          }

          lastNativeFailure = new Error("Native recorder output failed MP4 validation.");
        } catch (error) {
          if (isAbortError(error)) throw error;
          lastNativeFailure = error;
        }
      }

      if (settings.route === "native") {
        throw new Mp4ExportError(
          "Native MP4 recording is not available on this browser. Try the automatic route.",
          { code: "NATIVE_MP4_UNAVAILABLE", cause: lastNativeFailure },
        );
      }
    }

    throwIfAborted(settings.signal);
    const webmMimeType = capabilities.webmMimeType;
    if (!webmMimeType) {
      throw new Mp4ExportError(
        "MP4 export is unavailable because this browser cannot create a WebM fallback recording.",
        { code: "WEBM_RECORDING_UNAVAILABLE", cause: lastNativeFailure },
      );
    }

    let recoveryBlob = null;
    try {
      recoveryBlob = await recordDeterministicCanvas({
        canvas: exportCanvas,
        mimeType: webmMimeType,
        route: "ffmpeg",
        attempt: 1,
        attemptCount: 1,
        settings,
      });

      throwIfAborted(settings.signal);
      const mp4Blob = await transcodeWebmToMp4(recoveryBlob, settings);
      throwIfAborted(settings.signal);

      emitProgress(settings.onProgress, {
        stage: "finalizing",
        progress: 0.5,
        route: "ffmpeg",
      });

      const valid = await verifyPlayableMp4(mp4Blob, {
        width: settings.width,
        height: settings.height,
        duration: settings.duration,
        signal: settings.signal,
      });
      if (!valid) throw new Error("Encoded output failed MP4 validation.");

      emitProgress(settings.onProgress, {
        stage: "complete",
        progress: 1,
        route: "ffmpeg",
      });

      return Object.freeze({
        blob: mp4Blob,
        mimeType: "video/mp4",
        route: "ffmpeg",
        intermediateMimeType: recoveryBlob.type || webmMimeType,
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        duration: settings.duration,
        frameCount: settings.frameCount,
      });
    } catch (error) {
      if (isAbortError(error)) {
        if (recoveryBlob) attachRecoveryBlob(error, recoveryBlob);
        throw error;
      }

      throw new Mp4ExportError(
        recoveryBlob
          ? "MP4 encoding could not be completed on this browser or device. A WebM recovery recording is available."
          : "MP4 export could not be completed on this browser or device.",
        {
          code: recoveryBlob ? "FFMPEG_ENCODING_FAILED" : "WEBM_RECORDING_FAILED",
          cause: error,
          recoveryBlob,
        },
      );
    }
  } finally {
    exportInProgress = false;
  }
}

function normalizeOptions(options) {
  if (typeof options.renderFrame !== "function") {
    throw new TypeError("exportMp4 requires a renderFrame(canvas, time, frameIndex, metadata) callback.");
  }

  const width = requireInteger(options.width, "width", 2, 8192);
  const height = requireInteger(options.height, "height", 2, 8192);
  const fps = requireInteger(options.fps, "fps", 1, 120);
  const duration = requireFinite(options.duration, "duration", 1 / fps, 600);
  const startTime = requireFinite(options.startTime ?? 0, "startTime", 0, Number.MAX_SAFE_INTEGER);
  const route = options.route ?? "auto";
  const signal = options.signal ?? options.abortSignal ?? null;

  if (!ROUTES.has(route)) throw new TypeError('route must be "auto", "native", or "ffmpeg".');
  if (signal && typeof signal.addEventListener !== "function") {
    throw new TypeError("signal must be an AbortSignal.");
  }
  if (width * height > 33_554_432) {
    throw new RangeError("The requested export canvas is too large.");
  }

  const frameCount = Math.max(1, Math.round(duration * fps));
  return Object.freeze({
    renderFrame: options.renderFrame,
    width,
    height,
    fps,
    duration,
    startTime,
    includeInterface: Boolean(options.includeInterface),
    watermark: options.watermark ?? false,
    route,
    onProgress: typeof options.onProgress === "function" ? options.onProgress : null,
    signal,
    frameCount,
    frameIntervalMs: 1000 / fps,
    videoBitsPerSecond: deriveBitrate(width, height, fps),
  });
}

async function recordDeterministicCanvas({ canvas, mimeType, route, attempt, attemptCount, settings }) {
  throwIfAborted(settings.signal);

  let stream = null;
  let recorder = null;
  let track = null;
  let manualFrames = false;
  let stopRequested = false;
  let recorderError = null;
  const chunks = [];

  try {
    ({ stream, track, manualFrames } = createCanvasCapture(canvas, settings.fps));
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: settings.videoBitsPerSecond,
    });

    let rejectRecorderFailure;
    const recorderFailure = new Promise((_, reject) => {
      rejectRecorderFailure = reject;
    });
    // The rejection is also consumed here so a recorder failure between frame
    // awaits never becomes an unhandled promise rejection.
    recorderFailure.catch(() => {});

    const recordingEnded = new Promise((resolve) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener("error", (event) => {
        recorderError = event.error || new Error("The browser video recorder failed.");
        rejectRecorderFailure(recorderError);
      });
      recorder.addEventListener("stop", () => {
        if (!stopRequested && !recorderError) {
          recorderError = new Error("The browser video recorder stopped unexpectedly.");
          rejectRecorderFailure(recorderError);
        }
        resolve();
      });
    });

    const metadata = Object.freeze({
      exporting: true,
      route,
      mimeType,
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      duration: settings.duration,
      startTime: settings.startTime,
      endTime: settings.startTime + settings.duration,
      fixedTimestep: 1 / settings.fps,
      frameCount: settings.frameCount,
      includeInterface: settings.includeInterface,
      watermark: settings.watermark,
    });

    // Draw onto the detached export canvas before recording begins. The live
    // simulation and its playhead are never read from or modified here.
    await raceWithFailure(
      Promise.resolve(settings.renderFrame(canvas, settings.startTime, 0, metadata)),
      recorderFailure,
      settings.signal,
    );

    throwIfAborted(settings.signal);
    recorder.start(1000);
    if (recorder.state !== "recording") await nextTask(settings.signal);
    throwIfAborted(settings.signal);

    const recordingStart = now();
    if (manualFrames) track.requestFrame();
    emitProgress(settings.onProgress, {
      stage: "recording",
      progress: 1 / settings.frameCount,
      route,
      frameIndex: 0,
      frameCount: settings.frameCount,
      attempt,
      attemptCount,
    });

    for (let frameIndex = 1; frameIndex < settings.frameCount; frameIndex += 1) {
      const deadline = recordingStart + frameIndex * settings.frameIntervalMs;
      await raceWithFailure(waitUntil(deadline, settings.signal), recorderFailure, settings.signal);

      const simulationTime = settings.startTime + frameIndex / settings.fps;
      await raceWithFailure(
        Promise.resolve(settings.renderFrame(canvas, simulationTime, frameIndex, metadata)),
        recorderFailure,
        settings.signal,
      );
      if (manualFrames) track.requestFrame();

      emitProgress(settings.onProgress, {
        stage: "recording",
        progress: (frameIndex + 1) / settings.frameCount,
        route,
        frameIndex,
        frameCount: settings.frameCount,
        attempt,
        attemptCount,
      });
    }

    // Hold the final frame for one complete frame interval so the recording's
    // media duration corresponds to frameCount / fps.
    await raceWithFailure(
      waitUntil(recordingStart + settings.frameCount * settings.frameIntervalMs, settings.signal),
      recorderFailure,
      settings.signal,
    );

    stopRequested = true;
    if (recorder.state !== "inactive") recorder.stop();
    await raceWithSignal(recordingEnded, settings.signal);
    if (recorderError) throw recorderError;

    const recordedMimeType = recorder.mimeType || mimeType;
    const blob = new Blob(chunks, { type: recordedMimeType });
    if (!blob.size) throw new Error("The browser produced an empty video recording.");
    return blob;
  } finally {
    stopRequested = true;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // A failed or aborting recorder may already be stopping.
      }
    }
    for (const mediaTrack of stream?.getTracks?.() || []) {
      try {
        mediaTrack.stop();
      } catch {
        // Track cleanup is best effort.
      }
    }
  }
}

function createCanvasCapture(canvas, fps) {
  let stream;
  try {
    stream = canvas.captureStream(0);
  } catch {
    stream = canvas.captureStream(fps);
  }

  let track = stream.getVideoTracks?.()[0];
  if (!track) {
    for (const mediaTrack of stream.getTracks?.() || []) mediaTrack.stop();
    throw new Error("The export canvas did not provide a video track.");
  }

  if (typeof track.requestFrame === "function") {
    return { stream, track, manualFrames: true };
  }

  // A zero-rate stream without requestFrame cannot emit frames. Recreate it at
  // the target rate for older implementations.
  for (const mediaTrack of stream.getTracks?.() || []) mediaTrack.stop();
  stream = canvas.captureStream(fps);
  track = stream.getVideoTracks?.()[0];
  if (!track) throw new Error("The export canvas did not provide a video track.");
  return { stream, track, manualFrames: false };
}

async function transcodeWebmToMp4(webmBlob, settings) {
  throwIfAborted(settings.signal);

  // These URLs remain relative to this module and are never requested until a
  // user has initiated an export that actually needs FFmpeg.
  const moduleUrl = sameOriginAssetUrl(FFMPEG_MODULE_PATH);
  const coreUrl = sameOriginAssetUrl(FFMPEG_CORE_PATH);
  const wasmUrl = sameOriginAssetUrl(FFMPEG_WASM_PATH);

  let ffmpeg = null;
  let progressHandler = null;
  let inputWritten = false;
  const outputNames = ["output-h264.mp4", "output-mpeg4.mp4"];

  try {
    emitProgress(settings.onProgress, {
      stage: "loading_ffmpeg",
      progress: 0,
      route: "ffmpeg",
    });
    const ffmpegModule = await raceWithSignal(import(moduleUrl), settings.signal);
    ({ ffmpeg, progressHandler } = await createFfmpegInstance(
      ffmpegModule,
      coreUrl,
      wasmUrl,
      settings,
    ));

    emitProgress(settings.onProgress, {
      stage: "encoding",
      progress: 0,
      route: "ffmpeg",
    });

    const inputName = "input.webm";
    const inputBytes = new Uint8Array(await raceWithSignal(webmBlob.arrayBuffer(), settings.signal));
    await raceWithSignal(ffmpeg.writeFile(inputName, inputBytes), settings.signal, () => ffmpeg.terminate());
    inputWritten = true;

    const commandCandidates = [
      [
        "-i",
        inputName,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-r",
        String(settings.fps),
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outputNames[0],
      ],
      [
        "-i",
        inputName,
        "-an",
        "-c:v",
        "mpeg4",
        "-q:v",
        "4",
        "-r",
        String(settings.fps),
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outputNames[1],
      ],
    ];

    let lastFailure = null;
    for (let index = 0; index < commandCandidates.length; index += 1) {
      const outputName = outputNames[index];
      throwIfAborted(settings.signal);
      await safeDeleteFfmpegFile(ffmpeg, outputName);

      try {
        const exitCode = await raceWithSignal(
          ffmpeg.exec(commandCandidates[index]),
          settings.signal,
          () => ffmpeg.terminate(),
        );
        if (typeof exitCode === "number" && exitCode !== 0) {
          throw new Error("The local MP4 encoder did not complete successfully.");
        }

        const output = await raceWithSignal(ffmpeg.readFile(outputName), settings.signal, () =>
          ffmpeg.terminate(),
        );
        const bytes = toUint8Array(output);
        const blob = new Blob([bytes], { type: "video/mp4" });
        if (!(await isIsoBmffMp4(blob))) {
          throw new Error("The local encoder produced an invalid MP4 container.");
        }
        return blob;
      } catch (error) {
        if (isAbortError(error)) throw error;
        lastFailure = error;
      } finally {
        await safeDeleteFfmpegFile(ffmpeg, outputName);
      }
    }

    throw lastFailure || new Error("No local MP4 encoder was available.");
  } finally {
    if (ffmpeg) {
      if (progressHandler && typeof ffmpeg.off === "function") {
        try {
          ffmpeg.off("progress", progressHandler);
        } catch {
          // The worker may already have terminated after cancellation.
        }
      }
      if (inputWritten) await safeDeleteFfmpegFile(ffmpeg, "input.webm");
      for (const outputName of outputNames) await safeDeleteFfmpegFile(ffmpeg, outputName);
      try {
        ffmpeg.terminate();
      } catch {
        // Worker memory has already been released or was never allocated.
      }
    }
  }
}

async function createFfmpegInstance(module, coreUrl, wasmUrl, settings) {
  const FFmpegConstructor = module.FFmpeg || module.default?.FFmpeg;

  if (typeof FFmpegConstructor === "function") {
    const ffmpeg = new FFmpegConstructor();
    const progressHandler = ({ progress }) => {
      emitProgress(settings.onProgress, {
        stage: "encoding",
        progress: clamp01(progress),
        route: "ffmpeg",
      });
    };
    if (typeof ffmpeg.on === "function") ffmpeg.on("progress", progressHandler);

    try {
      await raceWithSignal(
        ffmpeg.load({ coreURL: coreUrl, wasmURL: wasmUrl }),
        settings.signal,
        () => ffmpeg.terminate(),
      );
      return { ffmpeg, progressHandler };
    } catch (error) {
      if (typeof ffmpeg.off === "function") {
        try {
          ffmpeg.off("progress", progressHandler);
        } catch {
          // A load failure may have already torn down the worker.
        }
      }
      try {
        ffmpeg.terminate();
      } catch {
        // Termination is best effort when worker startup itself failed.
      }
      throw error;
    }
  }

  // Compatibility with the older local @ffmpeg/ffmpeg browser API. Its core
  // loader derives the sibling .wasm URL from the same-origin corePath.
  const createFFmpeg = module.createFFmpeg || module.default?.createFFmpeg;
  if (typeof createFFmpeg === "function") {
    const legacy = createFFmpeg({
      corePath: coreUrl,
      log: false,
      progress: ({ ratio }) => {
        emitProgress(settings.onProgress, {
          stage: "encoding",
          progress: clamp01(ratio),
          route: "ffmpeg",
        });
      },
    });
    try {
      await raceWithSignal(legacy.load(), settings.signal, () => legacy.exit?.());
    } catch (error) {
      try {
        legacy.exit?.();
      } catch {
        // Legacy worker startup may have failed before exit became usable.
      }
      throw error;
    }

    const adapter = {
      writeFile: (name, data) => legacy.FS("writeFile", name, data),
      readFile: (name) => legacy.FS("readFile", name),
      deleteFile: (name) => legacy.FS("unlink", name),
      exec: async (args) => {
        await legacy.run(...args);
        return 0;
      },
      terminate: () => legacy.exit?.(),
    };
    return { ffmpeg: adapter, progressHandler: null };
  }

  throw new Error("The local FFmpeg module does not expose a supported browser API.");
}

async function safeDeleteFfmpegFile(ffmpeg, filename) {
  if (!ffmpeg?.deleteFile) return;
  try {
    await ffmpeg.deleteFile(filename);
  } catch {
    // Missing virtual files and terminated workers require no further cleanup.
  }
}

function sameOriginAssetUrl(relativePath) {
  const assetUrl = new URL(relativePath, import.meta.url);
  const pageLocation = globalThis.location;
  if (
    pageLocation &&
    (pageLocation.protocol === "http:" || pageLocation.protocol === "https:") &&
    assetUrl.origin !== pageLocation.origin
  ) {
    throw new Error("Local video encoding assets must be served from the page's origin.");
  }
  return assetUrl.href;
}

function waitForVideoMetadata(video, objectUrl, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The browser could not load the exported MP4 metadata."));
    };
    const onAbort = () => {
      cleanup();
      reject(createAbortError(signal.reason));
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while checking the exported MP4."));
    }, timeoutMs);
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    video.src = objectUrl;
    video.load();
  });
}

function raceWithFailure(promise, failurePromise, signal) {
  return raceWithSignal(Promise.race([promise, failurePromise]), signal);
}

function raceWithSignal(promise, signal, onAbort) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) {
    onAbort?.();
    return Promise.reject(createAbortError(signal.reason));
  }

  return new Promise((resolve, reject) => {
    const abort = () => {
      onAbort?.();
      reject(createAbortError(signal.reason));
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function waitUntil(deadline, signal) {
  const delay = Math.max(0, deadline - now());
  if (!delay) {
    throwIfAborted(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delay);
    const abort = () => {
      clearTimeout(timeoutId);
      reject(createAbortError(signal.reason));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function nextTask(signal) {
  return waitUntil(now() + 0, signal);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError(signal.reason);
}

function createAbortError(reason) {
  const message = typeof reason === "string" && reason ? reason : "Video export was cancelled.";
  if (typeof DOMException === "function") return new DOMException(message, "AbortError");
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function attachRecoveryBlob(error, recoveryBlob) {
  try {
    Object.defineProperties(error, {
      recoveryBlob: { value: recoveryBlob, configurable: true },
      recoveryMimeType: { value: recoveryBlob.type || "video/webm", configurable: true },
      recoveryFilename: {
        value: "explosion-dynamics-recovery.webm",
        configurable: true,
      },
    });
  } catch {
    // Some host error objects are non-extensible; cancellation still succeeds.
  }
}

function safelySupportsMimeType(Recorder, mimeType) {
  try {
    return Recorder.isTypeSupported(mimeType);
  } catch {
    return false;
  }
}

function sanitizeFilename(filename) {
  const fallback = "explosion-dynamics-export.mp4";
  if (typeof filename !== "string") return fallback;
  const printableFilename = Array.from(filename.normalize("NFKC"), (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127 ? "-" : character;
  }).join("");
  const sanitized = printableFilename
    .replace(/[/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 180);
  return sanitized || fallback;
}

function ascii(bytes, offset, length) {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return value;
}

function isBlobLike(value) {
  return Boolean(
    value &&
      typeof value.size === "number" &&
      typeof value.type === "string" &&
      typeof value.slice === "function" &&
      typeof value.arrayBuffer === "function",
  );
}

function requireInteger(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function requireFinite(value, name, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a finite number from ${minimum} to ${maximum}.`);
  }
  return value;
}

function finiteOrDefault(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function deriveBitrate(width, height, fps) {
  return Math.round(Math.min(24_000_000, Math.max(2_000_000, width * height * fps * 0.18)));
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("The local encoder returned an unreadable MP4 file.");
}

function emitProgress(callback, update) {
  if (!callback) return;
  try {
    callback(Object.freeze({ ...update, progress: clamp01(update.progress) }));
  } catch {
    // UI observers must not be able to corrupt an otherwise valid export.
  }
}

function clamp01(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}
