"use client";

import { useEffect, useState } from "react";
import { load, parseBackup, type BidBackup } from "../lib/backup";
import { AUCTION_ADDRESS, ACCOUNT_CLASS_HASH } from "../lib/config";
import { derivePayoutAccount } from "../lib/payout";
import { recoverFromChain } from "../lib/recovery";
import { formatStrk, toHex } from "../lib/secrets";

/// Load the bid backup, from this browser or from the downloaded file.
///
/// Secrets are read in the browser and never sent anywhere. The file input
/// exists because a bidder may be on a different machine than the one they bid
/// from, which is normal rather than an error.
export function BackupLoader({ onLoad }: { onLoad: (b: BidBackup) => void }) {
  const [error, setError] = useState("");
  const [stored, setStored] = useState<BidBackup | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    try {
      setStored(load());
    } catch {
      setStored(null);
    }
  }, []);

  /// Rebuild a usable backup from the chain, so a lost file is not the end of
  /// the road on the page where it matters. The payout address is derived from
  /// the recovered private key rather than stored, because the key determines
  /// it and a stored copy could disagree.
  async function unlock() {
    setError("");
    if (!passphrase && !code) {
      setError("Enter the passphrase you set when bidding, or your recovery code.");
      return;
    }
    setBusy("Searching");
    try {
      const found = await recoverFromChain(
        { passphrase: passphrase || undefined, recoveryCode: code || undefined },
        AUCTION_ADDRESS,
        (done, total) => setBusy(`Trying ${done} of ${total}`),
      );
      if (found.length === 0) {
        setError(
          "Nothing in this auction opened with that. Either it is the wrong credential, or the bid was placed before on-chain backups existed.",
        );
        return;
      }
      const f = found[0];
      const payout = derivePayoutAccount(f.payoutPrivateKey);
      onLoad({
        version: 1,
        auction: AUCTION_ADDRESS,
        network: "sepolia",
        createdAt: new Date().toISOString(),
        bidAmountStrk: formatStrk(f.amount),
        bidSalt: toHex(f.bidSalt),
        claimSecret: toHex(f.claimSecret),
        claimHandle: f.claimHandle,
        bidCommitment: "",
        payoutAddress: payout.address,
        payoutPrivateKey: toHex(f.payoutPrivateKey),
        payoutSalt: payout.salt,
        accountClassHash: ACCOUNT_CLASS_HASH,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function readFile(file: File) {
    setError("");
    try {
      onLoad(parseBackup(await file.text()));
    } catch (e) {
      setError(`That file is not a Sealed backup: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-3">
      {stored && (
        <button
          onClick={() => onLoad(stored)}
          className="w-full rounded border border-[var(--line)] bg-[var(--surface)] p-3 text-left hover:border-[var(--line-bright)]"
        >
          <span className="block text-sm">Use the bid saved in this browser</span>
          <span className="block font-mono text-xs text-[var(--faint)] break-all">
            {stored.claimHandle}
          </span>
        </button>
      )}
      <label className="block space-y-1">
        <span className="text-sm text-[var(--muted)]">
          {stored ? "Or load a backup file" : "Load your backup file"}
        </span>
        <input
          type="file"
          accept="application/json"
          onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
          className="block w-full text-sm text-[var(--muted)] file:mr-3 file:rounded file:border-0 file:bg-[var(--surface-2)] file:px-3 file:py-2 file:text-neutral-200"
        />
      </label>
      {!unlocking ? (
        <button
          onClick={() => setUnlocking(true)}
          className="text-sm text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)]"
        >
          Lost the file? Unlock from chain
        </button>
      ) : (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4 space-y-3">
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            Your secrets were encrypted and stored with the bid. Either credential opens them,
            and everything happens in this browser.
          </p>
          <input
            type="password"
            className="input"
            placeholder="Passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <input
            className="input mono"
            placeholder="or recovery code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button onClick={unlock} disabled={!!busy} className="btn-primary">
            {busy || "Unlock"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-[var(--seal)]">{error}</p>}
    </div>
  );
}
