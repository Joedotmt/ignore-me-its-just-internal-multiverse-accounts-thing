(function (global) {
  'use strict';

  const { pb, allowedReturnUrl, usersSession, verifiedSession } = global.JoeAccountsCore;
  const $ = (id) => global.document.getElementById(id);
  const params = new URLSearchParams(global.location.search);
  const rawRedirect = params.get('redirect');
  const redirect = allowedReturnUrl(rawRedirect);
  let mode = 'sign-in';
  let otpId = null;
  let busy = false;

  function status(message, error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  }

  function setBusy(value, message = '') {
    busy = value;
    for (const button of global.document.querySelectorAll('button')) button.disabled = value;
    if (message) status(message);
  }

  function show(view) {
    for (const id of ['signed-out', 'code-view', 'signed-in']) $(id).hidden = id !== view;
  }

  function showSignedIn(session) {
    const record = session.record;
    $('account-name').textContent = record.name || record.email || record.username || record.id;
    show('signed-in');
    if (redirect) {
      $('destination-in').textContent = `Continue to ${new URL(redirect).hostname}`;
      $('destination-in').hidden = false;
      $('continue-link').href = redirect;
      $('continue-link').hidden = false;
    }
  }

  function finishSignIn() {
    const session = usersSession();
    if (!session) throw new Error('PocketBase did not return a user session.');
    if (redirect) {
      global.location.assign(redirect);
      return;
    }
    showSignedIn(session);
    status('Signed in.');
  }

  function selectMode(next) {
    mode = next;
    $('sign-in-mode').setAttribute('aria-pressed', String(next === 'sign-in'));
    $('create-mode').setAttribute('aria-pressed', String(next === 'create'));
    $('email-submit').textContent = next === 'create' ? 'Create account and send code' : 'Send sign-in code';
    status('');
  }

  $('sign-in-mode').addEventListener('click', () => selectMode('sign-in'));
  $('create-mode').addEventListener('click', () => selectMode('create'));
  $('code-back').addEventListener('click', () => { otpId = null; show('signed-out'); status(''); });

  for (const button of global.document.querySelectorAll('[data-provider]')) {
    button.addEventListener('click', async () => {
      if (busy) return;
      setBusy(true, `Connecting to ${button.textContent.replace('Continue with ', '')}…`);
      try {
        await pb.collection('users').authWithOAuth2({ provider: button.dataset.provider });
        finishSignIn();
      } catch (_) {
        status('Sign-in did not complete. Please try again.', true);
      } finally {
        setBusy(false);
      }
    });
  }

  $('email-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const email = $('email').value.trim();
    if (!email) return;
    setBusy(true, 'Sending a code…');
    try {
      if (mode === 'create') {
        const bytes = new Uint8Array(24);
        global.crypto.getRandomValues(bytes);
        const password = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        await pb.collection('users').create({ email, password, passwordConfirm: password });
      }
      const response = await pb.collection('users').requestOTP(email);
      otpId = response.otpId;
      $('code-email').textContent = email;
      show('code-view');
      $('code').focus();
      status('Code sent.');
    } catch (_) {
      status(mode === 'create'
        ? 'Could not create this account. If it already exists, choose Sign in.'
        : 'Could not send a code. Check the email or choose Create account.', true);
    } finally {
      setBusy(false);
    }
  });

  $('code-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !otpId) return;
    setBusy(true, 'Verifying…');
    try {
      await pb.collection('users').authWithOTP(otpId, $('code').value.trim());
      finishSignIn();
    } catch (_) {
      status('The code is incorrect or has expired. Please try again.', true);
    } finally {
      setBusy(false);
    }
  });

  $('sign-out').addEventListener('click', () => {
    pb.authStore.clear();
    show('signed-out');
    status('Signed out.');
  });

  async function initialize() {
    if (rawRedirect && !redirect) status('The requested return address is not supported.', true);
    if (redirect) {
      $('destination-out').textContent = `Continue to ${new URL(redirect).hostname} after sign-in`;
      $('destination-out').hidden = false;
    }

    if (params.get('logout') === '1') {
      pb.authStore.clear();
      global.history.replaceState(null, '', global.location.pathname);
      if (redirect) {
        global.location.replace(redirect);
        return;
      }
      show('signed-out');
      status('Signed out.');
      return;
    }

    if (!usersSession()) {
      pb.authStore.clear();
      show('signed-out');
      return;
    }

    show('signed-out');
    status('Checking your session…');
    try {
      const session = await verifiedSession();
      if (session) {
        if (redirect) global.location.replace(redirect);
        else { showSignedIn(session); status(''); }
      } else {
        status('Your session expired. Please sign in again.');
      }
    } catch (_) {
      status('Could not check your session. Please try again later.', true);
    }
  }

  initialize();
})(window);
