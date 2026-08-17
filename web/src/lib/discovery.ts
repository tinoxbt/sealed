import type { EmittedEvent } from "starknet";

import { provider } from "./provider";

const AUCTION_CREATED =
  "0xc4f755238cafbb641d5f38aa7d11065e9de4052fa05571a4b529fb5438227b";
const DEFAULT_LOOKBACK_BLOCKS = 20_000;
const PAGE_SIZE = 1_000;
const U128_LIMIT = 1n << 128n;

export type DiscoveredAuction = {
  address: string;
  token: string;
  reservePrice: bigint;
  collateral: bigint;
  closeTime: number;
  revealDeadline: number;
  blockNumber: number;
};

function u256(low: string, high: string): bigint {
  const lowLimb = BigInt(low);
  const highLimb = BigInt(high);

  if (lowLimb < 0n || lowLimb >= U128_LIMIT || highLimb < 0n || highLimb >= U128_LIMIT) {
    throw new RangeError("Invalid u256 limb");
  }

  return lowLimb + (highLimb << 128n);
}

function safeNumber(felt: string): number {
  const value = BigInt(felt);
  const result = Number(value);

  if (value < 0n || !Number.isSafeInteger(result)) {
    throw new RangeError("Felt is outside the safe integer range");
  }

  return result;
}

function decodeEvent(event: EmittedEvent): DiscoveredAuction | undefined {
  try {
    if (event.keys.length < 2 || event.data.length < 6 || event.block_number === undefined) {
      return undefined;
    }

    return {
      address: event.from_address,
      token: event.keys[1],
      reservePrice: u256(event.data[0], event.data[1]),
      collateral: u256(event.data[2], event.data[3]),
      closeTime: safeNumber(event.data[4]),
      revealDeadline: safeNumber(event.data[5]),
      blockNumber: event.block_number,
    };
  } catch {
    // RPC history can contain incompatible events, and one should not suppress valid auctions.
    return undefined;
  }
}

export async function discoverAuctions(
  lookbackBlocks = DEFAULT_LOOKBACK_BLOCKS,
): Promise<DiscoveredAuction[]> {
  const latestBlock = await provider.getBlockNumber();
  const lookback = Number.isSafeInteger(lookbackBlocks) && lookbackBlocks >= 0
    ? lookbackBlocks
    : DEFAULT_LOOKBACK_BLOCKS;
  const fromBlock = Math.max(0, latestBlock - lookback);
  const auctions: DiscoveredAuction[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await provider.getEvents({
      from_block: { block_number: fromBlock },
      to_block: { block_number: latestBlock },
      keys: [[AUCTION_CREATED]],
      chunk_size: PAGE_SIZE,
      continuation_token: continuationToken,
    });

    for (const event of page.events) {
      const auction = decodeEvent(event);
      if (auction) auctions.push(auction);
    }

    continuationToken = page.continuation_token;
  } while (continuationToken);

  return auctions.sort((a, b) => b.blockNumber - a.blockNumber);
}
