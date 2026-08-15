import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sealed",
  description: "Sealed-bid, second-price auctions on Starknet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
