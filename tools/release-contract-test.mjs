import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import os from "node:os";
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

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const productionRoot = path.join(projectRoot, "dist", "production");
const stageRoot = path.join(projectRoot, "dist", "production", "explosion-dynamics-lab");
const duplicatePath = path.join(workspaceRoot, "eric-barker-site", "explosion-dynamics-lab");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The contract test intentionally performs a deterministic production build.
// Preserve the caller's real prepared release and verification receipts so a
// routine `test` command cannot silently replace the deployable baseline.
const rootManifestPath = path.join(projectRoot, "deployment-manifest.json");
const contractSnapshotRoot = mkdtempSync(path.join(os.tmpdir(), "edl-release-contract-"));
const snapshotManifestPath = path.join(contractSnapshotRoot, "deployment-manifest.json");
const snapshotProductionRoot = path.join(contractSnapshotRoot, "production");
const hadRootManifest = existsSync(rootManifestPath);
const hadProductionRoot = existsSync(productionRoot);
if (hadRootManifest) cpSync(rootManifestPath, snapshotManifestPath);
if (hadProductionRoot) cpSync(productionRoot, snapshotProductionRoot, { recursive: true });

process.on("exit", () => {
  rmSync(productionRoot, { recursive: true, force: true });
  if (hadProductionRoot) {
    mkdirSync(path.dirname(productionRoot), { recursive: true });
    cpSync(snapshotProductionRoot, productionRoot, { recursive: true });
  }
  if (hadRootManifest) {
    writeFileSync(rootManifestPath, readFileSync(snapshotManifestPath));
  } else {
    rmSync(rootManifestPath, { force: true });
  }
  rmSync(contractSnapshotRoot, { recursive: true, force: true });
});

await assert.rejects(lstat(duplicatePath), /ENOENT/, "The obsolete website-tree duplicate must not exist");
await assert.rejects(
  lstat(path.join(projectRoot, "scripts", "sync-to-eric-barker-site.sh")),
  /ENOENT/,
  "The obsolete website sync helper must not exist",
);

assert.equal(new Set(SOURCE_INPUT_FILES).size, SOURCE_INPUT_FILES.length, "Release allowlist contains duplicates");
assert.ok(ROOT_SOURCE_FILES.includes(".htaccess"));
assert.ok(RUNTIME_SOURCE_FILES.includes("scripts/fluid-engine.js"));
assert.ok(RUNTIME_SOURCE_FILES.includes("scripts/exporter.js"));
assert.ok(VENDOR_SOURCE_FILES.includes("vendor/ffmpeg/core/ffmpeg-core.wasm"));
assert.ok(DEPLOYMENT_EXCLUSIONS.includes("research/"));
for (const obsolete of ["assets/styles.css", "scripts/app.js", "scripts/fluid-engine.js"]) {
  assert.ok(OBSOLETE_REMOTE_PATHS.includes(obsolete), `Missing obsolete-path cleanup entry: ${obsolete}`);
}

execFileSync(process.execPath, ["tools/build-production.mjs"], {
  cwd: projectRoot,
  env: { ...process.env, SOURCE_DATE_EPOCH: "1784703600" },
  stdio: "pipe",
});
execFileSync(process.execPath, ["tools/verify-prepared-release.mjs"], { cwd: projectRoot, stdio: "pipe" });
execFileSync("sh", ["-n", "scripts/deploy-production.sh"], { cwd: projectRoot, stdio: "pipe" });

const localManifestBytes = await readFile(path.join(projectRoot, "deployment-manifest.json"));
const stagedManifestBytes = await readFile(path.join(stageRoot, "deployment-manifest.json"));
assert.deepEqual(stagedManifestBytes, localManifestBytes, "Root and staged deployment manifests must match exactly");
const manifest = JSON.parse(localManifestBytes.toString("utf8"));
const releaseId = manifest.build.releaseId;
const vendorId = manifest.build.vendorId;
assert.match(releaseId, /^[a-f0-9]{16}$/);
assert.match(vendorId, /^[a-f0-9]{16}$/);
assert.equal(manifest.source, "standalone explosion-dynamics-lab");
assert.equal(manifest.remoteTarget.physicalPath, null, "An unconfirmed remote filesystem path must not be invented");
assert.equal(manifest.build.rendererVersion, "gpu-fluid-families-r3");
assert.equal(manifest.serviceWorker.present, false);
assert.equal(manifest.deploymentLayout.uploadContentsOnly, true);
assert.deepEqual(manifest.deploymentLayout.requiredTopLevelEntries, REQUIRED_UPLOAD_ROOT_ENTRIES);
assert.deepEqual(manifest.remotePathsRequiredAbsent, REMOTE_PATHS_REQUIRED_ABSENT);
for (const forbiddenRoot of ["standalone source project root", "dist/", "dist/production/", "outer explosion-dynamics-lab/ wrapper"]) {
  assert.ok(
    manifest.deploymentLayout.forbiddenUploadRoots.some((entry) => entry.includes(forbiddenRoot)),
    `Missing wrong-root warning: ${forbiddenRoot}`,
  );
}

const expectedReleasePrefix = `releases/${releaseId}`;
const expectedVendorPrefix = `vendor-releases/${vendorId}/ffmpeg`;
assert.equal(manifest.activeEntrypoints.module, `${expectedReleasePrefix}/scripts/app.js`);
assert.equal(manifest.activeEntrypoints.fluidRenderer, `${expectedReleasePrefix}/scripts/fluid-engine.js`);
assert.equal(manifest.activeEntrypoints.ffmpegWasm, `${expectedVendorPrefix}/core/ffmpeg-core.wasm`);

