// Run with: npm test
// Exercises the Plaid code paths against a fake Plaid client (no network).
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-test-'));
const store = require('../lib/store');
const plaid = require('../lib/plaid');
const sync = require('../lib/sync');

function plaidTx(id, amount, extra = {}) {
  return {
    transaction_id: id,
    account_id: 'acc-1',
    date: '2026-11-05',
    authorized_date: '2026-11-04',
    name: 'RAW NAME',
    merchant_name: 'Coffee Shop',
    amount,
    iso_currency_code: 'USD',
    pending: false,
    personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' },
    ...extra,
  };
}

const account = { account_id: 'acc-1', name: 'Checking', mask: '1234', type: 'depository', subtype: 'checking', balances: { current: 100, available: 90, iso_currency_code: 'USD' } };

function fakeClient(pages) {
  const calls = [];
  return {
    calls,
    transactions: {
      sync: async (req) => {
        calls.push(req.cursor || null);
        const next = pages.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
    accounts: { get: async () => ({ accounts: [account] }) },
  };
}

function page(cursor, { added = [], modified = [], removed = [], hasMore = false } = {}) {
  return { added, modified, removed, accounts: [account], next_cursor: cursor, has_more: hasMore };
}

test('sync: imports, maps categories, handles pending -> posted, modify and remove', async () => {
  const db = store.load();
  db.items.push({ id: 'item-1', source: 'plaid', institution: 'Test Bank', accessToken: 'secret-token', cursor: null });

  plaid._setClient(fakeClient([
    page('c1', { added: [plaidTx('p1', 4.5, { pending: true }), plaidTx('g1', 80, { personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' } }), plaidTx('pay', -2000, { personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES' } })] }),
  ]));
  await sync.syncItem('item-1');
  assert.strictEqual(store.get().transactions.length, 3);
  const byId = Object.fromEntries(store.get().transactions.map((t) => [t.id, t]));
  assert.strictEqual(byId.p1.category, 'Eating out');
  assert.strictEqual(byId.p1.name, 'Coffee Shop');
  assert.strictEqual(byId.p1.date, '2026-11-04'); // purchase date, not post date
  assert.strictEqual(byId.g1.category, 'Groceries');
  assert.strictEqual(byId.pay.category, 'Income');
  assert.strictEqual(store.get().items[0].cursor, 'c1');
  assert.strictEqual(store.get().accounts[0].balanceCurrent, 100);

  // You recategorise the pending charge; then it posts under a new id.
  store.get().overrides.p1 = 'Entertainment';
  const seen = [];
  const listener = (e) => seen.push(e);
  sync.events.on('update', listener);
  const client = fakeClient([
    page('c2', {
      added: [plaidTx('p1-posted', 4.75, { pending_transaction_id: 'p1' }), plaidTx('new1', 12)],
      modified: [plaidTx('g1', 82)],
      removed: [{ transaction_id: 'p1' }],
    }),
  ]);
  plaid._setClient(client);
  const fresh = await sync.syncItem('item-1', 'webhook');
  sync.events.off('update', listener);

  assert.deepStrictEqual(client.calls, ['c1']); // continued from the saved cursor
  assert.deepStrictEqual(fresh.map((t) => t.id), ['new1']); // posting a pending charge isn't a "new purchase"
  const ids = store.get().transactions.map((t) => t.id).sort();
  assert.deepStrictEqual(ids, ['g1', 'new1', 'p1-posted', 'pay']);
  assert.strictEqual(store.get().overrides['p1-posted'], 'Entertainment'); // your category carried over
  assert.strictEqual(store.get().transactions.find((t) => t.id === 'g1').amount, 82);
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].newTransactions[0].id, 'new1');
});

test('sync: restarts pagination from the original cursor when Plaid data changes mid-sync', async () => {
  store.get().items[0].cursor = 'c2';
  const mutation = Object.assign(new Error('mutation'), { body: { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' } });
  const client = fakeClient([
    page('c3', { added: [plaidTx('half', 1)], hasMore: true }),
    mutation,
    page('c3b', { added: [plaidTx('a', 1)], hasMore: true }),
    page('c4', { added: [plaidTx('b', 2)] }),
  ]);
  plaid._setClient(client);
  await sync.syncItem('item-1');
  assert.deepStrictEqual(client.calls, ['c2', 'c3', 'c2', 'c3b']);
  const ids = store.get().transactions.map((t) => t.id);
  assert.ok(ids.includes('a') && ids.includes('b') && !ids.includes('half'));
  assert.strictEqual(store.get().items[0].cursor, 'c4');
});

test('sync: expired bank login is flagged, not thrown', async () => {
  plaid._setClient(fakeClient([Object.assign(new Error('login'), { body: { error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'the login details of this item have changed' } })]));
  await sync.syncItem('item-1');
  assert.strictEqual(store.get().items[0].status, 'login_required');
});

test('webhook verification: accepts a correctly signed body, rejects tampering and old tokens', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'ES256', kid: 'k1', expired_at: null };
  let keyFetches = 0;
  plaid._setClient({ webhook: { getVerificationKey: async () => (keyFetches++, { key: jwk }) } });

  const sign = (body, iat = Math.floor(Date.now() / 1000)) => {
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'k1', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iat, request_body_sha256: crypto.createHash('sha256').update(body).digest('hex') })).toString('base64url');
    const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${header}.${payload}.${sig}`;
  };

  const body = Buffer.from('{"webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE","item_id":"item-1"}');
  assert.strictEqual(await plaid.verifyWebhook(body, sign(body)), true);
  assert.strictEqual(await plaid.verifyWebhook(Buffer.from(`${body} `), sign(body)), false); // body changed
  assert.strictEqual(await plaid.verifyWebhook(body, sign(body, Math.floor(Date.now() / 1000) - 600)), false); // too old
  assert.strictEqual(await plaid.verifyWebhook(body, undefined), false);
  assert.strictEqual(await plaid.verifyWebhook(body, 'not.a.jwt'), false);
  const forged = sign(body).split('.');
  forged[2] = Buffer.alloc(64, 1).toString('base64url');
  assert.strictEqual(await plaid.verifyWebhook(body, forged.join('.')), false);
  assert.strictEqual(keyFetches, 1); // key cached
});
