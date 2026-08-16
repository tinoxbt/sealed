# Mainnet checklist

Everything that must be true before Sealed touches real money, in the order it must be true.

The sprint requires a mainnet deployment and mainnet transaction hashes, and 30 percent of the score is a working product on mainnet. This is the step that earns it. It is also the step where a mistake costs real funds and cannot be undone, so it is written down in advance rather than improvised at 2am on the deadline.

**Nothing here has been run.** Sepolia is fully exercised; mainnet is not.

---

## Verified addresses

Checked on 16 August 2026 by calling the contracts on mainnet, not by copying a link.

| What | Address | How it was checked |
| --- | --- | --- |
| STRK token | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | `symbol()` returns `"STRK"` |
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` | `get_screener_public_key()` returns a non-zero key, so it is a real pool with screening enforced |

The token address is the same on Sepolia and mainnet. The pool address is **not**, and passing the Sepolia pool to a mainnet constructor would produce an auction that no bid can ever fund, because `privacy_invoke` checks the caller against the stored pool.

---

## Before deploying

**1. A funded mainnet account, freshly created for this.** Never reuse a key that has touched anything else. Create with `sncast account create --name sealed-mainnet --network mainnet`, fund it, then `sncast account deploy`. Budget a few STRK for fees plus whatever the demo auction needs.

**2. A seller secret you will not lose.** Generate with `cd web && npx tsx scripts/seller-handle.ts 0x<mainnet_payout_address>`. Save the secret and the payout address together, offline. `claim_proceeds` needs both and neither can be recovered. The first Sepolia deployment lost its secret to a terminal scrollback, which cost nothing there and would cost the entire proceeds here.

**3. A payout address you control on mainnet.** Not a counterfactual address unless you are certain you can deploy it. The proceeds go there and nowhere else.

**4. A 0.10-capable RPC.** `sncast` rejects anything advertising 0.9.0, which rules out the keyless endpoint the frontend reads from. `https://api.zan.top/public/starknet-mainnet/rpc/v0_10` is the default; confirm it answers `starknet_specVersion` before starting.

**5. Green tests, and a clean tree.** `snforge test` in `contracts/`, then `git status`.

---

## Deploying

```sh
SEALED_SELLER_HANDLE=0x... sh scripts/deploy-mainnet.sh
```

The script requires typing `MAINNET` to proceed, prints the parameters first, and defaults to a 1 STRK collateral with a 5 day bidding window and a 1 day reveal window. Those defaults are deliberate: the collateral caps every bid, so it also caps what any participant can lose, and the windows leave room for judges to bid without racing a clock.

---

## After deploying

**1. Verify the constructor took.** Call `get_timing`, `get_collateral`, `get_reserve_price` and `get_state` and check each against what was passed. A wrong close time cannot be fixed; the contract has no admin key and no upgrade path, by design.

**2. Point the frontend at it.** `web/src/lib/config.ts` needs the new `AUCTION_ADDRESS` and the **mainnet** `POOL_ADDRESS`. Also change `ACCOUNT_CLASS_HASH` only if the OpenZeppelin account class used on Sepolia is not deployed on mainnet; verify before assuming, because payout addresses are derived from it and an undeployable class swallows the payout permanently.

**3. Record the hashes.** `strk20.json` needs the declare and deploy transaction hashes and the contract address. The README build status table needs the same. These are what the sprint is graded on.

**4. Place one real bid yourself, end to end.** Shield, bid, and confirm `commitment_count` and `escrowed` move. Do this before inviting anyone else. The Sepolia gate proves the mechanism; it does not prove the mainnet pool address is right.

**5. Leave the auction open for the judging call.** A live auction the panel can bid in is the closing argument, per `ARCHITECTURE.md` section 15.

---

## What can still go wrong

**The mainnet pool may behave differently from Sepolia's.** The Sepolia pool is v2.0; confirm the mainnet one exposes the same `privacy_invoke` dispatch before relying on it. The gate passed on Sepolia and that is evidence, not proof.

**Wallet support differs by network.** Ready failed on Sepolia and Xverse worked. Both are documented as live on mainnet, so mainnet is likely to be better rather than worse, but test with the wallet you intend to demo with.

**Screening applies to every deposit.** A bidder whose address fails FPI screening cannot shield, and therefore cannot bid. Nothing in Sealed can route around that, and it is worth saying to anyone invited to the demo.

**Fees are paid in STRK, the same token being auctioned.** Do not measure a payout on the account paying the fees. That mistake produced two false failures on Sepolia; on mainnet it would produce a false alarm during a demo.
