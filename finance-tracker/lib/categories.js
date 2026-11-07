// Budget categories and how Plaid's "personal finance category" maps onto them.
// Edit SPENDING_CATEGORIES / DEFAULT_BUDGETS to match your own planner.

const SPENDING_CATEGORIES = [
  'Groceries',
  'Eating out',
  'Shopping',
  'Transport',
  'Bills & utilities',
  'Housing',
  'Entertainment',
  'Health',
  'Personal care',
  'Travel',
  'Services',
  'Debt payments',
  'Other',
];

// Not counted as spending.
const NON_SPENDING_CATEGORIES = ['Income', 'Transfers'];

const ALL_CATEGORIES = [...SPENDING_CATEGORIES, ...NON_SPENDING_CATEGORIES];

// Monthly budget defaults (edit in the app; 0 = no budget set).
const DEFAULT_BUDGETS = {
  Groceries: 400,
  'Eating out': 200,
  Shopping: 200,
  Transport: 150,
  'Bills & utilities': 250,
  Housing: 1500,
  Entertainment: 100,
  Health: 100,
  'Personal care': 50,
  Travel: 100,
  Services: 50,
  'Debt payments': 0,
  Other: 100,
};

// Most specific match wins: detailed category first, then primary.
const DETAILED_MAP = {
  FOOD_AND_DRINK_GROCERIES: 'Groceries',
  RENT_AND_UTILITIES_RENT: 'Housing',
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: 'Transfers',
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: 'Housing',
};

const PRIMARY_MAP = {
  INCOME: 'Income',
  TRANSFER_IN: 'Transfers',
  TRANSFER_OUT: 'Transfers',
  LOAN_PAYMENTS: 'Debt payments',
  BANK_FEES: 'Other',
  ENTERTAINMENT: 'Entertainment',
  FOOD_AND_DRINK: 'Eating out',
  GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Housing',
  MEDICAL: 'Health',
  PERSONAL_CARE: 'Personal care',
  GENERAL_SERVICES: 'Services',
  GOVERNMENT_AND_NON_PROFIT: 'Other',
  TRANSPORTATION: 'Transport',
  TRAVEL: 'Travel',
  RENT_AND_UTILITIES: 'Bills & utilities',
};

function mapPlaidCategory(pfc, amount) {
  if (pfc) {
    if (DETAILED_MAP[pfc.detailed]) return DETAILED_MAP[pfc.detailed];
    if (PRIMARY_MAP[pfc.primary]) return PRIMARY_MAP[pfc.primary];
  }
  // Money coming in with no category is most likely income.
  return amount < 0 ? 'Income' : 'Other';
}

module.exports = {
  SPENDING_CATEGORIES,
  NON_SPENDING_CATEGORIES,
  ALL_CATEGORIES,
  DEFAULT_BUDGETS,
  mapPlaidCategory,
};
