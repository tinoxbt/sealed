import { AUCTION_ADDRESS } from "./config";
import { provider } from "./provider";

/// Raw calls rather than an ABI, because every view here is either a u256,
/// a u32 or a payload-free enum, all of which are plain felts on the wire.
async function view(entrypoint: string, calldata: string[] = []): Promise<string[]> {
  return provider.callContract({ contractAddress: AUCTION_ADDRESS, entrypoint, calldata });
}

const u256 = (r: string[], i = 0) => BigInt(r[i]) + (BigInt(r[i + 1]) << 128n);

export const AUCTION_STATE = ["Open", "Settled", "Cancelled"] as const;
export type AuctionStateName = (typeof AUCTION_STATE)[number];

/// Where the auction is right now.
///
/// `state` is what the contract has recorded; `phase` is what a user can
/// actually do, which also depends on the clock. An auction whose reveal
/// deadline has passed is still `Open` on chain until someone calls settle,
/// and showing "open" then would invite bids that revert.
export type Phase = "Bidding" | "Revealing" | "AwaitingSettlement" | "Settled" | "Cancelled";

export type AuctionSummary = {
  state: AuctionStateName;
  phase: Phase;
  collateral: bigint;
  reserve: bigint;
  escrowed: bigint;
  commitments: number;
  revealed: number;
  clearingPrice: bigint;
  winnerHandle: string;
  closeTime: number;
  revealDeadline: number;
};

export async function readAuction(): Promise<AuctionSummary> {
  const [st, coll, res, esc, cnt, rev, clear, win, timing] = await Promise.all([
    view("get_state"),
    view("get_collateral"),
    view("get_reserve_price"),
    view("get_escrowed"),
    view("get_commitment_count"),
    view("get_revealed_count"),
    view("get_clearing_price"),
    view("get_winner_handle"),
    view("get_timing"),
  ]);

  const state = AUCTION_STATE[Number(BigInt(st[0]))] ?? "Open";
  const closeTime = Number(BigInt(timing[0]));
  const revealDeadline = Number(BigInt(timing[1]));
  const now = Math.floor(Date.now() / 1000);

  const phase: Phase =
    state === "Cancelled"
      ? "Cancelled"
      : state === "Settled"
        ? "Settled"
        : now < closeTime
          ? "Bidding"
          : now < revealDeadline
            ? "Revealing"
            : "AwaitingSettlement";

  return {
    state,
    phase,
    collateral: u256(coll),
    reserve: u256(res),
    escrowed: u256(esc),
    commitments: Number(BigInt(cnt[0])),
    revealed: Number(BigInt(rev[0])),
    clearingPrice: u256(clear),
    winnerHandle: win[0],
    closeTime,
    revealDeadline,
  };
}

/// Entry resolution, derived by the contract rather than stored.
/// Order matches the EntryStatus enum in auction.cairo.
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
  const r = await view("get_entry_status", [claimHandle]);
  return ENTRY_STATUS[Number(BigInt(r[0]))] ?? "Unknown";
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

/// settle() takes no arguments and is permissionless by design: it records the
/// winner and clearing price and moves no money, so there is nothing to gain by
/// calling it and nothing to lose by letting a stranger do it.
export function settleCall() {
  return { contractAddress: AUCTION_ADDRESS, entrypoint: "settle", calldata: [] };
}

/// claim_proceeds(seller_secret, payout_address). Same handle mechanism as a
/// bidder's claim, so the seller has no privileged path.
export function claimProceedsCall(sellerSecret: string, payoutAddress: string) {
  return {
    contractAddress: AUCTION_ADDRESS,
    entrypoint: "claim_proceeds",
    calldata: [sellerSecret, payoutAddress],
  };
}
