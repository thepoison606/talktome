(() => {
  let paletteRequest;

  function applyColor(element, color) {
    if (/^#[0-9a-f]{6}$/.test(color || '')) {
      element.style.setProperty('--target-color', color);
      element.style.setProperty('--custom-target-opacity', '.8');
      element.style.setProperty('--offline-target-tint', 'linear-gradient(#0b112080, #0b112080)');
    } else {
      element.style.removeProperty('--target-color');
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

  function createColorButton(target, saveColor, { admin = false, preview = null } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'target-color-button';
    button.title = `Change color for ${target.name}`;
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-haspopup', 'dialog');
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 12a9 9 0 1 0-9 9h1.2a1.8 1.8 0 0 0 1.3-3.1 1.7 1.7 0 0 1 1.2-2.9H18a3 3 0 0 0 3-3Z"/><circle cx="7.5" cy="12" r=".8"/><circle cx="10" cy="7.8" r=".8"/><circle cx="15" cy="7.8" r=".8"/><circle cx="17.5" cy="11.5" r=".8"/></svg>';
    applyColor(button, target.color);
    if (preview) applyColor(preview, target.color);
    let saving = false;
    button.addEventListener('click', (event) => {
      if (saving) return;
      void openPicker(button, target, async (color) => {
        saving = true;
        try {
          await saveColor(color);
          target.color = color;
          applyColor(button, color);
          if (preview) applyColor(preview, color);
        } finally {
          saving = false;
        }
      }, admin, event.detail > 0);
    });
    return button;
  }

  async function openPicker(button, target, saveColor, admin, lastInputWasPointer) {
    const dialog = document.createElement('dialog');
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
        if (startedOutside && onBackdrop(event)) dialog.close();
      });
    }
    dialog.innerHTML = `
      <div class="${admin ? 'admin-action-dialog__panel' : ''}">
        <header class="${admin ? 'user-audio-settings-dialog__header' : 'client-dialog__header'}">
          <h2 id="target-color-heading" tabindex="-1" autofocus></h2>
          <button class="target-color-close ${admin ? 'user-audio-settings-dialog__close' : 'client-dialog__close'}"
            type="button" aria-label="Close color picker">×</button>
        </header>
        <fieldset class="target-color-options" disabled>
          <legend class="target-color-legend">Target color</legend>
        </fieldset>
        <p class="target-color-status" role="status">Loading colors…</p>
      </div>
    `;
    dialog.querySelector('h2').textContent = target.name;
    const options = dialog.querySelector('fieldset');
    const status = dialog.querySelector('[role="status"]');
    dialog.querySelector('.target-color-close').addEventListener('click', () => dialog.close());
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
      paletteRequest ||= fetch('/targetColors.json').then(response => {
        if (!response.ok) throw new Error('Could not load colors');
        return response.json();
      }).catch(error => {
        paletteRequest = null;
        throw error;
      });
      const palette = await paletteRequest;
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
    } catch (error) {
      status.textContent = error.message;
    }
  }

  window.targetEditor = { applyColor, createColorButton, createRemoveButton };
})();
