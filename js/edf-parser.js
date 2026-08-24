'use strict';
/* =====================================================================
   edf-parser.js  —  EDF / EDF+ binary parser
   ===================================================================== */

const EDFParser = (() => {

  function parseText(bytes, start, len) {
    let s = '';
    for (let i = start; i < start + len; i++) s += String.fromCharCode(bytes[i]);
    return s.trim();
  }
  function parseFloat_(bytes, start, len) { return parseFloat(parseText(bytes, start, len)) || 0; }
  function parseInt_(bytes, start, len)   { return parseInt(parseText(bytes, start, len), 10) || 0; }

  function _readField(bytes, off, ns, fl) {
    const arr = [];
    for (let i = 0; i < ns; i++) arr.push(parseText(bytes, off + i * fl, fl));
    return arr;
  }
  function _readFieldFloat(bytes, off, ns, fl) { return _readField(bytes,off,ns,fl).map(s=>parseFloat(s)||0); }
  function _readFieldInt(bytes, off, ns, fl)   { return _readField(bytes,off,ns,fl).map(s=>parseInt(s,10)||0); }

  function parse(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const header = {
      version:        parseText(bytes, 0,   8),
      patient:        parseText(bytes, 8,   80),
      recording:      parseText(bytes, 88,  80),
      startDate:      parseText(bytes, 168, 8),
      startTime:      parseText(bytes, 176, 8),
      headerBytes:    parseInt_(bytes, 184, 8),
      reserved:       parseText(bytes, 192, 44),
      numRecords:     parseInt_(bytes, 236, 8),
      recordDuration: parseFloat_(bytes, 244, 8),
      numSignals:     parseInt_(bytes, 252, 4),
    };
    const ns = header.numSignals;

    let off = 256;
    const labels        = _readField(bytes, off, ns, 16); off += ns*16;
    const transducers   = _readField(bytes, off, ns, 80); off += ns*80;
    const physDims      = _readField(bytes, off, ns, 8);  off += ns*8;
    const physMins      = _readFieldFloat(bytes, off, ns, 8); off += ns*8;
    const physMaxs      = _readFieldFloat(bytes, off, ns, 8); off += ns*8;
    const digMins       = _readFieldInt(bytes, off, ns, 8);   off += ns*8;
    const digMaxs       = _readFieldInt(bytes, off, ns, 8);   off += ns*8;
    const prefilters    = _readField(bytes, off, ns, 80); off += ns*80;
    const numSampArr    = _readFieldInt(bytes, off, ns, 8);   off += ns*8;

    const signals = [];
    for (let i = 0; i < ns; i++) {
      const dRange = (digMaxs[i] - digMins[i]) || 1;
      const gain   = (physMaxs[i] - physMins[i]) / dRange;
      const offset = physMins[i] - gain * digMins[i];
      signals.push({
        index: i,
        label: labels[i],
        transducer: transducers[i],
        physDim: physDims[i],
        physMin: physMins[i],
        physMax: physMaxs[i],
        digMin: digMins[i],
        digMax: digMaxs[i],
        prefilter: prefilters[i],
        numSamplesPerRecord: numSampArr[i],
        sampleRate: header.recordDuration > 0 ? numSampArr[i] / header.recordDuration : 0,
        gain, offset,
        isAnnotation: labels[i].toLowerCase().replace(/\s/g,'') === 'edfannotations',
        data: null,
      });
    }

    const view = new DataView(arrayBuffer);
    const writePos = new Array(ns).fill(0);
    let dataOff = header.headerBytes;

    for (let i = 0; i < ns; i++) {
      const n = numSampArr[i] * header.numRecords;
      signals[i].data = signals[i].isAnnotation ? new Uint8Array(n*2) : new Float32Array(n);
    }

    for (let rec = 0; rec < header.numRecords; rec++) {
      for (let sig = 0; sig < ns; sig++) {
        const n = signals[sig].numSamplesPerRecord;
        const { gain, offset, isAnnotation } = signals[sig];
        if (isAnnotation) {
          for (let s = 0; s < n; s++) {
            signals[sig].data[writePos[sig]++] = bytes[dataOff];
            signals[sig].data[writePos[sig]++] = bytes[dataOff+1];
            dataOff += 2;
          }
        } else {
          for (let s = 0; s < n; s++) {
            signals[sig].data[writePos[sig]++] = view.getInt16(dataOff, true) * gain + offset;
            dataOff += 2;
          }
        }
      }
    }

    return {
      header,
      signals,
      totalDuration: header.numRecords * header.recordDuration,
      isEDFPlus: header.reserved.startsWith('EDF+'),
      originalBuffer: arrayBuffer,
    };
  }

  function formatDuration(s) {
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  return { parse, formatDuration };
})();
