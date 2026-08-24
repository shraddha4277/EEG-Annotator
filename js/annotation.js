'use strict';
/* =====================================================================
   annotation.js  —  Annotation store & UI list manager
   ===================================================================== */

const AnnotationManager = (() => {
  const ANNOTATION_COLORS = [
    '#a78bfa','#4f9cff','#00e5be','#ff6b8a','#ffd166',
    '#ff9f43','#48dbfb','#ff6348','#7bed9f','#ec4899',
  ];

  let _annotations  = [];
  let _nextId       = 1;
  let _onChange     = null;      // called whenever store changes
  let _onJumpTo     = null;      // called when user clicks "jump to" in list

  /* ── Public API ── */
  function init(onChangeCb, onJumpToCb) {
    _annotations = [];
    _nextId      = 1;
    _onChange    = onChangeCb;
    _onJumpTo    = onJumpToCb;
  }

  function add(startTime, endTime, label, color, notes) {
    const ann = {
      id:        _nextId++,
      startTime: Math.min(startTime, endTime),
      endTime:   Math.max(startTime, endTime),
      label:     label || 'Annotation',
      color:     color || ANNOTATION_COLORS[0],
      notes:     notes || '',
      createdAt: Date.now(),
    };
    _annotations.push(ann);
    _annotations.sort((a,b) => a.startTime - b.startTime);
    _notify();
    return ann;
  }

  function remove(id) {
    _annotations = _annotations.filter(a => a.id !== id);
    _notify();
  }

  function update(id, fields) {
    const idx = _annotations.findIndex(a => a.id === id);
    if (idx >= 0) Object.assign(_annotations[idx], fields);
    _notify();
  }

  function getAll()  { return _annotations.slice(); }
  function getColors() { return ANNOTATION_COLORS; }

  function toJSON() {
    return JSON.stringify(_annotations, null, 2);
  }

  function clear() {
    _annotations = [];
    _nextId = 1;
    _notify();
  }

  /* ── Render list into #annotation-list ── */
  function renderList(containerEl, totalDuration) {
    if (!containerEl) return;
    containerEl.innerHTML = '';

    if (_annotations.length === 0) {
      containerEl.innerHTML = `
        <div class="empty-state small">
          <p>No annotations yet</p>
          <p class="hint">Enable <strong>Annotate</strong> mode and drag on the waveform</p>
        </div>`;
      return;
    }

    _annotations.forEach(ann => {
      const dur = (ann.endTime - ann.startTime).toFixed(2);
      const row = document.createElement('div');
      row.className = 'ann-item';
      row.dataset.id = ann.id;
      row.innerHTML = `
        <div class="ann-color-stripe" style="background:${ann.color}"></div>
        <div class="ann-body">
          <div class="ann-label-row">
            <span class="ann-label-text">${_esc(ann.label)}</span>
            <button class="ann-del-btn" data-id="${ann.id}" title="Delete">✕</button>
          </div>
          <div class="ann-time-row">
            <span class="ann-time">${_fmtTime(ann.startTime)} → ${_fmtTime(ann.endTime)}</span>
            <span class="ann-dur">${dur}s</span>
          </div>
          ${ann.notes ? `<div class="ann-notes">${_esc(ann.notes)}</div>` : ''}
        </div>
        <button class="ann-jump-btn" data-id="${ann.id}" title="Jump to">⌖</button>`;
      containerEl.appendChild(row);
    });

    // Events
    containerEl.querySelectorAll('.ann-del-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        remove(parseInt(btn.dataset.id));
      });
    });
    containerEl.querySelectorAll('.ann-jump-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const ann = _annotations.find(a => a.id === parseInt(btn.dataset.id));
        if (ann && _onJumpTo) _onJumpTo(ann.startTime);
      });
    });
  }

  /* ── Helpers ── */
  function _notify() {
    if (_onChange) _onChange(_annotations.slice());
  }

  function _esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _fmtTime(sec) {
    const h = Math.floor(sec/3600);
    const m = Math.floor((sec%3600)/60);
    const s = (sec%60).toFixed(2);
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(5,'0')}`;
    if (m > 0) return `${m}:${String(s).padStart(5,'0')}`;
    return `${s}s`;
  }

  return { init, add, remove, update, getAll, getColors, toJSON, clear, renderList };
})();
