# Mechanism

Why second-price, why uniform collateral, and why forfeiture. Three choices that look arbitrary until you see what each one prevents.

---

## Why second-price

The highest bidder wins and pays the **second-highest** valid bid, or the reserve if only one bid was valid. This is a Vickrey auction, and the reason for it is a single property:

**Bidding your true value is the dominant strategy.**

Consider a bidder who values the item at 100.

- Bid 100, win at the second price. They pay less than 100 and profit by the margin.
- Bid 120 to win more often. The extra wins are exactly the cases where someone else bid between 100 and 120, so they win at a price above their own valuation. They lose money on precisely the auctions the overbid gained them.
- Bid 80 to pay less. They pay the second-highest bid either way, so shading the bid never lowers the price paid. It only forfeits the auctions where the second price fell between 80 and 100, which are the ones worth winning.

Deviating from the truth is never better and is sometimes worse. So the bidder states their real number, and the auction reveals real information about what the item is worth.

Under a **first-price** rule, none of this holds. A bidder who bids their true value pays their true value and profits nothing, so everyone shades downward, and how far depends on guesses about the other bidders. The winner is whoever guessed best, not whoever valued the item most, and the clearing price is a number about strategy rather than about the item.

### Why this needs privacy to work at all

The dominant-strategy argument assumes bids are genuinely sealed. If bids are visible before close, everything unravels:

- A late bidder reads the standing high bid and outbids it by the minimum increment. The auction degenerates into a first-price auction with worse timing dynamics.
- A seller who can see bids can insert a fake bid just under the highest one, raising the clearing price. This is **shill bidding**, and second-price auctions are structurally vulnerable to it, because the seller is paid the second price and can manufacture it directly.

So privacy here is not a feature bolted onto an auction. It is the precondition that makes the mechanism produce honest bids. This is why Sealed exists as a privacy project rather than as an auction that happens to be private.

### The one thing second-price does not fix

Sealed's seller sets the reserve price publicly, before any bids. That is deliberate: a reserve chosen after seeing bids is shill bidding by another name. The reserve is fixed in the constructor and cannot be changed.

---

## Why uniform collateral

Every bidder escrows an **identical** amount, and bids are capped at that amount.

This is the choice most likely to be reversed by someone optimising later, so the reasoning matters.

**The obvious design is proportional collateral: escrow what you bid.** It fails immediately. The escrow transfer is a public ERC20 movement. If a bidder escrows exactly their bid, the amount is written on chain in plaintext at commit time, and the commitment hash protects nothing at all. The auction would be sealed only in the sense that the number appears in a different field.

Uniform collateral makes every bidder's funding leg identical, so the visible transfer carries **zero** information about the bid. The commitment hides the amount, and the uniform escrow keeps the money from giving it away.

**What it costs:**

- Bids are capped at the collateral, so the collateral publicly bounds every bid from above.
- Capital efficiency is poor. A bidder who wants to bid 0.1 still locks the full collateral.

**Why that is the right trade.** The alternative is not "slightly more leakage", it is a sealed-bid auction whose bids are all public before close. The mechanism would be worthless. Sellers set the collateral to a band that suits the item, and the loss of range is the price of the seal.

**Corollary, non-negotiable:** never make collateral a function of the bid. Not proportionally, not in tiers, not with a "roughly bucketed" approximation. Any function of the bid that is visible on chain leaks the bid, and buckets leak it in a way that looks safe while narrowing it to a range.

---

## Why non-revelation forfeits

A bidder who commits and never reveals **loses their entire collateral to the seller**.

Without this, the auction has an obvious attack. Commit-reveal means a bidder learns something between committing and revealing, namely whether revealing is in their interest. A losing bidder who could simply walk away would:

- Reveal when winning is good for them
- Stay silent when it is not, keeping their number private and their money back

That is a free option, and free options destroy the mechanism. Bidders would routinely commit and selectively reveal, the revealed set would be biased, and the second price would be computed over whichever bids their owners chose to disclose. The clearing price would mean nothing.

Forfeiture prices that option. Silence costs the full collateral, so revealing is the only rational move for anyone who bid honestly, and the mechanism holds.

It also handles the degenerate case cleanly. **If nobody reveals, the auction settles with no winner and the seller takes the entire pot,** because every entry is forfeited. That is the same rule applied consistently rather than a special case, and it means an auction can never be griefed into a state where funds are stranded.

