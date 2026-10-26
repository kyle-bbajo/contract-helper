/*
 * 한글 문서 글자 읽기(브라우저·Node 공용)
 *  - HWP(5.0): BodyText/Section* 레코드의 문단 글자(HWPTAG_PARA_TEXT)를 전부 읽음. 미리보기(PrvText)는 앞부분만 있어서 공고문 전체를 읽을 때는 이것을 씀
 *  - HWPX: Contents/section*.xml 의 글자
 *  - 암호가 걸렸거나 배포용 문서는 본문을 읽을 수 없어 미리보기만 씀
 */
(function (root) {
  'use strict';
  // 압축 풀기. 압축 끝 뒤에 찌꺼기 바이트가 붙은 문서(전자결재 .hwx 안의 한글 등)는 브라우저가 오류를 내므로, 그때까지 푼 것을 씀
  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const reader = new Blob([u8]).stream().pipeThrough(ds).getReader();
    const parts = []; let n = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; } }
    catch (e) { if (!n) throw e; }
    const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  // 문단 글자: 0~31은 제어 문자. 1칸짜리(줄바꿈 등)와 8칸짜리(표·그림 등 개체)가 있음
  const ONE = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);
  function paraText(b) {
    let s = '';
    for (let j = 0; j + 1 < b.length;) {
      const c = b[j] | (b[j + 1] << 8);
      if (c < 32) {
        if (ONE.has(c)) { if (c === 10) s += '\n'; else if (c === 30 || c === 31 || c === 24) s += ' '; j += 2; }
        else { if (c === 9) s += '\t'; j += 16; }
      } else { s += String.fromCharCode(c); j += 2; }
    }
    return s;
  }
  function records(data, want) {
    const out = [];
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let i = 0;
    while (i + 4 <= data.length) {
      const h = dv.getUint32(i, true); i += 4;
      const tag = h & 0x3ff; let size = (h >>> 20) & 0xfff;
      if (size === 0xfff) { if (i + 4 > data.length) break; size = dv.getUint32(i, true); i += 4; }
      if (tag === want) out.push(data.subarray(i, i + size));
      i += size;
    }
    return out;
  }
  const entryOf = (z, re) => { const i = z.FullPaths.findIndex((p) => re.test(p)); return i >= 0 ? new Uint8Array(z.FileIndex[i].content) : null; };
  const prv = (z) => {
    let c = entryOf(z, /\/PrvText$/i); if (c && c.length) return new TextDecoder('utf-16le').decode(c);
    c = entryOf(z, /\/Preview\/PrvText\.txt$/i); if (c && c.length) return new TextDecoder('utf-8').decode(c);
    return '';
  };
  const toLines = (t) => t.replace(/></g, ' ').replace(/[<>]/g, ' ').split(/\r?\n/).map((s) => s.replace(/[\t ]+/g, ' ').trim()).filter(Boolean);

  // 전체 글자(가능하면 본문, 안 되면 미리보기)
  async function fullLines(CFB, bytes) {
    const z = CFB.read(bytes, { type: 'array' });
    // HWPX
    const secs = z.FullPaths.map((p, i) => [p, i]).filter(([p]) => /\/Contents\/section\d+\.xml$/i.test(p))
      .sort((a, b) => Number(a[0].match(/(\d+)\.xml$/i)[1]) - Number(b[0].match(/(\d+)\.xml$/i)[1]));
    if (secs.length) {
      const t = secs.map(([, i]) => new TextDecoder('utf-8').decode(new Uint8Array(z.FileIndex[i].content))
        .replace(/<\/hp:p>/g, '\n').replace(/<hp:tab[^>]*\/>/g, '\t').replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')).join('\n');
      return toLines(t);
    }
    // HWP
    const fh = entryOf(z, /\/FileHeader$/);
    const flags = fh && fh.length > 36 ? fh[36] : 0;
    const compressed = (flags & 1) === 1, locked = (flags & 2) === 2 || (flags & 4) === 4;
    const bodies = z.FullPaths.map((p, i) => [p, i]).filter(([p]) => /\/BodyText\/Section\d+$/i.test(p))
      .sort((a, b) => Number(a[0].match(/(\d+)$/)[1]) - Number(b[0].match(/(\d+)$/)[1]));
    if (!locked && bodies.length) {
      try {
        let t = '';
        for (const [, i] of bodies) {
          let data = new Uint8Array(z.FileIndex[i].content);
          if (compressed) data = await inflateRaw(data);
          for (const r of records(data, 67)) t += paraText(r) + '\n';
        }
        const lines = toLines(t);
        if (lines.length) return lines;
      } catch (e) { /* 본문을 못 읽으면 미리보기 */ }
    }
    return toLines(prv(z));
  }
  function previewLines(CFB, bytes) { return toLines(prv(CFB.read(bytes, { type: 'array' }))); }

  const api = { fullLines, previewLines, paraText, records };
  root.JH = root.JH || {};
  root.JH.hwp = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
