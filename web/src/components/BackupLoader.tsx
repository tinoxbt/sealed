"use client";

import { useEffect, useState } from "react";
import { load, parseBackup, type BidBackup } from "../lib/backup";

/// Load the bid backup, from this browser or from the downloaded file.
///
/// Secrets are read in the browser and never sent anywhere. The file input
/// exists because a bidder may be on a different machine than the one they bid
/// from, which is normal rather than an error.
export function BackupLoader({ onLoad }: { onLoad: (b: BidBackup) => void }) {
  const [error, setError] = useState("");
  const [stored, setStored] = useState<BidBackup | null>(null);

  useEffect(() => {
    try {
      setStored(load());
    } catch {
      setStored(null);
    }
  }, []);

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
      {error && <p className="text-sm text-[var(--seal)]">{error}</p>}
    </div>
  );
}
