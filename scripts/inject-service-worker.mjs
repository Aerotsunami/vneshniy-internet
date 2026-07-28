import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const distDirectory = join(root, "dist");
const assetsDirectory = join(distDirectory, "assets");
const serviceWorkerFile = join(distDirectory, "sw.js");

const assetNames = (await readdir(assetsDirectory))
  .filter((file) => !file.endsWith(".map"))
  .sort();

if (!assetNames.length) {
  throw new Error("No built assets found for service worker precache");
}

const assetUrls = assetNames.map((file) => `./assets/${file}`);
const version = createHash("sha256").update(assetUrls.join("\n")).digest("hex").slice(0, 12);
const source = await readFile(serviceWorkerFile, "utf8");

if (!source.includes("__CACHE_VERSION__") || !source.includes("/* inject:assets */ []")) {
  throw new Error("Service worker injection markers were not found");
}

const injected = source
  .replace("__CACHE_VERSION__", `vneshniy-internet-${version}`)
  .replace("/* inject:assets */ []", JSON.stringify(assetUrls, null, 2));

await writeFile(serviceWorkerFile, injected);
console.log(`Injected ${assetUrls.length} built asset(s) into service worker cache ${version}.`);
