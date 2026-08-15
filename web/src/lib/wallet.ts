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
      calldata: [bidCommitment, claimHandle],
    },
  ];
}

export function buildShieldActions(amount: bigint): WALLET_API.STRK20_ACTION[] {
  // Deposit is always to self, so it takes no recipient.
  return [{ type: "deposit", token: TOKEN_ADDRESS, amount: "0x" + amount.toString(16) }];
}

export async function shieldedStrk(account: WalletAccountV6): Promise<bigint> {
  const balances = await account.strk20Balances([TOKEN_ADDRESS]);
  const entry = balances?.find(
    (b: { token: string; balance: string }) => BigInt(b.token) === BigInt(TOKEN_ADDRESS),
  );
  return entry ? BigInt(entry.balance) : 0n;
}

export function isSepolia(chainId: string): boolean {
  return chainId === SEPOLIA_CHAIN_ID;
}

export { POOL_ADDRESS };
