// Веб-версия: синхронизация с облаком Google (Firebase). Подключается только если заполнен config.js.
// Данные — один документ users/<uid>/data/main с полем json (тот же, что читает приложение на компьютере).
const cfg = window.FD_CONFIG || {};
const api = window.api;
const S = window.Shared;

const login = document.getElementById('login');
const loginErr = document.getElementById('loginErr');
const showLogin = (on) => { if (login) login.hidden = !on; };

const humanError = (e) => {
  const m = String((e && (e.code || e.message)) || e);
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/i.test(m)) return 'Неверная почта или пароль.';
  if (/operation-not-allowed|password-login-disabled/i.test(m)) return 'В проекте Firebase не включён вход по почте и паролю (Authentication → Sign-in method).';
  if (/too-many-requests/i.test(m)) return 'Слишком много попыток. Подождите и попробуйте снова.';
  if (/network/i.test(m)) return 'Нет связи с интернетом.';
  if (/permission/i.test(m)) return 'Облако отклонило доступ. Проверьте правила базы данных.';
  return m;
};

if (cfg.apiKey && cfg.projectId) start().catch((e) => {
  // Библиотека облака не загрузилась (например, нет интернета) — работаем с сохранёнными в браузере данными.
  api._setCloud({ configured: true, error: 'Нет связи с облаком. Изменения отправятся позже.' });
  console.error(e);
});

async function start() {
  const V = '10.12.2';
  const [{ initializeApp }, { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut }, { getFirestore, doc, onSnapshot, setDoc }] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);
  api._setCloud({ configured: true });

  let ref = null, unsub = null, lastRemote = null, timer = null;

  const write = (data) => setDoc(ref, { json: JSON.stringify(data), updatedAt: Date.now() })
    .then(() => api._setCloud({ lastSync: Date.now(), error: '' }))
    .catch((e) => api._setCloud({ error: humanError(e) }));

  // Слить то, что пришло из облака, с локальными данными; применить и отправить отличия.
  function sync(remote) {
    lastRemote = remote;
    const local = api._data();
    const merged = remote ? S.mergeData(local, remote, Date.now()) : local;
    if (!S.sameData(merged, local)) api._applyRemote(merged);
    if (!remote || !S.sameData(merged, remote)) write(merged);
    else api._setCloud({ lastSync: Date.now(), error: '' });
  }

  api._hooks.push = () => {
    if (!ref) return;
    clearTimeout(timer);
    timer = setTimeout(() => sync(lastRemote), 700);
  };
  api._hooks.signIn = async (email, password) => {
    try { await signInWithEmailAndPassword(auth, email, password); return { ok: true }; }
    catch (e) { return { ok: false, error: humanError(e) }; }
  };
  api._hooks.signOut = () => signOut(auth);

  onAuthStateChanged(auth, (user) => {
    if (unsub) { unsub(); unsub = null; }
    if (!user) {
      ref = null; lastRemote = null;
      api._setCloud({ signedIn: false, email: '', lastSync: 0 });
      showLogin(true);
      return;
    }
    showLogin(false);
    api._setCloud({ signedIn: true, email: user.email || '', error: '' });
    ref = doc(db, 'users', user.uid, 'data', 'main');
    unsub = onSnapshot(ref, (snap) => {
      let remote = null;
      try { remote = snap.exists() ? JSON.parse(snap.data().json) : null; } catch { remote = null; }
      sync(remote);
    }, (e) => api._setCloud({ error: humanError(e) }));
  });

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
}

// Офлайн-кэш страницы
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
