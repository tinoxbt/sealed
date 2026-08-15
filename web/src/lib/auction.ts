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
