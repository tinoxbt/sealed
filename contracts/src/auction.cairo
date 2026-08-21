//! Sealed-bid, second-price auction.
//!
//! One item, one round, one token. The highest valid bid wins and pays the
//! second-highest valid bid, or the reserve if only one bid was valid.
//!
//! Two properties this file is responsible for, both easy to break by
//! accident:
//!
//! 1. **No bidder address is ever stored.** Entries are keyed by `claim_handle`
//!    alone. A `ContractAddress` in `Entry` would publish a depositor-to-
//!    position map and destroy the privacy property the project exists for.
//! 2. **Payouts go only where they were committed.** `claim` recomputes
//!    `poseidon(claim_secret, payout_address)` and requires it to equal the
//!    stored handle. Never pay `get_caller_address`, and never accept a
//!    caller-supplied destination. This is what stops a pending claim from
//!    being raced once its secret is visible in calldata.
//!
//! Hash encoding is fixed and verified against starknet.js by
//! `poseidon_parity_with_starknet_js`. u256 amounts hash as two felts, low limb
//! first. Addresses are single felts.
//!
//! ## Conservation of funds, for review
//!
//! The contract takes in exactly `collateral` per commitment and never mints,
//! so with `N` commitments it holds `N * collateral`. Let `R` be the number of
//! entries revealed and `F = N - R` the number forfeited. Exactly one revealed
//! entry is the winner, when `R > 0`.
//!
//! Payouts:
//!
//! - each of the `R - 1` losing entries claims `collateral`
//! - the winning entry claims `collateral - clearing_price`
//! - the seller claims `clearing_price + F * collateral`
//!
//! Summing: `(R - 1) * collateral + collateral - clearing + clearing + F *
//! collateral = (R + F) * collateral = N * collateral`. In equals out, and
//! `clearing_price` cancels, so it cannot be paid twice or dropped.
//!
//! When `R = 0` there is no winner, `clearing_price` is zero, `F = N`, and the
//! seller claims the whole pot. The same arithmetic holds with no special case.
//!
//! `clearing_price <= collateral` always, because a reveal is rejected unless
//! `reserve <= amount <= collateral` and the clearing price is either a revealed
//! amount or the reserve, and the reserve is capped at the collateral in the
//! constructor. So `collateral - clearing_price` never underflows.
//!
//! Each entry pays at most once (`claimed` flag) and the seller at most once
//! (`seller_claimed`), so the sum above is an upper bound, not just an
//! expectation. `fuzz_invariant_8_conservation` asserts both directions: that
//! payouts never exceed the escrow, and that nothing is left stranded.
//!
//! ## The encrypted backup blob
//!
//! Each entry may carry an opaque blob, written once at commit and readable by
//! anyone. The contract performs no cryptography on it and cannot interpret it:
//! it stores felts and hands them back.
//!
//! It exists because the secrets that authorise a reveal and a claim are
//! generated in the browser and stored nowhere else. A cleared browser or a
//! lost file makes a bid unrevealable and its collateral unrecoverable. The
//! client encrypts those secrets under a key it can reproduce, and puts the
//! ciphertext here, where losing a device cannot destroy it.
//!
//! Two properties this contract is responsible for, and only these two:
//!
//! 1. **A blob is fixed size or absent.** A variable length would say how much
//!    the bidder stored, and therefore something about how they stored it. Every
//!    blob is exactly `BACKUP_WORDS` felts so they are indistinguishable, and
//!    the client pads with random bytes when it has less to say.
//! 2. **A blob is written once.** It is set inside the same call that creates
//!    the entry, and a handle cannot be committed twice, so nothing can
//!    overwrite another bidder's backup.
//!
//! Reading it is deliberately unrestricted. Recovery works by fetching every
//! blob in an auction and trying to decrypt each one, and only the owner's key
//! opens the owner's blob. A getter that asked who was calling would defeat
//! that, and could not be trusted anyway.
//!
//! ## External call ordering
//!
//! Every state change is written before the ERC20 call that follows it, so a
//! reentrant token cannot observe a stale `claimed` or `seller_claimed` flag.
//! The token is fixed at construction and is expected to be STRK, but the
//! ordering does not depend on the token behaving.

use starknet::ContractAddress;

#[derive(Drop, Serde, Copy, PartialEq, starknet::Store)]
pub enum AuctionState {
    #[default]
    Open,
    Settled,
    Cancelled,
}

