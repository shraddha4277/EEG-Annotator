'use strict';
/* =====================================================================
   app.js  —  Main controller: wires all modules together
   ===================================================================== */

(function () {

  /* ── DOM refs ── */
  const $ = id => document.getElementById(id);
  const Els = {
    fileInput:        $('file-input'),
    btnOpenEdf:       $('btn-open-edf'),
    btnOpenCenter:    $('btn-open-edf-center'),
    btnRaw:           $('btn-raw'),
    btnBipolar:       $('btn-bipolar'),
    btnEDA:           $('btn-eda'),
    btnThemeToggle:   $('btn-theme-toggle'),
    iconMoon:         $('icon-moon'),
    iconSun:          $('icon-sun'),
    btnAnnotateMode:  $('btn-annotate-mode'),
    btnExport:        $('btn-export'),
    exportMenu:       $('export-menu'),
    exportCSV:        $('export-csv'),
    exportEDF:        $('export-edf'),
    exportReport:     $('export-report'),
    montageGroup:     $('montage-group'),
    exportDropdown:   $('export-dropdown'),
    divExport:        $('div-export'),
    divMontage:       $('div-montage'),
    fileTitle:        $('file-title'),
    viewerEmpty:      $('viewer-empty'),
    viewerContent:    $('viewer-content'),
    channelLabels:    $('channel-labels'),
    waveformCanvas:   $('waveform-canvas'),
    overlayCanvas:    $('overlay-canvas'),
    minimapCanvas:    $('minimap-canvas'),
    channelList:      $('channel-list'),
    channelCount:     $('channel-count'),
    infoContent:      $('info-content'),
    annotationList:   $('annotation-list'),
    annotationCount:  $('annotation-count'),
    windowSelect:     $('window-size'),
    ampRange:         $('amplitude-scale'),
    btnPrev:          $('btn-prev'),
    btnNext:          $('btn-next'),
    statusFile:       $('status-file'),
    statusCursor:     $('status-cursor'),
    statusWindow:     $('status-window'),
    statusSR:         $('status-sr'),
    statusDuration:   $('status-duration'),
    // Annotation modal
    modalAnnotation:  $('modal-annotation'),
    annLabel:         $('ann-label'),
    annTimeStart:     $('ann-time-start'),
    annTimeEnd:       $('ann-time-end'),
    annDuration:      $('ann-duration'),
    annNotes:         $('ann-notes'),
    annSaveBtn:       $('ann-save-btn'),
    annCancelBtn:     $('ann-cancel-btn'),
    colorSwatches:    $('color-swatches'),
    // EDA modal
    modalEDA:         $('modal-eda'),
    edaChannelSelect: $('eda-channel-select'),
    edaWindowSelect:  $('eda-window-select'),
    edaComputeBtn:    $('eda-compute-btn'),
    edaPsdCanvas:     $('eda-psd-canvas'),
    edaBandsCanvas:   $('eda-bands-canvas'),
    bandTableBody:    $('band-table-body'),
  };

  /* ── App state ── */
  const State = {
    edfData:       null,
    filename:      '',
    annotationMode: false,
    pendingAnn:    { t1: 0, t2: 0, color: null },
    selectedColor: null,
    lastEdaResult: null,
  };

  /* ── Renderer ── */
  let renderer = null;

  /* ══════════════════════════════════════════
     INIT
  ══════════════════════════════════════════ */
  function init() {
    // Theme toggle
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
      document.body.classList.add('dark-theme');
      Els.iconMoon.style.display = 'none';
      Els.iconSun.style.display = 'block';
    }
    Els.btnThemeToggle.addEventListener('click', () => {
      const isDark = document.body.classList.toggle('dark-theme');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      Els.iconMoon.style.display = isDark ? 'none' : 'block';
      Els.iconSun.style.display = isDark ? 'block' : 'none';
    });

    // Annotation manager
    AnnotationManager.init(onAnnotationsChange, onJumpTo);

    // File open
    Els.btnOpenEdf   .addEventListener('click', () => Els.fileInput.click());
    Els.btnOpenCenter.addEventListener('click', () => Els.fileInput.click());
    Els.fileInput    .addEventListener('change', onFileSelected);

    // Montage
    Els.btnRaw    .addEventListener('click', () => setMontage('raw'));
    Els.btnBipolar.addEventListener('click', () => setMontage('bipolar'));

    // EDA modal
    Els.btnEDA.addEventListener('click', openEDA);
    $('eda-close').addEventListener('click', () => Els.modalEDA.style.display = 'none');
    Els.edaComputeBtn.addEventListener('click', computeEDA);
    Els.modalEDA.addEventListener('click', e => { if(e.target===Els.modalEDA) Els.modalEDA.style.display='none'; });

    // Annotate mode toggle
    Els.btnAnnotateMode.addEventListener('click', toggleAnnotateMode);

    // Export dropdown
    Els.btnExport.addEventListener('click', e => {
      e.stopPropagation();
      Els.exportMenu.classList.toggle('open');
    });
    document.addEventListener('click', () => Els.exportMenu.classList.remove('open'));

    Els.exportCSV   .addEventListener('click', doExportCSV);
    Els.exportEDF   .addEventListener('click', doExportEDF);
    Els.exportReport.addEventListener('click', doExportReport);

    // Annotation modal
    buildColorSwatches();
    Els.annSaveBtn  .addEventListener('click', saveAnnotation);
    Els.annCancelBtn.addEventListener('click', closeAnnotationModal);
    $('ann-cancel') .addEventListener('click', closeAnnotationModal);
    Els.modalAnnotation.addEventListener('click', e => {
      if (e.target === Els.modalAnnotation) closeAnnotationModal();
    });
    Els.annLabel.addEventListener('keydown', e => { if(e.key==='Enter') saveAnnotation(); });

    // Window size
    Els.windowSelect.addEventListener('change', () => {
      if (renderer) renderer.setWindowDuration(+Els.windowSelect.value);
      updateStatus();
    });

    // Amplitude
    Els.ampRange.addEventListener('input', () => {
      if (renderer) renderer.setAmplitudeScale(+Els.ampRange.value);
    });

    // Prev / Next
    Els.btnPrev.addEventListener('click', () => {
      if (renderer) renderer.setViewStart(renderer.viewStart - renderer.windowDuration);
      updateStatus();
    });
    Els.btnNext.addEventListener('click', () => {
      if (renderer) renderer.setViewStart(renderer.viewStart + renderer.windowDuration);
      updateStatus();
    });

    // Keyboard
    document.addEventListener('keydown', onKeydown);

    // Resize observer
    const ro = new ResizeObserver(() => resizeCanvases());
    ro.observe($('canvas-stack'));
  }

  /* ══════════════════════════════════════════
     FILE LOAD
  ══════════════════════════════════════════ */
  function onFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    State.filename = file.name.replace(/\.edf$/i,'');
    showToast('Loading ' + file.name + '…', 'info');

    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const edfData = EDFParser.parse(ev.target.result);
        State.edfData = edfData;
        AnnotationManager.clear();
        onEDFLoaded(edfData);
        showToast('Loaded ' + file.name, 'success');
      } catch (err) {
        showToast('Failed to parse EDF: ' + err.message, 'error');
        console.error(err);
      }
    };
    reader.onerror = () => showToast('Could not read file.', 'error');
    reader.readAsArrayBuffer(file);
    // Reset input so same file can be re-loaded
    Els.fileInput.value = '';
  }

  function onEDFLoaded(edfData) {
    // Show viewer
    Els.viewerEmpty.style.display = 'none';
    Els.viewerContent.style.display = 'flex';

    // Update title
    Els.fileTitle.textContent = State.filename;

    // Show toolbar controls
    Els.montageGroup.style.display = 'flex';
    Els.divMontage.style.display   = 'block';
    Els.btnEDA.style.display       = 'inline-flex';
    Els.btnAnnotateMode.style.display = 'inline-flex';
    Els.exportDropdown.style.display  = 'block';
    Els.divExport.style.display       = 'block';

    // File info panel
    renderInfoPanel(edfData);

    // Channel list
    renderChannelList(edfData);

    // Init/recreate renderer
    resizeCanvases(true);
    renderer = new WaveformRenderer(
      Els.waveformCanvas, Els.overlayCanvas, Els.channelLabels, Els.minimapCanvas
    );
    renderer.onAnnotationCreate = onAnnotationDragComplete;
    renderer.onCursorMove       = t => {
      if (t !== null) Els.statusCursor.textContent = 'Cursor: ' + _fmtTime(t);
      else Els.statusCursor.textContent = '—';
    };
    renderer.onViewChange  = () => updateStatus();
    renderer.onWindowChange = dur => {
      Els.windowSelect.value = [5,10,20,30,60].includes(dur) ? dur : Els.windowSelect.value;
      updateStatus();
    };

    renderer.setData(edfData);
    updateStatus();
  }

  /* ══════════════════════════════════════════
     INFO PANEL
  ══════════════════════════════════════════ */
  function renderInfoPanel(edfData) {
    const h = edfData.header;
    const dur = EDFParser.formatDuration(edfData.totalDuration);
    const eegChs = edfData.signals.filter(s=>!s.isAnnotation);
    const sr = eegChs.length > 0
      ? [...new Set(eegChs.map(s=>s.sampleRate))].join(' / ')
      : '—';

    Els.infoContent.innerHTML = `
      <div class="info-grid">
        <div class="info-row"><span class="info-key">Patient</span><span class="info-val">${_esc(h.patient||'—')}</span></div>
        <div class="info-row"><span class="info-key">Recording</span><span class="info-val">${_esc(h.recording||'—')}</span></div>
        <div class="info-row"><span class="info-key">Date</span><span class="info-val">${_esc(h.startDate)} ${_esc(h.startTime)}</span></div>
        <div class="info-row"><span class="info-key">Duration</span><span class="info-val accent">${dur}</span></div>
        <div class="info-row"><span class="info-key">Channels</span><span class="info-val accent">${eegChs.length}</span></div>
        <div class="info-row"><span class="info-key">Sample Rate</span><span class="info-val">${sr} Hz</span></div>
        <div class="info-row"><span class="info-key">EDF+</span><span class="info-val">${edfData.isEDFPlus?'Yes':'No'}</span></div>
      </div>`;
  }

  /* ══════════════════════════════════════════
     CHANNEL LIST PANEL
  ══════════════════════════════════════════ */
  function renderChannelList(edfData) {
    const eegChs = edfData.signals.filter(s=>!s.isAnnotation);
    Els.channelCount.textContent = eegChs.length;
    Els.channelList.innerHTML = '';

    eegChs.forEach(sig => {
      const color = CHANNEL_COLORS[sig.index % CHANNEL_COLORS.length];
      const div = document.createElement('div');
      div.className = 'ch-item active';
      div.dataset.chIdx = sig.index;
      div.innerHTML = `
        <span class="ch-dot" style="background:${color}"></span>
        <span class="ch-name">${_esc(sig.label)}</span>
        <span class="ch-sr">${sig.sampleRate.toFixed(0)}Hz</span>`;
      div.addEventListener('click', () => {
        if (!renderer) return;
        renderer.toggleChannel(sig.index);
        div.classList.toggle('active');
      });
      Els.channelList.appendChild(div);
    });
  }

  /* ══════════════════════════════════════════
     MONTAGE
  ══════════════════════════════════════════ */
  function setMontage(m) {
    if (!renderer) return;
    renderer.setMontage(m);
    Els.btnRaw.classList.toggle('active', m==='raw');
    Els.btnBipolar.classList.toggle('active', m==='bipolar');
  }

  /* ══════════════════════════════════════════
     ANNOTATION MODE
  ══════════════════════════════════════════ */
  function toggleAnnotateMode() {
    State.annotationMode = !State.annotationMode;
    if (renderer) renderer.setAnnotationMode(State.annotationMode);
    Els.btnAnnotateMode.classList.toggle('active', State.annotationMode);
    Els.btnAnnotateMode.title = State.annotationMode ? 'Exit annotation mode (A)' : 'Enter annotation mode (A)';
  }

  function onAnnotationDragComplete(t1, t2) {
    State.pendingAnn.t1 = t1;
    State.pendingAnn.t2 = t2;
    State.pendingAnn.color = AnnotationManager.getColors()[0];
    openAnnotationModal(t1, t2);
  }

  /* ══════════════════════════════════════════
     ANNOTATION MODAL
  ══════════════════════════════════════════ */
  function buildColorSwatches() {
    AnnotationManager.getColors().forEach((color, i) => {
      const btn = document.createElement('button');
      btn.className = 'color-swatch' + (i===0?' selected':'');
      btn.style.background = color;
      btn.dataset.color = color;
      btn.title = color;
      btn.addEventListener('click', () => {
        Els.colorSwatches.querySelectorAll('.color-swatch').forEach(b=>b.classList.remove('selected'));
        btn.classList.add('selected');
        State.pendingAnn.color = color;
      });
      Els.colorSwatches.appendChild(btn);
    });
    State.pendingAnn.color = AnnotationManager.getColors()[0];
  }

  function openAnnotationModal(t1, t2) {
    Els.annLabel.value = '';
    Els.annNotes.value = '';
    Els.annTimeStart.textContent = _fmtTime(t1);
    Els.annTimeEnd.textContent   = _fmtTime(t2);
    Els.annDuration.textContent  = `(${(t2-t1).toFixed(2)}s)`;
    // Reset color selection to first
    Els.colorSwatches.querySelectorAll('.color-swatch').forEach((b,i) => {
      b.classList.toggle('selected', i===0);
    });
    State.pendingAnn.color = AnnotationManager.getColors()[0];
    Els.modalAnnotation.style.display = 'flex';
    Els.annLabel.focus();
  }

  function closeAnnotationModal() {
    Els.modalAnnotation.style.display = 'none';
  }

  function saveAnnotation() {
    const label = Els.annLabel.value.trim();
    if (!label) { Els.annLabel.focus(); Els.annLabel.style.borderColor='var(--error)'; return; }
    Els.annLabel.style.borderColor = '';
    AnnotationManager.add(
      State.pendingAnn.t1,
      State.pendingAnn.t2,
      label,
      State.pendingAnn.color,
      Els.annNotes.value.trim()
    );
    closeAnnotationModal();
  }

  /* ══════════════════════════════════════════
     ANNOTATION CALLBACKS
  ══════════════════════════════════════════ */
  function onAnnotationsChange(annotations) {
    if (renderer) renderer.setAnnotations(annotations);
    Els.annotationCount.textContent = annotations.length;
    AnnotationManager.renderList(Els.annotationList, State.edfData?.totalDuration);
  }

  function onJumpTo(startTime) {
    if (!renderer) return;
    const t = startTime - renderer.windowDuration / 4;
    renderer.setViewStart(t);
    updateStatus();
  }

  /* ══════════════════════════════════════════
     EDA MODAL
  ══════════════════════════════════════════ */
  function openEDA() {
    if (!State.edfData) return;
    const eegChs = State.edfData.signals.filter(s=>!s.isAnnotation);
    Els.edaChannelSelect.innerHTML = eegChs.map(s =>
      `<option value="${s.index}">${_esc(s.label)}</option>`).join('');
    Els.modalEDA.style.display = 'flex';
    computeEDA();
  }

  function computeEDA() {
    if (!State.edfData) return;
    const chIdx     = +Els.edaChannelSelect.value;
    const sig       = State.edfData.signals[chIdx];
    if (!sig || !sig.data) return;
    const useAll    = Els.edaWindowSelect.value === 'entire';
    const viewEnd   = renderer ? renderer.viewStart + renderer.windowDuration : 0;
    const viewStart = renderer ? renderer.viewStart : 0;

    const result = EDA.compute(sig.data, sig.sampleRate, viewStart, viewEnd, useAll);
    if (!result) { showToast('Not enough data for EDA', 'error'); return; }

    State.lastEdaResult = result;
    EDA.drawPSD(Els.edaPsdCanvas, result.freqs, result.psd, result.bands);
    EDA.drawBands(Els.edaBandsCanvas, result.bands);
    EDA.fillBandTable($('band-table-body'), result.bands);
  }

  /* ══════════════════════════════════════════
     EXPORT
  ══════════════════════════════════════════ */
  function doExportCSV() {
    const anns = AnnotationManager.getAll();
    if (anns.length === 0) { showToast('No annotations to export', 'warning'); return; }
    Exporter.exportAnnotationsCSV(anns, State.filename);
    showToast('Annotations CSV exported', 'success');
  }

  function doExportEDF() {
    if (!State.edfData) { showToast('No EDF loaded', 'error'); return; }
    const anns = AnnotationManager.getAll();
    showToast('Building EDF+ file…', 'info');
    setTimeout(() => {
      try {
        Exporter.exportAnnotatedEDF(State.edfData, anns, State.filename);
        showToast('EDF+ exported', 'success');
      } catch(e) {
        showToast('EDF export failed: ' + e.message, 'error');
        console.error(e);
      }
    }, 50);
  }

  function doExportReport() {
    if (!State.edfData) { showToast('No EDF loaded', 'error'); return; }
    Exporter.exportHTMLReport(
      State.edfData,
      AnnotationManager.getAll(),
      State.lastEdaResult,
      State.filename
    );
    showToast('HTML Report exported', 'success');
  }

  /* ══════════════════════════════════════════
     KEYBOARD
  ══════════════════════════════════════════ */
  function onKeydown(e) {
    if (!renderer || !State.edfData) return;
    // Don't intercept when typing in inputs
    if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'l':
        renderer.setViewStart(renderer.viewStart + renderer.windowDuration * 0.5);
        break;
      case 'ArrowLeft':
      case 'h':
        renderer.setViewStart(renderer.viewStart - renderer.windowDuration * 0.5);
        break;
      case 'ArrowUp':
      case 'k':
        renderer.setAmplitudeScale(Math.min(10, renderer.amplitudeScale * 1.25));
        Els.ampRange.value = renderer.amplitudeScale;
        break;
      case 'ArrowDown':
      case 'j':
        renderer.setAmplitudeScale(Math.max(0.1, renderer.amplitudeScale * 0.8));
        Els.ampRange.value = renderer.amplitudeScale;
        break;
      case '+': case '=':
        renderer.setWindowDuration(Math.max(1, renderer.windowDuration * 0.8));
        break;
      case '-':
        renderer.setWindowDuration(Math.min(120, renderer.windowDuration * 1.25));
        break;
      case 'a': case 'A':
        toggleAnnotateMode();
        break;
      case 'Home':
        renderer.setViewStart(0);
        break;
      case 'End':
        renderer.setViewStart(State.edfData.totalDuration);
        break;
    }
    updateStatus();
  }

  /* ══════════════════════════════════════════
     RESIZE
  ══════════════════════════════════════════ */
  function resizeCanvases(force) {
    const container = $('canvas-stack');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (!force && w === Els.waveformCanvas.width && h === Els.waveformCanvas.height) return;
    if (w > 0 && h > 0 && renderer) renderer.resize(w, h);
    else if (w > 0 && h > 0) {
      Els.waveformCanvas.width  = w; Els.waveformCanvas.height = h;
      Els.overlayCanvas.width   = w; Els.overlayCanvas.height  = h;
    }
  }

  /* ══════════════════════════════════════════
     STATUS BAR
  ══════════════════════════════════════════ */
  function updateStatus() {
    if (!State.edfData || !renderer) return;
    Els.statusFile.textContent     = State.filename;
    Els.statusWindow.textContent   = `Window: ${renderer.windowDuration}s`;
    const sr = State.edfData.signals.filter(s=>!s.isAnnotation)[0]?.sampleRate;
    Els.statusSR.textContent       = `SR: ${sr ? sr.toFixed(0) : '—'} Hz`;
    Els.statusDuration.textContent = `Duration: ${EDFParser.formatDuration(State.edfData.totalDuration)}`;
  }

  /* ══════════════════════════════════════════
     TOAST
  ══════════════════════════════════════════ */
  function showToast(msg, type = 'info') {
    const tc = $('toast-container');
    if (!tc) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success:'✓', error:'✕', warning:'⚠', info:'ℹ' };
    toast.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ'}</span><span>${_esc(msg)}</span>`;
    tc.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 350);
    }, 3200);
  }

  /* ── Misc helpers ── */
  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function _fmtTime(sec) {
    if (!isFinite(sec)) return '—';
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = (sec%60).toFixed(2);
    if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(5,'0')}`;
    if (m>0) return `${m}:${String(s).padStart(5,'0')}`;
    return `${s}s`;
  }

  /* ── Boot ── */
  document.addEventListener('DOMContentLoaded', init);

})();
