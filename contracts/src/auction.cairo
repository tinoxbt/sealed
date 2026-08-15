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
}

#[starknet::contract]
pub mod SealedAuction {
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use super::super::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use super::{AuctionState, Entry, EntryStatus};

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
    }

    #[storage]
    struct Storage {
        // Seller identity is a handle, exactly like a bidder's. No address.
        seller_handle: felt252,
        seller_claimed: bool,
        token: ContractAddress,
        reserve_price: u256,
        collateral: u256,
        close_time: u64,
        reveal_deadline: u64,
        state: AuctionState,
        // Keyed by claim_handle. Never by address.
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
            assert(self.state.read() == AuctionState::Open, errors::NOT_OPEN);
            assert(get_block_timestamp() < self.close_time.read(), errors::CLOSED);
            assert(
                self.entries.entry(claim_handle).read().bid_commitment == 0,
                errors::DUPLICATE_HANDLE,
            );

            self
                .entries
                .entry(claim_handle)
                .write(Entry { bid_commitment, amount: 0, revealed: false, claimed: false });
            self.commitment_count.write(self.commitment_count.read() + 1);

            let ok = IERC20Dispatcher { contract_address: self.token.read() }
                .transfer_from(get_caller_address(), get_contract_address(), self.collateral.read());
            assert(ok, errors::TRANSFER_FAILED);

            self.emit(Event::Committed(Committed { claim_handle }));
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

            self.seller_claimed.write(true);

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
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
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
