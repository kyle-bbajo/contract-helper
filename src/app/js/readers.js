/* 문서 글자 읽기: PDF(글자), 한글(HWP·HWPX 미리보기 글자), 스캔본(OCR) — 모두 이 PC 안에서 처리 */
(function (root) {
  'use strict';
  const PDFJS_OPTS = { cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 };
  // 큰 라이브러리(PDF 읽기·만들기, 글자 인식)는 처음 쓸 때 불러옴 — 켜기가 빨라짐
  const LIBS = { pdfjs: ['vendor/pdfjs/pdf.min.js', () => root.pdfjsLib], pdflib: ['vendor/pdf-lib.min.js', () => root.PDFLib], tesseract: ['vendor/tesseract/tesseract.min.js', () => root.Tesseract], formtpl: ['js/forms-tpl.js', () => root.JH && root.JH.formTpl] };
  const loading = {};
  function lib(name) {
    const [src, get] = LIBS[name];
    if (get()) return Promise.resolve(get());
    loading[name] = loading[name] || new Promise((res, rej) => {
      const el = document.createElement('script'); el.src = src;
      el.onload = () => { if (name === 'pdfjs') root.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js'; res(get()); };
      el.onerror = () => { delete loading[name]; rej(new Error(src + '을 불러오지 못했습니다')); };
      document.head.append(el);
    });
    return loading[name];
  }
  root.JH = root.JH || {}; root.JH.lib = lib;
  const pdfjs = () => lib('pdfjs');

  // PDF 글자를 줄 단위로 (글자 간격을 보고 띄어쓰기 복원)
  async function pdfLines(bytes, maxPages = 3) {
    const doc = await (await pdfjs()).getDocument({ data: bytes.slice(), ...PDFJS_OPTS }).promise;
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
    const T = await lib('tesseract');
    ocrWorker = await withTimeout(T.createWorker('kor', 1, {
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
  async function firstPageCanvas(bytes, kind, type, pageNo = 1) {
    if (kind === 'image') {
      const bmp = await createImageBitmap(new Blob([bytes], { type: type || 'image/*' }));
      return capCanvas(bmp, bmp.width, bmp.height);
    }
    const doc = await (await pdfjs()).getDocument({ data: bytes.slice(), ...PDFJS_OPTS }).promise;
    try {
      if (pageNo > doc.numPages) return null;
      const page = await doc.getPage(pageNo); const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, 2200 / Math.max(v1.width, v1.height)) });
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      return c;
    } finally { doc.destroy(); }
  }
  // 스캔이 옆으로·거꾸로 들어온 경우가 많음: 바로 읽어 보고 글자가 엉망이면(신뢰도 낮음) 180·90·270도 돌려 가장 잘 읽히는 쪽을 씀
  function rotated(src, deg) {
    const c = document.createElement('canvas'), g = c.getContext('2d');
    const side = deg % 180 !== 0; c.width = side ? src.height : src.width; c.height = side ? src.width : src.height;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.translate(c.width / 2, c.height / 2); g.rotate((deg * Math.PI) / 180); g.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }
  // 글자 품질: tesseract 신뢰도 + 한글 낱말(두 글자 이상 이어진 한글) 비율
  function quality(data) {
    const t = String((data && data.text) || '');
    const words = t.match(/[가-힣]{2,}/g) || [], junk = t.match(/[^가-힣0-9a-zA-Z\s.,:()\-·~%원㈜]/g) || [];
    const hangul = words.join('').length;
    return { conf: (data && data.confidence) || 0, score: ((data && data.confidence) || 0) + Math.min(30, hangul / 3) - Math.min(30, junk.length / 2), hangul };
  }
  async function recognize(w, canvas) {
    const { data } = await withTimeout(w.recognize(canvas), 120000, '글자 인식');
    return { text: String(data.text || ''), ...quality(data) };
  }
  async function ocrLines(bytes, kind, type) {
    if (ocrBroken) return null;
    try {
      const w = await getOcr();
      const readPage = async (n) => {
        const canvas = await firstPageCanvas(bytes, kind, type, n); if (!canvas) return null;
        let best = await recognize(w, canvas);
        if (best.conf < 75) {
          for (const deg of [180, 90, 270]) {
            const r = await recognize(w, rotated(canvas, deg));
            if (r.score > best.score + 8) best = { ...r, deg };
            if (best.conf >= 80) break;
          }
        }
        return best;
      };
      let best = await readPage(1);
      // 첫 장이 빈 장·팩스 표지라 글자가 거의 없으면 둘째 장도
      if (kind === 'pdf' && best && best.hangul < 10) { const b2 = await readPage(2); if (b2 && b2.hangul > best.hangul) best = { ...b2, text: b2.text + (best.hangul ? '\n' + best.text : '') }; } // 글자가 많은 장을 앞에(제목으로 씀)
      return best ? best.text.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean) : null;
    } catch (e) {
      console.warn('OCR 실패', e);
      if (!ocrWorker) ocrBroken = true;
      return null;
    }
  }

  // 파일 하나 읽기 → { lines, ocr }
  // 엑셀(.xlsx)·워드(.docx): 압축 안 XML의 글자만(견적서·산출내역서를 엑셀로 받는 경우 등). .xls(옛 형식)는 글자를 못 읽고 파일 이름으로 분류
  function officeLines(bytes) {
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return [];
    const z = root.CFB.read(bytes, { type: 'array' });
    const txt = (re) => z.FullPaths.map((p, i) => [p, i]).filter(([p]) => re.test(p)).map(([, i]) => new TextDecoder('utf-8').decode(new Uint8Array(z.FileIndex[i].content || [])));
    const un = (x) => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
    const out = [];
    // 엑셀: 공유 문자열 + 칸에 바로 든 글자, 숫자는 시트에서
    for (const x of txt(/\/xl\/sharedStrings\.xml$/i)) for (const m of x.matchAll(/<si>([\s\S]*?)<\/si>/g)) { const t = un([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((y) => y[1]).join('')).trim(); if (t) out.push(t); }
    for (const x of txt(/\/xl\/worksheets\/sheet\d+\.xml$/i).slice(0, 5)) for (const row of x.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const vals = [...row[1].matchAll(/<c[^>]*?(?:t="(\w+)")?[^>]*>(?:<f>[^<]*<\/f>)?(?:<v>([^<]*)<\/v>|<is>[\s\S]*?<t[^>]*>([^<]*)<\/t>[\s\S]*?<\/is>)/g)].filter((c) => c[1] !== 's').map((c) => un(c[2] || c[3] || '').trim()).filter(Boolean);
      if (vals.length) out.push(vals.join(' '));
    }
    // 워드: 문단마다
    for (const x of txt(/\/word\/document\.xml$/i)) for (const p of x.split(/<\/w:p>/)) { const t = un([...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((y) => y[1]).join('')).trim(); if (t) out.push(t); }
    return out.slice(0, 2000);
  }
  async function read(bytes, kind, type) {
    let lines = [], ocr = false;
    try {
      if (kind === 'pdf') lines = await pdfLines(bytes);
      // 한글: 본문 글자 전체(표 안 글자 포함). 본문을 못 읽으면(암호 등) 미리보기 글자
      else if (kind === 'hwp') { try { lines = await JH.hwp.fullLines(root.CFB, bytes); } catch (_) { lines = []; } if (!lines.length) lines = hwpLines(bytes); }
      else if (kind === 'other') lines = officeLines(bytes);
    } catch (e) { console.warn('읽기 실패', e); }
    // 스캔 PDF에 스캐너 앱 글씨(CamScanner 등)만 글자로 들어 있는 경우가 있어 '한글이 거의 없으면' 글자 인식
    const hangul = (lines.join('').match(/[가-힣]/g) || []).length;
    if (kind === 'image' || (kind === 'pdf' && hangul < 8)) {
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
  // 쪽마다 앞부분 글자(여러 양식이 든 파일에서 쪽별 서류 이름 찾기). 글자 PDF는 40쪽까지, 스캔 PDF는 8쪽까지 위쪽만 글자 인식
  async function pageHeads(bytes, kind) {
    if (kind !== 'pdf') return null;
    const doc = await (await pdfjs()).getDocument({ data: bytes.slice(), ...PDFJS_OPTS }).promise;
    const heads = [];
    try {
      const n = Math.min(40, doc.numPages);
      if (n < 2) return null;
      let scanned = 0;
      for (let p = 1; p <= n; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const rows = [];
        for (const it of tc.items) { if (!it.str || !it.str.trim()) continue; const y = it.transform[5]; let r = rows.find((q) => Math.abs(q.y - y) < 4); if (!r) rows.push(r = { y, s: [] }); r.s.push({ x: it.transform[4], t: it.str }); }
        rows.sort((a, b) => b.y - a.y);
        let head = rows.slice(0, 8).map((r) => r.s.sort((a, b) => a.x - b.x).map((x) => x.t).join(' ')).join(' ');
        if (JH.logic.norm(head).length < 4 && scanned < 8 && !ocrBroken) {
          // 스캔본: 쪽 위쪽 30%만 그려 글자 인식
          scanned++;
          try {
            const v1 = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: Math.min(2, 1600 / Math.max(v1.width, v1.height)) });
            const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
            const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: g, viewport: vp }).promise;
            const top = document.createElement('canvas'); top.width = c.width; top.height = Math.ceil(c.height * 0.3);
            top.getContext('2d').drawImage(c, 0, 0);
            const w = await getOcr();
            const { data } = await withTimeout(w.recognize(top), 60000, '글자 인식');
            head = String(data.text || '').replace(/\s+/g, ' ').trim();
          } catch (e) { console.warn('쪽 글자 인식 실패', p, e); }
        }
        heads.push(head);
      }
    } finally { doc.destroy(); }
    return heads;
  }
  root.JH.readers = { read, officeLines, fullLines, pdfLines, hwpLines, ocrLines, pageHeads, get ocrBroken() { return ocrBroken; } };
})(window);
