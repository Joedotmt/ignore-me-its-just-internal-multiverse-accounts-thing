// Code that runs only on accounts.joe.mt. The PocketBase auth store stays on this origin.
(function (global) {
  'use strict';

  // Origins served by the hidden iframe bridge. These must be same-site with this page:
  // browsers partition an iframe's storage by top-level site, so a cross-site bridge
  // would only ever see an empty store and report a signed-out user.
  const BRIDGE_ORIGINS = new Set(['https://joe.mt', 'https://notes.joe.mt']);

  // Origins that instead receive the session in the URL fragment on the way back. This
  // is how a cross-site app signs in, including a dev server. Everything listed here can
  // obtain the user's session without any further prompt, so keep the list short and
  // limited to apps under this operator's control.
  const HANDOFF_ORIGINS = new Set([
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173'
  ]);

  const RETURN_ORIGINS = new Set([...BRIDGE_ORIGINS, ...HANDOFF_ORIGINS]);
  const HANDOFF_PARAM = 'joe_session';

  const pb = new global.PocketBase('https://joemt.fly.dev');
  pb.autoCancellation(false);

  function allowedReturnUrl(raw) {
    if (typeof raw !== 'string') return null;
    try {
      const url = new URL(raw);
      if (!RETURN_ORIGINS.has(url.origin) || url.username || url.password) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  // A bridge origin can read the session from this origin's own storage, so it never
  // needs the token in a URL. Only a cross-site app does.
  function needsSessionHandoff(raw) {
    if (typeof raw !== 'string') return false;
    try {
      return HANDOFF_ORIGINS.has(new URL(raw).origin);
    } catch (_) {
      return false;
    }
  }

  /**
   * Returns the app's URL with the session in its fragment. A fragment is never sent to
   * a server, kept out of the Referer header, and absent from server logs; the receiving
   * app strips it from the address bar as soon as it has read it.
   */
  function returnUrlWithSession(raw, token) {
    const url = new URL(raw);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    fragment.set(HANDOFF_PARAM, token);
    url.hash = fragment.toString();
    return url.href;
  }

  function usersSession() {
    const record = pb.authStore.record;
    if (!pb.authStore.isValid || !record || record.collectionName !== 'users' || !record.id) return null;
    return { token: pb.authStore.token, record };
  }

  async function verifiedSession() {
    if (!usersSession()) {
      pb.authStore.clear();
      return null;
    }
    try {
      await pb.collection('users').authRefresh();
    } catch (error) {
      // An invalid/revoked token is a sign-out. A temporary network failure is not.
      if (error && (error.status === 400 || error.status === 401 || error.status === 403)) {
        pb.authStore.clear();
        return null;
      }
      throw error;
    }
    const session = usersSession();
    if (!session) pb.authStore.clear();
    return session;
  }

  global.JoeAccountsCore = {
    pb,
    allowedReturnUrl,
    needsSessionHandoff,
    returnUrlWithSession,
    usersSession,
    verifiedSession,
    BRIDGE_ORIGINS,
    HANDOFF_ORIGINS,
    RETURN_ORIGINS,
    HANDOFF_PARAM
  };
})(window);
