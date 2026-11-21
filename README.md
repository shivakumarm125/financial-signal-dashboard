# Stock Signals

A small dashboard you run yourself. Three times a week it gives a plain-English read on up to 10 US
stocks: is each one leaning up, leaning down, or showing no clear direction this week, and why?

It reads daily prices, recent news, SEC insider filings, earnings dates and forum chatter, then makes
one call per stock. Calls are made by **Claude** if you add an Anthropic API key, or by **simple free
rules** if you don't. Every call is checked a week later against what the price actually did, and
the results are shown openly.

> **Is it any good? Not yet, measurably.** Over the first 207 graded calls (as of November 2026),
> Claude's calls reached their target before their stop 51% of the time. Simply guessing "up" every
> time would have scored 63% over the same period, and the free rules 57%. Samples are small and
> overlapping, so none of these numbers are reliable. Treat this as a research toy and an honest
> experiment, **not financial advice**.

## What it looks like

- **My stocks:** one sentence for the week ("4 of your 5 stocks are leaning down this week"), then
  each stock's price, verdict, and a *price track*: a line from the price that would prove the call
  wrong to the price it's aiming for, with a dot for where the price is now.
- **Stock page:** the verdict in plain words ("If this plays out, the price could fall to about $60 by
  Fri 27 Nov. If it rises above $67.50 instead, this call was wrong."), what the data shows, the full
  reasoning, how past calls on that stock turned out, and the latest news.
- **Past results:** how many calls went as expected, how many went the other way, by stock, with
  the caveats spelled out.

## What it costs

| Service | What for | Cost |
|---|---|---|
| [Supabase](https://supabase.com) (or any Postgres) | Stores everything | Free plan is plenty |
| [Twelve Data](https://twelvedata.com) | Daily prices | Free plan (800 requests/day; this uses 1 per stock per update) |
| [Finnhub](https://finnhub.io) | News and earnings dates | Free plan |
| SEC EDGAR, StockTwits | Insider filings, forum posts | Free, no key |
| GitHub Actions | Runs the updates Mon/Wed/Fri | Free for this usage |
| [Vercel](https://vercel.com) | Hosts the website (optional) | Free plan |
| [Anthropic](https://console.anthropic.com) | Claude makes the calls (optional) | About $0.013 per stock per update, via the half-price Batch API. Measured: $0.064 for 5 stocks. |

Without a Claude key, the whole thing costs nothing.

## Set up your own copy

You'll need [Node.js](https://nodejs.org) 20 or newer, git, and free accounts at Supabase, Twelve
Data and Finnhub (the setup links to each).

```bash
git clone https://github.com/<you>/<your-fork>.git
cd <your-fork>
npm install
npm run setup
```

`npm run setup` walks you through it:

1. **Keys.** Asks for each one and checks it works, using free calls only. Saved to `apps/api/.env`
   and `apps/web/.env.local`, both git-ignored.
2. **Database tables.** Created for you.
3. **Your stocks.** Up to 10 US ticker symbols.
4. **First data.** A year of prices plus recent news, filings and earnings dates. The free data
   plans are rate-limited, so allow a few minutes per stock the first time.
5. **First calls.** Free with the rules; with Claude it shows the cost and asks first.
6. **Automatic updates.** If you use the [GitHub CLI](https://cli.github.com), it can copy your keys
   into your repo's secrets.

Re-run it any time: press Enter to keep each existing value.

Then see it on your computer:

```bash
npm run dev        # open http://localhost:3000
```

### Automatic updates (GitHub Actions)

`.github/workflows/daily-signals.yml` runs every Monday, Wednesday and Friday at 13:00 UTC. It needs
these repository secrets (Settings → Secrets and variables → Actions): `DATABASE_URL`,
`TWELVE_DATA_API_KEY`, `FINNHUB_API_KEY`, `EDGAR_USER_AGENT`, and optionally `CLAUDE_API_KEY`.

On a fork, open the **Actions** tab once and enable workflows. GitHub turns scheduled workflows off
on forks until you do.

If your Claude key stops working or your credit runs out, that update makes its calls with the free
rules instead, so the dashboard never goes stale. The run shows a warning saying so. Top up to go
back to Claude, or delete the `CLAUDE_API_KEY` secret to stay on the rules.

### Put the website online (Vercel)

Import your repo at [vercel.com/new](https://vercel.com/new), set the **root directory** to
`apps/web`, and add two environment variables (the values are in `apps/web/.env.local` after setup):

- `DATABASE_URL`: Supabase's *transaction* pooler (port 6543) with
  `?pgbouncer=true&connection_limit=1`. Setup writes this for you.
- `MANAGE_PASSWORD`: protects the **Manage** page, where stocks are added and removed.

Vercel protects new deployments behind your Vercel login by default. To share the site with other
people, turn off Deployment Protection for production in the project settings.

## How it works

```
GitHub Actions (Mon/Wed/Fri)                                     Vercel
┌───────────────────────────────────────────────────────┐        ┌──────────────┐
│ ingest: prices · news · filings · earnings · forum    │        │  apps/web    │
│    ↓                                                  │        │  (Next.js)   │
│ make a call per stock: Claude (Batch API) or rules    │──────▶ │  reads the   │
│    ↓                                                  │Postgres│  same DB     │
│ grade older calls against real prices after 7 days    │        └──────────────┘
└───────────────────────────────────────────────────────┘
```

- **A call** is a direction (up, down or none) plus a target and a stop price for the next 7 days. It
  counts as *went as expected* if the price reaches the target before the stop.
- **Claude** gets a structured prompt with the price trend, insider filings, the latest news, forum
  posts (labelled as unverified) and the earnings calendar, and must cite its sources. Bad citations
  or price levels on the wrong side of the price are rejected and retried.
- **The rules** use three checks: the trend against the 50- and 200-day averages, open-market
  insider purchases, and no call when earnings are due within the week.
- Each call records which engine made it, so the two track records never mix.

## Useful commands

From `apps/api` (`npm run <name>`):

| Command | What it does | Costs Claude credit? |
|---|---|---|
| `run:all` | The full update the scheduler runs | Yes, if a key is set |
| `baseline:rules` | Compares Claude with the free rules and simple guesses on the same calls | No |
| `backfill:gap` | Re-creates calls for dates the scheduler missed. Dry run unless `--confirm` | Only with `--confirm` |
| `run:backtest` | Calls for past dates, graded against what happened next | Yes |
| `screen:candidates` | Checks whether a stock has enough data to be worth following | No |
| `check:outcomes` | Grades calls whose week is up | No |

## Limitations

- US stocks only, up to 10, using daily prices.
- One watchlist per copy. There are no user accounts. The Manage page uses a single password.
- The schedule is fixed in UTC, so it shifts by an hour with US daylight saving.
- Forum posts come from StockTwits' public API, used on a non-commercial basis.
  See `docs/A3-disclaimer-data-use.md`.

## Project history

`TICKETS.md` and `docs/` are the original planning notes from when this was a private tool for a
handful of friends and family. They're kept because they record *why* things are the way they are,
including the failures that shaped them.

## License

[MIT](LICENSE). This software is not financial advice. It can be wrong, and you are responsible for
your own decisions.
