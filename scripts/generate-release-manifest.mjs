#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { generateReleaseManifest } from "./release-manifest-lib.mjs";

function readArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? "end of command"}.`);
    }
    args.set(key.slice(2), value);
  }
  return args;
}

const args = readArgs(process.argv.slice(2));
const kind = args.get("kind");
const version = args.get("version");
const tag = args.get("tag");
const directory = path.resolve(args.get("directory") ?? "dist/release");
const output = path.resolve(
  args.get("output") ?? path.join(directory, `locoris-${kind}-release.json`)
);

const manifest = await generateReleaseManifest({
  kind,
  version,
  tag,
  directory,
  output,
  repository: args.get("repository") ?? process.env.GITHUB_REPOSITORY ?? "locoris/locoris",
  sourceCommit: args.get("source-commit") ?? process.env.GITHUB_SHA ?? null,
  containerImage: args.get("container-image") ?? null,
  containerDigest: args.get("container-digest") ?? null
});

console.log(`Generated ${manifest.product} ${manifest.version} manifest at ${output}.`);

