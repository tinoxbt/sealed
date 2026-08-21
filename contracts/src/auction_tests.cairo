//! The twelve invariants from ARCHITECTURE.md section 6.
//!
//! Coverage here is measured in invariants, not lines. Two of them are
//! properties rather than examples and are fuzzed: the running top-two update,
//! and conservation of funds across three or more bidders.

#[cfg(test)]
mod tests {
    use core::poseidon::poseidon_hash_span;
    use snforge_std::{
        ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
        start_cheat_block_timestamp_global, start_cheat_caller_address, stop_cheat_caller_address,
    };
    use starknet::ContractAddress;
    use super::super::auction::{
        AuctionState, EntryStatus, ISealedAuctionDispatcher, ISealedAuctionDispatcherTrait,
        AuctionKind, PoolOperation, SealedAuction,
    };
    use super::super::mock_erc20::{
        IMockERC20Dispatcher, IMockERC20DispatcherTrait, IReentrantTokenDispatcher,
        IReentrantTokenDispatcherTrait,
    };

    const CLOSE: u64 = 1000;
    const DEADLINE: u64 = 2000;
    const COLLATERAL: u256 = 1000;
    const RESERVE: u256 = 100;

    const SELLER_SECRET: felt252 = 'seller_secret';

    /// Stand-in for the privacy pool. Only this address may call privacy_invoke.
    fn POOL() -> ContractAddress {
        addr('privacy_pool')
    }

    fn addr(v: felt252) -> ContractAddress {
        v.try_into().unwrap()
    }

    fn handle(secret: felt252, payout: ContractAddress) -> felt252 {
        poseidon_hash_span([secret, payout.into()].span())
    }

    fn commitment(amount: u256, salt: felt252, h: felt252) -> felt252 {
        poseidon_hash_span([amount.low.into(), amount.high.into(), salt, h].span())
    }

    /// Deploys a token and an auction, mints to `bidders`, and approves the
    /// auction to pull collateral from each.
    fn setup(
        bidders: Span<ContractAddress>,
    ) -> (ISealedAuctionDispatcher, IMockERC20Dispatcher, ContractAddress) {
        setup_kind(bidders, AuctionKind::Vickrey)
    }

    fn setup_kind(
        bidders: Span<ContractAddress>, kind: AuctionKind,
    ) -> (ISealedAuctionDispatcher, IMockERC20Dispatcher, ContractAddress) {
        let token_class = declare("MockERC20").unwrap().contract_class();
        let (token_address, _) = token_class.deploy(@array![]).unwrap();
        let token = IMockERC20Dispatcher { contract_address: token_address };

        let seller_handle = handle(SELLER_SECRET, addr('seller_payout'));

        let mut calldata: Array<felt252> = array![];
        seller_handle.serialize(ref calldata);
        token_address.serialize(ref calldata);
        POOL().serialize(ref calldata);
        RESERVE.serialize(ref calldata);
        COLLATERAL.serialize(ref calldata);
        CLOSE.serialize(ref calldata);
        DEADLINE.serialize(ref calldata);
        kind.serialize(ref calldata);

        let auction_class = declare("SealedAuction").unwrap().contract_class();
        let (auction_address, _) = auction_class.deploy(@calldata).unwrap();

        let mut i = 0;
        while i != bidders.len() {
            let bidder = *bidders.at(i);
            token.mint(bidder, COLLATERAL * 10);
            start_cheat_caller_address(token_address, bidder);
            token.approve(auction_address, COLLATERAL * 10);
            stop_cheat_caller_address(token_address);
            i += 1;
        }

        start_cheat_block_timestamp_global(CLOSE - 1);
        (ISealedAuctionDispatcher { contract_address: auction_address }, token, auction_address)
    }

    fn do_commit(
        auction: ISealedAuctionDispatcher,
        bidder: ContractAddress,
        amount: u256,
        salt: felt252,
        secret: felt252,
        payout: ContractAddress,
    ) -> felt252 {
        let h = handle(secret, payout);
        start_cheat_caller_address(auction.contract_address, bidder);
        auction.commit(commitment(amount, salt, h), h);
        stop_cheat_caller_address(auction.contract_address);
        h
    }

