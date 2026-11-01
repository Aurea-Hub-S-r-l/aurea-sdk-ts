#!/usr/bin/env node
/**
 * The public subset of the API's OpenAPI document that this SDK is generated from.
 *
 *   node scripts/filter-spec.mjs <openapi.json> <operations.json> <out.json>
 *
 * - <openapi.json>: the production document, https://api.aureahub.com/v1/docs/json.
 * - <operations.json>: the operations docs.aureahub.com documents ([method, path] pairs, the same list the docs build
 *   puts in its Postman collection). The production document also lists routes the docs leave out (the platform's
 *   own administration routes, routes kept for older integrations); the SDK has exactly what the docs document.
 *
 * What a developer reads in the SDK (type names, JSDoc, enum values) follows the docs' rules
 * (scripts/forbidden-words.mjs, vendored from the docs repository):
 * - an optional parameter or property whose name names a provider is left out (the API answers a neutral twin of
 *   every such field: bankRampStatus, eurAccountIban, typeNeutral…); a required one fails the run;
 * - an enum value that names a provider is left out of the enum (its neutral twin, `<field>Neutral`, is kept);
 * - a description, summary or example that holds a forbidden word is dropped.
 * Only components the kept operations reach are kept.
 */
import fs from "node:fs";
import { FORBIDDEN, findingsIn } from "./forbidden-words.mjs";

const [specPath, opsPath, outPath] = process.argv.slice(2);
if (!specPath || !opsPath || !outPath) {
  console.error("usage: filter-spec.mjs <openapi.json> <operations.json> <out.json>");
  process.exit(2);
}

const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const operations = JSON.parse(fs.readFileSync(opsPath, "utf8"));
const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"];
const PARTNER = new RegExp(FORBIDDEN[0].pattern.source, "i");
const forbidden = (text) => findingsIn(String(text), "x").length > 0;
const normalise = (p) => p.replace(/\{[^}]+\}/g, "{}").replace(/\/+$/, "");

const wanted = new Set(operations.map(([method, path]) => `${method.toLowerCase()} ${normalise(path)}`));
const paths = {};
const found = new Set();
for (const [path, item] of Object.entries(spec.paths)) {
  const kept = {};
  for (const [key, value] of Object.entries(item)) {
    if (!METHODS.includes(key)) continue;
    const id = `${key} ${normalise(path)}`;
    if (wanted.has(id)) {
      kept[key] = value;
      found.add(id);
    }
  }
  if (Object.keys(kept).length) {
    if (item.parameters) kept.parameters = item.parameters;
    paths[path] = kept;
  }
}
const missing = [...wanted].filter((id) => !found.has(id));
if (missing.length) {
  console.error(`${missing.length} documented operation(s) not in the document: ${missing.slice(0, 5).join(", ")}`);
  process.exit(1);
}

const errors = [];
const stats = { properties: 0, parameters: 0, enumValues: 0, texts: 0 };

/**
 * Walks any node: drops provider-named fields, provider enum values and texts with a forbidden word. In what the API
 * answers (`answer`: a response, or a component only responses reach) a required provider-named field is dropped too:
 * the docs document only its neutral twin; in what a caller sends, it fails the run.
 */
function scrub(node, where, answer) {
  if (Array.isArray(node)) return node.forEach((child, i) => scrub(child, `${where}[${i}]`, answer));
  if (!node || typeof node !== "object") return;
  for (const key of ["description", "summary", "example", "examples", "title"]) {
    if (!(key in node)) continue;
    const value = node[key];
    if (forbidden(typeof value === "string" ? value : JSON.stringify(value))) {
      delete node[key];
      stats.texts++;
    }
  }
  if (node.properties && typeof node.properties === "object") {
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    for (const name of Object.keys(node.properties)) {
      if (!PARTNER.test(name)) continue;
      if (required.has(name) && !answer) {
        errors.push(`${where}.properties.${name}: a required field of a request names a provider`);
        continue;
      }
      delete node.properties[name];
      if (required.has(name)) node.required = node.required.filter((r) => r !== name);
      stats.properties++;
    }
  }
  if (Array.isArray(node.parameters)) {
    node.parameters = node.parameters.filter((p) => {
      if (!p || p.$ref || !PARTNER.test(p.name)) return true;
      if (p.required) {
        errors.push(`${where}: required parameter ${p.name} names a provider`);
        return true;
      }
      stats.parameters++;
      return false;
    });
  }
  if (Array.isArray(node.enum)) {
    const before = node.enum.length;
    node.enum = node.enum.filter((v) => typeof v !== "string" || !forbidden(v));
    stats.enumValues += before - node.enum.length;
    if (node.enum.length === 0) delete node.enum;
  }
  if ("default" in node && typeof node.default === "string" && forbidden(node.default)) delete node.default;
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" && value && typeof value === "object") {
      for (const [name, child] of Object.entries(value)) scrub(child, `${where}.${name}`, answer);
    } else if (typeof value === "object") scrub(value, `${where}.${key}`, answer || key === "responses");
  }
}

