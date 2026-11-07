// Keeps the local ledger in step with linked banks and tells open browser
// tabs when something changes.
const { EventEmitter } = require('events');
const store = require('./store');
const plaid = require('./plaid');
const { mapPlaidCategory } = require('./categories');

const events = new EventEmitter();
events.setMaxListeners(100);

function fromPlaidTransaction(t, itemId) {
  return {
    id: t.transaction_id,
    source: 'plaid',
    itemId,
    accountId: t.account_id,
    // authorized_date = when you made the purchase; date = when it posted.
    date: t.authorized_date || t.date,
    name: t.merchant_name || t.name,
    amount: t.amount, // Plaid convention: positive = money out, negative = money in
    currency: t.iso_currency_code || t.unofficial_currency_code || null,
    pending: Boolean(t.pending),
    pendingId: t.pending_transaction_id || null,
    category: mapPlaidCategory(t.personal_finance_category, t.amount),
    logo: t.logo_url || null,
  };
}

function fromPlaidAccount(a, itemId) {
  return {
    id: a.account_id,
    itemId,
    name: a.name || a.official_name || 'Account',
    mask: a.mask || null,
    type: a.type,
    subtype: a.subtype || null,
    balanceCurrent: a.balances ? a.balances.current : null,
    balanceAvailable: a.balances ? a.balances.available : null,
    currency: (a.balances && (a.balances.iso_currency_code || a.balances.unofficial_currency_code)) || null,
  };
}

// Merge changes into the ledger. `added`/`modified` are already in our format.
// Returns the genuinely new purchases (a pending charge that posts is not new).
function applyChanges(itemId, { added = [], modified = [], removed = [], accounts = [] }) {
  const db = store.get();
  const byId = new Map(db.transactions.map((t) => [t.id, t]));
  const now = new Date().toISOString();
  const fresh = [];

  for (const tx of added) {
    const replacesPending = tx.pendingId && byId.has(tx.pendingId);
    // Keep a category you set on the pending version.
    if (tx.pendingId && db.overrides[tx.pendingId]) {
      db.overrides[tx.id] = db.overrides[tx.pendingId];
      delete db.overrides[tx.pendingId];
    }
    if (!byId.has(tx.id) && !replacesPending) fresh.push(tx);
    const previous = byId.get(tx.id) || (replacesPending && byId.get(tx.pendingId));
    byId.set(tx.id, { ...tx, addedAt: (previous && previous.addedAt) || now });
  }
  for (const tx of modified) {
    const previous = byId.get(tx.id);
    byId.set(tx.id, { ...tx, addedAt: (previous && previous.addedAt) || now });
  }
  for (const id of removed) {
    byId.delete(id);
    delete db.overrides[id];
  }
  db.transactions = [...byId.values()];

  if (accounts.length) {
    const others = db.accounts.filter((a) => !accounts.some((n) => n.id === a.id));
    db.accounts = [...others, ...accounts];
  }

  const item = db.items.find((i) => i.id === itemId);
  if (item) item.lastSync = now;
  store.save();
  return fresh;
}

function notify(reason, extra = {}) {
  events.emit('update', { reason, at: new Date().toISOString(), ...extra });
}

// One sync per bank at a time (webhooks and the timer can overlap).
const inFlight = new Map();

function syncItem(itemId, reason = 'sync') {
  if (inFlight.has(itemId)) return inFlight.get(itemId);
  const run = doSync(itemId, reason).finally(() => inFlight.delete(itemId));
  inFlight.set(itemId, run);
  return run;
}

async function doSync(itemId, reason) {
  const db = store.get();
  const item = db.items.find((i) => i.id === itemId);
  if (!item || item.source !== 'plaid') return [];

  const firstSync = !item.cursor;
  try {
    const changes = await plaid.syncTransactions(item.accessToken, item.cursor);
    let accounts = changes.accounts;
    if (!accounts.length) accounts = await plaid.getAccounts(item.accessToken);

    const fresh = applyChanges(itemId, {
      added: changes.added.map((t) => fromPlaidTransaction(t, itemId)),
      modified: changes.modified.map((t) => fromPlaidTransaction(t, itemId)),
      removed: changes.removed.map((r) => r.transaction_id),
      accounts: accounts.map((a) => fromPlaidAccount(a, itemId)),
    });
    item.cursor = changes.cursor;
    item.status = 'ok';
    item.error = null;
    store.save();

    if (fresh.length || changes.modified.length || changes.removed.length) {
      notify(reason, { itemId, newTransactions: firstSync ? [] : fresh.slice(0, 5), newCount: fresh.length, initial: firstSync });
    }
    return fresh;
  } catch (err) {
    const code = plaid.errorCode(err);
    item.status = code === 'ITEM_LOGIN_REQUIRED' || code === 'PENDING_EXPIRATION' ? 'login_required' : 'error';
    item.error = plaid.describeError(err);
    store.save();
    notify('error', { itemId });
    console.error(`[sync] ${item.institution}: ${item.error}`);
    return [];
  }
}

async function syncAll(reason = 'scheduled') {
  const db = store.get();
  for (const item of db.items.filter((i) => i.source === 'plaid')) {
    await syncItem(item.id, reason);
  }
}

module.exports = { events, notify, applyChanges, syncItem, syncAll, fromPlaidTransaction, fromPlaidAccount };
