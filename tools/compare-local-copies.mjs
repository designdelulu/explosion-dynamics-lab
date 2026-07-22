import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const defaultDuplicate = path.join(workspaceRoot, "eric-barker-site", "explosion-dynamics-lab");
const outputPath = path.join(projectRoot, "LOCAL-COPY-RECONCILIATION.json");
const ignoredPaths = new Set([
  ".git",
  "LOCAL-COPY-RECONCILIATION.json",
  "tools/compare-local-copies.mjs",
]);

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function walk(root, relative = "", entries = new Map(), directories = new Set()) {
  const absolute = path.join(root, relative);
  for (const item of await readdir(absolute, { withFileTypes: true })) {
    const childRelative = relative ? `${relative}/${item.name}` : item.name;
    if (ignoredPaths.has(childRelative) || childRelative.startsWith(".git/")) continue;
    const childAbsolute = path.join(root, childRelative);
    if (item.isSymbolicLink()) {
      throw new Error(`Refusing to compare symlink: ${childAbsolute}`);
    }
    if (item.isDirectory()) {
      directories.add(childRelative);
      await walk(root, childRelative, entries, directories);
      continue;
    }
    if (!item.isFile()) continue;
    const metadata = await stat(childAbsolute);
    entries.set(childRelative, {
      size: metadata.size,
      mtime: metadata.mtime.toISOString(),
      mtimeMs: metadata.mtimeMs,
      sha256: await sha256(childAbsolute),
    });
  }
  return { entries, directories };
}

function aggregateHash(entries) {
  const lines = [...entries]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([relative, metadata]) => `${metadata.sha256}  ${relative}`)
    .join("\n");
  return createHash("sha256").update(`${lines}\n`).digest("hex");
}

const [standalone, duplicate] = await Promise.all([
  walk(projectRoot),
  walk(defaultDuplicate),
]);

const paths = [...new Set([...standalone.entries.keys(), ...duplicate.entries.keys()])].sort();
const files = paths.map((relativePath) => {
  const source = standalone.entries.get(relativePath) ?? null;
  const websiteCopy = duplicate.entries.get(relativePath) ?? null;
  let status = "identical";
  if (!source) status = "website_copy_only";
  else if (!websiteCopy) status = "standalone_only";
  else if (source.sha256 !== websiteCopy.sha256) status = "content_mismatch";
  else if (source.size !== websiteCopy.size) status = "size_mismatch";
  else if (source.mtimeMs !== websiteCopy.mtimeMs) status = "mtime_mismatch";
  return { path: relativePath, status, standalone: source, websiteCopy };
});

const commonFiles = files.filter(({ standalone: source, websiteCopy }) => source && websiteCopy);
const identicalFiles = commonFiles.filter(({ status }) => status === "identical");
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  purpose: "Pre-removal comparison of the authoritative standalone source and the unintended local website-tree duplicate.",
  standalonePath: projectRoot,
  websiteCopyPath: defaultDuplicate,
  excludedFromSnapshot: [...ignoredPaths].sort(),
  summary: {
    standaloneFiles: standalone.entries.size,
    websiteCopyFiles: duplicate.entries.size,
    commonFiles: commonFiles.length,
    identicalFiles: identicalFiles.length,
    mismatchedCommonFiles: commonFiles.length - identicalFiles.length,
    standaloneOnlyFiles: files.filter(({ status }) => status === "standalone_only").length,
    websiteCopyOnlyFiles: files.filter(({ status }) => status === "website_copy_only").length,
    commonBytes: commonFiles.reduce((total, item) => total + item.standalone.size, 0),
    commonAggregateSha256: aggregateHash(new Map(commonFiles.map((item) => [item.path, item.standalone]))),
  },
  directoriesOnlyInStandalone: [...standalone.directories]
    .filter((directory) => !duplicate.directories.has(directory))
    .sort(),
  directoriesOnlyInWebsiteCopy: [...duplicate.directories]
    .filter((directory) => !standalone.directories.has(directory))
    .sort(),
  files,
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Wrote ${path.relative(projectRoot, outputPath)}`);
console.log(JSON.stringify(report.summary, null, 2));
