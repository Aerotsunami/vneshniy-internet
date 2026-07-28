import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const issuesDirectory = join(root, "content", "issues");
const outputFile = join(root, "public", "archive.json");
const checkOnly = process.argv.includes("--check");

function fail(file, message) {
  throw new Error(`${file}: ${message}`);
}

function expectString(file, value, field) {
  if (typeof value !== "string" || !value.trim()) fail(file, `"${field}" must be a non-empty string`);
}

function expectStringArray(file, value, field, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(file, `"${field}" must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  value.forEach((entry, index) => expectString(file, entry, `${field}[${index}]`));
}

function validateIssue(file, issue) {
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) fail(file, "root must be an object");
  expectString(file, issue.date, "date");
  expectString(file, issue.label, "label");
  expectString(file, issue.summary, "summary");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(issue.date) || Number.isNaN(Date.parse(`${issue.date}T12:00:00Z`))) {
    fail(file, `"date" must use YYYY-MM-DD`);
  }

  if (!Array.isArray(issue.materials) || issue.materials.length < 1 || issue.materials.length > 5) {
    fail(file, `"materials" must contain 1 to 5 items`);
  }

  const ids = new Set();
  let aiCount = 0;

  issue.materials.forEach((material, materialIndex) => {
    const prefix = `materials[${materialIndex}]`;
    expectString(file, material.id, `${prefix}.id`);
    expectString(file, material.title, `${prefix}.title`);
    expectString(file, material.topic, `${prefix}.topic`);
    expectStringArray(file, material.body, `${prefix}.body`);
    expectStringArray(file, material.check, `${prefix}.check`, true);

    if (!/^[a-z0-9-]+$/.test(material.id)) fail(file, `"${prefix}.id" must be URL-safe`);
    if (ids.has(material.id)) fail(file, `"${prefix}.id" must be unique inside the issue`);
    ids.add(material.id);

    if (typeof material.isAi !== "boolean") fail(file, `"${prefix}.isAi" must be boolean`);
    if (material.isAi) aiCount += 1;

    if (material.body.length < 3 || material.body.length > 6) {
      fail(file, `"${prefix}.body" must contain 3 to 6 paragraphs`);
    }

    if (!Array.isArray(material.sources) || material.sources.length < 1 || material.sources.length > 3) {
      fail(file, `"${prefix}.sources" must contain 1 to 3 sources`);
    }

    material.sources.forEach((source, sourceIndex) => {
      const sourcePrefix = `${prefix}.sources[${sourceIndex}]`;
      expectString(file, source.label, `${sourcePrefix}.label`);
      expectString(file, source.url, `${sourcePrefix}.url`);
      expectString(file, source.date, `${sourcePrefix}.date`);
      if (!source.url.startsWith("https://")) fail(file, `"${sourcePrefix}.url" must use HTTPS`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(source.date)) fail(file, `"${sourcePrefix}.date" must use YYYY-MM-DD`);
    });
  });

  if (issue.materials.length >= 3 && aiCount > 2) {
    fail(file, "an issue with 3 or more materials may contain at most 2 AI-only items");
  }

  return issue;
}

const files = (await readdir(issuesDirectory))
  .filter((file) => file.endsWith(".json"))
  .sort()
  .reverse();

if (!files.length) throw new Error("No issue files found");

const issues = [];
const globalIds = new Set();

for (const file of files) {
  const issue = validateIssue(file, JSON.parse(await readFile(join(issuesDirectory, file), "utf8")));
  if (`${issue.date}.json` !== file) fail(file, "filename must match the issue date");

  for (const material of issue.materials) {
    if (globalIds.has(material.id)) fail(file, `material id "${material.id}" is duplicated in the archive`);
    globalIds.add(material.id);
  }
  issues.push(issue);
}

const archive = {
  generatedAt: new Date().toISOString(),
  issueCount: issues.length,
  topics: [...new Set(issues.flatMap((issue) => issue.materials.map((material) => material.topic)))].sort(
    (a, b) => a.localeCompare(b, "ru")
  ),
  issues
};

if (!checkOnly) {
  await mkdir(join(root, "public"), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(archive, null, 2)}\n`);
}

console.log(`Validated ${issues.length} issue(s), ${globalIds.size} material(s)${checkOnly ? "" : " and built archive.json"}.`);
