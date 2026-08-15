# Reference notes

Research notes against the two open questions in `docs/ARCHITECTURE.md`. Reviewed 14 August 2026, day 1.

Sources reviewed:

- https://github.com/Akashneelesh/awesome-strk20, cloned at day 1
- https://github.com/Akashneelesh/strk20-starter-kit, cloned at day 1

`https://strk20-by-example.org/llms-full.txt` could not be fetched. The host refused the connection on every attempt, sandboxed and not, so `strk20-docs.md` is not present. Retry before relying on it.

---

## (a) Multi-user custody in a single anonymizer helper

**Status change. The architecture says there is no documented example. There is one.**

`awesome-strk20/pocs/escrow-helper` is a reference `privacy_invoke` Cairo helper that does exactly the pattern section 9 describes as unverified. Paired application at `pocs/private-escrow`.

What the contract actually does, read from source:

```cairo
struct Storage {
    privacy_contract: ContractAddress,
    commitments: Map<felt252, CommitmentEntry>,   // many depositors, one helper
}
struct CommitmentEntry { token: ContractAddress, amount: u128, claimed: bool }
```

- `privacy_invoke` dispatches on an `EscrowOperation` enum, `Deposit` or `Claim`, from a single entrypoint.
- **Deposit** stores a commitment against tokens the pool already moved in, and returns `[].span()`, the empty `Span<OpenNoteDeposit>`. Tokens stay in the helper.
- **Claim**, at an arbitrary later time, recomputes `poseidon(ESCROW_COMMITMENT_TAG, secret)`, checks the entry exists and is unclaimed, marks it claimed, approves the pool to pull the tokens, and returns a populated `[OpenNoteDeposit { note_id, token, amount }].span()`.
- `note_id` is supplied in the claim calldata, so the payout destination is decided at claim time, not at deposit time.
- Access control is a single assert that the caller is the pool.

This answers the question section 9 poses almost word for word: a `note_id` from a deposit at T0 carried forward and filled by an independent claim at T1, with a `Map` keyed by commitment hash holding many depositors' funds simultaneously. The commitment-hash keying is the same shape as Sealed's `claim_handle` keying.

Caveats, and they matter before anything is rebuilt on this:

- It is labelled a reference implementation, not production code. The repository says production helpers are owned, reviewed, and audited by each builder.
- It does not build standalone. It depends on `privacy = { path = "../privacy" }`, the pool Cairo library, which is not bundled in that repository.
- Amounts are `u128`, not `u256`. Sealed uses `u256` throughout. Any adoption needs a conversion boundary with an explicit bound check.
- Its own tests cover deposit, claim, double claim, wrong secret, caller checks, duplicate commitment, and zero-value rejection. There is **no test of interleaved multi-user deposits and claims**, which is the specific property Sealed would depend on. Existence of the pattern is not proof the pool tolerates it under contention.
- StarkWare's stated guidance that helpers should be small and should not hold user funds long-term is unchanged. An auction holds collateral for the whole bidding and reveal window, which is precisely long-term.
- The claim path calls `approve` on the token and returns the deposit instruction in the same call. Sealed's forfeiture logic, where an unrevealed entry pays the seller instead of the depositor, has no analogue here. That logic would have to live somewhere.

**Recommendation: do not reopen v1.** The v1 decision to use ordinary ERC20 custody stands, for the reason it was made, which was that the dependency was unconfirmed and could sink the project. What changes is the stretch in section 9: it is no longer a question only the protocol engineers can answer. There is source to read and a test suite to extend. If v1 is complete before day 12, the stretch now starts from a working reference rather than from nothing.

This is also the strongest candidate for the "another team depends on something you published" credit in the judging criteria. `HELPER_CUSTODY.md` should cite this contract, state the multi-user gap in its tests, and record whatever the extension shows.

Also worth lifting: the private-escrow README publishes a per-on-chain-artifact leak table, and names its own residual leaks as sender address and gas payer, unique-amount matching, and deposit-to-claim timing correlation. Its stated mitigations are fixed denominations, larger anonymity sets, time delay, and relayer submission. Fixed denominations is Sealed's uniform collateral arriving at the same answer independently. The relayer point is not currently in Sealed's leak list and probably should be, since the commit transaction's gas payer is visible.

---

## (b) SDK-route sub-account creation

**Answered 15 August 2026, step 0. The primitive exists. The custody model in `ARCHITECTURE.md` section 2 does not match how it works.**

Source: `https://github.com/starkware-libs/starknet-privacy`, cloned and checked out at tag `PRIVACY-0.14.3-RC.4`, commit `722d1cf`, dated 22 July 2026. The pinned version is real and the repository is public. All line references below are at that tag.

### The API exists, with a different signature than section 7 assumes

`sdk/src/interfaces.ts:727` declares `subaccounts(dappName: string | BigNumberish): SubAccountsBuilder` on `PrivateTransfersBuilder`. The builder itself is at `sdk/src/interfaces.ts:534`, with three methods:

- `partialCommitment(): Promise<bigint>`, returning `hash(identity_key, dappName)`, computed locally in TypeScript with no contract call.
- `commitment(nonce): Promise<bigint>`, returning `hash(partialCommitment, nonce)`, also local.
- `invoke(nonce, { calls, collectPolicy? }): PrivateTransfersBuilder`.

Note the shape. It is `invoke(nonce, { calls })`, not the bare `invoke(...)` in section 7, and it returns the parent builder rather than a sub-account, so a call chain ends in `.execute()`. Implementation at `sdk/src/internal/builders.ts:226`. Working usage at `sdk/tests/internal/sub-accounts.test.ts:54`:

```
await transfers.build().subaccounts(dappName).invoke(nonce, { calls }).execute()
```

