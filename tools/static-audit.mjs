import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const INDEX_PATH = path.join(PROJECT_ROOT, "index.html");
const PRODUCTION_URL = "https://www.ericbarker.co/explosion-dynamics-lab/";
const EXPECTED_TITLE = "Interactive Explosion Dynamics Lab | Eric Barker";
const EXPECTED_DESCRIPTION =
  "Explore a browser-based explosion dynamics simulator with shockwaves, fireballs, meteor impacts, volcanic events, and approximate nuclear-scale visuals.";

const html = await readFile(INDEX_PATH, "utf8");
const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1];
const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1];
assert.ok(head, "index.html must contain a head element");
assert.ok(body, "index.html must contain a body element");

function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, codePoint) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([\da-f]+);/gi, (_, codePoint) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    );
}

function parseAttributes(tag) {
  const attributes = Object.create(null);
  const source = tag.replace(/^<[^\s>]+/, "").replace(/\/?>\s*$/, "");
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  for (const match of source.matchAll(attributePattern)) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attributes[name] = decodeEntities(value);
  }

  return attributes;
}

function tagRecords(tagName, source = html) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  return [...source.matchAll(pattern)].map((match) => ({
    tag: match[0],
    attributes: parseAttributes(match[0]),
  }));
}

function normalizedText(fragment) {
  return decodeEntities(
    fragment
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueMeta(attributeName, attributeValue) {
  const matches = metaTags.filter(
    ({ attributes }) =>
      attributes[attributeName]?.toLowerCase() === attributeValue.toLowerCase(),
  );
  assert.equal(
    matches.length,
    1,
    `Expected exactly one ${attributeName}="${attributeValue}" meta tag`,
  );
  const content = matches[0].attributes.content?.trim();
  assert.ok(content, `${attributeName}="${attributeValue}" must have non-empty content`);
  return content;
}

const titleMatches = [...head.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)];
assert.equal(titleMatches.length, 1, "Expected exactly one title element");
assert.equal(normalizedText(titleMatches[0][1]), EXPECTED_TITLE, "Unexpected page title");

const h1Matches = [...body.matchAll(/<h1\b[^>]*>/gi)];
assert.equal(h1Matches.length, 1, "Expected exactly one visible h1");
assert.equal(normalizedText(body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1] ?? ""), "Explosion Dynamics Lab");

const metaTags = tagRecords("meta", head);
assert.equal(uniqueMeta("name", "description"), EXPECTED_DESCRIPTION, "Unexpected meta description");
assert.match(
  uniqueMeta("name", "explosion-lab-build"),
  /^(?:development|[a-f0-9]{16})$/,
  "Build identity meta must be development or a content-addressed release ID",
);

const linkTags = tagRecords("link", head);
const canonicalLinks = linkTags.filter(({ attributes }) =>
  attributes.rel?.toLowerCase().split(/\s+/).includes("canonical"),
);
assert.equal(canonicalLinks.length, 1, "Expected exactly one canonical link");
assert.equal(canonicalLinks[0].attributes.href, PRODUCTION_URL, "Canonical URL must be the production www URL");
const canonicalUrl = new URL(canonicalLinks[0].attributes.href);
assert.equal(canonicalUrl.protocol, "https:");
assert.equal(canonicalUrl.hostname, "www.ericbarker.co");
assert.equal(canonicalUrl.pathname, "/explosion-dynamics-lab/");
assert.equal(canonicalUrl.search, "");
assert.equal(canonicalUrl.hash, "");

const robots = uniqueMeta("name", "robots").toLowerCase().split(/[\s,]+/).filter(Boolean);
assert.ok(robots.includes("index"), "Robots metadata must explicitly allow indexing");
assert.ok(robots.includes("follow"), "Robots metadata must explicitly allow following links");
assert.ok(!robots.includes("noindex") && !robots.includes("nofollow"), "Robots metadata must be indexable");

