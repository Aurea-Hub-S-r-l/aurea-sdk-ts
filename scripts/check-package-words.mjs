#!/usr/bin/env node
/**
 * Fails when what npm publishes holds a name or phrase docs.aureahub.com may not show (scripts/forbidden-words.mjs,
 * vendored from the docs repository): a provider's name, a regulatory claim, a yield figure, Aurea holding funds, a
 * support address other than help@aureahub.com, internal jargon. Scans the files `npm pack` would publish.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findingsIn } from "./forbidden-words.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pack = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8" }));
const files = pack[0].files.map((f) => f.path);
const findings = files.flatMap((file) => findingsIn(fs.readFileSync(path.join(ROOT, file), "utf8"), file));
for (const finding of findings.slice(0, 50)) console.log(finding);
console.log(`${files.length} file(s) scanned, ${findings.length} forbidden name(s) or phrase(s).`);
if (findings.length) process.exit(1);
