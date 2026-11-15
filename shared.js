// Общие функции для главного процесса, окна приложения и виджета.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(this, function () {
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  // Неделя начинается с понедельника; ключ недели — дата её понедельника.
  const monday = (d) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  };
  const weekKey = (d) => ymd(monday(d));
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const dow = (d) => (d.getDay() + 6) % 7; // Пн = 0 … Вс = 6

  const defaults = () => ({
    version: 1,
    spheres: [],
    incomes: [],
    expenses: [],
    tasks: [],
    events: [],
    deleted: {},
    notified: {},
    // widgetDesktop: виджет закреплён на рабочем столе; если false — плавает поверх всех окон.
    settings: { widget: true, widgetDesktop: true, autostart: false, widgetPos: null, trayHint: false },
  });

  function normalize(s) {
    const d = defaults();
    if (!s || typeof s !== 'object') return d;
    const out = Object.assign(d, s);
    for (const k of ['spheres', 'incomes', 'expenses', 'tasks', 'events']) if (!Array.isArray(out[k])) out[k] = [];
    if (!out.notified || typeof out.notified !== 'object') out.notified = {};
    if (!out.deleted || typeof out.deleted !== 'object') out.deleted = {};
    out.settings = Object.assign(defaults().settings, s.settings || {});
    return out;
  }

  // Повторяющаяся задача видна во всех неделях начиная с недели создания, разовая — только в своей.
  const tasksForWeek = (state, wk) => state.tasks.filter((t) => (t.repeat ? t.week <= wk : t.week === wk));
  const isDone = (t, wk) => !!(t.done && t.done[wk]);
  const sumMonth = (list, mk) =>
    list.reduce((a, x) => (x.date && x.date.startsWith(mk) ? a + (Number(x.amount) || 0) : a), 0);

  const sortTasks = (list, wk) =>
    list.slice().sort((a, b) => {
      const da = isDone(a, wk) ? 1 : 0, db = isDone(b, wk) ? 1 : 0;
      if (da !== db) return da - db;
      const ya = a.day == null ? 9 : a.day, yb = b.day == null ? 9 : b.day;
      if (ya !== yb) return ya - yb;
      return (a.time || '99') < (b.time || '99') ? -1 : 1;
    });

  // Целые суммы без копеек, дробные — всегда с двумя знаками.
  const fmtMoney = (n) => {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const frac = Number.isInteger(v) ? 0 : 2;
    return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: frac, maximumFractionDigits: frac }).format(v) + ' ₽';
  };

  // Разметка монеты-логотипа: n дисков ребра и две лицевые стороны (стили в dollar.css).
  const dollarHTML = (n) =>
    '<span class="tilt"><span class="spin">' +
    Array.from({ length: n }, (_, i) => `<i class="rim" style="--z:${(i / (n - 1) - 0.5).toFixed(3)}"></i>`).join('') +
    '<span class="face front"><b>$</b></span><span class="face back"><b>$</b></span></span></span>';

  // Ближайшие события начиная с указанной даты (включительно).
  const upcomingEvents = (state, fromYmd, limit) =>
    (state.events || [])
      .filter((e) => e.date >= fromYmd)
      .sort((a, b) => (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1)
      .slice(0, limit);

  /* ---------- синхронизация между устройствами ---------- */
  // В облако уходят только записи (и отметки об удалении); настройки у каждого устройства свои.
  const COLLS = ['spheres', 'incomes', 'expenses', 'tasks', 'events'];
  const cloudPart = (s) => {
    const o = { deleted: Object.assign({}, s.deleted || {}) };
    for (const k of COLLS) o[k] = s[k] || [];
    return o;
  };
  const bare = (r) => { const c = Object.assign({}, r); delete c.u; return JSON.stringify(c); };

  // Сравнивает прежнее и новое состояние: изменённым записям ставит время правки (u),
  // удалённые заносит в next.deleted. Меняет next на месте.
  function stamp(prev, next, now) {
    const del = Object.assign({}, prev.deleted || {});
    for (const id in next.deleted || {}) del[id] = Math.max(del[id] || 0, next.deleted[id]);
    next.deleted = del;
    for (const k of COLLS) {
      const before = new Map((prev[k] || []).map((r) => [r.id, r]));
      const seen = new Set();
      for (const r of next[k] || []) {
        seen.add(r.id);
        const p = before.get(r.id);
        if (del[r.id]) { delete del[r.id]; r.u = now; } // запись вернули (отмена удаления)
        else if (!p || bare(p) !== bare(r)) r.u = now;
        else r.u = p.u || 0;
      }
      for (const id of before.keys()) if (!seen.has(id)) del[id] = now;
    }
    return next;
  }

  // Сливает данные двух устройств: по каждой записи побеждает более поздняя правка,
  // удаление побеждает, если оно сделано не раньше последней правки записи.
  function mergeData(a, b, now) {
    const deleted = {};
    for (const src of [a.deleted || {}, b.deleted || {}]) for (const id in src) deleted[id] = Math.max(deleted[id] || 0, src[id]);
    const cutoff = (now || Date.now()) - 90 * 864e5; // отметки об удалении хранятся 90 дней
    for (const id in deleted) if (deleted[id] < cutoff) delete deleted[id];
    const out = { deleted };
    for (const k of COLLS) {
      const m = new Map();
      for (const r of [...(a[k] || []), ...(b[k] || [])]) {
        const e = m.get(r.id);
        const ru = r.u || 0, eu = e ? e.u || 0 : -1;
        // при одинаковом времени выбор должен быть одинаковым на всех устройствах
        if (!e || ru > eu || (ru === eu && bare(r) > bare(e))) m.set(r.id, r);
      }
      out[k] = [...m.values()].filter((r) => !(deleted[r.id] && deleted[r.id] >= (r.u || 0)));
    }
    return out;
  }

  const canon = (d) => {
    const o = { deleted: {} };
    for (const id of Object.keys(d.deleted || {}).sort()) o.deleted[id] = d.deleted[id];
    for (const k of COLLS) o[k] = (d[k] || []).slice().sort((x, y) => (x.id < y.id ? -1 : 1)).map((r) => bare(r) + '|' + (r.u || 0));
    return JSON.stringify(o);
  };
  const sameData = (a, b) => canon(a) === canon(b);

  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const DAYS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

  return {
    pad, ymd, parseYmd, monday, weekKey, monthKey, dow, defaults, normalize,
    tasksForWeek, isDone, sumMonth, sortTasks, fmtMoney, dollarHTML, upcomingEvents,
    COLLS, cloudPart, stamp, mergeData, sameData,
    MONTHS, MONTHS_GEN, MONTHS_SHORT, DAYS, DAYS_FULL,
  };
});
