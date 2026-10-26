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
    const s = Math.min(1, 1800 / Math.max(w, h));
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
      const vp = page.getViewport({ scale: Math.min(3, 1800 / Math.max(v1.width, v1.height)) }); // 1800px: 제목·계약명은 충분히 읽히고 빠름
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
  // 화면을 찍은 사진·망점 스캔(모아레·점무늬)은 그대로면 글자를 거의 못 읽고 아주 느림 → 흑백 + 살짝 흐리게 해서 점무늬를 지우고 읽음
  function cleaned(src) {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.filter = `grayscale(1) blur(${Math.max(0.8, Math.max(src.width, src.height) / 1400).toFixed(2)}px)`;
    g.drawImage(src, 0, 0); g.filter = 'none';
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
        const raw = await firstPageCanvas(bytes, kind, type, n); if (!raw) return null;
        const canvas = cleaned(raw); // 점무늬 지운 그림으로 읽음(망점 스캔은 그대로면 1분 넘게 걸리고 거의 못 읽음, 지우면 몇 초)
        let best = await recognize(w, canvas);
        if (best.conf < 55) { // 점무늬를 지우면 바로 선 종이는 보통 60 넘음 — 그보다 낮을 때만 돌려 봄(돌릴 때마다 한 쪽을 다시 읽어 느림)
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

  // 글자로 된 문서(HWPML·HTML·MHT·XML): 태그를 걷어 내고 글자만. 한글 인코딩(EUC-KR)도
  function markupLines(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const head = new TextDecoder('latin1').decode(u8.subarray(0, 600));
    if (!/^\s*(<|\ufeff<|\xef\xbb\xbf<|MIME-Version|From:|Content-Type)/i.test(head) && !/<(\?xml|html|HWPML)/i.test(head)) return [];
    const dec = (b, cs) => { try { return new TextDecoder(cs || 'utf-8', { fatal: !cs }).decode(b); } catch (_) { return new TextDecoder('euc-kr').decode(b); } };
    let csm = head.match(/charset\s*=\s*["']?([\w-]+)/i) || head.match(/encoding\s*=\s*["']([\w-]+)/i);
    let t = dec(u8, csm && !/utf-?8/i.test(csm[1]) ? csm[1].toLowerCase().replace('ks_c_5601-1987', 'euc-kr') : '');
    if (/^\s*(MIME-Version|From:|Content-Type)/i.test(head)) {
      // MHT: html 부분만(quoted-printable·base64 풀기)
      const part = t.split(/\r?\n--[^\r\n]+/).find((x) => /Content-Type:\s*text\/html/i.test(x)) || t;
      const body = part.replace(/^[\s\S]*?\r?\n\r?\n/, '');
      if (/Content-Transfer-Encoding:\s*base64/i.test(part)) { try { const raw = Uint8Array.from(atob(body.replace(/\s+/g, '')), (c) => c.charCodeAt(0)); const cs2 = part.match(/charset\s*=\s*["']?([\w-]+)/i); t = dec(raw, cs2 && !/utf-?8/i.test(cs2[1]) ? 'euc-kr' : ''); } catch (_) { t = body; } }
      else if (/quoted-printable/i.test(part)) { const bs = []; const q = body.replace(/=\r?\n/g, ''); for (let i = 0; i < q.length; i++) { if (q[i] === '=' && /^[0-9A-F]{2}$/i.test(q.substr(i + 1, 2))) { bs.push(parseInt(q.substr(i + 1, 2), 16)); i += 2; } else bs.push(q.charCodeAt(i) & 255); } const cs2 = part.match(/charset\s*=\s*["']?([\w-]+)/i); t = dec(new Uint8Array(bs), cs2 && !/utf-?8/i.test(cs2[1]) ? 'euc-kr' : ''); }
      else t = body;
    }
    t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|tr|li|h\d|P|TEXT|PARAGRAPH)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
    return t.split(/\r?\n/).map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x && /[가-힣A-Za-z0-9]/.test(x)).slice(0, 3000);
  }
  // 파일 하나 읽기 → { lines, ocr }
  // 엑셀(.xlsx)·워드(.docx): 압축 안 XML의 글자만(견적서·산출내역서를 엑셀로 받는 경우 등). .xls(옛 형식)는 글자를 못 읽고 파일 이름으로 분류
  // 옛 엑셀·워드(.xls·.doc, OLE 형식): 정확한 표 구조는 못 읽어도 안에 든 한글 글자(UTF-16)를 뽑아 분류에 씀
  function oldOfficeLines(bytes) {
    if (!(bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)) return [];
    const z = root.CFB.read(bytes, { type: 'array' });
    const i = z.FullPaths.findIndex((p) => /\/(Workbook|Book|WordDocument)$/i.test(p));
    if (i < 0) return [];
    const c = new Uint8Array(z.FileIndex[i].content || []);
    const txt = new TextDecoder('utf-16le').decode(c.subarray(0, c.length - (c.length % 2)));
    const odd = c.length > 1 ? new TextDecoder('utf-16le').decode(c.subarray(1, c.length - ((c.length - 1) % 2))) : ''; // 글자가 홀수 자리에서 시작하는 경우
    const runs = (t) => t.match(/[가-힣][가-힣0-9A-Za-z\s()·.,\-~%/]{1,80}/g) || [];
    return [...runs(txt), ...runs(odd)].map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => (x.match(/[가-힣]/g) || []).length >= 2).slice(0, 2000);
  }
  function officeLines(bytes) {
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) { try { return oldOfficeLines(bytes); } catch (_) { return []; } }
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
      else if (kind === 'hwp') {
        try { lines = await JH.hwp.fullLines(root.CFB, bytes); } catch (_) { lines = []; }
        if (!lines.length) { try { lines = hwpLines(bytes); } catch (_) { lines = []; } }
        if (!lines.length) lines = markupLines(bytes); // 그룹웨어(BizFlow 등)에서 받은 결재문서: 확장자만 .hwp이고 속은 HWPML(XML)·HTML·MHT인 경우
      }
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
  // opt: { max: 읽을 쪽 수, ocrMax: 글자 인식할 스캔 쪽 수, onPage(p, n): 진행 알림 } — 쪽별로 나누기에서는 전체 쪽을 읽음
  // 돌려주는 배열에 .rows(쪽마다 위쪽 줄들)와 .total(모든 쪽 수)도 붙임
  async function pageHeads(bytes, kind, opt = {}) {
    if (kind !== 'pdf') return null;
    const doc = await (await pdfjs()).getDocument({ data: bytes.slice(), ...PDFJS_OPTS }).promise;
    const heads = []; heads.rows = []; heads.total = doc.numPages;
    const OCR_MAX = opt.ocrMax || 20; // 올릴 때도 스캔 묶음 20쪽까지 쪽마다 제목 읽기(서류 나누기가 중요)
    try {
      const n = Math.min(opt.max || 40, doc.numPages);
      if (n < 2 && !opt.max) return null;
      let scanned = 0;
      for (let p = 1; p <= n; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const rows = [];
        for (const it of tc.items) { if (!it.str || !it.str.trim()) continue; const y = it.transform[5]; let r = rows.find((q) => Math.abs(q.y - y) < 4); if (!r) rows.push(r = { y, s: [] }); r.s.push({ x: it.transform[4], t: it.str }); }
        rows.sort((a, b) => b.y - a.y);
        if (opt.onPage) opt.onPage(p, n);
        let lines = rows.slice(0, 8).map((r) => r.s.sort((a, b) => a.x - b.x).map((x) => x.t).join(' '));
        let head = lines.join(' ');
        if (JH.logic.norm(head).length < 4 && scanned < OCR_MAX && !ocrBroken) {
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
            const { data } = await withTimeout(w.recognize(cleaned(top)), 60000, '글자 인식'); // 점무늬 지우고 읽음
            lines = String(data.text || '').split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
            head = String(data.text || '').replace(/\s+/g, ' ').trim();
          } catch (e) { console.warn('쪽 글자 인식 실패', p, e); }
        }
        heads.push(head); heads.rows.push(lines);
      }
    } finally { doc.destroy(); }
    return heads;
  }
  // 압축 파일(.zip) 풀기 — 브라우저 안에서(밖으로 안 나감). 윈도우에서 만든 zip은 한글 이름이 CP949라 그것도 읽음
  // 돌려줌: [{ name, path(폴더 포함), bytes }] · 암호 걸린 항목은 { name, locked: true }
  async function unzip(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('압축 파일을 읽지 못했습니다(zip 형식이 아니거나 깨짐)');
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const utf8 = new TextDecoder('utf-8', { fatal: true }), kr = new TextDecoder('euc-kr');
    const out = [];
    for (let k = 0; k < n && dv.getUint32(p, true) === 0x02014b50; k++) {
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const raw = u8.subarray(p + 46, p + 46 + nl); p += 46 + nl + el + cl;
      let name; if (flags & 0x800) name = new TextDecoder('utf-8').decode(raw); else { try { name = utf8.decode(raw); } catch (_) { name = kr.decode(raw); } }
      name = name.replace(/\\/g, '/');
      if (name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i.test(name)) continue;
      const base = name.split('/').pop(); if (!base || base.startsWith('._')) continue;
      if (flags & 1) { out.push({ name: base, path: name, locked: true }); continue; }
      const ls = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      const data = u8.subarray(ls, ls + csize);
      let fileBytes;
      if (method === 0) fileBytes = data.slice();
      else if (method === 8) fileBytes = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else { out.push({ name: base, path: name, locked: true }); continue; }
      out.push({ name: base, path: name, bytes: fileBytes });
    }
    return out;
  }
  root.JH.readers = { unzip, markupLines, read, officeLines, fullLines, pdfLines, hwpLines, ocrLines, pageHeads, get ocrBroken() { return ocrBroken; } };
})(window);
