/// Exercise the backup vault against the properties that matter.
///
///   npm run vault
///
/// Every assertion here corresponds to a way a bidder could lose funds: a blob
/// that cannot be opened by the credential that sealed it, a blob that opens
/// for the wrong credential, a blob of the wrong length for the contract, or
/// secrets that come back altered.
import { BACKUP_WORDS, generateRecoveryCode, openBackup, sealBackup, LAYOUT } from "../src/lib/vault.js";

function assert(ok: boolean, what: string) {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log("ok  ", what);
}

function randomFelt(): bigint {
  const b = new Uint8Array(31);
  crypto.getRandomValues(b);
  let out = 0n;
  for (const x of b) out = (out << 8n) | BigInt(x);
  return out;
}

const secrets = {
  bidSalt: randomFelt(),
  claimSecret: randomFelt(),
  payoutPrivateKey: randomFelt(),
};

const passphrase = "correct horse battery staple";
const code = generateRecoveryCode();

const blob = await sealBackup(secrets, { passphrase, recoveryCode: code });

assert(blob.length === BACKUP_WORDS, `blob is exactly ${BACKUP_WORDS} felts, as the contract requires`);
assert(blob.every((f) => BigInt(f) >= 0n), "every word is a valid felt");

// The whole point: either credential alone recovers everything.
const byPass = await openBackup(blob, { passphrase });
assert(byPass !== null, "the passphrase alone opens the blob");
assert(byPass!.bidSalt === secrets.bidSalt, "bid salt survives the round trip");
assert(byPass!.claimSecret === secrets.claimSecret, "claim secret survives the round trip");
assert(byPass!.payoutPrivateKey === secrets.payoutPrivateKey, "payout key survives the round trip");

const byCode = await openBackup(blob, { recoveryCode: code });
assert(byCode !== null, "the recovery code alone opens the blob");
assert(byCode!.claimSecret === secrets.claimSecret, "the code recovers the same secrets");

// Recovery works by trying every blob in an auction, so failing on someone
// else's must be reliable rather than merely likely.
assert((await openBackup(blob, { passphrase: "wrong passphrase" })) === null, "a wrong passphrase fails, and fails closed");
assert((await openBackup(blob, { recoveryCode: generateRecoveryCode() })) === null, "an unrelated recovery code fails");
assert((await openBackup(blob, {})) === null, "no credentials opens nothing");

// A blob whose length the contract would reject must not be produced, and a
// truncated one must not half-open.
assert((await openBackup(blob.slice(0, 5), { passphrase })) === null, "a truncated blob is refused");

// Two blobs of the same secrets must not be identical, or equal bids would be
// visibly equal on chain.
const again = await sealBackup(secrets, { passphrase, recoveryCode: code });
assert(again.join() !== blob.join(), "sealing twice gives different ciphertext");

// A blob sealed with only one credential must still be the same size, or the
// number of credentials used would be readable from chain.
const oneOnly = await sealBackup(secrets, { passphrase });
assert(oneOnly.length === BACKUP_WORDS, "one credential still produces a full-length blob");
assert((await openBackup(oneOnly, { recoveryCode: code })) === null, "an unused slot really is unusable");
assert((await openBackup(oneOnly, { passphrase })) !== null, "the used slot still opens");

// Sealing with nothing would produce a blob nobody could ever open.
let refused = false;
try {
  await sealBackup(secrets, {});
} catch {
  refused = true;
}
assert(refused, "sealing with no credential is refused rather than silently unopenable");

console.log(`\nvault ok: ${LAYOUT.BLOB_BYTES} bytes, ${LAYOUT.SLOT_COUNT} slots, ${BACKUP_WORDS} felts`);
