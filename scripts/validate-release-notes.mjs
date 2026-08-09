import { readFile } from "node:fs/promises";
import path from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const kind = args.get("--kind");
if (!new Set(["app", "server"]).has(kind)) {
  throw new Error("Use --kind app or --kind server.");
}

const manifestPath = kind === "app" ? "apps/app/package.json" : "apps/personal-server/package.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const version = args.get("--version") ?? manifest.version;
const notesPath = path.join("docs", "releases", kind, `${version}.md`);
const notes = await readFile(notesPath, "utf8");
const expectedTitle = kind === "app" ? `# Locoris ${version}` : `# Locoris Server ${version}`;

if (!notes.startsWith(`${expectedTitle}\n`)) {
  throw new Error(`${notesPath} must start with "${expectedTitle}".`);
}

const requiredSections = [
  "Summary",
  "Security",
  "Added",
  "Improved",
  "Fixed",
  "Compatibility",
  "Migration",
  "Update",
  "Rollback",
  "Known issues",
  "Verification"
];

for (const heading of requiredSections) {
  const marker = `## ${heading}`;
  const start = notes.indexOf(marker);
  if (start < 0) throw new Error(`${notesPath} is missing "${marker}".`);
  const contentStart = start + marker.length;
  const nextHeading = notes.indexOf("\n## ", contentStart);
  const section = notes.slice(contentStart, nextHeading < 0 ? undefined : nextHeading).trim();
  if (!section) throw new Error(`${notesPath} has an empty "${marker}" section.`);
}

if (/\b(?:TBD|TODO|PLACEHOLDER)\b/i.test(notes)) {
  throw new Error(`${notesPath} still contains a placeholder.`);
}

console.log(`Validated ${notesPath}`);
