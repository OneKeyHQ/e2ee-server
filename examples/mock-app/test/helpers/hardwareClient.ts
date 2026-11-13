import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign as cryptoSign,
  JsonWebKey,
  KeyObject,
} from 'crypto';
import { secp256k1 } from '@noble/curves/secp256k1';

import { bitcoinMessageHash } from '../../src/hardwareAuth/bip137';

export const TEST_HOST = 'sync.test';
export const htuOf = (path: string) => `http://${TEST_HOST}${path}`;

/** Stands in for the hardware wallet key at P_auth. */
export class TestDevice {
  private readonly privateKey = secp256k1.utils.randomPrivateKey();

  readonly publicKey = Buffer.from(
    secp256k1.getPublicKey(this.privateKey, true)
  ).toString('hex');

  signMessage(message: string): string {
    const sig = secp256k1.sign(bitcoinMessageHash(message), this.privateKey);
    // 31 + recovery = compressed P2PKH header, as the device returns.
    return Buffer.concat([
      Buffer.from([31 + sig.recovery]),
      Buffer.from(sig.toCompactRawBytes()),
    ]).toString('base64');
  }
}

/** Stands in for the app's non-extractable device-bound key (DK). */
export class TestDeviceKey {
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  readonly jwk = this.keys.publicKey.export({ format: 'jwk' }) as JsonWebKey;

  dpop(params: {
    htm: string;
    path: string;
    accessToken?: string;
    jti?: string;
    iat?: number;
  }): string {
    const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: this.jwk };
    const payload: Record<string, unknown> = {
      htm: params.htm,
      htu: htuOf(params.path),
      iat: params.iat ?? Math.floor(Date.now() / 1000),
      jti: params.jti ?? randomUUID(),
    };
    if (params.accessToken) {
      payload.ath = createHash('sha256')
        .update(params.accessToken)
        .digest('base64url');
    }
    const input = `${b64(JSON.stringify(header))}.${b64(
      JSON.stringify(payload)
    )}`;
    const signature = cryptoSign('sha256', Buffer.from(input), {
      key: this.keys.privateKey as KeyObject,
      dsaEncoding: 'ieee-p1363',
    });
    return `${input}.${signature.toString('base64url')}`;
  }
}

function b64(value: string) {
  return Buffer.from(value).toString('base64url');
}