    // Invariant 1. Contract balance equals collateral * commitment_count minus
    // everything claimed.
    #[test]
    fn invariant_1_balance_matches_commitments() {
        let b1 = addr('b1');
        let b2 = addr('b2');
        let (auction, token, auction_address) = setup(array![b1, b2].span());

        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));
        assert(token.balance_of(auction_address) == COLLATERAL, 'after one commit');

        do_commit(auction, b2, 600, 'salt2', 'sec2', addr('p2'));
        assert(token.balance_of(auction_address) == COLLATERAL * 2, 'after two commits');
        assert(auction.get_commitment_count() == 2, 'count');

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(500, 'salt1', handle('sec1', addr('p1')));
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        auction.claim('sec1', addr('p1'));
        // One reveal, so the clearing price is the reserve and the winner takes
        // back collateral minus reserve.
        assert(
            token.balance_of(auction_address) == COLLATERAL * 2 - (COLLATERAL - RESERVE),
            'after claim',
        );
    }

    // Invariant 2. No entry can be claimed twice.
    #[test]
    #[should_panic(expected: 'already claimed')]
    fn invariant_2_no_double_claim() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());
        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(500, 'salt1', handle('sec1', addr('p1')));
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        auction.claim('sec1', addr('p1'));
        auction.claim('sec1', addr('p1'));
    }

    // Invariant 3. A reveal after the deadline is rejected.
    #[test]
    #[should_panic(expected: 'not in reveal window')]
    fn invariant_3_late_reveal_rejected() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());
        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.reveal(500, 'salt1', handle('sec1', addr('p1')));
    }

    // Invariant 4. A bid_salt published at reveal cannot claim anything.
    //
    // The salt is public the moment a bidder reveals. If it authorised claims,
    // anyone watching could drain every losing bidder.
    #[test]
    #[should_panic(expected: 'entry not claimable')]
    fn invariant_4_bid_salt_cannot_claim() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());
        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(500, 'salt1', handle('sec1', addr('p1')));
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        // The salt is now public. Presenting it as the claim secret must fail.
        auction.claim('salt1', addr('p1'));
    }

    // Invariant 5. second_highest_bid is correct when two bidders reveal
    // identical amounts, and the first valid reveal wins the tie.
    #[test]
    fn invariant_5_tie_first_reveal_wins() {
        let b1 = addr('b1');
        let b2 = addr('b2');
        let (auction, _, _) = setup(array![b1, b2].span());

        let h1 = do_commit(auction, b1, 700, 'salt1', 'sec1', addr('p1'));
        do_commit(auction, b2, 700, 'salt2', 'sec2', addr('p2'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(700, 'salt1', h1);
        auction.reveal(700, 'salt2', handle('sec2', addr('p2')));

        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        assert(auction.get_winner_handle() == h1, 'first reveal wins tie');
        // Both bids are 700, so the second-highest is also 700.
        assert(auction.get_clearing_price() == 700, 'tied clearing price');
    }

    // Invariant 6. settle is idempotent.
    #[test]
    fn invariant_6_settle_idempotent() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());
        let h1 = do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(500, 'salt1', h1);
        start_cheat_block_timestamp_global(DEADLINE + 1);

        auction.settle();
        let winner = auction.get_winner_handle();
        let price = auction.get_clearing_price();

        auction.settle();
        auction.settle();

        assert(auction.get_winner_handle() == winner, 'winner stable');
        assert(auction.get_clearing_price() == price, 'price stable');
        assert(auction.get_state() == AuctionState::Settled, 'state stable');
    }

    // Invariant 7. An unrevealed entry cannot be claimed by its bidder after
    // settlement. This is what makes silence expensive.
    #[test]
    #[should_panic(expected: 'entry not claimable')]
    fn invariant_7_unrevealed_cannot_claim() {
        let b1 = addr('b1');
        let b2 = addr('b2');
        let (auction, _, _) = setup(array![b1, b2].span());

        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));
        do_commit(auction, b2, 600, 'salt2', 'sec2', addr('p2'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(600, 'salt2', handle('sec2', addr('p2')));
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        assert(
            auction.get_entry_status(handle('sec1', addr('p1'))) == EntryStatus::Forfeited,
            'status forfeited',
        );
        auction.claim('sec1', addr('p1'));
    }

    // Invariant 9. A claim with a correct secret but a different payout address
    // is rejected. This is what stops a pending claim from being raced.
    #[test]
    #[should_panic(expected: 'entry not claimable')]
    fn invariant_9_wrong_payout_rejected() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());
        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(500, 'salt1', handle('sec1', addr('p1')));
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        // Correct secret, attacker's destination. The handle will not match.
        auction.claim('sec1', addr('attacker'));
    }

    // Invariant 10. claim_proceeds pays clearing price plus forfeitures, once.
    #[test]
    fn invariant_10_proceeds_once() {
        let b1 = addr('b1');
        let b2 = addr('b2');
        let b3 = addr('b3');
        let (auction, token, _) = setup(array![b1, b2, b3].span());

        do_commit(auction, b1, 800, 'salt1', 'sec1', addr('p1'));
        do_commit(auction, b2, 500, 'salt2', 'sec2', addr('p2'));
        do_commit(auction, b3, 400, 'salt3', 'sec3', addr('p3'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(800, 'salt1', handle('sec1', addr('p1')));
        auction.reveal(500, 'salt2', handle('sec2', addr('p2')));
        // b3 never reveals, so one collateral is forfeited.

        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        let seller_payout = addr('seller_payout');
        auction.claim_proceeds(SELLER_SECRET, seller_payout);

        // Clearing price is the second-highest bid, 500, plus one forfeit.
        assert(token.balance_of(seller_payout) == 500 + COLLATERAL, 'proceeds amount');
    }

    #[test]
    #[should_panic(expected: 'already claimed')]
    fn invariant_10_proceeds_not_twice() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());
        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(500, 'salt1', handle('sec1', addr('p1')));
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        auction.claim_proceeds(SELLER_SECRET, addr('seller_payout'));
        auction.claim_proceeds(SELLER_SECRET, addr('seller_payout'));
    }

    // Invariant 11. Zero valid reveals settles with no winner, and the seller
    // claims the entire pot.
    #[test]
    fn invariant_11_zero_reveals() {
        let b1 = addr('b1');
        let b2 = addr('b2');
        let (auction, token, _) = setup(array![b1, b2].span());

        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));
        do_commit(auction, b2, 600, 'salt2', 'sec2', addr('p2'));

        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        assert(auction.get_winner_handle() == 0, 'no winner');
        assert(auction.get_clearing_price() == 0, 'no clearing price');

        let seller_payout = addr('seller_payout');
        auction.claim_proceeds(SELLER_SECRET, seller_payout);
        assert(token.balance_of(seller_payout) == COLLATERAL * 2, 'seller takes the pot');
    }

    // Invariant 12. Role separation. A bidder cannot call claim_proceeds, and
    // the seller cannot claim a bidder entry.
    #[test]
    #[should_panic(expected: 'bad seller handle')]
    fn invariant_12_bidder_cannot_claim_proceeds() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());
        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(500, 'salt1', handle('sec1', addr('p1')));
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        auction.claim_proceeds('sec1', addr('p1'));
    }

    #[test]
    #[should_panic(expected: 'entry not claimable')]
    fn invariant_12_seller_cannot_claim_entry() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());
        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(500, 'salt1', handle('sec1', addr('p1')));
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        auction.claim(SELLER_SECRET, addr('seller_payout'));
    }

    // A seller who sets a reveal window nobody can meet collects every
    // collateral without selling anything: they receive all forfeitures AND
    // choose the deadline. The constructor refuses the setup rather than
    // relying on bidders to notice.
    #[test]
    fn constructor_rejects_unmeetable_reveal_window() {
        let token_class = declare("MockERC20").unwrap().contract_class();
        let (token_address, _) = token_class.deploy(@array![]).unwrap();

        let mut calldata: Array<felt252> = array![];
        handle(SELLER_SECRET, addr('seller_payout')).serialize(ref calldata);
        token_address.serialize(ref calldata);
        POOL().serialize(ref calldata);
        RESERVE.serialize(ref calldata);
        COLLATERAL.serialize(ref calldata);
        CLOSE.serialize(ref calldata);
        // One second to reveal. Ordered correctly, and still unmeetable.
        (CLOSE + 1).serialize(ref calldata);
        AuctionKind::Vickrey.serialize(ref calldata);

        // Matched rather than unwrapped: unwrap replaces the constructor's
        // panic with its own, so should_panic would have accepted any deploy
        // failure at all and proved nothing about this guard.
        let auction_class = declare("SealedAuction").unwrap().contract_class();
        match auction_class.deploy(@calldata) {
            Result::Ok(_) => panic!("a one second reveal window was accepted"),
            Result::Err(panic_data) => {
                assert(*panic_data.at(0) == 'reveal window too short', 'wrong rejection reason');
            },
        }
    }

    // The floor itself is allowed, so the guard rejects only what it must.
    #[test]
    fn constructor_accepts_the_minimum_window() {
        let token_class = declare("MockERC20").unwrap().contract_class();
        let (token_address, _) = token_class.deploy(@array![]).unwrap();

        let mut calldata: Array<felt252> = array![];
        handle(SELLER_SECRET, addr('seller_payout')).serialize(ref calldata);
        token_address.serialize(ref calldata);
        POOL().serialize(ref calldata);
        RESERVE.serialize(ref calldata);
        COLLATERAL.serialize(ref calldata);
        CLOSE.serialize(ref calldata);
        (CLOSE + 600).serialize(ref calldata);
        AuctionKind::Vickrey.serialize(ref calldata);

        let auction_class = declare("SealedAuction").unwrap().contract_class();
        let (address, _) = auction_class.deploy(@calldata).unwrap();
        let auction = ISealedAuctionDispatcher { contract_address: address };
        let (close, deadline) = auction.get_timing();
        assert(deadline - close == 600, 'minimum window accepted');
    }

    // Not one of the twelve, but each of these is a way the contract could
    // leak money or lock it up, so they are worth pinning down.

    // Bidding after close_time must be refused. Without this, a bidder could
    // watch the reveals start and then commit with perfect information.
    #[test]
    #[should_panic(expected: 'bidding closed')]
    fn commit_after_close_rejected() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());

        start_cheat_block_timestamp_global(CLOSE);
        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));
    }

    // The boundary itself: one second before close is still open.
    #[test]
    fn commit_just_before_close_accepted() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());

        start_cheat_block_timestamp_global(CLOSE - 1);
        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));
        assert(auction.get_commitment_count() == 1, 'accepted at close - 1');
    }

    // Reusing a claim_handle would overwrite the first bidder's entry and strand
    // their collateral in the contract.
    #[test]
    #[should_panic(expected: 'handle already used')]
    fn duplicate_claim_handle_rejected() {
        let b1 = addr('b1');
        let b2 = addr('b2');
        let (auction, _, _) = setup(array![b1, b2].span());

        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));
        // Same secret and same payout address, so the same handle.
        do_commit(auction, b2, 600, 'salt2', 'sec1', addr('p1'));
    }

    #[test]
    fn cancel_before_any_commitment() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());

        auction.cancel(SELLER_SECRET, addr('seller_payout'));
        assert(auction.get_state() == AuctionState::Cancelled, 'cancelled');
    }

    // Once collateral is escrowed, cancelling would strip bidders of the only
    // path back to their funds.
    #[test]
    #[should_panic(expected: 'cannot cancel now')]
    fn cancel_after_commitment_rejected() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());

        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));
        auction.cancel(SELLER_SECRET, addr('seller_payout'));
    }

    // Cancel is authorised by the seller handle preimage, not by caller
    // address, so a stranger holding no secret cannot cancel.
    #[test]
    #[should_panic(expected: 'bad seller handle')]
    fn cancel_by_non_seller_rejected() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());

        auction.cancel('not_the_seller', addr('seller_payout'));
    }

    // The seller secret is right but the destination is not the one committed,
    // so the handle does not match. Same protection as invariant 9, seller side.
    #[test]
    #[should_panic(expected: 'bad seller handle')]
    fn cancel_with_wrong_payout_rejected() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());

        auction.cancel(SELLER_SECRET, addr('attacker'));
    }

    // A cancelled auction must not then settle, which would otherwise give the
    // seller a claim_proceeds path against an auction that never ran.
    #[test]
    #[should_panic(expected: 'auction not open')]
    fn cancelled_auction_cannot_settle() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());

        auction.cancel(SELLER_SECRET, addr('seller_payout'));
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();
    }

    // ---- The pool-funded commit path ----
    //
    // The pool moves collateral here with a withdraw action, then calls
    // privacy_invoke in the same transaction. These tests stand in for that by
    // transferring to the auction and then calling as the pool.

    /// Simulate the pool's withdraw leg, then its invoke.
    fn do_pool_commit(
        auction: ISealedAuctionDispatcher,
        token: IMockERC20Dispatcher,
        auction_address: ContractAddress,
        amount_delivered: u256,
        bid: u256,
        salt: felt252,
        secret: felt252,
        payout: ContractAddress,
    ) -> felt252 {
        token.mint(POOL(), amount_delivered);
        start_cheat_caller_address(token.contract_address, POOL());
        token.transfer(auction_address, amount_delivered);
        stop_cheat_caller_address(token.contract_address);

        let ch = handle(secret, payout);
        let commitment = commitment(bid, salt, ch);
        start_cheat_caller_address(auction.contract_address, POOL());
        auction.privacy_invoke(PoolOperation::Commit, commitment, ch, 0, 0);
        stop_cheat_caller_address(auction.contract_address);
        ch
    }

    // Only the pool may call it. Anyone else could otherwise mint an entry
    // against collateral someone else delivered.
    #[test]
    #[should_panic(expected: 'caller not pool')]
    fn privacy_invoke_rejects_non_pool() {
        let b1 = addr('b1');
        let (auction, token, auction_address) = setup(array![b1].span());

        token.mint(auction_address, COLLATERAL);
        start_cheat_caller_address(auction.contract_address, b1);
        auction.privacy_invoke(PoolOperation::Commit, 'commitment', 'handle', 0, 0);
    }

    // The heart of it. The pool delivers less than the collateral, so the entry
    // must not be created. This is the case the reference escrow helper would
    // accept, because it trusts the amount in calldata.
    #[test]
    #[should_panic(expected: 'collateral not received')]
    fn privacy_invoke_rejects_short_delivery() {
        let b1 = addr('b1');
        let (auction, token, auction_address) = setup(array![b1].span());

        do_pool_commit(
            auction, token, auction_address, COLLATERAL - 1, 500, 'salt1', 'sec1', addr('p1'),
        );
    }

    // Delivering nothing at all is the same failure.
    #[test]
    #[should_panic(expected: 'collateral not received')]
    fn privacy_invoke_rejects_no_delivery() {
        let b1 = addr('b1');
        let (auction, token, auction_address) = setup(array![b1].span());

        let ch = handle('sec1', addr('p1'));
        start_cheat_caller_address(auction.contract_address, POOL());
        auction.privacy_invoke(PoolOperation::Commit, 'commitment', ch, 0, 0);
    }

    // A second invoke cannot ride on the first one's collateral. escrowed has
    // already absorbed it, so the balance no longer covers another entry.
    #[test]
    #[should_panic(expected: 'collateral not received')]
    fn privacy_invoke_cannot_reuse_one_delivery() {
        let b1 = addr('b1');
        let (auction, token, auction_address) = setup(array![b1].span());

        do_pool_commit(auction, token, auction_address, COLLATERAL, 500, 'salt1', 'sec1', addr('p1'));

        let ch2 = handle('sec2', addr('p2'));
        start_cheat_caller_address(auction.contract_address, POOL());
        auction.privacy_invoke(PoolOperation::Commit, 'commitment2', ch2, 0, 0);
    }

    // Phase rules apply identically to both paths.
    #[test]
    #[should_panic(expected: 'bidding closed')]
    fn privacy_invoke_after_close_rejected() {
        let b1 = addr('b1');
        let (auction, token, auction_address) = setup(array![b1].span());

        start_cheat_block_timestamp_global(CLOSE);
        do_pool_commit(auction, token, auction_address, COLLATERAL, 500, 'salt1', 'sec1', addr('p1'));
    }

    // An entry funded by the pool behaves exactly like one funded by approve:
    // it reveals, wins, and claims the same way.
    #[test]
    fn pool_funded_entry_is_indistinguishable() {
        let b1 = addr('b1');
        let (auction, token, auction_address) = setup(array![b1].span());

        let payout = addr('p1');
        let ch = do_pool_commit(
            auction, token, auction_address, COLLATERAL, 500, 'salt1', 'sec1', payout,
        );

        assert(auction.get_commitment_count() == 1, 'counted');
        assert(auction.get_escrowed() == COLLATERAL, 'escrowed');
        assert(auction.get_entry_status(ch) == EntryStatus::Committed, 'committed');

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(500, 'salt1', ch);
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        assert(auction.get_winner_handle() == ch, 'won');
        // Sole valid bid, so the clearing price is the reserve.
        assert(auction.get_clearing_price() == RESERVE, 'clears at reserve');

        auction.claim('sec1', payout);
        assert(token.balance_of(payout) == COLLATERAL - RESERVE, 'refund');
    }

    // Invariant 1 across a mixed auction. Both paths must feed the same ledger.
    #[test]
    fn invariant_1_holds_across_mixed_paths() {
        let b1 = addr('b1');
        let (auction, token, auction_address) = setup(array![b1].span());

        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));
        do_pool_commit(auction, token, auction_address, COLLATERAL, 600, 'salt2', 'sec2', addr('p2'));
        do_commit(auction, b1, 700, 'salt3', 'sec3', addr('p3'));

        assert(auction.get_commitment_count() == 3, 'three entries');
        assert(auction.get_escrowed() == COLLATERAL * 3, 'escrowed three');
        assert(token.balance_of(auction_address) == COLLATERAL * 3, 'balance matches');
    }

    // The frontend cannot show a phase or a countdown without these, and a
    // wrong reserve on screen would let a bidder submit a bid the contract
    // rejects.
    #[test]
    fn config_getters_match_construction() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());

        assert(auction.get_reserve_price() == RESERVE, 'reserve');
        assert(auction.get_collateral() == COLLATERAL, 'collateral');

        let (close, deadline) = auction.get_timing();
        assert(close == CLOSE, 'close time');
        assert(deadline == DEADLINE, 'reveal deadline');
        assert(close < deadline, 'close before deadline');
    }

    // The pool-routed reveal. A bidder who reveals this way never appears as a
    // transaction sender, which is the whole point: the bid was unlinkable and
    // revealing from your own wallet would undo that.
    #[test]
    fn pool_reveal_matches_a_plain_reveal() {
        let b1 = addr('b1');
        let (auction, _, address) = setup(array![b1].span());
        let h = do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        start_cheat_caller_address(address, POOL());
        // amount_low, amount_high, salt, handle
        auction.privacy_invoke(PoolOperation::Reveal, 500, 0, 'salt1', h);
        stop_cheat_caller_address(address);

        assert(auction.get_revealed_count() == 1, 'revealed via pool');
        assert(auction.get_entry_status(h) == EntryStatus::Revealed, 'status revealed');
    }

    // Same authorisation rule as the commit path. Only the pool may drive it.
    #[test]
    #[should_panic(expected: 'caller not pool')]
    fn pool_reveal_rejects_other_callers() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());
        let h = do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.privacy_invoke(PoolOperation::Reveal, 500, 0, 'salt1', h);
    }

    // A wrong salt fails identically through the pool. The commitment check is
    // the same code, which is why do_reveal is shared rather than duplicated.
    #[test]
    #[should_panic(expected: 'commitment mismatch')]
    fn pool_reveal_still_checks_the_commitment() {
        let b1 = addr('b1');
        let (auction, _, address) = setup(array![b1].span());
        let h = do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        start_cheat_caller_address(address, POOL());
        auction.privacy_invoke(PoolOperation::Reveal, 500, 0, 'wrong_salt', h);
    }

    // The pool-routed claim. Pays the address committed at bid time, exactly as
    // the plain path does, so routing changes who submits and nothing else.
    #[test]
    fn pool_claim_pays_the_committed_address() {
        let b1 = addr('b1');
        let (auction, token, address) = setup(array![b1].span());
        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(500, 'salt1', handle('sec1', addr('p1')));
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        start_cheat_caller_address(address, POOL());
        auction.privacy_invoke(PoolOperation::Claim, 'sec1', addr('p1').into(), 0, 0);
        stop_cheat_caller_address(address);

        // Sole bidder, so the clearing price is the reserve.
        assert(token.balance_of(addr('p1')) == COLLATERAL - RESERVE, 'winner paid via pool');
    }

    // The destination is still bound by the handle, not chosen by the caller.
    // The pool being the caller does not weaken invariant 9.
    #[test]
    #[should_panic(expected: 'entry not claimable')]
    fn pool_claim_cannot_redirect_the_payout() {
        let b1 = addr('b1');
        let (auction, _, address) = setup(array![b1].span());
        do_commit(auction, b1, 500, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(500, 'salt1', handle('sec1', addr('p1')));
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        start_cheat_caller_address(address, POOL());
        // Correct secret, attacker's address. The recomputed handle differs, so
        // there is no such entry.
        auction.privacy_invoke(PoolOperation::Claim, 'sec1', addr('attacker').into(), 0, 0);
    }

    // Unused calldata slots must be zero, so a frontend that shifts its
    // arguments reverts instead of committing to something nobody intended.
    #[test]
    #[should_panic(expected: 'unused args must be zero')]
    fn pool_commit_rejects_dirty_unused_args() {
        let b1 = addr('b1');
        let (auction, _, address) = setup(array![b1].span());

        start_cheat_caller_address(address, POOL());
        auction.privacy_invoke(PoolOperation::Commit, 'commitment', 'handle', 7, 0);
    }

    // Found by an independent review. Zero is this contract's sentinel for both
    // "no winner" and "no entry", and both fields arrive as plain calldata, so
    // neither needed a hash preimage to forge.

    // A zero claim_handle on a winning bid would be stored as winner_handle,
    // which clearing_price reads as "nobody won". The seller would be paid
    // nothing for the sale, and the collateral would be stranded: unclaimable
    // because no preimage hashes to zero, and unforfeitable because the entry
    // was revealed.
    #[test]
    #[should_panic(expected: 'zero claim handle')]
    fn commit_rejects_a_zero_claim_handle() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());

        start_cheat_caller_address(auction.contract_address, b1);
        auction.commit('commitment', 0);
    }

    // A zero bid_commitment reads as "no entry here", so the same handle could
    // be committed repeatedly, taking collateral each time while overwriting
    // the previous entry.
    #[test]
    #[should_panic(expected: 'zero bid commitment')]
    fn commit_rejects_a_zero_bid_commitment() {
        let b1 = addr('b1');
        let (auction, _, _) = setup(array![b1].span());

        start_cheat_caller_address(auction.contract_address, b1);
        auction.commit(0, 'handle');
    }

    // Both guards apply to the pool path too, which is where a hostile
    // frontend would more plausibly reach them.
    #[test]
    #[should_panic(expected: 'zero claim handle')]
    fn pool_commit_rejects_a_zero_claim_handle() {
        let b1 = addr('b1');
        let (auction, _, address) = setup(array![b1].span());

        start_cheat_caller_address(address, POOL());
        auction.privacy_invoke(PoolOperation::Commit, 'commitment', 0, 0, 0);
    }

    #[test]
    #[should_panic(expected: 'zero bid commitment')]
    fn pool_commit_rejects_a_zero_bid_commitment() {
        let b1 = addr('b1');
        let (auction, _, address) = setup(array![b1].span());

        start_cheat_caller_address(address, POOL());
        auction.privacy_invoke(PoolOperation::Commit, 0, 'handle', 0, 0);
    }

    // Found by an independent review. take_collateral reads balance_of, which
    // looks like a read and is an external call: a view function may still call
    // another contract, and that call may mutate. A hostile token can reenter
    // cancel in that window, and before the entry was recorded the auction
    // still had zero commitments, so the cancel succeeded. The outer call then
    // recorded the entry anyway, leaving a Cancelled auction holding collateral
    // that could never be settled or claimed.
    //
    // Recording the entry first closes it: commitment_count is already non-zero
    // when balance_of runs, so the reentrant cancel is refused and the whole
    // transaction reverts.
    #[test]
    #[should_panic(expected: 'cannot cancel now')]
    fn hostile_token_cannot_cancel_mid_commit() {
        let token_class = declare("ReentrantToken").unwrap().contract_class();
        let (token_address, _) = token_class.deploy(@array![]).unwrap();

        let mut calldata: Array<felt252> = array![];
        handle(SELLER_SECRET, addr('seller_payout')).serialize(ref calldata);
        token_address.serialize(ref calldata);
        POOL().serialize(ref calldata);
        RESERVE.serialize(ref calldata);
        COLLATERAL.serialize(ref calldata);
        CLOSE.serialize(ref calldata);
        DEADLINE.serialize(ref calldata);
        AuctionKind::Vickrey.serialize(ref calldata);

        let auction_class = declare("SealedAuction").unwrap().contract_class();
        let (auction_address, _) = auction_class.deploy(@calldata).unwrap();
        let auction = ISealedAuctionDispatcher { contract_address: auction_address };

        IReentrantTokenDispatcher { contract_address: token_address }
            .arm(auction_address, SELLER_SECRET, addr('seller_payout'));

        start_cheat_block_timestamp_global(CLOSE - 1);
        start_cheat_caller_address(auction_address, POOL());
        auction.privacy_invoke(PoolOperation::Commit, 'commitment', 'handle', 0, 0);
    }

    // Found by an independent review, and the mirror of the commit-side guard.
    // A zero seller_handle makes claim_proceeds unsatisfiable, so the seller
    // could never take the clearing price or any forfeited collateral and it
    // would sit in the contract forever. Only the seller can set it and only
    // the seller loses, so it is a footgun rather than an attack, but there is
    // no way back from it once bidders have committed.
    #[test]
    fn constructor_rejects_a_zero_seller_handle() {
        let token_class = declare("MockERC20").unwrap().contract_class();
        let (token_address, _) = token_class.deploy(@array![]).unwrap();

        let mut calldata: Array<felt252> = array![];
        let zero_handle: felt252 = 0;
        zero_handle.serialize(ref calldata);
        token_address.serialize(ref calldata);
        POOL().serialize(ref calldata);
        RESERVE.serialize(ref calldata);
        COLLATERAL.serialize(ref calldata);
        CLOSE.serialize(ref calldata);
        DEADLINE.serialize(ref calldata);
        AuctionKind::Vickrey.serialize(ref calldata);

        let auction_class = declare("SealedAuction").unwrap().contract_class();
        match auction_class.deploy(@calldata) {
            Result::Ok(_) => panic!("a zero seller handle was accepted"),
            Result::Err(panic_data) => {
                assert(*panic_data.at(0) == 'zero claim handle', 'wrong rejection reason');
            },
        }
    }

    // Discovery rests entirely on this event existing. A getEvents query
    // filtered on its key alone returns every Sealed auction, so if the
    // constructor stops emitting it, auctions become invisible to the app while
    // still working perfectly on chain, which is a failure nobody would notice
    // until a seller asks why their listing is missing.
    #[test]
    fn constructor_announces_the_auction() {
        let token_class = declare("MockERC20").unwrap().contract_class();
        let (token_address, _) = token_class.deploy(@array![]).unwrap();

        let mut calldata: Array<felt252> = array![];
        handle(SELLER_SECRET, addr('seller_payout')).serialize(ref calldata);
        token_address.serialize(ref calldata);
        POOL().serialize(ref calldata);
        RESERVE.serialize(ref calldata);
        COLLATERAL.serialize(ref calldata);
        CLOSE.serialize(ref calldata);
        DEADLINE.serialize(ref calldata);
        AuctionKind::Vickrey.serialize(ref calldata);

        let mut spy = spy_events();
        let auction_class = declare("SealedAuction").unwrap().contract_class();
        let (auction_address, _) = auction_class.deploy(@calldata).unwrap();

        spy
            .assert_emitted(
                @array![
                    (
                        auction_address,
                        SealedAuction::Event::AuctionCreated(
                            SealedAuction::AuctionCreated {
                                token: token_address,
                                reserve_price: RESERVE,
                                collateral: COLLATERAL,
                                close_time: CLOSE,
                                reveal_deadline: DEADLINE,
                            },
                        ),
                    ),
                ],
            );
    }

    // RFP-08 names first-price alongside Vickrey. The two differ in exactly one
    // number, so they share a contract.
    #[test]
    fn first_price_winner_pays_their_own_bid() {
        let b1 = addr('b1');
        let b2 = addr('b2');
        let (auction, token, address) = setup_kind(array![b1, b2].span(), AuctionKind::FirstPrice);

        let h1 = do_commit(auction, b1, 800, 'salt1', 'sec1', addr('p1'));
        do_commit(auction, b2, 500, 'salt2', 'sec2', addr('p2'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(800, 'salt1', h1);
        auction.reveal(500, 'salt2', handle('sec2', addr('p2')));
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        // The whole difference: 800 rather than the runner-up's 500.
        assert(auction.get_clearing_price() == 800, 'pays own bid');

        auction.claim('sec1', addr('p1'));
        assert(token.balance_of(addr('p1')) == COLLATERAL - 800, 'winner refunded the rest');
        auction.claim('sec2', addr('p2'));
        assert(token.balance_of(addr('p2')) == COLLATERAL, 'loser refunded in full');
        assert(address == address, 'address used');
    }

    // The same auction under the default rule, so the difference is the kind
    // and nothing else.
    #[test]
    fn vickrey_winner_pays_the_runner_up() {
        let b1 = addr('b1');
        let b2 = addr('b2');
        let (auction, _, _) = setup(array![b1, b2].span());

        let h1 = do_commit(auction, b1, 800, 'salt1', 'sec1', addr('p1'));
        do_commit(auction, b2, 500, 'salt2', 'sec2', addr('p2'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(800, 'salt1', h1);
        auction.reveal(500, 'salt2', handle('sec2', addr('p2')));
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        assert(auction.get_clearing_price() == 500, 'pays the runner up');
    }

    // A sole bidder under first-price pays their bid, not the reserve. Under
    // Vickrey they pay the reserve, and that difference is easy to get wrong.
    #[test]
    fn first_price_sole_bidder_pays_their_bid() {
        let b1 = addr('b1');
        let (auction, _, _) = setup_kind(array![b1].span(), AuctionKind::FirstPrice);
        let h1 = do_commit(auction, b1, 700, 'salt1', 'sec1', addr('p1'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(700, 'salt1', h1);
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        assert(auction.get_clearing_price() == 700, 'not the reserve');
        assert(auction.get_kind() == AuctionKind::FirstPrice, 'kind reported');
    }

    // Invariant 5, fuzzed. The running top-two update has to be right for
    // reveals arriving in any order, including ties and duplicates.
    #[test]
    #[fuzzer]
    fn fuzz_invariant_5_top_two(a: u8, b: u8, c: u8) {
        // Map into [RESERVE, COLLATERAL] so every bid is valid.
        let a: u256 = RESERVE + a.into();
        let b: u256 = RESERVE + b.into();
        let c: u256 = RESERVE + c.into();

        let b1 = addr('b1');
        let b2 = addr('b2');
        let b3 = addr('b3');
        let (auction, _, _) = setup(array![b1, b2, b3].span());

        let h1 = do_commit(auction, b1, a, 'salt1', 'sec1', addr('p1'));
        let h2 = do_commit(auction, b2, b, 'salt2', 'sec2', addr('p2'));
        let h3 = do_commit(auction, b3, c, 'salt3', 'sec3', addr('p3'));

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(a, 'salt1', h1);
        auction.reveal(b, 'salt2', h2);
        auction.reveal(c, 'salt3', h3);
        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        // Highest of the three, with the first reveal winning any tie.
        let mut expected_winner = h1;
        let mut highest = a;
        if b > highest {
            highest = b;
            expected_winner = h2;
        }
        if c > highest {
            highest = c;
            expected_winner = h3;
        }

        // Second highest by value, counting duplicates: if two bids tie at the
        // top, the second highest equals the top.
        let mut second = if a == highest {
            0
        } else {
            a
        };
        let mut seen_top = false;
        if a == highest {
            seen_top = true;
        }
        if b == highest {
            if seen_top {
                second = highest;
            } else {
                seen_top = true;
            }
        } else if b > second {
            second = b;
        }
        if c == highest {
            if seen_top {
                second = highest;
            }
        } else if c > second {
            second = c;
        }

        let expected_price = if second > RESERVE {
            second
        } else {
            RESERVE
        };

        assert(auction.get_winner_handle() == expected_winner, 'winner');
        assert(auction.get_clearing_price() == expected_price, 'clearing price');
    }

    // Invariant 8, fuzzed. Sum of all claims never exceeds what was escrowed,
    // with three or more bidders. This is a property, not an example, so the
    // bid vector is fuzzed rather than hand-picked.
    #[test]
    #[fuzzer]
    fn fuzz_invariant_8_conservation(a: u8, b: u8, c: u8, paths: u8) {
        let a: u256 = RESERVE + a.into();
        let b: u256 = RESERVE + b.into();
        let c: u256 = RESERVE + c.into();

        let b1 = addr('b1');
        let b2 = addr('b2');
        let b3 = addr('b3');
        let (auction, token, auction_address) = setup(array![b1, b2, b3].span());

        // Low three bits of `paths` choose how each bidder funds its entry, so
        // all eight combinations of approve and pool funding are covered.
        // Conservation must not depend on which path was used.
        let h1 = if paths & 1 == 0 {
            do_commit(auction, b1, a, 'salt1', 'sec1', addr('p1'))
        } else {
            do_pool_commit(auction, token, auction_address, COLLATERAL, a, 'salt1', 'sec1', addr('p1'))
        };
        let h2 = if paths & 2 == 0 {
            do_commit(auction, b2, b, 'salt2', 'sec2', addr('p2'))
        } else {
            do_pool_commit(auction, token, auction_address, COLLATERAL, b, 'salt2', 'sec2', addr('p2'))
        };
        if paths & 4 == 0 {
            do_commit(auction, b3, c, 'salt3', 'sec3', addr('p3'));
        } else {
            do_pool_commit(auction, token, auction_address, COLLATERAL, c, 'salt3', 'sec3', addr('p3'));
        }

        let escrowed = COLLATERAL * 3;
        assert(token.balance_of(auction_address) == escrowed, 'escrowed');
        assert(auction.get_escrowed() == escrowed, 'ledger matches balance');

        start_cheat_block_timestamp_global(CLOSE + 1);
        auction.reveal(a, 'salt1', h1);
        auction.reveal(b, 'salt2', h2);
        // b3 never reveals: one forfeit in every run.

        start_cheat_block_timestamp_global(DEADLINE + 1);
        auction.settle();

        auction.claim('sec1', addr('p1'));
        auction.claim('sec2', addr('p2'));
        auction.claim_proceeds(SELLER_SECRET, addr('seller_payout'));

        let paid_out = token.balance_of(addr('p1'))
            + token.balance_of(addr('p2'))
            + token.balance_of(addr('seller_payout'));

        assert(paid_out <= escrowed, 'never overpays');
        // Everything is accounted for: nothing is stranded either.
        assert(paid_out == escrowed, 'fully distributed');
        assert(token.balance_of(auction_address) == 0, 'contract drained');
    }
}
