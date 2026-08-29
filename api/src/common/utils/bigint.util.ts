/**
 * Convert a BigInt to a number if it's within safe integer range,
 * otherwise throw an error. Use for values that MUST fit in a number.
 */
export function toSafeNumber(value: bigint | number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(num)) {
    throw new RangeError(
      `Value ${value} exceeds Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER})`,
    );
  }
  return num;
}

/**
 * Convert a BigInt to a string representation. Use for values that
 * may exceed Number.MAX_SAFE_INTEGER and need to be serialized.
 */
export function toBigIntString(value: bigint | number): string {
  return BigInt(value).toString();
}

/**
 * Safe conversion that returns string if value exceeds safe integer range,
 * otherwise returns number. Useful for API responses where both formats
 * may be acceptable.
 */
export function toFlexibleNumber(value: bigint | number): number | string {
  const bigintValue = BigInt(value);
  const num = Number(bigintValue);
  if (Number.isSafeInteger(num) && bigintValue === BigInt(num)) {
    return num;
  }
  return bigintValue.toString();
}