/// Resolution of a single entry. Derived on read, never stored: a stored copy
/// would be a second source of truth alongside `revealed` and `claimed`.
#[derive(Drop, Serde, Copy, PartialEq)]
pub enum EntryStatus {
    /// No such entry.
    Unknown,
    /// Committed, not yet revealed, auction not settled.
    Committed,
    /// Revealed, auction not yet settled.
    Revealed,
    /// Settled, holds the winning bid.
    Won,
    /// Settled, revealed but did not win.
    Lost,
    /// Settled, never revealed. Collateral belongs to the seller.
    Forfeited,
    /// Already paid out.
    Claimed,
}

/// What the winner pays.
///
/// RFP-08 names first-price, Vickrey and multi-unit. The first two differ only
/// in this one number, so they share a contract. Multi-unit does not: it breaks
/// the single-winner assumption that most of the invariants rest on, and is out
/// of scope.
///
/// Serialises as its variant index: Vickrey 0, FirstPrice 1.
#[derive(Drop, Serde, Copy, PartialEq, starknet::Store)]
pub enum AuctionKind {
    /// Second-price. The winner pays the runner-up's bid, so bidding your true
    /// value is the dominant strategy.
    #[default]
    Vickrey,
    /// The winner pays their own bid. Simpler to explain, and it gives bidders
    /// a reason to shade below their true value.
    FirstPrice,
}

/// Which auction operation a pool-driven call is performing.
///
/// The pool always dispatches to `selector!("privacy_invoke")` and the wallet's
/// invoke action carries no selector of its own, so one entrypoint multiplexes
/// and the first calldata felt says which. Serialises as its variant index:
/// Commit 0, Reveal 1, Claim 2.
#[derive(Drop, Serde, Copy, PartialEq)]
pub enum PoolOperation {
    Commit,
    Reveal,
    Claim,
}

/// Must match `privacy::objects::OpenNoteDeposit` positionally. The pool
/// deserialises whatever `privacy_invoke` returns using its own definition, so
/// field order is part of the ABI contract, not a local choice.
#[derive(Drop, Serde, Copy)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[derive(Drop, Serde, Copy, starknet::Store)]
pub struct Entry {
    pub bid_commitment: felt252,
    pub amount: u256,
    pub revealed: bool,
    pub claimed: bool,
}

#[starknet::interface]
pub trait ISealedAuction<TContractState> {
    /// `backup` is an opaque ciphertext, either empty or exactly
    /// `BACKUP_WORDS` felts. The contract never interprets it.
    fn commit(
        ref self: TContractState,
        bid_commitment: felt252,
        claim_handle: felt252,
        backup: Span<felt252>,
    );
    /// Called by the pool. Fixed arity across all three operations so the
    /// calldata shape never depends on the operation, and unused slots must be
    /// zero so a frontend that shifts its arguments reverts instead of
    /// committing to something nobody meant.
    ///
    /// Commit  a = bid_commitment  b = claim_handle    c,d = 0
    /// Reveal  a = amount_low      b = amount_high     c = bid_salt  d = claim_handle
    /// Claim   a = claim_secret    b = payout_address  c,d = 0
    ///
    /// `backup` trails the fixed five and is length-prefixed, so it cannot
    /// shift the meaning of anything before it. Only Commit may carry one;
    /// Reveal and Claim must pass it empty.
    fn privacy_invoke(
        ref self: TContractState,
        operation: PoolOperation,
        a: felt252,
        b: felt252,
        c: felt252,
        d: felt252,
        backup: Span<felt252>,
    ) -> Span<OpenNoteDeposit>;
    fn reveal(ref self: TContractState, amount: u256, bid_salt: felt252, claim_handle: felt252);
    fn settle(ref self: TContractState);
    fn claim(ref self: TContractState, claim_secret: felt252, payout_address: ContractAddress);
    fn claim_proceeds(
        ref self: TContractState, seller_secret: felt252, payout_address: ContractAddress,
    );
    fn cancel(ref self: TContractState, seller_secret: felt252, payout_address: ContractAddress);

