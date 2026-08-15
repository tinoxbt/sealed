//! The twelve invariants from ARCHITECTURE.md section 6.
//!
//! Coverage here is measured in invariants, not lines. Two of them are
//! properties rather than examples and are fuzzed: the running top-two update,
//! and conservation of funds across three or more bidders.

#[cfg(test)]
mod tests {
    use core::poseidon::poseidon_hash_span;
    use snforge_std::{
        ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp_global,
        start_cheat_caller_address, stop_cheat_caller_address,
    };
    use starknet::ContractAddress;
    use super::super::auction::{
        AuctionState, EntryStatus, ISealedAuctionDispatcher, ISealedAuctionDispatcherTrait,
    };
    use super::super::mock_erc20::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};

    const CLOSE: u64 = 1000;
    const DEADLINE: u64 = 2000;
    const COLLATERAL: u256 = 1000;
    const RESERVE: u256 = 100;

    const SELLER_SECRET: felt252 = 'seller_secret';

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
        let token_class = declare("MockERC20").unwrap().contract_class();
        let (token_address, _) = token_class.deploy(@array![]).unwrap();
        let token = IMockERC20Dispatcher { contract_address: token_address };

        let seller_handle = handle(SELLER_SECRET, addr('seller_payout'));

        let mut calldata: Array<felt252> = array![];
        seller_handle.serialize(ref calldata);
        token_address.serialize(ref calldata);
        RESERVE.serialize(ref calldata);
        COLLATERAL.serialize(ref calldata);
        CLOSE.serialize(ref calldata);
        DEADLINE.serialize(ref calldata);

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
    fn fuzz_invariant_8_conservation(a: u8, b: u8, c: u8) {
        let a: u256 = RESERVE + a.into();
        let b: u256 = RESERVE + b.into();
        let c: u256 = RESERVE + c.into();

        let b1 = addr('b1');
        let b2 = addr('b2');
        let b3 = addr('b3');
        let (auction, token, auction_address) = setup(array![b1, b2, b3].span());

        let h1 = do_commit(auction, b1, a, 'salt1', 'sec1', addr('p1'));
        let h2 = do_commit(auction, b2, b, 'salt2', 'sec2', addr('p2'));
        do_commit(auction, b3, c, 'salt3', 'sec3', addr('p3'));

        let escrowed = COLLATERAL * 3;
        assert(token.balance_of(auction_address) == escrowed, 'escrowed');

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
