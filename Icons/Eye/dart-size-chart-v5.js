(function () {
  'use strict';

  const columns = ['size', 'chest', 'waist', 'hip', 'length', 'shoulder', 'sleeve', 'inseam', 'notes'];
  let activeModelId = '';

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
  })[character]);

  function findModel(id) {
    return typeof modelsData === 'undefined' ? null : modelsData.find(model => String(model.id) === String(id));
  }

  function normalizeSizeList(values) {
    return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, undefined, {numeric:true}));
  }

  function modelSizes(model) {
    const chart = Array.isArray(model?.sizeChart) ? model.sizeChart : model?.sizeChart?.rows;
    const fromChart = Array.isArray(chart) ? chart.map(row => row.size) : [];
    const fromItems = typeof itemsData === 'undefined' ? [] : itemsData
      .filter(item => String(item.modelId) === String(model?.modelId))
      .map(item => item.size);
    const legacy = Array.isArray(model?.sizes) ? model.sizes : String(model?.sizes || '').split(/[\s,]+/);
    return normalizeSizeList([...fromChart, ...fromItems, ...legacy]);
  }

  function emptyRow(size = '') {
    return {size, chest:'', waist:'', hip:'', length:'', shoulder:'', sleeve:'', inseam:'', notes:''};
  }

  function rowMarkup(row = emptyRow()) {
    const measurement = key => `<input type="number" inputmode="decimal" min="0.1" step="0.1" data-size-field="${key}" value="${escapeHtml(row[key] || '')}" aria-label="${key}">`;
    return `<tr class="dart-size-chart-admin-row">
      <td><input type="text" data-size-field="size" value="${escapeHtml(row.size || '')}" required aria-label="Size"></td>
      <td>${measurement('chest')}</td>
      <td>${measurement('waist')}</td>
      <td>${measurement('hip')}</td>
      <td>${measurement('length')}</td>
      <td>${measurement('shoulder')}</td>
      <td>${measurement('sleeve')}</td>
      <td>${measurement('inseam')}</td>
      <td><input type="text" data-size-field="notes" value="${escapeHtml(row.notes || '')}" aria-label="Notes"></td>
      <td><button type="button" class="dart-size-chart-remove-row" title="Remove size" aria-label="Remove size"><i class="bx bx-trash"></i></button></td>
    </tr>`;
  }

  function renderRows(rows) {
    const body = byId('dashboard-size-chart-body');
    if (!body) return;
    body.innerHTML = (rows.length ? rows : [emptyRow()]).map(rowMarkup).join('');
  }

  function chartRows(model) {
    const source = model?.sizeChart;
    const rows = Array.isArray(source) ? source : Array.isArray(source?.rows) ? source.rows : [];
    return rows.map(row => ({...emptyRow(), ...row}));
  }

  function setStatus(message, state = '') {
    const status = byId('dashboard-size-chart-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function openSizeChart(modelId) {
    const model = findModel(modelId);
    if (!model) return;
    activeModelId = String(model.id);
    byId('dashboard-size-chart-model-id').value = activeModelId;
    byId('dashboard-size-chart-title').textContent = `Size Chart — ${model.name} (${model.modelId})`;
    const source = model.sizeChart;
    byId('dashboard-size-chart-unit').value = Array.isArray(source) ? 'cm' : source?.unit || 'cm';
    const savedRows = chartRows(model);
    renderRows(savedRows.length ? savedRows : modelSizes(model).map(emptyRow));
    setStatus(savedRows.length ? 'Edit the saved measurements, then save.' : 'Add at least one measurement for every published size.', 'info');
    if (typeof openModal === 'function') openModal(byId('size-chart-modal'));
    else byId('size-chart-modal').style.display = 'block';
  }

  function collectRows() {
    return [...document.querySelectorAll('#dashboard-size-chart-body .dart-size-chart-admin-row')]
      .map(row => Object.fromEntries(columns.map(key => [key, String(row.querySelector(`[data-size-field="${key}"]`)?.value || '').trim()])))
      .filter(row => columns.some(key => row[key]));
  }

  function decorateModelRows() {
    document.querySelectorAll('#models-container .model-row').forEach(row => {
      const actions = row.querySelector('.row-action-btns');
      if (!actions || actions.querySelector('.dart-size-chart-btn')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'action-btn dart-size-chart-btn';
      button.title = 'Edit Size Chart';
      button.setAttribute('aria-label', 'Edit size chart');
      button.innerHTML = '<i class="bx bx-ruler"></i>';
      actions.appendChild(button);
    });
  }

  function wrapModelRenderer() {
    if (typeof renderModels !== 'function' || renderModels.dartSizeChartWrapped) return;
    const original = renderModels;
    const wrapped = function (data) {
      const result = original(data);
      decorateModelRows();
      return result;
    };
    wrapped.dartSizeChartWrapped = true;
    renderModels = wrapped;
    if (typeof sectionsMap !== 'undefined' && sectionsMap.models) sectionsMap.models.render = wrapped;
  }

  wrapModelRenderer();

  document.addEventListener('DOMContentLoaded', () => {
    wrapModelRenderer();
    decorateModelRows();

    byId('models-container')?.addEventListener('click', event => {
      const button = event.target.closest('.dart-size-chart-btn');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      openSizeChart(button.closest('.model-row')?.dataset.id);
    });

    byId('dashboard-size-chart-add-row')?.addEventListener('click', () => {
      byId('dashboard-size-chart-body')?.insertAdjacentHTML('beforeend', rowMarkup());
      setStatus('New size row added.', 'info');
    });

    byId('dashboard-size-chart-stock-sizes')?.addEventListener('click', () => {
      const model = findModel(activeModelId);
      const existing = new Map(collectRows().map(row => [row.size.toLocaleLowerCase(), row]));
      const sizes = modelSizes(model);
      const merged = sizes.map(size => existing.get(size.toLocaleLowerCase()) || emptyRow(size));
      renderRows(merged.length ? merged : collectRows());
      setStatus('Rows now match the sizes used by this model. Existing matching measurements were preserved.', 'info');
    });

    byId('dashboard-size-chart-body')?.addEventListener('click', event => {
      const button = event.target.closest('.dart-size-chart-remove-row');
      if (!button) return;
      const body = byId('dashboard-size-chart-body');
      button.closest('tr')?.remove();
      if (!body.children.length) body.insertAdjacentHTML('beforeend', rowMarkup());
    });

    byId('dashboard-size-chart-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const model = findModel(activeModelId);
      if (!model) return setStatus('The model no longer exists.', 'error');
      const rows = collectRows();
      if (!rows.length || rows.some(row => !row.size)) return setStatus('Every row must include a size.', 'error');
      const names = rows.map(row => row.size.toLocaleLowerCase());
      if (new Set(names).size !== names.length) return setStatus('Every size must appear only once.', 'error');
      const measurementKeys = columns.filter(key => !['size', 'notes'].includes(key));
      if (rows.some(row => !measurementKeys.some(key => Number(row[key]) > 0))) return setStatus('Add at least one positive numeric measurement to every size row.', 'error');

      const normalizedRows = rows.map(row => Object.fromEntries(columns.map(key => {
        if (!measurementKeys.includes(key)) return [key, row[key]];
        return [key, row[key] === '' ? '' : Number(row[key])];
      })));
      const previous = model.sizeChart || null;
      model.sizeChart = {unit:byId('dashboard-size-chart-unit').value || 'cm', rows:normalizedRows, updatedAt:new Date().toISOString()};
      model.updatedAt = new Date().toISOString();
      if (typeof dartAudit === 'function') dartAudit('SIZE_CHART_UPDATED', 'models', model.id, {sizeChart:previous}, {sizeChart:model.sizeChart}, 'Customer size chart updated');
      if (typeof dartSaveAll === 'function') dartSaveAll();
      else localStorage.setItem('dart_models', JSON.stringify(modelsData));
      if (typeof dartRefreshAll === 'function') dartRefreshAll();
      setStatus('Size chart saved and published to the product modal.', 'success');
      setTimeout(() => {
        if (typeof closeModal === 'function') closeModal(byId('size-chart-modal'));
        else byId('size-chart-modal').style.display = 'none';
      }, 450);
    });
  });

  window.DartSizeChartAdmin = {open:openSizeChart, modelSizes};
})();