// Components the kept operations reach ($ref closure).
const components = spec.components || {};
const reached = new Map();
function collect(node) {
  if (Array.isArray(node)) return node.forEach(collect);
  if (!node || typeof node !== "object") return;
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/components/")) {
    const [, , kind, name] = node.$ref.split("/");
    const key = `${kind}/${name}`;
    if (!reached.has(key) && components[kind]?.[name]) {
      reached.set(key, true);
      collect(components[kind][name]);
    }
  }
  Object.values(node).forEach(collect);
}
collect(paths);
// Components a request reaches (bodies and parameters): their required fields are what a caller must send.
const sent = new Set();
function collectSent(node) {
  if (Array.isArray(node)) return node.forEach(collectSent);
  if (!node || typeof node !== "object") return;
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/components/")) {
    const [, , kind, name] = node.$ref.split("/");
    if (!sent.has(`${kind}/${name}`) && components[kind]?.[name]) {
      sent.add(`${kind}/${name}`);
      collectSent(components[kind][name]);
    }
  }
  for (const [key, value] of Object.entries(node)) if (key !== "responses") collectSent(value);
}
collectSent(paths);
const keptComponents = {};
for (const key of reached.keys()) {
  const [kind, name] = key.split("/");
  if (PARTNER.test(name)) errors.push(`components.${kind}.${name}: a component name names a provider`);
  (keptComponents[kind] ||= {})[name] = components[kind][name];
}

/**
 * The card program's routes are under /v1/gnosis/: the generator would name their methods and types after the path
 * (V1GnosisPayout…), which reads as a provider's name. They get the generator's own naming with `CardProgram` in
 * place of that segment, and the tag `card-program` (class CardProgramApi). The paths themselves are unchanged.
 */
const camel = (text) => text.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
for (const [path, item] of Object.entries(paths)) {
  if (!path.startsWith("/v1/gnosis/")) continue;
  for (const [method, op] of Object.entries(item)) {
    if (!METHODS.includes(method)) continue;
    const rest = camel(path.slice("/v1/gnosis/".length));
    op.operationId ??= `v1CardProgram${rest}${camel(method)}`;
    op.tags = (op.tags || []).map((tag) => (tag === "gnosis" ? "card-program" : tag));
  }
}

const out = {
  openapi: spec.openapi,
  info: {
    title: "Aurea API",
    description: "The Aurea API, as documented at https://docs.aureahub.com.",
    version: spec.info.version,
  },
  servers: [{ url: "https://api.aureahub.com", description: "Production" }],
  paths,
  components: {
    ...keptComponents,
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "A signed-in user's access token." },
      tenantSignature: {
        type: "apiKey",
        in: "header",
        name: "x-tenant-api-key",
        description: "Your tenant's API key; the SDK adds x-timestamp and x-signature (HMAC request signing).",
      },
      serverTokenHeader: { type: "apiKey", in: "header", name: "X-Aurea-Server-Token", description: "A server token." },
    },
  },
};
scrub(out.paths, "paths", false);
for (const [kind, entries] of Object.entries(out.components)) {
  for (const [name, node] of Object.entries(entries)) scrub(node, `components.${kind}.${name}`, !sent.has(`${kind}/${name}`));
}

const left = findingsIn(JSON.stringify(out, null, 1), "openapi.public.json");
if (left.length) errors.push(...left.slice(0, 20).map((f) => `left after filtering: ${f}`));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`);
const opCount = Object.values(paths).reduce((n, item) => n + Object.keys(item).filter((k) => METHODS.includes(k)).length, 0);
console.log(
  `public document: ${opCount} operations, ${reached.size} components (API ${spec.info.version}); left out ${stats.properties} provider-named field(s), ${stats.parameters} parameter(s), ${stats.enumValues} enum value(s), ${stats.texts} text(s)`,
);
