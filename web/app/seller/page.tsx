"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Call } from "starknet";
import {
  claimProceedsCall,
  readAuction,
  settleCall,
  type AuctionSummary,
} from "../../src/lib/auction";
import { formatStrk } from "../../src/lib/secrets";
import { useWallet } from "../../src/lib/useWallet";
import { AuctionDetail } from "../../src/components/AuctionDetail";
import { AUCTION_ADDRESS } from "../../src/lib/config";
import { WalletBar } from "../../src/components/WalletBar";

export default function SellerPage() {
  const w = useWallet();
  const [auction, setAuction] = useState<AuctionSummary | null>(null);
  const [secret, setSecret] = useState("");
  const [payout, setPayout] = useState("");
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

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

  async function send(label: string, call: Call) {
    if (!w.account) return;
    setError("");
    setBusy(label);
    try {
      const res = await w.account.execute([call]);
      setTxHash(res.transaction_hash);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const expected =
    auction && auction.phase === "Settled"
      ? auction.clearingPrice +
        auction.collateral * BigInt(auction.commitments - auction.revealed)
      : 0n;

  return (
    <main className="mx-auto max-w-2xl p-8 space-y-8">
      <header className="space-y-1">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
          Sealed
        </Link>
        <h1 className="text-2xl font-semibold">Seller</h1>
        <p className="text-sm text-neutral-400">
          Settle the auction, then collect the clearing price plus every forfeited collateral.
        </p>
      </header>

      {error && (
        <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {auction && <AuctionDetail address={AUCTION_ADDRESS} a={auction} />}

      <WalletBar {...w} connect={w.connect} />

      {auction?.phase === "AwaitingSettlement" && (
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wide text-neutral-500">Settle</h2>
          <p className="text-sm text-neutral-400">
            The reveal window has closed. Settling records the winner and the clearing price and
            moves no money, so anyone can call it and there is nothing to gain by being first.
            Every payout happens afterwards through individual claims.
          </p>
          {w.address && (
            <button
              onClick={() => send("Settling", settleCall())}
              disabled={!!busy}
              className="rounded bg-neutral-100 px-5 py-2 font-medium text-neutral-900 disabled:opacity-40"
            >
              {busy || "Settle the auction"}
            </button>
          )}
        </section>
      )}

      {auction?.phase === "Settled" && (
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wide text-neutral-500">Collect proceeds</h2>
          <p className="text-sm text-neutral-400">
            {formatStrk(auction.clearingPrice)} STRK clearing price
            {auction.commitments > auction.revealed && (
              <>
                {" "}
                plus {auction.commitments - auction.revealed} forfeited collateral, so{" "}
                {formatStrk(expected)} STRK in total
              </>
            )}
            . Payable once.
          </p>
          <p className="text-sm text-neutral-400">
            The seller is authorised exactly like a bidder: the contract recomputes
            poseidon(secret, payout address) and requires it to match the handle fixed when the
            auction was created. There is no privileged seller path and no stored seller address.
          </p>

          <label className="block space-y-1">
            <span className="text-sm text-neutral-400">Seller secret</span>
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="0x..."
              className="w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-neutral-400">
              Payout address, exactly the one committed at creation
            </span>
            <input
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              placeholder="0x..."
              className="w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-sm"
            />
          </label>

          {w.address && (
            <button
              onClick={() => send("Claiming", claimProceedsCall(secret.trim(), payout.trim()))}
              disabled={!!busy || !secret.trim() || !payout.trim()}
              className="rounded bg-neutral-100 px-5 py-2 font-medium text-neutral-900 disabled:opacity-40"
            >
              {busy || "Claim proceeds"}
            </button>
          )}

          <p className="text-xs text-neutral-500">
            A different payout address will be rejected, because it changes the hash. That is
            what stops anyone who sees the secret in calldata from redirecting the money.
          </p>
        </section>
      )}

      {txHash && <p className="font-mono text-xs text-neutral-400 break-all">submitted {txHash}</p>}
    </main>
  );
}