`identify()` and `deployed()` are declared but not implemented at this version, per `sdk/CHANGELOG.md:17`.

### What a sub-account actually is

`packages/sub_account_anonymizer/src/sub_account_anonymizer.cairo:1-8` states it plainly. Each identity commitment maps to a dedicated `SubAccount` contract that performs the dapp calls and holds the resulting funds. Sub-accounts are real deployed contracts with addresses, deployed on first use, and `get_sub_accounts` (line 153) resolves `{nonce, address, is_deployed}` for a nonce range, returning the deterministic address a sub-account *would* deploy to before it exists.

That last property is directly useful: **a payout sub-account address can be computed and bound into `claim_handle` at commit time without deploying it first**, which is exactly what `ARCHITECTURE.md` section 4 requires.

Identity derivation is two-stage Poseidon, `hash(hash(identity_key, dapp_name), nonce)`, at lines 48 to 56. `dapp_name` scopes sub-accounts per dapp, `nonce` gives one identity many sub-accounts.

### The problem: sub-accounts cannot transact on their own

Line 7: "Driving interactions is restricted to the configured privacy contract." Line 113 makes it a precondition, and `UNAUTHORIZED_CALLER` at line 115 enforces it.

A sub-account is not an account you send transactions from. The only way it acts is the pool calling `privacy_invoke_with_computation` on the anonymizer (line 126), which runs `calls` as the sub-account, then collects the requested tokens back out of it into the anonymizer, and approves the pool to pull them into open notes. One atomic transaction.

`ARCHITECTURE.md` section 2 draws the collateral leg as the sub-account performing an ordinary `ERC20 transfer_from` into the auction contract, where it sits for days. That is not available as drawn. The sub-account can only act inside a pool-driven transaction.

**This is survivable, and probably cheaply.** `open_notes` is a `Span<OpenNote>` and collection is per note, so an empty span collects nothing and no revert fires. `ZERO_BALANCE` (line 118) is per note, `NEGATIVE_DIFF` (line 120) only applies to `CollectPolicy::Diff`, and `INSUFFICIENT_BALANCE` (line 122) only to `Exact`. `sdk/tests/internal/sub-accounts.test.ts:150` executes an invoke with no open-note creation at all. So a commit should be expressible as: fund the sub-account by private transfer, then one pool-driven invoke whose `calls` are `approve` plus `commit` on the auction contract, with no open notes, leaving the collateral in the auction contract.

That needs proving on Sepolia. It is the step 3 gate, and the gate should now be written as this specific transaction rather than the vaguer "sub-account calls your contract".

The claim leg is unaffected: `claim` takes `(claim_secret, payout_address)` and can be sent by anyone, so it does not need to originate from a sub-account.

### Setup required before any of this works

- `subAccountAnonymizerAddress` in the `createPrivateTransfers` config, `sdk/src/factory.ts:51-54`. Calling `subaccounts(...)` without it throws, asserted at `sdk/tests/internal/sub-accounts.test.ts:160`.
- The standard pool prerequisites the same factory config demands at `sdk/src/factory.ts:45-49`: `viewingKeyProvider`, `provingProvider`, `discoveryProvider`, and `poolContractAddress`.
- Registration, channel and per-token subchannel setup, and a shielded balance to fund the sub-account from.

### The finding that costs time

**No deployed anonymizer address exists anywhere in the repository.** Every reference to `subAccountAnonymizerAddress` outside the factory definition is a test using a mock constant. There is no mainnet or Sepolia deployment recorded.

`sub_account_anonymizer` is a Cairo package in this repository, so it can be built and deployed, but that means Sealed either deploys and maintains its own anonymizer or finds a canonical deployed one. Deploying our own is a Cairo contract we did not plan for, on top of the auction contract, and it is a contract that holds funds transiently. Ask in the Cairo CoreStars Telegram, `@sncorestars`, whether a canonical deployment exists before building one.

### Verdict

The identity claim survives. Sub-accounts are real, unlinkable, addressable in advance, and drivable from our own app through the SDK. Two things changed:

1. The custody diagram in section 2 needs correcting. The collateral leg is a pool-driven invoke, not a standalone transfer from the sub-account.
2. The anonymizer deployment is unresolved and is now the largest unknown on the critical path.

Neither is a reason to fall back to strk20-kit. Both are reasons the step 3 gate should happen immediately.

### Still unreachable

`https://strk20-by-example.org/llms-full.txt` refused the connection again on 15 August 2026, `http_code=000`, zero bytes. `docs/reference/strk20-docs.md` still does not exist. This is the second failed attempt across two days, so treat the host as unavailable rather than temporarily down.

---

## Incidental findings

- **starknet.js placeholder handling.** In the starter kit's invoke path, the literal strings `"OPEN"`, `"${poolAddress}"`, and `"${openNoteIds[0]}"` are substituted by the wallet and must never be passed through `num.toHex`. Only real token addresses and amounts get hex-normalised. This is the kind of detail that costs an afternoon.
- **Mainnet pool address**, from the awesome list: `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`. Verify independently before sending anything to it.
- **Sealed-bid auctions are an official RFP**, at https://strk20.starknet.io/rfp/sealed-bid-auctions. Its framing is bids as encrypted notes, invisible even to the auctioneer, covering first-price, Vickrey, and multi-unit, with the phrase "no commit-reveal griefing". Sealed is commit-reveal and does not attempt the stronger property. Section 8's scope boundary already states this. Keep stating it, since the RFP text sets a judge's expectation that the README has to meet head on rather than dodge.
- The whitepaper, "Scalable Compliant Privacy on Starknet", is at https://eprint.iacr.org/2026/474 if the note or channel model needs settling.
