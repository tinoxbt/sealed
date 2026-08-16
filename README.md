# Sealed

A deployable Vickrey variant of RFP-08 on Starknet. Bidder identities stay unlinkable, bid values stay hidden until reveal, every bidder locks identical STRK20-funded collateral, and failing to reveal forfeits it to the seller.

Private bidder identity and private payout routing. Public settlement outcome.

## What Sealed is

A single-item, single-round, sealed-bid auction that settles at the second-highest price.

A bid is funded straight out of a bidder's shielded STRK20 balance: the pool moves the collateral to the auction contract and calls it, in one transaction submitted by a relayer, so no bidder-controlled address appears in the commit at all. Each bidder submits a Poseidon commitment to their bid rather than the bid itself, and escrows a collateral amount that is identical for every bidder. After the auction closes, bidders reveal. The highest valid bid wins and pays the second-highest valid bid, or the reserve price if only one bid was valid.

Two properties are engineered separately, because conflating them is how this kind of design fails:

- **Who is bidding** is hidden by the STRK20 pool. The commit's on-chain caller is the pool itself.
- **What they bid** is hidden by the commitment scheme and by the uniform collateral.

The uniform collateral is the part that is easy to get wrong. If each bidder escrowed an amount proportional to their bid, the public ERC20 transfer would leak the bid before anyone revealed anything. Every bidder therefore escrows exactly the same amount, and bids are capped at that amount.

Second-price is not decoration either. Under a sealed-bid second-price rule, bidding your true value is the dominant strategy, so the mechanism only produces honest bids if the bids are genuinely sealed. Privacy is what makes the mechanism work rather than a feature bolted onto it.

## Privacy model

Stated plainly, including the parts that leak. The full version, including the third parties in the path, lives in [`docs/PRIVACY.md`](docs/PRIVACY.md).

**Hidden:** which real person is behind any bidder, and every bid amount until that bidder reveals it.

**Visible:** that the auction exists, the reserve price, the collateral amount, the number of commitments and the timing of each, the pool as the source of every collateral transfer, every revealed amount once the reveal window opens, the clearing price, each claim amount, and each payout address once claimed.

**What unlinkability does and does not mean here.** The commit carries no bidder address, because the pool is its caller and a rotating relayer submits it. The chain sees the pool funding an entry and cannot see which shielded balance paid. This rests entirely on the pool's anonymity set: a bidder who shields moments before bidding, or bids while nobody else is using the pool, gets much less than this. Sealed does not claim a position cannot be tracked. It claims a position cannot be traced to a person, as far as the pool carries it.

Known limits:

- Bids cannot exceed the collateral.
- Shielding immediately before committing creates a timing link. The interface warns about this.
- After the reveal window opens, all revealed bids are public. That is what a sealed-bid auction promises offline, and nothing more.
- Claim amounts are visible, so after settlement the winning payout address is identifiable as the winner's. It remains unlinked to a main wallet if it is re-shielded.
- Sealed settles money, not delivery. The contract has no view of whether the seller ships the item.

Determining a winner without any bid ever being revealed would need a ZK circuit proving the winning bid was highest and the clearing price second-highest without disclosing either. STRK20 does not provide that automatically. It is documented as future work and is not attempted this sprint.

## Custody

The pool handles identity and value transport. The auction contract handles custody as ordinary ERC20.

```
main wallet
    |  shield, well ahead of the auction
    v
STRK20 pool
    |
    |  ONE transaction, submitted by a relayer:
    |    withdraw  uniform collateral -> auction contract
    |    invoke    auction.privacy_invoke(bid_commitment, claim_handle)
    v
Sealed auction contract        ordinary ERC20 custody
    |  settle, then per-entry claim to the address
    |  committed inside claim_handle
    v
fresh payout account
    |  re-shield
    v
STRK20 pool
```

`settle` moves no money. It records the winner and the clearing price. All value leaves through individual `claim` calls, each authorised by a secret whose payout address was committed in advance.

## Build status

Day 2 of 17. Deployed to Sepolia, and the day 3 gate has passed.

| Piece | Status |
| --- | --- |
| Architecture and scope locked | Done, `docs/ARCHITECTURE.md` |
| Repository, license, registration | Done |
| Toolchain pinned, Scarb 2.20.0 and snforge 0.63.0 | Done |
| Poseidon parity between Cairo and starknet.js | Done, shared fixture asserted on both sides |
| Auction contract: commit, privacy_invoke, reveal, settle, claim | Done, 369 lines of code plus 156 of comment |
| snforge tests covering all twelve invariants | Done, 31 passing, 2 fuzzed |
| Auction deployed to Sepolia | Done, `0x04a7999f...6b319138` |
| Day 3 gate: a composed withdraw plus privacy_invoke funds a commitment on Sepolia | **Passed**, `0x3e27d50c...817dc719` |
| Frontend: bid, reveal, claim, settle and seller proceeds | Done, all four roles |
| Full lifecycle exercised on Sepolia | Done, `scripts/lifecycle-sepolia.ts`, auction `0x3d838d8d...160ba58c` |
| Mainnet deployment and a live auction | Not started, prepared in `docs/MAINNET.md` |
| PRIVACY.md, MECHANISM.md, HELPER_CUSTODY.md | Done |
| Demo video | Not started |

Mainnet transaction hashes and deployed contract addresses will appear in `strk20.json` and in this section as they land.

## Repository

```
contracts/   Cairo 2, Scarb, snforge tests
web/         Next.js frontend
scripts/     Declare, deploy, seed a demo auction
docs/        ARCHITECTURE.md, PRIVACY.md, MECHANISM.md, HELPER_CUSTODY.md
             MAINNET.md, HANDOFF.md
             reference/  Offline copies and research notes
CLAUDE.md    Working constraints and non-negotiables
HACKATHON.md Sprint rules, judging weights, submission requirements
strk20.json  Sprint submission manifest
```

Built for the STRK20 Private Sprint, 14 to 31 August 2026.

## License

Apache 2.0. See `LICENSE`.
