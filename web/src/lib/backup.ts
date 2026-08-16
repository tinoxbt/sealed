import { AUCTION_ADDRESS } from "./config";

export type BidBackup = {
  version: 1;
  auction: string;
  network: "sepolia";
  createdAt: string;
  bidAmountStrk: string;
  bidSalt: string;
  claimSecret: string;
  claimHandle: string;
  bidCommitment: string;
  payoutAddress: string;
  payoutPrivateKey: string;
  payoutSalt: string;
  accountClassHash: string;
};

const key = (auction: string) => `sealed:bid:${auction}`;

export function persist(b: BidBackup) {
  localStorage.setItem(key(b.auction), JSON.stringify(b));
}

export function load(auction = AUCTION_ADDRESS): BidBackup | null {
  const raw = localStorage.getItem(key(auction));
  return raw ? (JSON.parse(raw) as BidBackup) : null;
}

/// Push the backup at the user as a file download.
///
/// This runs immediately after the bid is submitted and before any
/// confirmation screen, and it is not skippable. `claim_secret` exists only
/// here and in localStorage. Losing it means the collateral is unrecoverable
/// by anyone, including the seller and the contract author. `bid_salt` is
/// almost as bad: without it the bid cannot be revealed and the collateral is
/// forfeited to the seller.
export function forceDownload(b: BidBackup) {
  const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sealed-bid-${b.auction.slice(0, 10)}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke late: some browsers abort an in-flight download otherwise.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/// Read a backup from the file the bid flow downloaded.
///
/// localStorage is the convenient path and the file is the durable one. A
/// bidder who bid on another machine, or cleared site data, has only the file,
/// so every page that needs secrets accepts both.
export function parseBackup(text: string): BidBackup {
  const b = JSON.parse(text) as BidBackup;
  for (const f of ["bidSalt", "claimSecret", "claimHandle", "payoutAddress"] as const) {
    if (!b[f]) throw new Error(`Backup is missing ${f}.`);
  }
  return b;
}
