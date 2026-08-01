import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Financial Signal Dashboard",
  description: "Research signals, not financial advice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-3xl px-6 py-10">
          <header className="mb-10 border-b border-line pb-6">
            <p className="text-xs uppercase tracking-wide text-muted">Financial Signal Dashboard</p>
            <div className="mt-1 flex items-baseline justify-between gap-4">
              <h1 className="text-2xl font-medium">
                <a href="/">Watchlist</a>
              </h1>
              <a href="/history" className="text-sm text-muted hover:text-ink">
                Track record
              </a>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
