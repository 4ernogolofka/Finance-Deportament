const S = window.Shared;
const IS_WEB = window.api.platform === 'web'; // веб-версия (телефон) или приложение на компьютере
// window.api предоставляет preload.js (глобальное имя api уже объявлено мостом Electron).

let state = S.defaults();
let view = 'overview';
const now0 = new Date();
const cur = { incomeMonth: S.monthKey(now0), expenseMonth: S.monthKey(now0), taskWeek: S.weekKey(now0), eventMonth: S.monthKey(now0), eventDay: S.ymd(now0) };

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = S.fmtMoney;
const COLORS = ['#34c98a', '#d9b56c', '#e8e6df', '#6fb6d9', '#d97a86', '#a99bd6', '#b9cf7a', '#8f9aa3'];

const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5.5 12.5l4.5 4.5 8.5-9.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15zM10 20h4"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0114-5l2 2M20 12a8 8 0 01-14 5l-2-2M20 4v5h-5M4 20v-5h5"/></svg>',
};

/* ---------- даты ---------- */
const monthLabel = (mk) => { const [y, m] = mk.split('-').map(Number); return `${S.MONTHS[m - 1]} ${y}`; };
const shiftMonth = (mk, d) => { const [y, m] = mk.split('-').map(Number); return S.monthKey(new Date(y, m - 1 + d, 1)); };
const shiftWeek = (wk, d) => { const x = S.parseYmd(wk); x.setDate(x.getDate() + 7 * d); return S.ymd(x); };
const weekLabel = (wk) => {
  const a = S.parseYmd(wk), b = S.parseYmd(wk); b.setDate(b.getDate() + 6);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} ${S.MONTHS_GEN[b.getMonth()]}`
    : `${a.getDate()} ${S.MONTHS_GEN[a.getMonth()]} – ${b.getDate()} ${S.MONTHS_GEN[b.getMonth()]}`;
};
const dayLabel = (s) => { const d = S.parseYmd(s); return `${d.getDate()} ${S.MONTHS_GEN[d.getMonth()]}`; };
const defaultDate = (mk) => (mk === S.monthKey(new Date()) ? S.ymd(new Date()) : mk + '-01');

/* ---------- состояние ---------- */
let undoSnapshot = null;
function commit(undoText) {
  api.setState(state);
  render(false);
  if (undoText) toast(undoText, true);
}
function snapshot() { undoSnapshot = JSON.stringify(state); }
const sphereById = (id) => state.spheres.find((s) => s.id === id) || { name: 'Без сферы', color: '#6b6b78' };

/* ---------- плавный счёт чисел ---------- */
const prevNums = {};
function animateNums() {
  document.querySelectorAll('[data-num]').forEach((el) => {
    const key = el.dataset.key, to = Number(el.dataset.num), from = prevNums[key] ?? 0;
    prevNums[key] = to;
    if (from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 800;
    (function step(t) {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1 && el.isConnected) requestAnimationFrame(step);
    })(t0);
  });
}
const num = (key, v) => `<span class="num" data-key="${key}" data-num="${v}">${fmt(prevNums[key] ?? v)}</span>`;

/* ---------- общие блоки ---------- */
function ring(done, total) {
  const C = 2 * Math.PI * 26, p = total ? done / total : 0;
  return `<div class="ring"><svg viewBox="0 0 64 64"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34c98a"/><stop offset="1" stop-color="#34c98a"/></linearGradient></defs>
    <circle class="bg" cx="32" cy="32" r="26"/><circle class="fg" cx="32" cy="32" r="26" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}"/></svg><span>${Math.round(p * 100)}%</span></div>`;
}
const switcher = (act, label) => `<div class="switcher">
  <button class="icon-btn" data-act="${act}" data-d="-1" aria-label="Назад">${ICON.left}</button><span>${label}</span>
  <button class="icon-btn" data-act="${act}" data-d="1" aria-label="Вперёд">${ICON.right}</button></div>`;
const meter = (name, color, value, max, extra = '') => `<div class="meter" style="--c:${color}">
  <div class="top"><div class="name"><i class="dot"></i><b>${esc(name)}</b>${extra}</div><span class="num">${fmt(value)}</span></div>
  <div class="track"><i style="width:${max ? Math.max(2, (value / max) * 100) : 0}%"></i></div></div>`;
const empty = (title, text) => `<div class="empty"><b>${title}</b>${text}</div>`;

