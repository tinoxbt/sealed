//! The only ERC20 surface the auction needs.
//!
//! openzeppelin_interfaces is pinned at 2.1.0. Version 0.17.0 and the 2.0.0
//! token package both fail to compile under Cairo 2.20.0.
pub use openzeppelin_interfaces::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
