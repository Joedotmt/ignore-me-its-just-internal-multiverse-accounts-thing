# Joe Accounts

Static sign-in site for `https://accounts.joe.mt`, using the PocketBase `users`
collection at `https://joemt.fly.dev`. The account page supports Google, GitHub,
Discord, and email one-time-code sign-in. PocketBase stores the central session in
this origin's local storage. No bearer token is placed in a URL or a parent-domain
cookie.

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

The client loads a hidden `accounts.joe.mt/bridge/` iframe and sends a random
nonce. The bridge only accepts requests from the exact origins `https://joe.mt`
and `https://notes.joe.mt`, refreshes the central `users` token through PocketBase,
and sends the result to that origin using `postMessage`. The client checks the
reply's origin, iframe source, nonce, and shape. `getSession()` resolves to `null`
when signed out and rejects on bridge/network failure; callers should distinguish
that failure from a confirmed sign-out. The in-memory auth store keeps the app's
copy of the token out of its `pocketbase_auth` local-storage key.

`loginUrl(returnUrl)` and `logoutUrl(returnUrl)` accept only absolute URLs on the
two allowed HTTPS origins. The accounts page also enforces that allowlist for its
`redirect` parameter. A visit with `?logout=1&redirect=...` clears the central
session before returning to the app. Apps should recheck `getSession()` on load
and when a tab regains focus. The new client removes the previous broad
`joe_mt_users_auth` cookie when it loads; the accounts page leaves that cookie
alone so older app deployments can continue working during rollout.

PocketBase auth tokens are stateless. Signing out removes the browser copies but
does not immediately revoke any token that was already issued.

## Publishing

The workflow stages only the public HTML, JavaScript, and `CNAME` files for its
GitHub Pages artifact on pushes to `main`. In the repository's **Settings → Pages**, select **GitHub Actions** as the
publishing source and configure `accounts.joe.mt` as the custom domain. The
`CNAME` file is included in the artifact, but GitHub still requires the domain
setting and DNS to be configured separately. Publish this site before switching
the apps to its client.
