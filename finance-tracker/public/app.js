// Finance Tracker dashboard. Plain JS, no build step.
(() => {
  'use strict';

  let state = null;
  let viewMonth = monthKey(new Date());
  const freshIds = new Set();

  const $ = (id) => document.getElementById(id);

  // ---------- helpers ----------
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }
  function monthKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  function todayKey() {
    const d = new Date();
    return `${monthKey(d)}-${pad(d.getDate())}`;
  }
  function parseMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }
  function shiftMonth(key, delta) {
    const d = parseMonth(key);
    d.setMonth(d.getMonth() + delta);
    return monthKey(d);
  }
  function monthName(key, opts = { month: 'long', year: 'numeric' }) {
    return parseMonth(key).toLocaleDateString(undefined, opts);
  }
  function daysInMonth(key) {
    const d = parseMonth(key);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  }
  function fmtDate(iso, opts = { month: 'short', day: 'numeric' }) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
  }

  const moneyFormats = new Map();
  function money(n, { currency, compact = false } = {}) {
    const cur = currency || (state && state.currency) || 'USD';
    const key = `${cur}|${compact}`;
    if (!moneyFormats.has(key)) {
      moneyFormats.set(
        key,
        new Intl.NumberFormat(undefined, compact
          ? { style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 1 }
          : { style: 'currency', currency: cur }),
      );
    }
    return moneyFormats.get(key).format(n);
  }

  function timeAgo(iso) {
    if (!iso) return 'never';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function toast(message, kind = '') {
    const el = h('div', { class: `toast ${kind}` }, message);
    $('toasts').append(el);
    setTimeout(() => el.remove(), 6000);
  }

  // ---------- data ----------
  async function load() {
    state = await api('GET', '/api/state');
    render();
  }

  function isSpending(cat) {
    return state.spendingCategories.includes(cat);
  }

  // throughDay: only count the first N days (for fair month-to-date comparisons).
  function summarize(key, throughDay = 31) {
    const txs = state.transactions.filter((t) => t.date.startsWith(key) && Number(t.date.slice(8, 10)) <= throughDay);
    let spent = 0;
    let income = 0;
    const byCategory = {};
    const byDay = new Array(daysInMonth(key)).fill(0);
    for (const t of txs) {
      if (isSpending(t.category)) {
        spent += t.amount; // refunds are negative and reduce spending
        byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
        byDay[Number(t.date.slice(8, 10)) - 1] += t.amount;
      } else if (t.category === 'Income') {
        income -= t.amount;
      }
    }
    return { txs, spent, income, byCategory, byDay };
  }

  // ---------- rendering ----------
  function render() {
    if (!state) return;
    $('month-label').textContent = monthName(viewMonth);
    $('next-month').disabled = viewMonth >= monthKey(new Date());
    $('demo-banner').hidden = !(state.mode === 'demo' && state.items.some((i) => i.source === 'demo'));

    const hasData = state.items.length > 0 || state.transactions.length > 0;
    $('empty-state').hidden = hasData;
    for (const id of ['kpis']) $(id).hidden = !hasData;
    document.querySelector('.grid').hidden = !hasData;
    $('tx-title').closest('.card').hidden = !hasData;

    const s = summarize(viewMonth);
    // For the month in progress, compare against last month up to the same day.
    const prev = summarize(shiftMonth(viewMonth, -1), viewMonth === monthKey(new Date()) ? new Date().getDate() : 31);
    renderKpis(s, prev);
    renderBudgets(s);
    renderChart(s);
    renderAccounts();
    renderTransactions(s.txs);
    renderLive();
  }

  function renderKpis(s, prev) {
    const totalBudget = state.spendingCategories.reduce((sum, c) => sum + (state.budgets[c] || 0), 0);
    const left = totalBudget - s.spent;
    const isCurrent = viewMonth === monthKey(new Date());
    const daysLeft = isCurrent ? daysInMonth(viewMonth) - new Date().getDate() + 1 : 0;

    let spentDelta = null;
    if (prev.spent > 0) {
      const pct = ((s.spent - prev.spent) / prev.spent) * 100;
      const up = pct >= 0;
      spentDelta = h(
        'span',
        { class: `delta ${up ? 'bad' : 'good'}` },
        `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}% vs ${isCurrent ? 'same point in ' : ''}${monthName(shiftMonth(viewMonth, -1), { month: 'short' })}`,
      );
    }

    const net = s.income - s.spent;
    $('kpis').replaceChildren(
      h('div', { class: 'kpi hero' },
        h('span', { class: 'label' }, left >= 0 ? 'Left to spend' : 'Over budget by'),
        h('span', { class: 'value' }, money(Math.abs(left))),
        h('span', { class: 'sub' }, `of ${money(totalBudget)} budget${isCurrent ? ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}`)),
      h('div', { class: 'kpi' },
        h('span', { class: 'label' }, 'Spent'),
        h('span', { class: 'value' }, money(s.spent)),
        spentDelta || h('span', { class: 'sub' }, '—')),
      h('div', { class: 'kpi' },
        h('span', { class: 'label' }, 'Income'),
        h('span', { class: 'value' }, money(s.income)),
        h('span', { class: 'sub' }, monthName(viewMonth, { month: 'long' }))),
      h('div', { class: 'kpi' },
        h('span', { class: 'label' }, net >= 0 ? 'Saved' : 'Net'),
        h('span', { class: 'value' }, money(net)),
        h('span', { class: 'sub' }, s.income > 0 ? `${Math.round((net / s.income) * 100)}% of income` : 'income minus spending')),
    );
  }

  function renderBudgets(s) {
    const rows = state.spendingCategories
      .map((c) => ({ name: c, spent: s.byCategory[c] || 0, budget: state.budgets[c] || 0 }))
      .filter((r) => r.budget > 0 || Math.abs(r.spent) > 0.005)
      .sort((a, b) => b.spent / (b.budget || Infinity) - a.spent / (a.budget || Infinity) || b.spent - a.spent);

    $('budgets').replaceChildren(
      ...rows.map((r) => {
        const pct = r.budget > 0 ? (r.spent / r.budget) * 100 : 0;
        let level = '';
        let note;
        if (r.budget <= 0) {
          level = 'none';
          note = h('div', { class: 'note' }, 'No budget set');
        } else if (pct > 100) {
          level = 'over';
          note = h('div', { class: 'note' }, h('span', { class: 'status-icon over', 'aria-hidden': 'true' }, '▲'), `Over by ${money(r.spent - r.budget)}`);
        } else if (pct >= 85) {
          level = 'warning';
          note = h('div', { class: 'note' }, h('span', { class: 'status-icon warning', 'aria-hidden': 'true' }, '●'), `${Math.round(pct)}% used · ${money(r.budget - r.spent)} left`);
        } else {
          note = h('div', { class: 'note' }, `${money(r.budget - r.spent)} left`);
        }
        return h('li', { class: 'budget-row' },
          h('div', { class: 'top' },
            h('span', { class: 'name' }, r.name),
            h('span', { class: 'amounts' }, r.budget > 0 ? `${money(r.spent)} of ${money(r.budget)}` : money(r.spent))),
          h('div', {
            class: `meter ${level}`,
            role: 'meter',
            'aria-label': `${r.name} budget used`,
            'aria-valuemin': '0',
            'aria-valuemax': String(r.budget || 0),
            'aria-valuenow': String(Math.max(0, r.spent).toFixed(2)),
          }, h('span', { style: `width:${Math.min(100, Math.max(0, pct))}%` })),
          note);
      }),
    );
    if (!rows.length) $('budgets').append(h('li', { class: 'muted small' }, 'No spending yet this month.'));
  }

  function niceMax(v) {
    if (v <= 0) return 10;
    const mag = 10 ** Math.floor(Math.log10(v));
    for (const step of [1, 2, 2.5, 5, 10]) if (step * mag >= v) return step * mag;
    return 10 * mag;
  }

  function renderChart(s) {
    const NS = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attrs = {}) => {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      return el;
    };
    const W = 560;
    const H = 180;
    const pad = { l: 44, r: 6, t: 8, b: 22 };
    const days = s.byDay.length;
    const values = s.byDay.map((v) => Math.max(0, v));
    const max = niceMax(Math.max(...values));
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    const colW = innerW / days;
    const barW = Math.max(2, colW - 2); // 2px gap between bars
    const y = (v) => pad.t + innerH - (v / max) * innerH;
    const isCurrent = viewMonth === monthKey(new Date());
    const today = new Date().getDate();

    const peak = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': `Daily spending in ${monthName(viewMonth)}. Total ${money(s.spent)}. Biggest day: ${fmtDate(`${viewMonth}-${pad2(peak + 1)}`)} with ${money(values[peak])}.`,
    });

    for (const frac of [0, 0.5, 1]) {
      const yy = y(max * frac);
      svg.append(svgEl('line', { class: frac === 0 ? 'baseline' : 'gridline', x1: pad.l, x2: W - pad.r, y1: yy, y2: yy }));
      const t = svgEl('text', { class: 'tick', x: pad.l - 6, y: yy + 4, 'text-anchor': 'end' });
      t.textContent = money(max * frac, { compact: true });
      svg.append(t);
    }

    const tooltip = $('tooltip');
    values.forEach((v, i) => {
      const day = i + 1;
      const x = pad.l + i * colW + (colW - barW) / 2;
      const g = svgEl('g', { class: 'col' });
      const hit = svgEl('rect', { class: 'hit', x: pad.l + i * colW, y: pad.t, width: colW, height: innerH });
      g.append(hit);
      if (v > 0) {
        const top = y(v);
        const height = pad.t + innerH - top;
        const r = Math.min(4, barW / 2, height);
        // Rounded data end at the top, square at the baseline.
        g.append(svgEl('path', {
          class: 'bar',
          d: `M${x},${pad.t + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${pad.t + innerH} Z`,
        }));
      }
      const label = `${fmtDate(`${viewMonth}-${pad2(day)}`, { weekday: 'short', month: 'short', day: 'numeric' })}`;
      const show = (e) => {
        g.classList.add('active');
        tooltip.replaceChildren(h('div', {}, label), h('strong', {}, isCurrent && day > today ? '—' : money(v)));
        tooltip.hidden = false;
        const rect = hit.getBoundingClientRect();
        const tw = tooltip.offsetWidth;
        tooltip.style.left = `${Math.min(window.innerWidth - tw - 8, Math.max(8, rect.left + rect.width / 2 - tw / 2))}px`;
        tooltip.style.top = `${rect.top - tooltip.offsetHeight - 6}px`;
      };
      const hide = () => {
        g.classList.remove('active');
        tooltip.hidden = true;
      };
      hit.addEventListener('mouseenter', show);
      hit.addEventListener('mouseleave', hide);
      svg.append(g);

      if (day === 1 || day % 7 === 1) {
        const t = svgEl('text', { class: 'tick', x: pad.l + i * colW + colW / 2, y: H - 6, 'text-anchor': 'middle' });
        t.textContent = String(day);
        svg.append(t);
      }
    });

    $('daily-chart').replaceChildren(svg);
  }

  function pad2(n) {
    return pad(n);
  }

  function renderAccounts() {
    const wrap = $('accounts');
    if (!state.items.length) {
      wrap.replaceChildren(h('p', { class: 'muted small' }, 'No bank linked yet.'));
      return;
    }
    wrap.replaceChildren(
      ...state.items.map((item) => {
        const accts = state.accounts.filter((a) => a.itemId === item.id);
        const actions = h('div', { class: 'bank-actions' });
        if (item.source === 'plaid') {
          actions.append(h('button', { class: 'btn small', onclick: (e) => syncNow(item, e.currentTarget) }, 'Sync now'));
        }
        actions.append(h('button', { class: 'btn small danger', onclick: () => unlink(item) }, 'Disconnect'));

        let alert = null;
        if (item.status === 'login_required') {
          alert = h('div', { class: 'bank-alert' },
            h('span', { class: 'status-icon over', 'aria-hidden': 'true' }, '▲'),
            h('span', {}, 'Your bank needs you to sign in again before new purchases can come through.'),
            h('button', { class: 'btn small primary', onclick: () => reconnect(item) }, 'Reconnect'));
        } else if (item.status === 'error') {
          alert = h('div', { class: 'bank-alert' },
            h('span', { class: 'status-icon over', 'aria-hidden': 'true' }, '▲'),
            h('span', {}, `Last sync failed: ${item.error || 'unknown error'}`));
        }

        return h('div', { class: 'bank' },
          h('div', { class: 'bank-head' },
            h('span', { class: 'bank-name' }, item.institution),
            h('span', { class: 'bank-meta' }, item.source === 'demo' ? 'demo' : `synced ${timeAgo(item.lastSync)}`),
            actions),
          alert,
          ...accts.map((a) => {
            const credit = a.type === 'credit' || a.type === 'loan';
            return h('div', { class: 'acct' },
              h('span', {}, `${a.name}${a.mask ? ` ••${a.mask}` : ''}`, h('div', { class: 'kind' }, credit ? 'Balance owed' : 'Available')),
              h('span', { class: 'bal' }, a.balanceCurrent == null && a.balanceAvailable == null
                ? '—'
                : money(credit ? a.balanceCurrent : (a.balanceAvailable ?? a.balanceCurrent), { currency: a.currency || undefined })));
          }),
          accts.length ? null : h('p', { class: 'muted small' }, 'Fetching accounts…'));
      }),
    );
  }

  function categoryOptions(selected) {
    return state.categories.map((c) => h('option', { value: c, selected: c === selected }, c));
  }

  function renderTransactions(monthTxs) {
    const filter = $('tx-filter');
    if (filter.options.length <= 1) filter.append(...categoryOptions(''));
    const q = $('tx-search').value.trim().toLowerCase();
    const cat = filter.value;
    const accounts = new Map(state.accounts.map((a) => [a.id, a]));

    const rows = monthTxs
      .filter((t) => (!cat || t.category === cat) && (!q || t.name.toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.addedAt || '').localeCompare(a.addedAt || ''));

    $('tx-body').replaceChildren(
      ...rows.map((t) => {
        const acct = accounts.get(t.accountId);
        const income = t.amount < 0;
        const select = h('select', {
          'aria-label': `Category for ${t.name}`,
          onchange: async (e) => {
            try {
              await api('PUT', `/api/transactions/${encodeURIComponent(t.id)}/category`, { category: e.target.value });
              t.category = e.target.value;
              render();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        }, ...categoryOptions(t.category));
        return h('tr', { class: freshIds.has(t.id) ? 'fresh' : '' },
          h('td', { class: 'date' }, fmtDate(t.date)),
          h('td', {},
            h('div', { class: 'desc' },
              t.logo ? h('img', { class: 'logo', src: t.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
              h('div', {},
                h('div', {}, t.name, t.pending ? h('span', { class: 'badge' }, 'pending') : null),
                h('div', { class: 'sub' }, acct ? `${acct.name}${acct.mask ? ` ••${acct.mask}` : ''}` : t.source === 'manual' ? 'Added by you' : '')))),
          h('td', {}, select),
          h('td', { class: `num ${income ? 'income' : ''}` }, `${income ? '+' : ''}${money(Math.abs(t.amount), { currency: t.currency || undefined })}`),
          h('td', { class: 'num' }, t.source === 'manual'
            ? h('button', { class: 'row-del', 'aria-label': `Delete ${t.name}`, title: 'Delete', onclick: () => deleteTx(t) }, '×')
            : null));
      }),
    );
    $('tx-empty').hidden = rows.length > 0;
    $('tx-empty').textContent = monthTxs.length ? 'No transactions match.' : 'No transactions for this month yet.';
  }

  function renderLive() {
    const plaidItems = state.items.filter((i) => i.source === 'plaid');
    const last = plaidItems.map((i) => i.lastSync).filter(Boolean).sort().pop();
    let text;
    if (!liveConnected) text = 'Reconnecting…';
    else if (state.mode === 'demo') text = 'Live · demo';
    else if (!plaidItems.length) text = 'Live';
    else text = `Live · synced ${timeAgo(last)}`;
    $('live-text').textContent = text;
    $('live-status').className = `live ${liveConnected ? 'on' : 'off'}`;
    $('live-status').title = state.mode === 'plaid'
      ? `New transactions arrive ${state.webhooks ? 'instantly via Plaid webhooks' : ''}${state.webhooks ? ' and ' : ''}by checking every ${state.syncMinutes} min.`
      : 'Demo bank feed';
  }

  // ---------- live updates ----------
  let liveConnected = false;
  function connectLive() {
    const es = new EventSource('/api/events');
    es.onopen = () => {
      liveConnected = true;
      if (state) renderLive();
    };
    es.onerror = () => {
      liveConnected = false;
      if (state) renderLive();
    };
    es.onmessage = async (msg) => {
      const ev = JSON.parse(msg.data);
      (ev.newTransactions || []).forEach((t) => freshIds.add(t.id));
      await load().catch(() => {});
      if (ev.initial && ev.newCount) {
        toast(`Imported ${ev.newCount} transactions`);
      } else if (ev.newTransactions && ev.newTransactions.length) {
        for (const t of ev.newTransactions.slice(0, 3)) {
          toast(t.amount < 0 ? `Money in: ${t.name} +${money(-t.amount)}` : `New purchase: ${t.name} ${money(t.amount)}`);
        }
        if (ev.newCount > 3) toast(`…and ${ev.newCount - 3} more`);
      }
      setTimeout(() => {
        (ev.newTransactions || []).forEach((t) => freshIds.delete(t.id));
      }, 3000);
    };
  }
  setInterval(() => state && (renderLive(), renderAccounts()), 30000);

  // ---------- bank linking ----------
  let plaidScript = null;
  function loadPlaidScript() {
    if (window.Plaid) return Promise.resolve();
    if (!plaidScript) {
      plaidScript = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        s.onload = resolve;
        s.onerror = () => {
          plaidScript = null;
          reject(new Error('Could not load Plaid Link — check your internet connection.'));
        };
        document.head.append(s);
      });
    }
    return plaidScript;
  }

  async function openLink({ itemId, onSuccess }) {
    const { mode, linkToken } = await api('POST', '/api/link/token', itemId ? { itemId } : {});
    if (mode === 'demo') {
      await api('POST', '/api/demo/link', {});
      return;
    }
    await loadPlaidScript();
    await new Promise((resolve, reject) => {
      const handler = window.Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken, metadata) => {
          try {
            await onSuccess(publicToken, metadata);
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        onExit: (err) => (err ? reject(new Error(err.display_message || err.error_message || 'Linking was cancelled')) : resolve()),
      });
      handler.open();
    });
  }

  async function connectBank(e) {
    const btn = e && e.currentTarget;
    if (btn) btn.disabled = true;
    try {
      await openLink({
        onSuccess: async (publicToken, metadata) => {
          toast('Bank linked — pulling in your transactions…');
          await api('POST', '/api/link/exchange', {
            publicToken,
            institution: metadata && metadata.institution && metadata.institution.name,
          });
        },
      });
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function reconnect(item) {
    try {
      await openLink({
        itemId: item.id,
        onSuccess: async () => {
          await api('POST', `/api/items/${encodeURIComponent(item.id)}/sync`, { reconnected: true });
          toast(`${item.institution} reconnected`);
        },
      });
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function syncNow(item, btn) {
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    try {
      await api('POST', `/api/items/${encodeURIComponent(item.id)}/sync`, {});
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sync now';
    }
  }

  async function unlink(item) {
    if (!confirm(`Disconnect ${item.institution}? Its accounts and transactions will be removed from this app.`)) return;
    try {
      await api('DELETE', `/api/items/${encodeURIComponent(item.id)}`);
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteTx(t) {
    if (!confirm(`Delete "${t.name}"?`)) return;
    try {
      await api('DELETE', `/api/transactions/${encodeURIComponent(t.id)}`);
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------- dialogs ----------
  function openTxDialog() {
    const form = $('tx-form');
    form.reset();
    $('tx-error').hidden = true;
    const isCurrent = viewMonth === monthKey(new Date());
    form.date.value = isCurrent ? todayKey() : `${viewMonth}-01`;
    $('tx-form-category').replaceChildren(...categoryOptions('Groceries'));
    $('tx-dialog').showModal();
  }

  $('tx-form').addEventListener('submit', async (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    const form = e.target;
    try {
      await api('POST', '/api/transactions', {
        type: form.type.value,
        date: form.date.value,
        name: form.name.value.trim(),
        amount: Number(form.amount.value),
        category: form.category.value,
      });
      $('tx-dialog').close();
      viewMonth = form.date.value.slice(0, 7);
      await load();
    } catch (err) {
      $('tx-error').textContent = err.message;
      $('tx-error').hidden = false;
    }
  });

  // Picking "Income" as the type pre-selects the Income category.
  $('tx-form').addEventListener('change', (e) => {
    if (e.target.name === 'type') $('tx-form-category').value = e.target.value === 'income' ? 'Income' : 'Groceries';
  });

  function openBudgetDialog() {
    $('budget-error').hidden = true;
    $('budget-inputs').replaceChildren(
      ...state.spendingCategories.map((c) =>
        h('label', {}, c, h('input', { type: 'number', name: c, min: '0', step: '1', value: String(state.budgets[c] || 0), inputmode: 'decimal' }))),
    );
    $('budget-dialog').showModal();
  }

  $('budget-form').addEventListener('submit', async (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    const budgets = {};
    for (const input of $('budget-inputs').querySelectorAll('input')) budgets[input.name] = Number(input.value || 0);
    try {
      await api('PUT', '/api/budgets', budgets);
      $('budget-dialog').close();
      await load();
    } catch (err) {
      $('budget-error').textContent = err.message;
      $('budget-error').hidden = false;
    }
  });

  // ---------- wiring ----------
  $('connect-bank').addEventListener('click', connectBank);
  $('connect-bank-empty').addEventListener('click', connectBank);
  $('add-first-tx').addEventListener('click', openTxDialog);
  $('add-tx').addEventListener('click', openTxDialog);
  $('edit-budgets').addEventListener('click', openBudgetDialog);
  $('prev-month').addEventListener('click', () => { viewMonth = shiftMonth(viewMonth, -1); render(); });
  $('next-month').addEventListener('click', () => { viewMonth = shiftMonth(viewMonth, 1); render(); });
  $('tx-search').addEventListener('input', render);
  $('tx-filter').addEventListener('change', render);
  $('simulate-purchase').addEventListener('click', () => api('POST', '/api/demo/purchase', {}).catch((err) => toast(err.message, 'error')));

  load().catch((err) => toast(err.message, 'error'));
  connectLive();
})();
