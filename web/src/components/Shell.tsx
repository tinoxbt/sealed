"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./Logo";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/auctions", label: "Auctions" },
  { href: "/create", label: "Sell" },
  { href: "/reveal", label: "Reveal" },
  { href: "/claim", label: "Claim" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[rgba(8,8,10,0.82)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
          <Link href="/" className="shrink-0"><Wordmark size={24} /></Link>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-md px-3 py-1.5 transition-colors ${
                    active
                      ? "bg-[var(--surface-2)] text-[var(--text)]"
                      : "text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="pill border-[var(--line-bright)] text-[var(--muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--good)]" />
              Sepolia
            </span>
          </div>
        </div>
        {/* Mobile nav sits under the bar rather than behind a menu button: five
            links do not need a drawer. */}
        <nav className="md:hidden flex gap-1 overflow-x-auto border-t border-[var(--line)] px-4 py-2 text-sm">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`shrink-0 rounded-md px-3 py-1 ${
                  active ? "bg-[var(--surface-2)]" : "text-[var(--muted)]"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-[var(--line)] mt-20">
        <div className="mx-auto max-w-6xl px-5 py-10 grid gap-8 md:grid-cols-3 text-sm">
          <div className="space-y-3">
            <Wordmark size={22} />
            <p className="text-[var(--muted)] leading-relaxed">
              Sealed-bid, second-price auctions on Starknet. Bids stay hidden until reveal,
              and no bidder-controlled address appears at any phase.
            </p>
          </div>
          <div className="space-y-2">
            <p className="label">Read</p>
            {[
              ["Privacy model, including the leaks", "https://github.com/tinoxbt/sealed/blob/main/docs/PRIVACY.md"],
              ["Why second-price", "https://github.com/tinoxbt/sealed/blob/main/docs/MECHANISM.md"],
              ["Architecture", "https://github.com/tinoxbt/sealed/blob/main/docs/ARCHITECTURE.md"],
            ].map(([label, href]) => (
              <a key={href} href={href} className="block text-[var(--muted)] hover:text-[var(--text)]">
                {label}
              </a>
            ))}
          </div>
          <div className="space-y-2">
            <p className="label">Build</p>
            <a href="https://github.com/tinoxbt/sealed" className="block text-[var(--muted)] hover:text-[var(--text)]">
              Source, Apache 2.0
            </a>
            <a href="https://strk20.starknet.io" className="block text-[var(--muted)] hover:text-[var(--text)]">
              Built on STRK20
            </a>
            <p className="text-[var(--faint)] pt-2">
              Testnet. Nothing here is worth money.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function Page({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {lead && <p className="text-[var(--muted)] leading-relaxed">{lead}</p>}
      </header>
      {children}
    </main>
  );
}
