/// Sepolia deployment. One auction, one token, one round.
/// Bidding closes 23 August 2026, reveal deadline 24 August.
export const AUCTION_ADDRESS =
  "0x05a58d32d426ddbf37e376c5668991168cb2e0d19cc017d5158d4836a088f7b8";

/// STRK. Same address on Sepolia and mainnet.
export const TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/// STRK20 privacy pool v2.0 on Sepolia. The auction's constructor stored this
/// as the only address permitted to call privacy_invoke.
export const POOL_ADDRESS =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

/// OpenZeppelin account class. Payout accounts are counterfactual: the address
/// is derived now and hashed into claim_handle, and the account is deployed
/// only when its owner wants to move the funds on.
///
/// This exact class hash is deployed and working on Sepolia, it is what the
/// project's own deployer account runs. Do not substitute an unverified hash:
/// an address derived from a class that cannot be deployed is a hole that
/// swallows the payout permanently.
export const ACCOUNT_CLASS_HASH =
  "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";

export const SEPOLIA_CHAIN_ID = "0x534e5f5345504f4c4941";
