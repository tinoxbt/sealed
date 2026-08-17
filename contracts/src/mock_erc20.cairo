//! Minimal ERC20 for tests only.
//!
//! openzeppelin_interfaces ships interfaces, not implementations, and the
//! auction needs a real token to move to test conservation of funds. Only the
//! three methods the auction calls are implemented, plus a mint helper.

#[starknet::interface]
pub trait IMockERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: starknet::ContractAddress, amount: u256)
        -> bool;
    fn transfer_from(
        ref self: TContractState,
        sender: starknet::ContractAddress,
        recipient: starknet::ContractAddress,
        amount: u256,
    ) -> bool;
    fn approve(ref self: TContractState, spender: starknet::ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @TContractState, account: starknet::ContractAddress) -> u256;
    fn mint(ref self: TContractState, recipient: starknet::ContractAddress, amount: u256);
}

#[starknet::contract]
pub mod MockERC20 {
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[abi(embed_v0)]
    impl MockERC20Impl of super::IMockERC20<ContractState> {
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let caller = get_caller_address();
            let from = self.balances.entry(caller).read();
            assert(from >= amount, 'insufficient balance');
            self.balances.entry(caller).write(from - amount);
            self.balances.entry(recipient).write(self.balances.entry(recipient).read() + amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let allowed = self.allowances.entry((sender, caller)).read();
            assert(allowed >= amount, 'insufficient allowance');
            let from = self.balances.entry(sender).read();
            assert(from >= amount, 'insufficient balance');

            self.allowances.entry((sender, caller)).write(allowed - amount);
            self.balances.entry(sender).write(from - amount);
            self.balances.entry(recipient).write(self.balances.entry(recipient).read() + amount);
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.entry((get_caller_address(), spender)).write(amount);
            true
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.entry(account).read()
        }

        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.balances.entry(recipient).write(self.balances.entry(recipient).read() + amount);
        }
    }
}

/// A token whose `balance_of` reenters the auction and cancels it.
///
/// Tests only. Models a hostile token supplied at construction: `balance_of`
/// looks like a read, so it is easy to assume it cannot reenter, but a view
/// function may still call another contract and that call may mutate.
#[starknet::interface]
pub trait IReentrantToken<TContractState> {
    fn arm(
        ref self: TContractState,
        auction: starknet::ContractAddress,
        seller_secret: felt252,
        payout: starknet::ContractAddress,
    );
    fn transfer(ref self: TContractState, recipient: starknet::ContractAddress, amount: u256)
        -> bool;
    fn balance_of(self: @TContractState, account: starknet::ContractAddress) -> u256;
    fn mint(ref self: TContractState, recipient: starknet::ContractAddress, amount: u256);
}

#[starknet::contract]
pub mod ReentrantToken {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::ContractAddress;
    use super::super::auction::{ISealedAuctionDispatcher, ISealedAuctionDispatcherTrait};

    #[storage]
    struct Storage {
        auction: ContractAddress,
        seller_secret: felt252,
        payout: ContractAddress,
        armed: bool,
    }

    #[abi(embed_v0)]
    impl ReentrantTokenImpl of super::IReentrantToken<ContractState> {
        fn arm(
            ref self: ContractState,
            auction: ContractAddress,
            seller_secret: felt252,
            payout: ContractAddress,
        ) {
            self.auction.write(auction);
            self.seller_secret.write(seller_secret);
            self.payout.write(payout);
            self.armed.write(true);
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            true
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            if self.armed.read() {
                ISealedAuctionDispatcher { contract_address: self.auction.read() }
                    .cancel(self.seller_secret.read(), self.payout.read());
            }
            // Large enough that the arrival check would otherwise pass.
            1000000000000
        }

        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {}
    }
}
