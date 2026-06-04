const fs = require("node:fs/promises");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const inputFiles = process.argv.slice(2);

const markdownImagePattern = /!\[([^\]]*)\]\(([^)\s]+)(\s+["'][^"']+["'])?\)/g;

const contentTypeExtensions = new Map([
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/png", ".png"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/svg+xml", ".svg"],
  ["image/bmp", ".bmp"],
  ["image/tiff", ".tiff"],
  ["image/avif", ".avif"],
]);

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(value);
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function stripMdxExtension(value) {
  return value.replace(/\.mdx$/i, "");
}

function getPaths(inputFile) {
  const mdxPath = path.resolve(rootDir, inputFile);
  const relativeMdx = path.relative(rootDir, mdxPath);

  if (relativeMdx.startsWith("..") || path.isAbsolute(relativeMdx)) {
    throw new Error(`MDX file must be inside the docs directory: ${inputFile}`);
  }

  const relativeWithoutExt = stripMdxExtension(relativeMdx);
  const imageDir = path.join(rootDir, "images", relativeWithoutExt);
  const mdxImageDir = path.relative(path.dirname(mdxPath), imageDir);

  return {
    mdxPath,
    imageDir,
    mdxImageDir: toPosixPath(mdxImageDir),
    relativeMdx: toPosixPath(relativeMdx),
    imageBasename: path.basename(relativeWithoutExt),
  };
}

function extensionFromContentType(contentType) {
  if (!contentType) return "";
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  return contentTypeExtensions.get(normalized) || "";
}

function extensionFromUrl(url) {
  try {
    const { pathname } = new URL(url);
    const ext = path.extname(pathname).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".tif", ".tiff", ".avif"].includes(ext)
      ? ext.replace(".jpeg", ".jpg").replace(".tif", ".tiff")
      : "";
  } catch {
    return "";
  }
}

function extensionFromBytes(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return ".png";
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return ".jpg";
  }

  if (bytes.length >= 6) {
    const header = bytes.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") return ".gif";
  }

  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return ".webp";
  }

  if (bytes.length >= 2 && bytes.subarray(0, 2).toString("ascii") === "BM") {
    return ".bmp";
  }

  if (
    bytes.length >= 4 &&
    (bytes.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
      bytes.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])))
  ) {
    return ".tiff";
  }

  const textStart = bytes.subarray(0, 200).toString("utf8").trimStart().toLowerCase();
  if (textStart.startsWith("<svg") || textStart.startsWith("<?xml")) return ".svg";

  return "";
}

async function downloadImage(url, index, paths) {
  console.log(`[${paths.relativeMdx}] Downloading ${index}: ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; docs-image-downloader/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  if (bytes.length === 0) {
    throw new Error(`Downloaded empty file: ${url}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const ext = extensionFromContentType(contentType) || extensionFromBytes(bytes) || extensionFromUrl(url) || ".png";
  const filename = `${paths.imageBasename}-${String(index).padStart(3, "0")}${ext}`;
  const filePath = path.join(paths.imageDir, filename);

  await fs.writeFile(filePath, bytes);
  return `${paths.mdxImageDir}/${filename}`;
}

async function processMdx(inputFile) {
  const paths = getPaths(inputFile);
  await fs.mkdir(paths.imageDir, { recursive: true });

  const original = await fs.readFile(paths.mdxPath, "utf8");
  const remoteUrls = [];
  const seen = new Set();

  for (const match of original.matchAll(markdownImagePattern)) {
    const url = match[2];
    if (!isRemoteUrl(url) || seen.has(url)) continue;
    seen.add(url);
    remoteUrls.push(url);
  }

  if (remoteUrls.length === 0) {
    console.log(`[${paths.relativeMdx}] No remote Markdown images found.`);
    return;
  }

  const replacements = new Map();
  for (const [position, url] of remoteUrls.entries()) {
    replacements.set(url, await downloadImage(url, position + 1, paths));
  }

  const updated = original.replace(markdownImagePattern, (fullMatch, alt, url, title = "") => {
    const replacement = replacements.get(url);
    return replacement ? `![${alt}](${replacement}${title})` : fullMatch;
  });

  await fs.writeFile(paths.mdxPath, updated, "utf8");

  console.log(`[${paths.relativeMdx}] Downloaded ${remoteUrls.length} image(s) to ${toPosixPath(path.relative(rootDir, paths.imageDir))}.`);
  console.log(`[${paths.relativeMdx}] Updated image links to use ${paths.mdxImageDir}/ paths.`);
}

async function main() {
  const files = inputFiles.length > 0 ? inputFiles : ["index.mdx"];

  for (const file of files) {
    await processMdx(file);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
