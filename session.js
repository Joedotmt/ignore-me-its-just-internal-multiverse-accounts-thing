// Code that runs only on accounts.joe.mt. The PocketBase auth store stays on this origin.
(function (global) {
  'use strict';

  const RETURN_ORIGINS = new Set(['https://joe.mt', 'https://notes.joe.mt']);
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

  global.JoeAccountsCore = { pb, allowedReturnUrl, usersSession, verifiedSession, RETURN_ORIGINS };
})(window);
