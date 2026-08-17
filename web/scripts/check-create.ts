/// Assert the create form refuses what the constructor refuses.
///
/// These are not cosmetic. A reveal window nobody can meet pays the seller
/// every bidder's collateral, and a reserve above the collateral makes every
/// possible bid invalid, so the auction cannot be won by anyone.
import { MIN_REVEAL_WINDOW_SECONDS, validate } from "../src/lib/create.js";

const now = Math.floor(Date.now() / 1000);
const hour = 3600;
const ok = {
  reserve: 10n ** 17n,
  collateral: 10n ** 18n,
  closeTime: now + hour,
  revealDeadline: now + 2 * hour,
};

function reject(label: string, p: typeof ok, expect: string) {
  const got = validate(p);
  if (!got) throw new Error(`${label}: accepted something the contract rejects`);
  if (!got.toLowerCase().includes(expect)) {
    throw new Error(`${label}: wrong reason, got "${got}"`);
  }
  console.log(`ok  rejects ${label}`);
}

if (validate(ok) !== null) throw new Error(`a valid auction was rejected: ${validate(ok)}`);
console.log("ok  accepts a valid auction");

reject("a reserve above the collateral", { ...ok, reserve: ok.collateral + 1n }, "reserve");
reject("zero collateral", { ...ok, collateral: 0n }, "collateral");
reject("a close time in the past", { ...ok, closeTime: now - 1, revealDeadline: now + hour }, "future");
reject(
  "a reveal deadline before close",
  { ...ok, revealDeadline: ok.closeTime - 1 },
  "after bidding closes",
);
reject(
  "a reveal window under the floor",
  { ...ok, revealDeadline: ok.closeTime + MIN_REVEAL_WINDOW_SECONDS - 1 },
  "minutes",
);

// The floor itself must be allowed, or the guard rejects more than it should.
if (validate({ ...ok, revealDeadline: ok.closeTime + MIN_REVEAL_WINDOW_SECONDS }) !== null) {
  throw new Error("the minimum reveal window was rejected");
}
console.log("ok  accepts exactly the minimum reveal window");
console.log("create validation unchanged");
