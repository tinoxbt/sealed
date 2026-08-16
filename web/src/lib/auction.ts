import { Contract } from "starknet";
import { AUCTION_ADDRESS } from "./config";
import { provider } from "./provider";

/// Only the reads the bid page needs. The contract is the single source of
/// truth for auction state, so nothing here is cached or mirrored off chain.
const ABI = [
  { type: "function", name: "get_collateral", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "get_escrowed", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "get_commitment_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
] as const;

export type AuctionState = { collateral: bigint; escrowed: bigint; commitments: number };

export async function readAuction(): Promise<AuctionState> {
  const c = new Contract({ abi: ABI as never, address: AUCTION_ADDRESS, providerOrAccount: provider });
  const [collateral, escrowed, commitments] = await Promise.all([
    c.call("get_collateral"),
    c.call("get_escrowed"),
    c.call("get_commitment_count"),
  ]);
  return {
    collateral: BigInt(collateral as bigint),
    escrowed: BigInt(escrowed as bigint),
    commitments: Number(commitments as bigint),
  };
}

/// Entry resolution, derived by the contract rather than stored.
///
/// The order matches the EntryStatus enum in auction.cairo. A plain
/// callContract is used rather than ABI enum decoding because the variants
/// carry no payload, so the response is a single felt index.
export const ENTRY_STATUS = [
  "Unknown",
  "Committed",
  "Revealed",
  "Won",
  "Lost",
  "Forfeited",
  "Claimed",
] as const;

export type EntryStatus = (typeof ENTRY_STATUS)[number];

export async function readEntryStatus(claimHandle: string): Promise<EntryStatus> {
  const res = await provider.callContract({
    contractAddress: AUCTION_ADDRESS,
    entrypoint: "get_entry_status",
    calldata: [claimHandle],
  });
  const i = Number(BigInt(res[0]));
  return ENTRY_STATUS[i] ?? "Unknown";
}

/// reveal(amount: u256, bid_salt, claim_handle).
/// u256 goes low limb first, matching the hash encoding.
export function revealCall(amount: bigint, bidSalt: string, claimHandle: string) {
  return {
    contractAddress: AUCTION_ADDRESS,
    entrypoint: "reveal",
    calldata: [
      "0x" + (amount & ((1n << 128n) - 1n)).toString(16),
      "0x" + (amount >> 128n).toString(16),
      bidSalt,
      claimHandle,
    ],
  };
}

/// claim(claim_secret, payout_address).
///
/// The destination is not a parameter the caller chooses freely: the contract
/// recomputes poseidon(claim_secret, payout_address) and requires it to equal
/// the stored handle, so this pays the address committed at bid time or it
/// reverts. Anyone may submit it, and submitting it for someone else only pays
/// that someone else.
export function claimCall(claimSecret: string, payoutAddress: string) {
  return {
    contractAddress: AUCTION_ADDRESS,
    entrypoint: "claim",
    calldata: [claimSecret, payoutAddress],
  };
}
