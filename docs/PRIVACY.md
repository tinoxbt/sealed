# Privacy model

What Sealed hides, what it does not, and where it depends on someone else.

Read this before deciding whether Sealed is appropriate for what you are auctioning. It is written to be believed rather than to be impressive, so the leaks are stated as plainly as the guarantees. Every claim here was checked against the deployed contract or the protocol source, not inferred from a diagram. Where a guarantee rests on a path that has not yet executed on a network, this document says so at that point rather than in a footnote.

---

## The one sentence version

**Sealed hides who is bidding, and hides what each bidder bid until they reveal it. It hides nothing after that.**

The clearing price, every revealed bid, every claim amount, and every payout address are public by design. Sealed provides private bidder identity and private payout routing. It does not provide private settlement, and saying otherwise would be false.

---

## Hidden

- **Which real person is behind any bidder.** No bidder-controlled address appears in a commit. The on-chain caller is the STRK20 pool and the transaction is submitted by a rotating shared relayer.
- **Every bid amount, until that bidder reveals it.** A commit publishes `poseidon(amount_low, amount_high, bid_salt, claim_handle)`. Recovering the amount from that hash means guessing the salt, which is 31 random bytes.
- **Which shielded balance funded a given collateral transfer.** Every bidder's collateral is identical, and the source is always the pool.

## Visible

- That the auction exists, its reserve price, its collateral amount
- The number of commitments and the timing of each
- The pool as the source of every collateral transfer
- Every revealed amount, once the reveal window opens
- The clearing price and which `claim_handle` won
- Each claim amount and each payout address, once claimed

---

## What unlinkability means here, exactly

The commit carries no bidder address. Its on-chain caller is the pool, and its submitter is a rotating shared relayer, so the chain sees the pool funding an entry and cannot see which shielded balance paid for it.

This is checkable rather than asserted. On the first bid placed through the deployed contract, the submitting account had a nonce over 21,000. That is a shared submitter, not a bidder's wallet.

**What it rests on is the pool's anonymity set, not on Sealed.** If a bidder shields immediately before bidding, or is the only person using the pool in that window, the pool cannot help them and neither can Sealed. The guarantee is inherited, and it is only ever as strong as its source.

Sealed does not claim a position cannot be tracked. It claims a position cannot be traced to a person, and only as far as the pool's anonymity set carries it.

---

## Known leaks

Ordered by how much they matter in practice.

**1. The reveal and claim transactions used to carry an ordinary public sender. This is now closed, and the history is worth keeping.**

This was the largest practical leak in the design, and it was observed on Sepolia rather than argued. A bidder placed two bids. Both arrived through different relayers with no bidder address in either, unlinkable to the bidder and to each other. Both reveals then went out through a relayer too, which looks protective, but a reveal was an ordinary contract call wrapped in outside execution, and the bidder's account address sat in the public calldata beside the amount and the handle. The two reveals carried the same account, so each bid was linked to the bidder and the two bids were linked to one another, exposing that one person had placed both. Everything the commit protected was undone in two transactions.

Reveal and claim now route through the pool, the same way a bid does. The auction sees the pool as its caller, a relayer submits, and no bidder-controlled address appears at any phase of an auction. `privacy_invoke` multiplexes commit, reveal and claim, and the plain entrypoints remain as a fallback.

**Not yet exercised on a network.** The contract path is covered by tests, including that a pool-routed reveal still checks the commitment and a pool-routed claim still refuses a redirected payout. But no reveal or claim has been submitted through the pool on chain, and the currently deployed Sepolia auction is on the previous calldata shape. Until a redeploy and a live run, this is verified in the small and unproven in the large.

**5. After reveal, all bids are public.** This is what a sealed-bid auction promises offline, and nothing more. Sealed is commit-reveal, not a circuit that keeps bids secret forever.

**6. The payout address becomes public at claim.** The claim transaction reveals the destination that was committed at bid time. It reveals the destination, not the bidder.

