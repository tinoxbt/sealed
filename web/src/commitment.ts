import { hash } from "starknet";

export type U256 = { low: bigint; high: bigint };

export function claimHandle(claimSecret: bigint, payoutAddress: bigint): bigint {
  return BigInt(hash.computePoseidonHashOnElements([claimSecret, payoutAddress]));
}

export function bidCommitment(amount: U256, bidSalt: bigint, handle: bigint): bigint {
  return BigInt(hash.computePoseidonHashOnElements([amount.low, amount.high, bidSalt, handle]));
}

export function sellerHandle(secret: bigint, payoutAddress: bigint): bigint {
  return claimHandle(secret, payoutAddress);
}
