// The two node:crypto functions the tests use to check signatures (no @types/node in this package).
declare module "node:crypto" {
  interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: "sha256"): Hash;
  export function createHmac(algorithm: "sha256", key: string): Hash;
}
