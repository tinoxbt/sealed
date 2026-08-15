# Sealed: System Architecture

Sealed-bid, second-price auctions on Starknet mainnet, with unlinkable bidders and private settlement through STRK20.

Status: locked for the STRK20 Private Sprint, 14 to 31 August 2026. Anything not in this document is out of scope.

---

## 0. Dependency status, day 1

| Dependency | Status | Consequence |
| --- | --- | --- |
| SDK-route private sub-accounts | **Confirmed.** Ships in Privacy SDK 0.14.3-rc.4, backed by `sub_account_anonymizer`. Usable because Sealed controls the SDK side rather than asking a user's wallet to mint one. | Load-bearing. This is the primitive the whole design now rests on. |
| Wallet API sub-account route | Not available | Does not block Sealed. Bidders onboard through the app, not through their existing wallet. |
| Stateful helper custody across time | Documented via empty `Span<OpenNoteDeposit>`, with an unofficial escrow example | Not used in v1. See below. |
| **Multi-user custody in one helper** | **Not established.** No documented example. The docs state helpers should be small, reviewable, and should not hold user funds long-term. | **Design changed to avoid it entirely.** |
| Payout destination | Determined by `OpenNoteDeposit.note_id`, not by the caller. No prior channel with the helper appears to be required. | Useful for the stretch design, not needed in v1. |

The multi-user custody question is the one that reshaped this document. Asking a helper to act as a multi-depositor escrow ledger runs against the protocol's stated intent for helpers, and no reference implementation demonstrates it. Building the auction on an unverified lifecycle would put the entire project behind a question only the protocol engineers can answer.

**v1 therefore does not use `privacy_invoke` custody at all.**

---

## 1. What is being built

A single-item, single-round, sealed-bid, second-price auction. Bidders act through unlinkable private sub-accounts, commit to a bid without revealing it, escrow a uniform collateral, then reveal after the auction closes. The highest valid bidder wins and pays the second-highest price.

Privacy is three separate requirements, engineered separately:

1. **Unlinkable bidder identity.** SDK-route private sub-accounts. No public onchain link back to the bidder's main wallet.
2. **Private bid value.** Poseidon commitments plus uniform collateral. The pool does not deliver this and was never going to: app-side amounts can be public, so the mechanism must hide the bid, not the pool.
3. **Private funding and exit.** Shielded balances fund the sub-accounts, and proceeds re-shield afterwards.

Conflating these is how a design like this fails.

---

## 2. Custody model

**The pool handles identity and value transport. An ordinary Cairo contract handles auction custody.**

```
main wallet
    │  shield (well ahead of auction)
    ▼
STRK20 pool ──── private transfer ────► private sub-account
                                              │
                                              │ ERC20 transfer_from (uniform collateral)
                                              ▼
                                     Sealed auction contract
                                              │ settle, then per-entry claim
                                              ▼
                                        private sub-account
                                              │ re-shield
                                              ▼
                                         STRK20 pool
```

The auction contract is a plain Cairo contract holding ERC20 balances. It makes no assumption about `privacy_invoke` lifecycle, helper statefulness, or multi-depositor accounting.

**What this costs.** Less surface area on the anonymizer interface. **What it buys.** Every dependency is confirmed, the day 6 gate becomes trivial, and there is no question outstanding with the protocol team that can sink the project.

**Why the collateral transfer leaks nothing.** Every bidder transfers an identical amount, so the visible ERC20 leg is uniform across all bidders and carries zero information about any bid. The address performing it is a sub-account with no public link to a person.

---

## 3. Locked technical decisions

These do not change during the sprint.

