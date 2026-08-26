import { createHash } from 'crypto';

/**
 * Encode a CID string to bytes for contract storage.
 * Supports CIDv0 (base58) and CIDv1 (base32) formats.
 * Falls back to SHA-256 hash if CID is invalid.
 */
export function encodeCid(cid: string): Buffer {
  if (!cid || typeof cid !== 'string') {
    throw new Error('Invalid CID: must be a non-empty string');
  }

  // Try to decode as base58 (CIDv0)
  try {
    const bytes = base58Decode(cid);
    if (bytes.length === 34 && bytes[0] === 0x12 && bytes[1] === 0x20) {
      // Valid CIDv0: 0x12 0x20 + 32-byte SHA-256 hash
      return Buffer.from(bytes);
    }
  } catch {
    // Not valid base58
  }

  // Try to decode as base32 (CIDv1)
  try {
    const decoded = base32Decode(cid);
    if (decoded.length > 0) {
      return Buffer.from(decoded);
    }
  } catch {
    // Not valid base32
  }

  // If it's a hex string already, use it directly
  if (/^[0-9a-fA-F]+$/.test(cid) && cid.length % 2 === 0) {
    return Buffer.from(cid, 'hex');
  }

  // Fallback: hash the CID string with SHA-256
  console.warn(`Invalid CID format: ${cid}, using SHA-256 hash`);
  return createHash('sha256').update(cid).digest();
}

/**
 * Decode bytes from contract storage back to a CID string.
 * Returns the original CIDv0 (base58) or base32 (CIDv1) string.
 */
export function decodeCid(bytes: Uint8Array): string {
  if (!bytes || bytes.length === 0) {
    return '';
  }

  // Check if it's a valid CIDv0 (34 bytes: 0x12 0x20 + 32-byte hash)
  if (bytes.length === 34 && bytes[0] === 0x12 && bytes[1] === 0x20) {
    return base58Encode(bytes);
  }

  // Check if it's a valid CIDv1 (starts with 0x01 + codec + multihash)
  if (bytes.length > 2 && bytes[0] === 0x01) {
    return base32Encode(bytes);
  }

  // If it's 32 bytes, treat it as a raw SHA-256 hash and create CIDv0
  if (bytes.length === 32) {
    const cidv0 = new Uint8Array(34);
    cidv0[0] = 0x12; // SHA-256
    cidv0[1] = 0x20; // 32 bytes
    cidv0.set(bytes, 2);
    return base58Encode(cidv0);
  }

  // For other lengths, try base32 encoding
  return base32Encode(bytes);
}

/**
 * Validate if a string is a valid CID.
 */
export function isValidCid(cid: string): boolean {
  if (!cid || typeof cid !== 'string') {
    return false;
  }

  // CIDv0 (base58)
  try {
    const bytes = base58Decode(cid);
    if (bytes.length === 34 && bytes[0] === 0x12 && bytes[1] === 0x20) {
      return true;
    }
  } catch {
    // Not valid base58
  }

  // CIDv1 (base32)
  try {
    const decoded = base32Decode(cid);
    if (decoded.length > 2 && decoded[0] === 0x01) {
      return true;
    }
  } catch {
    // Not valid base32
  }

  return false;
}

// Base58 encoding/decoding (Bitcoin alphabet)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buffer: Uint8Array): string {
  const digits = [0];
  for (let i = 0; i < buffer.length; i++) {
    let carry = buffer[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let result = '';
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
    result += BASE58_ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

function base58Decode(str: string): Uint8Array {
  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const c = BASE58_ALPHABET.indexOf(str[i]);
    if (c < 0) {
      throw new Error(`Invalid base58 character: ${str[i]}`);
    }
    let carry = c;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (let i = 0; i < str.length && str[i] === BASE58_ALPHABET[0]; i++) {
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
}

// Base32 encoding/decoding (RFC 4648)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(str: string): Uint8Array {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (let i = 0; i < str.length; i++) {
    const c = BASE32_ALPHABET.indexOf(str[i].toUpperCase());
    if (c < 0) {
      throw new Error(`Invalid base32 character: ${str[i]}`);
    }

    value = (value << 5) | c;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}