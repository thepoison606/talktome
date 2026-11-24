(() => {
  let paletteRequest;
  let colorOverrides = {};

  function loadPalette() {
    paletteRequest ||= fetch('/targetColors.json').then(response => {
      if (!response.ok) throw new Error('Could not load colors');
      return response.json();
    }).catch(error => {
      paletteRequest = null;
      throw error;
    });
    return paletteRequest;
  }

  function setTargetColors(colors = {}) {
    const style = document.documentElement.style;
    for (const key of Object.keys(colorOverrides)) {
      style.removeProperty(`--palette-${key.slice(1)}`);
      style.removeProperty(`--palette-foreground-${key.slice(1)}`);
      style.removeProperty(`--palette-icon-filter-${key.slice(1)}`);
    }
    colorOverrides = colors;
    for (const [key, value] of Object.entries(colors)) {
      if (/^#[0-9a-f]{6}$/.test(key) && /^#[0-9a-f]{6}$/.test(value)) {
        style.setProperty(`--palette-${key.slice(1)}`, value);
        const [r, g, b] = value.slice(1).match(/../g).map(hex => {
          const channel = parseInt(hex, 16) / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        const light = .2126 * r + .7152 * g + .0722 * b > .179;
        style.setProperty(`--palette-foreground-${key.slice(1)}`, light ? '#000' : '#fff');
        if (light) style.setProperty(`--palette-icon-filter-${key.slice(1)}`, 'brightness(0)');
      }
    }
  }

  function applyColor(element, color) {
    if (/^#[0-9a-f]{6}$/.test(color || '')) {
      element.style.setProperty('--target-color', `var(--palette-${color.slice(1)}, ${color})`);
      element.style.setProperty('--target-foreground', `var(--palette-foreground-${color.slice(1)})`);
      element.style.setProperty('--target-icon-filter', `var(--palette-icon-filter-${color.slice(1)})`);
      element.style.setProperty('--custom-target-opacity', '.8');
      element.style.setProperty('--offline-target-tint', 'linear-gradient(#0b112080, #0b112080)');
    } else {
      element.style.removeProperty('--target-color');
      element.style.removeProperty('--target-foreground');
      element.style.removeProperty('--target-icon-filter');
      element.style.removeProperty('--custom-target-opacity');
      element.style.removeProperty('--offline-target-tint');
    }
  }

  function createRemoveButton(name, onRemove, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = `Remove ${name}`;
    button.setAttribute('aria-label', button.title);
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
    button.addEventListener('click', onRemove);
    return button;
  }

  function createPaletteButton(label, className = 'target-color-button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = label;
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-haspopup', 'dialog');
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 12a9 9 0 1 0-9 9h1.2a1.8 1.8 0 0 0 1.3-3.1 1.7 1.7 0 0 1 1.2-2.9H18a3 3 0 0 0 3-3Z"/><circle cx="7.5" cy="12" r=".8"/><circle cx="10" cy="7.8" r=".8"/><circle cx="15" cy="7.8" r=".8"/><circle cx="17.5" cy="11.5" r=".8"/></svg>';
    return button;
  }

  function createColorButton(target, saveColor, { admin = false, preview = null } = {}) {
    const button = createPaletteButton(`Change color for ${target.name}`);
    applyColor(button, target.color);
    if (preview) applyColor(preview, target.color);
    let saving = false;
    button.addEventListener('click', (event) => {
      if (saving) return;
      void openPicker(button, target.name, (dialog, options, status) => renderTargetPicker(dialog, options, status, target, async (color) => {
        saving = true;
        try {
          await saveColor(color);
          target.color = color;
          applyColor(button, color);
          if (preview) applyColor(preview, color);
        } finally {
          saving = false;
        }
      }), admin, event.detail > 0);
    });
    return button;
  }

  async function openPicker(button, title, render, admin, lastInputWasPointer, action) {
    const dialog = document.createElement('dialog');
    const panel = action ? 'form' : 'div';
    let saving = false;
    dialog.className = 'target-color-dialog';
    dialog.classList.add(admin ? 'target-color-dialog--admin' : 'client-dialog');
    dialog.setAttribute('aria-labelledby', 'target-color-heading');
    dialog.setAttribute('closedby', 'any');
    if (!('closedBy' in dialog)) {
      const onBackdrop = (event) => {
        if (event.target !== dialog) return false;
        const rect = dialog.getBoundingClientRect();
        return event.clientX < rect.left || event.clientX > rect.right
          || event.clientY < rect.top || event.clientY > rect.bottom;
      };
      let startedOutside = false;
      dialog.addEventListener('pointerdown', event => { startedOutside = onBackdrop(event); });
      dialog.addEventListener('click', event => {
        if (startedOutside && onBackdrop(event) && !saving) dialog.close();
      });
    }
    dialog.innerHTML = `
      <${panel} class="${admin ? 'admin-action-dialog__panel' : ''}">
        <header class="${admin ? 'user-audio-settings-dialog__header' : 'client-dialog__header'}">
          <h2 id="target-color-heading" tabindex="-1" autofocus></h2>
          <button class="target-color-close ${admin ? 'user-audio-settings-dialog__close' : 'client-dialog__close'}"
            type="button" aria-label="Close color picker">×</button>
        </header>
        <fieldset class="target-color-options"${action ? ' aria-label="Palette"' : ''} disabled>
          ${action ? '' : '<legend class="target-color-legend">Target color</legend>'}
        </fieldset>
        <p class="target-color-status" role="status">Loading colors…</p>
      </${panel}>
    `;
    dialog.querySelector('h2').textContent = title;
    const options = dialog.querySelector('fieldset');
    const status = dialog.querySelector('[role="status"]');
    const closeButton = dialog.querySelector('.target-color-close');
    closeButton.addEventListener('click', () => dialog.close());
    const setSaving = value => {
      saving = value;
      closeButton.disabled = value;
      dialog.setAttribute('closedby', value ? 'none' : 'any');
    };
    dialog.addEventListener('cancel', event => {
      if (saving) event.preventDefault();
    });
    dialog.addEventListener('pointerdown', () => { lastInputWasPointer = true; });
    dialog.addEventListener('keydown', () => { lastInputWasPointer = false; });
    dialog.addEventListener('close', () => {
      if (lastInputWasPointer && document.activeElement === button) button.blur();
      dialog.remove();
    }, { once: true });
    button.focus({ preventScroll: true });
    (button.closest('.settings-panel') || document.body).append(dialog);
    dialog.showModal();

    try {
      if (action) {
        const form = dialog.querySelector('form');
        form.method = 'post';
        form.action = action;
        form.setAttribute('aria-labelledby', 'target-color-heading');
      }
      await render(dialog, options, status, setSaving);
    } catch (error) {
      status.textContent = error.message;
    }
  }

  async function renderTargetPicker(dialog, options, status, target, saveColor) {
    const palette = await loadPalette();
    if (!dialog.open) return;
    for (const { name, value } of [{ name: 'None', value: null }, ...palette]) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'target-color-swatch';
      swatch.setAttribute('aria-label', name);
      swatch.setAttribute('aria-pressed', String((target.color ?? null) === value));
      if (value === null && target.color != null) swatch.textContent = name;
      applyColor(swatch, value);
      swatch.addEventListener('click', async () => {
        options.disabled = true;
        status.textContent = 'Saving…';
        try {
          await saveColor(value);
          if (dialog.open) dialog.close();
        } catch (error) {
          options.disabled = false;
          status.textContent = error.message || 'Could not save target color';
          if (dialog.open) swatch.focus();
        }
      });
      options.append(swatch);
    }
    options.disabled = false;
    status.textContent = '';
  }

  function createAppearanceButton(action, loadAppearance, saveAppearance) {
    const title = 'Target colors';
    const button = createPaletteButton(title, 'default-client-setting-field target-appearance-button');
    const label = document.createElement('span');
    label.textContent = title;
    button.prepend(label);
    button.addEventListener('click', event => {
      void openPicker(button, title, async (dialog, options, status, setSaving) => {
        const [palette, appearance = {}] = await Promise.all([loadPalette(), loadAppearance()]);
        if (!dialog.open) return;
        const form = dialog.querySelector('form');
        const none = document.createElement('span');
        none.className = 'target-color-none';
        none.textContent = 'None';
        options.append(none);
        for (const { name, value } of palette) {
          const input = document.createElement('input');
          input.type = 'color';
          input.name = value;
          input.value = appearance.colors?.[value] ?? value;
          input.setAttribute('aria-label', name);
          options.append(input);
        }
        const controls = document.createElement('div');
        controls.className = 'admin-action-dialog__actions';
        controls.innerHTML = `
          <button type="submit" value="reset" class="admin-action-dialog__cancel">Reset to defaults</button>
          <button type="submit" class="admin-action-dialog__confirm">Save</button>
        `;
        const buttons = controls.querySelectorAll('button');
        status.before(controls);
        options.disabled = false;
        status.textContent = '';
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const reset = event.submitter?.value === 'reset';
          const fields = new FormData(form);
          const colors = reset ? {} : Object.fromEntries(palette.map(({ value }) => [value, fields.get(value)]));
          options.disabled = true;
          buttons.forEach(button => { button.disabled = true; });
          setSaving(true);
          status.textContent = 'Saving…';
          try {
            await saveAppearance({ colors });
            dialog.close();
          } catch (error) {
            status.textContent = error.message || 'Could not save colors';
          } finally {
            options.disabled = false;
            buttons.forEach(button => { button.disabled = false; });
            setSaving(false);
            if (dialog.open) event.submitter?.focus();
          }
        });
      }, true, event.detail > 0, action);
    });
    return button;
  }

  const appearance = window.TALKTOME_DEFAULT_CLIENT_SETTINGS?.targetAppearance;
  if (appearance) {
    setTargetColors(appearance.colors);
    document.body.classList.toggle('keep-target-background', appearance.keepBackgroundWhileTalking === true);
  }

  window.targetEditor = { applyColor, createColorButton, createRemoveButton, createAppearanceButton, setTargetColors };
})();
