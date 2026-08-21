/// Sepolia deployment. One auction, one token, one round.
/// The deployed auction. Sepolia, bidding closes 23 August 2026.
///
/// Overridable so a short-window auction can be exercised end to end without
/// editing source. Editing a constant to test, then forgetting to change it
/// back, is how a testnet address reaches production.
/// The auction this page is acting on.
///
/// Resolved once, when the module loads in the browser, from the `a` query
/// parameter, then whatever was last chosen, then the configured default.
/// Every page reads this rather than taking an address parameter, which keeps
/// ten call sites unchanged.
///
/// The consequence is that switching auctions needs a real page load, not a
/// client-side route change, because this value is captured at module init.
/// Auction links are therefore plain anchors, not next/link.
function resolveAuction(): string {
  const fallback = process.env.NEXT_PUBLIC_AUCTION_ADDRESS ?? "0x076a5480f7359b8a8db0245c603c78e108a89442fb3b71aea2a3e7cc976b133d";
  if (typeof window === "undefined") return fallback;

  const fromUrl = new URLSearchParams(window.location.search).get("a");
  if (fromUrl && /^0x[0-9a-fA-F]{1,64}$/.test(fromUrl)) {
    window.localStorage.setItem("sealed:active", fromUrl);
    return fromUrl;
  }
  const saved = window.localStorage.getItem("sealed:active");
  if (saved && /^0x[0-9a-fA-F]{1,64}$/.test(saved)) return saved;
  return fallback;
}

export const AUCTION_ADDRESS = resolveAuction();

/// The address the app falls back to when nothing is pinned. Exposed so the UI
/// can offer a way out when the pinned auction turns out to be unreadable.
export const DEFAULT_AUCTION_ADDRESS =
  process.env.NEXT_PUBLIC_AUCTION_ADDRESS ?? "0x076a5480f7359b8a8db0245c603c78e108a89442fb3b71aea2a3e7cc976b133d";

/// Forget the pinned auction and go back to the default.
///
/// Without this a browser that once visited an auction from an older contract
/// is stuck there: every read fails, and the pin is invisible from the UI.
export function clearPinnedAuction(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("sealed:active");
  window.location.href = window.location.pathname;
}

/// The declared auction class. A seller deploys an instance of it from their
/// own wallet through the Universal Deployer, so listing an auction needs no
/// privileged party and no backend.
///
/// This must track what is actually declared on the network. A stale value
/// deploys an older contract that looks identical from the outside.
export const AUCTION_CLASS_HASH =
  process.env.NEXT_PUBLIC_AUCTION_CLASS_HASH ??
  "0x0766f2dc9cec51dd1e884dc0e565733f159c3b1b29f2ba16cd4f174fec3f602a";

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
