/// Sepolia deployment. One auction, one token, one round.
/// The deployed auction. Sepolia, bidding closes 23 August 2026.
///
/// Overridable so a short-window auction can be exercised end to end without
/// editing source. Editing a constant to test, then forgetting to change it
/// back, is how a testnet address reaches production.
export const AUCTION_ADDRESS =
  process.env.NEXT_PUBLIC_AUCTION_ADDRESS ??
  "0x0575e771aeeb47e81f094360e18f61ca5190e77043783ac0d28f9e95c2b8412b";

/// The declared auction class. A seller deploys an instance of it from their
/// own wallet through the Universal Deployer, so listing an auction needs no
/// privileged party and no backend.
///
/// This must track what is actually declared on the network. A stale value
/// deploys an older contract that looks identical from the outside.
export const AUCTION_CLASS_HASH =
  process.env.NEXT_PUBLIC_AUCTION_CLASS_HASH ??
  "0x68d3a5ebe037914e8368fd367adbd26849daa80342fa5d2d85827cc538bcc66";

/// STRK. Same address on Sepolia and mainnet.
export const TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/// STRK20 privacy pool v2.0 on Sepolia. The auction's constructor stored this
/// as the only address permitted to call privacy_invoke.
///
/// Mainnet uses a different pool, 0x040337b1...ffe812a, verified by calling
/// get_screener_public_key on it. Pointing a mainnet auction at the Sepolia
/// pool produces an auction that no bid can ever fund, because privacy_invoke
/// checks the caller against the address the constructor stored.
export const POOL_ADDRESS =
  process.env.NEXT_PUBLIC_POOL_ADDRESS ??
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

/// Explorer base, for linking anything the user may want to verify themselves.
/// Sealed states what it did; the chain is where a user confirms it.
export const EXPLORER =
  process.env.NEXT_PUBLIC_EXPLORER ?? "https://sepolia.voyager.online";