    fn get_entry_status(self: @TContractState, claim_handle: felt252) -> EntryStatus;
    fn get_state(self: @TContractState) -> AuctionState;
    fn get_clearing_price(self: @TContractState) -> u256;
    fn get_winner_handle(self: @TContractState) -> felt252;
    fn get_commitment_count(self: @TContractState) -> u32;
    fn get_revealed_count(self: @TContractState) -> u32;
    fn get_collateral(self: @TContractState) -> u256;
    fn get_escrowed(self: @TContractState) -> u256;
    fn get_reserve_price(self: @TContractState) -> u256;
    /// (close_time, reveal_deadline). Returned together because a caller
    /// deciding which phase the auction is in needs both, and two round trips
    /// can straddle a phase change and produce a state that never existed.
    fn get_timing(self: @TContractState) -> (u64, u64);
    /// What the winner pays. A bidder needs this before bidding, because it
    /// changes whether shading below your true value is rational.
    fn get_kind(self: @TContractState) -> AuctionKind;
    /// The stored ciphertext for an entry, or an empty array if it has none.
    /// Public on purpose: recovery is trial decryption over every blob.
    fn get_backup(self: @TContractState, claim_handle: felt252) -> Array<felt252>;
}

#[starknet::contract]
pub mod SealedAuction {
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use super::super::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use super::{AuctionKind, AuctionState, Entry, EntryStatus, OpenNoteDeposit, PoolOperation};

    /// Length of an encrypted backup, in felts. Fixed so every blob looks the
    /// same on chain.
    ///
    /// Sized for the client's payload: three secrets and a payout key, under an
    /// AEAD nonce and tag, plus several wrapped copies of the data key so that
    /// more than one thing can open it. The client pads to this length.
    ///
    /// Changing it is a redeploy. That is the cost of the uniformity above.
    pub const BACKUP_WORDS: u32 = 12;

    pub mod errors {
        pub const NOT_OPEN: felt252 = 'auction not open';
        pub const CLOSED: felt252 = 'bidding closed';
        pub const DUPLICATE_HANDLE: felt252 = 'handle already used';
        pub const TRANSFER_FAILED: felt252 = 'token transfer failed';
        pub const NOT_REVEALING: felt252 = 'not in reveal window';
        pub const UNKNOWN_ENTRY: felt252 = 'unknown entry';
        pub const ALREADY_REVEALED: felt252 = 'already revealed';
        pub const AMOUNT_OUT_OF_BOUNDS: felt252 = 'amount out of bounds';
        pub const BAD_COMMITMENT: felt252 = 'commitment mismatch';
        pub const TOO_EARLY: felt252 = 'reveal window still open';
        pub const NOT_SETTLED: felt252 = 'auction not settled';
        pub const NOT_CLAIMABLE: felt252 = 'entry not claimable';
        pub const ALREADY_CLAIMED: felt252 = 'already claimed';
        pub const BAD_SELLER_HANDLE: felt252 = 'bad seller handle';
        pub const CANNOT_CANCEL: felt252 = 'cannot cancel now';
        pub const BAD_DEADLINES: felt252 = 'bad deadlines';
        pub const ZERO_COLLATERAL: felt252 = 'zero collateral';
        pub const RESERVE_ABOVE_COLLATERAL: felt252 = 'reserve above collateral';
        pub const BAD_BACKUP_LENGTH: felt252 = 'bad backup length';
        pub const REVEAL_WINDOW_TOO_SHORT: felt252 = 'reveal window too short';
        pub const NOT_POOL: felt252 = 'caller not pool';
        pub const NOT_RECEIVED: felt252 = 'collateral not received';
        pub const UNUSED_ARGS: felt252 = 'unused args must be zero';
        pub const ZERO_COMMITMENT: felt252 = 'zero bid commitment';
        pub const ZERO_HANDLE: felt252 = 'zero claim handle';
    }

    /// Shortest reveal window a seller may set.
    ///
    /// The seller receives every forfeited collateral AND chooses the reveal
    /// deadline. Without a floor those two facts combine into an attack: set
    /// the deadline one second after close, nobody can reveal in time, every
    /// entry forfeits, and the seller takes the whole pot without selling
    /// anything.
    ///
    /// Ten minutes stops the absurd case. It is not a substitute for the
    /// bidder reading the window before they bid, which is why the interface
    /// shows it. A seller running a real auction should allow hours or days,
    /// and MECHANISM.md says so.
    pub const MIN_REVEAL_WINDOW: u64 = 600;