**7. Bids cannot exceed the collateral.** Uniform collateral is what stops the funding leg leaking the bid, and the price is a cap. The collateral therefore tells an observer the maximum any bid could have been. Sellers should choose a collateral band suited to the item.

---

## Third parties in the path

Sealed depends on parties it does not control. Naming them is part of stating the model honestly.

**FPI screens and signs every deposit into the pool.** Shielding requires an attestation from the screening provider, and the pool verifies that signature on chain before accepting a deposit. Since the v0.14.3 upgrade this is enforced in the protocol on every route in, so no integration choice avoids it. Sealed does not perform the check, does not see its result, and cannot route around it. It is part of the path a bidder takes to obtain a shielded balance.

**The proving service sees the request that proves a transaction**, unless OHTTP envelope encryption is enabled. On the Wallet API route the wallet does the proving, so this is the wallet's configuration and not Sealed's.

**Viewing keys are escrowed to an auditor.** When an account registers with the pool, its private viewing key is encrypted to an auditor public key set by governance and stored on chain. Disclosure is selective, meaning the auditor decrypts only the keys of users subject to a lawful request, and the scheme supports threshold keys so decryption need not rest with one party. A recovered viewing key opens that user's incoming and outgoing channels and follows their funds forward and backward.

This is a property of STRK20, not of Sealed, and it applies to every application built on the pool. It is stated here because a reader deciding whether to bid is entitled to know it. Sealed adds no new cryptography and cannot weaken or strengthen this.

**The relayer sees the transaction it submits.** It cannot forge or redirect anything, since the payout address is bound inside the hash, but it observes what it relays.

---

## What the contract itself guarantees

Independent of the pool, and true even if every privacy assumption above fails:

- **No bidder address is ever stored.** Entries are keyed by `claim_handle` alone. There is no depositor-to-position map in storage or in any event.
- **A claim pays only the address committed at bid time.** `claim` recomputes `poseidon(claim_secret, payout_address)` and requires it to equal the stored handle, so a pending claim cannot be raced, redirected, or front-run. Copying a claim transaction verbatim only pays its rightful owner.
- **The salt published at reveal cannot claim anything.** `bid_salt` and `claim_secret` are independent. If one value did both jobs, anyone watching the reveal phase could drain every losing bidder.
- **Settle moves no money.** It records the winner and clearing price, and all value leaves through individual claims.

These are enforced by 57 contract tests, and the full lifecycle has run on Sepolia
through the plain entrypoints: commit, reveal, settle, claim and claim_proceeds,
with the conservation of funds checked on chain at each step.

**The pool-driven path has not run on a network.** Commit through the pool has;
reveal and claim through it have not. Their logic is shared with the plain
entrypoints and covered by the same tests, but "tested" and "executed on a live
network" are different claims and this document will not blur them. Until that
changes, the identity guarantee for reveal and claim is a design property rather
than a demonstrated one.

See `docs/ARCHITECTURE.md` section 6 for the invariant list.

---

## Scope boundary

Sealed implements commit-reveal: sealed until close, then opened.

Determining a winner without any bid ever being revealed requires a ZK circuit proving the winning bid was highest and the clearing price second-highest without disclosing the bids. STRK20 does not provide that automatically, and building it was not attempted this sprint. It is documented as future work.

Sealed also settles money, not delivery. The contract has no view of whether the seller ships the item. This is a settlement primitive for an auction, not an enforceable sale.

---

## If you want the strongest version of this

For bidders:

1. Shield well ahead of the auction, ideally days, never minutes.
2. Bid when others are active, not alone at 4am.
3. Reveal through the app, which routes it through the pool. Do not reveal from a "fresh" account you funded yourself: that was advice for an earlier design, and following it now is worse than ignoring it, because an account funded from your main wallet rebuilds exactly the link it was meant to break.
4. Re-shield the payout rather than sweeping it somewhere that identifies you.

For sellers:

1. Set the collateral to a band that suits the item, remembering it caps every bid and is publicly visible.
2. Expect that the clearing price and every revealed bid will be public forever.
