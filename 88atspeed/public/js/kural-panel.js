/* 88ATSPEED - TAHMİNİM kural sırası paneli */
const KuralPanel = {
  STORAGE_KEY: '88atspeed-kural-sirasi',
  _dragId: null,
  _onChange: null,

  loadConfig() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return this.defaultConfig();
      const parsed = JSON.parse(raw);
      return this._normalizeConfig(parsed);
    } catch (_) {
      return this.defaultConfig();
    }
  },

  defaultConfig() {
    return {
      order: TahminEngine.getDefaultRuleOrder(),
      customRules: {},
      disabled: []
    };
  },

  _normalizeConfig(cfg) {
    const def = this.defaultConfig();
    const catalog = TahminEngine.getRuleCatalog();
    const order = Array.isArray(cfg.order) ? [...cfg.order] : [...def.order];
    const known = new Set([...Object.keys(catalog), ...Object.keys(cfg.customRules || {})]);
    for (const id of def.order) {
      if (!order.includes(id)) order.push(id);
    }
    const cleanOrder = order.filter(id => known.has(id) || String(id).startsWith('OZEL-'));
    return {
      order: cleanOrder,
      customRules: cfg.customRules || {},
      disabled: Array.isArray(cfg.disabled) ? cfg.disabled : []
    };
  },

  saveConfig(cfg) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cfg));
  },

  getActiveTiers() {
    return TahminEngine.resolveTiers(this.loadConfig());
  },

  setOnChange(fn) {
    this._onChange = fn;
  },

  _notifyChange() {
    if (typeof this._onChange === 'function') this._onChange();
  },

  moveRule(ruleId, toIndex) {
    const cfg = this.loadConfig();
    const from = cfg.order.indexOf(ruleId);
    if (from < 0 || from === toIndex) return false;
    if (toIndex < 0 || toIndex >= cfg.order.length) return false;

    const item = cfg.order.splice(from, 1)[0];
    cfg.order.splice(toIndex, 0, item);

    this.saveConfig(cfg);
    this.render();
    this._notifyChange();
    return true;
  },

  nudgeRule(ruleId, delta) {
    const cfg = this.loadConfig();
    const from = cfg.order.indexOf(ruleId);
    if (from < 0) return;
    const to = from + delta;
    if (to < 0 || to >= cfg.order.length) return;
    this.moveRule(ruleId, to);
  },

  toggleRule(ruleId, enabled) {
    const cfg = this.loadConfig();
    const set = new Set(cfg.disabled);
    if (enabled) set.delete(ruleId);
    else set.add(ruleId);
    cfg.disabled = [...set];
    this.saveConfig(cfg);
    this.render();
    this._notifyChange();
  },

  removeCustomRule(ruleId) {
    if (!String(ruleId).startsWith('OZEL-')) return;
    const cfg = this.loadConfig();
    cfg.order = cfg.order.filter(id => id !== ruleId);
    delete cfg.customRules[ruleId];
    cfg.disabled = cfg.disabled.filter(id => id !== ruleId);
    this.saveConfig(cfg);
    this.render();
    this._notifyChange();
  },

  resetToDefault() {
    this.saveConfig(this.defaultConfig());
    this.render();
    this._notifyChange();
  },

  addCustomRule(label, required, siraOnly) {
    if (!required?.length) return false;
    const cfg = this.loadConfig();
    const id = 'OZEL-' + Date.now();
    cfg.customRules[id] = {
      id,
      label: label || ('Özel kural (' + required.length + '/12)'),
      required: [...required],
      siraOnly: !!siraOnly
    };
    cfg.order.push(id);
    this.saveConfig(cfg);
    this.render();
    this._notifyChange();
    return true;
  },

  _getRuleMeta(id, cfg) {
    const catalog = TahminEngine.getRuleCatalog();
    const tier = cfg.customRules[id] || catalog[id];
    if (!tier) return null;
    const labels = TahminEngine.CONDITION_LABELS;
    const condText = tier.required.map(k => labels[k] || k).join(', ');
    return { tier, condText, isCustom: String(id).startsWith('OZEL-') };
  },

  render() {
    const list = document.getElementById('kuralSiraList');
    if (!list) return;
    const cfg = this.loadConfig();
    let html = '';
    cfg.order.forEach((id, idx) => {
      const meta = this._getRuleMeta(id, cfg);
      if (!meta) return;
      const disabled = cfg.disabled.includes(id);
      const siraBadge = meta.tier.siraOnly
        ? '<span class="kural-badge kural-badge-sira">1. sıra</span>' : '';
      html += '<div class="kural-item' + (disabled ? ' kural-item-off' : '') + '"'
        + ' draggable="true" data-rule-id="' + AtSpeedUtils.escapeHtml(id) + '" data-index="' + idx + '">';
      html += '<span class="kural-grip" title="Sürükle">⠿</span>';
      html += '<span class="kural-no">' + (idx + 1) + '</span>';
      html += '<div class="kural-info">';
      html += '<div class="kural-title">' + AtSpeedUtils.escapeHtml(meta.tier.label)
        + ' <code>' + AtSpeedUtils.escapeHtml(id) + '</code>' + siraBadge + '</div>';
      html += '<div class="kural-conds">' + AtSpeedUtils.escapeHtml(meta.condText) + '</div>';
      html += '</div>';
      html += '<div class="kural-move-btns">';
      html += '<button type="button" class="kural-nudge-btn" data-rule-id="' + AtSpeedUtils.escapeHtml(id) + '" data-delta="-1" title="Yukarı"'
        + (idx === 0 ? ' disabled' : '') + '>▲</button>';
      html += '<button type="button" class="kural-nudge-btn" data-rule-id="' + AtSpeedUtils.escapeHtml(id) + '" data-delta="1" title="Aşağı"'
        + (idx === cfg.order.length - 1 ? ' disabled' : '') + '>▼</button>';
      html += '</div>';
      html += '<label class="kural-toggle" title="Aktif/pasif">';
      html += '<input type="checkbox" class="kural-enable-cb" data-rule-id="' + AtSpeedUtils.escapeHtml(id) + '"'
        + (disabled ? '' : ' checked') + '> Aktif</label>';
      if (meta.isCustom) {
        html += '<button type="button" class="kural-del-btn" data-rule-id="' + AtSpeedUtils.escapeHtml(id) + '" title="Sil">✕</button>';
      }
      html += '</div>';
    });
    list.innerHTML = html;
    this._bindListEvents(list);
  },

  _bindListEvents(list) {
    list.querySelectorAll('.kural-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        const ruleId = item.dataset.ruleId;
        this._dragId = ruleId;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', ruleId);
        item.classList.add('kural-dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('kural-dragging');
        list.querySelectorAll('.kural-item').forEach(el => el.classList.remove('kural-drop-target'));
        setTimeout(() => { this._dragId = null; }, 0);
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const dragId = e.dataTransfer.getData('text/plain') || this._dragId;
        if (!dragId || item.dataset.ruleId === dragId) return;
        item.classList.add('kural-drop-target');
      });
      item.addEventListener('dragleave', () => item.classList.remove('kural-drop-target'));
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.classList.remove('kural-drop-target');
        const ruleId = e.dataTransfer.getData('text/plain') || this._dragId;
        if (!ruleId || ruleId === item.dataset.ruleId) return;
        const toIndex = parseInt(item.dataset.index, 10);
        this.moveRule(ruleId, toIndex);
      });
    });

    list.querySelectorAll('.kural-enable-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        this.toggleRule(cb.dataset.ruleId, cb.checked);
      });
    });

    list.querySelectorAll('.kural-nudge-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = parseInt(btn.dataset.delta, 10);
        this.nudgeRule(btn.dataset.ruleId, delta);
      });
    });

    list.querySelectorAll('.kural-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Bu özel kural silinsin mi?')) this.removeCustomRule(btn.dataset.ruleId);
      });
    });
  },

  renderConditionPicker() {
    const box = document.getElementById('kuralCondPicker');
    if (!box) return;
    let html = '';
    for (const key of TahminEngine.CONDITION_KEYS) {
      const label = TahminEngine.CONDITION_LABELS[key] || key;
      html += '<label class="kural-cond-chip"><input type="checkbox" value="' + key + '"> '
        + AtSpeedUtils.escapeHtml(label) + '</label>';
    }
    box.innerHTML = html;
  },

  init() {
    this.renderConditionPicker();
    this.render();

    document.getElementById('kuralSiraResetBtn')?.addEventListener('click', () => {
      if (confirm('Kural sırası varsayılana dönsün mü? Özel kurallar silinir.')) {
        this.resetToDefault();
      }
    });

    document.getElementById('kuralEkleBtn')?.addEventListener('click', () => {
      const label = document.getElementById('kuralYeniAd')?.value.trim();
      const siraOnly = document.getElementById('kuralYeniSira1')?.checked;
      const required = [];
      document.querySelectorAll('#kuralCondPicker input:checked').forEach(cb => required.push(cb.value));
      if (!required.length) {
        alert('En az bir koşul seçin');
        return;
      }
      if (this.addCustomRule(label, required, siraOnly)) {
        document.getElementById('kuralYeniAd').value = '';
        document.getElementById('kuralYeniSira1').checked = false;
        document.querySelectorAll('#kuralCondPicker input:checked').forEach(cb => { cb.checked = false; });
      }
    });
  }
};

if (typeof module !== 'undefined') module.exports = { KuralPanel };
