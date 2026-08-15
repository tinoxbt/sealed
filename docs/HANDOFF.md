# Agent handoff: steps 0 to 4

Sequential task list for the first stretch of the sprint. Steps run in order. Each one states what done means and what to stop for.

Order is deliberate. Step 0 is read-only and costs half an hour, and it is the only step whose answer can change the shape of the project, so it runs before anything is built. Steps 1 and 2 are setup that everything else depends on. Step 3 is the gate from `ARCHITECTURE.md` section 13, and it is the real risk. Step 4 is the largest block of work and the one with the fewest unknowns, which is exactly why it does not go first.

Step 4 has no dependency on STRK20 at all, since v1 custody is ordinary ERC20. If there is capacity to run two agents at once, step 4 is the one that parallelises against steps 0 and 3.

Whoever picks this up: read `CLAUDE.md`, then `HACKATHON.md`, then `docs/ARCHITECTURE.md`, before touching anything. `CLAUDE.md` holds the constraints, `HACKATHON.md` holds the deadline and the judging weights that decide priority, `ARCHITECTURE.md` holds the locked design.

Append to the progress log at the bottom when you finish a step. That log is how the next agent knows what actually happened rather than what was planned.

---

## Rules that override any local optimisation

These are copied here rather than linked because they are the failure mode. Every one of them looks like a cleanup to an agent optimising the contract in isolation.

- **The contract never stores a bidder address.** Entries are keyed by `claim_handle` only. A `ContractAddress` field in `Entry` creates a public depositor-to-position map and destroys the privacy property. It will look like it simplifies claims. It is a bug, not an optimisation.
- **Never add a `claim` overload that pays an arbitrary or caller-supplied address, and never pay to `get_caller_address`.** The payout address is bound inside `claim_handle` at commit time and the contract recomputes the hash. This is the only thing stopping a pending claim from being raced. It will look like it simplifies the frontend.
- **Two independent secrets.** `bid_salt` is revealed at reveal time. `claim_secret` is presented only in the claim transaction. Never authorise a claim with `bid_salt`. If one value did both jobs, anyone watching the reveal phase could drain every losing bidder.
- **Uniform collateral.** Every bidder escrows an identical amount. Never make it proportional to the bid. This is what stops the visible ERC20 leg from leaking the bid.
- **Second-price.** Highest bidder wins and pays the second-highest valid bid, or the reserve if there was only one valid bid.
- **Settle moves no money.** It records winner and clearing price. All value leaves through individual `claim` calls.
- **Amounts are u256 throughout.** Never felt252 for token values.
- **One token, one item, one round.** No multi-item, no multi-round, no upgradeability, no proxy.
- **No new cryptography.** The privacy machinery is STRK20's.
- **No secrets committed, ever.** Placeholder values only for keys, addresses, and endpoints.
- **Nothing touches mainnet in steps 0 to 4.** Sepolia only.

If a step seems to require breaking one of these, stop and report. It means either the step is wrong or the design is, and both are decisions for the human.

---

## Rules about calling a step done

Added after the first pass through this list produced four artifacts, none of which had ever been executed. These are not process ceremony. Each one is a real thing that happened.

- **Run it before you log it.** A file that has never been compiled or executed is not a completed step. If the toolchain is not installed, installing it is the task, not a prerequisite to skip.
- **A check that cannot fail is not a check.** The first parity script compared its results against `null` and skipped every assertion, so it would have reported success while verifying nothing. Assert unconditionally. If an expected value is missing, that is a failure, not a skip.
- **Run the thing you just wrote at least once.** The same script also had a broken relative path and threw before reaching any logic.
- **Reach for the standard library before writing your own.** The first contract hand-rolled a `U256 { low, high }` struct with its own arithmetic, and the multiply was wrong in a way that would have paid the seller an incorrect amount. Cairo has native `u256`. Use it.
- **Do not set `exit_first = true`.** Across twelve invariants you want every failure, not the first one.
- **Leave the tree clean.** Build output, downloaded SDKs, and unpacked archives do not belong in the repository. Check `git status` before you finish.

---

## Step 0: SDK reality check

Read-only, roughly half an hour, and it runs before anything is built. Sub-account creation is load-bearing for the whole identity claim and neither reference repository demonstrates it. See `docs/reference/NOTES.md` section (b).

This is first because it is the only step whose answer can change the shape of the project. Everything after it assumes the answer is yes.

**Do:**