    #[storage]
    struct Storage {
        // Seller identity is a handle, exactly like a bidder's. No address.
        seller_handle: felt252,
        seller_claimed: bool,
        token: ContractAddress,
        // The privacy pool, the only address allowed to call privacy_invoke.
        // Stored at construction and never taken from calldata.
        pool: ContractAddress,
        // Total collateral this contract has accepted. Both commit paths verify
        // arrival against this rather than trusting any caller-supplied amount.
        escrowed: u256,
        reserve_price: u256,
        collateral: u256,
        close_time: u64,
        reveal_deadline: u64,
        kind: AuctionKind,
        state: AuctionState,
        // Keyed by claim_handle. Never by address.
        //
        // Absence is represented by bid_commitment == 0 rather than a separate
        // exists flag. A real commitment is a Poseidon output, so zero is
        // unreachable in practice, and a caller cannot forge one because the
        // preimage would have to hash to zero.
        entries: Map<felt252, Entry>,
        // Keyed by (claim_handle, word index). A Map rather than a Vec because
        // blobs are per entry, not a single list, and the fixed length means no
        // separate length needs storing.
        backups: Map<(felt252, u32), felt252>,
        has_backup: Map<felt252, bool>,
        commitment_count: u32,
        revealed_count: u32,
        highest_bid: u256,
        second_highest_bid: u256,
        winner_handle: felt252,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Committed: Committed,
        Revealed: Revealed,
        Settled: Settled,
        Claimed: Claimed,
        ProceedsClaimed: ProceedsClaimed,
        Cancelled: Cancelled,
        AuctionCreated: AuctionCreated,
    }

