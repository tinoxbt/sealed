import { CallData, ec, hash } from "starknet";
import { ACCOUNT_CLASS_HASH } from "./config";

export type PayoutAccount = {
  privateKey: bigint;
  publicKey: string;
  salt: string;
  address: string;
};

/// Derive a fresh payout account without deploying it.
///
/// The address must exist *before* committing, because it is hashed into
/// `claim_handle` and the contract will only ever pay the address that was
/// committed. An address can hold ERC20 before its account is deployed, so
/// deployment waits until the owner wants to move the funds on.
///
/// Every input to the address is recoverable from `privateKey` alone, and the
/// backup file stores all of them anyway. Losing any one of the private key,
/// the class hash or the salt makes the account undeployable and the funds
/// unreachable, even though the balance is plainly visible on chain.
///
/// The formula is checked against a pinned vector by `scripts/check-payout.ts`,
/// which was in turn validated against a real deployed account. Getting the
/// salt or the constructor calldata wrong yields a perfectly plausible address
/// that nothing can ever be deployed to.
export function derivePayoutAccount(privateKey: bigint): PayoutAccount {
  // getStarkKey wants a hex string padded to 32 bytes, or the curve maths runs
  // on a different scalar than the one stored.
  const pkHex = `0x${privateKey.toString(16).padStart(64, "0")}` as const;
  const publicKey = ec.starkCurve.getStarkKey(pkHex);

  // Salt is the public key. Any value works so long as deployment later uses
  // the same one, and deriving it from the key means the backup cannot hold a
  // key whose salt has gone missing.
  const salt = publicKey;

  const address = hash.calculateContractAddressFromHash(
    salt,
    ACCOUNT_CLASS_HASH,
    CallData.compile({ publicKey }),
    0,
  );
  return { privateKey, publicKey, salt, address };
}
