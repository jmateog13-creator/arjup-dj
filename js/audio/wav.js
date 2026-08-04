/* WAV ENCODER · PCM 16-bit estèreo → Blob (v2, §13).
   Rep arrays de chunks Float32 (L i R) i el sample rate. */

/**
 * @param {Float32Array[]} lChunks
 * @param {Float32Array[]} rChunks
 * @param {number} sampleRate
 * @returns {Blob} audio/wav
 */
export function encodeWav(lChunks, rChunks, sampleRate) {
  let total = 0;
  for (const c of lChunks) total += c.length;

  const bytesPerSample = 2;
  const blockAlign = 2 * bytesPerSample;      // 2 canals
  const dataLen = total * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);

  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);               // mida del fmt
  view.setUint16(20, 1, true);                // PCM
  view.setUint16(22, 2, true);                // canals
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);               // bits/sample
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);

  let off = 44;
  const clamp = (v) => v < -1 ? -1 : v > 1 ? 1 : v;
  for (let k = 0; k < lChunks.length; k++) {
    const L = lChunks[k], R = rChunks[k];
    for (let i = 0; i < L.length; i++) {
      view.setInt16(off, clamp(L[i]) * 0x7fff | 0, true); off += 2;
      view.setInt16(off, clamp(R[i]) * 0x7fff | 0, true); off += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export default encodeWav;
