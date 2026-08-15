/// Secret generation. Everything here stays in the browser.
///
/// 31 random bytes read big-endian. 31 bytes is always below the STARK field
/// prime, so no modular reduction and no rejection sampling are needed, and
/// there is no modulo bias. The Cairo side agrees byte for byte, asserted by
/// the shared fixture in `test_vectors/`.
export function randomFelt(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let out = 0n;
  for (const b of bytes) out = (out << 8n) | BigInt(b);
  return out;
}

export const toHex = (v: bigint) => "0x" + v.toString(16);

/// Split a u256 the way the contract hashes it: low limb first, then high.
export function splitU256(v: bigint): { low: bigint; high: bigint } {
  return { low: v & ((1n << 128n) - 1n), high: v >> 128n };
}

/// STRK has 18 decimals. Parsed as a decimal string so 0.1 does not go
/// anywhere near a float.
export function parseStrk(input: string): bigint {
  const [whole, frac = ""] = input.trim().split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) throw new Error("not a number");
  return BigInt(whole || "0") * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

export const formatStrk = (v: bigint) => {
  const s = (v / 10n ** 14n).toString().padStart(5, "0");
  return `${s.slice(0, -4) || "0"}.${s.slice(-4)}`;
};
