# Joe Accounts

Static sign-in site for `https://accounts.joe.mt`, using the PocketBase `users`
collection at `https://joemt.fly.dev`. The account page supports Google, GitHub,
Discord, and email one-time-code sign-in. PocketBase stores the central session in
this origin's local storage. No bearer token is placed in a URL or a parent-domain
cookie.

The page keeps the original joe.mt five-step BeerCSS account wizard: account
choice, provider, email, one-time code, and success.

## App integration

Load `https://accounts.joe.mt/client.js` as a classic script. It immediately
defines `window.JoeAccounts`. For an app using the PocketBase browser SDK:

```js
const pb = new PocketBase('https://joemt.fly.dev', new JoeAccounts.AuthStore());

async function syncAccount() {
  const session = await JoeAccounts.getSession();
  if (session) pb.authStore.save(session.token, session.record);
  else pb.authStore.clear();
}

await syncAccount();
if (!pb.authStore.isValid) location.assign(JoeAccounts.loginUrl(location.href));

// To sign out, clear this app's in-memory copy before leaving.
function signOut() {
  pb.authStore.clear();
  location.assign(JoeAccounts.logoutUrl(location.href));
}
```

### Two ways an app receives the session

`session.js` holds two allowlists, and which one an origin is on decides how it
gets a session. `RETURN_ORIGINS` is their union, and is what `allowedReturnUrl`
accepts as a `redirect` target.

**`BRIDGE_ORIGINS` — same-site apps** (`joe.mt`, `notes.joe.mt`). The client loads
a hidden `accounts.joe.mt/bridge/` iframe and sends a random nonce. The bridge
refreshes the central `users` token through PocketBase and posts the result back
to that origin. The client checks the reply's origin, iframe source, nonce, and
shape. No token touches a URL, and the in-memory auth store keeps the app's copy
out of its `pocketbase_auth` local-storage key.

These origins **must be same-site with this page**. Browsers partition storage in
a third-party context, so a cross-site bridge iframe reads an empty store and
reports a signed-out user however the user is actually signed in. Adding a
cross-site origin here does not work — it loops.

**`HANDOFF_ORIGINS` — cross-site apps** (`localhost` dev servers by default).
No iframe. The sign-in page stays here, and on the way back the session is
appended to the return URL's **fragment** as `#joe_session=<token>`. A fragment is
never sent to a server, stays out of `Referer`, and never reaches an access log.
`client.js` reads it as it loads and calls `history.replaceState` in the same tick,
so it never lingers in the address bar or in a URL the user might share, then
offers it to the app exactly once through `takeHandoffToken()`. A token that is
expired, malformed, or not a record auth token (PocketBase 0.23+ marks those
`type: "auth"`) is dropped, and `handoffProblem()` says which, so the app can show
something better than "sign in required" again. An app receiving a token should
call `authRefresh()` with it, which fills in the record and confirms the server
still accepts the token.

Anything on `HANDOFF_ORIGINS` can obtain the signed-in user's session with no
further prompt, since an already-signed-in visit redirects straight back. Keep the
list short and limited to apps under your control. `?logout=1` never carries a
session back.

`getSession()` resolves to `null` when signed out, rejects on bridge/network
failure, and rejects immediately on a non-bridge origin; callers should
distinguish failure from a confirmed sign-out. `canBridge()` and `canHandoff()`
report which path an origin is on.

`loginUrl(returnUrl)` and `logoutUrl(returnUrl)` accept only absolute URLs on an
allowlisted origin, and strip any `joe_session` already present so a stale token
cannot round-trip. The accounts page enforces the same allowlist for its
`redirect` parameter. A visit with `?logout=1&redirect=...` clears the central
session before returning to the app. Apps should recheck `getSession()` on load
and when a tab regains focus. The new client removes the previous broad
`joe_mt_users_auth` cookie when it loads; the accounts page leaves that cookie
alone so older app deployments can continue working during rollout.

## Tests

```sh
node --test tests/client.test.mjs
```

Covers the fragment handoff: read once, stripped before app code runs, unrelated
fragments preserved, expired tokens refused, and non-allowlisted origins ignored.
The Pages workflow copies a fixed file list, so `tests/` is never published.

PocketBase auth tokens are stateless. Signing out removes the browser copies but
does not immediately revoke any token that was already issued.

## Publishing

The workflow stages only the public HTML, JavaScript, and `CNAME` files for its
GitHub Pages artifact on pushes to `main`. In the repository's **Settings → Pages**, select **GitHub Actions** as the
publishing source and configure `accounts.joe.mt` as the custom domain. The
`CNAME` file is included in the artifact, but GitHub still requires the domain
setting and DNS to be configured separately. Publish this site before switching
the apps to its client.