1. Try to install the Privacy SDK at the pinned version, 0.14.3-rc.4. Confirm it exists on the registry and installs. It is a release candidate, so confirm rather than assume.
2. Read the SDK source and its README. Grep for `subaccount`, `sub_account`, `subaccounts`, `sub_account_anonymizer`.
3. Answer, with file and line references: does `transfers.build().subaccounts(dappName).invoke(...)` exist as described in `ARCHITECTURE.md` section 7? What does it actually return, and what does it require to have been set up first, for example viewing key registration, channels, per-token subchannels?
4. Retry `https://strk20-by-example.org/llms-full.txt` and save it to `docs/reference/strk20-docs.md` if the host is reachable. It refused every connection on day 1.
5. Do not build anything on it in this step. Read, verify, report.

**Done means:** a written answer in `docs/reference/NOTES.md` under question (b), replacing the current "no reference material found", with file and line references.

**Stop and report immediately if:** the package does not exist, does not install, or the subaccounts route is absent. That is not a step 0 problem, it is a project-scope decision, and the documented fallback is strk20-kit. The human decides, not the agent.

---

## Step 1: pin the toolchain

Nothing else starts until versions are frozen. A tutorial four months old will not compile, and drift discovered on day 9 is unrecoverable.

**Do:**

1. **Install the toolchain.** As of the first attempt, `scarb` and `snforge` are not on the machine. Install them, most likely through `starkup` or `asdf`, and confirm `scarb --version` and `snforge --version` both answer.
2. Create the Scarb package under `contracts/`, with a trivial contract that compiles and one snforge test that passes. Hello-world scope: storage a felt, a setter, a getter.
3. Resolve and pin exact versions of Scarb, the Cairo compiler, snforge and `snforge_std`, and OpenZeppelin Cairo. Pin in `Scarb.toml`. Commit `Scarb.lock`.
4. Pin starknet.js in `web/package.json`. Use 10.4.0 or later, because STRK20 support lands in 10.4.0 via `WalletAccountV6`. Do not scaffold the frontend beyond `package.json` at this step.
5. Record every pinned version in the progress log below, with the date resolved.

**Keep the hello-world contract.** It is the target for the step 3 gate, and it is the cheapest possible thing for a sub-account to call. Delete it once the gate has passed, not before.

**Do not guess version numbers.** Resolve what is actually current and installable, then write those down. If a version in `CLAUDE.md` or `ARCHITECTURE.md` turns out not to exist or not to install, that is a finding: report it, do not silently substitute.

**Done means:** `scarb build` and `snforge test` both actually ran and both succeeded, and the exact versions are written in the log. Not that a `Scarb.toml` exists.

---

## Step 2: Poseidon parity, before any auction logic

The cheapest catastrophic bug to prevent. If the encoding differs between Cairo and starknet.js, every contract test still passes and the frontend fails to verify a single commitment on day 9.

**The encoding, fixed, from `ARCHITECTURE.md` section 4:**

- u256 amounts hash as two felts, **low limb first, then high limb**.
- Secrets and salts are 31 random bytes from `crypto.getRandomValues`, interpreted big-endian. 31 bytes is always below the STARK field prime, so no modular reduction and no rejection sampling, and no modulo bias.
- Addresses are single felts, used as-is.
- Poseidon is applied over the ordered array of felts above.

The two hashes:

```
claim_handle    = poseidon(claim_secret, payout_address)
bid_commitment  = poseidon(amount_low, amount_high, bid_salt, claim_handle)
seller_handle   = poseidon(seller_secret, seller_payout_address)
```

**Do:**

1. Pick fixed test vectors. At minimum: a zero amount, a one-wei amount, an amount above 2^128 so the high limb is non-zero, and a max-ish amount. Fixed secrets and a fixed address, written as literals, not generated.
2. Hash each vector in Cairo and in starknet.js. Assert byte equality across the two.
3. Commit the vectors to a single shared JSON file that both sides read. One source of truth, so the two implementations cannot drift apart later.
4. **Fill in the expected values.** A vector file with `null` where the hash should be is not a fixture, and a checker that skips comparison when the expected value is missing passes vacuously. This already happened once. Every vector carries a real `claim_handle` and a real `bid_commitment`, and every assertion runs unconditionally.
5. Report the resulting hashes in the log.

**Done means:** a Cairo test and a TypeScript test both read the same vector file, both ran, and both agree on every value. Demonstrate that the check can fail: change one expected value by one bit and confirm both sides go red. This file becomes the fixed input for step 4.