| Layer | Decision |
| --- | --- |
| Contract language | Cairo 2 |
| Build tool | Scarb, version pinned in Scarb.toml on day 1 |
| Test framework | Starknet Foundry, snforge |
| Contract libraries | OpenZeppelin Cairo, ERC20 interface only |
| Commitment hash | Poseidon, native to the STARK field |
| Client hash | starknet.js Poseidon, verified byte-identical against Cairo on day 2 |
| Amount type | u256 throughout, never felt252 for token values |
| Token | One token for the whole sprint. STRK. |
| Privacy layer | Privacy SDK 0.14.3-rc.4, SDK route, sub-accounts only |
| Custody | Ordinary ERC20 held by the auction contract. No `privacy_invoke`. |
| Frontend | Next.js 14 App Router, TypeScript, Tailwind |
| Chain access | starknet.js |
| Off-chain store | Supabase Postgres, listing metadata and reveal reminders only |
| Networks | Sepolia for development, mainnet for the final deployment |
| Repo | Single public monorepo, Apache 2.0 |

Pin Scarb, the compiler, snforge, and OpenZeppelin Cairo on day 1. A tutorial four months old will not compile.

---

## 4. Two independent secrets

Each bidder generates two unrelated random values. This is the most important correctness detail in the design.

| Secret | Purpose | Ever revealed? | Loss consequence |
| --- | --- | --- | --- |
| `bid_salt` | Hides the bid amount in the commitment | Yes, at reveal | Cannot reveal, collateral forfeited to seller |
| `claim_secret` | Proves ownership of an escrowed entry | Never | Funds permanently unrecoverable |

- `claim_handle = poseidon(claim_secret, payout_address)`
- `bid_commitment = poseidon(amount_low, amount_high, bid_salt, claim_handle)`

`bid_salt` becomes public at reveal. If it also authorised claims, anyone watching the reveal phase could drain every losing bidder. Separate secrets, always.

### Destination binding, and why claims cannot be raced

`claim_secret` is secret only until the claim transaction. That transaction carries it in public calldata, so an observer can read it. The protection is not secrecy of the calldata, it is that **the payout address is committed inside `claim_handle` at commit time**.

At claim the caller presents `(claim_secret, payout_address)`. The contract recomputes `poseidon(claim_secret, payout_address)` and requires it to equal the stored `claim_handle`. An attacker who copies a pending claim cannot substitute their own destination without breaking the hash. Replaying it verbatim only pays the rightful owner and burns the attacker's gas.

Two consequences to design around:

- The payout address must exist **before** committing. The frontend generates the payout sub-account during the bid flow, not at claim time.
- The payout address is inside the hash, not stored in cleartext, so the committing sub-account and the payout sub-account are not publicly linked until the claim transaction itself.

Starknet's current sequencer does not expose a public mempool the way Ethereum does, but this design does not rely on that. Treat every claim as observable.

### Field encoding, defined once

Both sides must agree exactly or every commitment fails verification.

- **u256 amounts** are hashed as two felts, low limb then high limb, in that order.
- **Secrets and salts** are 31 random bytes read from `crypto.getRandomValues`, interpreted big-endian. 31 bytes is always below the STARK field prime, so no modular reduction or rejection sampling is needed and there is no modulo bias.
- **Addresses** are single felts, used as-is.
- Poseidon is applied over the ordered array of felts above.

Day 2 parity test: hash a fixed vector in Cairo and in starknet.js and assert byte equality. Do this before writing any auction logic.

---

## 5. Auction lifecycle

```
CREATED ──> OPEN ──> REVEALING ──> SETTLED
              │
              └──> CANCELLED (only before the first commitment)
```

**Open.** Seller sets a public reserve price, uniform collateral, close timestamp, and reveal deadline. Each bidder, from a private sub-account, submits `bid_commitment` and `claim_handle` and transfers exactly the collateral in.

**Revealing.** Opens at close time. Bidder submits `(amount, bid_salt, claim_handle)`. Contract recomputes the hash, checks it matches, checks `reserve <= amount <= collateral`, and updates the running highest and second-highest. `claim_secret` is not used here.

**Settled.** After the reveal deadline, anyone calls `settle`. It records the winner and the clearing price, the second-highest valid bid, or the reserve if only one valid bid. **Settle moves no money.** Each party then calls `claim` presenting `(secret, payout_address)`: the winner takes back collateral minus the clearing price, losers take back full collateral, and the seller takes the clearing price plus all forfeited collateral. Bidders who committed but never revealed forfeit to the seller.