function taskRow(t, wk) {
  const done = S.isDone(t, wk);
  const meta = [];
  if (t.day != null) meta.push(`<span class="badge">${S.DAYS[t.day]}</span>`);
  if (t.day != null && t.time) meta.push(`<span class="badge accent">${ICON.bell}${t.time}</span>`);
  meta.push(t.repeat ? `<span class="badge">${ICON.repeat}каждую неделю</span>` : '<span class="badge">разовая</span>');
  return `<div class="task ${done ? 'done' : ''}">
    <button class="check ${done ? 'on' : ''}" data-act="task-toggle" data-id="${t.id}" data-wk="${wk}" aria-label="Отметить">${ICON.check}</button>
    <div class="main" data-act="task-edit" data-id="${t.id}"><b>${esc(t.title)}</b><div class="meta">${meta.join('')}</div></div>
    <button class="icon-btn del" data-act="task-del" data-id="${t.id}" aria-label="Удалить">${ICON.x}</button></div>`;
}

/* ---------- разделы ---------- */
function viewOverview() {
  const d = new Date(), mk = S.monthKey(d), wk = S.weekKey(d);
  const inc = S.sumMonth(state.incomes, mk), exp = S.sumMonth(state.expenses, mk);
  const months = [...Array(6)].map((_, i) => shiftMonth(mk, i - 5));
  const data = months.map((m) => ({ m, i: S.sumMonth(state.incomes, m), e: S.sumMonth(state.expenses, m) }));
  const max = Math.max(1, ...data.map((x) => Math.max(x.i, x.e)));
  const tasks = S.sortTasks(S.tasksForWeek(state, wk), wk);
  const done = tasks.filter((t) => S.isDone(t, wk)).length;
  const bySphere = state.spheres.map((s) => ({ s, v: state.incomes.reduce((a, x) => (x.sphereId === s.id && x.date.startsWith(mk) ? a + x.amount : a), 0) }))
    .filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const smax = Math.max(1, ...bySphere.map((x) => x.v));

  return `<header class="head"><div><p class="eyebrow">Обзор</p><h1>${monthLabel(mk)}</h1></div></header>
  <section class="stats">
    <div class="card stat" style="--c:var(--good)"><div class="label"><i></i>Доходы за месяц</div><div class="value">${num('ov-inc', inc)}</div><div class="sub">по всем сферам</div></div>
    <div class="card stat" style="--c:var(--bad)"><div class="label"><i></i>Расходы за месяц</div><div class="value">${num('ov-exp', exp)}</div><div class="sub">по каталогу расходов</div></div>
    <div class="card stat" style="--c:var(--accent)"><div class="label"><i></i>Остаток</div><div class="value">${num('ov-bal', inc - exp)}</div><div class="sub">доходы минус расходы</div></div>
  </section>
  <section class="grid2">
    <div class="card"><div class="card-head"><h3>Последние 6 месяцев</h3>
      <div class="legend"><span><i style="background:#34c98a"></i>Доходы</span><span><i style="background:rgba(255,255,255,.28)"></i>Расходы</span></div></div>
      <div class="chart">${data.map((x, i) => `<div class="col ${x.m === mk ? 'now' : ''}" title="${monthLabel(x.m)}: доходы ${fmt(x.i)}, расходы ${fmt(x.e)}">
        <div class="bars"><i class="bar in" style="height:${(x.i / max) * 100}%;animation-delay:${i * 60}ms"></i><i class="bar out" style="height:${(x.e / max) * 100}%;animation-delay:${i * 60 + 40}ms"></i></div>
        <span>${S.MONTHS_SHORT[Number(x.m.slice(5)) - 1]}</span></div>`).join('')}</div>
    </div>
    <div class="card"><div class="card-head"><h3>Задачи недели</h3><button class="btn ghost" data-act="nav" data-view="tasks">Все задачи</button></div>
      ${tasks.length ? `<div class="week-mini">${ring(done, tasks.length)}<div><b>${done} из ${tasks.length} выполнено</b><div class="muted">${weekLabel(wk)}</div></div></div>
        <div class="list">${tasks.slice(0, 4).map((t) => taskRow(t, wk)).join('')}</div>`
      : empty('Задач пока нет', 'Добавьте обязательные задачи на неделю в разделе «Задачи».')}
    </div>
  </section>
  <section class="card"><div class="card-head"><h3>Ближайшие события</h3><button class="btn ghost" data-act="nav" data-view="events">Календарь</button></div>
    ${S.upcomingEvents(state, S.ymd(d), 4).length ? `<div class="list">${S.upcomingEvents(state, S.ymd(d), 4).map((e) => eventRow(e, true)).join('')}</div>`
    : empty('Событий впереди нет', 'Запишите в календарь, что и когда должно произойти.')}
  </section>
  <section class="card"><div class="card-head"><h3>Сферы дохода в этом месяце</h3><button class="btn ghost" data-act="nav" data-view="income">Подробнее</button></div>
    ${bySphere.length ? `<div class="rows">${bySphere.map((x) => meter(x.s.name, x.s.color, x.v, smax, `<span class="muted">${Math.round((x.v / inc) * 100)}%</span>`)).join('')}</div>`
    : empty('Доходов за этот месяц нет', 'Создайте сферы дохода и добавьте первую запись в разделе «Доходы».')}
  </section>`;
}

