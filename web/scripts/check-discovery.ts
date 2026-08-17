/// Discovery is the only way the app learns an auction exists, and it decodes
/// raw event data by position. A silent mis-decode would show wrong collateral
/// next to a real auction, which is worse than showing nothing.
///
/// This checks against the live chain rather than a fixture, because the thing
/// most likely to break is the event layout, and a fixture would be updated to
/// match a broken decode.
import { discoverAuctions } from "../src/lib/discovery.js";
import { provider } from "../src/lib/provider.js";

const found = await discoverAuctions(20000);
console.log(`discovered ${found.length} auction(s)`);
if (found.length === 0) throw new Error("no auctions found, discovery is broken or the lookback is too short");

for (const a of found.slice(0, 3)) {
  const [col, res] = await Promise.all([
    provider.callContract({ contractAddress: a.address, entrypoint: "get_collateral", calldata: [] }),
    provider.callContract({ contractAddress: a.address, entrypoint: "get_reserve_price", calldata: [] }),
  ]);
  const onChainCollateral = BigInt(col[0]) + (BigInt(col[1]) << 128n);
  const onChainReserve = BigInt(res[0]) + (BigInt(res[1]) << 128n);

  if (onChainCollateral !== a.collateral) {
    throw new Error(`${a.address}: collateral decoded ${a.collateral}, contract says ${onChainCollateral}`);
  }
  if (onChainReserve !== a.reservePrice) {
    throw new Error(`${a.address}: reserve decoded ${a.reservePrice}, contract says ${onChainReserve}`);
  }
  console.log(`ok  ${a.address.slice(0, 14)}... decoded values match the contract`);
}
console.log("discovery decode verified against chain state");
