import { RpcProvider } from "starknet";

/// Sepolia RPC. Keyless by default so the app runs with no configuration, and
/// overridable for anyone who would rather use their own node.
///
/// Reads only. Every transaction goes through the wallet, which does its own
/// proving and submission, so this endpoint never sees a signature.
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.cartridge.gg/x/starknet/sepolia";

export const provider = new RpcProvider({ nodeUrl: RPC_URL });
