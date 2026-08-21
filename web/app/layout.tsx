import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "../src/components/Shell";

export const metadata: Metadata = {
  title: "Sealed — private sealed-bid auctions on Starknet",
  description:
    "Sealed-bid, second-price auctions on Starknet. Bids stay hidden until reveal, and no bidder-controlled address appears at any phase.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
