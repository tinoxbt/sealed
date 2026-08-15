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

**No reference material found. This is now the sharpest risk on the project.**

`grep -ri "sub_account|subaccount|sub-account"` across both repositories returns nothing. Neither the awesome list nor the starter kit mentions sub-accounts, `sub_account_anonymizer`, or the `transfers.build().subaccounts(dappName).invoke(...)` call in section 7 of the architecture.

What the starter kit does instead is the **Wallet API route**, not the SDK route: `WalletAccountV6` with starknet.js v10, `get-starknet` v6 discovery, and shield, unshield, private transfer, and balance operations performed through the user's wallet so the app never touches a viewing key. Useful, but a different integration route from the one Sealed depends on, and the architecture already records that the Wallet API sub-account route is unavailable.

The awesome list positions the two routes explicitly: the Privacy SDK is the low-level route for wallets and advanced integrators, and normal dapps should use the Privacy Wallet API. Sealed is deliberately on the low-level route because it needs to mint sub-accounts itself rather than ask a user's wallet for one. That choice is sound and it is also the reason no example exists to copy.

Consequences:

- The day 3 gate is load-bearing exactly as written and should not slip. It is the only evidence that the primitive works as documented.
- The primary source is the Privacy SDK repository itself, https://github.com/starkware-libs/starknet-privacy, which was not part of this review. Read its `sdk/README.md` and grep for the subaccounts builder before day 3.
- The pinned version, 0.14.3-rc.4, is a release candidate. Check it is actually published and installable before writing code against it.
- Note the version tension: awesome-strk20 points at starknet.js v10.4.0 for STRK20 support, while `CLAUDE.md` pins starknet.js without a version. Pin it explicitly on day 1 alongside Scarb and snforge.
- If the gate fails, the documented fallback is strk20-kit. The starter kit reviewed here is a reasonable base for that fallback: it already has the wallet picker, shield, unshield, and private transfer working through the Wallet API.

Ask in the Cairo CoreStars Telegram, `@sncorestars`, or open an issue on the sprint repository, rather than burning day 3 on discovery. Both are listed as monitored daily.

---

## Incidental findings

- **starknet.js placeholder handling.** In the starter kit's invoke path, the literal strings `"OPEN"`, `"${poolAddress}"`, and `"${openNoteIds[0]}"` are substituted by the wallet and must never be passed through `num.toHex`. Only real token addresses and amounts get hex-normalised. This is the kind of detail that costs an afternoon.
- **Mainnet pool address**, from the awesome list: `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`. Verify independently before sending anything to it.
- **Sealed-bid auctions are an official RFP**, at https://strk20.starknet.io/rfp/sealed-bid-auctions. Its framing is bids as encrypted notes, invisible even to the auctioneer, covering first-price, Vickrey, and multi-unit, with the phrase "no commit-reveal griefing". Sealed is commit-reveal and does not attempt the stronger property. Section 8's scope boundary already states this. Keep stating it, since the RFP text sets a judge's expectation that the README has to meet head on rather than dodge.
- The whitepaper, "Scalable Compliant Privacy on Starknet", is at https://eprint.iacr.org/2026/474 if the note or channel model needs settling.
