// Load this before creating a PocketBase client, on any app origin this account site
// serves. A same-site app reads the session through a hidden bridge iframe and keeps its
// copy in memory; a cross-site app receives it once in the URL fragment on the way back
// from sign-in. Only accounts.joe.mt persists the session itself.
(function (global) {
  'use strict';

  const ACCOUNTS_ORIGIN = 'https://accounts.joe.mt';
  // Must match BRIDGE_ORIGINS and HANDOFF_ORIGINS in the account site's session.js.
  const BRIDGE_ORIGINS = new Set(['https://joe.mt', 'https://notes.joe.mt']);
  const HANDOFF_ORIGINS = new Set([
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173'
  ]);
  const RETURN_ORIGINS = new Set([...BRIDGE_ORIGINS, ...HANDOFF_ORIGINS]);
  const HANDOFF_PARAM = 'joe_session';
  const BRIDGE_TIMEOUT_MS = 12000;

  // Only the new client clears the previous shared cookie. This lets older app
  // deployments continue using it until they have been updated to this client.
  if (BRIDGE_ORIGINS.has(global.location.origin)) {
    for (const name of ['joe_mt_users_auth', 'joe_mt_users_auth_initialized']) {
      global.document.cookie = `${name}=; Max-Age=0; Domain=joe.mt; Path=/; SameSite=Lax; Secure`;
    }
  }

  function canBridge() { return BRIDGE_ORIGINS.has(global.location.origin); }
  function canHandoff() { return HANDOFF_ORIGINS.has(global.location.origin); }

  function returnUrl(raw) {
    const candidate = raw === undefined ? global.location.href : raw;
    if (typeof candidate !== 'string') throw new TypeError('Return URL must be an absolute URL.');
    let url;
    try { url = new URL(candidate); } catch (_) { throw new TypeError('Return URL must be an absolute URL.'); }
    if (!RETURN_ORIGINS.has(url.origin) || url.username || url.password) {
      throw new TypeError(`Return URL must be on an origin ${ACCOUNTS_ORIGIN} serves.`);
    }
    // The session gets handed back to this exact URL, so never let one travel in with it.
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    if (fragment.has(HANDOFF_PARAM)) {
      fragment.delete(HANDOFF_PARAM);
      const rest = fragment.toString();
      url.hash = rest ? `#${rest}` : '';
    }
    return url.href;
  }

  /**
   * Reads a handed-over session out of the URL fragment and removes it from the address
   * bar in the same tick, so it never reaches a server, a Referer header, or a URL the
   * user might share. Runs once at load; takeHandoffToken() passes it to the app.
   */
  const handoff = (() => {
    const none = { token: '', problem: '' };
    if (!canHandoff() || !global.location.hash) return none;
    const fragment = new URLSearchParams(global.location.hash.replace(/^#/, ''));
    const token = fragment.get(HANDOFF_PARAM);
    if (!token) return none;

    fragment.delete(HANDOFF_PARAM);
    const rest = fragment.toString();
    const cleaned = `${global.location.pathname}${global.location.search}${rest ? `#${rest}` : ''}`;
    try {
      global.history.replaceState(global.history.state, '', cleaned);
    } catch (_) {
      global.location.hash = rest;
    }

    // A token that arrived but cannot be used is reported, not silently dropped, so the
    // app can tell the user something other than "sign in required" again.
    const payload = tokenPayload(token);
    if (!payload) return { token: '', problem: 'malformed' };
    // PocketBase 0.23+ marks record auth tokens with type "auth" (the older "authRecord"
    // is never issued by a current server).
    if (payload.type !== 'auth') return { token: '', problem: 'wrong-type' };
    if (!(typeof payload.exp === 'number' && payload.exp > Date.now() / 1000)) {
      return { token: '', problem: 'expired' };
    }
    return { token, problem: '' };
  })();

  let handoffTaken = false;

  /**
   * The session token handed over by the account site, once. Returns '' when there was
   * none, when it has already been read, or when it was unusable (see handoffProblem).
   */
  function takeHandoffToken() {
    if (handoffTaken) return '';
    handoffTaken = true;
    return handoff.token;
  }

  /** Why a handed-over token was refused: '' | 'malformed' | 'wrong-type' | 'expired'. */
  function handoffProblem() { return handoff.problem; }

  function loginUrl(destination) {
    const url = new URL('/', ACCOUNTS_ORIGIN);
    url.searchParams.set('redirect', returnUrl(destination));
    return url.href;
  }

  function logoutUrl(destination) {
    const url = new URL('/', ACCOUNTS_ORIGIN);
    url.searchParams.set('logout', '1');
    url.searchParams.set('redirect', returnUrl(destination));
    return url.href;
  }

  function tokenPayload(token) {
    if (typeof token !== 'string') return null;
    try {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(global.atob(base64));
    } catch (_) {
      return null;
    }
  }

  class AuthStore {
    constructor() {
      this._token = '';
      this._record = null;
      this._listeners = new Set();
    }

    get token() { return this._token; }
    get record() { return this._record; }
    get model() { return this._record; }
    get isValid() {
      const exp = tokenPayload(this._token)?.exp;
      return typeof exp === 'number' && exp > Date.now() / 1000;
    }
    get isAuthRecord() { return tokenPayload(this._token)?.type === 'auth'; }
    get isSuperuser() { return false; }
    get isAdmin() { return false; }

    save(token, record) {
      this._token = typeof token === 'string' ? token : '';
      this._record = record || null;
      for (const listener of this._listeners) listener(this._token, this._record);
    }

    clear() { this.save('', null); }

    onChange(callback, fireImmediately = false) {
      this._listeners.add(callback);
      if (fireImmediately) callback(this._token, this._record);
      return () => this._listeners.delete(callback);
    }
  }

  function getSession() {
    // Only a same-site caller can use the bridge. A cross-site app has already been
    // handed its session in the fragment and has nothing to ask this iframe for.
    if (!canBridge()) {
      return Promise.reject(new Error(`${ACCOUNTS_ORIGIN} does not bridge sessions to this origin.`));
    }

    return new Promise((resolve, reject) => {
      const bytes = new Uint8Array(16);
      global.crypto.getRandomValues(bytes);
      const nonce = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      const iframe = global.document.createElement('iframe');
      iframe.hidden = true;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.setAttribute('title', 'Joe Accounts session');
      iframe.referrerPolicy = 'no-referrer';
      iframe.src = `${ACCOUNTS_ORIGIN}/bridge/`;

      let settled = false;
      const finish = (error, session) => {
        if (settled) return;
        settled = true;
        global.clearTimeout(timer);
        global.removeEventListener('message', onMessage);
        iframe.remove();
        if (error) reject(error);
        else resolve(session);
      };

      const onMessage = (event) => {
        if (event.origin !== ACCOUNTS_ORIGIN || event.source !== iframe.contentWindow) return;
        const data = event.data;
        if (!data || data.nonce !== nonce) return;
        if (data.type === 'joe-accounts:error') {
          finish(new Error('Could not verify the Joe Accounts session.'));
          return;
        }
        if (data.type !== 'joe-accounts:response') return;
        if (data.token === '' && data.record === null) {
          finish(null, null);
        } else if (typeof data.token === 'string' && data.record &&
                   data.record.collectionName === 'users' && typeof data.record.id === 'string') {
          finish(null, { token: data.token, record: data.record });
        } else {
          finish(new Error('Joe Accounts returned an invalid session.'));
        }
      };

      const timer = global.setTimeout(() => finish(new Error('Joe Accounts did not respond.')), BRIDGE_TIMEOUT_MS);
      iframe.addEventListener('load', () => {
        iframe.contentWindow.postMessage({ type: 'joe-accounts:request', nonce }, ACCOUNTS_ORIGIN);
      }, { once: true });
      iframe.addEventListener('error', () => finish(new Error('Could not load Joe Accounts.')), { once: true });
      global.addEventListener('message', onMessage);
      (global.document.body || global.document.documentElement).appendChild(iframe);
    });
  }

  global.JoeAccounts = {
    AuthStore,
    getSession,
    loginUrl,
    logoutUrl,
    canBridge,
    canHandoff,
    takeHandoffToken,
    handoffProblem
  };
})(window);
