# Sealed

A deployable Vickrey variant of RFP-08 on Starknet. Bidder identities stay unlinkable, bid values stay hidden until reveal, every bidder locks identical STRK20-funded collateral, and failing to reveal forfeits it to the seller.

Private bidder identity and private payout routing. Public settlement outcome.

## What Sealed is

A single-item, single-round, sealed-bid auction that settles at the second-highest price.

Bidders act through private sub-accounts created by the app through the STRK20 Privacy SDK, so no public on-chain link points back to their main wallet. Each bidder submits a Poseidon commitment to their bid rather than the bid itself, and escrows a collateral amount that is identical for every bidder. After the auction closes, bidders reveal. The highest valid bid wins and pays the second-highest valid bid, or the reserve price if only one bid was valid.

Two properties are engineered separately, because conflating them is how this kind of design fails:

- **Who is bidding** is hidden by STRK20 private sub-accounts.
- **What they bid** is hidden by the commitment scheme and by the uniform collateral.

The uniform collateral is the part that is easy to get wrong. If each bidder escrowed an amount proportional to their bid, the public ERC20 transfer would leak the bid before anyone revealed anything. Every bidder therefore escrows exactly the same amount, and bids are capped at that amount.

Second-price is not decoration either. Under a sealed-bid second-price rule, bidding your true value is the dominant strategy, so the mechanism only produces honest bids if the bids are genuinely sealed. Privacy is what makes the mechanism work rather than a feature bolted onto it.

## Privacy model

Stated plainly, including the parts that leak. The full version lives in `docs/PRIVACY.md`.

**Hidden:** which real person is behind any bidder, and every bid amount until that bidder reveals it.

**Visible:** that the auction exists, the reserve price, the collateral amount, the number of commitments and the timing of each, the sender address of every commit transaction, the ERC20 source of every collateral transfer, every revealed amount once the reveal window opens, the clearing price, each claim amount, and each payout address once claimed.

**What unlinkability does and does not mean here.** The chain can absolutely associate a sub-account with a position. Every commit has a visible sender. What the design provides is that the sub-account carries no public on-chain link back to the bidder's main wallet, which is precisely what the sub-account primitive offers and nothing more. Sealed does not claim a position cannot be tracked. It claims a position cannot be traced to a person.

Known limits:

- Bids cannot exceed the collateral.
- Funding a sub-account immediately before committing creates a timing link. The interface warns about this.
- After the reveal window opens, all revealed bids are public. That is what a sealed-bid auction promises offline, and nothing more.
- Claim amounts are visible, so after settlement the winner's claiming sub-account is identifiable as the winner's. It remains unlinked to a main wallet.
- Sealed settles money, not delivery. The contract has no view of whether the seller ships the item.

Determining a winner without any bid ever being revealed would need a ZK circuit proving the winning bid was highest and the clearing price second-highest without disclosing either. STRK20 does not provide that automatically. It is documented as future work and is not attempted this sprint.

## Custody

The pool handles identity and value transport. The auction contract handles custody as ordinary ERC20.

```
main wallet
    |  shield, well ahead of the auction
    v
STRK20 pool ---- private transfer ----> private sub-account
                                              |
                                              |  ERC20 transfer_from, uniform collateral
                                              v
                                     Sealed auction contract
                                              |  settle, then per-entry claim
                                              v
                                        private sub-account
                                              |  re-shield
                                              v
                                         STRK20 pool
```

`settle` moves no money. It records the winner and the clearing price. All value leaves through individual `claim` calls, each authorised by a secret whose payout address was committed in advance.

## Build status

Day 1 of 17. Nothing is deployed yet.

| Piece | Status |
| --- | --- |
| Architecture and scope locked | Done, `docs/ARCHITECTURE.md` |
| Repository, license, registration | Done |
| Toolchain pinned, Poseidon parity between Cairo and starknet.js | Not started |
| Day 3 gate: an SDK-route sub-account calls our contract and transfers tokens in | Not started |
| Auction contract: commit, reveal, settle, claim | Not started |
| snforge tests covering all twelve invariants | Not started |
| Frontend, SDK wiring, secret backup | Not started |
| Mainnet deployment and a live auction | Not started |
| PRIVACY.md, MECHANISM.md, HELPER_CUSTODY.md, demo video | Not started |

Mainnet transaction hashes and deployed contract addresses will appear in `strk20.json` and in this section as they land.

## Repository

```
contracts/   Cairo 2, Scarb, snforge tests
web/         Next.js frontend
scripts/     Declare, deploy, seed a demo auction
docs/        ARCHITECTURE.md, and PRIVACY.md, MECHANISM.md, HELPER_CUSTODY.md as they are written
             reference/  Offline copies and research notes
CLAUDE.md    Working constraints and non-negotiables
HACKATHON.md Sprint rules, judging weights, submission requirements
strk20.json  Sprint submission manifest
```

Built for the STRK20 Private Sprint, 14 to 31 August 2026.

## License

Apache 2.0. See `LICENSE`.
