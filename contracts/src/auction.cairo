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
    fn commit(ref self: TContractState, bid_commitment: felt252, claim_handle: felt252);
    fn privacy_invoke(
        ref self: TContractState, bid_commitment: felt252, claim_handle: felt252,
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
}

#[starknet::contract]
pub mod SealedAuction {
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use super::super::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use super::{AuctionState, Entry, EntryStatus, OpenNoteDeposit};

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
        pub const NOT_POOL: felt252 = 'caller not pool';
        pub const NOT_RECEIVED: felt252 = 'collateral not received';
    }

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
        state: AuctionState,
        // Keyed by claim_handle. Never by address.
        //
        // Absence is represented by bid_commitment == 0 rather than a separate
        // exists flag. A real commitment is a Poseidon output, so zero is
        // unreachable in practice, and a caller cannot forge one because the
        // preimage would have to hash to zero.
        entries: Map<felt252, Entry>,
        commitment_count: u32,
        revealed_count: u32,
        highest_bid: u256,
        second_highest_bid: u256,
        winner_handle: felt252,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Committed: Committed,
        Revealed: Revealed,
        Settled: Settled,
        Claimed: Claimed,
        ProceedsClaimed: ProceedsClaimed,
        Cancelled: Cancelled,
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
    ) {
        assert(close_time < reveal_deadline, errors::BAD_DEADLINES);
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
    }

    #[abi(embed_v0)]
    impl SealedAuctionImpl of super::ISealedAuction<ContractState> {
        /// Escrow the uniform collateral against a commitment.
        ///
        /// The amount pulled is identical for every bidder, which is what stops
        /// the visible ERC20 leg from leaking the bid.
        fn commit(ref self: ContractState, bid_commitment: felt252, claim_handle: felt252) {
            self.assert_can_commit(claim_handle);

            // Recorded before the transfer. A reentrant token calling back
            // into commit sees this handle already taken, and if the transfer
            // fails the whole transaction reverts, so the entry cannot outlive
            // its collateral.
            self.record_entry(bid_commitment, claim_handle);

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
            ref self: ContractState, bid_commitment: felt252, claim_handle: felt252,
        ) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.pool.read(), errors::NOT_POOL);
            self.assert_can_commit(claim_handle);

            // Value first, then the entry. The pool has already transferred, so
            // unlike `commit` there is no external call left to make and nothing
            // to reenter.
            self.take_collateral();
            self.record_entry(bid_commitment, claim_handle);

            self.emit(Event::Committed(Committed { claim_handle }));
            array![].span()
        }

        /// Open a commitment. `claim_secret` is deliberately not involved: a
        /// salt published here must never authorise a payout.
        fn reveal(ref self: ContractState, amount: u256, bid_salt: felt252, claim_handle: felt252) {
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
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Phase and uniqueness checks shared by both commit paths.
        ///
        /// Reusing a handle would overwrite the first bidder's entry and strand
        /// their collateral, since payouts are keyed by handle alone.
        fn assert_can_commit(self: @ContractState, claim_handle: felt252) {
            assert(self.state.read() == AuctionState::Open, errors::NOT_OPEN);
            assert(get_block_timestamp() < self.close_time.read(), errors::CLOSED);
            assert(
                self.entries.entry(claim_handle).read().bid_commitment == 0,
                errors::DUPLICATE_HANDLE,
            );
        }

        /// Record the entry. Identical for both paths, so a reveal or a claim
        /// cannot tell which one funded it.
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
            let second = self.second_highest_bid.read();
            let reserve = self.reserve_price.read();
            if second > reserve {
                second
            } else {
                reserve
            }
        }
    }
}
