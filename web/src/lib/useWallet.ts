"use client";

import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { useEffect, useState } from "react";
import { WalletAccountV6, validateAndParseAddress, walletV6 } from "starknet";
import { provider } from "./provider";
import { isSepolia } from "./wallet";

/// Shared across the bid, reveal and claim pages.
///
/// Deliberately does not read the shielded balance: reveal and claim never
/// touch the pool, so an account with no viewing key can still use them.
export function useWallet() {
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>([]);
  const [account, setAccount] = useState<WalletAccountV6 | null>(null);
  const [address, setAddress] = useState("");
  const [onSepolia, setOnSepolia] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const store: Store = createStore({ eip1193Adapters: [] });
    setWallets(store.getWallets().slice());
    return store.subscribe((next) => setWallets(next.slice()));
  }, []);

  async function connect(wallet: WalletWithStarknetFeatures) {
    setConnecting(true);
    try {
      const wa = await WalletAccountV6.connect(provider, wallet);
      const accounts = await walletV6.requestAccounts(wallet);
      if (!Array.isArray(accounts)) throw new Error("Wallet is not compatible");
      setAccount(wa);
      setAddress(validateAndParseAddress(accounts[0]));
      setOnSepolia(isSepolia((await walletV6.requestChainId(wallet)) as string));
    } finally {
      setConnecting(false);
    }
  }

  return { wallets, account, address, onSepolia, connecting, connect };
}
