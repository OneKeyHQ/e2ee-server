import { createHash } from 'crypto';
import { secp256k1 } from '@noble/curves/secp256k1';

const MESSAGE_PREFIX = Buffer.from('\x18Bitcoin Signed Message:\n', 'utf8');

function encodeVarInt(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 0xfe;
  b.writeUInt32LE(n, 1);
  return b;
}

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

export function bitcoinMessageHash(message: string): Buffer {
  const body = Buffer.from(message, 'utf8');
  return sha256(
    sha256(Buffer.concat([MESSAGE_PREFIX, encodeVarInt(body.length), body]))
  );
}

/**
 * Recovers the compressed public key (hex) from a BIP-137 compact signature.
 * Returns undefined for malformed or high-S signatures.
 */
export function recoverBip137PublicKey(
  message: string,
  signatureBase64: string
): string | undefined {
  try {
    const sig = Buffer.from(signatureBase64, 'base64');
    if (sig.length !== 65) return undefined;
    const header = sig[0];
    // 27-30 uncompressed, 31-34 P2PKH, 35-38 P2SH-P2WPKH, 39-42 P2WPKH.
    if (header < 27 || header > 42) return undefined;
    const recovery = (header - 27) % 4;
    const signature = secp256k1.Signature.fromCompact(
      sig.subarray(1)
    ).addRecoveryBit(recovery);
    if (signature.hasHighS()) return undefined;
    const point = signature.recoverPublicKey(bitcoinMessageHash(message));
    return point.toHex(true);
  } catch {
    return undefined;
  }
}
