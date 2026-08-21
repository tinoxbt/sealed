/// Human-readable names for auctions.
///
/// A static file rather than a service, deliberately. A server that answered
/// "tell me about auction X" would learn which addresses are curious about
/// which auctions, which is a linkage the rest of the design spends real effort
/// avoiding. A file everyone downloads in full learns nothing.
///
/// The contract remains the only source of truth. Everything here is
/// decoration: if this file is wrong, missing, or malicious, the auction still
/// prices and settles exactly the same way. Nothing is read from it that
/// affects money.
export type Listing = {
  title: string;
  description: string;
  seller?: string;
  itemKind?: string;
};

let cache: Record<string, Listing> | null = null;

const normalise = (address: string) => BigInt(address).toString(16);

export async function loadListings(basePath = ""): Promise<Record<string, Listing>> {
  if (cache) return cache;
  try {
    const res = await fetch(`${basePath}/listings.json`);
    const raw = (await res.json()) as { listings?: Record<string, Listing> };
    cache = Object.fromEntries(
      Object.entries(raw.listings ?? {}).map(([k, v]) => [normalise(k), v]),
    );
  } catch {
    // A missing or malformed file is not an error worth surfacing. Auctions
    // simply show as their address, which is what they are.
    cache = {};
  }
  return cache;
}

export async function lookup(address: string, basePath = ""): Promise<Listing | null> {
  const all = await loadListings(basePath);
  return all[normalise(address)] ?? null;
}
