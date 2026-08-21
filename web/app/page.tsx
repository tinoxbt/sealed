import Link from "next/link";
import { Logo } from "../src/components/Logo";
import { LiveAuctions } from "../src/components/LiveAuctions";

export default function LandingPage() {
  return (
    <main>
      {/* Hero */}
      <section className="relative border-b border-[var(--line)]">
        <div className="absolute inset-0 grid-bg" />
        <div className="absolute inset-0 seal-glow" />
        <div className="relative mx-auto max-w-4xl px-5 pt-20 pb-24 text-center">
          <div className="flex justify-center mb-8">
            <Logo size={64} />
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1]">
            Auctions where nobody knows
            <br />
            <span className="text-[var(--seal)]">who is bidding</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[var(--muted)] text-lg leading-relaxed">
            Sealed-bid, second-price auctions on Starknet. Every bid is hidden until
            reveal, every bidder escrows the same collateral, and no address that
            belongs to a bidder appears at any point.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/auctions" className="btn-primary px-6">Browse auctions</Link>
            <Link href="/create" className="btn-ghost px-6">Sell something</Link>
          </div>
          <p className="mt-6 text-xs text-[var(--faint)]">
            Sepolia testnet. Built on the STRK20 privacy pool.
          </p>
        </div>
      </section>

      {/* The mechanism, in three numbers */}
      <section className="mx-auto max-w-5xl px-5 py-16">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              n: "01",
              t: "Commit",
              d: "You submit a Poseidon hash of your bid, not the bid. The pool moves your collateral and calls the auction in one transaction, so the chain sees the pool, never you.",
            },
            {
              n: "02",
              t: "Reveal",
              d: "After bidding closes, you open your commitment. The contract recomputes the hash and rejects anything that does not match. Stay silent and your collateral goes to the seller.",
            },
            {
              n: "03",
              t: "Settle",
              d: "The highest bidder wins and pays the second-highest bid. Everyone claims to an address they committed to before bidding, which nothing can redirect.",
            },
          ].map((s) => (
            <div key={s.n} className="card p-6">
              <span className="mono text-xs text-[var(--seal)]">{s.n}</span>
              <h3 className="mt-3 text-lg font-medium">{s.t}</h3>
              <p className="mt-2 text-sm text-[var(--muted)] leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Live auctions, read straight from chain */}
      <section className="mx-auto max-w-5xl px-5 pb-16">
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Live now</h2>
            <p className="text-sm text-[var(--muted)] mt-1">
              Read from chain events. There is no server holding a list.
            </p>
          </div>
          <Link href="/auctions" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
            All auctions
          </Link>
        </div>
        <LiveAuctions limit={3} />
      </section>

      {/* Honest privacy model */}
      <section className="border-t border-[var(--line)]">
        <div className="mx-auto max-w-5xl px-5 py-16">
          <h2 className="text-xl font-semibold tracking-tight">What is hidden, and what is not</h2>
          <p className="text-sm text-[var(--muted)] mt-1 mb-6">
            Stated plainly, because an auction that overclaims its privacy is worse than
            one that does not claim any.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card p-6">
              <h3 className="font-medium text-[var(--good)]">Hidden</h3>
              <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                <li>Which person is behind any bidder, at every phase</li>
                <li>Every bid amount, until that bidder reveals it</li>
                <li>The seller's identity, by the same mechanism</li>
                <li>Where a payout goes, until it is claimed</li>
              </ul>
            </div>
            <div className="card p-6">
              <h3 className="font-medium text-[var(--warn)]">Visible</h3>
              <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                <li>That the auction exists, its reserve and collateral</li>
                <li>How many commitments, and when each arrived</li>
                <li>Every revealed amount, and the clearing price</li>
                <li>Each claim amount, which identifies which payout won</li>
              </ul>
            </div>
          </div>
          <p className="mt-5 text-sm text-[var(--muted)]">
            The full list, including the leaks we have not closed, is in{" "}
            <a
              className="text-[var(--text)] underline underline-offset-4"
              href="https://github.com/tinoxbt/sealed/blob/main/docs/PRIVACY.md"
            >
              PRIVACY.md
            </a>
            .
          </p>
        </div>
      </section>

      {/* Why second price */}
      <section className="border-t border-[var(--line)]">
        <div className="mx-auto max-w-3xl px-5 py-16">
          <h2 className="text-xl font-semibold tracking-tight">Why the winner pays less than they bid</h2>
          <div className="mt-4 space-y-4 text-[var(--muted)] leading-relaxed">
            <p>
              In a second-price auction the highest bidder wins but pays the runner-up's
              bid. That sounds like the seller leaving money behind. It is not.
            </p>
            <p>
              Because what you pay is set by someone else's number, shading your bid down
              cannot lower your price. It can only lose you the auction. So the best thing
              you can do is bid exactly what the item is worth to you, and the seller
              learns the truth rather than a set of guesses about each other.
            </p>
            <p className="text-[var(--text)]">
              eBay's proxy bidding is the same mechanism, used by hundreds of millions of
              people who have never heard the word Vickrey.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