const requiredOpenGraphFields = [
  "og:type",
  "og:title",
  "og:description",
  "og:url",
  "og:image",
  "og:image:width",
  "og:image:height",
  "og:image:alt",
];
const openGraph = Object.fromEntries(
  requiredOpenGraphFields.map((field) => [field, uniqueMeta("property", field)]),
);
assert.equal(openGraph["og:type"], "website");
assert.equal(openGraph["og:title"], "Explosion Dynamics Lab");
assert.equal(openGraph["og:url"], PRODUCTION_URL);
assert.equal(openGraph["og:image:width"], "1200");
assert.equal(openGraph["og:image:height"], "630");
assert.ok(openGraph["og:description"].length >= 80, "Open Graph description is too terse");
assert.ok(openGraph["og:image:alt"].length >= 50, "Open Graph image alt text is too terse");

const requiredTwitterFields = [
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "twitter:image:alt",
];
const twitter = Object.fromEntries(
  requiredTwitterFields.map((field) => [field, uniqueMeta("name", field)]),
);
assert.equal(twitter["twitter:card"], "summary_large_image");
assert.equal(twitter["twitter:title"], "Explosion Dynamics Lab");
assert.equal(twitter["twitter:image"], openGraph["og:image"]);
assert.equal(twitter["twitter:image:alt"], openGraph["og:image:alt"]);
assert.ok(twitter["twitter:description"].length >= 50, "Twitter/X description is too terse");

assert.doesNotMatch(
  head,
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|file:\/{2,}|dropbox\.com|github\.io|pages\.dev|vercel\.app|netlify\.app)/i,
  "Production metadata must not contain a local, repository, or preview URL",
);

const scriptBlocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map(
  (match) => ({
    attributes: parseAttributes(`<script${match[1]}>`),
    source: match[2],
  }),
);
const jsonLdBlocks = scriptBlocks.filter(
  ({ attributes }) => attributes.type?.toLowerCase() === "application/ld+json",
);
assert.ok(jsonLdBlocks.length > 0, "At least one JSON-LD block is required");

const jsonLdTypes = new Set();
function collectJsonLdTypes(value) {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdTypes(item);
    return;
  }
  if (!value || typeof value !== "object") return;

  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  for (const type of types) if (typeof type === "string") jsonLdTypes.add(type);
  for (const child of Object.values(value)) collectJsonLdTypes(child);
}

for (const [index, block] of jsonLdBlocks.entries()) {
  let parsed;
  try {
    parsed = JSON.parse(block.source.trim());
  } catch (error) {
    assert.fail(`JSON-LD block ${index + 1} is invalid JSON: ${error.message}`);
  }
  collectJsonLdTypes(parsed);
}
for (const type of ["WebApplication", "WebPage", "FAQPage"]) {
  assert.ok(jsonLdTypes.has(type), `JSON-LD must include ${type}`);
}

const mainTags = tagRecords("main", body);
assert.equal(mainTags.length, 1, "Expected one semantic main element");
assert.equal(mainTags[0].attributes.id, "learn", "The educational main element must be #learn");

const canvasTags = tagRecords("canvas", body);
assert.equal(canvasTags.length, 2, "Expected the accessible Canvas fallback and stacked research canvas");
const simulationCanvas = canvasTags.find(({ attributes }) => attributes.id === "simCanvas");
const researchCanvas = canvasTags.find(({ attributes }) => attributes.id === "researchCanvas");
assert.equal(simulationCanvas?.attributes.role, "img", "The interactive canvas must retain its accessible image role");
assert.equal(researchCanvas?.attributes["aria-hidden"], "true", "The stacked WebGL canvas must stay hidden from assistive technology");