function viewIncome() {
  const mk = cur.incomeMonth;
  const items = state.incomes.filter((x) => x.date.startsWith(mk)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = items.reduce((a, x) => a + x.amount, 0);
  const sums = {};
  items.forEach((x) => { sums[x.sphereId] = (sums[x.sphereId] || 0) + x.amount; });
  return `<header class="head"><div><p class="eyebrow">Доходы</p><h1>${num('inc-total', total)}</h1></div>
    <div class="head-actions">${switcher('inc-month', monthLabel(mk))}<button class="btn primary" data-act="income-new">${ICON.plus}Доход</button></div></header>
  <section class="card"><h3>Сферы дохода</h3>
    <div class="chips">${state.spheres.map((s) => `<button class="chip" style="--c:${s.color}" data-act="sphere-edit" data-id="${s.id}"><i class="dot"></i><span><b>${esc(s.name)}</b><small class="num">${fmt(sums[s.id] || 0)}</small></span></button>`).join('')}
      <button class="chip add" data-act="sphere-new">${ICON.plus}Новая сфера</button></div>
  </section>
  <section class="card"><h3>Записи за ${monthLabel(mk).toLowerCase()}</h3>
    ${items.length ? `<div class="list">${items.map((x) => { const s = sphereById(x.sphereId); return `<div class="row" data-act="income-edit" data-id="${x.id}" style="--c:${s.color}">
      <i class="dot"></i><div class="main"><b>${esc(s.name)}</b><small>${dayLabel(x.date)}${x.note ? ' · ' + esc(x.note) : ''}</small></div>
      <span class="amount plus num">+${fmt(x.amount)}</span><button class="icon-btn del" data-act="income-del" data-id="${x.id}" aria-label="Удалить">${ICON.x}</button></div>`; }).join('')}</div>`
    : empty('Записей нет', state.spheres.length ? 'Нажмите «Доход», чтобы добавить поступление.' : 'Сначала создайте сферу дохода со своим названием.')}
  </section>`;
}

function viewExpenses() {
  const mk = cur.expenseMonth, year = mk.slice(0, 4);
  const tiles = [...Array(12)].map((_, i) => { const k = `${year}-${S.pad(i + 1)}`; return { k, sum: S.sumMonth(state.expenses, k) }; });
  const max = Math.max(1, ...tiles.map((t) => t.sum));
  const yearTotal = tiles.reduce((a, t) => a + t.sum, 0);
  const items = state.expenses.filter((x) => x.date.startsWith(mk)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = items.reduce((a, x) => a + x.amount, 0);
  const groups = {};
  items.forEach((x) => { const c = x.category || 'Без категории'; (groups[c] = groups[c] || []).push(x); });
  const cats = Object.entries(groups).map(([c, list]) => ({ c, list, sum: list.reduce((a, x) => a + x.amount, 0) })).sort((a, b) => b.sum - a.sum);

  return `<header class="head"><div><p class="eyebrow">Расходы за ${year} год</p><h1>${num('exp-year', yearTotal)}</h1></div>
    <div class="head-actions">${switcher('exp-year', year)}<button class="btn primary" data-act="expense-new">${ICON.plus}Расход</button></div></header>
  <section class="months">${tiles.map((t) => `<button class="month ${t.k === mk ? 'on' : ''} ${t.sum ? '' : 'zero'}" data-act="exp-month" data-k="${t.k}">
    <div class="m">${S.MONTHS[Number(t.k.slice(5)) - 1]}</div><div class="s num">${t.sum ? fmt(t.sum) : '—'}</div><div class="track"><i style="width:${(t.sum / max) * 100}%"></i></div></button>`).join('')}</section>
  <section class="card"><div class="card-head"><h3>${monthLabel(mk)}</h3><b class="num">${fmt(total)}</b></div>
    ${cats.length ? `<div class="list">${cats.map((g) => `<div class="group-title"><span>${esc(g.c)}</span><span class="num">${fmt(g.sum)}</span></div>
      ${g.list.map((x) => `<div class="row" data-act="expense-edit" data-id="${x.id}"><div class="main"><b>${esc(x.title)}</b><small>${dayLabel(x.date)}</small></div>
        <span class="amount num">−${fmt(x.amount)}</span><button class="icon-btn del" data-act="expense-del" data-id="${x.id}" aria-label="Удалить">${ICON.x}</button></div>`).join('')}`).join('')}</div>`
    : empty('В этом месяце расходов нет', 'Нажмите «Расход», чтобы добавить запись в каталог.')}
  </section>`;
}

function viewTasks() {
  const wk = cur.taskWeek, isNow = wk === S.weekKey(new Date());
  const tasks = S.sortTasks(S.tasksForWeek(state, wk), wk);
  const done = tasks.filter((t) => S.isDone(t, wk)).length;
  return `<header class="head"><div><p class="eyebrow">Задачи на неделю ${isNow ? '· текущая' : ''}</p><h1>${weekLabel(wk)}</h1></div>
    <div class="head-actions">${isNow ? '' : '<button class="btn ghost" data-act="task-week-now">К текущей</button>'}${switcher('task-week', isNow ? 'Эта неделя' : 'Неделя с ' + dayLabel(wk))}
      <button class="btn primary" data-act="task-new">${ICON.plus}Задача</button></div></header>
  <section class="card progress-card">${ring(done, tasks.length)}
    <div class="grow"><div class="big num">${done}<small> / ${tasks.length}</small></div>
      <div class="track"><i style="width:${tasks.length ? (done / tasks.length) * 100 : 0}%"></i></div></div></section>
  <section class="card"><h3>Обязательные задачи</h3>
    ${tasks.length ? `<div class="list">${tasks.map((t) => taskRow(t, wk)).join('')}</div>`
    : empty('На эту неделю задач нет', 'Добавьте задачу, выберите день и время — в этот момент придёт уведомление.')}
  </section>`;
}

const eventRow = (e, withDate) => `<div class="row" data-act="event-edit" data-id="${e.id}">
  <span class="${withDate ? 'ev-date' : 'ev-time'}">${withDate ? dayLabel(e.date) : e.time || 'весь день'}</span>
  <div class="main"><b>${esc(e.title)}</b>${e.note ? `<small>${esc(e.note)}</small>` : ''}</div>
  ${e.time ? `<span class="badge accent">${ICON.bell}${e.time}</span>` : ''}
  <button class="icon-btn del" data-act="event-del" data-id="${e.id}" aria-label="Удалить">${ICON.x}</button></div>`;

function viewEvents() {
  const mk = cur.eventMonth, [y, m] = mk.split('-').map(Number);
  const today = S.ymd(new Date());
  const first = new Date(y, m - 1, 1);
  const offset = S.dow(first), days = new Date(y, m, 0).getDate();
  const cells = Math.ceil((offset + days) / 7) * 7;
  const byDay = {};
  state.events.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
  const sortDay = (list) => list.slice().sort((a, b) => ((a.time || '') < (b.time || '') ? -1 : 1));

  let grid = S.DAYS.map((d) => `<div class="wd">${d}</div>`).join('');
  for (let i = 0; i < cells; i++) {
    const d = new Date(y, m - 1, 1 - offset + i), k = S.ymd(d);
    const list = sortDay(byDay[k] || []);
    grid += `<button class="day ${d.getMonth() !== m - 1 ? 'other' : ''} ${k === today ? 'today' : ''} ${k === cur.eventDay ? 'sel' : ''}" data-act="event-day" data-k="${k}" title="Двойной щелчок — добавить событие">
      <span class="n">${d.getDate()}</span>${list.length ? `<span class="ev">${esc(list[0].title)}</span><span class="pips">${list.slice(0, 4).map(() => '<i></i>').join('')}</span>` : ''}</button>`;
  }

  const sel = S.parseYmd(cur.eventDay);
  const dayList = sortDay(byDay[cur.eventDay] || []);
  const upcoming = S.upcomingEvents(state, today, 6);
  const monthCount = state.events.filter((e) => e.date.startsWith(mk)).length;

  return `<header class="head"><div><p class="eyebrow">События · ${monthCount ? 'в этом месяце: ' + monthCount : 'в этом месяце пусто'}</p><h1>${monthLabel(mk)}</h1></div>
    <div class="head-actions">${mk === S.monthKey(new Date()) && cur.eventDay === today ? '' : '<button class="btn ghost" data-act="event-today">Сегодня</button>'}${switcher('event-month', monthLabel(mk))}
      <button class="btn primary" data-act="event-new">${ICON.plus}Событие</button></div></header>
  <section class="grid2">
    <div class="card"><div class="cal">${grid}</div></div>
    <div class="card"><div class="card-head"><h3>${sel.getDate()} ${S.MONTHS_GEN[sel.getMonth()]}, ${S.DAYS_FULL[S.dow(sel)].toLowerCase()}${cur.eventDay === today ? ' · сегодня' : ''}</h3></div>
      ${dayList.length ? `<div class="list">${dayList.map((e) => eventRow(e, false)).join('')}</div>` : empty('На этот день ничего не записано', 'Нажмите «Событие» или дважды щёлкните по дню в календаре.')}
      <div class="sub-title">Ближайшие</div>
      ${upcoming.length ? `<div class="list">${upcoming.map((e) => eventRow(e, true)).join('')}</div>` : '<div class="muted">Предстоящих событий нет.</div>'}
    </div>
  </section>`;
}

const VIEWS = { overview: viewOverview, income: viewIncome, expenses: viewExpenses, events: viewEvents, tasks: viewTasks };

function render(animate) {
  const el = $('#view');
  const top = el.scrollTop;
  el.innerHTML = VIEWS[view]();
  el.classList.remove('enter');
  if (animate) { void el.offsetWidth; el.classList.add('enter'); el.scrollTop = 0; } else el.scrollTop = top;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  animateNums();
}

/* ---------- модальные окна ---------- */
const modal = $('#modal');
let modalSubmit = null, modalDelete = null;
function openModal(html, onSubmit, onDelete) {
  modalSubmit = onSubmit; modalDelete = onDelete;
  modal.classList.remove('out');
  modal.innerHTML = `<form class="sheet" novalidate>${html}</form>`;
  modal.hidden = false;
  const first = modal.querySelector('input[type=text], select');
  if (first) setTimeout(() => first.focus(), 60);
}
function closeModal() {
  if (modal.hidden) return;
  modal.classList.add('out');
  setTimeout(() => { modal.hidden = true; modal.innerHTML = ''; modal.classList.remove('out'); }, 280);
}
const actionsRow = (isEdit, label = 'Сохранить') => `<div class="err" id="err"></div><div class="sheet-actions">
  ${isEdit ? '<button type="button" class="btn ghost danger" data-act="modal-del">Удалить</button>' : ''}<span class="spacer"></span>
  <button type="button" class="btn ghost" data-act="modal-close">Отмена</button><button type="submit" class="btn primary">${label}</button></div>`;
const fail = (msg) => { const e = $('#err'); if (e) e.textContent = msg; return false; };
const parseAmount = (v) => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };

modal.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!modalSubmit) return;
  const f = Object.fromEntries(new FormData(e.target).entries());
  if (modalSubmit(f) !== false) closeModal();
});
modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function sphereModal(id, then) {
  const s = state.spheres.find((x) => x.id === id);
  const color = s ? s.color : COLORS[state.spheres.length % COLORS.length];
  openModal(`<h2>${s ? 'Сфера дохода' : 'Новая сфера дохода'}</h2>
    <label class="field"><span>Название</span><input type="text" name="name" maxlength="40" placeholder="Например, Фриланс" value="${esc(s ? s.name : '')}"></label>
    <div class="field"><span>Цвет</span><div class="swatches">${COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><i style="--c:${c}"></i></label>`).join('')}</div></div>
    ${actionsRow(!!s)}`,
  (f) => {
    const name = (f.name || '').trim();
    if (!name) return fail('Введите название сферы.');
    if (s) { s.name = name; s.color = f.color || color; } else state.spheres.push({ id: uid(), name, color: f.color || color });
    commit();
    if (then) setTimeout(then, 320);
  },
  s && (() => {
    snapshot();
    const n = state.incomes.filter((x) => x.sphereId === s.id).length;
    state.spheres = state.spheres.filter((x) => x.id !== s.id);
    state.incomes = state.incomes.filter((x) => x.sphereId !== s.id);
    commit(n ? `Сфера и её записи (${n}) удалены` : 'Сфера удалена');
  }));
}

function incomeModal(id) {
  if (!state.spheres.length) { toast('Сначала создайте сферу дохода'); return sphereModal(null, () => incomeModal()); }
  const x = state.incomes.find((i) => i.id === id);
  openModal(`<h2>${x ? 'Запись о доходе' : 'Новый доход'}</h2>
    <label class="field"><span>Сфера</span><select name="sphereId">${state.spheres.map((s) => `<option value="${s.id}" ${x && x.sphereId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <div class="two"><label class="field"><span>Сумма, ₽</span><input type="text" name="amount" inputmode="decimal" placeholder="0" value="${x ? String(x.amount).replace('.', ',') : ''}"></label>
    <label class="field"><span>Дата</span><input type="date" name="date" value="${x ? x.date : defaultDate(cur.incomeMonth)}"></label></div>
    <label class="field"><span>Комментарий</span><input type="text" name="note" maxlength="80" placeholder="Необязательно" value="${esc(x ? x.note : '')}"></label>
    ${actionsRow(!!x)}`,
  (f) => {
    const amount = parseAmount(f.amount);
    if (!amount) return fail('Введите сумму больше нуля.');
    if (!f.date) return fail('Выберите дату.');
    const rec = { sphereId: f.sphereId, amount, date: f.date, note: (f.note || '').trim() };
    if (x) Object.assign(x, rec); else state.incomes.push({ id: uid(), ...rec });
    cur.incomeMonth = f.date.slice(0, 7);
    commit();
  },
  x && (() => { snapshot(); state.incomes = state.incomes.filter((i) => i.id !== x.id); commit('Запись удалена'); }));
}

