import fs from "node:fs";
import { bidCommitment, claimHandle } from "../src/commitment.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../../contracts/test_vectors/commitments.json", import.meta.url), "utf8"));
if (process.env.SEALED_CORRUPT_VECTOR === "1") {
  fixture.vectors[0].claim_handle = `0x${(BigInt(fixture.vectors[0].claim_handle) ^ 1n).toString(16)}`;
}
for (const vector of fixture.vectors) {
  if (vector.claim_handle === null || vector.bid_commitment === null) {
    throw new Error(`${vector.name}: expected hashes are required`);
  }
  const handle = claimHandle(BigInt(vector.claim_secret), BigInt(vector.payout_address));
  const commitment = bidCommitment({ low: BigInt(vector.amount_low), high: BigInt(vector.amount_high) }, BigInt(vector.bid_salt), handle);
  if (BigInt(vector.claim_handle) !== handle) throw new Error(`${vector.name}: claim handle mismatch`);
  if (BigInt(vector.bid_commitment) !== commitment) throw new Error(`${vector.name}: commitment mismatch`);
  console.log(JSON.stringify({ name: vector.name, claim_handle: `0x${handle.toString(16)}`, bid_commitment: `0x${commitment.toString(16)}` }));
}