const expectedSectionHeadings = [
  "What the lab visualizes",
  "How it works",
  "Two simulation modes",
  "Why the presets behave differently",
  "Shock fronts, clouds, and surface interaction",
  "Approximation and safety limits",
  "Frequently asked questions",
  "Related experiments",
];
const headingText = [...body.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi)].map((match) =>
  normalizedText(match[1]),
);
for (const expectedHeading of expectedSectionHeadings) {
  assert.ok(headingText.includes(expectedHeading), `Missing visible section: ${expectedHeading}`);
}

function semanticSection(labelId) {
  const pattern = new RegExp(
    `<section\\b[^>]*\\baria-labelledby=(?:"${labelId}"|'${labelId}')[^>]*>([\\s\\S]*?)<\\/section\\s*>`,
    "i",
  );
  const match = body.match(pattern);
  assert.ok(match, `Missing semantic section labelled by #${labelId}`);
  return match[1];
}

for (const labelId of ["howHeading", "modesHeading", "presetsHeading", "scienceHeading", "limitsHeading", "faqHeading", "relatedHeading"]) {
  semanticSection(labelId);
}

const faqSection = semanticSection("faqHeading");
const faqItems = [...faqSection.matchAll(/<details\b[^>]*>[\s\S]*?<\/details\s*>/gi)];
const faqSummaries = [...faqSection.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/gi)];
assert.ok(faqItems.length >= 3, "The visible FAQ must contain at least three items");
assert.equal(faqSummaries.length, faqItems.length, "Every FAQ item must have a visible summary");
assert.ok(faqSummaries.every((match) => normalizedText(match[1]).endsWith("?")), "FAQ summaries must be questions");

const relatedSection = semanticSection("relatedHeading");
const relatedLinks = tagRecords("a", relatedSection).map(({ attributes }) => attributes.href);
assert.ok(
  relatedLinks.includes("https://www.ericbarker.co/gray-scott-reaction-lab/"),
  "Related experiments must link to the canonical Gray–Scott Reaction Lab",
);
assert.ok(
  relatedLinks.includes("https://www.ericbarker.co/projects.html"),
  "Related experiments must link to the canonical projects index",
);
assert.ok(relatedLinks.length >= 2, "Related experiments must contain at least two links");

const visibleBodyText = normalizedText(body);
for (const requiredText of [
  "Educational visualization only.",
  "simplified approximations",
  "must not be used for safety, engineering, emergency planning, targeting, or real-world predictions",
  "No explosive construction, materials, quantities, ratios, detonators, triggers, or weapon-design information.",
  "No maps, addresses, coordinates, real targets, population data, infrastructure overlays, or casualty estimates.",
  "No weapon construction, targeting, or casualty information.",
  "Nuclear Airburst — Research Model",
  "deterministic WebGL2 velocity, temperature, and density field",
  "No pressure, yield, distance, damage, or safety prediction is computed.",
  "A creative-coding experiment by Eric Barker",
  "First-party implementation released under the MIT License",
  "third-party terms and source notices",
]) {
  assert.ok(visibleBodyText.includes(requiredText), `Missing visible content: ${requiredText}`);
}
const noscriptText = normalizedText(body.match(/<noscript\b[^>]*>([\s\S]*?)<\/noscript\s*>/i)?.[1] ?? "");
assert.ok(noscriptText.length >= 50, "The page needs a meaningful no-JavaScript explanation");

