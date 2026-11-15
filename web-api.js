// Веб-версия: тот же интерфейс window.api, что даёт приложению preload.js на компьютере,
// но данные лежат в памяти браузера (localStorage) и, если настроено облако, синхронизируются через cloud-web.js.
(function () {
  const S = window.Shared;
  const KEY = 'fd-state-v1';

  let state;
  try { state = S.normalize(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { state = S.defaults(); }

  const stateSubs = [], cloudSubs = [];
  let cloud = { configured: false, signedIn: false, email: '', lastSync: 0, error: '' };
  let hooks = { push: null, signIn: null, signOut: null }; // заполняет cloud-web.js

  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.error(e); } };

  // Интерфейс всегда получает и отдаёт копии: иначе его правки меняли бы и «прежнее» состояние,
  // и отметки времени для синхронизации не ставились бы (на компьютере копирование делает сам Electron).
  const copy = (x) => JSON.parse(JSON.stringify(x));

  window.api = {
    platform: 'web',
    getState: async () => copy(state),
    setState(next) {
      const prev = state;
      next = S.normalize(copy(next));
      S.stamp(prev, next, Date.now());
      state = next;
      persist();
      if (hooks.push) hooks.push();
    },
    onState: (cb) => stateSubs.push(cb),
    onNavigate: () => {},
    showMain: () => {},
    testNotify: async () => false,

    cloudStatus: async () => cloud,
    cloudSignIn: async (email, password) => (hooks.signIn ? hooks.signIn(email, password) : { ok: false, error: 'Облако не настроено.' }),
    cloudSignOut: async () => { if (hooks.signOut) await hooks.signOut(); return true; },
    onCloudStatus: (cb) => cloudSubs.push(cb),

    // Служебное, для cloud-web.js
    _hooks: hooks,
    _data: () => S.cloudPart(state),
    _applyRemote(data) {
      state = Object.assign(state, data);
      persist();
      stateSubs.forEach((cb) => cb(copy(state)));
    },
    _setCloud(patch) {
      cloud = Object.assign({}, cloud, patch);
      cloudSubs.forEach((cb) => cb(cloud));
    },
  };
})();
