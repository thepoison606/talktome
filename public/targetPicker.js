(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TalktomeTargetPicker = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  let activeDialog = null;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[char]);
  const decode = value => { try { return JSON.parse(value || '[]'); } catch { return []; } };

  function render(options, selected) {
    const values = [...new Set(selected)];
    const byValue = new Map(options.map(option => [option.value, option]));
    return `<div class="tt-target-picker__values" data-target-picker-values="${escape(JSON.stringify(values))}">
      ${values.length ? values.map(value => `<span class="tt-target-picker__chip" title="${escape(byValue.get(value)?.label || value)}">
        <span>${escape(byValue.get(value)?.label || value)}</span>
        <button type="button" class="tt-target-picker__remove" data-target-picker-remove="${escape(value)}" aria-label="${escape(`Remove ${byValue.get(value)?.label || value}`)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </span>`).join('') : '<button type="button" class="tt-target-picker__empty" data-target-picker-edit>No targets selected</button>'}
      <button type="button" class="tt-target-picker__edit" data-target-picker-edit aria-label="Add targets" title="Add targets"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
    </div>`;
  }

  function read(container) {
    return decode(container?.querySelector('[data-target-picker-values]')?.dataset.targetPickerValues);
  }

  function mount(container, options, selected, onChange = () => {}) {
    if (activeDialog?.container === container) return;
    container.classList.add('tt-target-picker');
    const update = values => { container.innerHTML = render(options, values); };
    update(selected);
    // The container survives selection updates; replacing this handler avoids stale catalogs.
    container.onclick = event => {
      const remove = event.target.closest('[data-target-picker-remove]');
      if (remove) {
        const values = read(container).filter(value => value !== remove.dataset.targetPickerRemove);
        update(values);
        container.querySelector('[data-target-picker-edit]')?.focus();
        onChange(values);
      } else if (event.target.closest('[data-target-picker-edit]')) {
        open(container, options, values => { update(values); onChange(values); });
      }
    };
  }

  function open(container, options, apply) {
    if (activeDialog) return;
    const document = container.ownerDocument;
    const selected = new Set(read(container));
    const dialog = document.createElement('dialog');
    dialog.className = 'tt-target-dialog';
    dialog.setAttribute('aria-label', 'Talk targets');
    dialog.innerHTML = `<div class="tt-target-dialog__header">
        <h2>Talk targets</h2>
        <button type="button" class="tt-target-dialog__close" aria-label="Cancel target selection">&times;</button>
      </div>
      <div class="tt-target-dialog__filters">
        <input class="tt-target-dialog__search" type="search" placeholder="Search targets" aria-label="Search targets" autocomplete="off">
      </div>
      <div class="tt-target-dialog__list"></div>
      <div class="tt-target-dialog__footer">
        <button type="button" class="tt-target-dialog__clear">Clear selection</button>
        <div><button type="button" class="tt-target-dialog__cancel">Cancel</button>
        <button type="button" class="tt-target-dialog__apply">Apply</button></div>
      </div>`;
    const list = dialog.querySelector('.tt-target-dialog__list');
    const search = dialog.querySelector('input[type="search"]');
    const applyButton = dialog.querySelector('.tt-target-dialog__apply');
    const updateCount = () => { applyButton.textContent = `Apply (${selected.size})`; };
    const renderList = () => {
      const query = search.value.trim().toLocaleLowerCase();
      const visible = options.filter(option => `${option.label} ${option.type}`.toLocaleLowerCase().includes(query));
      list.innerHTML = ['conference', 'user'].map(type => {
        const group = visible.filter(option => option.type === type);
        if (!group.length) return '';
        return `<section class="tt-target-dialog__group"><h3>${type === 'conference' ? 'Conferences' : 'Users'}</h3>
          ${group.map(option => `<label class="tt-target-dialog__option">
            <input type="checkbox" value="${escape(option.value)}" ${selected.has(option.value) ? 'checked' : ''}>
            <span>${escape(option.label)}${option.unavailable ? '<small>Saved, unavailable</small>' : ''}</span>
          </label>`).join('')}</section>`;
      }).join('') || '<p class="tt-target-dialog__empty">No matching targets</p>';
    };
    const previousOverflow = document.body.style.overflow;
    const close = accepted => {
      dialog.close();
      dialog.remove();
      document.body.style.overflow = previousOverflow;
      activeDialog = null;
      if (accepted && container.isConnected) apply([...selected]);
      container.querySelector('[data-target-picker-edit]')?.focus();
    };
    search.addEventListener('input', renderList);
    list.addEventListener('change', event => {
      const checkbox = event.target;
      if (!checkbox.matches('input[type="checkbox"]')) return;
      if (checkbox.checked) selected.add(checkbox.value); else selected.delete(checkbox.value);
      updateCount();
      // Keep rows in place while selecting.
    });
    dialog.querySelector('.tt-target-dialog__clear').onclick = () => { selected.clear(); renderList(); updateCount(); };
    dialog.querySelector('.tt-target-dialog__close').onclick = () => close(false);
    dialog.querySelector('.tt-target-dialog__cancel').onclick = () => close(false);
    applyButton.onclick = () => close(true);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(false); });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target === search) { event.preventDefault(); applyButton.click(); }
    });
    document.body.appendChild(dialog);
    activeDialog = { container };
    document.body.style.overflow = 'hidden';
    renderList(); updateCount(); dialog.showModal(); search.focus();
  }

  return Object.freeze({ mount, read, isOpen: () => Boolean(activeDialog) });
}));