const manifestPaths = new Set(manifest.files.map((file) => file.path));
assert.equal(manifestPaths.size, manifest.files.length, "Deployment manifest contains duplicate file paths");
for (const file of manifest.files) {
  const bytes = await readFile(path.join(stageRoot, file.path));
  assert.equal(bytes.length, file.size, `${file.path} size mismatch`);
  assert.equal(sha256(bytes), file.sha256, `${file.path} checksum mismatch`);
}
for (const forbidden of [
  ".gitignore",
  "README.md",
  "RESEARCH-NOTES.md",
  "AUDIT-REPORT.md",
  "LOCAL-COPY-RECONCILIATION.json",
  "research/README.md",
  "tools/build-production.mjs",
]) {
  assert.ok(!manifestPaths.has(forbidden), `Development-only file was deployed: ${forbidden}`);
}
for (const obsolete of OBSOLETE_REMOTE_PATHS) {
  assert.ok(!manifestPaths.has(obsolete), `Obsolete root asset remained in the release: ${obsolete}`);
}

const index = await readFile(path.join(stageRoot, "index.html"), "utf8");
assert.match(index, new RegExp(`content=["']${releaseId}["']`), "Build meta must expose the release ID");
assert.ok(index.includes(`${expectedReleasePrefix}/assets/styles.css`));
assert.ok(index.includes(`${expectedReleasePrefix}/scripts/app.js`));
assert.doesNotMatch(index, /\?v=/, "Content-addressed production entrypoints do not need query versions");
assert.doesNotMatch(index, /(?:href|src)=["'](?:assets|scripts)\//, "Production HTML must not reference root runtime assets");

const app = await readFile(path.join(stageRoot, expectedReleasePrefix, "scripts", "app.js"), "utf8");
assert.match(app, /from "\.\/build-info\.js"/);
assert.match(app, /__EXPLOSION_DYNAMICS_LAB_BUILD__/);
const buildInfo = await readFile(path.join(stageRoot, expectedReleasePrefix, "scripts", "build-info.js"), "utf8");
assert.ok(buildInfo.includes(`"assetVersion": "${releaseId}"`));
assert.ok(buildInfo.includes(`"manifestHash": "${manifest.build.payloadManifestHash}"`));

const exporter = await readFile(path.join(stageRoot, expectedReleasePrefix, "scripts", "exporter.js"), "utf8");
assert.ok(exporter.includes(`../../../${expectedVendorPrefix}/ffmpeg/index.js`));
assert.ok(exporter.includes(`../../../${expectedVendorPrefix}/core/ffmpeg-core.wasm`));
assert.doesNotMatch(exporter, /"\.\.\/vendor\/ffmpeg\//, "Release exporter must not reference obsolete root vendor paths");

const apache = await readFile(path.join(stageRoot, ".htaccess"), "utf8");
assert.match(apache, /deployment-manifest\.json[\s\S]*no-store/);
assert.match(apache, /(?:releases\|vendor-releases)[\s\S]*31536000, immutable/);
assert.match(apache, /RewriteRule[\s\S]*\(\?:assets\|scripts\|tools\|research\|vendor\|dist\)[\s\S]*R=404/, "Wrong-root source trees must be non-routable without destructive cleanup");
const receipt = JSON.parse(await readFile(path.join(projectRoot, "dist", "production", "deployment-receipt.json"), "utf8"));
assert.equal(receipt.releaseId, releaseId);
assert.equal(receipt.deploymentManifestSha256, sha256(localManifestBytes));

const deployScript = await readFile(path.join(projectRoot, "scripts", "deploy-production.sh"), "utf8");
assert.doesNotMatch(deployScript, /cp\s+[^\n]*eric-barker-site/, "Deployment must never copy into the local website checkout");
assert.match(deployScript, /EDL_RSYNC_CONFIRM/);
assert.match(deployScript, /verify_release[\s\S]*--delete-after/, "Remote cleanup must occur only after live verification");
assert.match(deployScript, /tar -czf "\$DEPLOY_PACKAGE_PATH" -C "\$DEPLOY_OUTPUT_DIR" \./, "Package must archive staged contents, not an outer directory");
assert.doesNotMatch(deployScript, /tar -czf "\$DEPLOY_PACKAGE_PATH" -C "\$DEPLOY_OUTPUT_PARENT"/, "Package must not recreate the wrong nested upload root");
assert.match(deployScript, /verify_release active[\s\S]*--delete-after[\s\S]*verify_release/, "Active release must verify before cleanup and strict verification after cleanup");
const productionVerifier = await readFile(path.join(projectRoot, "tools", "verify-production.mjs"), "utf8");
assert.match(productionVerifier, /remotePathsRequiredAbsent/);
assert.match(productionVerifier, /expectedStatus:\s*404/);
assert.match(productionVerifier, /cleanupVerified:\s*!skipCleanupCheck/);

console.log("Explosion Dynamics Lab release contract test: PASS");
console.log(`  content-addressed release ${releaseId} and vendor ${vendorId}`);
console.log(`  ${manifest.files.length + 1} production files with exact hashes`);
console.log("  standalone-only source, guarded one-way deployment, and HTTPS verification enforced");
