require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const path = require('path');
const express = require('express');

const store = require('./lib/store');
const plaid = require('./lib/plaid');
const sync = require('./lib/sync');
const demo = require('./lib/demo');
const { ALL_CATEGORIES, SPENDING_CATEGORIES } = require('./lib/categories');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const SYNC_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 15);
const DEMO_SECONDS = Number(process.env.DEMO_PURCHASE_SECONDS ?? 90);
const MODE = plaid.isConfigured() ? 'plaid' : 'demo';

store.load();
const app = express();
app.disable('x-powered-by');

// --- Plaid webhook (must come before auth + JSON parsing: needs the raw body)
app.post('/api/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  if (MODE !== 'plaid') return res.sendStatus(404);
  try {
    const ok = await plaid.verifyWebhook(req.body, req.get('Plaid-Verification'));
    if (!ok) return res.sendStatus(401);
  } catch (err) {
    console.error('[webhook] verification failed:', plaid.describeError(err));
    return res.sendStatus(401);
  }
  res.sendStatus(200); // acknowledge fast; Plaid retries slow responses
  let body;
  try {
    body = JSON.parse(req.body.toString('utf8'));
  } catch {
    return;
  }
  const item = store.get().items.find((i) => i.id === body.item_id);
  if (!item) return;
  if (body.webhook_type === 'TRANSACTIONS' && body.webhook_code === 'SYNC_UPDATES_AVAILABLE') {
    sync.syncItem(item.id, 'webhook');
  } else if (body.webhook_type === 'ITEM' && ['ERROR', 'PENDING_EXPIRATION', 'PENDING_DISCONNECT'].includes(body.webhook_code)) {
    item.status = 'login_required';
    item.error = (body.error && body.error.error_message) || 'Your bank needs you to sign in again.';
    store.save();
    sync.notify('error', { itemId: item.id });
  } else if (body.webhook_type === 'ITEM' && body.webhook_code === 'LOGIN_REPAIRED') {
    item.status = 'ok';
    item.error = null;
    store.save();
    sync.syncItem(item.id, 'webhook');
  }
});

// --- Optional password (strongly recommended if this runs anywhere but your own computer)
if (process.env.APP_PASSWORD) {
  const expected = crypto.createHash('sha256').update(process.env.APP_PASSWORD).digest();
  app.use((req, res, next) => {
    const header = req.get('authorization') || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const password = decoded.slice(decoded.indexOf(':') + 1);
      const given = crypto.createHash('sha256').update(password).digest();
      if (crypto.timingSafeEqual(given, expected)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Finance Tracker"').status(401).send('Password required');
  });
}

app.use(express.json({ limit: '100kb' }));

// Changes must be sent as JSON; this stops other websites from submitting
// forms to the API in your browser.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'DELETE' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Expected JSON' });
  }
  next();
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
  }),
);

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(`[api] ${req.method} ${req.path}:`, plaid.describeError(err));
    res.status(500).json({ error: plaid.describeError(err) });
  });

function publicItem(i) {
  // Never send access tokens to the browser.
  return { id: i.id, source: i.source, institution: i.institution, status: i.status || 'ok', error: i.error || null, lastSync: i.lastSync || null, linkedAt: i.linkedAt };
}

app.get('/api/state', (req, res) => {
  const db = store.get();
  res.json({
    mode: MODE,
    plaidEnv: MODE === 'plaid' ? plaid.ENV : null,
    webhooks: Boolean(process.env.PLAID_WEBHOOK_URL),
    syncMinutes: SYNC_MINUTES,
    currency: process.env.CURRENCY || 'USD',
    categories: ALL_CATEGORIES,
    spendingCategories: SPENDING_CATEGORIES,
    items: db.items.map(publicItem),
    accounts: db.accounts,
    budgets: db.budgets,
    transactions: db.transactions.map((t) => ({ ...t, category: db.overrides[t.id] || t.category })),
  });
});

// Live updates to the browser (Server-Sent Events).
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  sync.events.on('update', send);
  req.on('close', () => {
    clearInterval(ping);
    sync.events.off('update', send);
  });
});

// --- Bank linking
app.post('/api/link/token', wrap(async (req, res) => {
  if (MODE !== 'plaid') return res.json({ mode: 'demo' });
  let accessToken;
  if (req.body && req.body.itemId) {
    const item = store.get().items.find((i) => i.id === req.body.itemId);
    if (!item || item.source !== 'plaid') return res.status(404).json({ error: 'Unknown bank connection' });
    accessToken = item.accessToken;
  }
  res.json({ mode: 'plaid', linkToken: await plaid.createLinkToken({ accessToken }) });
}));

app.post('/api/link/exchange', wrap(async (req, res) => {
  if (MODE !== 'plaid') return res.status(400).json({ error: 'Plaid is not configured' });
  const { publicToken, institution } = req.body || {};
  if (typeof publicToken !== 'string') return res.status(400).json({ error: 'publicToken required' });
  const { accessToken, itemId } = await plaid.exchangePublicToken(publicToken);
  const db = store.get();
  db.items = db.items.filter((i) => i.id !== itemId);
  db.items.push({
    id: itemId,
    source: 'plaid',
    institution: (institution && String(institution).slice(0, 80)) || 'Bank',
    accessToken,
    cursor: null,
    status: 'ok',
    linkedAt: new Date().toISOString(),
  });
  store.save();
  await sync.syncItem(itemId, 'linked');
  // Right after linking, Plaid may still be fetching history. Check back a few
  // times so it shows up even without webhooks.
  for (const seconds of [15, 45, 120, 300]) setTimeout(() => sync.syncItem(itemId, 'linked'), seconds * 1000).unref();
  res.json({ ok: true, item: publicItem(db.items.find((i) => i.id === itemId)) });
}));

