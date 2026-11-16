// The node:fs function the tests use to read package.json (no @types/node in this package).
declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: "utf8"): string;
}
