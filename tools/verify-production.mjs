import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(projectRoot, "deployment-manifest.json");
const args = process.argv.slice(2);
const baseUrlIndex = args.indexOf("--base-url");
const baseUrl = new URL(baseUrlIndex >= 0 ? args[baseUrlIndex + 1] : "https://www.ericbarker.co/explosion-dynamics-lab/");
const skipCleanupCheck = args.includes("--skip-cleanup-check");
if (!baseUrl.pathname.endsWith("/")) throw new Error("The production base URL must end with a slash.");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function verificationUrl(relativePath, releaseId) {
  const url = new URL(relativePath, baseUrl);
  url.searchParams.set("verifyBuild", `${releaseId}-${Date.now()}`);
  return url;
}

async function fetchBytes(relativePath, releaseId, { expectedStatus = 200 } = {}) {
  const url = verificationUrl(relativePath, releaseId);
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    headers: {
      Accept: "*/*",
      "Accept-Encoding": "identity",
      "Cache-Control": "no-cache",
    },
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${relativePath} returned HTTP ${response.status}; expected ${expectedStatus}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, headers: response.headers, url: url.href };
}

function assertMime(relativePath, expectedMime, headers) {
  if (!expectedMime) return;
  const actual = headers.get("content-type")?.toLowerCase() ?? "";
  const matches = expectedMime === "javascript"
    ? /(?:application|text)\/javascript/.test(actual)
    : actual.includes(expectedMime);
  if (!matches) throw new Error(`${relativePath} has Content-Type ${actual || "<missing>"}; expected ${expectedMime}.`);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const queue = [...items];
  const results = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      results.push(await worker(item));
    }
  });
  await Promise.all(workers);
  return results;
}

const localManifestBytes = await readFile(manifestPath);
const localManifestSha256 = sha256(localManifestBytes);
const manifest = JSON.parse(localManifestBytes.toString("utf8"));
const releaseId = manifest.build?.releaseId;
if (!/^[a-f0-9]{16}$/.test(releaseId ?? "")) throw new Error("Local deployment manifest has no valid release ID.");
if (new URL(manifest.productionUrl).href !== baseUrl.href) {
  throw new Error(`Manifest URL ${manifest.productionUrl} does not match verification URL ${baseUrl.href}.`);
}

const remoteManifest = await fetchBytes("deployment-manifest.json", releaseId);
const remoteManifestSha256 = sha256(remoteManifest.bytes);
if (!remoteManifest.bytes.equals(localManifestBytes)) {
  throw new Error(
    `Remote deployment manifest differs from local. local=${localManifestSha256} remote=${remoteManifestSha256}`,
  );
}
const manifestCache = remoteManifest.headers.get("cache-control")?.toLowerCase() ?? "";
if (!manifestCache.includes("no-store")) {
  throw new Error(`deployment-manifest.json must use Cache-Control: no-store; received ${manifestCache || "<missing>"}.`);
}

const httpFiles = manifest.files.filter((file) => file.httpVerifiable);
const verified = await mapWithConcurrency(httpFiles, 4, async (file) => {
  const remote = await fetchBytes(file.path, releaseId);
  if (remote.bytes.length !== file.size) {
    throw new Error(`${file.path} has ${remote.bytes.length} bytes; expected ${file.size}.`);
  }
  const actualHash = sha256(remote.bytes);
  if (actualHash !== file.sha256) {
    throw new Error(`${file.path} SHA-256 mismatch: remote=${actualHash} local=${file.sha256}.`);
  }
  assertMime(file.path, file.expectedMime, remote.headers);
  return {
    path: file.path,
    size: file.size,
    sha256: actualHash,
    cacheControl: remote.headers.get("cache-control"),
    contentType: remote.headers.get("content-type"),
    bytes: remote.bytes,
  };
});

const byPath = new Map(verified.map((file) => [file.path, file]));
const index = byPath.get("index.html");
if (!index) throw new Error("index.html was not verified.");
const indexHtml = index.bytes.toString("utf8");
for (const entrypoint of [manifest.activeEntrypoints.stylesheet, manifest.activeEntrypoints.module]) {
  if (!indexHtml.includes(entrypoint)) throw new Error(`Live index.html does not reference ${entrypoint}.`);
}
if (/\?v=2(?:["'])/.test(indexHtml) || /(?:href|src)=["'](?:assets|scripts)\//.test(indexHtml)) {
  throw new Error("Live index.html still references obsolete root assets or the v2 module graph.");
}
const htmlCache = index.cacheControl?.toLowerCase() ?? "";
if (!(htmlCache.includes("no-cache") || htmlCache.includes("must-revalidate") || htmlCache.includes("max-age=0"))) {
  throw new Error(`index.html must revalidate; received Cache-Control ${htmlCache || "<missing>"}.`);
}

for (const samplePath of [manifest.activeEntrypoints.module, manifest.activeEntrypoints.ffmpegWasm]) {
  const cacheControl = byPath.get(samplePath)?.cacheControl?.toLowerCase() ?? "";
  if (!cacheControl.includes("immutable")) {
    throw new Error(`${samplePath} is content-addressed but not served with immutable caching.`);
  }
}

for (const serviceWorkerPath of manifest.serviceWorker.expectedPaths) {
  await fetchBytes(serviceWorkerPath, releaseId, { expectedStatus: 404 });
}

const cleanupPaths = [...new Set([
  ...(manifest.obsoleteRemotePaths || []),
  ...(manifest.remotePathsRequiredAbsent || []),
])];
if (!skipCleanupCheck) {
  if (!cleanupPaths.length) throw new Error("Deployment manifest has no remote cleanup probes.");
  await mapWithConcurrency(cleanupPaths, 4, async (relativePath) => {
    await fetchBytes(relativePath, releaseId, { expectedStatus: 404 });
    return relativePath;
  });
}

const receipt = {
  schemaVersion: 1,
  verifiedAt: new Date().toISOString(),
  productionUrl: baseUrl.href,
  releaseId,
  rendererVersion: manifest.build.rendererVersion,
  filesVerifiedOverHttps: verified.length,
  localDeploymentManifestSha256: localManifestSha256,
  remoteDeploymentManifestSha256: remoteManifestSha256,
  match: true,
  htmlCacheControl: index.cacheControl,
  manifestCacheControl: remoteManifest.headers.get("cache-control"),
  cleanupVerified: !skipCleanupCheck,
  remotePathsConfirmedAbsent: skipCleanupCheck ? 0 : cleanupPaths.length,
};
const receiptDirectory = path.join(projectRoot, "dist", "production");
await mkdir(receiptDirectory, { recursive: true });
await writeFile(
  path.join(receiptDirectory, skipCleanupCheck ? "remote-active-verification.json" : "remote-verification.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  "utf8",
);

console.log(skipCleanupCheck
  ? "Explosion Dynamics Lab active-release HTTPS verification: PASS (cleanup still required)"
  : "Explosion Dynamics Lab HTTPS verification: PASS");
console.log(`  production: ${baseUrl.href}`);
console.log(`  release: ${releaseId}`);
console.log(`  files verified: ${verified.length}`);
console.log(`  local manifest SHA-256: ${localManifestSha256}`);
console.log(`  remote manifest SHA-256: ${remoteManifestSha256}`);
if (skipCleanupCheck) {
  console.log(`  cleanup pending: ${cleanupPaths.length} obsolete/development paths must return 404`);
} else {
  console.log(`  cleanup verified: ${cleanupPaths.length} obsolete/development paths return 404`);
}
