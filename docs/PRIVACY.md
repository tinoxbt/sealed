# Privacy model

What Sealed hides, what it does not, and where it depends on someone else.

Read this before deciding whether Sealed is appropriate for what you are auctioning. It is written to be believed rather than to be impressive, so the leaks are stated as plainly as the guarantees. Every claim here was checked against the deployed contract or the protocol source, not inferred from a diagram.

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

**1. The reveal transaction has an ordinary public sender, and it names both the bid amount and the claim handle.** This is the largest practical leak in the design. A bidder who reveals from the wallet they shielded from links that wallet to their bid and undoes what the commit protected. Reveal is permissionless, because the contract checks the salt against the commitment and never checks who sent it, so the transaction can come from any account or be relayed. The interface warns at the moment of revealing. It cannot enforce it.

**2. Shielding immediately before committing creates a timing link.** A thin anonymity set weakens the guarantee toward nothing. Shield well ahead of any auction you intend to bid in. The interface says so, but the discipline is the user's.

**3. Commitment timing is public.** A bidder committing alone in a quiet hour is weakly linkable by timing alone, regardless of what the pool does.

**4. Claim amounts are visible, so the winner is identifiable after settlement.** The winner's claim is `collateral - clearing_price` while every loser's is the full collateral, so the winning payout address stands out. It remains unlinked to a main wallet, provided the payout is re-shielded rather than swept somewhere identifying.

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

These are enforced by tests, including on a live network. See `docs/ARCHITECTURE.md` section 6 for the invariant list.

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
3. Reveal from an account with no connection to the one you shielded from, or have someone else submit it. Reveal is permissionless precisely so this is possible.
4. Re-shield the payout rather than sweeping it somewhere that identifies you.

For sellers:

1. Set the collateral to a band that suits the item, remembering it caps every bid and is publicly visible.
2. Expect that the clearing price and every revealed bid will be public forever.
