import { access, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const issuesDirectory = join(root, "content", "issues");
const candidatesFile = join(root, ".daily-news-candidates.json");
const mode = process.argv[2];

const feeds = [
  ["The Verge", "https://www.theverge.com/rss/index.xml"],
  ["TechCrunch", "https://techcrunch.com/feed/"],
  ["Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"],
  ["Engadget", "https://www.engadget.com/rss.xml"],
  ["Wired", "https://www.wired.com/feed/rss"],
  ["GitHub Blog", "https://github.blog/feed/"],
  ["Product Hunt", "https://www.producthunt.com/feed"],
  ["Hacker News", "https://hnrss.org/newest?points=10"],
  ["9to5Mac", "https://9to5mac.com/feed/"],
  ["The Register", "https://www.theregister.com/headlines.atom"]
];

function issueDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function element(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return decodeXml(match[1]);
  }
  return "";
}

function entryLink(block) {
  const href = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  return decodeXml(href || element(block, ["link", "guid"]));
}

function parseFeed(source, xml) {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  return blocks.flatMap((block) => {
    const title = element(block, ["title"]);
    const url = entryLink(block);
    const rawDate = element(block, ["pubDate", "published", "updated", "dc:date"]);
    const timestamp = Date.parse(rawDate);
    const summary = element(block, ["description", "summary", "content:encoded", "content"]);
    if (!title || !url.startsWith("https://") || Number.isNaN(timestamp)) return [];
    return [{ source, title, url, publishedAt: new Date(timestamp).toISOString(), summary: summary.slice(0, 1200) }];
  });
}

async function fetchFeed([source, url]) {
  const response = await fetch(url, {
    headers: { "user-agent": "vneshniy-internet-daily/1.0" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  return parseFeed(source, await response.text());
}

async function collect() {
  const today = issueDate();
  try {
    await access(join(issuesDirectory, `${today}.json`));
    console.log(`Issue ${today} already exists.`);
    return;
  } catch {}

  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const now = Date.now();
  const oldest = now - 36 * 60 * 60 * 1000;
  const newest = now + 2 * 60 * 60 * 1000;
  const seen = new Set();
  const candidates = results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item) => {
      const timestamp = Date.parse(item.publishedAt);
      if (timestamp < oldest || timestamp > newest || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 100)
    .map((item) => ({ ...item, date: item.publishedAt.slice(0, 10) }));

  const failures = results.flatMap((result, index) =>
    result.status === "rejected" ? [`${feeds[index][0]}: ${result.reason}`] : []
  );
  if (candidates.length < 3) throw new Error(`Only ${candidates.length} fresh candidates found. ${failures.join("; ")}`);

  await writeFile(candidatesFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), issueDate: today, candidates }, null, 2)}\n`);
  console.log(`Collected ${candidates.length} candidates for ${today}.`);
  if (failures.length) console.warn(`Unavailable feeds: ${failures.join("; ")}`);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function validate() {
  const today = issueDate();
  const issueFile = join(issuesDirectory, `${today}.json`);
  const [issue, candidateData, issueFiles] = await Promise.all([
    readFile(issueFile, "utf8").then(JSON.parse),
    readFile(candidatesFile, "utf8").then(JSON.parse),
    readdir(issuesDirectory)
  ]);
  const candidatesByUrl = new Map(candidateData.candidates.map((candidate) => [candidate.url, candidate]));
  const historicalIds = new Set();
  for (const file of issueFiles.filter((file) => file.endsWith(".json") && file !== `${today}.json`)) {
    const historical = JSON.parse(await readFile(join(issuesDirectory, file), "utf8"));
    historical.materials.forEach((material) => historicalIds.add(material.id));
  }

  expect(issue.date === today, `Issue date must be ${today}`);
  expect(typeof issue.label === "string" && issue.label.length > 0, "Issue label is required");
  expect(typeof issue.summary === "string" && issue.summary.length > 0, "Issue summary is required");
  expect(Array.isArray(issue.materials) && issue.materials.length >= 1 && issue.materials.length <= 10, "Issue must contain 1 to 10 materials");

  const ids = new Set();
  let aiCount = 0;
  for (const material of issue.materials) {
    expect(/^[a-z0-9-]+$/.test(material.id), `Invalid material id: ${material.id}`);
    expect(!ids.has(material.id) && !historicalIds.has(material.id), `Duplicate material id: ${material.id}`);
    ids.add(material.id);
    expect(typeof material.title === "string" && material.title.length > 0, `${material.id}: title is required`);
    expect(typeof material.topic === "string" && material.topic.length > 0, `${material.id}: topic is required`);
    expect(typeof material.isAi === "boolean", `${material.id}: isAi must be boolean`);
    if (material.isAi) aiCount += 1;
    expect(Array.isArray(material.body) && material.body.length >= 3 && material.body.length <= 6, `${material.id}: body must contain 3 to 6 paragraphs`);
    expect(Array.isArray(material.check), `${material.id}: check must be an array`);
    expect(Array.isArray(material.sources) && material.sources.length >= 1 && material.sources.length <= 3, `${material.id}: sources must contain 1 to 3 entries`);
    for (const source of material.sources) {
      const candidate = candidatesByUrl.get(source.url);
      expect(candidate, `${material.id}: source URL was not present in the collected feed data: ${source.url}`);
      expect(source.date === candidate.date, `${material.id}: source date does not match feed data for ${source.url}`);
    }
  }
  expect(issue.materials.length < 3 || aiCount <= 2, "At most 2 AI-only materials are allowed");
  await unlink(candidatesFile);
  console.log(`Validated ${issue.materials.length} materials for ${today}.`);
}

if (mode === "date") console.log(issueDate());
else if (mode === "collect") await collect();
else if (mode === "validate") await validate();
else throw new Error("Usage: node scripts/daily-issue.mjs <date|collect|validate>");
