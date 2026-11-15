// Веб-версия: синхронизация с облаком Google (Firebase) обычными веб-запросами, без внешних библиотек —
// тем же способом, что и приложение на компьютере (cloud.js). Подключается, только если заполнен config.js.
// Данные — один документ users/<uid>/data/main с полем json.
(function () {
  const cfg = window.FD_CONFIG || {};
  const api = window.api;
  const S = window.Shared;
  const AUTH_KEY = 'fd-cloud-auth-v1';
  const POLL_MS = 15000;

  const login = document.getElementById('login');
  const loginErr = document.getElementById('loginErr');
  const showLogin = (on) => { if (login) login.hidden = !on; };

  // Офлайн-кэш страницы
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  if (!cfg.apiKey || !cfg.projectId) return; // облако не настроено — работаем только с памятью браузера

  let auth = null; // { email, uid, refreshToken }
  try { auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch { auth = null; }
  let idToken = null, tokenExpires = 0;
  let busy = false, again = false, debounce = null;

  const saveAuth = () => { try { auth ? localStorage.setItem(AUTH_KEY, JSON.stringify(auth)) : localStorage.removeItem(AUTH_KEY); } catch (e) { console.error(e); } };

  const humanError = (e) => {
    const m = String((e && e.message) || e);
    if (/INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_EMAIL/.test(m)) return 'Неверная почта или пароль.';
    if (/PASSWORD_LOGIN_DISABLED|OPERATION_NOT_ALLOWED/.test(m)) return 'В проекте Firebase не включён вход по почте и паролю (Authentication → Sign-in method).';
    if (/USER_DISABLED/.test(m)) return 'Учётная запись отключена.';
    if (/TOO_MANY_ATTEMPTS/.test(m)) return 'Слишком много попыток. Подождите и попробуйте снова.';
    if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND/.test(m)) return 'Вход устарел. Войдите заново.';
    if (/PERMISSION_DENIED|insufficient permissions/i.test(m)) return 'Облако отклонило доступ. Проверьте правила базы данных.';
    if (/Failed to fetch|Load failed|NetworkError|network/i.test(m)) return 'Нет связи с облаком Google. Изменения отправятся, когда связь появится.';
    return m;
  };

  async function post(url, body, form) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || 'HTTP ' + r.status);
    return j;
  }

  async function token() {
    if (idToken && Date.now() < tokenExpires - 60000) return idToken;
    const j = await post(`https://securetoken.googleapis.com/v1/token?key=${cfg.apiKey}`, { grant_type: 'refresh_token', refresh_token: auth.refreshToken }, true);
    idToken = j.id_token;
    tokenExpires = Date.now() + Number(j.expires_in || 3600) * 1000;
    if (j.refresh_token && j.refresh_token !== auth.refreshToken) { auth.refreshToken = j.refresh_token; saveAuth(); }
    return idToken;
  }

  const docUrl = () => `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/users/${auth.uid}/data/main`;

  async function pull() {
    const r = await fetch(docUrl(), { headers: { authorization: 'Bearer ' + (await token()) }, cache: 'no-store' });
    if (r.status === 404) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);
    const s = j.fields && j.fields.json && j.fields.json.stringValue;
    return s ? JSON.parse(s) : null;
  }

  async function push(data) {
    const r = await fetch(docUrl(), {
      method: 'PATCH',
      headers: { authorization: 'Bearer ' + (await token()), 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { json: { stringValue: JSON.stringify(data) }, updatedAt: { integerValue: String(Date.now()) } } }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j.error && j.error.message) || 'HTTP ' + r.status); }
  }

  function dropAuth() {
    auth = null; idToken = null;
    saveAuth();
    api._setCloud({ signedIn: false, email: '', lastSync: 0 });
    showLogin(true);
  }

  // Один цикл: скачать, слить с локальными данными, применить и отправить отличия.
  async function sync() {
    if (!auth) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      const remote = await pull();
      const local = api._data();
      const merged = remote ? S.mergeData(local, remote, Date.now()) : local;
      if (!S.sameData(merged, local)) api._applyRemote(merged);
      if (!remote || !S.sameData(merged, remote)) await push(merged);
      api._setCloud({ lastSync: Date.now(), error: '' });
    } catch (e) {
      const msg = humanError(e);
      if (/Вход устарел/.test(msg)) dropAuth();
      api._setCloud({ error: msg });
    } finally {
      busy = false;
      if (again) { again = false; sync(); }
    }
  }

  api._hooks.push = () => { if (!auth) return; clearTimeout(debounce); debounce = setTimeout(sync, 800); };
  api._hooks.signIn = async (email, password) => {
    try {
      const j = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.apiKey}`, { email, password, returnSecureToken: true });
      auth = { email: j.email, uid: j.localId, refreshToken: j.refreshToken };
      idToken = j.idToken;
      tokenExpires = Date.now() + Number(j.expiresIn || 3600) * 1000;
      saveAuth();
      api._setCloud({ signedIn: true, email: auth.email, error: '' });
      showLogin(false);
      sync();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: humanError(e) };
    }
  };
  api._hooks.signOut = async () => dropAuth();

  // Запуск
  api._setCloud({ configured: true, signedIn: !!auth, email: auth ? auth.email : '' });
  showLogin(!auth);
  if (auth) sync();
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  window.addEventListener('online', sync);

  // Форма входа на весь экран
  const form = document.getElementById('loginForm');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    loginErr.textContent = '';
    btn.disabled = true; btn.textContent = 'Вход…';
    const r = await api._hooks.signIn(form.email.value.trim(), form.password.value);
    btn.disabled = false; btn.textContent = 'Войти';
    if (!r.ok) loginErr.textContent = r.error;
    else form.password.value = '';
  });
})();
