// Regenerates the Cairo-readable fixture from commitments.json.
//
// commitments.json is the single source of truth and is human readable: named
// vectors, hex strings. snforge's read_txt returns Array<felt252> and cannot
// hold a 66 character hex string in a felt, so Cairo reads a flat decimal
// companion instead. Generated, never hand edited, so the two cannot drift.
//
// Layout is seven felts per vector, in this order:
//   amount_low, amount_high, bid_salt, claim_secret, payout_address,
//   claim_handle, bid_commitment
//
// Run: npm run vectors:emit

import fs from "node:fs";
import { bidCommitment, claimHandle } from "../src/commitment.js";

const SOURCE = new URL("../../../contracts/test_vectors/commitments.json", import.meta.url);
const TARGET = new URL("../../../contracts/test_vectors/commitments_flat.txt", import.meta.url);

const fixture = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const flat: string[] = [];

for (const v of fixture.vectors) {
  const amount = { low: BigInt(v.amount_low), high: BigInt(v.amount_high) };
  const handle = claimHandle(BigInt(v.claim_secret), BigInt(v.payout_address));
  const commitment = bidCommitment(amount, BigInt(v.bid_salt), handle);

  // Recompute rather than trust the stored value, so a corrupted source file
  // cannot silently propagate into the Cairo fixture.
  if (BigInt(v.claim_handle) !== handle) {
    throw new Error(`${v.name}: stored claim_handle does not match recomputation`);
  }
  if (BigInt(v.bid_commitment) !== commitment) {
    throw new Error(`${v.name}: stored bid_commitment does not match recomputation`);
  }

  flat.push(
    amount.low.toString(),
    amount.high.toString(),
    BigInt(v.bid_salt).toString(),
    BigInt(v.claim_secret).toString(),
    BigInt(v.payout_address).toString(),
    handle.toString(),
    commitment.toString()
  );
}

fs.writeFileSync(TARGET, flat.join("\n") + "\n");
console.log(`wrote ${flat.length} felts for ${fixture.vectors.length} vectors`);
