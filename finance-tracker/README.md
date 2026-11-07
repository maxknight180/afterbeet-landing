# Finance Tracker

A personal finance dashboard that links to your bank. When you buy something
with a linked card or account, the purchase shows up on its own, sorted into a
budget category. The budget bars and totals update to match.

- **Bank linking** through [Plaid](https://plaid.com), the service behind most
  budgeting apps (Venmo, Robinhood, and others). Your bank login goes to Plaid,
  never to this app.
- **Automatic updates**: Plaid webhooks (instant when Plaid sees new activity)
  plus a background check every 15 minutes. Open browser tabs update live and
  pop up a notice for each new purchase.
- **Monthly budgets** per category, with warnings when you're close or over.
- **Spent / income / saved** for each month, with a comparison against the same
  point last month.
- **Daily spending chart**, account balances, searchable transaction list.
- **Re-categorize** any transaction (your choice is kept when a pending charge
  posts), **add cash transactions** by hand, and **edit budgets**.
- **Demo mode**: try everything without a Plaid account.

## 1. Try it (demo mode, 2 minutes)

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
cd finance-tracker
npm install
npm start
```

Open http://localhost:3000 and click **Connect bank**. A demo bank fills in two
months of history and then "makes a purchase" every 90 seconds. Click
**Simulate a purchase** to see one right away.

## 2. Link your real bank

1. Sign up at https://dashboard.plaid.com/signup (free for testing).
2. Copy `.env.example` to `.env`, then paste your **client ID** and **sandbox
   secret** from https://dashboard.plaid.com/developers/keys.
3. `npm start` and click **Connect bank**. In sandbox, pick any bank and log in
   with username `user_good`, password `pass_good`. For test data that keeps
   changing, use `user_transactions_dynamic` with any password.
4. For your **real** accounts, request Production access in the Plaid dashboard.
   Then set `PLAID_ENV=production` and use your production secret. Plaid charges
   per connected bank in production, so check https://plaid.com/pricing and their
   current personal/trial options. Disconnecting a bank in the app stops billing
   for it.

   Many large US banks (Chase, Bank of America, Wells Fargo, …) connect through
   OAuth. For those, set `PLAID_REDIRECT_URI` and add the same URL under
   *Allowed redirect URIs* in the Plaid dashboard.

### How fast do purchases show up?

Plaid checks each bank for new transactions **a few times a day** (it depends
on the bank). Card purchases often appear as **pending** within hours, then
switch to posted a day or two later. Once Plaid has new data, this app gets it:

- **With webhooks** (`PLAID_WEBHOOK_URL` set): within seconds. Plaid has to be
  able to reach the URL, so this needs the app hosted somewhere public, or a
  tunnel such as `ngrok http 3000` while testing. Webhooks are
  signature-checked, so fake ones are rejected.
- **Without webhooks**: on the next background check (`SYNC_INTERVAL_MINUTES`,
  default 15), or when you click **Sync now**.

Nothing pulls transactions faster than the bank shares them, so "real time" here
means "as soon as your bank reports it."

## 3. Running it all the time (optional)

On your own computer, `npm start` is enough. To use it from your phone or keep it
syncing while your laptop is off, host it on a small Node server (Render,
Railway, Fly.io, a VPS, …):

- Set `HOST=0.0.0.0` and **always set `APP_PASSWORD`**. Otherwise anyone with
  the link can see your finances. The browser asks for it (any username works).
- Use HTTPS (most hosts give you this automatically).
- Point `PLAID_WEBHOOK_URL` at `https://your-host/api/webhook`.
- The app stores its data in `data/db.json` (or `DATA_DIR`). That file holds your
  Plaid access tokens, so keep it on a persistent, private disk and never commit
  it. It's git-ignored.

## Customizing

- **Categories & default budgets**: `lib/categories.js`. Plaid's own categories
  are mapped to yours there too.
- **Budgets**: click **Edit budgets** in the app.
- **Currency**: `CURRENCY` in `.env` (e.g. `GBP`, `EUR`, `CAD`).

## Project layout

```
finance-tracker/
├── server.js          API, webhook receiver, live updates, background sync
├── lib/
│   ├── plaid.js       Plaid calls + webhook signature check
│   ├── sync.js        merges bank updates into the ledger, notifies the browser
│   ├── demo.js        demo bank
│   ├── categories.js  your categories, default budgets, Plaid mapping
│   └── store.js       JSON file storage (data/db.json)
├── public/            dashboard (plain HTML/CSS/JS, no build step)
└── test/              npm test, Plaid logic against a fake Plaid
```
