/// Prove the encrypted backup works against a real network, not a harness.
///
///   npx tsx scripts/check-backup-onchain.ts
///
/// Seals a real blob, commits it through the plain path, then recovers the
/// secrets using nothing but a passphrase and the chain. The unit tests show
/// the crypto is self-consistent; this shows the felt packing survives Cairo
/// storage and that recovery finds the entry among everything else committed.
import { readFileSync } from "node:fs";
import { Account, RpcProvider } from "starknet";
import { bidCommitment, claimHandle } from "../src/commitment.js";
import { recoverFromChain } from "../src/lib/recovery.js";
import { openBackup, sealBackup } from "../src/lib/vault.js";

const RPC = process.env.SEALED_RPC ?? "https://api.cartridge.gg/x/starknet/sepolia";
const AUCTION = process.env.SEALED_AUCTION ??
  "0x01fdad69852ba0ae7de900aaa6165b015010f493c5a5d5466bc6a8e580c05d02";
const TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const lo = (v: bigint) => "0x" + (v & ((1n << 128n) - 1n)).toString(16);
const hi = (v: bigint) => "0x" + (v >> 128n).toString(16);
const hex = (v: bigint) => "0x" + v.toString(16);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

function assert(ok: boolean, what: string) {
  if (!ok) throw new Error(`FAILED: ${what}`);
  log("ok  ", what);
}

function randomFelt(): bigint {
  const b = new Uint8Array(31);
  crypto.getRandomValues(b);
  let out = 0n;
  for (const x of b) out = (out << 8n) | BigInt(x);
  return out;
}

const provider = new RpcProvider({ nodeUrl: RPC });
const acct = JSON.parse(
  readFileSync(`${process.env.HOME}/.starknet_accounts/starknet_open_zeppelin_accounts.json`, "utf8"),
)["alpha-sepolia"]["sealed-deployer"];
const account = new Account({ provider, address: acct.address, signer: acct.private_key });

const amount = 300000000000000000n; // 0.3 STRK
const secrets = {
  amount,
  bidSalt: randomFelt(),
  claimSecret: randomFelt(),
  payoutPrivateKey: randomFelt(),
};
const passphrase = `onchain-check-${Date.now()}`;
const payoutAddress = randomFelt();
const handle = claimHandle(secrets.claimSecret, payoutAddress);
const commitment = bidCommitment(
  { low: amount & ((1n << 128n) - 1n), high: amount >> 128n },
  secrets.bidSalt,
  handle,
);

const blob = await sealBackup(secrets, { passphrase });
assert(blob.length === 12, "sealed 12 felts");

const collateral = await provider.callContract({
  contractAddress: AUCTION, entrypoint: "get_collateral", calldata: [],
});
const amt = BigInt(collateral[0]) + (BigInt(collateral[1]) << 128n);

log("approving collateral");
const ap = await account.execute([{
  contractAddress: TOKEN, entrypoint: "approve", calldata: [AUCTION, lo(amt), hi(amt)],
}]);
await provider.waitForTransaction(ap.transaction_hash);

log("committing with the blob");
const tx = await account.execute([{
  contractAddress: AUCTION,
  entrypoint: "commit",
  calldata: [hex(commitment), hex(handle), `0x${blob.length.toString(16)}`, ...blob],
}]);
await provider.waitForTransaction(tx.transaction_hash);
log("committed", tx.transaction_hash);

// Read it straight back off chain.
const stored = await provider.callContract({
  contractAddress: AUCTION, entrypoint: "get_backup", calldata: [hex(handle)],
});
const words = stored.slice(1, 1 + Number(BigInt(stored[0])));
assert(words.length === 12, "chain returned 12 felts");
assert(
  words.map((w) => BigInt(w).toString()).join() === blob.map((w) => BigInt(w).toString()).join(),
  "every word survived Cairo storage unchanged",
);

// The real test: recover with the passphrase alone.
const opened = await openBackup(words, { passphrase });
assert(opened !== null, "the passphrase opened the blob read from chain");
assert(opened!.amount === secrets.amount, "the bid amount came back, so the entry can actually be revealed");
assert(opened!.bidSalt === secrets.bidSalt, "bid salt recovered from chain");
assert(opened!.claimSecret === secrets.claimSecret, "claim secret recovered from chain");
assert(opened!.payoutPrivateKey === secrets.payoutPrivateKey, "payout key recovered from chain");

// And that it stays shut for anyone else.
assert((await openBackup(words, { passphrase: "not it" })) === null, "a wrong passphrase still fails on the real blob");

// Finally the part a user actually does: find the entry without being told
// which one it is. Recovery scans every commitment in the auction and tries
// each blob, so this also proves the event scan and the felt decoding.
log("scanning the auction for recoverable entries");
const found = await recoverFromChain({ passphrase }, AUCTION);
assert(found.length === 1, `blind scan opened exactly one blob (found ${found.length})`);
assert(found[0].claimHandle === hex(handle) || BigInt(found[0].claimHandle) === handle,
  "recovery found the right entry");
assert(found[0].claimSecret === secrets.claimSecret, "recovered secrets match, from a blind scan");

log("");
log("backup verified end to end on Sepolia against", AUCTION);
log("handle", hex(handle));
