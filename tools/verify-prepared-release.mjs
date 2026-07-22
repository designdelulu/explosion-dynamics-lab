import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_UPLOAD_ROOT_ENTRIES,
  SOURCE_INPUT_FILES,
} from "./release-files.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stageRoot = path.join(projectRoot, "dist", "production", "explosion-dynamics-lab");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

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

function assertSafeRelative(relativePath) {
  assert.ok(relativePath && !path.isAbsolute(relativePath), `Unsafe release path: ${relativePath}`);
  assert.ok(!relativePath.includes("\\") && !relativePath.includes("\0"), `Unsafe release path: ${relativePath}`);
  assert.ok(relativePath.split("/").every((part) => part && part !== "." && part !== ".."), `Unsafe release path: ${relativePath}`);
}

async function readRegular(root, relativePath) {
  assertSafeRelative(relativePath);
  let cursor = root;
  for (const [index, part] of relativePath.split("/").entries()) {
    cursor = path.join(cursor, part);
    const metadata = await lstat(cursor);
    assert.equal(metadata.isSymbolicLink(), false, `Prepared release may not contain a symlink: ${relativePath}`);
    if (index === relativePath.split("/").length - 1) {
      assert.equal(metadata.isFile(), true, `Prepared release entry is not a file: ${relativePath}`);
    }
  }
  return readFile(cursor);
}

async function collectFiles(root, relative = "", files = []) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    assert.equal(entry.isSymbolicLink(), false, `Prepared release contains a symlink: ${child}`);
    if (entry.isDirectory()) await collectFiles(root, child, files);
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

const [rootManifestBytes, stagedManifestBytes] = await Promise.all([
  readFile(path.join(projectRoot, "deployment-manifest.json")),
  readFile(path.join(stageRoot, "deployment-manifest.json")),
]);
assert.deepEqual(stagedManifestBytes, rootManifestBytes, "Root and staged deployment manifests differ");
const manifest = JSON.parse(rootManifestBytes.toString("utf8"));

const sourceRecords = await Promise.all(SOURCE_INPUT_FILES.map(async (relativePath) => {
  const bytes = await readRegular(projectRoot, relativePath);
  return { path: relativePath, size: bytes.length, sha256: sha256(bytes) };
}));
assert.equal(
  recordsDigest(sourceRecords),
  manifest.build.sourceDigest,
  "Prepared release is stale: an allowlisted source file changed after the build",
);

const topLevelEntries = (await readdir(stageRoot)).sort();
assert.deepEqual(
  topLevelEntries,
  [...REQUIRED_UPLOAD_ROOT_ENTRIES].sort(),
  "Prepared upload root must contain only the required production entries",
);
assert.equal(manifest.deploymentLayout?.uploadContentsOnly, true);
assert.deepEqual(
  [...(manifest.deploymentLayout?.requiredTopLevelEntries || [])].sort(),
  [...REQUIRED_UPLOAD_ROOT_ENTRIES].sort(),
  "Manifest upload-root contract is incomplete",
);

for (const file of manifest.files) {
  const bytes = await readRegular(stageRoot, file.path);
  assert.equal(bytes.length, file.size, `${file.path}: prepared size differs from manifest`);
  assert.equal(sha256(bytes), file.sha256, `${file.path}: prepared hash differs from manifest`);
}
const stagedFiles = new Set(await collectFiles(stageRoot));
const expectedFiles = new Set(["deployment-manifest.json", ...manifest.files.map(({ path: filePath }) => filePath)]);
assert.deepEqual(stagedFiles, expectedFiles, "Prepared release contains an unmanifested or missing file");

const buildInfoPath = path.join(stageRoot, manifest.activeEntrypoints.buildIdentity);
const buildInfo = await readFile(buildInfoPath, "utf8");
assert.doesNotMatch(buildInfo, /"(?:build|assetVersion|manifestHash)":\s*"development"/);
assert.match(buildInfo, new RegExp(`"assetVersion":\\s*"${manifest.build.releaseId}"`));

console.log("Explosion Dynamics Lab prepared release verification: PASS");
console.log(`  release ${manifest.build.releaseId}; ${manifest.files.length + 1} exact production files`);
console.log("  source digest is current and upload root contains production contents only");
