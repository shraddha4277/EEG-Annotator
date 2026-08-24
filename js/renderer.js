'use strict';
/* =====================================================================
   renderer.js — Canvas waveform renderer
   Two stacked canvases: waveform (signal + grid) | overlay (crosshair + drag)
   ===================================================================== */

const CHANNEL_COLORS = [
  '#4f9cff','#00e5be','#ff6b8a','#ffd166','#a78bfa',
  '#ff9f43','#48dbfb','#ff6348','#7bed9f','#ff4757',
  '#5352ed','#eccc68','#fd79a8','#55efc4','#fdcb6e',
  '#e17055','#74b9ff','#a29bfe','#d63031','#00b894',
];

class WaveformRenderer {
  constructor(waveformCanvas, overlayCanvas, channelLabelsEl, minimapCanvas) {
    this.wCanvas    = waveformCanvas;
    this.oCanvas    = overlayCanvas;
    this.labelsEl   = channelLabelsEl;
    this.mmCanvas   = minimapCanvas;
    this.ctx        = waveformCanvas.getContext('2d');
    this.octx       = overlayCanvas.getContext('2d');
    this.mmctx      = minimapCanvas ? minimapCanvas.getContext('2d') : null;

    // View state
    this.edfData        = null;
    this.viewStart      = 0;
    this.windowDuration = 10;
    this.amplitudeScale = 1.0;
    this.montage        = 'raw';
    this.visibleChannels= [];   // ordered array of signal indices
    this.annotations    = [];

    // Interaction
    this.annotationMode  = false;
    this.isDragging      = false;
    this.isPanning       = false;
    this.dragStartX      = 0;
    this.dragCurrentX    = 0;
    this.panStartX       = 0;
    this.panStartViewStart = 0;
    this.mouseX          = -1;
    this.mouseY          = -1;

    // Callbacks
    this.onAnnotationCreate = null; // (t1, t2) => void
    this.onCursorMove       = null; // (time) => void
    this.onViewChange       = null; // (viewStart) => void
    this.onWindowChange     = null; // (duration) => void

    this._bindEvents();
  }

  /* ═══════════════════════════════════════ DATA ══════════════════════ */
  setData(edfData) {
    this.edfData = edfData;
    this.viewStart = 0;
    // Auto-select non-annotation channels
    this.visibleChannels = edfData.signals
      .filter(s => !s.isAnnotation)
      .map(s => s.index);
    this._rebuildLabels();
    this.render();
    this._renderMinimap();
  }

  /* ═══════════════════════════════════════ SIGNAL GETTER ══════════════ */
  _getSignal(chIdx) {
    const sig = this.edfData.signals[chIdx];
    if (this.montage === 'bipolar') {
      const pos = this.visibleChannels.indexOf(chIdx);
      if (pos >= 0 && pos < this.visibleChannels.length - 1) {
        const nextSig = this.edfData.signals[this.visibleChannels[pos + 1]];
        if (Math.abs(sig.sampleRate - nextSig.sampleRate) < 0.01) {
          const n   = Math.min(sig.data.length, nextSig.data.length);
          const out = new Float32Array(n);
          for (let i = 0; i < n; i++) out[i] = sig.data[i] - nextSig.data[i];
          const absMax = Math.max(Math.abs(sig.physMax - nextSig.physMin),
                                  Math.abs(sig.physMin - nextSig.physMax));
          return { data: out, sampleRate: sig.sampleRate, halfRange: absMax || 1000 };
        }
      }
    }
    return {
      data: sig.data,
      sampleRate: sig.sampleRate,
      halfRange: Math.max(Math.abs(sig.physMax), Math.abs(sig.physMin)) || 1000,
    };
  }

