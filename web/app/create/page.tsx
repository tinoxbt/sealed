"use client";

import Link from "next/link";
import { useState } from "react";
import { forceDownloadSeller } from "../../src/lib/backup";
import { MIN_REVEAL_WINDOW_SECONDS, prepare, validate, type SellerBackup } from "../../src/lib/create";
import { formatStrk, parseStrk, toHex } from "../../src/lib/secrets";
import { useWallet } from "../../src/lib/useWallet";
import { WalletBar } from "../../src/components/WalletBar";

type Created = { address: string; txHash: string; backup: SellerBackup };

export default function CreatePage() {
  const w = useWallet();
  const [reserve, setReserve] = useState("0.1");
  const [collateral, setCollateral] = useState("1");
  const [openHours, setOpenHours] = useState("24");
  const [revealHours, setRevealHours] = useState("24");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);

  async function create() {
    if (!w.account) return;
    setError("");

    let params;
    try {
      const now = Math.floor(Date.now() / 1000);
      const closeTime = now + Math.round(parseFloat(openHours) * 3600);
      params = {
        reserve: parseStrk(reserve),
        collateral: parseStrk(collateral),
        closeTime,
        revealDeadline: closeTime + Math.round(parseFloat(revealHours) * 3600),
      };
    } catch {
      setError("Reserve and collateral must be numbers.");
      return;
    }

    // The constructor enforces all of this too. Checking here first means the
    // seller finds out before spending a deployment.
    const problem = validate(params);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy("Preparing");
    try {
      const { sellerSecret, payout, handle, constructorCalldata, classHash } = prepare(params);

      setBusy("Waiting for the wallet");
      const res = await w.account.deployContract({ classHash, constructorCalldata });
      const address = Array.isArray(res.contract_address)
        ? res.contract_address[0]
        : res.contract_address;

      const backup: SellerBackup = {
        version: 1,
        role: "seller",
        auction: address,
        network: "sepolia",
        createdAt: new Date().toISOString(),
        sellerSecret: toHex(sellerSecret),
        sellerHandle: toHex(handle),
        payoutAddress: payout.address,
        payoutPrivateKey: toHex(payout.privateKey),
        payoutSalt: payout.salt,
        accountClassHash: (await import("../../src/lib/config")).ACCOUNT_CLASS_HASH,
        reserveStrk: reserve,
        collateralStrk: collateral,
        closeTime: params.closeTime,
        revealDeadline: params.revealDeadline,
      };

      // Same rule as the bid flow, for the same reason. The seller secret
      // exists only in this file, and without it the proceeds of this auction
      // cannot be claimed by anyone.
      forceDownloadSeller(backup);
      setCreated({ address, txHash: res.transaction_hash, backup });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (created) {
    return (
      <main className="mx-auto max-w-2xl p-8 space-y-6">
        <h1 className="text-2xl font-semibold">Auction created</h1>
        <p className="text-neutral-400">
          A backup file was downloaded. It holds the only copy of your seller secret and the
          key to your payout account. Without both, the proceeds of this auction cannot be
          claimed by anyone, including you.
        </p>
        <dl className="space-y-2 text-sm font-mono break-all">
          <Row label="auction" value={created.address} />
          <Row label="transaction" value={created.txHash} />
          <Row label="payout" value={created.backup.payoutAddress} />
        </dl>
        <p className="text-sm text-neutral-400">
          Bidders need the auction address. Send it to them, or point them at this app
          configured with it.
        </p>
        <Link href="/seller" className="inline-block rounded bg-neutral-800 px-4 py-2">
          Go to the seller page
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-8 space-y-8">
      <header className="space-y-1">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
          Sealed
        </Link>
        <h1 className="text-2xl font-semibold">List an auction</h1>
        <p className="text-sm text-neutral-400">
          Deploys your own auction contract from your wallet. Nobody else holds a key to it and
          there is no listing to approve.
        </p>
      </header>

      {error && (
        <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>
      )}

      <section className="space-y-4">
        <Field
          label="Collateral, in STRK"
          value={collateral}
          onChange={setCollateral}
          hint="Every bidder escrows this same amount, which is what stops the funding transfer from revealing anyone's bid. It is also the highest bid the auction can accept, and the price of staying silent at reveal. Set it a little above the highest bid you expect."
        />
        <Field
          label="Reserve, in STRK"
          value={reserve}
          onChange={setReserve}
          hint="The lowest bid you will accept, and the clearing price if only one bidder reveals. Cannot exceed the collateral."
        />
        <Field label="Bidding stays open for, in hours" value={openHours} onChange={setOpenHours} />
        <Field
          label="Reveal window, in hours"
          value={revealHours}
          onChange={setRevealHours}
          hint={`At least ${MIN_REVEAL_WINDOW_SECONDS / 60} minutes, enforced by the contract. Bidders who miss it forfeit their collateral to you, so a short window is a way of taking their money rather than selling anything. Give people a night's sleep.`}
        />

        <WalletBar {...w} connect={w.connect} />

        {w.address && (
          <button
            onClick={create}
            disabled={!!busy}
            className="w-full rounded bg-neutral-100 px-5 py-3 font-medium text-neutral-900 disabled:opacity-40"
          >
            {busy || `Create the auction`}
          </button>
        )}

        <p className="text-xs text-neutral-500">
          Deploying is a public transaction from your wallet. It shows that you created an
          auction, which is not private and does not need to be. What stays hidden is who bids
          and what they bid.
        </p>
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm text-neutral-300">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded bg-neutral-900 border border-neutral-800 px-3 py-2"
      />
      {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-neutral-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
