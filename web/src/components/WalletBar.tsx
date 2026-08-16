"use client";

import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";

export function WalletBar({
  wallets,
  address,
  onSepolia,
  connecting,
  connect,
}: {
  wallets: WalletWithStarknetFeatures[];
  address: string;
  onSepolia: boolean;
  connecting: boolean;
  connect: (w: WalletWithStarknetFeatures) => void;
}) {
  if (address) {
    return (
      <p className="font-mono text-xs text-neutral-500 break-all">
        {address}
        {!onSepolia && <span className="ml-2 text-amber-300">switch to Sepolia</span>}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-neutral-400">
        Connect any Starknet wallet. Revealing and claiming never touch the privacy pool, so
        the wallet does not need privacy support and the account does not need to be registered.
      </p>
      <div className="flex flex-wrap gap-2">
        {wallets.length === 0 && <span className="text-sm text-neutral-500">No wallet detected.</span>}
        {wallets.map((w) => (
          <button
            key={w.name}
            onClick={() => connect(w)}
            disabled={connecting}
            className="rounded bg-neutral-800 px-4 py-2 hover:bg-neutral-700 disabled:opacity-40"
          >
            {w.name}
          </button>
        ))}
      </div>
    </div>
  );
}
