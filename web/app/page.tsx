"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { readAuction, type AuctionSummary } from "../src/lib/auction";
import { AuctionList } from "../src/components/AuctionList";
import { AuctionDetail } from "../src/components/AuctionDetail";
import { WalletBar } from "../src/components/WalletBar";
import { forceDownload, persist, type BidBackup } from "../src/lib/backup";
import { bidCommitment, claimHandle } from "../src/commitment";
import { AUCTION_ADDRESS } from "../src/lib/config";
import { derivePayoutAccount } from "../src/lib/payout";
import { formatStrk, parseStrk, randomFelt, splitU256, toHex } from "../src/lib/secrets";
import { useWallet } from "../src/lib/useWallet";
import {
  NotRegistered,
  buildBidActions,
  buildShieldActions,
  isNoteNotReady,
  shieldedStrk,
} from "../src/lib/wallet";

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
    } catch (e) {
      setError(`Could not read the auction: ${(e as Error).message}`);
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
        accountClassHash: (await import("../src/lib/config")).ACCOUNT_CLASS_HASH,
      };

      // Persisted before submission on purpose. If the transaction lands and
      // the browser dies before the download, the secrets still exist.
      persist(backup);

      setBusy("Waiting for the wallet");
      const res = await w.account.strk20InvokeTransaction(
        buildBidActions(auction.collateral, toHex(commitment), toHex(handle)),
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

  if (submitted) {
    return (
      <main className="mx-auto max-w-2xl p-8 space-y-6">
        <h1 className="text-2xl font-semibold">Bid submitted</h1>
        <p className="text-neutral-400">
          A backup file was downloaded. It holds the only copy of your claim secret.
          Without it the collateral cannot be recovered by anyone, including the seller.
        </p>
        <dl className="space-y-2 text-sm font-mono break-all">
          <Row label="transaction" value={submitted.txHash} />
          <Row label="claim handle" value={submitted.backup.claimHandle} />
          <Row label="payout address" value={submitted.backup.payoutAddress} />
        </dl>
        {auction && (
          <p className="text-sm text-neutral-400">
            Auction now holds {formatStrk(auction.escrowed)} STRK across {auction.commitments} commitment
            {auction.commitments === 1 ? "" : "s"}.
          </p>
        )}
        <button className="rounded bg-neutral-800 px-4 py-2" onClick={() => setSubmitted(null)}>
          Back
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-8 space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Sealed</h1>
        <p className="text-neutral-400 text-sm">
          Sealed-bid, second-price. Your bid is hidden until you reveal it, and every bidder
          escrows the same collateral so the funding leg says nothing about the bid.
        </p>
        <nav className="flex gap-4 pt-2 text-sm">
          <Link href="/reveal" className="text-neutral-400 underline hover:text-neutral-200">
            Reveal a bid
          </Link>
          <Link href="/claim" className="text-neutral-400 underline hover:text-neutral-200">
            Claim
          </Link>
          <Link href="/seller" className="text-neutral-400 underline hover:text-neutral-200">
            Seller
          </Link>
          <Link href="/create" className="text-neutral-400 underline hover:text-neutral-200">
            List an auction
          </Link>
        </nav>
      </header>

      <AuctionList />

      {error && <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}

      {!w.account ? (
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wide text-neutral-500">Connect a privacy wallet</h2>
          {w.wallets.length === 0 && (
            <p className="text-sm text-neutral-400">
              No Starknet wallet detected. Ready and Xverse support STRK20 on mainnet; Ready is the
              one to use on Sepolia.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {w.wallets.map((wallet) => (
              <button
                key={wallet.name}
                onClick={() => void w.connect(wallet).catch((e) => setError((e as Error).message))}
                disabled={w.connecting}
                className="rounded bg-neutral-800 px-4 py-2 hover:bg-neutral-700 disabled:opacity-40"
              >
                {wallet.name}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <WalletBar {...w} connect={w.connect} />
          <dl className="space-y-1 text-sm font-mono break-all text-neutral-400">
            <Row label="shielded" value={shielded === null ? "unknown" : `${formatStrk(shielded)} STRK`} />
          </dl>

          {!registered && (
            <div className="rounded border border-amber-900 bg-amber-950/30 p-3 text-sm space-y-2">
              <p className="font-medium text-amber-200">This account is not registered with the privacy pool</p>
              <p className="text-amber-100/70">
                An account has to publish a viewing key before it can hold a shielded balance.
                Registration is not something this page can do for you: there is no registration
                action in the Wallet API, and only you can publish your own viewing key.
              </p>
              <p className="text-amber-100/70">
                Open Ready, use its own privacy feature once, for example shielding a small amount
                there. The wallet registers on first use. Then reconnect here.
              </p>
            </div>
          )}

          {auction && <AuctionDetail address={AUCTION_ADDRESS} a={auction} />}

          <div className="flex items-end gap-3">
            <label className="flex-1 space-y-1">
              <span className="block text-sm text-neutral-400">Your bid, in STRK</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded bg-neutral-900 border border-neutral-800 px-3 py-2"
              />
            </label>
            <button
              onClick={bid}
              disabled={!!busy || !registered}
              className="rounded bg-neutral-100 px-5 py-2 font-medium text-neutral-900 disabled:opacity-40"
            >
              {busy || "Place bid"}
            </button>
          </div>

          <div className="flex items-end gap-2">
            <label className="space-y-1">
              <span className="block text-xs text-neutral-500">Shield more STRK</span>
              <input
                value={shieldAmount}
                onChange={(e) => setShieldAmount(e.target.value)}
                className="w-24 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm"
              />
            </label>
            <button
              onClick={shield}
              disabled={!!busy || !registered}
              className="rounded border border-neutral-800 px-3 py-1 text-sm text-neutral-400 hover:border-neutral-700 disabled:opacity-40"
            >
              Shield
            </button>
          </div>

          <p className="text-xs text-neutral-500">
            Shield well before you bid. Shielding moments before a bid creates a timing link
            that the pool cannot hide.
          </p>
        </section>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-neutral-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