function expenseModal(id) {
  const x = state.expenses.find((i) => i.id === id);
  const cats = [...new Set(state.expenses.map((e) => e.category).filter(Boolean))];
  openModal(`<h2>${x ? 'Запись о расходе' : 'Новый расход'}</h2>
    <label class="field"><span>Название</span><input type="text" name="title" maxlength="60" placeholder="Например, Продукты" value="${esc(x ? x.title : '')}"></label>
    <label class="field"><span>Категория</span><input type="text" name="category" maxlength="40" list="cats" placeholder="Необязательно" value="${esc(x ? x.category : '')}">
      <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
    <div class="two"><label class="field"><span>Сумма, ₽</span><input type="text" name="amount" inputmode="decimal" placeholder="0" value="${x ? String(x.amount).replace('.', ',') : ''}"></label>
    <label class="field"><span>Дата</span><input type="date" name="date" value="${x ? x.date : defaultDate(cur.expenseMonth)}"></label></div>
    ${actionsRow(!!x)}`,
  (f) => {
    const title = (f.title || '').trim(), amount = parseAmount(f.amount);
    if (!title) return fail('Введите название расхода.');
    if (!amount) return fail('Введите сумму больше нуля.');
    if (!f.date) return fail('Выберите дату.');
    const rec = { title, category: (f.category || '').trim(), amount, date: f.date };
    if (x) Object.assign(x, rec); else state.expenses.push({ id: uid(), ...rec });
    cur.expenseMonth = f.date.slice(0, 7);
    commit();
  },
  x && (() => { snapshot(); state.expenses = state.expenses.filter((i) => i.id !== x.id); commit('Запись удалена'); }));
}

