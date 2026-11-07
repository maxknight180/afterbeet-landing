// Everything that talks to Plaid (the bank-linking service).
const crypto = require('crypto');
const { PlaidClient, PlaidEnvironment } = require('plaid');

const ENV = (process.env.PLAID_ENV || 'sandbox').toLowerCase();

function isConfigured() {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

let client = null;
function plaid() {
  if (!client) {
    client = new PlaidClient({
      environment: ENV === 'production' ? PlaidEnvironment.Production : PlaidEnvironment.Sandbox,
      clientId: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      timeoutInSeconds: 60,
    });
  }
  return client;
}

function errorCode(err) {
  return err && err.body && err.body.error_code;
}

// Safe-to-log/send summary of a Plaid error (never includes keys).
function describeError(err) {
  if (err && err.body && err.body.error_message) {
    return `${err.body.error_code}: ${err.body.error_message}`;
  }
  return (err && err.message) || String(err);
}

// Link token for opening Plaid Link in the browser. Pass an accessToken to
// open "update mode" (re-login to a bank whose connection expired).
async function createLinkToken({ accessToken } = {}) {
  const req = {
    client_name: process.env.APP_NAME || 'Finance Tracker',
    language: 'en',
    country_codes: (process.env.PLAID_COUNTRY_CODES || 'US').split(',').map((c) => c.trim().toUpperCase()),
    user: { client_user_id: 'finance-tracker-owner' },
  };
  if (process.env.PLAID_WEBHOOK_URL) req.webhook = process.env.PLAID_WEBHOOK_URL;
  if (process.env.PLAID_REDIRECT_URI) req.redirect_uri = process.env.PLAID_REDIRECT_URI;
  if (accessToken) {
    req.access_token = accessToken;
  } else {
    req.products = ['transactions'];
    req.transactions = { days_requested: Number(process.env.PLAID_DAYS_REQUESTED || 180) };
  }
  const res = await plaid().link.createToken(req);
  return res.link_token;
}

async function exchangePublicToken(publicToken) {
  const res = await plaid().item.exchangePublicToken({ public_token: publicToken });
  return { accessToken: res.access_token, itemId: res.item_id };
}

async function getAccounts(accessToken) {
  const res = await plaid().accounts.get({ access_token: accessToken });
  return res.accounts;
}

async function removeItem(accessToken) {
  await plaid().item.remove({ access_token: accessToken });
}

// Pull every change since the saved cursor. If the bank's data changes while
// we're paging, Plaid asks us to restart from the original cursor.
async function syncTransactions(accessToken, startCursor) {
  for (let attempt = 0; ; attempt++) {
    const changes = { added: [], modified: [], removed: [], accounts: [], cursor: startCursor };
    try {
      let hasMore = true;
      while (hasMore) {
        const res = await plaid().transactions.sync({
          access_token: accessToken,
          cursor: changes.cursor || undefined,
          count: 500,
        });
        changes.added.push(...res.added);
        changes.modified.push(...res.modified);
        changes.removed.push(...res.removed);
        if (res.accounts && res.accounts.length) changes.accounts = res.accounts;
        changes.cursor = res.next_cursor;
        hasMore = res.has_more;
      }
      return changes;
    } catch (err) {
      if (errorCode(err) === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < 3) continue;
      throw err;
    }
  }
}

// Ask Plaid to trigger a webhook (sandbox only) — handy for testing.
async function sandboxFireSyncWebhook(accessToken) {
  await plaid().sandbox.fireItemWebhook({ access_token: accessToken, webhook_code: 'SYNC_UPDATES_AVAILABLE' });
}

// --- Webhook verification -------------------------------------------------
// Plaid signs each webhook with a JWT in the "Plaid-Verification" header.
// We check the signature (ES256), its age, and that it covers this exact body.
const keyCache = new Map();

async function verifyWebhook(rawBody, token) {
  if (!token || !rawBody) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [h, p, s] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return false;
  }
  if (header.alg !== 'ES256' || !header.kid) return false;

  let jwk = keyCache.get(header.kid);
  if (!jwk) {
    const res = await plaid().webhook.getVerificationKey({ key_id: header.kid });
    jwk = res.key;
    keyCache.set(header.kid, jwk);
  }
  if (jwk.expired_at) return false;

  const publicKey = crypto.createPublicKey({
    key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    format: 'jwk',
  });
  const signatureOk = crypto.verify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(s, 'base64url'),
  );
  if (!signatureOk) return false;

  // Reject anything older than 5 minutes (replay protection).
  if (typeof payload.iat !== 'number' || Date.now() / 1000 - payload.iat > 5 * 60) return false;

  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const claimed = String(payload.request_body_sha256 || '');
  return claimed.length === bodyHash.length && crypto.timingSafeEqual(Buffer.from(bodyHash), Buffer.from(claimed));
}

// Tests swap in a fake client.
function _setClient(fake) {
  client = fake;
}

module.exports = {
  _setClient,
  ENV,
  isConfigured,
  errorCode,
  describeError,
  createLinkToken,
  exchangePublicToken,
  getAccounts,
  removeItem,
  syncTransactions,
  sandboxFireSyncWebhook,
  verifyWebhook,
};
