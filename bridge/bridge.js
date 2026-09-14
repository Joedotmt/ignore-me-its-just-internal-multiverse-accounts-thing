(function (global) {
  'use strict';

  const { RETURN_ORIGINS, verifiedSession } = global.JoeAccountsCore;

  global.addEventListener('message', async (event) => {
    if (global.parent === global || event.source !== global.parent) return;
    if (!RETURN_ORIGINS.has(event.origin)) return;

    const data = event.data;
    if (!data || data.type !== 'joe-accounts:request' ||
        typeof data.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(data.nonce)) return;

    try {
      const session = await verifiedSession();
      event.source.postMessage({
        type: 'joe-accounts:response',
        nonce: data.nonce,
        token: session?.token || '',
        record: session?.record || null,
      }, event.origin);
    } catch (_) {
      event.source.postMessage({ type: 'joe-accounts:error', nonce: data.nonce }, event.origin);
    }
  });
})(window);
