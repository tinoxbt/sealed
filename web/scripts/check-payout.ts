/// Pin the payout address derivation.
///
/// The formula here was validated against a real deployed Sepolia account:
/// feeding that account's stored salt and class hash reproduced its on-chain
/// address exactly. This script freezes the result for a fixed key so a future
/// change to the salt, the constructor calldata or the class hash fails loudly.
///
/// A wrong derivation does not throw. It produces a valid-looking address that
/// receives funds and can never be deployed to, which is unrecoverable.
import { derivePayoutAccount } from "../src/lib/payout.js";

// Not a secret. Never funded, never deployed, exists only to pin the maths.
const TEST_KEY = 0x1234567890abcdefn;

const EXPECTED_PUBLIC_KEY = "0x2abbefdcbf731195ee2acd186441eb536e86f888327b3655cffbd07b57dbf26";
const EXPECTED_ADDRESS = "0x6909d922b9209cd41951a5048c4d0e347ab357c22abb013765ea485b12cf154";

const a = derivePayoutAccount(TEST_KEY);

const norm = (x: string) => BigInt(x).toString(16);
if (norm(a.publicKey) !== norm(EXPECTED_PUBLIC_KEY)) {
  throw new Error(`public key drifted: ${a.publicKey}`);
}
if (norm(a.address) !== norm(EXPECTED_ADDRESS)) {
  throw new Error(`payout address drifted: ${a.address}`);
}
if (norm(a.salt) !== norm(a.publicKey)) {
  throw new Error("salt is no longer the public key, deployment would need the old salt");
}
console.log("payout derivation unchanged");