**Stop and report if:** the two disagree and the cause is not obviously limb order. Do not "fix" it by reordering until the vectors match, because matching the wrong convention is worse than failing loudly.

---

## Step 3: the gate

`ARCHITECTURE.md` section 13. **An SDK-route sub-account, created by the app, calls a contract you wrote and transfers tokens into it.** On Sepolia, on chain, end to end.

Step 0 proves the API exists on paper. This proves the primitive works in practice, and it is the real risk on the project. If it is not working by end of day 3, the sub-account primitive is not usable as documented and Sealed's identity claim is gone.

**Do:**

1. Register a viewing key, open a channel and the per-token subchannel, shield a small amount on Sepolia.
2. Create a sub-account through the SDK route.
3. Private transfer from the shielded balance into that sub-account.
4. From the sub-account, call the hello-world contract from step 1 and transfer tokens into it. Any ERC20 transfer into a contract you wrote counts. It does not need to be the auction.
5. Record the transaction hashes in the log, and confirm on a block explorer that the sub-account has no public link back to the funding wallet.

**Done means:** transaction hashes, on Sepolia, that a third party could follow. Not a local simulation, not a test double.

**Stop and report if it does not work by end of day 3.** Do not keep pushing. The fallback is written down in section 13 precisely because the instinct on day 10 will be to keep going, and that instinct is what loses sprints. This call belongs to the human.

---

## Step 4: the auction contract and its tests

Only after steps 1 and 2. Independent of steps 0 and 3, since v1 custody is ordinary ERC20 and does not depend on the pool. This is the step that parallelises if there is a second agent.

An unverified draft already exists in `contracts/src/auction.cairo`. It has never been compiled. Its shape is broadly right and it respects the non-negotiables, but it hand-rolls a `U256` struct whose multiply is wrong, and it uses entrypoint syntax that will not compile. Treat it as a sketch to read, not a base to build on, and do not assume any line in it is correct because it is already written.

Design is `ARCHITECTURE.md` section 6. Target under 300 lines. Storage, external functions, and the derived `get_entry_status` view are all specified there. Read it rather than inferring from this file.

Use the step 2 vector file as fixed constants in the tests. Do not recompute expected hashes inside the test, because a test that computes its expectation the same way the contract does proves nothing.

**Test the twelve invariants as named tests:**

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

**Fuzz two of them, do not hand-pick numbers:**

- Invariant 5, the running top-two update, including ties, reveals in every order, and reveals below the reserve mixed in.
- Invariant 8, which is a property rather than an example. Fuzz the bid vector across 3 or more bidders.

**Coverage: chase the invariants, not the line count.** Do not target 100 percent. On a 300-line contract that produces tests asserting getters return what was stored, which is where effort goes to die while the real properties stay untested. If a coverage run shows a gap, treat it as a question about why that line is unreachable, not as a hole to plug with an assertion.

**Done means:** `snforge test` green, all twelve named, the two fuzzed, and the contract under 300 lines.

---

## Progress log

Append one entry per step. Record what was done, exact versions or hashes where relevant, and anything found that contradicts `ARCHITECTURE.md`. A contradiction is a finding worth more than a completed step, so write it down rather than working around it.

### Day 1, setup

Repository created, Apache 2.0, registered on the sprint hub as entry 22 of 22. Architecture and scope locked. Day 1 research against the two open questions recorded in `docs/reference/NOTES.md`.

Two findings from that research that change what later steps should assume:

- Multi-user helper custody has a reference implementation after all, `awesome-strk20/pocs/escrow-helper`. It does not change the v1 decision. It changes the stretch in section 9 from an unanswerable question into a readable contract.
- SDK-route sub-accounts have no reference material in either resource reviewed. This is why step 0 exists and why it comes before any work that depends on the primitive.

`strk20-by-example.org` was unreachable, so `docs/reference/strk20-docs.md` does not exist. Retry it at the start of step 0 and save it if the host is back.

### Day 2, first pass, audited

A first pass produced files for the toolchain, parity, and contract steps without executing any of them. Nothing was committed. The step numbering also changed after that pass, so its log entries have been rewritten against the current numbering. What the audit found:

