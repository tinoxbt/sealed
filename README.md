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

**What unlinkability does and does not mean here.** No bidder-controlled address appears at any phase. Bidding, revealing and claiming all go through the pool, so the auction's caller is always the pool and a rotating relayer always submits. The chain sees the pool funding an entry and cannot see which shielded balance paid. This rests entirely on the pool's anonymity set: a bidder who shields moments before bidding, or bids while nobody else is using the pool, gets much less than this. Sealed does not claim a position cannot be tracked. It claims a position cannot be traced to a person, as far as the pool carries it.

Known limits:

- Bids cannot exceed the collateral.
- Shielding immediately before committing creates a timing link. The interface warns about this.
- Your own wallet is visible once, when you shield. That is how anyone enters the pool and no route avoids it.
- The pool records the withdrawing account encrypted to a governance-appointed auditor, decryptable under a lawful request. This is the pool's compliance design, described in `docs/PRIVACY.md`.
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

Day 4 of 17. Everything below is Sepolia. Mainnet has not been touched.

| Piece | Status |
| --- | --- |
| Architecture and scope locked | Done, `docs/ARCHITECTURE.md` |
| Repository, license, registration | Done |
| Toolchain pinned, Scarb 2.20.0 and snforge 0.63.0 | Done |
| Poseidon parity between Cairo and starknet.js | Done, shared fixture asserted on both sides |
| Auction contract | Done, 448 lines of code plus 237 of comment |
| snforge tests | 47 passing, 2 fuzzed, covering all twelve invariants |
| Day 3 gate: a composed withdraw plus `privacy_invoke` funds a commitment | **Passed** on day 2, `0x3e27d50c...817dc719` |
| Full lifecycle on Sepolia: commit, reveal, settle, claim, forfeit | Done, `web/scripts/lifecycle-sepolia.ts` |
| Reveal and claim routed through the pool | Done, no bidder address at any phase |
| Independent review of the contract | Done, four findings, all fixed, all regression tested |
| Auction discovery without a backend | Done, one event query, `web/src/lib/discovery.ts` |
| Frontend: bid, reveal, claim, settle, seller proceeds, listing | Done |
| Seller can list an auction from the browser | Done, `/create` |
| Mainnet deployment and a live auction | Not started, prepared in `docs/MAINNET.md` |
| Public demo URL | Live, https://tinoxbt.github.io/sealed/ |
| Demo video | Not started |

Current Sepolia deployment: class `0x58f6401b...808eda268`, auction
`0x01a691c5...8eb03f62`. Earlier deployments exist and are superseded; the
class above is the first carrying all four review fixes.

**`strk20.json` is deliberately empty of transactions.** The sprint scores at
least three *mainnet* transactions *that touched the pool*, and a testnet
deploy is neither. Sepolia hashes are recorded here and in `docs/HANDOFF.md`
instead, labelled as what they are.

**The contract is over its own size target.** `CLAUDE.md` says under 400 lines
of code excluding comments and it is 448. The target moved from 300 to 400 once
already, when the pool-driven paths were added. Everything since has been a
review fix or the discovery event, all of which earn their place, but the number
is over and is recorded here rather than moved again.

### What an independent review found

The contract was reviewed by a separate model after it was written, tested and
deployed. Four findings, all real:

- **Zero `claim_handle`.** Zero is the sentinel for "no winner". A bidder could
  supply it directly, win, and the clearing price would read as zero: the seller
  paid nothing for the sale, and that collateral stranded forever because the
  entry was revealed and so could not be forfeited either.
- **Zero `bid_commitment`.** Zero is also the sentinel for "no entry", so one
  handle could be committed repeatedly, taking collateral each time.
- **Ordering on the pool commit path.** Collateral was taken before the entry
  was recorded, and taking it reads `balance_of`, which is an external call. A
  hostile token could reenter `cancel` in that window.
- **Zero `seller_handle`.** Makes `claim_proceeds` unsatisfiable, stranding the
  seller's own proceeds.

Each fix has a test that was confirmed to fail without it. Two of the four had
been sitting in code that already carried auditor comments and had been called
done, which is the argument for the review.

## Repository

```
contracts/   Cairo 2, Scarb, snforge tests
web/         Next.js frontend
scripts/     Declare, deploy, seed a demo auction
docs/        ARCHITECTURE.md, PRIVACY.md, MECHANISM.md, HELPER_CUSTODY.md
             POOL_REVEAL.md (proposal, unadopted)
             MAINNET.md, HANDOFF.md
             reference/  Offline copies and research notes
CLAUDE.md    Working constraints and non-negotiables
HACKATHON.md Sprint rules, judging weights, submission requirements
strk20.json  Sprint submission manifest
```

Built for the STRK20 Private Sprint, 14 to 31 August 2026.

## License

Apache 2.0. See `LICENSE`.
