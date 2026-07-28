function numericAttribute(input: HTMLInputElement, name: 'min' | 'max'): number | null {
  const value = input.getAttribute(name);
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fallbackStep(input: HTMLInputElement, direction: 1 | -1): void {
  const stepAttribute = input.getAttribute('step');
  const parsedStep = stepAttribute && stepAttribute !== 'any' ? Number(stepAttribute) : 1;
  const step = Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 1;
  const current = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0;
  const min = numericAttribute(input, 'min');
  const max = numericAttribute(input, 'max');
  const precision = Math.min(12, Math.max(
    (String(current).split('.')[1] ?? '').length,
    (String(step).split('.')[1] ?? '').length,
  ));
  let next = Number((current + direction * step).toFixed(precision));
  if (min !== null) next = Math.max(min, next);
  if (max !== null) next = Math.min(max, next);
  input.value = String(next);
}

function stepInput(input: HTMLInputElement, direction: 1 | -1): void {
  if (input.disabled || input.readOnly) return;
  const previous = input.value;
  try {
    if (direction > 0) input.stepUp();
    else input.stepDown();
  } catch {
    fallbackStep(input, direction);
  }
  if (input.value === previous) return;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function enhanceNumberInput(input: HTMLInputElement): void {
  if (input.dataset.q3editStepper === 'true' || input.closest('.number-input-stepper')) return;
  input.dataset.q3editStepper = 'true';
  if (!input.getAttribute('aria-label')) {
    const label = input.closest('label')?.textContent?.trim();
    if (label) input.setAttribute('aria-label', label);
  }

  const wrapper = document.createElement('span');
  wrapper.className = 'number-input-stepper';
  input.before(wrapper);
  wrapper.appendChild(input);

  const controls = document.createElement('span');
  controls.className = 'number-input-stepper-controls';
  for (const [direction, markup, label] of [
    [1, '<i class="ph ph-caret-up" aria-hidden="true"></i>', 'Increase value'],
    [-1, '<i class="ph ph-caret-down" aria-hidden="true"></i>', 'Decrease value'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'number-input-stepper-button';
    button.tabIndex = -1;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = markup;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      input.focus();
      stepInput(input, direction);
    });
    controls.appendChild(button);
  }
  wrapper.appendChild(controls);

  const syncDisabledState = () => {
    const disabled = input.disabled || input.readOnly;
    for (const button of controls.querySelectorAll('button')) button.disabled = disabled;
  };
  syncDisabledState();
  input.addEventListener('change', syncDisabledState);
}

function enhanceNumberInputs(root: ParentNode): void {
  if (root instanceof HTMLInputElement && root.type === 'number') enhanceNumberInput(root);
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="number"]')) enhanceNumberInput(input);
}

export function installNumberInputSteppers(root: HTMLElement = document.body): () => void {
  enhanceNumberInputs(root);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLInputElement) {
        const wrapper = record.target.closest('.number-input-stepper');
        if (!wrapper) continue;
        const disabled = record.target.disabled || record.target.readOnly;
        for (const button of wrapper.querySelectorAll<HTMLButtonElement>('.number-input-stepper-button')) {
          button.disabled = disabled;
        }
        continue;
      }
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement) enhanceNumberInputs(node);
      }
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled', 'readonly'],
  });
  return () => observer.disconnect();
}
