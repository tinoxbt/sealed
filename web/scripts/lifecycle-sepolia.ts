/// Drive a whole auction on Sepolia and assert the invariants against a real
/// network rather than a test harness.
///
///   npx tsx scripts/lifecycle-sepolia.ts
///
/// Deploys a fresh short-window auction, then runs three bidders through it:
///
///   A bids 0.8 and reveals   -> wins, pays the clearing price
///   B bids 0.5 and reveals   -> loses, takes the full collateral back
///   C bids 0.9 and goes dark -> forfeits to the seller
///
/// Second-price means the winner pays B's 0.5, not their own 0.8. C's silence
/// is what makes forfeiture worth demonstrating: an unrevealed bid that would
/// have won is still worth nothing.
///
/// Expected settlement, with 3 STRK in:
///   A  1.0 - 0.5 = 0.5     B  1.0     seller  0.5 + 1.0 = 1.5
///
/// Everything runs from the deployer account through the plain `commit` path.
/// The pool is not involved: this tests the auction, not the privacy leg, and
/// the privacy leg already passed its own gate.
import { readFileSync } from "node:fs";
import { Account, RpcProvider, hash } from "starknet";
import { bidCommitment, claimHandle } from "../src/commitment.js";

const RPC = process.env.SEALED_RPC ?? "https://api.cartridge.gg/x/starknet/sepolia";
/// Must track the deployed class. A stale hash here silently exercises an
/// older contract and reports green against code nobody is shipping.
const CLASS_HASH = process.env.SEALED_CLASS_HASH ??
  "0x41d1ca82df89aec29334c41c5c37c724a91b231fec971fcc0f457de2c6809b1";
const TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

const STRK = (n: string) => BigInt(Math.round(parseFloat(n) * 1e6)) * 10n ** 12n;
const fmt = (v: bigint) => (Number(v / 10n ** 12n) / 1e6).toFixed(4);
const lo = (v: bigint) => "0x" + (v & ((1n << 128n) - 1n)).toString(16);
const hi = (v: bigint) => "0x" + (v >> 128n).toString(16);
const hex = (v: bigint) => "0x" + v.toString(16);

const COLLATERAL = STRK("1");
const RESERVE = STRK("0.1");
const OPEN_FOR = Number(process.env.SEALED_OPEN_FOR ?? 180);
// The contract enforces a 600s floor on the reveal window, so a seller
// cannot set one nobody can meet. Test runs sit just above it.
const REVEAL_FOR = Number(process.env.SEALED_REVEAL_FOR ?? 660);

function rand(): bigint {
  const b = new Uint8Array(31);
  crypto.getRandomValues(b);
  let out = 0n;
  for (const x of b) out = (out << 8n) | BigInt(x);
  return out;
}

function deployer(provider: RpcProvider): Account {
  const path = `${process.env.HOME}/.starknet_accounts/starknet_open_zeppelin_accounts.json`;
  const a = JSON.parse(readFileSync(path, "utf8"))["alpha-sepolia"]["sealed-deployer"];
  return new Account({ provider, address: a.address, signer: a.private_key });
}

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

