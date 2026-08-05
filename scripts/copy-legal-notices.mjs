import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destinationRoot = process.argv[2]
  ? resolve(rootDir, process.argv[2])
  : join(rootDir, "apps", "app", "dist");
const destinationDir = join(destinationRoot, "legal");
const legalFiles = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "TRADEMARKS.md",
];

mkdirSync(destinationDir, { recursive: true });

for (const file of legalFiles) {
  copyFileSync(join(rootDir, file), join(destinationDir, file));
}

console.log(`Copied legal notices to ${destinationDir}.`);
