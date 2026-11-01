#!/usr/bin/env node
/**
 * Writes src/services.ts: one lazily created property of the Aurea client per generated API class
 * (WalletsApi → aurea.wallets, CardProgramApi → aurea.cardProgram). Run by scripts/generate.sh.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(ROOT, "src/generated/apis/index.ts"), "utf8");
const classes = [...index.matchAll(/export \* from '\.\/(\w+Api)';/g)].map((m) => m[1]).sort();
if (!classes.length) throw new Error("no API class in src/generated/apis/index.ts");
const prop = (cls) => {
  const base = cls.replace(/Api$/, "");
  return base[0].toLowerCase() + base.slice(1);
};
const lines = [
  "// Written by scripts/write-services.mjs from src/generated/apis: do not edit.",
  "import type { Configuration } from \"./generated/runtime\";",
  `import { ${classes.join(", ")} } from "./generated/apis";`,
  "",
  "/** The generated API classes, one property each, created on first use. */",
  "export class Services {",
  "  #cache = new Map<unknown, unknown>();",
  "  constructor(protected readonly configuration: Configuration) {}",
  "  #get<T>(Ctor: new (c: Configuration) => T): T {",
  "    let api = this.#cache.get(Ctor) as T | undefined;",
  "    if (!api) {",
  "      api = new Ctor(this.configuration);",
  "      this.#cache.set(Ctor, api);",
  "    }",
  "    return api;",
  "  }",
  ...classes.flatMap((cls) => [`  get ${prop(cls)}(): ${cls} {`, `    return this.#get(${cls});`, "  }"]),
  "}",
  "",
];
fs.writeFileSync(path.join(ROOT, "src/services.ts"), lines.join("\n"));
console.log(`src/services.ts: ${classes.length} API classes`);