const externalScripts = scriptBlocks.filter(({ attributes }) => attributes.src);
const analyticsLoaders = externalScripts.filter(({ attributes }) =>
  /(?:googletagmanager\.com|google-analytics\.com)/i.test(attributes.src),
);
assert.equal(analyticsLoaders.length, 1, "Google Analytics must be loaded exactly once");
const analyticsUrl = new URL(analyticsLoaders[0].attributes.src);
assert.equal(analyticsUrl.hostname, "www.googletagmanager.com");
assert.equal(analyticsUrl.pathname, "/gtag/js");
const measurementId = analyticsUrl.searchParams.get("id");
assert.match(measurementId ?? "", /^G-[A-Z0-9]+$/, "The GA loader needs a valid measurement ID");
const gaConfigurations = [
  ...scriptBlocks
    .filter(({ attributes }) => !attributes.src)
    .flatMap(({ source }) => [...source.matchAll(/\bgtag\s*\(\s*["']config["']\s*,\s*["']([^"']+)["']/g)]),
];
assert.equal(gaConfigurations.length, 1, "Google Analytics must be configured exactly once");
assert.equal(gaConfigurations[0][1], measurementId, "GA loader and configuration IDs must match");

function projectPathForReference(reference, label) {
  const resolvedUrl = new URL(reference, PRODUCTION_URL);
  const production = new URL(PRODUCTION_URL);
  if (resolvedUrl.origin !== production.origin) return null;
  assert.ok(
    resolvedUrl.pathname.startsWith(production.pathname),
    `${label} must remain inside ${production.pathname}`,
  );
  const relativePath = decodeURIComponent(resolvedUrl.pathname.slice(production.pathname.length));
  const filePath = path.resolve(PROJECT_ROOT, relativePath);
  assert.ok(
    filePath === PROJECT_ROOT || filePath.startsWith(`${PROJECT_ROOT}${path.sep}`),
    `${label} escaped the project root`,
  );
  return filePath;
}

async function assertFile(filePath, label) {
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    assert.fail(`${label} does not exist: ${path.relative(PROJECT_ROOT, filePath)}`);
  }
  assert.ok(fileStats.isFile(), `${label} is not a file: ${path.relative(PROJECT_ROOT, filePath)}`);
}

const stylesheetLinks = linkTags.filter(({ attributes }) =>
  attributes.rel?.toLowerCase().split(/\s+/).includes("stylesheet"),
);
assert.ok(stylesheetLinks.length > 0, "At least one stylesheet reference is required");
const stylesheetReference = stylesheetLinks
  .map(({ attributes }) => attributes.href)
  .find((reference) => /^(?:releases\/[a-f0-9]{16}\/)?assets\/styles\.css$/.test(reference ?? ""));
assert.ok(stylesheetReference, "The source or content-addressed production stylesheet reference is missing");
const moduleScripts = externalScripts.filter(({ attributes }) => attributes.type?.toLowerCase() === "module");
assert.equal(moduleScripts.length, 1, "Expected exactly one module entry point");
const moduleReference = moduleScripts[0].attributes.src;
assert.match(
  moduleReference,
  /^(?:releases\/[a-f0-9]{16}\/)?scripts\/app\.js$/,
  "Unexpected module entry point",
);
const stylesheetRelease = stylesheetReference.match(/^releases\/([a-f0-9]{16})\//)?.[1] ?? null;
const moduleRelease = moduleReference.match(/^releases\/([a-f0-9]{16})\//)?.[1] ?? null;
assert.equal(stylesheetRelease, moduleRelease, "Stylesheet and module must belong to the same release");

const runtimeFiles = new Set();
for (const { attributes } of [...stylesheetLinks, ...externalScripts]) {
  const reference = attributes.href ?? attributes.src;
  const filePath = projectPathForReference(reference, `Runtime reference ${reference}`);
  if (!filePath) continue;
  await assertFile(filePath, `Runtime reference ${reference}`);
  runtimeFiles.add(filePath);
}

const inspectedModules = new Set();
async function inspectModuleGraph(modulePath) {
  if (inspectedModules.has(modulePath)) return;
  inspectedModules.add(modulePath);
  const source = await readFile(modulePath, "utf8");
  const specifiers = new Set();
  const staticImportPattern = /\b(?:import|export)\s+(?:(?:[\w*$,\s{}]+)\s+from\s+)?(["'])([^"']+)\1/g;
  const dynamicImportPattern = /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g;
  for (const match of source.matchAll(staticImportPattern)) specifiers.add(match[2]);
  for (const match of source.matchAll(dynamicImportPattern)) specifiers.add(match[2]);

  for (const specifier of specifiers) {
    if (!specifier.startsWith(".")) continue;
    const dependencyPath = path.resolve(path.dirname(modulePath), specifier.split(/[?#]/, 1)[0]);
    assert.ok(
      dependencyPath.startsWith(`${PROJECT_ROOT}${path.sep}`),
      `Module dependency escaped the project root: ${specifier}`,
    );
    await assertFile(dependencyPath, `Module dependency ${specifier}`);
    runtimeFiles.add(dependencyPath);
    if (/\.m?js$/i.test(dependencyPath)) await inspectModuleGraph(dependencyPath);
  }
}
for (const { attributes } of moduleScripts) {
  const modulePath = projectPathForReference(attributes.src, `Module ${attributes.src}`);
  await inspectModuleGraph(modulePath);
}

const socialImagePath = projectPathForReference(openGraph["og:image"], "Open Graph image");
assert.ok(socialImagePath, "The Open Graph image must be a production-hosted project asset");
await assertFile(socialImagePath, "Social image");
const socialImage = await readFile(socialImagePath);
assert.ok(socialImage.length >= 24, "Social image is truncated");
assert.deepEqual(
  [...socialImage.subarray(0, 8)],
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "Social image must be a genuine PNG",
);
assert.equal(socialImage.subarray(12, 16).toString("ascii"), "IHDR", "Social PNG is missing IHDR");
assert.equal(socialImage.readUInt32BE(16), 1200, "Social image width must be 1200 pixels");
assert.equal(socialImage.readUInt32BE(20), 630, "Social image height must be 630 pixels");

const requiredNoticeFiles = [
  "FFmpeg-LICENSE.md",
  "x264-COPYING.txt",
  "x265-COPYING.txt",
  "libvpx-LICENSE.txt",
  "LAME-COPYING.txt",
  "LAME-LICENSE.txt",
  "Ogg-COPYING.txt",
  "Theora-COPYING.txt",
  "Opus-COPYING.txt",
  "Vorbis-COPYING.txt",
  "zlib-README.txt",
  "WebP-COPYING.txt",
  "FreeType-FTL.txt",
  "FreeType-GPLv2.txt",
  "FriBidi-COPYING.txt",
  "HarfBuzz-COPYING.txt",
  "libass-COPYING.txt",
  "zimg-COPYING.txt",
  "Emscripten-LICENSE.txt",
];
let noticeRoot = path.join(PROJECT_ROOT, "vendor", "ffmpeg", "core", "licenses");
if (moduleRelease) {
  const vendorRoots = (await readdir(path.join(PROJECT_ROOT, "vendor-releases"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{16}$/.test(entry.name));
  assert.equal(vendorRoots.length, 1, "A staged release must contain exactly one content-addressed vendor directory");
  noticeRoot = path.join(PROJECT_ROOT, "vendor-releases", vendorRoots[0].name, "ffmpeg", "core", "licenses");
}
for (const filename of requiredNoticeFiles) {
  const noticePath = path.join(noticeRoot, filename);
  await assertFile(noticePath, `Third-party notice ${filename}`);
  assert.ok((await stat(noticePath)).size > 100, `Third-party notice is unexpectedly small: ${filename}`);
}

console.log("Explosion Dynamics Lab static audit: PASS");
console.log("  one H1; exact title, description, canonical, and indexable robots verified");
console.log("  complete Open Graph, Twitter/X, and JSON-LD metadata verified");
console.log(`  ${expectedSectionHeadings.length} content headings, ${faqItems.length} FAQ items, and ${relatedLinks.length} related links verified`);
console.log(`  one GA loader/configuration and ${runtimeFiles.size} local runtime files verified`);
console.log("  genuine 1200 × 630 local social image verified");
console.log(`  ${requiredNoticeFiles.length} required local upstream license and copyright notices present`);