The cost is real and worth stating: a bidder who loses their `bid_salt`, or who is simply offline during the reveal window, loses their collateral through misfortune rather than strategy. Sealed mitigates that with a non-skippable backup at commit time and a reveal window measured in days rather than minutes. It does not eliminate it. A design that forgave honest mistakes would also forgive strategic silence, because the contract cannot tell them apart.

---

## Why the payout address is fixed at commit time

`claim_handle = poseidon(claim_secret, payout_address)`, and `claim` recomputes that hash.

The naive alternative is to let the claimer name a destination, or to pay `get_caller_address`. Both are broken, for the same reason: `claim_secret` is public the moment the claim transaction is submitted. An observer who sees a pending claim and can substitute their own destination steals the payout.

Binding the destination inside the hash removes the attack entirely. An attacker who copies a claim cannot change where it goes without breaking the hash, and replaying it verbatim only pays the rightful owner while burning the attacker's gas.

The consequence to design around: the payout address must exist **before** committing, since it is an input to the commitment. The interface derives it during the bid flow and writes it into the backup file alongside both secrets.

---

## Why two independent secrets

`bid_salt` hides the amount and becomes public at reveal. `claim_secret` proves ownership and is presented only in the claim transaction.

If one value did both jobs, then publishing it at reveal would hand every observer the ability to claim that entry. The reveal phase would become a race to drain losing bidders.

They are independent, generated separately, and the contract never accepts one where it expects the other.

---

## Summary

| Choice | Prevents |
| --- | --- |
| Second-price | Strategic underbidding, and clearing prices that measure guesswork instead of value |
| Sealed bids | Incremental outbidding, and shill bidding by the seller |
| Uniform collateral | The public escrow transfer leaking the bid it funds |
| Forfeiture on silence | A free option to reveal only when it pays |
| Payout bound at commit | Claim theft by substituting a destination |
| Two independent secrets | The reveal phase becoming a race to drain losers |

Each row is a specific failure. Remove any one and the corresponding attack becomes available, which is why `CLAUDE.md` marks them as scope decisions rather than defaults.

## Setting the collateral, and what it is really doing

The collateral is one number doing three jobs at once, and they pull against
each other.

1. **It caps the bid.** A reveal is only valid when `reserve <= amount <=
   collateral`, so the collateral is the highest bid the auction can accept.
2. **It prices silence.** A bidder who never reveals forfeits it. That is what
   stops the reveal from being a free option taken only when convenient.
3. **It sets the entry barrier**, and therefore how many people bid, and
   therefore the size of the anonymity set the privacy actually rests on.

Raise it and silence becomes expensive and high bids become possible, but fewer
people can afford to enter and the crowd they hide in shrinks. Lower it and more
people bid, but withholding a reveal gets cheap and the ceiling on bids drops.

The practical rule: **set the collateral a little above the highest bid you
think anyone will make.** High enough that forfeiting hurts, low enough not to
turn bidders away.

### Privacy has a price here, and it is the collateral

A consequence worth stating plainly, because it is unusual. A bidder who would
rather not disclose their number can simply not reveal. They lose the collateral
and the bid stays hidden permanently, since the salt is 31 random bytes and the
commitment is never opened.

So the collateral is the posted price of permanent secrecy, identical for
everyone, and chosen by the seller. A bidder for whom a revealed valuation would
be costly in future negotiations may find that price cheap.

This is the same mechanism as the griefing weakness, seen from the other side.
Forfeiture prices the option to withhold; pricing is not removing. The design
cannot have the elegant reading without the exploitable one, and both are stated
here rather than only the flattering one.

Note also that silence forfeits the item as well as the collateral. A bidder who
would have won pays twice for their privacy.

## Why the reveal window has a floor

The seller receives every forfeited collateral, and the seller also chooses the
reveal deadline. Those two facts together are an attack: set the deadline one
second after close, nobody reveals in time, every entry forfeits, and the seller
takes the entire pot without selling anything.

The constructor therefore refuses any auction whose reveal window is shorter than
ten minutes. That stops the absurd case. It is not a substitute for the bidder
checking the window before committing, which is why the interface displays it,
and a real auction should allow hours or days rather than the floor.

A different design would redistribute forfeited collateral to the bidders who did
reveal, rewarding disclosure instead of paying the party who benefits from
confusion. That is a change to the mechanism rather than a fix to a bug, and it
is recorded here as a considered alternative rather than adopted mid-sprint.