  /* ═══════════════════════════════════════ MAIN RENDER ══════════════ */
  render() {
    if (!this.edfData) return;
    const { ctx, wCanvas: cv } = this;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    const nch = this.visibleChannels.length;
    if (nch === 0) return;
    const rowH = H / nch;

    this._drawGrid(ctx, W, H, nch, rowH);

    this.visibleChannels.forEach((chIdx, i) => {
      const rowY = i * rowH;
      const color = CHANNEL_COLORS[chIdx % CHANNEL_COLORS.length];
      const signal = this._getSignal(chIdx);
      this._drawSignal(ctx, signal, rowY, rowH, W, color);
    });

    this._drawAnnotationOverlays(ctx, W, H);
    this._rebuildLabels();
  }

  _drawGrid(ctx, W, H, nch, rowH) {
    ctx.save();
    // Row separators
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < nch; i++) {
      const y = i * rowH | 0;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // Zero lines
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < nch; i++) {
      const y = (i + 0.5) * rowH | 0;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // Vertical time grid — every 1s (or larger step for big windows)
    const step = this._gridStep();
    const t0 = Math.ceil(this.viewStart / step) * step;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.setLineDash([2, 4]);
    for (let t = t0; t < this.viewStart + this.windowDuration + step; t += step) {
      const x = this._timeToX(t, W);
      if (x < 0 || x > W) continue;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.setLineDash([]);
    // Time labels along bottom
    ctx.fillStyle = 'rgba(130,155,200,0.65)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    for (let t = t0; t <= this.viewStart + this.windowDuration; t += step) {
      const x = this._timeToX(t, W);
      if (x >= 20 && x <= W - 20) ctx.fillText(this._fmtTime(t), x, H - 4);
    }
    ctx.restore();
  }

  _gridStep() {
    if (this.windowDuration <= 5)   return 0.5;
    if (this.windowDuration <= 15)  return 1;
    if (this.windowDuration <= 30)  return 5;
    if (this.windowDuration <= 60)  return 10;
    return 30;
  }

