/// Reveal bids on behalf of bidders who asked someone else to do it.
///
///   npx tsx scripts/keeper.ts ./payloads
///
/// Borrowed from the fixed-rate lending auctions that run on Ethereum at
/// scale, where protocol keepers push the reveals rather than requiring every
/// participant to appear inside the reveal window. Sealed needs
/// no contract change to do the same: `reveal` verifies the salt against the
/// commitment and never checks who sent the transaction, so anyone holding the
/// payload can submit it and the result is identical.
///
/// What this fixes: a bidder asleep when the window opens forfeits their entire
/// collateral. Forfeiture is meant to price strategic silence, not to punish
/// people in the wrong time zone, and it cannot tell the two apart.
///
/// ## What delegating costs the bidder
///
/// Whoever runs this learns the bid as soon as they hold the payload, which is
/// before the rest of the world learns it at reveal. That is a real loss of
/// confidentiality and it is the same trade Term makes. It is opt in, per bid,
/// and a bidder who would rather keep their number to themselves simply reveals
/// it themselves.
///
/// It cannot steal anything. The payload contains `bid_salt`, never
/// `claim_secret`, so a hostile keeper can reveal a bid early or refuse to
/// reveal it at all, and can never touch the collateral. Those two secrets are
/// separate precisely so that handing one to someone is survivable.
///
/// A bidder who suspects the keeper has dropped them can always reveal
/// themselves, right up to the deadline. Both paths write the same entry, and
/// the second one to arrive is rejected as already revealed.
import { readFileSync, readdirSync } from "node:fs";
import { Account, RpcProvider } from "starknet";

const RPC = process.env.SEALED_RPC ?? "https://api.cartridge.gg/x/starknet/sepolia";
const POLL_SECONDS = Number(process.env.SEALED_KEEPER_POLL ?? 60);

type Payload = {
  auction: string;
  bidAmountStrk: string;
  bidSalt: string;
  claimHandle: string;
};

const lo = (v: bigint) => "0x" + (v & ((1n << 128n) - 1n)).toString(16);
const hi = (v: bigint) => "0x" + (v >> 128n).toString(16);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

function parseStrk(input: string): bigint {
  const [whole, frac = ""] = input.trim().split(".");
  return BigInt(whole || "0") * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

/// The keeper's own account. It pays gas and nothing else: it holds no bidder
/// funds and no claim secret at any point.
function keeperAccount(provider: RpcProvider): Account {
  const path =
    process.env.SEALED_ACCOUNTS ??
    `${process.env.HOME}/.starknet_accounts/starknet_open_zeppelin_accounts.json`;
  const name = process.env.SEALED_ACCOUNT ?? "sealed-deployer";
  const a = JSON.parse(readFileSync(path, "utf8"))["alpha-sepolia"][name];
  return new Account({ provider, address: a.address, signer: a.private_key });
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: tsx scripts/keeper.ts <directory of bid backup JSON files>");
    process.exit(1);
  }

  const payloads: Payload[] = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as Payload)
    .filter((p) => p.auction && p.bidSalt && p.claimHandle);

  if (payloads.length === 0) {
    log("no payloads found, nothing to do");
    return;
  }
  log(`watching ${payloads.length} bid(s)`);

  const provider = new RpcProvider({ nodeUrl: RPC });
  const account = keeperAccount(provider);
  const done = new Set<string>();

  while (done.size < payloads.length) {
    for (const p of payloads) {
      const id = `${p.auction}:${p.claimHandle}`;
      if (done.has(id)) continue;

      try {
        // The contract is the only source of truth for the phase. A keeper
        // working from its own clock would submit early and waste gas, or late
        // and forfeit the bid it was asked to protect.
        const status = await provider.callContract({
          contractAddress: p.auction,
          entrypoint: "get_entry_status",
          calldata: [p.claimHandle],
        });
        const state = Number(BigInt(status[0]));

        const timing = await provider.callContract({
          contractAddress: p.auction,
          entrypoint: "get_timing",
          calldata: [],
        });
        const close = Number(BigInt(timing[0]));
        const deadline = Number(BigInt(timing[1]));
        const now = Math.floor(Date.now() / 1000);

        // 0 Unknown, 1 Committed, 2 Revealed, and beyond that it is settled.
        if (state === 0) {
          // No such entry. Before close it may simply not have been committed
          // yet, but commits are refused after close, so it never will be and
          // waiting for it would spin forever.
          if (now >= close) {
            log(`${id.slice(0, 24)}... no such entry and bidding has closed, dropping`);
            done.add(id);
          }
          continue;
        }
        if (state !== 1) {
          log(`${id.slice(0, 24)}... already revealed or settled, nothing to do`);
          done.add(id);
          continue;
        }

        if (now < close) continue;
        if (now >= deadline) {
          // Nothing can be done now, and saying so is more useful than silence.
          log(`${id.slice(0, 24)}... MISSED, the reveal deadline has passed`);
          done.add(id);
          continue;
        }

        const amount = parseStrk(p.bidAmountStrk);
        const res = await account.execute([
          {
            contractAddress: p.auction,
            entrypoint: "reveal",
            calldata: [lo(amount), hi(amount), p.bidSalt, p.claimHandle],
          },
        ]);
        await provider.waitForTransaction(res.transaction_hash);
        log(`revealed ${id.slice(0, 24)}... ${p.bidAmountStrk} STRK  ${res.transaction_hash}`);
        done.add(id);
      } catch (e) {
        // One bad payload must not stop the others. A bidder relying on this
        // has no other protection running.
        log(`${id.slice(0, 24)}... failed, will retry: ${(e as Error).message.slice(0, 120)}`);
      }
    }

    if (done.size < payloads.length) {
      await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
    }
  }
  log("every watched bid is resolved");
}

main().catch((e) => {
  console.error("keeper failed:", e.message);
  process.exit(1);
});
