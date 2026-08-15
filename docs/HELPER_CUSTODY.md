# Helper custody: findings, and a proposed change

**Status: proposed, not adopted.** This changes a non-negotiable in `CLAUDE.md`
and section 0 of `ARCHITECTURE.md`, so it needs an explicit instruction before
any code moves. Nothing in `contracts/` has been changed.

Written 15 August 2026, day 2 of the sprint, with the auction contract complete
and 24 tests green.

---

## 1. The question this file was reserved for

`ARCHITECTURE.md` section 0 ruled out `privacy_invoke` custody in v1 because
multi-user custody in a single helper was not an established primitive. The
precise unknown was stated in section 9:

> whether a `note_id` from a deposit at T0 can be carried forward and filled by
> an independent claim at T1, after other users have deposited into the same
> helper

That is a real unknown and it remains one. **The proposal below does not depend
on it.**

## 2. What research established

Two findings, recorded in full in `docs/reference/NOTES.md` sections (a) and (d).

**A multi-user helper reference exists.** `awesome-strk20/pocs/escrow-helper` is a
`privacy_invoke` contract holding many independent depositors' entries in one
`Map<felt252, CommitmentEntry>`, deposited at T0 and claimed at T1 by independent
callers. It is a reference implementation, unaudited, and depends on a `privacy`
Cairo library that is not bundled. It is not proof the pattern is production
ready. It is proof the pattern is not forbidden.

**The Wallet API action union composes.** `STRK20_ACTION` has four members, and a
dapp submits an array of them as one transaction:

- `deposit`, documented "Always to self", no recipient field
- `withdraw`, to an arbitrary public `recipient`
- `transfer`, private, inside the pool
- `invoke`, an arbitrary `contract` plus `calldata`, always dispatched to
  `selector!("privacy_invoke")`

`strk20-starter-kit` composes `withdraw` then `transfer OPEN` then `invoke` in a
single submission. Because all four are in the Wallet API union, the user's
wallet performs the proving. **No self-hosted prover is required.**

## 3. The proposed change

Add one entrypoint to the auction contract. Do not remove or alter `commit`.

```cairo
/// Called by the privacy pool via selector!("privacy_invoke").
/// The pool has already transferred collateral to this contract by a preceding
/// withdraw action in the same transaction.
fn privacy_invoke(
    ref self: ContractState,
    bid_commitment: felt252,
    claim_handle: felt252,
) -> Span<OpenNoteDeposit>;
```

Frontend composition for a bid becomes two actions in one transaction:

```
{ type: "withdraw", token: STRK,    amount: collateral, recipient: auction }
{ type: "invoke",   contract: auction, calldata: [bid_commitment, claim_handle] }
```

The pool moves the collateral and calls the auction atomically. If either half
reverts, both revert, and the bidder's funds stay in the pool.

The returned span is **empty**. No note is created, no `note_id` is stored, and
nothing is carried across time. Collateral stays in the auction contract as
ordinary ERC20 until `claim`, exactly as it does today.

### Why this sidesteps the unknown

`claim` and `claim_proceeds` are untouched. They pay a public address by ordinary
ERC20 transfer, authorised by recomputing the Poseidon handle. The bidder's
payout address is an ordinary account that can re-shield afterwards through the
wallet, as a separate transaction of their own choosing.

So the T0-to-T1 note lifecycle never occurs. The only thing `privacy_invoke` does
is receive, and receiving is the half the escrow reference demonstrates.

## 4. Arrival verification, the part that must be right

The reference escrow helper takes the deposited `amount` from calldata and trusts
it, guarded only by `caller == pool`. But **the user composes the action array**,
so nothing visible in that contract prevents a `withdraw` of 1 paired with an
`invoke` claiming 100. Whether the pool cross-checks the two is not documented in
any material reviewed. Sealed must not depend on it either way.

Sealed therefore takes no amount from calldata at all. It verifies arrival
against its own ledger:

```
escrowed: u256          // new storage, total collateral received

// in both commit paths, before recording the entry:
assert(token.balance_of(get_contract_address()) >= escrowed + collateral, ...);
escrowed += collateral;
```

`commit` keeps its `transfer_from` and satisfies the same assertion trivially.
The invoke path satisfies it only if the pool really did deliver.

**Known and accepted:** if someone donates `collateral` to the contract, that
donation can fund one commit that made no withdraw. This is not an exploit. The
donor has paid the collateral, the entry is worth exactly the collateral, and the
funds are distributed by the normal rules. It is an unusual payment route, not a
loss. Stating it here rather than pretending the check is tighter than it is.

## 5. What does not change

Storage keys, `reveal`, `settle`, `claim`, `claim_proceeds`, `cancel`, the derived
`get_entry_status` view, the Poseidon encoding, and all twelve invariants. Both
commit paths produce an identical `Entry` and increment the same counter, so
every existing test stays valid and every invariant keeps its meaning.

The contract still never stores a bidder address. `privacy_invoke` is called by
the pool, so `get_caller_address()` is the pool, and it is used only for the
authorisation check. It is never written to storage.

## 6. Tests this requires

Beyond the existing 24:

1. `privacy_invoke` rejects a caller that is not the pool.
2. `privacy_invoke` rejects when the collateral did not arrive.
3. An entry created by `privacy_invoke` is byte-identical to one created by
   `commit`, and reveals, settles and claims the same way.
4. Invariant 1 holds across a mixed auction, some entries by each path.
5. `fuzz_invariant_8_conservation` extended so each bidder picks a path from the
   fuzz input. Conservation must not depend on which path was used.
6. `privacy_invoke` is rejected after `close_time`, same as `commit`.

## 7. The argument against

A second entrypoint on a money path is a second way to create an entry, and
therefore a second way to get invariant 1 wrong. The current contract has one
funding path and it is `transfer_from`, which is boring and well understood.

The auction is finished and green five days ahead of plan. This spends some of
that lead. If it goes badly, the lead is what absorbs it, which is the argument
for doing it now rather than on day 10.

## 8. Why it is still worth doing

**Judging.** Integration depth is 30 percent and names anonymizer contracts
explicitly. This makes the auction contract one, at no infrastructure cost.
Sub-accounts would score the same criterion but require a self-hosted prover on a
48 vCPU instance for the rest of the sprint.

**Privacy.** One public leg into the auction instead of two. Withdrawing to a
fresh account and committing from it exposes an unshield event and a separate
commit transaction. This exposes one pool-driven transaction, and the bidder
never needs a funded account of their own.

**Contribution.** No documented multi-user `privacy_invoke` helper exists. One
that also fixes the amount-trust weakness in the reference is the strongest
candidate this project has for being useful to another team.

## 9. The fallback stays live

Because `commit` is kept, option B works against the same deployed contract with
no redeploy: unshield the collateral to a fresh account, then `approve` and
`commit` from it. If the invoke path misbehaves on mainnet, the frontend switches
and the auction still runs.

That is the reason for adding an entrypoint rather than replacing one.

## 10. Decision required

Adopt, reject, or defer. Adopting means an explicit instruction to change the
`No privacy_invoke custody in v1` line in `CLAUDE.md` and the corresponding row in
`ARCHITECTURE.md` section 0.

Estimated cost: half a day, including the six tests above.
