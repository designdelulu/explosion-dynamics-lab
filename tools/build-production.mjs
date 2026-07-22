import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEPLOYMENT_EXCLUSIONS,
  OBSOLETE_REMOTE_PATHS,
  REMOTE_PATHS_REQUIRED_ABSENT,
  REQUIRED_UPLOAD_ROOT_ENTRIES,
  ROOT_SOURCE_FILES,
  RUNTIME_SOURCE_FILES,
  SOURCE_INPUT_FILES,
  VENDOR_SOURCE_FILES,
} from "./release-files.mjs";

const BUILD_SCHEMA = 1;
const RENDERER_VERSION = "gpu-fluid-families-r3";
const PRODUCTION_URL = "https://www.ericbarker.co/explosion-dynamics-lab/";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const distRoot = path.join(projectRoot, "dist");
const outputParent = path.join(distRoot, "production");
const outputRoot = path.join(outputParent, "explosion-dynamics-lab");
const localWebsiteDuplicate = path.join(workspaceRoot, "eric-barker-site", "explosion-dynamics-lab");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSafeRelative(relativePath) {
  if (
    !relativePath
    || path.isAbsolute(relativePath)
    || relativePath.includes("\\")
    || relativePath.includes("\0")
    || relativePath.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe release path: ${relativePath}`);
  }
}

async function exists(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertRegularSource(relativePath) {
  assertSafeRelative(relativePath);
  let cursor = projectRoot;
  const parts = relativePath.split("/");
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part);
    const metadata = await lstat(cursor);
    if (metadata.isSymbolicLink()) throw new Error(`Release input may not be a symlink: ${relativePath}`);
    if (index < parts.length - 1 && !metadata.isDirectory()) {
      throw new Error(`Release input parent is not a directory: ${relativePath}`);
    }
    if (index === parts.length - 1 && !metadata.isFile()) {
      throw new Error(`Release input is not a regular file: ${relativePath}`);
    }
  }
  return cursor;
}

async function sourceRecord(relativePath) {
  const absolutePath = await assertRegularSource(relativePath);
  const bytes = await readFile(absolutePath);
  return { path: relativePath, bytes, size: bytes.length, sha256: sha256(bytes) };
}

function recordsDigest(records) {
  const hash = createHash("sha256");
  for (const record of [...records].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)) {
    hash.update(record.path);
    hash.update("\0");
    hash.update(String(record.size));
    hash.update("\0");
    hash.update(record.sha256);
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function writeBytes(root, relativePath, bytes) {
  assertSafeRelative(relativePath);
  const destination = path.join(root, relativePath);
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error(`Output escaped build root: ${relativePath}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}

async function copySource(root, sourceRelative, outputRelative = sourceRelative) {
  const source = await assertRegularSource(sourceRelative);
  assertSafeRelative(outputRelative);
  const destination = path.join(root, outputRelative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

function replaceExactlyOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0 || source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Expected exactly one ${label} marker while building production.`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function buildTimestamp() {
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
  if (sourceDateEpoch !== undefined) {
    const seconds = Number(sourceDateEpoch);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("SOURCE_DATE_EPOCH must be a non-negative number.");
    return new Date(seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function gitIdentity(sourceDigest) {
  try {
    const commit = execFileSync("git", ["-C", projectRoot, "rev-parse", "--verify", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const dirty = execFileSync("git", ["-C", projectRoot, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().length > 0;
    return { commit, display: `${commit.slice(0, 12)}${dirty ? "-dirty" : ""}` };
  } catch {
    return { commit: null, display: `uncommitted-${sourceDigest.slice(0, 12)}` };
  }
}

async function collectFiles(root, relative = "", files = []) {
  const absolute = path.join(root, relative);
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const childAbsolute = path.join(root, childRelative);
    if (entry.isSymbolicLink()) throw new Error(`Generated release contains a symlink: ${childRelative}`);
    if (entry.isDirectory()) await collectFiles(root, childRelative, files);
    else if (entry.isFile()) {
      const bytes = await readFile(childAbsolute);
      files.push({ path: childRelative, bytes, size: bytes.length, sha256: sha256(bytes) });
    }
  }
  return files;
}

function expectedMime(relativePath) {
  if (relativePath.endsWith(".html")) return "text/html";
  if (relativePath.endsWith(".css")) return "text/css";
  if (relativePath.endsWith(".js")) return "javascript";
  if (relativePath.endsWith(".json")) return "application/json";
  if (relativePath.endsWith(".wasm")) return "application/wasm";
  if (relativePath.endsWith(".png")) return "image/png";
  return null;
}

const duplicateMetadata = await exists(localWebsiteDuplicate);
if (duplicateMetadata) {
  throw new Error(
    `Refusing to build while the obsolete local website copy exists: ${localWebsiteDuplicate}\n`
    + "Remove or move it after reconciling; production must originate only from the standalone project.",
  );
}

const uniqueInputs = new Set(SOURCE_INPUT_FILES);
if (uniqueInputs.size !== SOURCE_INPUT_FILES.length) throw new Error("The production source allowlist contains duplicates.");
const sourceRecords = await Promise.all(SOURCE_INPUT_FILES.map(sourceRecord));
const sourceByPath = new Map(sourceRecords.map((record) => [record.path, record]));
const sourceDigest = recordsDigest(sourceRecords);
const vendorRecords = VENDOR_SOURCE_FILES.map((relativePath) => sourceByPath.get(relativePath));
const vendorDigest = recordsDigest(vendorRecords);
const vendorId = vendorDigest.slice(0, 16);
const deployedAt = buildTimestamp();
const releaseId = sha256(`explosion-dynamics-lab\0${BUILD_SCHEMA}\0${deployedAt}\0${sourceDigest}`).slice(0, 16);
const git = gitIdentity(sourceDigest);
const temporaryRoot = path.join(distRoot, `.production-${process.pid}-${randomBytes(6).toString("hex")}`);
const releasePrefix = `releases/${releaseId}`;
const vendorPrefix = `vendor-releases/${vendorId}/ffmpeg`;

await mkdir(distRoot, { recursive: true });
await mkdir(temporaryRoot, { recursive: false });
try {
  for (const relativePath of ROOT_SOURCE_FILES) await copySource(temporaryRoot, relativePath);

  let indexSource = sourceByPath.get("index.html").bytes.toString("utf8");
  indexSource = replaceExactlyOnce(
    indexSource,
    'content="development">',
    `content="${releaseId}">`,
    "build meta",
  );
  indexSource = replaceExactlyOnce(
    indexSource,
    'href="assets/styles.css"',
    `href="${releasePrefix}/assets/styles.css"`,
    "stylesheet",
  );
  indexSource = replaceExactlyOnce(
    indexSource,
    'src="scripts/app.js"',
    `src="${releasePrefix}/scripts/app.js"`,
    "module entry",
  );
  await writeBytes(temporaryRoot, "index.html", indexSource);

  for (const relativePath of RUNTIME_SOURCE_FILES) {
    if (relativePath === "scripts/build-info.js" || relativePath === "scripts/exporter.js") continue;
    await copySource(temporaryRoot, relativePath, `${releasePrefix}/${relativePath}`);
  }

  let exporterSource = sourceByPath.get("scripts/exporter.js").bytes.toString("utf8");
  exporterSource = replaceExactlyOnce(
    exporterSource,
    'const FFMPEG_MODULE_PATH = "../vendor/ffmpeg/ffmpeg/index.js";',
    `const FFMPEG_MODULE_PATH = "../../../${vendorPrefix}/ffmpeg/index.js";`,
    "FFmpeg module path",
  );
  exporterSource = replaceExactlyOnce(
    exporterSource,
    'const FFMPEG_CORE_PATH = "../vendor/ffmpeg/core/ffmpeg-core.js";',
    `const FFMPEG_CORE_PATH = "../../../${vendorPrefix}/core/ffmpeg-core.js";`,
    "FFmpeg core path",
  );
  exporterSource = replaceExactlyOnce(
    exporterSource,
    'const FFMPEG_WASM_PATH = "../vendor/ffmpeg/core/ffmpeg-core.wasm";',
    `const FFMPEG_WASM_PATH = "../../../${vendorPrefix}/core/ffmpeg-core.wasm";`,
    "FFmpeg WASM path",
  );
  await writeBytes(temporaryRoot, `${releasePrefix}/scripts/exporter.js`, exporterSource);

  for (const relativePath of VENDOR_SOURCE_FILES) {
    const suffix = relativePath.slice("vendor/ffmpeg/".length);
    await copySource(temporaryRoot, relativePath, `${vendorPrefix}/${suffix}`);
  }

  const corePayloadRecords = await collectFiles(temporaryRoot);
  const payloadManifestHash = recordsDigest(corePayloadRecords);
  const buildInfo = {
    source: "standalone explosion-dynamics-lab",
    build: git.display,
    deployedAt,
    rendererVersion: RENDERER_VERSION,
    assetVersion: releaseId,
    manifestHash: payloadManifestHash,
  };
  const buildInfoSource = `export const BUILD_INFO = Object.freeze(${JSON.stringify(buildInfo, null, 2)});\n`;
  await writeBytes(temporaryRoot, `${releasePrefix}/scripts/build-info.js`, buildInfoSource);

  const finalPayloadRecords = await collectFiles(temporaryRoot);
  const files = finalPayloadRecords
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map(({ path: relativePath, size, sha256: fileSha256 }) => ({
      path: relativePath,
      size,
      sha256: fileSha256,
      expectedMime: expectedMime(relativePath),
      httpVerifiable: relativePath !== ".htaccess",
    }));
  const manifest = {
    schemaVersion: BUILD_SCHEMA,
    source: "standalone explosion-dynamics-lab",
    productionUrl: PRODUCTION_URL,
    remoteTarget: {
      logicalPath: "<DreamHost domain web directory>/explosion-dynamics-lab/",
      physicalPath: null,
      status: "unconfirmed; confirm the assigned SFTP user and Web directory in DreamHost before upload",
    },
    build: {
      releaseId,
      sourceDigest,
      gitCommit: git.commit,
      displayRevision: git.display,
      deployedAt,
      rendererVersion: RENDERER_VERSION,
      assetVersion: releaseId,
      vendorId,
      vendorDigest,
      payloadManifestHash,
    },
    cacheStrategy: {
      html: "no-cache, must-revalidate",
      manifest: "no-store",
      releaseAssets: "content-addressed release and vendor directories; one year immutable",
    },
    deploymentLayout: {
      localUploadDirectory: "dist/production/explosion-dynamics-lab/",
      instruction: "Upload the contents of this directory into the confirmed live explosion-dynamics-lab/ directory.",
      uploadContentsOnly: true,
      requiredTopLevelEntries: REQUIRED_UPLOAD_ROOT_ENTRIES,
      forbiddenUploadRoots: [
        "the standalone source project root",
        "dist/",
        "dist/production/",
        "an outer explosion-dynamics-lab/ wrapper inside the live explosion-dynamics-lab/ directory",
      ],
    },
    activeEntrypoints: {
      html: "index.html",
      stylesheet: `${releasePrefix}/assets/styles.css`,
      module: `${releasePrefix}/scripts/app.js`,
      fluidRenderer: `${releasePrefix}/scripts/fluid-engine.js`,
      exporter: `${releasePrefix}/scripts/exporter.js`,
      buildIdentity: `${releasePrefix}/scripts/build-info.js`,
      ffmpegWasm: `${vendorPrefix}/core/ffmpeg-core.wasm`,
    },
    serviceWorker: { present: false, expectedPaths: ["service-worker.js", "sw.js"] },
    obsoleteRemotePaths: OBSOLETE_REMOTE_PATHS,
    remotePathsRequiredAbsent: REMOTE_PATHS_REQUIRED_ABSENT,
    deploymentExclusions: DEPLOYMENT_EXCLUSIONS,
    files,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeBytes(temporaryRoot, "deployment-manifest.json", manifestBytes);
  const deploymentManifestSha256 = sha256(manifestBytes);

  if (outputRoot !== path.join(projectRoot, "dist", "production", "explosion-dynamics-lab")) {
    throw new Error("Refusing to replace an unexpected output directory.");
  }
  const outputMetadata = await exists(outputRoot);
  if (outputMetadata?.isSymbolicLink()) throw new Error(`Refusing to replace symlinked output: ${outputRoot}`);
  if (outputMetadata && !outputMetadata.isDirectory()) throw new Error(`Production output is not a directory: ${outputRoot}`);
  await mkdir(outputParent, { recursive: true });
  await rm(outputRoot, { recursive: true, force: true });
  await rename(temporaryRoot, outputRoot);
  await writeFile(path.join(projectRoot, "deployment-manifest.json"), manifestBytes);

  const receipt = {
    schemaVersion: 1,
    releaseId,
    vendorId,
    deploymentManifestSha256,
    payloadManifestHash,
    sourceDigest,
    deployedAt,
    productionDirectory: outputRoot,
  };
  await writeFile(
    path.join(outputParent, "deployment-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );

  console.log("Explosion Dynamics Lab production build: PASS");
  console.log(`  source: ${projectRoot}`);
  console.log(`  output: ${outputRoot}`);
  console.log(`  release: ${releaseId}`);
  console.log(`  vendor: ${vendorId}`);
  console.log(`  production files: ${files.length + 1}`);
  console.log(`  deployment manifest SHA-256: ${deploymentManifestSha256}`);
  console.log(`  payload manifest hash: ${payloadManifestHash}`);
} catch (error) {
  await rm(temporaryRoot, { recursive: true, force: true });
  throw error;
}
