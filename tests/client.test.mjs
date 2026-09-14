// Run with: node --test tests/client.test.mjs
//
// Covers the part of client.js that carries a session, so a change that leaks a token
// into a shareable URL, or hands one to an origin this site does not serve, fails here.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const CLIENT = fileURLToPath(new URL('../client.js', import.meta.url));

function jwt(payload) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.signature`;
}
const liveToken = jwt({ type: 'authRecord', exp: Math.floor(Date.now() / 1000) + 3600 });
const expiredToken = jwt({ type: 'authRecord', exp: Math.floor(Date.now() / 1000) - 10 });

// Loads the real client.js against a fake browser sitting at the given URL.
function loadClient(href) {
  const url = new URL(href);
  const replaced = [];
  const location = {
    href: url.href,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash
  };
  const win = {
    location,
    document: {
      cookie: '',
      createElement: () => ({ setAttribute() {}, addEventListener() {}, remove() {} })
    },
    history: {
      state: null,
      replaceState(state, title, next) {
        replaced.push(next);
        const resolved = new URL(next, location.origin);
        location.pathname = resolved.pathname;
        location.search = resolved.search;
        location.hash = resolved.hash;
        location.href = resolved.href;
      }
    },
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    crypto: { getRandomValues: (array) => array.fill(7) }
  };
  const context = vm.createContext({ window: win, console, URL, URLSearchParams });
  vm.runInContext(fs.readFileSync(CLIENT, 'utf8'), context);
  return { api: win.JoeAccounts, location, replaced };
}

test('a handed-over session is read once and stripped from the address bar', () => {
  const { api, location, replaced } = loadClient(
    `http://localhost:5173/notes/?a=1#joe_session=${liveToken}`
  );

  assert.equal(api.canHandoff(), true);
  assert.equal(api.canBridge(), false);
  // Stripped as the script loads, not merely once the app gets around to asking.
  assert.equal(replaced.length, 1);
  assert.equal(location.hash, '');
  assert.equal(location.search, '?a=1');
  assert.ok(!location.href.includes(liveToken));

  assert.equal(api.takeHandoffToken(), liveToken);
  assert.equal(api.takeHandoffToken(), '', 'the token must only be readable once');
});

test('an unrelated fragment survives the strip', () => {
  const { location } = loadClient(`http://localhost:5173/#note=abc&joe_session=${liveToken}`);
  assert.equal(location.hash, '#note=abc');
});

test('an expired handed-over session is refused', () => {
  const { api } = loadClient(`http://localhost:5173/#joe_session=${expiredToken}`);
  assert.equal(api.takeHandoffToken(), '');
});

test('a fragment on an origin this site does not serve is ignored', () => {
  const { api, location, replaced } = loadClient(`https://evil.example/#joe_session=${liveToken}`);
  assert.equal(api.canHandoff(), false);
  assert.equal(api.takeHandoffToken(), '');
  assert.equal(replaced.length, 0);
  assert.equal(location.hash, `#joe_session=${liveToken}`);
});

test('the bridge is refused on a handoff origin', async () => {
  const { api } = loadClient('http://localhost:5173/');
  await assert.rejects(() => api.getSession(), /does not bridge sessions/);
});

test('a login link never carries an existing token back into the return URL', () => {
  const { api } = loadClient(`http://localhost:5173/#joe_session=${liveToken}`);
  const login = new URL(api.loginUrl(`http://localhost:5173/#joe_session=${liveToken}`));
  assert.equal(login.origin, 'https://accounts.joe.mt');
  assert.equal(login.searchParams.get('redirect'), 'http://localhost:5173/');
});

test('an origin outside both lists is still rejected', () => {
  const { api } = loadClient('http://localhost:5173/');
  assert.throws(() => api.loginUrl('https://evil.example/'), /must be on an origin/);
});
