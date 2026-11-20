export interface VerifiedClaims {
  uri: string;
  bodyHash: string;
  nonce: string;
  iat: number;
  exp: number;
}
export function serverTokenOf(authorization: unknown): string | null;
export function verifyAsTheApi(
  token: string,
  publicJwk: { kty: string; crv: string; x: string; y: string },
  request: { method: string; url: string; body?: string },
  nowSeconds: number,
): { outcome: string; kid?: string; claims?: VerifiedClaims };
