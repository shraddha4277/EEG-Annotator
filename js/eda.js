'use strict';
/* =====================================================================
   eda.js  —  EDA: PSD (Welch) + Band Power
   Pure JS FFT — no external dependencies
   ===================================================================== */

const EDA = (() => {

  const BANDS = [
    { name:'Delta', low:0.5,  high:4,  color:'#5352ed' },
    { name:'Theta', low:4,    high:8,  color:'#48dbfb' },
    { name:'Alpha', low:8,    high:13, color:'#00e5be' },
    { name:'Beta',  low:13,   high:30, color:'#ffd166' },
    { name:'Gamma', low:30,   high:50, color:'#ff6b8a' },
  ];

  /* ── In-place radix-2 Cooley-Tukey FFT ── */
  function _fft(re, im) {
    const n = re.length;
    // Bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    // Butterfly
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wR = Math.cos(ang), wI = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curR = 1, curI = 0;
        const half = len >> 1;
        for (let j = 0; j < half; j++) {
          const uR = re[i+j],  uI = im[i+j];
          const vR = re[i+j+half]*curR - im[i+j+half]*curI;
          const vI = re[i+j+half]*curI + im[i+j+half]*curR;
          re[i+j]       = uR + vR;  im[i+j]       = uI + vI;
          re[i+j+half]  = uR - vR;  im[i+j+half]  = uI - vI;
          const tmp = curR*wR - curI*wI;
          curI = curR*wI + curI*wR;
          curR = tmp;
        }
      }
    }
  }

  /* ── Next power of 2 >= n ── */
  function _nextPow2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  /* ── Hann window ── */
  function _hannWindow(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    return w;
  }

  /* ── Welch PSD  ── */
  /* Returns { freqs, psd } where psd is in (physDim)^2 / Hz */
  function welchPSD(data, fs, nperseg, noverlap) {
    nperseg = nperseg || Math.min(_nextPow2(Math.max(256, fs | 0)), 1024, data.length);
    noverlap = (noverlap !== undefined) ? noverlap : nperseg >> 1;
    const step  = nperseg - noverlap;
    const win   = _hannWindow(nperseg);
    const winSS = win.reduce((s,v) => s + v*v, 0);  // window sum of squares

    const re = new Float64Array(nperseg);
    const im = new Float64Array(nperseg);
    const psdAcc = new Float64Array(nperseg >> 1);
    let nSegments = 0;

    for (let start = 0; start + nperseg <= data.length; start += step) {
      for (let i = 0; i < nperseg; i++) { re[i] = data[start+i] * win[i]; im[i] = 0; }
      _fft(re, im);
      // One-sided power (DC and Nyquist once, rest doubled)
      for (let k = 0; k < nperseg >> 1; k++) {
        const power = (re[k]*re[k] + im[k]*im[k]) / (fs * winSS);
        psdAcc[k] += (k === 0 || k === (nperseg>>1)-1) ? power : 2*power;
      }
      nSegments++;
    }

    if (nSegments === 0) return { freqs: [], psd: [] };

    const freqs = new Float64Array(nperseg >> 1);
    const psd   = new Float64Array(nperseg >> 1);
    const df = fs / nperseg;
    for (let k = 0; k < nperseg >> 1; k++) {
      freqs[k] = k * df;
      psd[k]   = psdAcc[k] / nSegments;
    }
    return { freqs, psd };
  }

  /* ── Band power (integrate PSD) ── */
  function bandPower(freqs, psd, fLow, fHigh) {
    const df = freqs.length > 1 ? freqs[1] - freqs[0] : 1;
    let power = 0;
    for (let k = 0; k < freqs.length; k++) {
      if (freqs[k] >= fLow && freqs[k] <= fHigh) power += psd[k] * df;
    }
    return power;
  }

  /* ── Compute all bands + return result object ── */
  function compute(signalData, fs, viewStart, viewEnd, useFullRecording) {
    let segment;
    if (useFullRecording) {
      segment = signalData;
    } else {
      const s0 = Math.floor(viewStart * fs);
      const s1 = Math.min(signalData.length, Math.ceil(viewEnd * fs));
      segment = signalData.slice(s0, s1);
    }

    if (segment.length < 64) return null;

    const { freqs, psd } = welchPSD(segment, fs);

    // Clip to 0–50 Hz
    const maxFIdx = freqs.findIndex(f => f > 50);
    const fSlice  = maxFIdx > 0 ? freqs.slice(0, maxFIdx) : freqs;
    const pSlice  = maxFIdx > 0 ? psd.slice(0, maxFIdx)   : psd;

    const df = fSlice.length > 1 ? fSlice[1] - fSlice[0] : 1;
    const totalPower = pSlice.reduce((s,v) => s + v*df, 0);

    const bands = BANDS.map(b => {
      const abs = bandPower(fSlice, pSlice, b.low, Math.min(b.high, fs/2));
      return { ...b, absolute: abs, relative: totalPower > 0 ? (abs/totalPower*100) : 0 };
    });

    return { freqs: fSlice, psd: pSlice, bands, totalPower };
  }

  /* ── Draw PSD chart on a canvas ── */
  function drawPSD(canvas, freqs, psd, bands) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width  = canvas.offsetWidth  || 600;
    const H = canvas.height = canvas.offsetHeight || 220;
    ctx.clearRect(0, 0, W, H);

    if (!freqs || freqs.length === 0) return;

    const PAD = { top:16, right:16, bottom:36, left:52 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top  - PAD.bottom;

    // Log10 PSD in dB
    const dB = Array.from(psd).map(v => v > 0 ? 10*Math.log10(v) : -100);
    const maxDB = Math.max(...dB.filter(isFinite));
    const minDB = Math.max(maxDB - 60, -100);
    const dbRange = maxDB - minDB || 1;

    const fMax = freqs[freqs.length - 1];

    const toX = f  => PAD.left + (f / fMax) * cW;
    const toY = db => PAD.top  + cH - ((db - minDB) / dbRange) * cH;

    /* Grid */
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3,3]);
    for (let f = 0; f <= fMax; f += 10) {
      const x = toX(f);
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top+cH); ctx.stroke();
    }
    const dbStep = 10;
    for (let db = Math.ceil(minDB/dbStep)*dbStep; db <= maxDB; db += dbStep) {
      const y = toY(db);
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left+cW, y); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    /* Band-colored background regions */
    BANDS.forEach(b => {
      ctx.save();
      ctx.fillStyle = b.color + '18';
      const x1 = toX(Math.max(0, b.low));
      const x2 = toX(Math.min(fMax, b.high));
      ctx.fillRect(x1, PAD.top, x2-x1, cH);
      ctx.restore();
    });

    /* PSD filled area */
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top+cH);
    grad.addColorStop(0,   'rgba(79,156,255,0.6)');
    grad.addColorStop(0.6, 'rgba(79,156,255,0.2)');
    grad.addColorStop(1,   'rgba(79,156,255,0.02)');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(toX(freqs[0]), toY(dB[0]));
    for (let k = 1; k < freqs.length; k++) {
      if (isFinite(dB[k])) ctx.lineTo(toX(freqs[k]), toY(dB[k]));
    }
    ctx.lineTo(toX(freqs[freqs.length-1]), PAD.top+cH);
    ctx.lineTo(toX(freqs[0]), PAD.top+cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(toX(freqs[0]), toY(dB[0]));
    for (let k = 1; k < freqs.length; k++) {
      if (isFinite(dB[k])) ctx.lineTo(toX(freqs[k]), toY(dB[k]));
    }
    ctx.strokeStyle = '#4f9cff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    /* Band labels at top */
    ctx.save();
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    BANDS.forEach(b => {
      const fEnd = Math.min(fMax, b.high);
      if (b.low >= fMax) return;
      const x = toX((b.low + fEnd)/2);
      ctx.fillStyle = b.color;
      ctx.fillText(b.name, x, PAD.top + 12);
    });
    ctx.restore();

    /* X-axis labels */
    ctx.save();
    ctx.fillStyle = 'rgba(160,180,220,0.7)';
    ctx.font      = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    for (let f = 0; f <= fMax; f += 10) {
      ctx.fillText(`${f}Hz`, toX(f), H - 8);
    }
    ctx.restore();

    /* Y-axis labels */
    ctx.save();
    ctx.fillStyle = 'rgba(160,180,220,0.7)';
    ctx.font      = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    for (let db = Math.ceil(minDB/10)*10; db <= maxDB; db += 10) {
      ctx.fillText(`${db}`, PAD.left - 4, toY(db) + 3);
    }
    ctx.restore();

    /* Y-axis title */
    ctx.save();
    ctx.fillStyle = 'rgba(160,180,220,0.7)';
    ctx.font      = '10px Inter, sans-serif';
    ctx.translate(12, PAD.top + cH/2);
    ctx.rotate(-Math.PI/2);
    ctx.textAlign = 'center';
    ctx.fillText('Power (dB)', 0, 0);
    ctx.restore();
  }

  /* ── Draw Band Power bar chart ── */
  function drawBands(canvas, bands) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width  = canvas.offsetWidth  || 400;
    const H = canvas.height = canvas.offsetHeight || 160;
    ctx.clearRect(0, 0, W, H);
    if (!bands || bands.length === 0) return;

    const maxRel = Math.max(...bands.map(b => b.relative), 1);
    const pad = { top:12, bottom:28, left:10, right:10 };
    const barW = (W - pad.left - pad.right) / bands.length;
    const chartH = H - pad.top - pad.bottom;

    bands.forEach((b,i) => {
      const bh = (b.relative / maxRel) * chartH;
      const x  = pad.left + i * barW + barW*0.1;
      const w  = barW * 0.8;
      const y  = pad.top + chartH - bh;

      /* Gradient bar */
      const grad = ctx.createLinearGradient(0, y, 0, y+bh);
      grad.addColorStop(0, b.color);
      grad.addColorStop(1, b.color + '44');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, w, bh, [4,4,0,0]);
      ctx.fill();

      /* % label inside bar */
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      if (bh > 16) ctx.fillText(`${b.relative.toFixed(1)}%`, x+w/2, y+bh-5);

      /* Band name at bottom */
      ctx.fillStyle = b.color;
      ctx.font = '10px Inter, sans-serif';
      ctx.fillText(b.name, x+w/2, H - 8);
    });
  }

  /* ── Populate band table ── */
  function fillBandTable(tbody, bands) {
    tbody.innerHTML = '';
    if (!bands) return;
    bands.forEach(b => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="band-dot" style="background:${b.color}"></span>${b.name}</td>
        <td>${b.low}–${b.high} Hz</td>
        <td>${b.absolute.toExponential(3)}</td>
        <td>${b.relative.toFixed(2)}%</td>`;
      tbody.appendChild(tr);
    });
  }

  return { compute, drawPSD, drawBands, fillBandTable, BANDS };
})();