**Zero valid reveals.** The auction still settles, with no winner and no clearing price. Every commitment is unrevealed and therefore forfeited, so the seller claims the entire pot. This is the same rule applied consistently, and it is what makes non-revelation expensive rather than free. State it in the UI before a bidder commits.

Forfeiture is what makes silence expensive, and it is why a losing bidder cannot simply refuse to reveal to hide their number. Demo this branch once, deliberately.

---

## 6. Contract design

One contract, target under 300 lines. No proxy, no upgradeability, no admin key beyond seller cancel before the first commitment.

### Storage

```
seller_handle               felt252   // poseidon(seller_secret, seller_payout_address)
seller_claimed              bool
token                       ContractAddress
reserve_price               u256
collateral                  u256
close_time                  u64
reveal_deadline             u64
state                       AuctionState

entries                     Map<felt252, Entry>   // keyed by claim_handle
commitment_count            u32

highest_bid                 u256
second_highest_bid          u256
winner_handle               felt252
```

`Entry` holds `bid_commitment`, revealed amount, revealed flag, claimed flag.

**The contract never stores a bidder address.** Identity on chain is `claim_handle` and nothing else. A `ContractAddress` field in `Entry` would create exactly the linkability oracle this design exists to avoid: a public map from depositor to position. Any such field is a bug, not an optimisation.

The chain should show: this auction received N commitments of equal size. Not: these N addresses bid.

### External functions

| Function | Phase | Notes |
| --- | --- | --- |
| `create_auction` | once | Seller sets reserve, collateral, close time, reveal deadline |
| `commit` | Open | Stores `bid_commitment` under `claim_handle`, pulls exactly `collateral` |
| `reveal` | Revealing | Verifies hash, validates bounds, updates the top two |
| `settle` | after reveal deadline | Permissionless, records outcome, moves no funds |
| `claim` | Settled | Presents `(claim_secret, payout_address)`, verifies against `claim_handle`, transfers that entry's balance |
| `claim_proceeds` | Settled | Seller presents `(seller_secret, seller_payout_address)`, takes clearing price plus all forfeited collateral |
| `cancel` | Open, zero commitments | Seller only |

### Entry status, derived and not stored

One view function, added day 4 alongside the claim paths:

```
get_entry_status(claim_handle) -> Unknown | Committed | Revealed | Won | Lost | Forfeited | Claimed
```

Every value is computed from state that already exists: the entry's `revealed` and `claimed` flags, its revealed amount, `winner_handle`, and the current phase. **Nothing new is stored.** A status field written into `Entry` would be a second source of truth alongside `revealed`, and two sources of truth in a contract holding money is a state-sync bug waiting to happen. Derive it.

This exists so the UI can tell a bidder exactly why their entry resolved the way it did, and so invariants 7 and 11 have something direct to assert against. It moves no money and takes no arguments beyond the handle, which is already public.

There is no separate forfeiture path. Unrevealed collateral is not stranded and never was: `claim_proceeds` already pays the seller the clearing price plus all forfeited collateral, once. Adding a `finalize_forfeitures` entrypoint would either duplicate that, or move money outside a `claim` call and break the rule that settle and its neighbours move nothing. The gap it appears to fill is a documentation gap, and this view plus `MECHANISM.md` is what fills it.

Both claim paths use the same authorisation: recompute the Poseidon handle from the two preimages and require it to match what was stored. Neither path accepts a destination that was not committed in advance.

### Invariants to test explicitly

1. Contract balance equals `collateral * commitment_count` minus everything claimed.
2. No entry can be claimed twice.
3. A reveal after the deadline is rejected.
4. A `bid_salt` published at reveal cannot claim anything.
5. `second_highest_bid` is correct when two bidders reveal identical amounts. Tie rule: first valid reveal wins, documented in the UI.
6. `settle` is idempotent.
7. An unrevealed entry cannot be claimed by its bidder after settlement.
8. Sum of all claims never exceeds the contract balance, with 3 or more bidders.
9. A claim presenting a correct secret but a different `payout_address` is rejected.
10. `claim_proceeds` pays exactly the clearing price plus all forfeited collateral, and can only be called once.
11. Zero valid reveals settles with no winner and the seller claims the full pot.
12. A losing bidder cannot call `claim_proceeds`, and the seller cannot call `claim` on a bidder entry.

