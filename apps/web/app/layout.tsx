import type { Metadata } from "next";
import { Schibsted_Grotesk, Source_Serif_4 } from "next/font/google";
import "./globals.css";

// A newspaper grotesque for everything people scan, with figures sturdy
// enough to carry prices; a reading serif only for the long AI reasoning.
const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  title: "Stock Signals",
  description: "A weekly read on a few stocks. One opinion, not financial advice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <div className="mx-auto max-w-[44rem] px-5 pb-16 pt-8 sm:pt-12">
          <header className="mb-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <a href="/" className="group">
              <span className="block text-[1.7rem] font-extrabold leading-none tracking-[-0.03em]">Stock Signals</span>
              <span className="mt-1 block text-sm text-muted">A weekly read on the stocks you follow</span>
            </a>
            <nav className="flex items-center gap-1 text-[15px] font-medium">
              <a href="/" className="rounded-full px-3 py-1.5 hover:bg-white">
                My stocks
              </a>
              <a href="/history" className="rounded-full px-3 py-1.5 hover:bg-white">
                Past results
              </a>
              <a href="/manage" className="rounded-full px-3 py-1.5 text-sm font-normal text-muted hover:bg-white">
                Manage
              </a>
            </nav>
          </header>
          {children}
          <footer className="mt-16 max-w-[34rem] text-sm leading-relaxed text-muted">
            These are computer-generated opinions, not financial advice. They can be wrong, and you are responsible for
            your own decisions.
          </footer>
        </div>
      </body>
    </html>
  );
}
