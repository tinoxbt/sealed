/// Envelope encryption for the on-chain backup blob.
///
/// The secrets that authorise a reveal and a claim exist only in the browser.
/// This encrypts them under a random data key, wraps that data key separately
/// under every credential the bidder chose, and packs the result into the fixed
/// number of felts the contract accepts.
///
/// Why wrap the data key more than once, rather than encrypting under one key:
/// any single wrap can open the blob. Forget the passphrase and the recovery
/// code still works, and the reverse. A single derived key would make one
/// forgotten thing fatal, which is the failure mode a backup exists to prevent.
///
/// Every failure here is loud. AES-GCM authenticates, so a wrong key fails to
/// unwrap rather than returning plausible rubbish, and a recovery attempt is
/// therefore never silently wrong.

const FELT_BYTES = 31; // 31 bytes is always below the STARK field prime.
export const BACKUP_WORDS = 12;
const BLOB_BYTES = FELT_BYTES * BACKUP_WORDS; // 372

// Fixed offsets. There is no header: every blob has the same shape, so nothing
// about the layout says which slots a bidder actually used.
const SALT = 16;
const NONCE = 12;
const TAG = 16;
const SECRET_BYTES = 32;
const PAYLOAD = SECRET_BYTES * 3; // bid salt, claim secret, payout key
const WRAP = NONCE + SECRET_BYTES + TAG; // 60

const OFF_SALT = 0;
const OFF_PAYLOAD_NONCE = OFF_SALT + SALT; // 16
const OFF_PAYLOAD = OFF_PAYLOAD_NONCE + NONCE; // 28
const OFF_SLOTS = OFF_PAYLOAD + PAYLOAD + TAG; // 140
const SLOT_COUNT = 3;
const OFF_PADDING = OFF_SLOTS + WRAP * SLOT_COUNT; // 320

export type Secrets = {
  bidSalt: bigint;
  claimSecret: bigint;
  payoutPrivateKey: bigint;
};

export type Credentials = {
  passphrase?: string;
  recoveryCode?: string;
};

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

