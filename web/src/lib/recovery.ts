import { AUCTION_ADDRESS } from "./config";
import { provider } from "./provider";
import { openBackup, type Credentials, type Secrets } from "./vault";

/// Recover a bid from chain alone, with no file and no browser storage.
///
/// Every committed entry emits `Committed` with its handle as an indexed key,
/// so the set of handles in an auction is public. Each may carry an encrypted
/// blob. Recovery fetches them all and tries to open each one: yours opens,
/// everyone else's does not, and nothing on chain says which was which.
///
/// This is why `get_backup` takes no caller into account. A getter that only
/// answered the owner would need to know who the owner is, which is the one
/// thing the auction deliberately never learns.
const COMMITTED = "0x95542014d5fc13acaa51e82de0b688212f84245a32578a0b47821cbc88e3f5";

export type Recovered = Secrets & { claimHandle: string };

async function committedHandles(auction: string): Promise<string[]> {
  const handles: string[] = [];
  let token: string | undefined;
  do {
    const page = await provider.getEvents({
      address: auction,
      keys: [[COMMITTED]],
      from_block: { block_number: 0 },
      to_block: "latest",
      chunk_size: 100,
      continuation_token: token,
    });
    // keys[0] is the event selector, keys[1] the indexed claim_handle.
    for (const e of page.events) if (e.keys[1]) handles.push(e.keys[1]);
    token = page.continuation_token;
  } while (token);
  return handles;
}

export async function recoverFromChain(
  credentials: Credentials,
  auction: string = AUCTION_ADDRESS,
  onProgress?: (done: number, total: number) => void,
): Promise<Recovered[]> {
  const handles = await committedHandles(auction);
  const found: Recovered[] = [];

  for (let i = 0; i < handles.length; i++) {
    const res = await provider.callContract({
      contractAddress: auction,
      entrypoint: "get_backup",
      calldata: [handles[i]],
    });
    // Response is [len, ...words].
    const len = Number(BigInt(res[0]));
    if (len > 0) {
      const opened = await openBackup(res.slice(1, 1 + len), credentials);
      if (opened) found.push({ ...opened, claimHandle: handles[i] });
    }
    onProgress?.(i + 1, handles.length);
  }
  return found;
}
