'use strict';
/* =====================================================================
   exporter.js  —  Export: JSON annotations, EDF+ with TAL, HTML report
   ===================================================================== */

const Exporter = (() => {

  /* ── Trigger browser download ── */
  function _download(blob, filename) {
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href  = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /* ══════════════════════════════════════════════════
     1.  Annotations → CSV
  ══════════════════════════════════════════════════ */
  function exportAnnotationsCSV(annotations, filename) {
    if (annotations.length === 0) return;
    
    let csvContent = "id,label,startTime,endTime,duration,color,notes\n";
    
    annotations.forEach(a => {
      const id = a.id;
      const label = `"${a.label.replace(/"/g, '""')}"`;
      const startTime = a.startTime;
      const endTime = a.endTime;
      const duration = +(a.endTime - a.startTime).toFixed(6);
      const color = a.color;
      const notes = a.notes ? `"${a.notes.replace(/"/g, '""')}"` : '""';
      
      csvContent += `${id},${label},${startTime},${endTime},${duration},${color},${notes}\n`;
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    _download(blob, (filename || 'annotations') + '_annotations.csv');
  }

  /* ══════════════════════════════════════════════════
     2.  EDF+ with embedded TAL annotations
     Spec: MdC EDF+ draft (2003)
  ══════════════════════════════════════════════════ */
  function exportAnnotatedEDF(edfData, annotations, filename) {
    const orig      = new Uint8Array(edfData.originalBuffer);
    const hdr       = edfData.header;
    const ns        = hdr.numSignals;
    const nRec      = hdr.numRecords;
    const recDur    = hdr.recordDuration;

    /* ---- Build TAL strings per data record ---- */
    /* Format: "+onset\x14duration\x14text\x15" */
    /* Every record needs at least a timing TAL   */
    const talPerRecord = [];
    for (let r = 0; r < nRec; r++) {
      const recStart = r * recDur;
      let tal = `+${recStart.toFixed(6)}\x14\x14\x15`;  // timing TAL
      annotations.forEach(ann => {
        if (ann.startTime >= recStart && ann.startTime < recStart + recDur) {
          const dur = (ann.endTime - ann.startTime).toFixed(6);
          const text = ann.label + (ann.notes ? ' | ' + ann.notes : '');
          tal += `+${ann.startTime.toFixed(6)}\x14${dur}\x14${text}\x15`;
        }
      });
      talPerRecord.push(tal);
    }

    /* Determine annotation channel size: max TAL per record, rounded to even bytes */
    const maxTalLen = Math.max(...talPerRecord.map(t => t.length));
    const annBytesPerRecord = Math.max(40, (maxTalLen + 1 + 1) & ~1); // even
    const annSamplesPerRecord = annBytesPerRecord / 2;  // int16 samples

    /* ---- New header bytes ---- */
    const newNs          = ns + 1;
    const newHeaderBytes = 256 + newNs * 256;

    /* ---- Signal sample counts per original record ---- */
    const origSigSamples = edfData.signals.map(s => s.numSamplesPerRecord);
    const origBytesPerRecord = origSigSamples.reduce((a,b) => a+b, 0) * 2;

    /* ---- Allocate output buffer ---- */
    const newBytesPerRecord  = origBytesPerRecord + annBytesPerRecord;
    const totalSize          = newHeaderBytes + nRec * newBytesPerRecord;
    const out = new Uint8Array(totalSize);

    /* ---- Copy & patch global header ---- */
    out.set(orig.subarray(0, 256));
    // Reserved → EDF+C
    _writeASCII(out, 192, 'EDF+C', 44);
    // NumSignals
    _writeASCII(out, 252, String(newNs), 4);
    // Header bytes
    _writeASCII(out, 184, String(newHeaderBytes), 8);

    /* ---- Copy original signal headers ---- */
    // Each field block: original ns values then our annotation row appended
    const FIELDS = [
      { off:256,              len:16, val:'EDF Annotations' },
      { off:256+newNs*16,     len:80, val:'' },
      { off:256+newNs*96,     len:8,  val:'' },
      { off:256+newNs*104,    len:8,  val:'-1' },
      { off:256+newNs*112,    len:8,  val:'1' },
      { off:256+newNs*120,    len:8,  val:'-32768' },
      { off:256+newNs*128,    len:8,  val:'32767' },
      { off:256+newNs*136,    len:80, val:'' },
      { off:256+newNs*216,    len:8,  val:String(annSamplesPerRecord) },
      { off:256+newNs*224,    len:32, val:'' },
    ];

    // Copy field-by-field from original header
    const fieldOffsets = [
      { srcOff: 256,       fl: 16, count: ns },   // labels
      { srcOff: 256+ns*16, fl: 80, count: ns },   // transducers
      { srcOff: 256+ns*96, fl: 8,  count: ns },   // physDims
      { srcOff: 256+ns*104,fl: 8,  count: ns },   // physMins
      { srcOff: 256+ns*112,fl: 8,  count: ns },   // physMaxs
      { srcOff: 256+ns*120,fl: 8,  count: ns },   // digMins
      { srcOff: 256+ns*128,fl: 8,  count: ns },   // digMaxs
      { srcOff: 256+ns*136,fl: 80, count: ns },   // prefilters
      { srcOff: 256+ns*216,fl: 8,  count: ns },   // numSamples
      { srcOff: 256+ns*224,fl: 32, count: ns },   // reserved2
    ];

    const annFieldValues = [
      'EDF Annotations', '', '', '-1', '1', '-32768', '32767', '',
      String(annSamplesPerRecord), '',
    ];

    let dstOff = 256;
    fieldOffsets.forEach(({ srcOff, fl, count }, fi) => {
      // Original ns values
      out.set(orig.subarray(srcOff, srcOff + count*fl), dstOff);
      dstOff += count * fl;
      // Annotation channel value
      _writeASCII(out, dstOff, annFieldValues[fi], fl);
      dstOff += fl;
    });

    /* ---- Copy data records with annotation channel appended ── */
    let srcDataOff = hdr.headerBytes;
    let dstDataOff = newHeaderBytes;

    for (let r = 0; r < nRec; r++) {
      // Copy original signals for this record
      out.set(orig.subarray(srcDataOff, srcDataOff + origBytesPerRecord), dstDataOff);
      srcDataOff += origBytesPerRecord;
      dstDataOff += origBytesPerRecord;

      // Write TAL into annotation channel bytes (zero-padded)
      const tal    = talPerRecord[r];
      const talBytes = _encodeASCII(tal, annBytesPerRecord);
      out.set(talBytes, dstDataOff);
      dstDataOff += annBytesPerRecord;
    }

    const blob = new Blob([out.buffer], { type: 'application/octet-stream' });
    _download(blob, (filename || 'recording') + '_annotated.edf');
  }

  /* ══════════════════════════════════════════════════
     3.  HTML Report
  ══════════════════════════════════════════════════ */
  function exportHTMLReport(edfData, annotations, edaResult, filename) {
    const hdr  = edfData.header;
    const sigs = edfData.signals.filter(s => !s.isAnnotation);

    const annRows = annotations.map(a => `
      <tr>
        <td><span class="dot" style="background:${a.color}"></span>${_esc(a.label)}</td>
        <td>${a.startTime.toFixed(3)}s</td>
        <td>${a.endTime.toFixed(3)}s</td>
        <td>${(a.endTime-a.startTime).toFixed(3)}s</td>
        <td>${_esc(a.notes||'—')}</td>
      </tr>`).join('');

    const chRows = sigs.map(s => `
      <tr>
        <td>${_esc(s.label)}</td>
        <td>${s.sampleRate.toFixed(1)} Hz</td>
        <td>${_esc(s.physDim)}</td>
        <td>${s.physMin} – ${s.physMax}</td>
        <td>${_esc(s.prefilter||'—')}</td>
      </tr>`).join('');

    const bandRows = (edaResult && edaResult.bands) ? edaResult.bands.map(b => `
      <tr>
        <td><span class="dot" style="background:${b.color}"></span>${b.name}</td>
        <td>${b.low}–${b.high} Hz</td>
        <td>${b.absolute.toExponential(3)}</td>
        <td>${b.relative.toFixed(2)}%</td>
      </tr>`).join('') : '<tr><td colspan="4">EDA not computed</td></tr>';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>EEG Report — ${_esc(filename || 'Recording')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6fb;color:#1a2240;padding:32px}
  h1{font-size:22px;font-weight:700;color:#1a2240;margin-bottom:4px}
  h2{font-size:15px;font-weight:600;color:#2d4a8a;margin:24px 0 10px;padding-bottom:4px;border-bottom:2px solid #d0d9ee}
  .meta{font-size:12px;color:#5a6a8a;margin-bottom:24px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px}
  th{background:#1a2240;color:#fff;padding:8px 10px;text-align:left;font-weight:500}
  td{padding:7px 10px;border-bottom:1px solid #dde3f0}
  tr:nth-child(even) td{background:#f0f3fa}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
  .footer{margin-top:32px;font-size:11px;color:#9aabbf}
</style>
</head>
<body>
<h1>EEG Recording Report</h1>
<p class="meta">Generated: ${new Date().toLocaleString()} | File: ${_esc(filename||'—')}</p>

<h2>Recording Information</h2>
<table>
  <tr><th>Field</th><th>Value</th></tr>
  <tr><td>Patient</td><td>${_esc(hdr.patient||'—')}</td></tr>
  <tr><td>Recording</td><td>${_esc(hdr.recording||'—')}</td></tr>
  <tr><td>Date</td><td>${_esc(hdr.startDate||'—')}</td></tr>
  <tr><td>Time</td><td>${_esc(hdr.startTime||'—')}</td></tr>
  <tr><td>Duration</td><td>${EDFParser.formatDuration(edfData.totalDuration)}</td></tr>
  <tr><td>Channels</td><td>${sigs.length}</td></tr>
</table>

<h2>Channels (${sigs.length})</h2>
<table>
  <tr><th>Label</th><th>Sample Rate</th><th>Unit</th><th>Range</th><th>Prefilter</th></tr>
  ${chRows}
</table>

<h2>Band Power Analysis</h2>
<table>
  <tr><th>Band</th><th>Frequency Range</th><th>Absolute (unit²/Hz)</th><th>Relative</th></tr>
  ${bandRows}
</table>

<h2>Annotations (${annotations.length})</h2>
<table>
  <tr><th>Label</th><th>Start</th><th>End</th><th>Duration</th><th>Notes</th></tr>
  ${annRows || '<tr><td colspan="5">No annotations</td></tr>'}
</table>

<div class="footer">Generated by EEG Annotator</div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    _download(blob, (filename || 'recording') + '_report.html');
  }

  /* ── Helpers ── */
  function _writeASCII(buf, offset, str, fieldLen) {
    const padded = str.padEnd(fieldLen, ' ').substring(0, fieldLen);
    for (let i = 0; i < fieldLen; i++) buf[offset + i] = padded.charCodeAt(i) || 32;
  }

  function _encodeASCII(str, byteLen) {
    const out = new Uint8Array(byteLen);
    for (let i = 0; i < Math.min(str.length, byteLen); i++) {
      out[i] = str.charCodeAt(i) & 0xFF;
    }
    return out;
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { exportAnnotationsCSV, exportAnnotatedEDF, exportHTMLReport };
})();
