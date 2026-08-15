#[starknet::interface]
pub trait IHello<TContractState> {
    fn set(ref self: TContractState, value: felt252);
    fn get(self: @TContractState) -> felt252;
}

#[starknet::contract]
mod Hello {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        value: felt252,
    }

    #[abi(embed_v0)]
    impl HelloImpl of super::IHello<ContractState> {
        fn set(ref self: ContractState, value: felt252) {
            self.value.write(value);
        }

        fn get(self: @ContractState) -> felt252 {
            self.value.read()
        }
    }
}