    #[derive(Drop, starknet::Event)]
    struct Committed {
        #[key]
        claim_handle: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct Revealed {
        #[key]
        claim_handle: felt252,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Settled {
        #[key]
        winner_handle: felt252,
        clearing_price: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Claimed {
        #[key]
        claim_handle: felt252,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct ProceedsClaimed {
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Cancelled {}

    /// Emitted once, at construction, so auctions can be found without a
    /// backend or a factory.
    ///
    /// A getEvents query filtered on this event's key alone, with no contract
    /// address, returns every Sealed auction ever deployed, because the event
    /// key is the same for all of them and the auction's own address arrives as
    /// the event's from_address. That is the whole discovery mechanism: no
    /// registry to keep in sync, nothing to go stale, and it survives any
    /// off-chain service being down.
    #[derive(Drop, starknet::Event)]
    pub struct AuctionCreated {
        #[key]
        pub token: ContractAddress,
        pub reserve_price: u256,
        pub collateral: u256,
        pub close_time: u64,
        pub reveal_deadline: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        seller_handle: felt252,
        token: ContractAddress,
        pool: ContractAddress,
        reserve_price: u256,
        collateral: u256,
        close_time: u64,
        reveal_deadline: u64,
        kind: AuctionKind,
    ) {
        // Same reasoning as the zero guards on commit. claim_proceeds
        // authorises by recomputing poseidon(seller_secret, payout), and no
        // caller can produce a preimage hashing to zero, so a zero handle here
        // means the seller can never be paid and their proceeds sit in the
        // contract forever. Bidders are unaffected, which is why this is a
        // footgun rather than an attack, but it has no recovery path.
        assert(seller_handle != 0, errors::ZERO_HANDLE);
        assert(close_time < reveal_deadline, errors::BAD_DEADLINES);
        // Not merely ordered: far enough apart that revealing is possible.
        assert(
            reveal_deadline - close_time >= MIN_REVEAL_WINDOW, errors::REVEAL_WINDOW_TOO_SHORT,
        );
        assert(collateral > 0, errors::ZERO_COLLATERAL);
        // Bids are capped at the collateral, so a reserve above it would make
        // every possible bid invalid.
        assert(reserve_price <= collateral, errors::RESERVE_ABOVE_COLLATERAL);

        self.seller_handle.write(seller_handle);
        self.token.write(token);
        self.pool.write(pool);
        self.reserve_price.write(reserve_price);
        self.collateral.write(collateral);
        self.close_time.write(close_time);
        self.reveal_deadline.write(reveal_deadline);
        self.state.write(AuctionState::Open);
        self.kind.write(kind);

        self
            .emit(
                Event::AuctionCreated(
                    AuctionCreated {
                        token, reserve_price, collateral, close_time, reveal_deadline,
                    },
                ),
            );
    }

    #[abi(embed_v0)]
    impl SealedAuctionImpl of super::ISealedAuction<ContractState> {
        /// Escrow the uniform collateral against a commitment.
        ///
        /// The amount pulled is identical for every bidder, which is what stops
        /// the visible ERC20 leg from leaking the bid.
        fn commit(
            ref self: ContractState,
            bid_commitment: felt252,
            claim_handle: felt252,
            backup: Span<felt252>,
        ) {
            self.assert_can_commit(bid_commitment, claim_handle);

            // Recorded before the transfer. A reentrant token calling back
            // into commit sees this handle already taken, and if the transfer
            // fails the whole transaction reverts, so the entry cannot outlive
            // its collateral.
            self.record_entry(bid_commitment, claim_handle);
            self.store_backup(claim_handle, backup);

            let ok = IERC20Dispatcher { contract_address: self.token.read() }
                .transfer_from(get_caller_address(), get_contract_address(), self.collateral.read());
            assert(ok, errors::TRANSFER_FAILED);

            // Belt and braces. A token whose transfer_from returns true without
            // moving anything would otherwise create an unfunded entry.
            self.take_collateral();

            self.emit(Event::Committed(Committed { claim_handle }));
        }

        /// The same commitment, funded by the privacy pool instead of by an
        /// approval from the bidder.
        ///
        /// The pool calls this through `selector!("privacy_invoke")` in the same
        /// transaction as a `withdraw` action that has already moved the
        /// collateral here. The bidder therefore never needs a funded public
        /// account, and the only public leg is the pool's own transaction.
        ///
        /// **No amount is taken from calldata.** The reference escrow helper
        /// trusts a caller-supplied amount, but the user composes the action
        /// array, so a withdraw of 1 paired with an invoke claiming 100 would be
        /// accepted. `take_collateral` verifies arrival against this contract's
        /// own ledger instead, which cannot be influenced by the caller.
        ///
        /// Returns an empty span: no note is created and nothing is carried
        /// across time. Collateral stays here as ordinary ERC20 until `claim`.
        fn privacy_invoke(
            ref self: ContractState,
            operation: PoolOperation,
            a: felt252,
            b: felt252,
            c: felt252,
            d: felt252,
            backup: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            // The only authorisation this entrypoint has. Everything below
            // trusts that the pool performed whatever value movement the
            // operation implies, and nothing below reads an amount from
            // calldata.
            assert(get_caller_address() == self.pool.read(), errors::NOT_POOL);

            match operation {
                PoolOperation::Commit => {
                    assert(c == 0 && d == 0, errors::UNUSED_ARGS);
                    self.assert_can_commit(a, b);
                    // Entry first, exactly as `commit` does, and for the same
                    // reason. take_collateral looks innocent but calls
                    // balance_of on the token, which is an external call a
                    // hostile token can reenter. Recording first means
                    // commitment_count is already non-zero when it does, so a
                    // reentrant cancel is refused and the whole transaction
                    // reverts. An earlier comment here claimed there was
                    // nothing left to reenter. That was wrong.
                    self.record_entry(a, b);
                    self.store_backup(b, backup);
                    self.take_collateral();
                    self.emit(Event::Committed(Committed { claim_handle: b }));
                },
                PoolOperation::Reveal => {
                    // A backup belongs to the entry, and the entry already
                    // exists by now. Accepting one here would either be ignored
                    // silently or overwrite what commit stored, so refuse it
                    // for the same reason c and d must be zero above.
                    assert(backup.len() == 0, errors::UNUSED_ARGS);
                    // No value moves here. The pool carries the call only, so
                    // the bidder never appears as a transaction sender.
                    let amount = u256 {
                        low: a.try_into().expect('amount low overflow'),
                        high: b.try_into().expect('amount high overflow'),
                    };
                    self.do_reveal(amount, c, d);
                },
                PoolOperation::Claim => {
                    assert(c == 0 && d == 0 && backup.len() == 0, errors::UNUSED_ARGS);
                    let payout: ContractAddress = b.try_into().expect('bad payout address');
                    self.do_claim(a, payout);
                },
            };

            // Empty in every case. No note is created and nothing is carried
            // across time, which is what keeps this clear of the unverified
            // note lifecycle in HELPER_CUSTODY.md section 1.
            let none: Array<OpenNoteDeposit> = array![];
            none.span()
        }

        /// Open a commitment. `claim_secret` is deliberately not involved: a
        /// salt published here must never authorise a payout.
        fn reveal(ref self: ContractState, amount: u256, bid_salt: felt252, claim_handle: felt252) {
            self.do_reveal(amount, bid_salt, claim_handle);
        }


        /// Record the outcome. Moves no money, by design: value leaves only
        /// through individual claims, so no single call can run out of gas
        /// paying an unbounded number of bidders.
        fn settle(ref self: ContractState) {
            assert(get_block_timestamp() >= self.reveal_deadline.read(), errors::TOO_EARLY);
            assert(self.state.read() != AuctionState::Cancelled, errors::NOT_OPEN);

            if self.state.read() == AuctionState::Settled {
                return;
            }

            self.state.write(AuctionState::Settled);
            self
                .emit(
                    Event::Settled(
                        Settled {
                            winner_handle: self.winner_handle.read(),
                            clearing_price: self.clearing_price(),
                        },
                    ),
                );
        }

        /// Pay out one entry to the address committed inside its handle.
        fn claim(ref self: ContractState, claim_secret: felt252, payout_address: ContractAddress) {
            self.do_claim(claim_secret, payout_address);
        }

        /// Clearing price plus every forfeited collateral, once.
        ///
        /// There is no separate forfeiture entrypoint. Unrevealed collateral is
        /// assigned here and is never stranded.
        fn claim_proceeds(
            ref self: ContractState, seller_secret: felt252, payout_address: ContractAddress,
        ) {
            assert(self.state.read() == AuctionState::Settled, errors::NOT_SETTLED);
            assert(!self.seller_claimed.read(), errors::ALREADY_CLAIMED);
            assert(
                poseidon_hash_span([seller_secret, payout_address.into()].span())
                    == self.seller_handle.read(),
                errors::BAD_SELLER_HANDLE,
            );

            // Same ordering rule as claim.
            self.seller_claimed.write(true);

            // Cannot underflow: revealed_count is incremented only alongside a
            // commitment that already exists, so it never exceeds
            // commitment_count.
            let forfeited: u256 = (self.commitment_count.read() - self.revealed_count.read()).into();
            let amount = self.clearing_price() + forfeited * self.collateral.read();

            let ok = IERC20Dispatcher { contract_address: self.token.read() }
                .transfer(payout_address, amount);
            assert(ok, errors::TRANSFER_FAILED);

            self.emit(Event::ProceedsClaimed(ProceedsClaimed { amount }));
        }

        /// Abandon the auction before anyone has escrowed anything.
        ///
        /// Authorised by the seller handle preimage, so no seller address has
        /// to be stored either.
        fn cancel(
            ref self: ContractState, seller_secret: felt252, payout_address: ContractAddress,
        ) {
            assert(
                self.state.read() == AuctionState::Open && self.commitment_count.read() == 0,
                errors::CANNOT_CANCEL,
            );
            assert(
                poseidon_hash_span([seller_secret, payout_address.into()].span())
                    == self.seller_handle.read(),
                errors::BAD_SELLER_HANDLE,
            );

            self.state.write(AuctionState::Cancelled);
            self.emit(Event::Cancelled(Cancelled {}));
        }

        fn get_entry_status(self: @ContractState, claim_handle: felt252) -> EntryStatus {
            let entry = self.entries.entry(claim_handle).read();
            let settled = self.state.read() == AuctionState::Settled;

            if entry.bid_commitment == 0 {
                EntryStatus::Unknown
            } else if entry.claimed {
                EntryStatus::Claimed
            } else if !entry.revealed {
                if settled {
                    EntryStatus::Forfeited
                } else {
                    EntryStatus::Committed
                }
            } else if !settled {
                EntryStatus::Revealed
            } else if claim_handle == self.winner_handle.read() {
                EntryStatus::Won
            } else {
                EntryStatus::Lost
            }
        }

        fn get_state(self: @ContractState) -> AuctionState {
            self.state.read()
        }

        fn get_clearing_price(self: @ContractState) -> u256 {
            self.clearing_price()
        }

        fn get_winner_handle(self: @ContractState) -> felt252 {
            self.winner_handle.read()
        }

        fn get_commitment_count(self: @ContractState) -> u32 {
            self.commitment_count.read()
        }

        fn get_revealed_count(self: @ContractState) -> u32 {
            self.revealed_count.read()
        }

        fn get_collateral(self: @ContractState) -> u256 {
            self.collateral.read()
        }

        fn get_escrowed(self: @ContractState) -> u256 {
            self.escrowed.read()
        }

        fn get_reserve_price(self: @ContractState) -> u256 {
            self.reserve_price.read()
        }

        fn get_backup(self: @ContractState, claim_handle: felt252) -> Array<felt252> {
            let mut out = array![];
            if !self.has_backup.entry(claim_handle).read() {
                return out;
            }
            let mut i: u32 = 0;
            while i < BACKUP_WORDS {
                out.append(self.backups.entry((claim_handle, i)).read());
                i += 1;
            };
            out
        }

        fn get_kind(self: @ContractState) -> AuctionKind {
            self.kind.read()
        }

        fn get_timing(self: @ContractState) -> (u64, u64) {
            (self.close_time.read(), self.reveal_deadline.read())
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// The reveal logic, shared by the plain entrypoint and the pool
        /// path. One copy, so the running top-two update cannot drift
        /// between them.
        fn do_reveal(ref self: ContractState, amount: u256, bid_salt: felt252, claim_handle: felt252) {
            let now = get_block_timestamp();
            assert(
                now >= self.close_time.read() && now < self.reveal_deadline.read(),
                errors::NOT_REVEALING,
            );

            let mut entry = self.entries.entry(claim_handle).read();
            assert(entry.bid_commitment != 0, errors::UNKNOWN_ENTRY);
            assert(!entry.revealed, errors::ALREADY_REVEALED);
            assert(
                amount >= self.reserve_price.read() && amount <= self.collateral.read(),
                errors::AMOUNT_OUT_OF_BOUNDS,
            );

            let expected = poseidon_hash_span(
                [amount.low.into(), amount.high.into(), bid_salt, claim_handle].span(),
            );
            assert(expected == entry.bid_commitment, errors::BAD_COMMITMENT);

            entry.revealed = true;
            entry.amount = amount;
            self.entries.entry(claim_handle).write(entry);
            self.revealed_count.write(self.revealed_count.read() + 1);

            // Strictly greater, so on a tie the first valid reveal keeps the
            // win and the tied amount becomes the clearing price.
            let highest = self.highest_bid.read();
            if amount > highest {
                self.second_highest_bid.write(highest);
                self.highest_bid.write(amount);
                self.winner_handle.write(claim_handle);
            } else if amount > self.second_highest_bid.read() {
                self.second_highest_bid.write(amount);
            }

            self.emit(Event::Revealed(Revealed { claim_handle, amount }));
        }

        /// The claim logic, shared by the plain entrypoint and the pool
        /// path. Pays only the address committed at bid time either way.
        fn do_claim(ref self: ContractState, claim_secret: felt252, payout_address: ContractAddress) {
            assert(self.state.read() == AuctionState::Settled, errors::NOT_SETTLED);

            // The authorisation is the hash, not the caller. Anyone may relay
            // this transaction; only the committed address can be paid.
            let handle = poseidon_hash_span([claim_secret, payout_address.into()].span());

            let mut entry = self.entries.entry(handle).read();
            assert(entry.bid_commitment != 0, errors::NOT_CLAIMABLE);
            assert(!entry.claimed, errors::ALREADY_CLAIMED);
            // An unrevealed entry is forfeited to the seller, not refundable.
            assert(entry.revealed, errors::NOT_CLAIMABLE);

            // Flag written before the transfer, so a reentrant token cannot
            // re-enter claim and be paid twice on the same entry.
            entry.claimed = true;
            self.entries.entry(handle).write(entry);

            let collateral = self.collateral.read();
            let amount = if handle == self.winner_handle.read() {
                collateral - self.clearing_price()
            } else {
                collateral
            };

            let ok = IERC20Dispatcher { contract_address: self.token.read() }
                .transfer(payout_address, amount);
            assert(ok, errors::TRANSFER_FAILED);

            self.emit(Event::Claimed(Claimed { claim_handle: handle, amount }));
        }

        /// Phase and uniqueness checks shared by both commit paths.
        ///
        /// Reusing a handle would overwrite the first bidder's entry and strand
        /// their collateral, since payouts are keyed by handle alone.
        fn assert_can_commit(
            self: @ContractState, bid_commitment: felt252, claim_handle: felt252,
        ) {
            assert(self.state.read() == AuctionState::Open, errors::NOT_OPEN);
            assert(get_block_timestamp() < self.close_time.read(), errors::CLOSED);

            // Zero is this contract's sentinel in two places, and both are
            // caller-supplied, so both must be refused at the door.
            //
            // A zero claim_handle would be stored as winner_handle on a winning
            // reveal, and clearing_price reads winner_handle == 0 as "nobody
            // won" and returns zero. The seller would be paid nothing for the
            // sale, and the entry could never be claimed either, because no
            // caller can produce a preimage hashing to zero. That collateral
            // would sit in the contract forever, unforfeitable because the
            // entry was revealed.
            //
            // A zero bid_commitment would mean "no entry here", so the same
            // handle could be committed repeatedly, each time taking collateral
            // and incrementing the count while overwriting the last entry.
            //
            // Neither requires finding a hash preimage. Both values arrive as
            // plain calldata.
            assert(bid_commitment != 0, errors::ZERO_COMMITMENT);
            assert(claim_handle != 0, errors::ZERO_HANDLE);

            assert(
                self.entries.entry(claim_handle).read().bid_commitment == 0,
                errors::DUPLICATE_HANDLE,
            );
        }

        /// Record the entry. Identical for both paths, so a reveal or a claim
        /// cannot tell which one funded it.
        /// Store the blob, or accept its absence.
        ///
        /// Called only from the two commit paths, immediately after the entry
        /// is recorded. A handle cannot be committed twice, so this can never
        /// overwrite an existing blob.
        fn store_backup(ref self: ContractState, claim_handle: felt252, backup: Span<felt252>) {
            let len = backup.len();
            if len == 0 {
                return;
            }
            // Any other length would make blobs distinguishable from each other.
            assert(len == BACKUP_WORDS, errors::BAD_BACKUP_LENGTH);

            let mut i: u32 = 0;
            while i < len {
                self.backups.entry((claim_handle, i)).write(*backup.at(i));
                i += 1;
            };
            self.has_backup.entry(claim_handle).write(true);
        }

        fn record_entry(ref self: ContractState, bid_commitment: felt252, claim_handle: felt252) {
            self
                .entries
                .entry(claim_handle)
                .write(Entry { bid_commitment, amount: 0, revealed: false, claimed: false });
            self.commitment_count.write(self.commitment_count.read() + 1);
        }

        /// Verify that one more collateral has actually arrived, then account
        /// for it.
        ///
        /// This is the whole defence of invariant 1 on the pool-funded path.
        /// `escrowed` only ever grows by `collateral`, and only when the token
        /// balance can cover it, so `escrowed` is always backed.
        ///
        /// Tolerated deliberately: an outright donation of `collateral` to this
        /// address can fund one entry that made no withdraw. That is not a loss.
        /// The donor paid exactly what the entry is worth and the funds are
        /// distributed by the normal rules. Detecting it would require trusting
        /// a caller-supplied amount, which is the weakness this avoids.
        fn take_collateral(ref self: ContractState) {
            let collateral = self.collateral.read();
            let escrowed = self.escrowed.read();
            let balance = IERC20Dispatcher { contract_address: self.token.read() }
                .balance_of(get_contract_address());
            assert(balance >= escrowed + collateral, errors::NOT_RECEIVED);
            self.escrowed.write(escrowed + collateral);
        }

        /// Second-highest valid bid, or the reserve when only one bid was
        /// valid. Zero when nobody revealed, since there is no sale.
        fn clearing_price(self: @ContractState) -> u256 {
            if self.winner_handle.read() == 0 {
                return 0;
            }
            match self.kind.read() {
                // The winner pays their own bid. A reveal is rejected below the
                // reserve, so this is never under it.
                AuctionKind::FirstPrice => self.highest_bid.read(),
                // The runner-up's bid, or the reserve when there was only one
                // valid reveal and the runner-up does not exist.
                AuctionKind::Vickrey => {
                    let second = self.second_highest_bid.read();
                    let reserve = self.reserve_price.read();
                    if second > reserve {
                        second
                    } else {
                        reserve
                    }
                },
            }
        }
    }
}
