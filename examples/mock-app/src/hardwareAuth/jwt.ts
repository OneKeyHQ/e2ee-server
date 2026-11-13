import {
  createHash,
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as cryptoVerify,
  JsonWebKey,
} from 'crypto';

export function base64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url');
}

export function sha256Base64url(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('base64url');
}

export type IJwtParts = {
  header: Record<string, any>;
  payload: Record<string, any>;
  signingInput: string;
  signature: Buffer;
};

export function decodeJwt(token: string): IJwtParts | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
      payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: Buffer.from(parts[2], 'base64url'),
    };
  } catch {
    return undefined;
  }
}

export function signHs256(payload: Record<string, any>, secret: Buffer): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyHs256(
  token: string,
  secret: Buffer
): Record<string, any> | undefined {
  const jwt = decodeJwt(token);
  if (!jwt || jwt.header.alg !== 'HS256') return undefined;
  const expected = createHmac('sha256', secret)
    .update(jwt.signingInput)
    .digest();
  if (
    expected.length !== jwt.signature.length ||
    !timingSafeEqual(expected, jwt.signature)
  ) {
    return undefined;
  }
  return jwt.payload;
}

/** RFC 7638 thumbprint of a P-256 public JWK. */
export function ecJwkThumbprint(jwk: JsonWebKey): string | undefined {
  if (
    jwk?.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' ||
    typeof jwk.y !== 'string'
  ) {
    return undefined;
  }
  return sha256Base64url(
    JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
  );
}

export function verifyEs256(jwt: IJwtParts, jwk: JsonWebKey): boolean {
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    return cryptoVerify(
      'sha256',
      Buffer.from(jwt.signingInput),
      { key, dsaEncoding: 'ieee-p1363' },
      jwt.signature
    );
  } catch {
    return false;
  }
}
