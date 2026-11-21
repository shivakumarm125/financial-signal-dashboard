import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Signals",
  description: "A weekly read on a few stocks. One opinion, not financial advice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-2xl px-5 py-8 sm:py-12">
          <header className="mb-8 flex items-baseline justify-between gap-4">
            <a href="/" className="text-xl font-semibold tracking-tight">
              Stock Signals
            </a>
            <nav className="flex items-baseline gap-5 text-[15px]">
              <a href="/" className="text-muted hover:text-ink">
                My stocks
              </a>
              <a href="/history" className="text-muted hover:text-ink">
                Past results
              </a>
              <a href="/manage" className="text-xs text-muted/70 hover:text-ink">
                Manage
              </a>
            </nav>
          </header>
          {children}
          <footer className="mt-12 border-t border-line pt-5 text-xs leading-relaxed text-muted">
            These are computer-generated opinions, not financial advice. They can be wrong. You are responsible for
            your own decisions.
          </footer>
        </div>
      </body>
    </html>
  );
}
