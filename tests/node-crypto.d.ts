// The node:crypto functions the tests use to check signatures and read keys (no @types/node in this package).
declare module "node:crypto" {
  interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: "sha256"): Hash;
  export function createHmac(algorithm: "sha256", key: string): Hash;
  export interface KeyObject {
    type: string;
    asymmetricKeyType?: string;
    export(options: { format: "jwk" }): JsonWebKey;
  }
  export function createPrivateKey(input: { key: JsonWebKey; format: "jwk" }): KeyObject;
}
