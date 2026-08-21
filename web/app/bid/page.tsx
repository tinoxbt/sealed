"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { readAuction, type AuctionSummary } from "../../src/lib/auction";
import { AuctionDetail } from "../../src/components/AuctionDetail";
import { WalletBar } from "../../src/components/WalletBar";
import { forceDownload, persist, type BidBackup } from "../../src/lib/backup";
import { bidCommitment, claimHandle } from "../../src/commitment";
import { AUCTION_ADDRESS, DEFAULT_AUCTION_ADDRESS, clearPinnedAuction } from "../../src/lib/config";
import { derivePayoutAccount } from "../../src/lib/payout";
import { formatStrk, parseStrk, randomFelt, splitU256, toHex } from "../../src/lib/secrets";
import { useWallet } from "../../src/lib/useWallet";
import {
  NotRegistered,
  buildBidActions,
  buildShieldActions,
  isNoteNotReady,
  shieldedStrk,
} from "../../src/lib/wallet";

type Submitted = { txHash: string; backup: BidBackup };

export default function BidPage() {
  const w = useWallet();
  const [shielded, setShielded] = useState<bigint | null>(null);
  const [auction, setAuction] = useState<AuctionSummary | null>(null);
  const [amount, setAmount] = useState("0.5");
  const [shieldAmount, setShieldAmount] = useState("2");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [registered, setRegistered] = useState(true);
  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    let current = true;
    setShielded(null);
    setRegistered(true);
    if (!w.account) return;

    // The balance lives on the bid page because reveal and claim never touch
    // the pool, and unregistered accounts must still be able to use them.
    void shieldedStrk(w.account)
      .then((balance) => {
        if (current) setShielded(balance);
      })
      .catch((e) => {
        if (!current) return;
        if (e instanceof NotRegistered) setRegistered(false);
        else setError((e as Error).message);
      });

    return () => {
      current = false;
    };
  }, [w.account]);

  const refresh = useCallback(async () => {
    try {
      setAuction(await readAuction());
    } catch {
      // The RPC message here is a wall of JSON that tells a user nothing. What
      // matters is which auction failed and how to leave it.
      setUnreadable(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function shield() {
    if (!w.account) return;
    setError("");
    setBusy(`Shielding ${shieldAmount} STRK`);
    try {
      await w.account.strk20InvokeTransaction(buildShieldActions(parseStrk(shieldAmount)));
      setShielded(await shieldedStrk(w.account));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function bid() {
    if (!w.account || !auction) return;
    setError("");

    let bidAmount: bigint;
    try {
      bidAmount = parseStrk(amount);
    } catch {
      setError("Bid amount is not a number.");
      return;
    }
    // The contract rejects a bid above the collateral, so catch it here rather
    // than spending a transaction to be told.
    if (bidAmount > auction.collateral) {
      setError(`Bid cannot exceed the collateral, ${formatStrk(auction.collateral)} STRK.`);
      return;
    }
    if (shielded !== null && shielded < auction.collateral) {
      setError(`Shielded balance is below the collateral. Shield at least ${formatStrk(auction.collateral)} STRK first.`);
      return;
    }

    setBusy("Building the bid");
    try {
      // Two unrelated secrets. bid_salt becomes public at reveal; claim_secret
      // never does. If one value did both jobs, anyone watching the reveal
      // phase could drain every losing bidder.
      const bidSalt = randomFelt();
      const claimSecret = randomFelt();

      // The payout account is derived now, before committing, because its
      // address is hashed into claim_handle and the contract will only ever pay
      // the address that was committed.
      const payout = derivePayoutAccount(randomFelt());

      const handle = claimHandle(claimSecret, BigInt(payout.address));
      const commitment = bidCommitment(splitU256(bidAmount), bidSalt, handle);

      const backup: BidBackup = {
        version: 1,
        auction: AUCTION_ADDRESS,
        network: "sepolia",
        createdAt: new Date().toISOString(),
        bidAmountStrk: amount,
        bidSalt: toHex(bidSalt),
        claimSecret: toHex(claimSecret),
        claimHandle: toHex(handle),
        bidCommitment: toHex(commitment),
        payoutAddress: payout.address,
        payoutPrivateKey: toHex(payout.privateKey),
        payoutSalt: payout.salt,
        accountClassHash: (await import("../../src/lib/config")).ACCOUNT_CLASS_HASH,
      };

      // Persisted before submission on purpose. If the transaction lands and
      // the browser dies before the download, the secrets still exist.
      persist(backup);

      setBusy("Waiting for the wallet");
      // Empty, deliberately. The contract accepts an encrypted backup blob
      // here, but the client-side encryption that would fill it is not built
      // yet. Sending random padding would make the interface look like it has
      // a recovery path it does not have, and a bidder who believed that and
      // deleted their backup file would lose everything. The downloaded file
      // remains the only copy until the blob is real.
      const res = await w.account.strk20InvokeTransaction(
        buildBidActions(auction.collateral, toHex(commitment), toHex(handle), []),
      );

      // Not skippable, and before the confirmation screen. Losing claim_secret
      // means the collateral is unrecoverable by anyone.
      forceDownload(backup);
      setSubmitted({ txHash: res.transaction_hash, backup });
      void refresh();
    } catch (e) {
      // A rejected bid leaves the secrets in localStorage, which is correct:
      // they are worthless without an entry, and keeping them costs nothing
      // while losing them to a retry would be irreversible if the first
      // attempt had in fact landed.
      setError(
        isNoteNotReady(e)
          ? "Your shielded balance is too new to spend. The pool requires a matured note, which takes roughly ten blocks after shielding. Wait a few minutes and bid again. Shielding well ahead of an auction also avoids the timing link that shielding moments before a bid would create."
          : (e as Error).message,
      );
    } finally {
      setBusy("");
    }
  }

  if (unreadable) {
    const pinned = AUCTION_ADDRESS.toLowerCase() !== DEFAULT_AUCTION_ADDRESS.toLowerCase();
    return (
      <main className="mx-auto max-w-3xl px-5 py-10 space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">This auction cannot be read</h1>
        <p className="text-[var(--muted)] leading-relaxed">
          Nothing answered at{" "}
          <span className="mono text-[var(--text)] break-all">{AUCTION_ADDRESS}</span>. That
          usually means it was deployed from an older version of the contract, so the
          entrypoints this page calls do not exist on it.
        </p>
        {pinned && (
          <>
            <p className="text-[var(--muted)]">
              Your browser is pinned to it from a previous visit. Clearing that pin returns you
              to the current auction.
            </p>
            <button className="btn-primary" onClick={clearPinnedAuction}>
              Use the current auction
            </button>
          </>
        )}
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-10 space-y-6">
        <h1 className="text-2xl font-semibold">Bid submitted</h1>
        <p className="text-[var(--muted)]">
          A backup file was downloaded. It holds the only copy of your claim secret.
          Without it the collateral cannot be recovered by anyone, including the seller.
        </p>
        <dl className="space-y-2 text-sm font-mono break-all">
          <Row label="transaction" value={submitted.txHash} />
          <Row label="claim handle" value={submitted.backup.claimHandle} />
          <Row label="payout address" value={submitted.backup.payoutAddress} />
        </dl>
        {auction && (
          <p className="text-sm text-[var(--muted)]">
            Auction now holds {formatStrk(auction.escrowed)} STRK across {auction.commitments} commitment
            {auction.commitments === 1 ? "" : "s"}.
          </p>
        )}
        <button className="rounded bg-[var(--surface-2)] px-4 py-2" onClick={() => setSubmitted(null)}>
          Back
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 space-y-7">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Place a bid</h1>
        <p className="text-[var(--muted)] leading-relaxed">
          Your bid is hidden until you reveal it. Every bidder escrows the same collateral,
          so the funding leg says nothing about what anyone bid.
        </p>
      </header>

      {/* Public auction state first, and outside the wallet gate. Anyone should
          be able to read the terms of an auction before deciding to connect
          anything to it. */}
      {auction ? (
        <AuctionDetail address={AUCTION_ADDRESS} a={auction} />
      ) : (
        <div className="card p-6 animate-pulse">
          <div className="h-3 w-24 rounded bg-[var(--surface-2)]" />
          <div className="mt-4 h-7 w-40 rounded bg-[var(--surface-2)]" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--seal)]/40 bg-[var(--seal)]/[0.07] p-4 text-sm leading-relaxed">
          {error}
        </div>
      )}

      {!w.account ? (
        <section className="card p-6 space-y-3">
          <h2 className="label">Connect a privacy wallet</h2>
          {w.wallets.length === 0 ? (
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              No Starknet wallet detected. Bidding moves collateral through the STRK20 pool,
              so it needs a wallet with privacy support. Xverse works on Sepolia; Ready
              supports it on mainnet.
            </p>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Bidding routes through the pool, so the auction never sees an address of yours.
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {w.wallets.map((wallet) => (
              <button
                key={wallet.name}
                onClick={() => void w.connect(wallet).catch((e) => setError((e as Error).message))}
                disabled={w.connecting}
                className="btn-ghost"
              >
                {wallet.name}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="card p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <WalletBar {...w} connect={w.connect} />
            <span className="text-sm">
              <span className="label inline">shielded</span>{" "}
              <span className="mono">
                {shielded === null ? "—" : `${formatStrk(shielded)} STRK`}
              </span>
            </span>
          </div>

          {!registered && (
            <div className="rounded-lg border border-[var(--warn)]/30 bg-[var(--warn)]/[0.07] p-4 text-sm space-y-2">
              <p className="font-medium text-[var(--warn)]">
                This account is not registered with the privacy pool
              </p>
              <p className="text-[var(--muted)] leading-relaxed">
                An account has to publish a viewing key before it can hold a shielded balance.
                No dapp can do that for you: there is no registration action in the Wallet API,
                and only you can publish your own key.
              </p>
              <p className="text-[var(--muted)] leading-relaxed">
                Open your wallet, use its privacy feature once, then reconnect here.
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="space-y-1.5">
              <span className="label">Your bid, in STRK</span>
              <input className="input mono" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <button onClick={bid} disabled={!!busy || !registered} className="btn-primary h-[42px] px-6">
              {busy || "Place bid"}
            </button>
          </div>
          <p className="text-xs text-[var(--faint)] leading-relaxed">
            Placing a bid escrows the collateral, not your bid. Both secrets are generated here
            and never leave this browser, and a backup file downloads before the confirmation.
          </p>

          <div className="border-t border-[var(--line)] pt-5 space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1.5">
                <span className="label">Shield more STRK</span>
                <input
                  className="input mono w-28"
                  value={shieldAmount}
                  onChange={(e) => setShieldAmount(e.target.value)}
                />
              </label>
              <button onClick={shield} disabled={!!busy} className="btn-ghost h-[42px]">
                Shield
              </button>
            </div>
            <p className="text-xs text-[var(--faint)] leading-relaxed">
              Shield well before an auction. Doing it moments before bidding creates a timing
              link the pool cannot hide, and a freshly shielded note needs about ten blocks
              before it can be spent.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-[var(--faint)]">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