function check(label: string, actual: bigint | string | number, expected: bigint | string | number) {
  const ok = String(actual) === String(expected);
  log(`${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
  if (!ok) throw new Error(`${label} mismatch`);
}

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC });
  const account = deployer(provider);
  log("deployer", account.address);

  // Seller identity uses the same handle mechanism as a bidder.
  const sellerSecret = rand();
  // Deliberately NOT the deployer. Fees are paid in STRK by the account that
  // sends the transactions, so measuring proceeds on that same account mixes
  // the payout with the gas bill and the assertion cannot be exact.
  const sellerPayout = BigInt(hash.computePoseidonHashOnElements([rand()]));
  const sellerHandle = claimHandle(sellerSecret, sellerPayout);

  const now = Math.floor(Date.now() / 1000);
  const close = now + OPEN_FOR;
  const deadline = close + REVEAL_FOR;

  log("deploying a fresh auction");
  const { transaction_hash: deployTx, contract_address } = await account.deployContract({
    classHash: CLASS_HASH,
    constructorCalldata: [
      hex(sellerHandle), TOKEN, POOL,
      lo(RESERVE), hi(RESERVE),
      lo(COLLATERAL), hi(COLLATERAL),
      String(close), String(deadline),
    ],
  });
  await provider.waitForTransaction(deployTx);
  const auction = Array.isArray(contract_address) ? contract_address[0] : contract_address;
  log("auction", auction);
  log(`open until ${new Date(close * 1000).toISOString().slice(11, 19)}, reveal until ${new Date(deadline * 1000).toISOString().slice(11, 19)}`);

  const call = async (entrypoint: string, calldata: string[]) => {
    const r = await account.execute([{ contractAddress: auction, entrypoint, calldata }]);
    await provider.waitForTransaction(r.transaction_hash);
    return r.transaction_hash;
  };
  const read = async (entrypoint: string, calldata: string[] = []) =>
    provider.callContract({ contractAddress: auction, entrypoint, calldata });
  const u256 = async (entrypoint: string) => {
    const r = await read(entrypoint);
    return BigInt(r[0]) + (BigInt(r[1]) << 128n);
  };
  const strkBalance = async (who: string) => {
    const r = await provider.callContract({
      contractAddress: TOKEN, entrypoint: "balance_of", calldata: [who],
    });
    return BigInt(r[0]) + (BigInt(r[1]) << 128n);
  };

  // Three bidders. Payout addresses are arbitrary and need not be deployed:
  // ERC20 balances are storage, so an address can hold tokens before it exists
  // as an account.
  const bidders = [
    { name: "A", amount: STRK("0.8"), reveals: true },
    { name: "B", amount: STRK("0.5"), reveals: true },
    { name: "C", amount: STRK("0.9"), reveals: false },
  ].map((b) => {
    const secret = rand();
    const salt = rand();
    const payout = BigInt(hash.computePoseidonHashOnElements([rand()])); // stand-in address
    const handle = claimHandle(secret, payout);
    return {
      ...b, secret, salt, payout, handle,
      commitment: bidCommitment({ low: b.amount & ((1n << 128n) - 1n), high: b.amount >> 128n }, salt, handle),
    };
  });

  log("approving 3 STRK to the auction");
  const appr = await account.execute([{
    contractAddress: TOKEN, entrypoint: "approve",
    calldata: [auction, lo(COLLATERAL * 3n), hi(COLLATERAL * 3n)],
  }]);
  await provider.waitForTransaction(appr.transaction_hash);

  for (const b of bidders) {
    await call("commit", [hex(b.commitment), hex(b.handle)]);
    log(`committed ${b.name}`);
  }

  check("commitment_count", Number(BigInt((await read("get_commitment_count"))[0])), 3);
  check("escrowed", fmt(await u256("get_escrowed")), fmt(COLLATERAL * 3n));
  check("contract balance equals escrowed", fmt(await strkBalance(auction)), fmt(COLLATERAL * 3n));

  // Invariant 3 depends on the window, so wait for it rather than faking time.
  const waitUntil = async (ts: number, what: string) => {
    while (Math.floor(Date.now() / 1000) < ts) {
      log(`waiting ${ts - Math.floor(Date.now() / 1000)}s for ${what}`);
      await new Promise((r) => setTimeout(r, 20_000));
    }
  };
  await waitUntil(close + 15, "the reveal window");

  for (const b of bidders.filter((x) => x.reveals)) {
    await call("reveal", [lo(b.amount), hi(b.amount), hex(b.salt), hex(b.handle)]);
    log(`revealed ${b.name} at ${fmt(b.amount)}`);
  }
  check("revealed_count", Number(BigInt((await read("get_revealed_count"))[0])), 2);

  await waitUntil(deadline + 15, "settlement");

  await call("settle", []);
  const clearing = await u256("get_clearing_price");
  const winner = BigInt((await read("get_winner_handle"))[0]);

  // Second-price: A wins but pays B's bid, not their own.
  check("winner is A", hex(winner), hex(bidders[0].handle));
  check("clearing price is B's bid", fmt(clearing), fmt(STRK("0.5")));

  check("A status", (await read("get_entry_status", [hex(bidders[0].handle)]))[0], "0x3"); // Won
  check("B status", (await read("get_entry_status", [hex(bidders[1].handle)]))[0], "0x4"); // Lost
  check("C status", (await read("get_entry_status", [hex(bidders[2].handle)]))[0], "0x5"); // Forfeited

  // settle is idempotent, invariant 6, and free to prove here.
  await call("settle", []);
  check("clearing unchanged after second settle", fmt(await u256("get_clearing_price")), fmt(clearing));

  for (const b of bidders.filter((x) => x.reveals)) {
    await call("claim", [hex(b.secret), hex(b.payout)]);
    const got = await strkBalance(hex(b.payout));
    const want = b.name === "A" ? COLLATERAL - clearing : COLLATERAL;
    check(`${b.name} received`, fmt(got), fmt(want));
  }

  await call("claim_proceeds", [hex(sellerSecret), hex(sellerPayout)]);
  // Clearing price plus every forfeited collateral, and C forfeited one.
  check("seller received", fmt(await strkBalance(hex(sellerPayout))), fmt(clearing + COLLATERAL));

  // Invariant 10: once only.
  let secondClaimReverted = false;
  try {
    await call("claim_proceeds", [hex(sellerSecret), hex(sellerPayout)]);
  } catch {
    secondClaimReverted = true;
  }
  check("second claim_proceeds rejected", secondClaimReverted, true);

  const left = await strkBalance(auction);
  check("contract drained", fmt(left), fmt(0n));
  check("escrowed still records the total", fmt(await u256("get_escrowed")), fmt(COLLATERAL * 3n));

  log("");
  log("full lifecycle passed on Sepolia");
  log("auction", auction);
}

main().catch((e) => {
  console.error("LIFECYCLE FAILED:", e.message);
  process.exit(1);
});
