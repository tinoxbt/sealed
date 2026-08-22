# Sealed

Sealed-bid, second-price auctions on Starknet. Unlinkable bidders, bid values hidden until reveal, uniform STRK20-funded collateral, and public settlement outcome.

Say private bidder identity and private payout routing, not private settlement. The clearing price, every revealed bid, and every claim amount are public by design. Accuracy is scored, and overclaiming costs marks on integration depth.

Built for the STRK20 Private Sprint, 14 to 31 August 2026. Full spec in `docs/ARCHITECTURE.md`. Read it before making design decisions.

Read `HACKATHON.md` before making any scope or priority decision. It holds the sprint rules, the deadline, the judging weights, and the submission requirements. Design decisions come from `docs/ARCHITECTURE.md`, scope and priority decisions come from `HACKATHON.md`.

## Non-negotiables

Do not change these without an explicit instruction. They are scope decisions, not defaults.

- **Second-price.** Highest bidder wins and pays the second-highest valid bid, or the reserve if there was only one valid bid.
- **Uniform collateral.** Every bidder escrows an identical amount. This is what stops the escrow leg from leaking the bid. Never make collateral proportional to the bid.
- **Two independent secrets.** `bid_salt` is revealed at reveal time. `claim_secret` is presented only in the claim transaction. `claim_handle = poseidon(claim_secret, payout_address)`, `bid_commitment = poseidon(amount_low, amount_high, bid_salt, claim_handle)`. Never authorise a claim with `bid_salt`.
- **The payout address is bound inside `claim_handle` at commit time.** `claim` takes `(claim_secret, payout_address)` and recomputes the hash. A claim that presents a correct secret with a different destination must be rejected. Never add a `claim` overload that pays to an arbitrary or caller-supplied address, and never pay to `get_caller_address`. This is the only thing stopping a pending claim from being raced.
- **The seller uses the same mechanism.** `seller_handle = poseidon(seller_secret, seller_payout_address)`, fixed in the constructor, redeemed via `claim_proceeds` for clearing price plus all forfeited collateral, once only.
- **Field encoding is fixed.** u256 amounts hash as two felts, low limb then high limb. Secrets and salts are 31 random bytes from `crypto.getRandomValues`, big-endian, which is always below the field prime so no reduction is needed. Addresses are single felts. Verify parity against Cairo before writing auction logic.
- **Zero valid reveals settles with no winner** and the seller claims the entire pot, since every entry is forfeited.
- **The contract never stores a bidder address.** Entries are keyed by `claim_handle` only. A `ContractAddress` field in `Entry` creates a public depositor-to-position map and destroys the privacy property. This is a bug, not an optimisation.
- **Settle moves no money.** It records winner and clearing price. All value leaves through individual `claim` calls.
- **Every phase has a pool path and a plain path.** `privacy_invoke` multiplexes Commit, Reveal and Claim on an operation discriminator, because the pool always dispatches to one selector. Commit pulls nothing: the pool has already delivered, and arrival is verified against the `escrowed` ledger rather than read from calldata. Reveal and Claim move no value of their own. Keep the plain `commit`, `reveal` and `claim` entrypoints as the no-redeploy fallback, so a stuck pool cannot strand a claim. Custody stays ordinary ERC20 and no note is carried across time. See `docs/HELPER_CUSTODY.md` and `docs/POOL_REVEAL.md`.
- **One token, one item, one round.** STRK only. No multi-item, no multi-round, no upgradeability, no proxy, no reputation system, no arbitration.
- **No new cryptography.** The privacy machinery is STRK20's.

## Stack

| Layer | Choice |
| --- | --- |
| Contracts | Cairo 2, Scarb, snforge |
| Contract libs | OpenZeppelin Cairo, ERC20 interface only |
| Hash | Poseidon, both sides |
| Amounts | u256, never felt252 |
| Privacy | Privacy Wallet API v0.10.3 via `WalletAccountV6`. The wallet proves. Sealed hosts no prover |
| Frontend | Next.js 14 App Router, TypeScript, Tailwind |
| Chain access | starknet.js |
| Off-chain | None. Discovery is chain events, state is the contract, secrets stay client-side |

Versions are pinned. Do not bump Scarb, the Cairo compiler, snforge, or OpenZeppelin Cairo during the sprint.

## Custody model

The pool handles identity and value transport. The auction contract handles custody as plain ERC20.

```
main wallet -> shield -> pool
  -> ONE transaction: withdraw collateral to auction, then privacy_invoke
  -> auction contract holds ordinary ERC20
  -> claim -> fresh payout account -> re-shield -> pool
```

## Invariants, test all of these

