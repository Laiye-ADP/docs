(function () {
  const FIELD_SELECTOR = '[data-testid^="api-input-"]';
  const CONTROL_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
  const REQUIRED_PILL_SELECTOR = '[data-component-part="field-required-pill"]';
  const BLOCKED_ATTR = 'data-api-required-blocked';
  const BLOCKED_REASON = {
    zh: '请先填写必填项',
    en: 'Fill required fields first',
  };

  let scheduled = false;

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden'
    );
  }

  function isSendButton(element) {
    if (!(element instanceof HTMLButtonElement)) {
      return false;
    }

    const label = (element.getAttribute('aria-label') || element.textContent || '').trim();

    return /^(发送|Send)$/i.test(label);
  }

  function hasRequiredPill(field) {
    return Array.from(field.querySelectorAll(REQUIRED_PILL_SELECTOR)).some((pill) =>
      /必填|required/i.test(pill.textContent || '')
    );
  }

  function directControls(field) {
    return Array.from(field.querySelectorAll(CONTROL_SELECTOR)).filter(
      (control) =>
        control.closest(FIELD_SELECTOR) === field &&
        !control.disabled &&
        isVisible(control)
    );
  }

  function hasVisibleNestedField(field) {
    return Array.from(field.querySelectorAll(FIELD_SELECTOR)).some(
      (nestedField) => nestedField !== field && isVisible(nestedField)
    );
  }

  function controlHasValue(control) {
    if (control instanceof HTMLInputElement) {
      if (control.type === 'checkbox' || control.type === 'radio') {
        return control.checked;
      }

      if (control.type === 'file') {
        return control.files && control.files.length > 0;
      }
    }

    if (control instanceof HTMLSelectElement) {
      return control.value !== '';
    }

    if (control instanceof HTMLTextAreaElement || control instanceof HTMLInputElement) {
      return control.value.trim() !== '';
    }

    return (control.textContent || '').trim() !== '';
  }

  function missingRequiredFields() {
    return Array.from(document.querySelectorAll(FIELD_SELECTOR)).filter((field) => {
      if (!isVisible(field) || !hasRequiredPill(field)) {
        return false;
      }

      const controls = directControls(field);

      if (controls.length === 0) {
        return !hasVisibleNestedField(field);
      }

      return controls.some((control) => !controlHasValue(control));
    });
  }

  function preferredReason(button) {
    return /send/i.test(button.getAttribute('aria-label') || button.textContent || '')
      ? BLOCKED_REASON.en
      : BLOCKED_REASON.zh;
  }

  function updateSendButtons() {
    scheduled = false;

    const isBlocked = missingRequiredFields().length > 0;

    Array.from(document.querySelectorAll('button'))
      .filter(isSendButton)
      .forEach((button) => {
        if (!isVisible(button)) {
          return;
        }

        if (isBlocked) {
          button.disabled = true;
          button.setAttribute('aria-disabled', 'true');
          button.setAttribute(BLOCKED_ATTR, 'true');
          button.setAttribute('title', preferredReason(button));
        } else if (button.getAttribute(BLOCKED_ATTR) === 'true') {
          button.disabled = false;
          button.removeAttribute('aria-disabled');
          button.removeAttribute(BLOCKED_ATTR);
          button.removeAttribute('title');
        }
      });
  }

  function scheduleUpdate() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(updateSendButtons);
  }

  document.addEventListener(
    'click',
    (event) => {
      const button = event.target && event.target.closest && event.target.closest('button');

      if (isSendButton(button) && missingRequiredFields().length > 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        scheduleUpdate();
      }
    },
    true
  );

  document.addEventListener('input', scheduleUpdate, true);
  document.addEventListener('change', scheduleUpdate, true);
  document.addEventListener('keyup', scheduleUpdate, true);

  new MutationObserver(scheduleUpdate).observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  });

  window.addEventListener('pageshow', scheduleUpdate);
  scheduleUpdate();
})();