app.post('/api/demo/link', (req, res) => {
  if (MODE !== 'demo') return res.status(400).json({ error: 'Demo bank is only available without Plaid keys' });
  demo.link();
  res.json({ ok: true });
});

app.post('/api/demo/purchase', (req, res) => {
  if (MODE !== 'demo' || !demo.isLinked()) return res.status(400).json({ error: 'Link the demo bank first' });
  res.json({ ok: true, transaction: demo.simulatePurchase() });
});

app.post('/api/items/:id/sync', wrap(async (req, res) => {
  const item = store.get().items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Unknown bank connection' });
  if (item.source === 'plaid') {
    if (req.body && req.body.reconnected) {
      item.status = 'ok';
      item.error = null;
      store.save();
    }
    await sync.syncItem(item.id, 'manual');
  }
  res.json({ ok: true, item: publicItem(item) });
}));

app.delete('/api/items/:id', wrap(async (req, res) => {
  const db = store.get();
  const item = db.items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Unknown bank connection' });
  if (item.source === 'demo') {
    demo.unlink();
  } else {
    try {
      await plaid.removeItem(item.accessToken); // stops Plaid billing for this bank
    } catch (err) {
      console.warn('[unlink] Plaid item/remove failed:', plaid.describeError(err));
    }
    const ids = new Set(db.transactions.filter((t) => t.itemId === item.id).map((t) => t.id));
    db.items = db.items.filter((i) => i.id !== item.id);
    db.accounts = db.accounts.filter((a) => a.itemId !== item.id);
    db.transactions = db.transactions.filter((t) => !ids.has(t.id));
    for (const id of ids) delete db.overrides[id];
    store.save();
  }
  sync.notify('unlinked', { itemId: item.id });
  res.json({ ok: true });
}));

// --- Transactions & budgets
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.post('/api/transactions', (req, res) => {
  const { date, name, amount, category, type } = req.body || {};
  const value = Number(amount);
  if (!DATE_RE.test(date || '') || !name || !Number.isFinite(value) || value <= 0 || !ALL_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Need a date, description, positive amount and valid category' });
  }
  const tx = {
    id: `manual-${crypto.randomUUID()}`,
    source: 'manual',
    itemId: null,
    accountId: null,
    date,
    name: String(name).slice(0, 120),
    amount: Math.round((type === 'income' ? -value : value) * 100) / 100,
    currency: process.env.CURRENCY || 'USD',
    pending: false,
    pendingId: null,
    category,
    logo: null,
    addedAt: new Date().toISOString(),
  };
  store.get().transactions.push(tx);
  store.save();
  sync.notify('manual');
  res.json({ ok: true, transaction: tx });
});

app.delete('/api/transactions/:id', (req, res) => {
  const db = store.get();
  const tx = db.transactions.find((t) => t.id === req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });
  if (tx.source !== 'manual') return res.status(400).json({ error: 'Only manually added transactions can be deleted' });
  db.transactions = db.transactions.filter((t) => t.id !== tx.id);
  delete db.overrides[tx.id];
  store.save();
  sync.notify('manual');
  res.json({ ok: true });
});

app.put('/api/transactions/:id/category', (req, res) => {
  const db = store.get();
  const tx = db.transactions.find((t) => t.id === req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });
  if (!req.body || !ALL_CATEGORIES.includes(req.body.category)) return res.status(400).json({ error: 'Unknown category' });
  if (req.body.category === tx.category) delete db.overrides[tx.id];
  else db.overrides[tx.id] = req.body.category;
  store.save();
  res.json({ ok: true });
});

app.put('/api/budgets', (req, res) => {
  const db = store.get();
  const next = { ...db.budgets };
  for (const [category, amount] of Object.entries(req.body || {})) {
    const value = Number(amount);
    if (!SPENDING_CATEGORIES.includes(category) || !Number.isFinite(value) || value < 0) {
      return res.status(400).json({ error: `Bad budget for ${category}` });
    }
    next[category] = Math.round(value * 100) / 100;
  }
  db.budgets = next;
  store.save();
  sync.notify('budgets');
  res.json({ ok: true, budgets: next });
});

// --- Start
app.listen(PORT, HOST, () => {
  console.log(`Finance Tracker running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (MODE === 'plaid') {
    console.log(`Plaid: ${plaid.ENV} · webhooks ${process.env.PLAID_WEBHOOK_URL ? 'on' : 'off'} · checking banks every ${SYNC_MINUTES} min`);
  } else {
    console.log('Demo mode: no PLAID_CLIENT_ID/PLAID_SECRET set — "Connect bank" adds a demo bank.');
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(HOST) && !process.env.APP_PASSWORD) {
    console.warn('WARNING: listening on a public interface with no APP_PASSWORD — anyone who can reach this can see your finances.');
  }
});

if (MODE === 'plaid') {
  sync.syncAll('startup');
  if (SYNC_MINUTES > 0) setInterval(() => sync.syncAll('scheduled'), SYNC_MINUTES * 60 * 1000);
} else {
  demo.startFeed(DEMO_SECONDS);
}
