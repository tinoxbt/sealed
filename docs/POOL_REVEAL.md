# Proposal: route reveal through the pool

**Status: proposed, not adopted. The design is supported by source analysis but has never been executed as a transaction.** Nothing in `contracts/` or `web/` implements this. Adopting it changes the `privacy_invoke` calldata shape, so it requires a redeploy and a frontend change together.

Written 16 August 2026, day 3, with the contract complete, the Sepolia lifecycle verified, and mainnet not yet attempted.

---

## 1. The leak this closes

`docs/PRIVACY.md` lists it first, because it is the largest practical leak in the design:

> The reveal transaction has an ordinary public sender, and it names both the bid amount and the claim handle.

A bid is unlinkable. The pool calls the auction, a rotating relayer submits the transaction, and no bidder-controlled address appears anywhere. Then the same bidder reveals from their own wallet and welds that wallet to their bid amount permanently, undoing the thing the commit protected.

The interface warns at the moment of revealing, and reveal is permissionless so a careful bidder can submit from an unconnected account or have someone else do it. That is a mitigation, not a fix. It asks every user to understand the threat model and act on it correctly, which most will not.

**The asymmetry is the point.** Sealed spends real design effort making the commit carry no address, then leaves the reveal wide open. Closing it would make the claim "no bidder-controlled address appears in this auction" complete rather than partial.

---

## 2. The design

`reveal` moves no money. It proves a preimage and updates the running top two. So the pool does not need to carry value, only the call.

Frontend composition would become:

```
{ type: "transfer", token: STRK, amount: <small>, recipient: <self> }
{ type: "invoke",   contract: auction, calldata: [REVEAL, amount_low, amount_high, bid_salt, claim_handle] }
```

The transfer exists only to satisfy replay protection, discussed in section 3. The invoke carries the reveal.

The pool becomes the caller, and a relayer submits the transaction, exactly as with a bid. What stays public is the bid amount, which is the entire point of revealing. What stops being public is **who** revealed it.

### The contract change

The pool always dispatches to `selector!("privacy_invoke")`, and the invoke action carries no selector of its own. So one entrypoint has to multiplex, the way the reference escrow helper splits Deposit from Claim:

```cairo
#[derive(Serde, Copy, Drop, PartialEq)]
pub enum PoolOperation {
    Commit,
    Reveal,
}

fn privacy_invoke(
    ref self: ContractState,
    operation: PoolOperation,
    a: felt252,   // Commit: bid_commitment   Reveal: amount_low
    b: felt252,   // Commit: claim_handle     Reveal: amount_high
    c: felt252,   // Commit: ignored          Reveal: bid_salt
    d: felt252,   // Commit: ignored          Reveal: claim_handle
) -> Span<OpenNoteDeposit>;
```

`Commit` keeps taking collateral and verifying arrival against the `escrowed` ledger. `Reveal` takes no value, verifies the commitment exactly as `reveal` does today, and returns an empty span.

The plain `commit` and `reveal` entrypoints stay. They are the fallback if the pool path misbehaves, and the same reasoning that kept `commit` applies here.

**This is a breaking calldata change.** The current shape is `[bid_commitment, claim_handle]` with no discriminator, so a deployed auction and an updated frontend cannot be mixed. Contract and frontend must ship together, with a redeploy.

---

## 3. The assumption, now supported by source analysis

**Claim: the pool accepts an `invoke` action carrying no value.**

Read against `packages/privacy/src/privacy.cairo` at tag `PRIVACY-0.14.3-RC.4`:

`invoke_external` takes only a contract address and calldata, and produces a
single `ServerAction::Invoke`:

```cairo
fn invoke_external(self: @ContractState, input: InvokeExternalInput) -> Array<ServerAction> {
    input.assert_valid();
    let InvokeExternalInput { contract_address, calldata } = input;
    array![ServerAction::Invoke(InvokeInput { contract_address, calldata })]
}
```

It touches no token balances and creates no obligation to move value. The final
`token_balances.squash().assert_valid()` requires balances to net to zero, and
an invoke that moves nothing contributes nothing to net. So a value-free invoke
is structurally supported rather than merely plausible.

**Claim: a self-transfer provides replay protection.**

`assert(has_replay_protection, errors::NO_REPLAY_PROTECTION)` is satisfied by at
least one `ServerAction::WriteOnce`, and in `_client_apply_actions` only
`WriteOnce` sets the flag. `Invoke` explicitly does not:

```cairo
ServerAction::Invoke(_) => {},
```

`WriteOnce` comes from spending a note, via `use_note`. A transfer spends notes;
a deposit only appends. So a composition of transfer plus invoke satisfies it and
a composition of invoke alone does not.

**Claim: returning an empty span is accepted.**

Already proven in production. Sealed's commit path returns an empty
`Span<OpenNoteDeposit>` and has executed successfully on Sepolia.

### What is still unproven

None of the above is an executed transaction. Source analysis says the
composition is well formed; it does not prove the wallet will assemble it, that
the proving service will accept it, or that no additional validation sits
between. **Submit one before writing any Cairo.** The test is a transfer plus an
invoke against the deployed auction, and it costs one Sepolia transaction.

## 4. What this does not fix

- **Bids are still public after reveal.** That is commit-reveal working as designed. Hiding them permanently needs a ZK circuit, which is a different project.
- **Claim amounts still fingerprint the winner.** `collateral - clearing_price` differs from every loser's full collateral, so the winning payout address is identifiable by arithmetic.
- **Reveal timing is still public**, and a lone reveal in a quiet window is weakly linkable regardless of who submits it.

This closes one leak. It is the biggest one, and it is the only one on the list that is an implementation limit rather than a property of the mechanism.

---

## 5. The argument against

**It complicates the money path to fix something that is not on the money path.** `privacy_invoke` currently does one thing and verifies arrival against its own ledger. Multiplexing two operations through one entrypoint means a discriminator that must be right, and a `Reveal` branch that must be certain never to touch collateral. The escrow helper does exactly this and is unaudited.

**It costs the user a pool transaction to reveal.** Proving is slower and more expensive than a plain contract call, and reveal has a deadline. A bidder whose proving fails near the deadline forfeits their collateral, which is a harsher failure than the leak being fixed.

**It requires a redeploy and a synchronised frontend change.** Cheap today, considerably less so once a mainnet auction is live with real money in it.

---

## 6. The cheaper fallback

No contract change at all: reveal from a fresh account with no link to the bidder, funded by an unshield from the pool.

This is available today and needs nothing new. The account is unlinked because the pool broke the link, the reveal names it rather than the bidder's main wallet, and the bidder pays one extra transaction for the privilege.

It is weaker than routing through the pool, because the fresh account still appears and its funding transaction is a public unshield with a timestamp. But it costs nothing to document, and the reveal page could offer it as guidance rather than a bare warning.

---

## 7. Decision

Recommended order:

1. **Verify the assumption in section 3 on Sepolia.** Half an hour, no code.
2. **Only if it holds, and only before mainnet**, implement. Afterwards the redeploy cost changes character.
3. **If time is short, do section 6 instead**, and say plainly in `PRIVACY.md` that the reveal leg is mitigated by user discipline rather than by the protocol.

The honest position today is that Sealed makes bidding unlinkable and asks the bidder to protect the reveal themselves. That is a true statement and a documented one. This proposal would make it unnecessary.