- `scarb` and `snforge` were never installed, so nothing under `contracts/` had been compiled. The pins in `contracts/Scarb.toml` are provisional and unverified.
- `contracts/test_vectors/commitments.json` carried `null` for every `claim_handle` and `bid_commitment`, and the checker skipped comparison when the expected value was null. It would have reported success while verifying nothing.
- The vector script could not run at all. Its relative path resolved to `web/contracts/test_vectors/` rather than the repository root, so it threw before reaching any logic.
- The Privacy SDK was never installed and appears in no manifest, so the sub-account question was untouched.
- Unrelated tooling archives were left unpacked in the repository root, none of it connected to this project.

A scope reconciliation was also recorded, confirming `HACKATHON.md` as authoritative for the deadline and submission fields, and confirming v1 as the commit-reveal variation of RFP-08 with encrypted bid notes, threshold force-reveal, first-price, and multi-unit all out of scope. That is correct and matches `ARCHITECTURE.md` section 8. It is not step 0. Step 0 is the SDK reality check, and it remains not started.

`auction.cairo` from that pass is kept as a sketch. What it got right is worth keeping: no address in `Entry`, `claim` recomputes the handle and pays only the committed address, the two secrets stay separate, `claim` requires `revealed`, state is written before the transfer, `get_entry_status` is derived rather than stored, and the conservation math balances at `N * collateral` in and out. What it got wrong: a hand-rolled `U256` whose `mul_small` is arithmetically incorrect, on the path that pays the seller forfeited collateral, plus `#[external(v0)]` on free functions and other syntax predating Cairo 2.8.

The "rules about calling a step done" section above was written from this pass. Read it before starting anything.

### Step 0

Not started.

### Step 1

Not started. Provisional pins exist in `contracts/Scarb.toml`, unverified, and the toolchain is not installed.

### Step 2

Not started. A vector file and TypeScript helpers exist, but no expected values and no execution on either side.

### Step 3

Not started.

### Step 4

Not started. An unverified draft exists at `contracts/src/auction.cairo`.

### Recovery batch, 15 August 2026

Repository hygiene was rechecked. The stray tooling archives and failed platform
downloads were already absent. Generated `web/dist` and
`contracts/target` output remains ignored and is removed after verification runs.

Scarb was installed through Homebrew. The resolved local versions are Scarb 2.20.0,
Cairo 2.20.0, Sierra 1.9.3, on aarch64-apple-darwin. `Scarb.lock` was generated.
Starknet Foundry 0.63.0 was installed through its official installer, downloaded
and inspected before execution, then run as `sh install.sh` followed by
`snfoundryup`. `snforge` is at `/Users/tino/.local/bin/snforge`, symlinked from
`~/.local/share/starknet-foundry-install/0.63.0/bin/snforge`, and resolves in a
normal login zsh shell. The installer appended a PATH line to `~/.zshenv` and
touched nothing else outside it.

With the manifest still pinned at `snforge_std 0.32.0`, `snforge test` failed at
exit 2 before reaching any Cairo: `snforge_scarb_plugin 0.32.1` pulls
`size-of 0.1.5`, which declares `stdcall` and `fastcall` ABIs unconditionally and
fails to compile under rustc 1.97.1 on aarch64 with E0570. Aligning the dev
dependency from `snforge_std 0.32.0` to `0.63.0` resolved it. The lockfile now
resolves both `snforge_std` and `snforge_scarb_plugin` at 0.63.0.

The provisional OpenZeppelin v0.17.0 dependency failed under Cairo 2.20.0 inside
the dependency graph. The auction does not import OpenZeppelin, so the unused
dependency was removed from the active manifest to expose errors in project code.
`scarb build` then reached `auction.cairo` and failed with 39 errors. The draft has
not been treated as compiling code and Step 4 remains not started.

The TypeScript vector path was corrected and null expectations now fail
unconditionally. Four starknet.js 10.4.0 expected hashes were written to the shared
fixture. `npm run vectors` passes all four. `npm run vectors:negative` flips one bit
in the first expected handle and fails with `zero: claim handle mismatch`, proving
the web-side check can go red. Cairo has not read or verified the fixture yet, so
Step 2 is not complete.

The auction sketch is currently excluded from `lib.cairo` while the toolchain gate
is established. A current-Cairo hello-world contract and smoke test now exist in
`contracts/src/hello.cairo` and `contracts/src/tests.cairo`; `scarb build` passes.
`snforge test` collected and passed `hello_world_smoke_test`: one passed, zero
failed. Step 1's executable toolchain gate is therefore working. The OpenZeppelin
version remains to be resolved before Step 1 can be logged as fully complete.
