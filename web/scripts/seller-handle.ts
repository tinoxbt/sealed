// Print poseidon(seller_secret, payout_address) for deployment.
//
//   npx tsx scripts/seller-handle.ts 0x<payout_address>
//
// The secret is generated here and printed once. It is never written to disk.
// Losing it means the auction proceeds cannot be claimed by anyone, ever.
import { sellerHandle } from "../src/commitment.js";

/// 31 random bytes, big-endian. Always below the STARK field prime, so no
/// modular reduction and no rejection sampling, and therefore no modulo bias.
/// Same rule the frontend uses for bid_salt and claim_secret.
function randomSecret(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let out = 0n;
  for (const b of bytes) out = (out << 8n) | BigInt(b);
  return out;
}

const payoutArg = process.argv[2];
if (!payoutArg?.startsWith("0x")) {
  console.error("usage: tsx scripts/seller-handle.ts 0x<payout_address>");
  process.exit(1);
}

const payout = BigInt(payoutArg);
const secret = process.env.SEALED_SELLER_SECRET
  ? BigInt(process.env.SEALED_SELLER_SECRET)
  : randomSecret();

const handle = sellerHandle(secret, payout);

console.log("seller_secret         0x" + secret.toString(16));
console.log("seller_payout_address " + payoutArg);
console.log("seller_handle         0x" + handle.toString(16));
console.log("");
console.log("Deploy with:");
console.log("  SEALED_SELLER_HANDLE=0x" + handle.toString(16) + " sh scripts/deploy-sepolia.sh");
console.log("");
console.log("Save the secret and the payout address together, offline.");
console.log("claim_proceeds needs both, and neither can be recovered.");
