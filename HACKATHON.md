# STRK20 Private Sprint: the rules Sealed is built against

Source: https://github.com/starkience/strk20-hackathon (README and CONTRIBUTING, read 14 August 2026).
This file is a local copy so scope and priority decisions can be made offline. The upstream repository is authoritative if the two ever disagree.

## Timeline

| Date | |
| --- | --- |
| 14 August 2026 | Applications and hacking open |
| 31 August 2026, 23:59 UTC | Submissions close |
| 4 September 2026 | Winners announced |

Prize pool is 5,000 USD paid in STRK: 2,500 first, 1,500 second, 1,000 third.

## Judging, and what it means for priorities

| Weight | Criterion | What it means here |
| --- | --- | --- |
| 30% | STRK20 integration depth: shielded balances, private transfers, anonymizer contracts, the SDK, stealth accounts | The sub-account work is not a side quest. It is the single highest scoring axis and it is the part of Sealed that is least proven. |
| 30% | Working mainnet product: it runs, on mainnet, for a real user | A perfect contract with no mainnet deployment scores zero here. Mainnet by day 13, per the plan. |
| 25% | Innovation | Second-price plus uniform collateral is the differentiator. No other registered project is a sealed-bid auction. |
| 15% | Documentation and open-source quality | PRIVACY.md, MECHANISM.md, README, license. Cheap points, fully under our control, so do not leave them to the last day. |

If another team depends on something published here, that counts in our favour. HELPER_CUSTODY.md is the most likely candidate.

## Hard requirements

- Public repository, open-source, with a license.
- The app runs on Starknet mainnet against the live STRK20 pool.
- At least three mainnet transactions that touched the pool, listed by hash in `strk20.json`.
- A public demo URL that resolves for someone who is not logged in.
- A 3-minute demo video.
- One payout address per winning team.

## Registration

One pull request, ever, appending a single object to `registry.json` upstream:

```json
{ "repo_url": "https://github.com/tinoxbt/sealed", "telegram": ["tinoxbt"] }
```

Merge conflicts on that PR are expected and should be left alone. A bot rebases the branch. Do not resolve them by hand and do not modify anyone else's entry.

Registration unlocks nothing. It only decides when the project appears on the hub. Everything after it is read from this repository automatically every 30 minutes.

## Submission mechanics

There is nothing to submit. Whatever this repository shows at the deadline is the entry. Scoring reads `strk20.json` at the repository root:

```json
{
  "transactions": ["0x...", "0x...", "0x..."],
  "contracts": ["0x..."],
  "demo_video": "https://youtu.be/...",
  "demo_url": "https://..."
}
```

- `transactions`: at least three mainnet hashes. Each is checked on chain: it must exist, must have succeeded, and must have touched the STRK20 pool. Hashes rather than an address, because private transactions are relayed and the on-chain sender is never you.
- `contracts`: deployed addresses, checked against mainnet and Sepolia, displayed with the network they were found on.
- `demo_video`: the 3-minute video.
- `demo_url`: only needed if the demo is not detected automatically. Detection order is `demo_url`, then GitHub Pages, then the repository Website field, then the latest reported deployment. Setting the Website field is the reliable one-click option.

The hub shows which pieces are still missing, so nothing should be a surprise on the last day.

## Rules that constrain how we work

- Accuracy is scored. The guidelines say to be especially precise about what is and is not private, because overclaiming costs marks on integration depth. This is the same instruction as the honest privacy model in `docs/ARCHITECTURE.md` section 8, arriving from the other direction.
- No secrets committed, ever. Placeholder values only for keys, addresses, and endpoints.
- Everything linked must resolve publicly. Link-check before the deadline.
- Ideas are not exclusive. Several teams building the same idea is explicitly fine.

## Where Sealed sits on the registry

21 projects registered at the time of writing. The nearest neighbours are Veilcast (private prediction markets), offbook (private OTC and RFQ settlement), and Veyl (private trading terminal). No registered project is a sealed-bid auction. The official Request for Startups list includes sealed-bid auctions as an unclaimed problem.

Note that the RFP describes bids as encrypted notes, invisible even to the auctioneer, with no commit-reveal. Sealed deliberately does not attempt that. The scope boundary in `docs/ARCHITECTURE.md` section 8 explains why, and says so in public rather than implying the stronger property.

## The demo video, storyboarded against the weights

Three minutes, and integration depth is the axis with the most headroom. The full STRK20 loop is already in the architecture at both ends, so showing it costs nothing extra once the app works. Show it rather than describing it.

| Time | Shot | Which weight it serves |
| --- | --- | --- |
| 0:00 to 0:20 | The problem in one sentence: a second-price auction only produces honest bids if the bids are genuinely sealed, and on a public chain the escrow leg gives the bid away before anyone reveals. | Innovation |
| 0:20 to 0:50 | Bidder one, full path on screen: main wallet, shield, private transfer into a fresh bid sub-account. Show that the sub-account has no public link back to the main wallet. | Integration depth |
| 0:50 to 1:20 | Three bidders commit. Point at the chain: three identical collateral transfers, three commitments, no amounts, no addresses that resolve to a person. This is the uniform collateral doing its job. | Integration depth, innovation |
| 1:20 to 1:45 | Close, then reveals land. Second-price settlement executes and the clearing price is the second-highest bid. | Working product |
| 1:45 to 2:20 | Each party claims to a fresh payout sub-account, then re-shields into the pool. Both ends of the flow are STRK20. | Integration depth |
| 2:20 to 2:40 | The forfeiture branch, deliberately: one bidder who never revealed, collateral assigned to the seller. Not an edge case, it is the anti-griefing mechanism. | Innovation |
| 2:40 to 3:00 | What is visible on chain, said out loud, including the clearing price and the winner's identifiable claim size. Then the mainnet transaction hashes. | Documentation, working product |

Two rules for the recording. Say what leaks while showing the thing that leaks, because the guidelines score accuracy and a judge who spots an unmentioned leak discounts everything else. And do not narrate over a screen recording of Sepolia while implying mainnet.

The live auction for the judging call is the closing argument, per section 15 of the architecture. No other registered project can put the panel inside the product.

## Resources

- Day 0, first mainnet transaction: https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md
- Awesome STRK20: https://github.com/Akashneelesh/awesome-strk20
- STRK20 starter kit: https://github.com/Akashneelesh/strk20-starter-kit
- Privacy SDK: https://github.com/starkware-libs/starknet-privacy
- STRK20 by example: https://strk20-by-example.org/what-is-strk20
- Build on STRK20: https://strk20.starknet.io/build

Questions during the sprint go to issues on the upstream repository. The STRK20 team reads them daily.
