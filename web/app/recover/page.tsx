"use client";

import Link from "next/link";
import { useState } from "react";
import { AuctionContext } from "../../src/components/AuctionContext";
import { Notice, Row } from "../../src/components/ui";
import { recoverFromChain, type Recovered } from "../../src/lib/recovery";
import { toHex } from "../../src/lib/secrets";

export default function RecoverPage() {
  const [passphrase, setPassphrase] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [found, setFound] = useState<Recovered[] | null>(null);

  async function recover() {
    setError("");
    setFound(null);
    if (!passphrase && !code) {
      setError("Enter a passphrase or a recovery code.");
      return;
    }
    setBusy("Reading commitments");
    try {
      const results = await recoverFromChain(
        { passphrase: passphrase || undefined, recoveryCode: code || undefined },
        undefined,
        (done, total) => setBusy(`Trying entry ${done} of ${total}`),
      );
      setFound(results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 space-y-7">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Recover a bid</h1>
        <p className="text-[var(--muted)] leading-relaxed">
          If you set a passphrase or kept your recovery code, your secrets can be rebuilt from
          chain with no file and no browser history.
        </p>
      </header>

      <AuctionContext />

      <section className="card p-6 space-y-4">
        <label className="space-y-1.5 block">
          <span className="label">Passphrase</span>
          <input
            type="password"
            className="input"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>

        <label className="space-y-1.5 block">
          <span className="label">or recovery code</span>
          <input
            className="input mono"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXXXX-XXXXXX-XXXXXX"
          />
        </label>

        <button onClick={recover} disabled={!!busy} className="btn-primary">
          {busy || "Search the chain"}
        </button>

        <p className="text-xs text-[var(--faint)] leading-relaxed">
          Everything happens in this browser. Each entry's encrypted blob is fetched and tried
          in turn; only yours will open, and nothing is sent anywhere.
        </p>
      </section>

      {error && <Notice tone="danger">{error}</Notice>}

      {found !== null && found.length === 0 && (
        <Notice tone="warn" title="Nothing opened">
          <p>
            No entry in this auction could be decrypted with what you entered. Either the
            credential is wrong, or the bid was placed before the on-chain backup existed and
            the downloaded file is the only copy.
          </p>
        </Notice>
      )}

      {found?.map((f) => (
        <section key={f.claimHandle} className="card p-6 space-y-4">
          <h2 className="font-medium text-[var(--good)]">Recovered</h2>
          <dl>
            <Row label="claim handle" value={f.claimHandle} />
            <Row label="bid salt" value={toHex(f.bidSalt)} />
            <Row label="claim secret" value={toHex(f.claimSecret)} />
            <Row label="payout key" value={toHex(f.payoutPrivateKey)} />
          </dl>
          <Notice tone="warn">
            <p>
              These are the live secrets for that bid. Anyone who sees this screen can spend the
              claim. Move somewhere private before continuing.
            </p>
          </Notice>
          <div className="flex gap-2">
            <Link href="/reveal" className="btn-ghost">Go to reveal</Link>
            <Link href="/claim" className="btn-ghost">Go to claim</Link>
          </div>
        </section>
      ))}
    </main>
  );
}
