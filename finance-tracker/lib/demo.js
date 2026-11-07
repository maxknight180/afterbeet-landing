// Demo bank: lets you try the whole app without Plaid keys. It fills in a
// couple of months of realistic history and then "makes purchases" on a
// timer so you can watch the dashboard update by itself.
const crypto = require('crypto');
const store = require('./store');
const { applyChanges, notify } = require('./sync');

const ITEM_ID = 'demo-item';
const CHECKING = 'demo-checking';
const CARD = 'demo-card';

const MERCHANTS = [
  ['Whole Foods Market', 'Groceries', 35, 140, CARD],
  ["Trader Joe's", 'Groceries', 20, 90, CARD],
  ['Starbucks', 'Eating out', 4, 12, CARD],
  ['Chipotle', 'Eating out', 11, 28, CARD],
  ['Uber Eats', 'Eating out', 18, 55, CARD],
  ['Amazon', 'Shopping', 12, 120, CARD],
  ['Target', 'Shopping', 15, 95, CARD],
  ['Uber', 'Transport', 9, 38, CARD],
  ['Shell', 'Transport', 30, 65, CARD],
  ['AMC Theatres', 'Entertainment', 14, 40, CARD],
  ['Resident Advisor Tickets', 'Entertainment', 25, 80, CARD],
  ['CVS Pharmacy', 'Health', 8, 45, CARD],
  ['Great Clips', 'Personal care', 20, 35, CARD],
];

const RECURRING = [
  // [day of month, name, category, amount, account]
  [1, 'Rent — Parkside Apartments', 'Housing', 1450, CHECKING],
  [3, 'Spotify', 'Entertainment', 11.99, CARD],
  [8, 'Netflix', 'Entertainment', 15.49, CARD],
  [12, 'City Power & Light', 'Bills & utilities', 84.2, CHECKING],
  [15, 'Verizon Wireless', 'Bills & utilities', 65, CHECKING],
  [20, 'Planet Fitness', 'Health', 24.99, CARD],
  [1, 'Payroll — Acme Corp', 'Income', -2150, CHECKING],
  [15, 'Payroll — Acme Corp', 'Income', -2150, CHECKING],
  [25, 'Credit card payment', 'Transfers', 900, CHECKING],
];

function round2(n) {
  return Math.round(n * 100) / 100;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function makeTx(date, name, category, amount, accountId, pending = false) {
  return {
    id: `demo-${crypto.randomUUID()}`,
    source: 'demo',
    itemId: ITEM_ID,
    accountId,
    date,
    name,
    amount: round2(amount),
    currency: 'USD',
    pending,
    pendingId: null,
    category,
    logo: null,
  };
}

function randomPurchase(date, pending) {
  const [name, category, min, max, account] = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)];
  return makeTx(date, name, category, rand(min, max), account, pending);
}

function isLinked() {
  return store.get().items.some((i) => i.id === ITEM_ID);
}

function link() {
  const db = store.get();
  if (isLinked()) return;
  db.items.push({ id: ITEM_ID, source: 'demo', institution: 'Demo Bank', status: 'ok', linkedAt: new Date().toISOString() });

  const txs = [];
  const today = new Date();
  for (let back = 75; back >= 0; back--) {
    const d = new Date(today);
    d.setDate(d.getDate() - back);
    const date = isoDate(d);
    for (const [day, name, category, amount, account] of RECURRING) {
      if (d.getDate() === day) txs.push(makeTx(date, name, category, amount, account));
    }
    const count = Math.random() < 0.25 ? 0 : 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) txs.push(randomPurchase(date, false));
  }

  applyChanges(ITEM_ID, {
    added: txs,
    accounts: [
      { id: CHECKING, itemId: ITEM_ID, name: 'Everyday Checking', mask: '4821', type: 'depository', subtype: 'checking', balanceCurrent: 3240.18, balanceAvailable: 3190.18, currency: 'USD' },
      { id: CARD, itemId: ITEM_ID, name: 'Rewards Visa', mask: '0067', type: 'credit', subtype: 'credit card', balanceCurrent: 612.4, balanceAvailable: 4387.6, currency: 'USD' },
    ],
  });
  notify('linked', { itemId: ITEM_ID, newTransactions: [], newCount: txs.length, initial: true });
}

// A brand-new card purchase arrives, just like a real bank feed.
function simulatePurchase() {
  if (!isLinked()) return null;
  const db = store.get();
  const tx = randomPurchase(isoDate(new Date()), true);
  const card = db.accounts.find((a) => a.id === CARD);
  const fresh = applyChanges(ITEM_ID, {
    added: [tx],
    accounts: card ? [{ ...card, balanceCurrent: round2(card.balanceCurrent + tx.amount), balanceAvailable: round2(card.balanceAvailable - tx.amount) }] : [],
  });
  notify('purchase', { itemId: ITEM_ID, newTransactions: fresh, newCount: fresh.length });
  return tx;
}

function unlink() {
  const db = store.get();
  db.items = db.items.filter((i) => i.id !== ITEM_ID);
  db.accounts = db.accounts.filter((a) => a.itemId !== ITEM_ID);
  db.transactions = db.transactions.filter((t) => t.itemId !== ITEM_ID);
  store.save();
}

let timer = null;
function startFeed(seconds) {
  if (timer || !seconds) return;
  timer = setInterval(() => {
    if (isLinked()) simulatePurchase();
  }, seconds * 1000);
  timer.unref();
}

module.exports = { ITEM_ID, isLinked, link, unlink, simulatePurchase, startFeed };