function bytesFromFelt(v: bigint): Uint8Array {
  const out = new Uint8Array(SECRET_BYTES);
  let x = v;
  for (let i = SECRET_BYTES - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function feltFromBytes(b: Uint8Array): bigint {
  let out = 0n;
  for (const byte of b) out = (out << 8n) | BigInt(byte);
  return out;
}

/// Pack bytes into felts, 31 bytes each, big-endian.
function packFelts(bytes: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += FELT_BYTES) {
    out.push("0x" + feltFromBytes(bytes.subarray(i, i + FELT_BYTES)).toString(16));
  }
  return out;
}

function unpackFelts(felts: string[]): Uint8Array {
  const out = new Uint8Array(felts.length * FELT_BYTES);
  felts.forEach((f, i) => {
    let x = BigInt(f);
    for (let j = FELT_BYTES - 1; j >= 0; j--) {
      out[i * FELT_BYTES + j] = Number(x & 0xffn);
      x >>= 8n;
    }
  });
  return out;
}

/// Stretch a passphrase. Deliberately expensive: a passphrase is the only input
/// here with human-sized entropy, so it is the one worth slowing an attacker
/// down on. The blob is public, which means offline guessing is unlimited.
async function keyFromPassphrase(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/// A recovery code is generated with full entropy, so it needs derivation
/// rather than stretching.
async function keyFromCode(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", enc.encode(code.replace(/\s+/g, "").toUpperCase()), "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", salt, info: enc.encode("sealed:backup:v1"), hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/// 26 characters of Crockford-style base32, about 130 bits. Not BIP39: a
/// wordlist is 2048 entries of dependency for no gain here, since this code is
/// written down rather than memorised.
export function generateRecoveryCode(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const raw = new Uint8Array(26);
  globalThis.crypto.getRandomValues(raw);
  const chars = Array.from(raw, (b) => alphabet[b % 32]);
  return chars.join("").replace(/(.{6})(?=.)/g, "$1-");
}

async function credentialKeys(c: Credentials, salt: Uint8Array): Promise<(CryptoKey | null)[]> {
  return [
    c.passphrase ? await keyFromPassphrase(c.passphrase, salt) : null,
    c.recoveryCode ? await keyFromCode(c.recoveryCode, salt) : null,
    // Slot three is reserved for a wallet-signature-derived key. It is left
    // random rather than removed so that adding it later does not change the
    // blob layout, and so blobs written before and after are indistinguishable.
    null,
  ];
}

/// Encrypt the secrets and return exactly BACKUP_WORDS felts.
export async function sealBackup(s: Secrets, c: Credentials): Promise<string[]> {
  if (!c.passphrase && !c.recoveryCode) {
    throw new Error("A backup needs at least one credential, or nothing could ever open it.");
  }

  // Random everywhere first. Anything not overwritten below is indistinguishable
  // from ciphertext, so an unused slot does not advertise itself.
  const blob = new Uint8Array(BLOB_BYTES);
  globalThis.crypto.getRandomValues(blob);

  const salt = blob.subarray(OFF_SALT, OFF_SALT + SALT);
  const dataKeyRaw = new Uint8Array(SECRET_BYTES);
  globalThis.crypto.getRandomValues(dataKeyRaw);
  const dataKey = await subtle().importKey("raw", dataKeyRaw, "AES-GCM", false, ["encrypt"]);

  const payload = new Uint8Array(PAYLOAD);
  payload.set(bytesFromFelt(s.bidSalt), 0);
  payload.set(bytesFromFelt(s.claimSecret), SECRET_BYTES);
  payload.set(bytesFromFelt(s.payoutPrivateKey), SECRET_BYTES * 2);

  const payloadNonce = blob.subarray(OFF_PAYLOAD_NONCE, OFF_PAYLOAD_NONCE + NONCE);
  const sealed = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv: payloadNonce }, dataKey, payload),
  );
  blob.set(sealed, OFF_PAYLOAD);

  const keys = await credentialKeys(c, salt);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const key = keys[i];
    if (!key) continue;
    const at = OFF_SLOTS + i * WRAP;
    const nonce = blob.subarray(at, at + NONCE);
    const wrapped = new Uint8Array(
      await subtle().encrypt({ name: "AES-GCM", iv: nonce }, key, dataKeyRaw),
    );
    blob.set(wrapped, at + NONCE);
  }

  return packFelts(blob);
}

/// Try to open a blob. Returns null when no supplied credential fits, which is
/// the expected result for every blob that is not yours.
export async function openBackup(felts: string[], c: Credentials): Promise<Secrets | null> {
  if (felts.length !== BACKUP_WORDS) return null;

  const blob = unpackFelts(felts);
  const salt = blob.subarray(OFF_SALT, OFF_SALT + SALT);
  const keys = await credentialKeys(c, salt);

  for (let i = 0; i < SLOT_COUNT; i++) {
    const key = keys[i];
    if (!key) continue;
    const at = OFF_SLOTS + i * WRAP;
    let dataKeyRaw: ArrayBuffer;
    try {
      dataKeyRaw = await subtle().decrypt(
        { name: "AES-GCM", iv: blob.subarray(at, at + NONCE) },
        key,
        blob.subarray(at + NONCE, at + WRAP),
      );
    } catch {
      continue; // Not this slot, or not this blob. Both look the same, correctly.
    }

    const dataKey = await subtle().importKey("raw", dataKeyRaw, "AES-GCM", false, ["decrypt"]);
    const opened = new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv: blob.subarray(OFF_PAYLOAD_NONCE, OFF_PAYLOAD_NONCE + NONCE) },
        dataKey,
        blob.subarray(OFF_PAYLOAD, OFF_PAYLOAD + PAYLOAD + TAG),
      ),
    );
    return {
      bidSalt: feltFromBytes(opened.subarray(0, SECRET_BYTES)),
      claimSecret: feltFromBytes(opened.subarray(SECRET_BYTES, SECRET_BYTES * 2)),
      payoutPrivateKey: feltFromBytes(opened.subarray(SECRET_BYTES * 2, SECRET_BYTES * 3)),
    };
  }
  return null;
}

export const LAYOUT = { BLOB_BYTES, OFF_SLOTS, OFF_PADDING, WRAP, SLOT_COUNT };
