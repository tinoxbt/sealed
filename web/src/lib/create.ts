import { CallData } from "starknet";
import { claimHandle } from "../commitment";
import { ACCOUNT_CLASS_HASH, AUCTION_CLASS_HASH, POOL_ADDRESS, TOKEN_ADDRESS } from "./config";
import { derivePayoutAccount } from "./payout";
import { randomFelt, toHex } from "./secrets";

/// Everything a seller must keep. Losing it means the proceeds of their own
/// auction are unclaimable by anyone, exactly like a bidder losing claim_secret.
export type SellerBackup = {
  version: 1;
  role: "seller";
  auction: string;
  network: "sepolia";
  createdAt: string;
  sellerSecret: string;
  sellerHandle: string;
  payoutAddress: string;
  payoutPrivateKey: string;
  payoutSalt: string;
  accountClassHash: string;
  reserveStrk: string;
  collateralStrk: string;
  /// Recorded so the rule is legible from the backup alone, without
  /// having to read it back off the contract.
  kind: "vickrey" | "first-price";
  closeTime: number;
  revealDeadline: number;
};

/// The contract refuses a reveal window shorter than this, because the seller
/// receives every forfeited collateral and also chooses the deadline. Mirrored
/// here so the form can say so before a transaction is spent finding out.
export const MIN_REVEAL_WINDOW_SECONDS = 600;

/// Matches the AuctionKind enum in auction.cairo, which serialises as its
/// variant index.
export const AuctionKind = { Vickrey: "0x0", FirstPrice: "0x1" } as const;
export type AuctionKindValue = (typeof AuctionKind)[keyof typeof AuctionKind];

export type AuctionParams = {
  kind: AuctionKindValue;
  reserve: bigint;
  collateral: bigint;
  closeTime: number;
  revealDeadline: number;
};

/// Reject what the constructor would reject, with a reason a person can act on.
export function validate(p: AuctionParams): string | null {
  const now = Math.floor(Date.now() / 1000);
  if (p.collateral <= 0n) return "Collateral must be above zero.";
  if (p.reserve > p.collateral) {
    return "Reserve cannot exceed the collateral, because bids are capped at the collateral.";
  }
  if (p.closeTime <= now) return "Bidding must close in the future.";
  if (p.revealDeadline <= p.closeTime) return "The reveal window must come after bidding closes.";
  if (p.revealDeadline - p.closeTime < MIN_REVEAL_WINDOW_SECONDS) {
    return `The reveal window must be at least ${MIN_REVEAL_WINDOW_SECONDS / 60} minutes. A seller receives every forfeited collateral and also sets this deadline, so a window nobody can meet would pay the seller the whole pot.`;
  }
  return null;
}

/// Build the seller's identity and the constructor calldata together, because
/// the handle must be the hash of the exact secret and address being backed up.
export function prepare(p: AuctionParams) {
  const sellerSecret = randomFelt();
  const payout = derivePayoutAccount(randomFelt());
  const handle = claimHandle(sellerSecret, BigInt(payout.address));

  const constructorCalldata = CallData.compile([
    toHex(handle),
    TOKEN_ADDRESS,
    POOL_ADDRESS,
    { low: "0x" + (p.reserve & ((1n << 128n) - 1n)).toString(16), high: "0x" + (p.reserve >> 128n).toString(16) },
    { low: "0x" + (p.collateral & ((1n << 128n) - 1n)).toString(16), high: "0x" + (p.collateral >> 128n).toString(16) },
    String(p.closeTime),
    String(p.revealDeadline),
    p.kind,
  ]);

  return { sellerSecret, payout, handle, constructorCalldata, classHash: AUCTION_CLASS_HASH };
}