  _drawSignal(ctx, signal, rowY, rowH, W, color) {
    const { data, sampleRate, halfRange } = signal;
    if (!data || data.length === 0) return;

    const s0 = Math.max(0, Math.floor(this.viewStart * sampleRate));
    const s1 = Math.min(data.length, Math.ceil((this.viewStart + this.windowDuration) * sampleRate));
    if (s1 <= s0) return;

    const midY  = rowY + rowH / 2;
    const scaleY = (rowH * 0.42 * this.amplitudeScale) / halfRange;
    const spp    = (s1 - s0) / W;          // samples per pixel

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.lineJoin    = 'round';
    ctx.beginPath();

    if (spp >= 2) {
      // Envelope (min/max per pixel)
      let first = true;
      for (let px = 0; px < W; px++) {
        const a = s0 + Math.floor(px * spp);
        const b = Math.min(s1 - 1, s0 + Math.floor((px + 1) * spp));
        let mn = data[a], mx = data[a];
        for (let s = a + 1; s <= b; s++) {
          if (data[s] < mn) mn = data[s];
          if (data[s] > mx) mx = data[s];
        }
        const yTop = midY - mx * scaleY;
        const yBot = midY - mn * scaleY;
        if (first) { ctx.moveTo(px, (yTop+yBot)/2); first = false; }
        ctx.lineTo(px, yTop);
        ctx.lineTo(px, yBot);
      }
    } else {
      // Interpolated
      for (let px = 0; px < W; px++) {
        const exact = s0 + px * spp;
        const i0    = Math.floor(exact);
        const i1    = Math.min(i0 + 1, data.length - 1);
        const frac  = exact - i0;
        const v     = data[i0] + (data[i1] - data[i0]) * frac;
        const y     = midY - v * scaleY;
        px === 0 ? ctx.moveTo(0, y) : ctx.lineTo(px, y);
      }
    }

    ctx.stroke();

    // Amplitude scale label (right edge)
    const uv = (halfRange / this.amplitudeScale).toFixed(0);
    ctx.fillStyle = color + 'aa';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`±${uv}`, W - 2, rowY + 10);
    ctx.restore();
  }

  _drawAnnotationOverlays(ctx, W, H) {
    this.annotations.forEach(ann => {
      const x1 = this._timeToX(ann.startTime, W);
      const x2 = this._timeToX(ann.endTime,   W);
      if (x2 < 0 || x1 > W) return;
      const cx1 = Math.max(0, x1), cx2 = Math.min(W, x2);

      ctx.save();
      ctx.fillStyle   = ann.color + '28';
      ctx.fillRect(cx1, 0, cx2 - cx1, H);
      ctx.strokeStyle = ann.color;
      ctx.lineWidth   = 1.5;
      [x1, x2].forEach(x => {
        if (x >= 0 && x <= W) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
      });
      // Label
      if (cx1 + 2 < W) {
        ctx.fillStyle = ann.color;
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(ann.label, cx1 + 4, 16);
      }
      ctx.restore();
    });
  }

  /* ═══════════════════════════════════════ OVERLAY CANVAS ══════════ */
  renderOverlay() {
    const { octx, oCanvas: ov } = this;
    const W = ov.width, H = ov.height;
    octx.clearRect(0, 0, W, H);

    // Crosshair
    if (this.mouseX >= 0) {
      octx.save();
      octx.strokeStyle = 'rgba(255,255,255,0.25)';
      octx.lineWidth = 1;
      octx.setLineDash([4, 4]);
      octx.beginPath(); octx.moveTo(this.mouseX, 0); octx.lineTo(this.mouseX, H); octx.stroke();
      octx.setLineDash([]);
      octx.strokeStyle = 'rgba(255,255,255,0.1)';
      if (this.mouseY >= 0) {
        octx.beginPath(); octx.moveTo(0, this.mouseY); octx.lineTo(W, this.mouseY); octx.stroke();
      }
      // Time readout bubble
      const t = this._xToTime(this.mouseX, W);
      const label = this._fmtTime(t);
      octx.font = '10px JetBrains Mono, monospace';
      const tw = octx.measureText(label).width;
      const bx = Math.min(this.mouseX + 6, W - tw - 10);
      octx.fillStyle = 'rgba(20,30,55,0.85)';
      octx.beginPath();
      octx.roundRect(bx - 3, 2, tw + 8, 16, 4);
      octx.fill();
      octx.fillStyle = '#7fb3ff';
      octx.fillText(label, bx + 1, 14);
      octx.restore();
    }

    // Annotation drag selection
    if (this.isDragging) {
      const x1 = Math.min(this.dragStartX, this.dragCurrentX);
      const x2 = Math.max(this.dragStartX, this.dragCurrentX);
      octx.save();
      octx.fillStyle   = 'rgba(167,139,250,0.18)';
      octx.fillRect(x1, 0, x2 - x1, H);
      octx.strokeStyle = '#a78bfa';
      octx.lineWidth   = 1.5;
      octx.strokeRect(x1, 0, x2 - x1, H);
      // Duration label
      const dt = Math.abs(this._xToTime(x2, W) - this._xToTime(x1, W));
      octx.fillStyle = '#c4b5fd';
      octx.font = '11px Inter, sans-serif';
      octx.textAlign = 'center';
      octx.fillText(`${dt.toFixed(2)}s`, (x1+x2)/2, 16);
      octx.restore();
    }
  }

  /* ═══════════════════════════════════════ MINIMAP ══════════════════ */
  _renderMinimap() {
    if (!this.mmCanvas || !this.mmctx || !this.edfData) return;
    const mc = this.mmCanvas;
    const ctx = this.mmctx;
    const W = mc.width, H = mc.height;
    ctx.clearRect(0, 0, W, H);

    // Draw first EEG channel at very low resolution
    const firstCh = this.visibleChannels[0];
    if (firstCh === undefined) return;
    const sig = this.edfData.signals[firstCh];
    if (!sig || !sig.data) return;

    const total = this.edfData.totalDuration;
    const data  = sig.data;
    const spp   = data.length / W;
    const halfR = Math.max(Math.abs(sig.physMax), Math.abs(sig.physMin)) || 1000;
    const midY  = H / 2;
    const scaleY = (H * 0.4) / halfR;

    ctx.save();
    ctx.strokeStyle = '#4f9cff66';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let px = 0; px < W; px++) {
      const s0 = Math.floor(px * spp);
      const s1 = Math.min(data.length - 1, Math.floor((px+1)*spp));
      let mn = data[s0], mx = data[s0];
      for (let s = s0; s <= s1; s++) { if(data[s]<mn)mn=data[s]; if(data[s]>mx)mx=data[s]; }
      const yT = midY - mx * scaleY;
      const yB = midY - mn * scaleY;
      if (px===0) ctx.moveTo(px, (yT+yB)/2); else { ctx.lineTo(px,yT); ctx.lineTo(px,yB); }
    }
    ctx.stroke();
    ctx.restore();

    // Viewport indicator
    const vx1 = (this.viewStart / total) * W;
    const vx2 = ((this.viewStart + this.windowDuration) / total) * W;
    ctx.save();
    ctx.fillStyle = 'rgba(79,156,255,0.15)';
    ctx.fillRect(vx1, 0, vx2 - vx1, H);
    ctx.strokeStyle = '#4f9cff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx1, 0, vx2 - vx1, H);
    ctx.restore();
  }

  updateMinimapViewport() {
    if (!this.mmCanvas || !this.mmctx || !this.edfData) return;
    // Re-render minimap to update viewport indicator
    this._renderMinimap();
  }

  /* ═══════════════════════════════════════ EVENTS ══════════════════ */
  _bindEvents() {
    const ov = this.oCanvas;

    ov.addEventListener('mousemove', e => {
      const r = ov.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;

      if (this.isDragging) {
        this.dragCurrentX = this.mouseX;
      } else if (this.isPanning) {
        const dt = -((this.mouseX - this.panStartX) / ov.width) * this.windowDuration;
        this.setViewStart(this.panStartViewStart + dt);
        return; // render called inside setViewStart
      }

      this.renderOverlay();
      if (this.onCursorMove) this.onCursorMove(this._xToTime(this.mouseX, ov.width));
    });

    ov.addEventListener('mousedown', e => {
      const r = ov.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      if (this.annotationMode) {
        this.isDragging    = true;
        this.dragStartX    = this.mouseX;
        this.dragCurrentX  = this.mouseX;
      } else {
        this.isPanning         = true;
        this.panStartX         = this.mouseX;
        this.panStartViewStart = this.viewStart;
      }
      e.preventDefault();
    });

    ov.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        const x1 = Math.min(this.dragStartX, this.dragCurrentX);
        const x2 = Math.max(this.dragStartX, this.dragCurrentX);
        if (x2 - x1 > 4 && this.onAnnotationCreate) {
          this.onAnnotationCreate(
            this._xToTime(x1, ov.width),
            this._xToTime(x2, ov.width)
          );
        }
        this.renderOverlay();
      }
      this.isPanning = false;
    });

    ov.addEventListener('mouseleave', () => {
      this.mouseX = -1; this.mouseY = -1;
      this.isPanning = false;
      this.renderOverlay();
      if (this.onCursorMove) this.onCursorMove(null);
    });

    ov.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.25 : 0.8;
      const newDur = Math.max(1, Math.min(120, this.windowDuration * factor));
      // Zoom around mouse position
      if (this.mouseX >= 0) {
        const tAtMouse  = this._xToTime(this.mouseX, ov.width);
        this.windowDuration = newDur;
        this.viewStart = tAtMouse - (this.mouseX / ov.width) * newDur;
      } else {
        this.windowDuration = newDur;
      }
      this._clampView();
      this.render();
      this._renderMinimap();
      if (this.onWindowChange) this.onWindowChange(newDur);
    }, { passive: false });

    // Minimap click/drag
    if (this.mmCanvas) {
      this.mmCanvas.addEventListener('click', e => {
        if (!this.edfData) return;
        const r   = this.mmCanvas.getBoundingClientRect();
        const px  = e.clientX - r.left;
        const frac = px / this.mmCanvas.width;
        this.setViewStart(frac * this.edfData.totalDuration - this.windowDuration / 2);
      });
    }
  }

  /* ═══════════════════════════════════════ SETTERS ══════════════════ */
  setViewStart(t) {
    this.viewStart = t;
    this._clampView();
    this.render();
    this._renderMinimap();
    if (this.onViewChange) this.onViewChange(this.viewStart);
  }

  _clampView() {
    if (!this.edfData) return;
    const maxStart = Math.max(0, this.edfData.totalDuration - this.windowDuration);
    this.viewStart = Math.max(0, Math.min(this.viewStart, maxStart));
  }

  setWindowDuration(s) {
    this.windowDuration = s;
    this._clampView();
    this.render();
    this._renderMinimap();
  }

  setAmplitudeScale(v) { this.amplitudeScale = v; this.render(); }
  setMontage(m)        { this.montage = m; this.render(); }
  setAnnotations(arr)  { this.annotations = arr; this.render(); }
  setAnnotationMode(b) {
    this.annotationMode = b;
    this.oCanvas.style.cursor = b ? 'crosshair' : (this.isPanning ? 'grabbing' : 'default');
  }

  toggleChannel(chIdx) {
    const idx = this.visibleChannels.indexOf(chIdx);
    if (idx >= 0) this.visibleChannels.splice(idx, 1);
    else {
      // Re-insert in original order
      const allCh = this.edfData.signals.filter(s=>!s.isAnnotation).map(s=>s.index);
      const pos   = allCh.indexOf(chIdx);
      let inserted = false;
      for (let i = 0; i < this.visibleChannels.length; i++) {
        if (allCh.indexOf(this.visibleChannels[i]) > pos) {
          this.visibleChannels.splice(i, 0, chIdx);
          inserted = true; break;
        }
      }
      if (!inserted) this.visibleChannels.push(chIdx);
    }
    this.render();
  }

  resize(w, h) {
    this.wCanvas.width  = w; this.wCanvas.height = h;
    this.oCanvas.width  = w; this.oCanvas.height = h;
    this.render();
    this.renderOverlay();
    this._renderMinimap();
  }

  /* ═══════════════════════════════════════ HELPERS ══════════════════ */
  _timeToX(t, W) { return ((t - this.viewStart) / this.windowDuration) * W; }
  _xToTime(x, W) { return this.viewStart + (x / W) * this.windowDuration; }

  _fmtTime(sec) {
    if (!isFinite(sec)) return '—';
    const h = Math.floor(sec/3600);
    const m = Math.floor((sec%3600)/60);
    const s = (sec%60).toFixed(2);
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(5,'0')}`;
    if (m > 0) return `${m}:${String(s).padStart(5,'0')}`;
    return `${s}s`;
  }

  _rebuildLabels() {
    const nch  = this.visibleChannels.length;
    if (!this.labelsEl || nch === 0) return;
    const rowH = this.wCanvas.height / nch;
    // Only rebuild DOM if channel list changed
    const current = [...this.labelsEl.children].map(c => c.dataset.ch);
    const needed  = this.visibleChannels.map(String);
    if (JSON.stringify(current) !== JSON.stringify(needed)) {
      this.labelsEl.innerHTML = '';
      this.visibleChannels.forEach(chIdx => {
        const sig = this.edfData.signals[chIdx];
        const div = document.createElement('div');
        div.className = 'ch-row-label';
        div.dataset.ch = chIdx;
        div.style.color = CHANNEL_COLORS[chIdx % CHANNEL_COLORS.length];
        div.style.height = `${rowH}px`;
        div.style.borderColor = CHANNEL_COLORS[chIdx % CHANNEL_COLORS.length] + '44';
        div.textContent = sig.label.substring(0, 16).trim();
        this.labelsEl.appendChild(div);
      });
    } else {
      // Just resize heights
      [...this.labelsEl.children].forEach(div => div.style.height = `${rowH}px`);
    }
  }
}