function taskModal(id) {
  const t = state.tasks.find((i) => i.id === id);
  const day = t ? t.day : null;
  openModal(`<h2>${t ? 'Задача' : 'Новая задача'}</h2>
    <label class="field"><span>Что нужно сделать</span><input type="text" name="title" maxlength="90" placeholder="Например, Отправить отчёт" value="${esc(t ? t.title : '')}"></label>
    <label class="field"><span>Повтор</span><select name="repeat"><option value="1" ${!t || t.repeat ? 'selected' : ''}>Каждую неделю</option><option value="0" ${t && !t.repeat ? 'selected' : ''}>Только на эту неделю</option></select></label>
    <div class="two"><label class="field"><span>День</span><select name="day" id="taskDay"><option value="">Любой день</option>${S.DAYS_FULL.map((d, i) => `<option value="${i}" ${day === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
    <label class="field"><span>Напомнить в</span><input type="time" name="time" id="taskTime" value="${t && t.time ? t.time : ''}" ${day == null ? 'disabled' : ''}></label></div>
    <div class="field"><div class="hint">Уведомление придёт в выбранный день и время, если задача ещё не отмечена. Для напоминания нужно выбрать день.</div></div>
    ${actionsRow(!!t)}`,
  (f) => {
    const title = (f.title || '').trim();
    if (!title) return fail('Введите название задачи.');
    const d = f.day === '' || f.day == null ? null : Number(f.day);
    const rec = { title, repeat: f.repeat === '1', day: d, time: d != null && f.time ? f.time : null };
    if (t) Object.assign(t, rec); else state.tasks.push({ id: uid(), week: cur.taskWeek, done: {}, ...rec });
    commit();
  },
  t && (() => { snapshot(); state.tasks = state.tasks.filter((i) => i.id !== t.id); commit('Задача удалена'); }));
}

function eventModal(id) {
  const e = state.events.find((i) => i.id === id);
  openModal(`<h2>${e ? 'Событие' : 'Новое событие'}</h2>
    <label class="field"><span>Что произойдёт</span><input type="text" name="title" maxlength="90" placeholder="Например, Встреча с клиентом" value="${esc(e ? e.title : '')}"></label>
    <div class="two"><label class="field"><span>Дата</span><input type="date" name="date" value="${e ? e.date : cur.eventDay}"></label>
    <label class="field"><span>Время</span><input type="time" name="time" value="${e && e.time ? e.time : ''}"></label></div>
    <label class="field"><span>Комментарий</span><input type="text" name="note" maxlength="120" placeholder="Необязательно" value="${esc(e ? e.note : '')}">
      <div class="hint">Время указывать необязательно. Если оно задано, в этот момент придёт уведомление.</div></label>
    ${actionsRow(!!e)}`,
  (f) => {
    const title = (f.title || '').trim();
    if (!title) return fail('Введите название события.');
    if (!f.date) return fail('Выберите дату.');
    // Если указанное время уже прошло, уведомление не нужно (иначе оно пришло бы сразу после сохранения).
    const n = new Date(), nowHm = `${S.pad(n.getHours())}:${S.pad(n.getMinutes())}`;
    const muted = !!f.time && (f.date < S.ymd(n) || (f.date === S.ymd(n) && f.time <= nowHm));
    const rec = { title, date: f.date, time: f.time || null, note: (f.note || '').trim(), muted };
    if (e) Object.assign(e, rec); else state.events.push({ id: uid(), ...rec });
    cur.eventDay = f.date;
    cur.eventMonth = f.date.slice(0, 7);
    commit();
  },
  e && (() => { snapshot(); state.events = state.events.filter((i) => i.id !== e.id); commit('Событие удалено'); }));
}

function settingsModal() {
  const st = state.settings;
  const row = (key, title, sub) => `<div class="toggle-row"><div>${title}<small>${sub}</small></div>
    <label class="switch"><input type="checkbox" data-setting="${key}" ${st[key] ? 'checked' : ''}><i></i></label></div>`;
  openModal(`<h2>Настройки</h2>
    ${IS_WEB ? '' : `${row('widget', 'Показывать виджет', 'Доход и расходы месяца, задачи недели, ближайшее событие')}
    ${row('widgetDesktop', 'Виджет только на рабочем столе', 'Не перекрывает окна программ. Если выключить — висит поверх всех окон')}
    ${row('autostart', 'Запускать вместе с Windows', 'Приложение стартует свёрнутым, напоминания приходят сразу')}
    <div class="toggle-row"><div>Уведомления<small>Проверьте, что Windows показывает напоминания</small></div><button type="button" class="btn" data-act="notify-test">Проверить</button></div>`}
    <div id="cloudBox"></div>
    <div class="sheet-actions"><span class="spacer"></span><button type="button" class="btn primary" data-act="modal-close">Готово</button></div>`, null, null);
}
/* ---------- облако: блок в настройках ---------- */
let cloudKey = '';
function renderCloudBox(st) {
  const box = $('#cloudBox');
  if (!box) return;
  const key = JSON.stringify([st.configured, st.signedIn, st.email, st.error, Math.floor((st.lastSync || 0) / 60000)]);
  if (key === cloudKey && box.innerHTML) return; // не перерисовывать без изменений, чтобы не сбивать ввод
  cloudKey = key;
  const t = st.lastSync ? new Date(st.lastSync) : null;
  if (!st.configured) {
    box.innerHTML = `<div class="toggle-row"><div>Облако<small>Синхронизация с телефоном ещё не настроена. Записи хранятся только на этом устройстве.</small></div></div>`;
  } else if (st.signedIn) {
    box.innerHTML = `<div class="toggle-row"><div>Облако<small>${esc(st.email)} · ${st.error ? esc(st.error) : t ? `синхронизировано в ${S.pad(t.getHours())}:${S.pad(t.getMinutes())}` : 'идёт синхронизация…'}</small></div>
      <button type="button" class="btn" data-act="cloud-signout">Выйти</button></div>`;
  } else {
    box.innerHTML = `<div class="toggle-row" style="border-bottom:0"><div>Облако<small>Войдите, чтобы записи были одинаковыми на компьютере и телефоне</small></div></div>
      <div class="two"><label class="field"><span>Почта</span><input type="text" id="cloudEmail" autocomplete="username" inputmode="email"></label>
      <label class="field"><span>Пароль</span><input type="password" id="cloudPass" autocomplete="current-password"></label></div>
      <div class="err" id="cloudErr">${esc(st.error || '')}</div>
      <button type="button" class="btn" data-act="cloud-signin">Войти</button>`;
  }
}
async function refreshCloudBox() { cloudKey = ''; renderCloudBox(await api.cloudStatus()); }
api.onCloudStatus((st) => renderCloudBox(st));

modal.addEventListener('change', (e) => {
  const key = e.target.dataset && e.target.dataset.setting;
  if (key) { state.settings[key] = e.target.checked; api.setState(state); }
  if (e.target.id === 'taskDay') { const tm = $('#taskTime'); tm.disabled = e.target.value === ''; if (tm.disabled) tm.value = ''; }
});

/* ---------- всплывающая подсказка ---------- */
let toastTimer = null;
function toast(text, withUndo) {
  const el = $('#toast');
  el.innerHTML = esc(text) + (withUndo && undoSnapshot ? ' &nbsp;<button class="btn ghost" data-act="undo" style="padding:4px 10px">Отменить</button>' : '');
  el.hidden = true; void el.offsetWidth; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, withUndo ? 6000 : 3200);
}

/* ---------- действия ---------- */
const go = (v) => { if (VIEWS[v]) { view = v; render(true); } };
const actions = {
  nav: (el) => go(el.dataset.view),
  settings: () => { settingsModal(); refreshCloudBox(); },
  'modal-close': () => closeModal(),
  'modal-del': (el) => {
    if (!el.dataset.armed) { el.dataset.armed = '1'; el.textContent = 'Нажмите ещё раз'; return; }
    if (modalDelete) modalDelete();
    closeModal();
  },
  undo: () => { if (undoSnapshot) { state = S.normalize(JSON.parse(undoSnapshot)); undoSnapshot = null; $('#toast').hidden = true; commit(); } },
  'cloud-signin': async (el) => {
    const email = $('#cloudEmail').value.trim(), pass = $('#cloudPass').value;
    if (!email || !pass) { $('#cloudErr').textContent = 'Введите почту и пароль.'; return; }
    el.disabled = true; el.textContent = 'Вход…';
    const r = await api.cloudSignIn(email, pass);
    if (r.ok) refreshCloudBox();
    else { el.disabled = false; el.textContent = 'Войти'; $('#cloudErr').textContent = r.error || 'Не удалось войти.'; }
  },
  'cloud-signout': async () => { await api.cloudSignOut(); refreshCloudBox(); },
  'notify-test': async () => { const ok = await api.testNotify(); toast(ok ? 'Уведомление отправлено' : 'Уведомления недоступны в системе'); },

  'inc-month': (el) => { cur.incomeMonth = shiftMonth(cur.incomeMonth, Number(el.dataset.d)); render(false); },
  'income-new': () => incomeModal(),
  'income-edit': (el) => incomeModal(el.dataset.id),
  'income-del': (el) => { snapshot(); state.incomes = state.incomes.filter((i) => i.id !== el.dataset.id); commit('Запись удалена'); },
  'sphere-new': () => sphereModal(),
  'sphere-edit': (el) => sphereModal(el.dataset.id),

  'exp-year': (el) => { const [y, m] = cur.expenseMonth.split('-'); cur.expenseMonth = `${Number(y) + Number(el.dataset.d)}-${m}`; render(false); },
  'exp-month': (el) => { cur.expenseMonth = el.dataset.k; render(false); },
  'expense-new': () => expenseModal(),
  'expense-edit': (el) => expenseModal(el.dataset.id),
  'expense-del': (el) => { snapshot(); state.expenses = state.expenses.filter((i) => i.id !== el.dataset.id); commit('Запись удалена'); },

  'event-month': (el) => { cur.eventMonth = shiftMonth(cur.eventMonth, Number(el.dataset.d)); render(false); },
  'event-today': () => { cur.eventDay = S.ymd(new Date()); cur.eventMonth = S.monthKey(new Date()); render(false); },
  'event-day': (el, e) => {
    cur.eventDay = el.dataset.k;
    cur.eventMonth = el.dataset.k.slice(0, 7);
    render(false);
    if (e.detail >= 2) eventModal();
  },
  'event-new': () => eventModal(),
  'event-edit': (el) => eventModal(el.dataset.id),
  'event-del': (el) => { snapshot(); state.events = state.events.filter((i) => i.id !== el.dataset.id); commit('Событие удалено'); },

  'task-week': (el) => { cur.taskWeek = shiftWeek(cur.taskWeek, Number(el.dataset.d)); render(false); },
  'task-week-now': () => { cur.taskWeek = S.weekKey(new Date()); render(false); },
  'task-new': () => taskModal(),
  'task-edit': (el) => taskModal(el.dataset.id),
  'task-del': (el) => { snapshot(); state.tasks = state.tasks.filter((i) => i.id !== el.dataset.id); commit('Задача удалена'); },
  'task-toggle': (el) => {
    const t = state.tasks.find((i) => i.id === el.dataset.id), wk = el.dataset.wk;
    if (!t) return;
    t.done = t.done || {};
    if (t.done[wk]) delete t.done[wk]; else t.done[wk] = true;
    commit();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el, e);
});

/* ---------- запуск ---------- */
$('#brandDollar').innerHTML = S.dollarHTML(14);
if ($('#loginDollar')) $('#loginDollar').innerHTML = S.dollarHTML(14); // экран входа есть только в веб-версии
api.onState((s) => { state = S.normalize(s); render(false); });
api.onNavigate((v) => go(v));
api.getState().then((s) => { state = S.normalize(s); render(true); });

// Пересчёт при смене дня или недели, пока окно открыто.
let lastDay = S.ymd(new Date());
setInterval(() => {
  const d = S.ymd(new Date());
  if (d !== lastDay) { lastDay = d; cur.taskWeek = S.weekKey(new Date()); render(false); }
}, 60000);