---

## 7. STRK20 integration

- SDK-route private sub-account creation via `transfers.build().subaccounts(dappName).invoke(...)`, backed by `sub_account_anonymizer`
- Registration and viewing key setup on first use
- Shielding to fund, private transfer from main shielded balance to sub-account
- Channel and per-token subchannel setup
- Multi-note spends with automatic change when collateral does not match a single note
- Note scanning so bidders see funds arrive
- Fresh sub-account per payout, so committing and claiming identities are not linked

**Unlinkability comes from the sub-account, not the pool.** The guarantee is precisely no public onchain link back to the main wallet. It is not unconditional anonymity: timing and app-side amounts remain observable.

---

## 8. Privacy model, stated honestly

**Hidden:** which real person is behind any bidder, and every bid amount until that bidder reveals.

**Visible:** that an auction exists, the reserve price, the collateral amount, the number of commitments, the timing of each, the sender address of every commit transaction, the ERC20 source of every collateral transfer, all revealed amounts after the reveal window opens, the clearing price, each claim amount, and each payout address once claimed.

**What unlinkability does and does not mean here.** The chain absolutely can associate a sub-account with a position. Every commit has a visible sender, and the collateral transfer exposes its source. What the design provides is that the sub-account carries no public onchain link back to the bidder's main wallet, which is precisely the guarantee the sub-account primitive offers and nothing more. If the sub-account primitive fails or is misused, for example by funding it directly from a main wallet on the public chain, this property is gone. Sealed does not claim that a position cannot be tracked. It claims a position cannot be traced to a person.

**Known leaks and constraints:**

- Bids cannot exceed the collateral. Sellers set a collateral band suited to the item.
- Shielding or funding a sub-account immediately before committing creates a timing link. The UI warns users to fund well ahead.
- Commitment timing is public, so a bidder committing alone in a quiet hour is weakly linkable by timing.
- Claim amounts are visible. The winner's claim differs in size from losers' claims, so after settlement the winner's claiming sub-account is identifiable as the winner's. It is still unlinked to a main wallet.
- After reveal, all bids are public by design. This is what a sealed-bid auction promises offline, and nothing more.
- The payout address becomes public at claim, linking the committing sub-account to the payout sub-account at that moment.
- Sealed settles money, not delivery. The contract has no view of whether the seller ships the item. This is a settlement primitive for an auction, not an enforceable sale, and the README says so plainly. The demo uses a digital item where delivery is trivially verifiable.

**Scope boundary.** Sealed implements commit-reveal: sealed until close, then opened. Determining a winner without any bid ever being revealed requires a ZK circuit proving the winning bid was highest and the clearing price second-highest without disclosing bids. STRK20 does not provide that automatically. Documented as future work, not attempted this sprint. Anyone proposing it mid-sprint is proposing a different project.

This section goes verbatim into PRIVACY.md. Stating the leaks scores better than claiming total privacy.

---

## 9. Stretch: helper custody

If the protocol team confirms that a `note_id` from a deposit at T0 can be carried forward and filled by an independent claim at T1, after other users have deposited into the same helper, then v2 replaces the ERC20 custody leg with `privacy_invoke`: `commit` parks value and returns an empty `Span<OpenNoteDeposit>`, `claim` returns a populated one crediting a private note.

That removes the visible collateral transfers entirely. It is an upgrade, not a prerequisite. Attempt it only if v1 is fully working and it is before day 12. Whatever is learned gets written up in `docs/HELPER_CUSTODY.md`, because no reference implementation currently exists and other teams will hit the same wall.

---

## 10. Frontend

```
app/
  page.tsx                    Live and recent auctions
  auction/[id]/page.tsx       Bid, reveal, settle, claim
  create/page.tsx             Seller listing form
lib/
  contract.ts                 Typed contract calls
  privacy.ts                  SDK wrapper: register, subaccount, shield, transfer, scan
  commitment.ts               Poseidon commitments, secret generation
  storage.ts                  Secret persistence and export
components/
  BidForm, RevealPanel, AuctionClock, PrivacyWarning, ClaimPanel
```

