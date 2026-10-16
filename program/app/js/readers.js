/* 문서 글자 읽기: PDF(글자), 한글(HWP·HWPX 미리보기 글자), 스캔본(OCR) — 모두 이 PC 안에서 처리 */
(function (root) {
  'use strict';
  const PDFJS_OPTS = { cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 };
  if (root.pdfjsLib) root.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';

  // PDF 글자를 줄 단위로 (글자 간격을 보고 띄어쓰기 복원)
  async function pdfLines(bytes, maxPages = 3) {
    const doc = await root.pdfjsLib.getDocument({ data: bytes.slice(), ...PDFJS_OPTS }).promise;
    const lines = [];
    try {
      for (let p = 1; p <= Math.min(maxPages, doc.numPages); p++) {
        const tc = await (await doc.getPage(p)).getTextContent();
        const rows = [];
        for (const it of tc.items) {
          if (!it.str || !it.str.trim()) continue;
          const y = it.transform[5], x = it.transform[4];
          let r = rows.find((r) => Math.abs(r.y - y) < 4);
          if (!r) { r = { y, its: [] }; rows.push(r); }
          r.its.push({ x, w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 10, s: it.str });
        }
        rows.sort((a, b) => b.y - a.y).forEach((r) => {
          r.its.sort((a, b) => a.x - b.x);
          let s = '', end = null;
          for (const i of r.its) { if (end !== null && i.x - end > i.h * 0.15) s += ' '; s += i.s; end = i.x + i.w; }
          lines.push(s.replace(/\s+/g, ' ').trim());
        });
      }
    } finally { doc.destroy(); }
    return lines;
  }

  // 한글: HWP는 PrvText, HWPX는 Preview/PrvText.txt(없으면 본문 XML)
  function hwpLines(bytes) {
    const r = root.CFB.read(bytes, { type: 'array' });
    const find = (re) => { const i = r.FullPaths.findIndex((p) => re.test(p)); return i >= 0 ? r.FileIndex[i].content : null; };
    let txt = '';
    let c = find(/\/PrvText$/i);
    if (c && c.length) txt = new TextDecoder('utf-16le').decode(new Uint8Array(c));
    if (!txt) { c = find(/\/Preview\/PrvText\.txt$/i); if (c && c.length) txt = new TextDecoder('utf-8').decode(new Uint8Array(c)); }
    if (!txt) { c = find(/\/Contents\/section0\.xml$/i); if (c && c.length) txt = new TextDecoder('utf-8').decode(new Uint8Array(c)).replace(/<\/hp:p>/g, '\n').replace(/<[^>]+>/g, ''); }
    return txt.replace(/></g, ' ').replace(/[<>]/g, ' ').split(/\r?\n/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  // 스캔본: 첫 장을 그림으로 그려 한국어 글자 인식
  let ocrWorker = null, ocrBroken = false;
  async function getOcr() {
    if (ocrWorker) return ocrWorker;
    const abs = (p) => new URL(p, location.href).href;
    ocrWorker = await withTimeout(root.Tesseract.createWorker('kor', 1, {
      workerPath: abs('vendor/tesseract/worker.min.js'), corePath: abs('vendor/tesseract/core'), langPath: abs('vendor/tesseract/lang'),
      workerBlobURL: false, gzip: true, logger: () => {},
    }), 90000, '글자 인식 준비');
    return ocrWorker;
  }
  const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error(what + ' 시간 초과')), ms))]);
  function capCanvas(src, w, h) {
    const s = Math.min(1, 2200 / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  async function firstPageCanvas(bytes, kind, type) {
    if (kind === 'image') {
      const bmp = await createImageBitmap(new Blob([bytes], { type: type || 'image/*' }));
      return capCanvas(bmp, bmp.width, bmp.height);
    }
    const doc = await root.pdfjsLib.getDocument({ data: bytes.slice(), ...PDFJS_OPTS }).promise;
    try {
      const page = await doc.getPage(1); const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, 2200 / Math.max(v1.width, v1.height)) });
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      return c;
    } finally { doc.destroy(); }
  }
  async function ocrLines(bytes, kind, type) {
    if (ocrBroken || !root.Tesseract) return null;
    try {
      const w = await getOcr();
      const { data } = await withTimeout(w.recognize(await firstPageCanvas(bytes, kind, type)), 120000, '글자 인식');
      return String(data.text || '').split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    } catch (e) {
      console.warn('OCR 실패', e);
      if (!ocrWorker) ocrBroken = true;
      return null;
    }
  }

  // 파일 하나 읽기 → { lines, ocr }
  async function read(bytes, kind, type) {
    let lines = [], ocr = false;
    try {
      if (kind === 'pdf') lines = await pdfLines(bytes);
      else if (kind === 'hwp') lines = hwpLines(bytes);
    } catch (e) { console.warn('읽기 실패', e); }
    const textLen = JH.logic.norm(lines.join('')).length;
    if (kind === 'image' || (kind === 'pdf' && textLen < 10)) {
      const o = await ocrLines(bytes, kind, type);
      if (o) { lines = lines.concat(o); ocr = true; }
    }
    return { lines, ocr };
  }

  root.JH = root.JH || {};
  // 문서 전체 글자(공고문 읽기): PDF는 앞 15쪽, 한글은 본문 전체
  async function fullLines(bytes, kind) {
    if (kind === 'pdf') return pdfLines(bytes, 15);
    if (kind === 'hwp') return JH.hwp.fullLines(root.CFB, bytes);
    return [];
  }
  root.JH.readers = { read, fullLines, pdfLines, hwpLines, ocrLines, get ocrBroken() { return ocrBroken; } };
})(window);