1. Contract balance equals `collateral * commitment_count` minus everything claimed.
2. No entry can be claimed twice.
3. A reveal after the deadline is rejected.
4. A `bid_salt` published at reveal cannot claim anything.
5. `second_highest_bid` is correct when two bidders reveal identical amounts. Tie: first valid reveal wins.
6. `settle` is idempotent.
7. An unrevealed entry cannot be claimed by its bidder after settlement.
8. Sum of all claims never exceeds contract balance, with 3 or more bidders.
9. A claim with a correct secret but a different `payout_address` is rejected.
10. `claim_proceeds` pays clearing price plus forfeitures, once only.
11. Zero valid reveals settles with no winner and the seller claims the full pot.
12. Role separation: a bidder cannot call `claim_proceeds`, the seller cannot claim a bidder entry.

## Frontend rules

- Both secrets generated as 31 random bytes from `crypto.getRandomValues`, client-side, never transmitted.
- The payout account must be derived during the bid flow, before committing, because its address is hashed into `claim_handle`. It is a counterfactual OpenZeppelin account: the address is computed now and deployed only when its owner moves the funds on. Back up the private key, the salt and the class hash with the secrets, because losing any of them makes the address undeployable and the payout unreachable.
- Persist to localStorage keyed by auction id, and force a JSON backup download immediately after commit, before the confirmation screen. Not skippable.
- Seal the secrets into the on-chain backup blob at commit, under both a passphrase, when the bidder set one, and a generated recovery code. Either credential alone must open it, so forgetting one is survivable. Every blob is the same length whatever was used to seal it, and unused credential slots hold random bytes: a shorter blob, or a recognisably empty slot, would say how the bidder stored their secrets.
- The file is no longer the only copy, but it is still the fastest one. Losing the file, the passphrase and the recovery code together still means the funds are unrecoverable by anyone.
- The contract is the only source of truth for auction state. There is no backend, and adding one that learns which address browses which auction would rebuild the link the pool exists to break. Listing metadata and reveal reminders are what a backend would add, and neither is built.
- Warn users to shield well ahead of an auction. Shielding immediately before committing creates a timing link the pool cannot hide.
- Reveal and claim go through the pool, never `account.execute`. A direct call puts the connected wallet beside the bid amount and the claim handle, which is exactly what the commit was built to prevent. Both carry a one-unit self-transfer, because the pool rejects a transaction that spends no matured note and an invoke spends nothing.
- Do not tell users to reveal from a separate account. That was advice for a leak that no longer exists, and following it now is worse than ignoring it: a fresh account funded from a main wallet recreates the link it was meant to avoid.

## Commits

Run `sh scripts/setup-hooks.sh` once per clone, on every machine any agent works from. It wires a `commit-msg` hook and a message template. Without it there is nothing enforcing any of the below.

**One logical change per commit.** If the body needs the word "also", it is two commits. A commit that adds a manifest, a contract, a vector file, and a test harness is four commits, and reviewing it is four times harder than reviewing them separately. Never `git add -A` without reading `git status` first. That is how a large unrelated download nearly got committed on day 2.

**Every commit has a body.** The subject says what, in the imperative, under 72 characters, no trailing period. The body says why. The diff already covers what changed, so spend the body on the constraint that forced the change, or the approach that did not work. `wip`, `fix`, `update`, and `cleanup` are rejected by the hook.

**State verification honestly.** "Tests pass" means you ran them and saw them pass. If something is written but unexecuted, the body says so. An unverified commit is acceptable when it is labelled unverified. A commit that implies working code when nothing was ever compiled is not, and it cost a full audit to catch once already.

**Commit at the boundary of a working state**, not at the end of a session. If four things were done, that is four commits made as each finished, not one commit at the end reconstructing what happened.

**Branch per handoff step.** Work on step N goes on `step-N-short-name`, several small commits, then one squash-free merge into `main`. The step is the reviewable unit, the commits inside it are the readable history. Direct commits to `main` are for documentation and repository maintenance only.

Never use `--no-verify` to get past the hook without saying why in the body.

## Style

- No em dashes or en dashes anywhere in code comments, docs, or UI copy.
- Plain, direct prose in documentation. No marketing voice.
- Small, reviewable contract. Under 400 lines of code, excluding comments. It was 300 before the pool-driven commit, reveal and claim paths were added; the target moved once, deliberately, and is not a licence to keep moving it.
- Tests before frontend work.

## Documentation is 15 percent of the score

`docs/PRIVACY.md` states hidden versus visible plainly, including the leaks. Do not soften it and do not claim total privacy. `docs/MECHANISM.md` explains why second-price and why uniform collateral. The README opens with the pitch, an architecture diagram, and the privacy model.
