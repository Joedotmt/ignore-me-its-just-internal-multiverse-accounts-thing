// Load this on https://joe.mt or https://notes.joe.mt, before creating a PocketBase client.
// AuthStore keeps the app's copy of the session in memory; only accounts.joe.mt persists it.
(function (global) {
  'use strict';

  const ACCOUNTS_ORIGIN = 'https://accounts.joe.mt';
  const RETURN_ORIGINS = new Set(['https://joe.mt', 'https://notes.joe.mt']);
  const BRIDGE_TIMEOUT_MS = 12000;

  // Only the new client clears the previous shared cookie. This lets older app
  // deployments continue using it until they have been updated to this client.
  if (RETURN_ORIGINS.has(global.location.origin)) {
    for (const name of ['joe_mt_users_auth', 'joe_mt_users_auth_initialized']) {
      global.document.cookie = `${name}=; Max-Age=0; Domain=joe.mt; Path=/; SameSite=Lax; Secure`;
    }
  }

  function returnUrl(raw) {
    const candidate = raw === undefined ? global.location.href : raw;
    if (typeof candidate !== 'string') throw new TypeError('Return URL must be an absolute URL.');
    let url;
    try { url = new URL(candidate); } catch (_) { throw new TypeError('Return URL must be an absolute URL.'); }
    if (!RETURN_ORIGINS.has(url.origin) || url.username || url.password) {
      throw new TypeError('Return URL must be on https://joe.mt or https://notes.joe.mt.');
    }
    return url.href;
  }

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
    get isAuthRecord() { return tokenPayload(this._token)?.type === 'authRecord'; }
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
    // The bridge itself enforces the same allowlist; fail early on unsupported hosts.
    returnUrl(global.location.href);

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

  global.JoeAccounts = { AuthStore, getSession, loginUrl, logoutUrl };
})(window);
