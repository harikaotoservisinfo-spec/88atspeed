/**
 * Test sekmeleri — HP+ sonrası 5 geçici istat sütunu (başlığa tıkla / tekrar tıkla boşalt).
 */
const AtestIstatPickSlots = (function () {
    const SLOT_COUNT = 5;
    const slotState = Object.create(null);
    const raceCtx = Object.create(null);

    function emptySlots() {
        return [null, null, null, null, null];
    }

    function getSlots(raceKey) {
        if (!slotState[raceKey]) slotState[raceKey] = emptySlots();
        return slotState[raceKey];
    }

    function registerRace(raceKey, ctx, horses) {
        raceCtx[raceKey] = { ctx: ctx, horses: horses || [] };
    }

    function slotEntry(key, label) {
        return key ? { key: key, label: label || key } : null;
    }

    function findSlotIndex(slots, pickKey) {
        for (let i = 0; i < slots.length; i++) {
            if (slots[i] && slots[i].key === pickKey) return i;
        }
        return -1;
    }

    function firstEmptyIndex(slots) {
        for (let i = 0; i < slots.length; i++) {
            if (!slots[i]) return i;
        }
        return -1;
    }

    function activePickKeys(slots) {
        const set = new Set();
        for (const s of slots) {
            if (s?.key) set.add(s.key);
        }
        return set;
    }

    function togglePick(raceKey, pickKey, pickLabel) {
        const slots = getSlots(raceKey);
        const existing = findSlotIndex(slots, pickKey);
        if (existing >= 0) {
            slots[existing] = null;
            return slots;
        }
        const empty = firstEmptyIndex(slots);
        if (empty < 0) return slots;
        slots[empty] = slotEntry(pickKey, pickLabel);
        return slots;
    }

    function appendSlotHeaders(rowspan, raceKey) {
        const rs = rowspan > 1 ? (' rowspan="' + rowspan + '"') : '';
        const slots = getSlots(raceKey);
        let h = '';
        for (let i = 0; i < SLOT_COUNT; i++) {
            const label = slots[i]?.label || ('ALAN ' + (i + 1));
            const title = slots[i]
                ? ('Seçili: ' + slots[i].label + ' — İstat başlığına tekrar tıklayın')
                : ('Boş alan ' + (i + 1) + ' — sağdaki istat sütun başlığına tıklayın');
            h += '<th class="col-stat astest-pick-slot-hdr" data-slot="' + i + '"' + rs
                + ' title="' + title.replace(/"/g, '&quot;') + '">'
                + '<div class="astest-pick-slot-label">' + label + '</div></th>';
        }
        return h;
    }

    function renderSlotCells(horse, raceKey) {
        const slots = getSlots(raceKey);
        const rc = raceCtx[raceKey];
        let h = '';
        for (let i = 0; i < SLOT_COUNT; i++) {
            const pick = slots[i];
            let inner = '<span class="istat-pick-empty">—</span>';
            let extraCls = '';
            if (pick?.key && rc?.ctx && typeof AtestIstatDepthUi !== 'undefined') {
                const row = typeof AtestSon800Shared !== 'undefined'
                    ? AtestSon800Shared.getIstatRow(horse, rc.ctx)
                    : {};
                const rendered = AtestIstatDepthUi.renderPickCell(row, pick.key, rc.ctx.pkg, rc.ctx);
                inner = rendered.inner;
                extraCls = rendered.tdClass || '';
            }
            h += '<td class="col-stat astest-pick-slot' + (extraCls ? ' ' + extraCls : '')
                + '" data-slot="' + i + '">' + inner + '</td>';
        }
        return h;
    }

    function refreshRaceTable(raceEl) {
        if (!raceEl) return;
        const raceKey = raceEl.getAttribute('data-race-key');
        if (!raceKey) return;
        const rc = raceCtx[raceKey];
        if (!rc) return;
        const slots = getSlots(raceKey);
        const active = activePickKeys(slots);

        raceEl.querySelectorAll('.astest-pick-slot-hdr[data-slot]').forEach(function(th) {
            const idx = parseInt(th.getAttribute('data-slot'), 10);
            const slot = slots[idx];
            const labelEl = th.querySelector('.astest-pick-slot-label');
            if (labelEl) labelEl.textContent = slot?.label || ('ALAN ' + (idx + 1));
            th.title = slot
                ? ('Seçili: ' + slot.label + ' — İstat başlığına tekrar tıklayın')
                : ('Boş alan ' + (idx + 1) + ' — sağdaki istat sütun başlığına tıklayın');
        });

        const rows = raceEl.querySelectorAll('tbody tr');
        for (let ri = 0; ri < rows.length && ri < rc.horses.length; ri++) {
            const horse = rc.horses[ri];
            const tr = rows[ri];
            tr.querySelectorAll('.astest-pick-slot[data-slot]').forEach(function(td) {
                const idx = parseInt(td.getAttribute('data-slot'), 10);
                const pick = slots[idx];
                if (!pick?.key) {
                    td.className = 'col-stat astest-pick-slot';
                    td.innerHTML = '<span class="istat-pick-empty">—</span>';
                    return;
                }
                const row = typeof AtestSon800Shared !== 'undefined'
                    ? AtestSon800Shared.getIstatRow(horse, rc.ctx)
                    : {};
                const rendered = AtestIstatDepthUi.renderPickCell(row, pick.key, rc.ctx.pkg, rc.ctx);
                td.className = 'col-stat astest-pick-slot' + (rendered.tdClass ? ' ' + rendered.tdClass : '');
                td.innerHTML = rendered.inner;
            });
        }

        raceEl.querySelectorAll('th[data-istat-pick-key]').forEach(function(th) {
            const key = th.getAttribute('data-istat-pick-key');
            if (active.has(key)) th.classList.add('istat-pick-hdr-active');
            else th.classList.remove('istat-pick-hdr-active');
        });
    }

    function onHeaderClick(ev) {
        const th = ev.target.closest('th[data-istat-pick-key]');
        if (!th) return;
        const raceEl = th.closest('.son-test-race[data-race-key]');
        if (!raceEl) return;
        ev.preventDefault();
        ev.stopPropagation();
        const raceKey = raceEl.getAttribute('data-race-key');
        const pickKey = th.getAttribute('data-istat-pick-key');
        const pickLabel = th.getAttribute('data-istat-pick-label') || pickKey;
        togglePick(raceKey, pickKey, pickLabel);
        refreshRaceTable(raceEl);
    }

    let bound = false;
    function initDelegation() {
        if (bound) return;
        bound = true;
        document.addEventListener('click', onHeaderClick);
    }

    return {
        SLOT_COUNT,
        getSlots,
        registerRace,
        togglePick,
        appendSlotHeaders,
        renderSlotCells,
        refreshRaceTable,
        initDelegation,
        activePickKeys
    };
})();

if (typeof module !== 'undefined') module.exports = AtestIstatPickSlots;
