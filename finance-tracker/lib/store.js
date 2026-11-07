// Tiny JSON-file database. Fine for one person's finances; everything lives in
// data/db.json (git-ignored). Writes are atomic (write temp file, then rename).
const fs = require('fs');
const path = require('path');
const { DEFAULT_BUDGETS } = require('./categories');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const FILE = path.join(DATA_DIR, 'db.json');

function defaults() {
  return {
    items: [], // linked bank connections (contain Plaid access tokens — keep private)
    accounts: [],
    transactions: [],
    budgets: { ...DEFAULT_BUDGETS },
    overrides: {}, // transactionId -> category you picked by hand
  };
}

let db = null;

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  db = defaults();
  if (fs.existsSync(FILE)) {
    Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8')));
  }
  return db;
}

function get() {
  return db || load();
}

function save() {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(get(), null, 1), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

module.exports = { get, save, load, FILE };
