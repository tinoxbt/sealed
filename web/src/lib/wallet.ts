import type { WALLET_API } from "@starknet-io/types-js";
import { WalletAccountV6 } from "starknet";
import { AUCTION_ADDRESS, POOL_ADDRESS, SEPOLIA_CHAIN_ID, TOKEN_ADDRESS } from "./config";

/// The bid, as one STRK20 transaction.
///
/// Two actions, submitted together. The pool withdraws the uniform collateral
/// to the auction contract and then calls `privacy_invoke` on it in the same
/// transaction. If either half reverts, both do, and the collateral stays in
/// the pool.
///
/// The bidder never sends this transaction themselves: a relayer submits it and
/// the auction's caller is the pool, so no bidder-controlled address appears in
/// the commit at all. That is where the unlinkability comes from.
/// Operation discriminator for the auction's privacy_invoke. Must match the
/// PoolOperation enum in auction.cairo, which serialises as its variant index.
export const PoolOperation = { Commit: "0x0", Reveal: "0x1", Claim: "0x2" } as const;

/// Dust spent to satisfy the pool's replay protection.
///
/// Every pool transaction must spend at least one matured note. Bidding spends
/// one naturally, because it withdraws the collateral. Revealing and claiming
/// move no value of their own, so they transfer a token unit to the user
/// themselves purely to have spent something.
const REPLAY_DUST = "0x1";

export function buildBidActions(
  collateral: bigint,
  bidCommitment: string,
  claimHandle: string,
): WALLET_API.STRK20_ACTION[] {
  return [
    {
      type: "withdraw",
      token: TOKEN_ADDRESS,
      amount: "0x" + collateral.toString(16),
      recipient: AUCTION_ADDRESS,
    },
    {
      type: "invoke",
      contract: AUCTION_ADDRESS,
      calldata: [PoolOperation.Commit, bidCommitment, claimHandle, "0x0", "0x0"],
    },
  ];
}

/// Reveal, routed through the pool.
///
/// The bid amount becomes public here, which is the point of revealing. Who
/// revealed it does not: the pool is the caller and a relayer submits, so the
/// bidder never appears as a transaction sender. Revealing from an ordinary
/// wallet would weld that wallet to the bid amount and undo what the commit
/// protected.
///
/// The self-transfer carries no meaning. It exists only because the pool
/// requires a spent note and an invoke does not provide one.
export function buildRevealActions(
  self: string,
  amount: bigint,
  bidSalt: string,
  claimHandle: string,
): WALLET_API.STRK20_ACTION[] {
  return [
    { type: "transfer", token: TOKEN_ADDRESS, amount: REPLAY_DUST, recipient: self },
    {
      type: "invoke",
      contract: AUCTION_ADDRESS,
      calldata: [
        PoolOperation.Reveal,
        "0x" + (amount & ((1n << 128n) - 1n)).toString(16),
        "0x" + (amount >> 128n).toString(16),
        bidSalt,
        claimHandle,
      ],
    },
  ];
}

/// Claim, routed through the pool.
///
/// The payout still goes only to the address committed at bid time: the
/// contract recomputes the handle and refuses anything else. Routing changes
/// who submits the transaction and nothing about where the money goes.
export function buildClaimActions(
  self: string,
  claimSecret: string,
  payoutAddress: string,
): WALLET_API.STRK20_ACTION[] {
  return [
    { type: "transfer", token: TOKEN_ADDRESS, amount: REPLAY_DUST, recipient: self },
    {
      type: "invoke",
      contract: AUCTION_ADDRESS,
      calldata: [PoolOperation.Claim, claimSecret, payoutAddress, "0x0", "0x0"],
    },
  ];
}

export function buildShieldActions(amount: bigint): WALLET_API.STRK20_ACTION[] {
  // Deposit is always to self, so it takes no recipient.
  return [{ type: "deposit", token: TOKEN_ADDRESS, amount: "0x" + amount.toString(16) }];
}

/// Thrown when the account has no viewing key in the pool yet.
///
/// There is no registration action in the Wallet API union, so a dapp cannot
/// fix this. The wallet registers on first use of its own privacy features.
export class NotRegistered extends Error {}

/// The pool requires every transaction to spend at least one matured note,
/// which is what provides replay protection. A deposit only appends a note; it
/// does not spend one. So a freshly shielded balance cannot be spent until the
/// deposit is included and the note is discoverable, roughly ten blocks.
///
/// Shielding and bidding seconds apart therefore fails at the pool, before the
/// auction contract is ever reached. This is the same advice the privacy model
/// gives for a different reason: shield well ahead.
export function isNoteNotReady(e: unknown): boolean {
  const m = (e as Error)?.message?.toUpperCase() ?? "";
  return m.includes("NO_REPLAY_PROTECTION") || m.includes("NO MATURED NOTE");
}

function isNotRegistered(e: unknown): boolean {
  const m = (e as Error)?.message?.toLowerCase() ?? "";
  return m.includes("not_registered") || m.includes("not registered") || m.includes("viewing key");
}

export async function shieldedStrk(account: WalletAccountV6): Promise<bigint> {
  let balances;
  try {
    balances = await account.strk20Balances([TOKEN_ADDRESS]);
  } catch (e) {
    if (isNotRegistered(e)) throw new NotRegistered();
    throw e;
  }
  const entry = balances?.find(
    (b: { token: string; balance: string }) => BigInt(b.token) === BigInt(TOKEN_ADDRESS),
  );
  return entry ? BigInt(entry.balance) : 0n;
}

export function isSepolia(chainId: string): boolean {
  return chainId === SEPOLIA_CHAIN_ID;
}

export { POOL_ADDRESS };
