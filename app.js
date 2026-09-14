(function (global) {
  'use strict';

  const {
    pb,
    allowedReturnUrl,
    needsSessionHandoff,
    returnUrlWithSession,
    usersSession,
    verifiedSession
  } = global.JoeAccountsCore;
  const params = new URLSearchParams(global.location.search);
  const rawRedirect = params.get('redirect');
  const redirectTo = allowedReturnUrl(rawRedirect);

  const loadingIndicator = document.getElementById('loading-indicator');
  const wizardSteps = document.getElementById('wizard-steps');
  const wizardActions = document.getElementById('wizard-actions');
  const wizardBackBtn = document.getElementById('wizard-back-btn');
  const wizardNextBtn = document.getElementById('wizard-next-btn');
  const signInBtn = document.getElementById('signin-btn');
  const createAccountBtn = document.getElementById('create-account-btn');
  const authMethodEmailBtn = document.getElementById('auth-method-email-btn');
  const authMethodGoogleBtn = document.getElementById('auth-method-google-btn');
  const authMethodGithubBtn = document.getElementById('auth-method-github-btn');
  const authMethodDiscordBtn = document.getElementById('auth-method-discord-btn');
  const authMethodError = document.getElementById('auth-method-error');
  const emailEntryForm = document.getElementById('email-entry-form');
  const emailInput = document.getElementById('email-input');
  const emailEntryError = document.getElementById('email-entry-error');
  const otpCodeInput = document.getElementById('otp-code');
  const otpEmailDisplay = document.getElementById('otp-email-display');
  const otpError = document.getElementById('otp-error');
  const messageModal = document.getElementById('message-modal');
  const messageModalTitle = document.getElementById('message-modal-title');
  const messageModalText = document.getElementById('message-modal-text');

  const steps = {
    initial: 0,
    authMethod: 1,
    emailEntry: 2,
    otp: 3,
    success: 4,
  };

  let currentStep = steps.initial;
  let isNewUserFlow = false;
  let otpId = null;
  let busy = false;

  function setActiveStepInteractivity(activeIndex) {
    document.querySelectorAll('.wizard-step').forEach((stepElement, index) => {
      const focusables = Array.from(
        stepElement.querySelectorAll('a, button, input, select, textarea, [tabindex]')
      );

      if (index === activeIndex) {
        stepElement.classList.remove('step-inactive');
        stepElement.removeAttribute('aria-hidden');
        stepElement.inert = false;
        stepElement.removeAttribute('inert');
        focusables.forEach((element) => {
          if (element.dataset.originalTabindex !== undefined) {
            element.setAttribute('tabindex', element.dataset.originalTabindex);
            delete element.dataset.originalTabindex;
          } else if (element.getAttribute('tabindex') === '-1') {
            element.removeAttribute('tabindex');
          }
        });
        return;
      }

      stepElement.classList.add('step-inactive');
      stepElement.setAttribute('aria-hidden', 'true');
      stepElement.inert = true;
      stepElement.setAttribute('inert', '');
      focusables.forEach((element) => {
        if (element.hasAttribute('tabindex')) {
          element.dataset.originalTabindex = element.getAttribute('tabindex');
        }
        element.setAttribute('tabindex', '-1');
      });
    });
  }

  function updateWizardActions(stepIndex) {
    wizardActions.classList.remove('hidden');
    wizardBackBtn.classList.remove('hidden');
    wizardNextBtn.classList.remove('hidden');
    wizardNextBtn.onclick = null;

    switch (stepIndex) {
      case steps.initial:
        wizardBackBtn.classList.add('hidden');
        wizardNextBtn.classList.add('hidden');
        break;
      case steps.authMethod:
        wizardNextBtn.classList.add('hidden');
        break;
      case steps.emailEntry:
        wizardNextBtn.textContent = 'Send Code';
        wizardNextBtn.onclick = () => emailEntryForm.requestSubmit();
        break;
      case steps.otp:
        wizardNextBtn.textContent = 'Verify & Sign In';
        wizardNextBtn.onclick = handleOtpSubmit;
        break;
      case steps.success:
        wizardActions.classList.add('hidden');
        break;
    }
  }

  function goToStep(stepIndex) {
    currentStep = stepIndex;
    wizardSteps.style.transform = `translateX(-${stepIndex * 100}%)`;
    updateWizardActions(stepIndex);
    setActiveStepInteractivity(stepIndex);
  }

  function showModal(modal) {
    modal.classList.remove('hidden');
  }

  function hideModal(modal) {
    modal.classList.add('hidden');
  }

  function setBusy(value) {
    busy = value;
    if (value) showModal(loadingIndicator);
    else hideModal(loadingIndicator);
  }

  function clearError(element) {
    element.textContent = '';
    element.classList.add('hidden');
  }

  function showErrorInStep(element, message) {
    element.textContent = message;
    element.classList.remove('hidden');
  }

  function showMessage(title, message) {
    messageModalTitle.textContent = title;
    messageModalText.textContent = message;
    showModal(messageModal);
  }

  global.hideMessageModal = () => hideModal(messageModal);

  /**
   * Sends the user back to the app they came from. A same-site app reads the session
   * from this origin through the bridge, so it gets a plain URL; a cross-site app
   * cannot, so the session travels in the fragment instead.
   */
  function returnToApp(replace) {
    const session = usersSession();
    const target = needsSessionHandoff(redirectTo) && session
      ? returnUrlWithSession(redirectTo, session.token)
      : redirectTo;
    if (replace) global.location.replace(target);
    else global.location.assign(target);
  }

  function finishSignIn() {
    if (!usersSession()) throw new Error('PocketBase did not return a user session.');
    if (redirectTo) {
      returnToApp(false);
      return;
    }
    goToStep(steps.success);
  }

  async function updateAccountName(authData, provider) {
    const record = pb.authStore.record;
    const name = provider === 'discord'
      ? authData.meta?.name || authData.meta?.username
      : authData.meta?.name;
    if (!record?.id || !name) return;

    try {
      const updatedRecord = await pb.collection('users').update(record.id, { name });
      pb.authStore.save(pb.authStore.token, { ...record, ...updatedRecord });
    } catch (error) {
      console.warn('Signed in, but could not update the account name:', error);
    }
  }

  async function signInWithProvider(provider, label) {
    if (busy) return;
    clearError(authMethodError);
    setBusy(true);
    try {
      const authData = await pb.collection('users').authWithOAuth2({ provider });
      await updateAccountName(authData, provider);
      finishSignIn();
    } catch (error) {
      const message = error?.message === 'Failed to create record.' && !isNewUserFlow
        ? 'No account found with this email. Please create a new account.'
        : `Could not authenticate with ${label}. ${error?.message || 'Please try again.'}`;
      showErrorInStep(authMethodError, message);
    } finally {
      setBusy(false);
    }
  }

  signInBtn.addEventListener('click', () => {
    isNewUserFlow = false;
    clearError(authMethodError);
    goToStep(steps.authMethod);
  });

  createAccountBtn.addEventListener('click', () => {
    isNewUserFlow = true;
    clearError(authMethodError);
    goToStep(steps.authMethod);
  });

  authMethodEmailBtn.addEventListener('click', () => {
    clearError(emailEntryError);
    goToStep(steps.emailEntry);
    emailInput.focus();
  });
  authMethodGoogleBtn.addEventListener('click', () => signInWithProvider('google', 'Google'));
  authMethodGithubBtn.addEventListener('click', () => signInWithProvider('github', 'GitHub'));
  authMethodDiscordBtn.addEventListener('click', () => signInWithProvider('discord', 'Discord'));

  emailEntryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const email = emailInput.value.trim();
    if (!email) return;

    clearError(emailEntryError);
    setBusy(true);
    try {
      try {
        const response = await fetch(`${pb.baseUrl}/api/check-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, collection: 'users' }),
        });
        if (response.ok) {
          const result = await response.json();
          if (isNewUserFlow && result.exists) {
            showErrorInStep(
              emailEntryError,
              'An account with this email already exists. Please sign in instead.'
            );
            return;
          }
          if (!isNewUserFlow && !result.exists) {
            showErrorInStep(
              emailEntryError,
              'No account found with this email. Please create a new account.'
            );
            return;
          }
        }
      } catch (error) {
        console.info('Email availability check was unavailable; continuing with OTP.', error);
      }

      if (isNewUserFlow) {
        const passwordBytes = new Uint8Array(24);
        global.crypto.getRandomValues(passwordBytes);
        const randomPassword = Array.from(
          passwordBytes,
          (byte) => byte.toString(16).padStart(2, '0')
        ).join('');
        await pb.collection('users').create({
          email,
          password: randomPassword,
          passwordConfirm: randomPassword,
          emailVisibility: true,
        });
      }

      const otpRequest = await pb.collection('users').requestOTP(email);
      otpId = otpRequest.otpId;
      otpEmailDisplay.textContent = email;
      otpCodeInput.value = '';
      clearError(otpError);
      goToStep(steps.otp);
      otpCodeInput.focus();
    } catch (error) {
      const message = isNewUserFlow
        ? 'Could not create this account. If it already exists, go back and choose sign in.'
        : `Could not send a sign-in code. ${error?.message || 'Please try again.'}`;
      showErrorInStep(emailEntryError, message);
    } finally {
      setBusy(false);
    }
  });

  async function handleOtpSubmit() {
    if (busy) return;
    const otp = otpCodeInput.value.trim();
    if (!otpId || !otp) {
      showErrorInStep(otpError, 'Please enter the code from your email.');
      return;
    }

    clearError(otpError);
    setBusy(true);
    try {
      await pb.collection('users').authWithOTP(otpId, otp);
      finishSignIn();
    } catch (_) {
      showErrorInStep(
        otpError,
        'The provided code is incorrect or has expired. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  otpCodeInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handleOtpSubmit();
  });

  wizardBackBtn.addEventListener('click', () => {
    switch (currentStep) {
      case steps.authMethod:
        goToStep(steps.initial);
        break;
      case steps.emailEntry:
        goToStep(steps.authMethod);
        break;
      case steps.otp:
        otpId = null;
        goToStep(steps.emailEntry);
        break;
    }
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    pb.authStore.clear();
    otpId = null;
    goToStep(steps.initial);
  });

  async function initializeApp() {
    goToStep(steps.initial);
    document.getElementById('current-year').textContent = new Date().getFullYear();
    document.getElementById('pb-url-display').textContent = pb.baseUrl;

    if (params.get('logout') === '1') {
      pb.authStore.clear();
      global.history.replaceState(null, '', global.location.pathname);
      if (redirectTo) {
        // Signed out, so there is deliberately no session to hand back.
        global.location.replace(redirectTo);
        return;
      }
      return;
    }

    if (rawRedirect && !redirectTo) {
      showMessage(
        'Return link blocked',
        'For your security, this sign-in page can only return to approved apps.'
      );
    }

    if (!usersSession()) {
      pb.authStore.clear();
      return;
    }

    setBusy(true);
    try {
      const session = await verifiedSession();
      if (!session) {
        showMessage('Session expired', 'Please sign in again.');
        return;
      }
      if (redirectTo) {
        returnToApp(true);
        return;
      }
      goToStep(steps.success);
    } catch (_) {
      showMessage(
        'Could not check your account',
        'The account service could not verify your session. Please try again later.'
      );
    } finally {
      setBusy(false);
    }
  }

  initializeApp();
})(window);