Both secrets are generated client-side with `crypto.getRandomValues`, never transmitted, persisted to localStorage keyed by auction id, and written into a single downloadable JSON backup pushed immediately after commit, before the confirmation screen. Not skippable. The reveal window shows a live countdown, and Supabase drives an optional email reminder.

The contract is the only source of truth for auction state. Supabase holds titles, descriptions, images, and reminder subscriptions. If Supabase is down, the auction still settles.

---

## 11. Repository

```
sealed/
  contracts/          Cairo, Scarb.toml, snforge tests
  web/                Next.js app
  docs/
    ARCHITECTURE.md
    PRIVACY.md          Section 8 verbatim
    MECHANISM.md        Why second-price, why uniform collateral
    HELPER_CUSTODY.md   Findings on the multi-user custody question
  scripts/            Declare, deploy, seed a demo auction
  CLAUDE.md
  README.md
  LICENSE             Apache 2.0
```

---

## 12. Seventeen-day plan

| Days | Work | Done means |
| --- | --- | --- |
| 1 to 2 | Toolchain pinned, hello-world contract on Sepolia, Poseidon parity between Cairo and starknet.js | A contract you wrote is deployed and callable |
| 3 | **Gate:** an SDK-route sub-account calls your contract and transfers tokens in | Sub-account created, unlinked, transaction lands |
| 4 to 7 | Full auction contract, commit, reveal, settle, claim, snforge tests covering all eight invariants | Tests green |
| 8 to 11 | Frontend, SDK wiring, secret persistence and backup, reveal reminders | End-to-end auction on Sepolia with three bidders |
| 12 to 13 | Mainnet declare and deploy, one real auction end to end with small amounts | Mainnet transaction hashes in the README |
| 14 to 15 | README, PRIVACY.md, MECHANISM.md, HELPER_CUSTODY.md, architecture diagram, demo video | Docs complete |
| 16 | Optional: helper custody stretch, only if everything above is done | Written up either way |
| 17 | Buffer, and a seeded live auction for the judging call | Auction open and biddable |

---

## 13. The day 3 gate

The gate is now trivial by design: **an SDK-route sub-account, created by your app, calls a contract you wrote and transfers tokens into it.** If that is not working by end of day 3, the sub-account primitive is not usable as documented and Sealed's identity claim is gone.

**Fallback: strk20-kit,** a drop-in React component kit for shield, unshield, private transfer, and balance, plus a small mainnet reference app built from those components. No custom Cairo, same empty infrastructure lane, same documentation strength.

Written down now, while calm. On day 10 the instinct will be to keep pushing. That instinct is what loses sprints.

---

## 14. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| ~~Sub-account unlinkability unavailable~~ | Cleared | SDK route ships in 0.14.3-rc.4 |
| ~~Multi-user helper custody unverified~~ | Designed out | v1 uses ordinary ERC20 custody. Moved to stretch |
| Sub-account creation is awkward or slow in practice | High | Day 3 gate |
| `bid_salt` reused as a claim credential | High | Two independent secrets, invariant 4 |
| Bidder loses `claim_secret` | High | Funds unrecoverable. Non-skippable backup at commit |
| Contract stores an address and creates a linkability oracle | High | Invariant review, `claim_handle` only, checked before mainnet deploy |
| Toolchain version drift | Medium | Pin everything on day 1 |
| Bidder loses `bid_salt` | Medium | Forfeits collateral. Backup plus reminders |
| Claim amounts identify the winner post-settlement | Low | Documented, not fixed. Fixed by the v2 stretch |
| Gas or step limits on settle | Low | Settle records only, value leaves via individual claims |

---

## 15. The demo

Open a live auction before the judging call and invite the panel to bid against each other. They see equal-sized commitments from unlinkable accounts during the bidding window and nothing else. At close the reveals land, second-price settlement executes, and each of them claims their collateral back to a fresh account.

No other project on the registry can put the judges inside the product. That is the closing argument.
