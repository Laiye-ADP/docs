(function () {
  const FIELD_SELECTOR = '[data-testid^="api-input-"]';
  const CONTROL_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
  const REQUIRED_PILL_SELECTOR = '[data-component-part="field-required-pill"]';
  const BLOCKED_ATTR = 'data-api-required-blocked';
  const SHOW_CHILD_ATTRIBUTES_PATTERN = /^(Show child attributes|显示子属性)$/i;
  const REQUEST_SCHEMA_PARAM = 'request-schema';
  const REQUEST_SCHEMA_MAX_RETRIES = 80;
  const REQUEST_SCHEMA_TABS = {
    classification: [
      'tab-创建独立分类应用',
      'tab-Create standalone classification application',
    ],
  };
  const BLOCKED_REASON = {
    zh: '请先填写必填项',
    en: 'Fill required fields first',
  };

  let scheduled = false;
  let childAttributesScheduled = false;
  let requestSchemaScheduled = false;
  let requestSchemaRetryCount = 0;
  let requestSchemaRetryTimer;
  let requestSchemaLocationKey = '';
  let requestSchemaApplied = false;
  const expandedChildAttributeButtons = new WeakSet();

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

  function directFileControls(field) {
    return Array.from(field.querySelectorAll('input[type="file"]')).filter(
      (control) => control.closest(FIELD_SELECTOR) === field && !control.disabled
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

      const fileControls = directFileControls(field);
      if (fileControls.length > 0) {
        return !fileControls.some(controlHasValue);
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

  function isShowChildAttributesButton(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const label = (element.getAttribute('aria-label') || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();

    return SHOW_CHILD_ATTRIBUTES_PATTERN.test(label);
  }

  function childAttributesControls() {
    const controls = new Set();

    Array.from(document.querySelectorAll('*'))
      .filter(isShowChildAttributesButton)
      .forEach((element) => {
        controls.add(
          element.closest('button, [role="button"], [tabindex], summary') || element
        );
      });

    return Array.from(controls);
  }

  function expandChildAttributes() {
    childAttributesScheduled = false;

    childAttributesControls().forEach((control) => {
      if (expandedChildAttributeButtons.has(control)) {
        return;
      }

      expandedChildAttributeButtons.add(control);
      control.click();
    });
  }

  function scheduleChildAttributesExpansion() {
    if (childAttributesScheduled) {
      return;
    }

    childAttributesScheduled = true;
    window.requestAnimationFrame(expandChildAttributes);
  }

  function requestSchemaLocation() {
    return `${window.location.pathname}${window.location.search}`;
  }

  function requestedSchemaTab() {
    if (!window.location.pathname.endsWith('/create-extraction-application')) {
      return null;
    }

    const schema = new URLSearchParams(window.location.search).get(REQUEST_SCHEMA_PARAM);
    const testIds = REQUEST_SCHEMA_TABS[schema];

    if (!testIds) {
      return null;
    }

    return testIds
      .map((testId) => document.querySelector(`[data-testid="${testId}"]`))
      .find(Boolean);
  }

  function retryRequestSchemaSelection() {
    if (
      requestSchemaRetryTimer ||
      requestSchemaRetryCount >= REQUEST_SCHEMA_MAX_RETRIES
    ) {
      return;
    }

    requestSchemaRetryCount += 1;
    requestSchemaRetryTimer = window.setTimeout(() => {
      requestSchemaRetryTimer = undefined;
      scheduleRequestSchemaSelection();
    }, 100);
  }

  function selectRequestedSchema() {
    requestSchemaScheduled = false;

    const locationKey = requestSchemaLocation();
    if (locationKey !== requestSchemaLocationKey) {
      requestSchemaLocationKey = locationKey;
      requestSchemaRetryCount = 0;
      requestSchemaApplied = false;
    }

    if (requestSchemaApplied) {
      return;
    }

    const schema = new URLSearchParams(window.location.search).get(REQUEST_SCHEMA_PARAM);
    if (!REQUEST_SCHEMA_TABS[schema]) {
      requestSchemaApplied = true;
      return;
    }

    const label = requestedSchemaTab();
    const tab = label && label.closest('[role="tab"]');

    if (!tab || !isVisible(tab)) {
      retryRequestSchemaSelection();
      return;
    }

    if (tab.getAttribute('aria-selected') === 'true') {
      requestSchemaApplied = true;
      return;
    }

    tab.click();
    retryRequestSchemaSelection();
  }

  function scheduleRequestSchemaSelection() {
    if (requestSchemaScheduled) {
      return;
    }

    requestSchemaScheduled = true;
    window.requestAnimationFrame(selectRequestedSchema);
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

  new MutationObserver(() => {
    scheduleUpdate();
    scheduleChildAttributesExpansion();
    scheduleRequestSchemaSelection();
  }).observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  });

  window.addEventListener('pageshow', scheduleUpdate);
  window.addEventListener('pageshow', scheduleChildAttributesExpansion);
  window.addEventListener('pageshow', scheduleRequestSchemaSelection);
  window.addEventListener('popstate', scheduleRequestSchemaSelection);
  scheduleUpdate();
  scheduleChildAttributesExpansion();
  scheduleRequestSchemaSelection();
})();
