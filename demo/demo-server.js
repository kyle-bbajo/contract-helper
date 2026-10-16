/* 시연판: 내 PC 연결 창구(server.ps1) 대신 이 브라우저 안에서 같은 기능을 흉내 냄
 * - 파일은 메모리에만 저장(새로고침하면 처음 상태)
 * - 나라장터 응답은 예시 데이터, 첨부 공고문은 예시 한글 파일
 * - 인쇄·저장·파일 열기는 화면 안 미리보기로 대신함 */
(function (root) {
  'use strict';
  const files = new Map();
  const enc = new TextEncoder(), dec = new TextDecoder();
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const notFound = () => { const e = new Error('파일 없음'); e.status = 404; return e; };
  const unique = (dir, name) => {
    const base = name.replace(/\.[^.]+$/, ''), ext = (name.match(/\.[^.]+$/) || [''])[0];
    let p = (dir ? dir + '/' : '') + name, i = 2;
    while (files.has(p)) p = (dir ? dir + '/' : '') + `${base} (${i++})${ext}`;
    return p;
  };
  root.confirm = () => true; // 시연판 창에서는 확인 창이 뜨지 않음

  // ---------- 예시 나라장터 데이터 ----------
  const ME = '용도공';
  const api = (items) => ({ response: { header: { resultCode: '00', resultMsg: '정상' }, body: { items, numOfRows: 100, pageNo: 1, totalCount: items.length } } });
  const 공사 = [
    { untyCntrctNo: 'R26BK01234567', dcsnCntrctNo: 'R26BK01234567-00', cnstwkNm: '시청사 옥상 방수공사', corpList: '[1^주계약업체^단독^(주)다해토건^홍길동^대한민국^100^(주)다해토건^^1234567890]', totCntrctAmt: '48000000', cntrctCnclsDate: '2026-05-28', cbgnDate: '2026-06-01', ttalCcmpltDate: '2026-10-10', cntrctCnclsMthdNm: '수의계약', baseLawNm: '지방계약법 (제25조제1항5호가목)', baseDtls: '추정가격 2억원 이하 종합공사', ntceNo: 'R26BK00911111', chgDt: '2026-09-20 10:00:00', cntrctInsttNm: '용인도시공사', cntrctInsttOfclNm: ME, cntrctInsttChrgDeptNm: '계약팀' },
    { untyCntrctNo: 'R26BK02020202', dcsnCntrctNo: 'R26BK02020202-00', cnstwkNm: '기흥 레스피아 진입로 보수공사', corpList: '[1^주계약업체^단독^경기포장(주)^최강^대한민국^100^경기포장(주)^^3334445556]', totCntrctAmt: '26800000', cntrctCnclsDate: '2026-08-07', cbgnDate: '2026-08-10', ttalCcmpltDate: '2026-11-30', cntrctCnclsMthdNm: '수의계약', baseLawNm: '지방계약법 (제25조제1항5호가목)', baseDtls: '추정가격 2억원 이하 종합공사', cntrctInsttNm: '용인도시공사', cntrctInsttOfclNm: ME, cntrctInsttChrgDeptNm: '계약팀' },
    { untyCntrctNo: 'R26BK05555555', dcsnCntrctNo: 'R26BK05555555-00', cnstwkNm: '처인구 공영주차장 전기설비 교체', corpList: '[1^주계약업체^단독^대한전기(주)^이몽룡^대한민국^100^대한전기(주)^^2223334445]', totCntrctAmt: '73500000', cntrctCnclsDate: '2026-09-15', ttalCcmpltDate: '2026-12-20', cntrctCnclsMthdNm: '제한경쟁', baseLawNm: '지방계약법 (제20조제1항)', cntrctInsttNm: '용인도시공사', cntrctInsttOfclNm: '김철수', cntrctInsttChrgDeptNm: '계약팀' },
  ];
  const 용역 = [
    { untyCntrctNo: 'R26BS07654321', dcsnCntrctNo: 'R26BS07654321-00', cntrctNm: '체육관 시설 청소 용역', corpList: '[1^주계약업체^단독^한빛환경 주식회사^김영희^대한민국^100^한빛환경 주식회사^^5556667778]', totCntrctAmt: '21500000', cntrctCnclsDate: '2026-06-26', wbgnDate: '2026-07-01', ttalScmpltDate: '2026-12-31', cntrctCnclsMthdNm: '수의계약', baseLawNm: '지방계약법 (제25조제1항5호나목)', cntrctInsttNm: '용인도시공사', cntrctInsttOfclNm: ME, cntrctInsttChrgDeptNm: '계약팀', baseDtls: '외부재정연계(e나라도움)' },
  ];
  const 물품 = [
    { untyCntrctNo: 'R26TA03030303', dcsnCntrctNo: 'R26TA03030303-00', cntrctNm: '본사 사무용 복합기 구매', corpList: '[1^주계약업체^단독^(주)오피스넷^박서준^대한민국^100^(주)오피스넷^^7778889990]', totCntrctAmt: '14300000', cntrctCnclsDate: '2026-04-14', cntrctPrd: '2026-04-14 ~ 2026-05-13', cntrctInsttNm: '용인도시공사', cntrctInsttOfclNm: ME, cntrctInsttChrgDeptNm: '계약팀', cntrctCnclsMthdNm: '수의계약', baseLawNm: '지방계약법 (제25조제1항5호나목)', baseDtls: '추정가격 2천만원 이하 물품 또는 용역' },
  ];
  // 계약 세부 정보(시연): 변경이력·입찰공고 예산·예비가격·낙찰·조달업체 주소
  const CHG = {
    R26BK01234567: [{ dcsnCntrctNo: 'R26BK01234567-00', totCntrctAmt: '48000000', cntrctCnclsDate: '2026-05-28', ttalCcmpltDate: '2026-09-30', chgDt: '2026-05-28 10:00:00' },
      { dcsnCntrctNo: 'R26BK01234567-01', totCntrctAmt: '48000000', cntrctDate: '2026-09-20', ttalCcmpltDate: '2026-10-10', chgDt: '2026-09-20 10:00:00' },
      { dcsnCntrctNo: 'R26BK01234567-02', totCntrctAmt: '47139000', cntrctDate: '2026-10-08', ttalCcmpltDate: '2026-10-10', chgDt: '2026-10-08 10:00:00' }],
  };
  const NTCE = { R26BK00911111: { bid: { asignBdgtAmt: '', bdgtAmt: '52000000', presmptPrce: '45454545' }, prepar: { plnprc: '50120000', bssamt: '50000000' },
    scsbid: { bidwinnrNm: '(주)다해토건', bidwinnrBizno: '1234567890', bidwinnrCeoNm: '홍길동', bidwinnrAdrs: '경기도 용인시 처인구 중부대로 1199', sucsfbidAmt: '48000000', sucsfbidRate: '95.770' } } };
  const CORP = { 3334445556: { corpNm: '경기포장(주)', ceoNm: '최강', adrs: '경기도 용인시 기흥구 흥덕1로', dtlAdrs: '13 (영덕동)' }, 5556667778: { corpNm: '한빛환경 주식회사', ceoNm: '김영희', adrs: '경기도 수원시 영통구 광교로', dtlAdrs: '105' },
    7778889990: { corpNm: '(주)오피스넷', ceoNm: '박서준', adrs: '경기도 성남시 분당구 판교로', dtlAdrs: '242' } };
  const bid = (no, name, org, price, rate, extra) => Object.assign({ bidNtceNo: no, bidNtceOrd: '000', bidNtceNm: name, ntceInsttNm: org, bidNtceDt: '2026-09-01 10:00:00',
    bidBeginDt: '2026-09-02 10:00:00', bidClseDt: '2026-09-09 10:00:00', opengDt: '2026-09-09 11:00:00', presmptPrce: String(price), sucsfbidLwltRate: rate,
    sucsfbidMthdNm: '적격심사', cntrctCnclsMthdNm: '제한경쟁', ntceSpecDocUrl1: `https://www.g2b.go.kr/demo/${no}`, ntceSpecFileNm1: '입찰공고문.hwp' }, extra || {});
  const BIDS = [
    bid('R26BK00000001', '신갈오거리 보안등 정비 전기공사', '용인도시공사', 31000000, '87.745'),
    bid('R26BK00000002', '동백 체육공원 조명 교체 전기공사', '용인도시공사', 45000000, '87.745'),
    bid('R26BK00000003', '수지 주차장 수변전 설비 전기공사', '용인도시공사', 60000000, '86.745'),
    bid('R26BK00000004', '포곡 하수처리장 동력설비 전기공사', '용인도시공사', 38000000, '87.745'),
    bid('R26BK00000005', '기흥호수공원 산책로 조명 전기공사', '용인시 기흥구', 27000000, '87.745'),
  ];
  const REGIONS = { R26BK00000001: ['경기도 용인시'], R26BK00000002: ['경기도 용인시'], R26BK00000003: ['경기도'], R26BK00000004: ['경기도 용인시'], R26BK00000005: ['경기도 용인시'] };
  function naraMock(url) {
    const u = decodeURIComponent(url);
    const q = (k) => (u.match(new RegExp(k + '=([^&]+)')) || [])[1] || '';
    if (u.includes('ChgHstry')) return api(CHG[q('untyCntrctNo')] || []);
    if (u.includes('UsrInfoService02')) { const c = CORP[q('bizno')]; return api(c ? [{ bizno: q('bizno'), ...c }] : []); }
    if (u.includes('PreparPcDetail')) { const n = NTCE[q('bidNtceNo')]; return api(n ? [{ bidNtceNo: q('bidNtceNo'), bidNtceOrd: '000', ...n.prepar }] : []); }
    if (u.includes('ScsbidListSttus')) { const n = NTCE[q('bidNtceNo')]; return api(n ? [{ bidNtceNo: q('bidNtceNo'), bidNtceOrd: '000', ...n.scsbid }] : []); }
    if (NTCE[q('bidNtceNo')] && u.includes('BidPublicInfoService')) return api([{ bidNtceNo: q('bidNtceNo'), bidNtceOrd: '000', ...NTCE[q('bidNtceNo')].bid }]);
    if (u.includes('PrtcptPsblRgn')) { const no = (u.match(/bidNtceNo=([^&]+)/) || [])[1]; return api((REGIONS[no] || []).map((n) => ({ prtcptPsblRgnNm: n }))); }
    if (u.includes('LicenseLimit')) return api([{ lcnsLmtNm: '전기공사업' }]);
    // 입찰공고번호로 찾기(공고문 → 나라장터 등록 확인)
    const byNo = u.match(/getBidPblancListInfo(?:Cnstwk|Servc)\?.*bidNtceNo=([^&]+)/);
    if (byNo) {
      const no = byNo[1].toUpperCase(); const known = BIDS.find((b) => b.bidNtceNo === no); if (known) return api([known]);
      const n = root.JH.notice && root.JH.notice.current && root.JH.notice.current();
      const d = (k, h) => { const x = new Date(); x.setDate(x.getDate() + k); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')} ${h}:00:00`; };
      return api([bid(no, (n && n.v.공고명) || '시연 공고', '용인도시공사', 32000000, '87.745', { bidNtceDt: d(0, '10'), bidBeginDt: d(1, '10'), bidClseDt: d(8, '10'), opengDt: d(8, '11'), ntceSpecDocUrl1: '' })]);
    }
    if (u.includes('BidPublicInfoService')) {
      const kw = (u.match(/bidNtceNm=([^&]+)/) || [])[1];
      return api(kw ? BIDS.filter((b) => b.bidNtceNm.includes(kw.replace(/\+/g, ' '))) : BIDS);
    }
    return api(u.includes('Cnstwk') ? 공사 : u.includes('Thng') ? 물품 : 용역);
  }

  // ---------- 미리보기(인쇄·파일 열기 대신) ----------
  function overlay(title) {
    let ov = document.getElementById('demoOv');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'demoOv'; ov.className = 'demo-ov';
      ov.innerHTML = '<div class="demo-ov-card" role="dialog" aria-modal="true"><div class="demo-ov-head"><b id="demoOvTitle"></b><span class="muted" id="demoOvNote"></span><button type="button" class="btn" id="demoOvClose">닫기</button></div><div class="demo-ov-body" id="demoOvBody"></div></div>';
      document.body.append(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.id === 'demoOvClose') ov.hidden = true; });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ov.hidden = true; });
    }
    ov.hidden = false;
    document.getElementById('demoOvTitle').textContent = title;
    document.getElementById('demoOvNote').textContent = '';
    const body = document.getElementById('demoOvBody'); body.innerHTML = '<p class="muted">불러오는 중…</p>';
    return body;
  }
  async function showPdf(bytes, title, note) {
    const body = overlay(title);
    if (note) document.getElementById('demoOvNote').textContent = note;
    const doc = await root.pdfjsLib.getDocument({ data: bytes.slice(), cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true, isEvalSupported: false }).promise;
    body.innerHTML = '';
    for (let p = 1; p <= Math.min(doc.numPages, 30); p++) {
      const page = await doc.getPage(p); const vp = page.getViewport({ scale: 1.3 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.className = 'demo-page';
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const wrap = document.createElement('figure'); wrap.className = 'demo-fig'; wrap.append(c);
      const cap = document.createElement('figcaption'); cap.textContent = `${p} / ${doc.numPages}쪽`; wrap.append(cap);
      body.append(wrap);
    }
    doc.destroy();
  }
  // 엑셀 미리보기(시연판은 파일을 내려받을 수 없어 표로 보여 줌)
  function showTable(title, sheets) {
    const body = overlay(title);
    document.getElementById('demoOvNote').textContent = '실제 프로그램은 이 내용을 엑셀 파일로 저장하고 바로 엽니다.';
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const fmt = (v, t) => (t === 'money' && v ? Number(v).toLocaleString('ko-KR') : t === 'date' && v ? String(v).replace(/^(\d{4})(\d{2})(\d{2}).*$/, '$1-$2-$3') : v);
    body.innerHTML = sheets.map((sh) => `<section class="demo-sheet"><h4>${esc(sh.name)} <span class="muted">${sh.rows.length}줄</span></h4><div class="demo-tbl"><table class="grid"><thead><tr>${sh.cols.map((c) => `<th>${esc(c.h)}</th>`).join('')}</tr></thead>
      <tbody>${sh.rows.slice(0, 60).map((r) => `<tr>${sh.cols.map((c, i) => `<td${c.type === 'money' ? ' class="r num"' : c.type === 'wrap' ? ' class="w"' : ''}>${esc(fmt(r[i], c.type))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`).join('');
  }
  async function showFile(path) {
    const name = path.split('/').pop(); const bytes = files.get(path);
    if (!bytes) throw notFound();
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return showPdf(bytes, name);
    const body = overlay(name);
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
      const img = document.createElement('img'); img.className = 'demo-page'; img.alt = name;
      img.src = URL.createObjectURL(new Blob([bytes])); body.innerHTML = ''; body.append(img); return;
    }
    if (ext === 'hwp' || ext === 'hwpx') {
      const lines = await JH.hwp.fullLines(root.CFB, bytes);
      document.getElementById('demoOvNote').textContent = '한글 파일의 글자만 보여줍니다. 실제 프로그램에서는 한글로 열립니다.';
      body.innerHTML = ''; const pre = document.createElement('pre'); pre.className = 'demo-text'; pre.textContent = lines.join('\n'); body.append(pre); return;
    }
    body.innerHTML = '<p class="muted">이 형식은 미리볼 수 없습니다.</p>';
  }

  const server = {
    online: true, token: 'demo', demo: true,
    ping: async () => ({ ok: true, version: '1.1.0 (시연판)', dataDir: '시연판 — 이 브라우저 안에만 임시 저장', relocated: false, lost: false }),
    async readBytes(path) { const b = files.get(norm(path)); if (!b) throw notFound(); return b.slice(); },
    async readJson(path) { const b = files.get(norm(path)); return b ? JSON.parse(dec.decode(b)) : null; },
    async writeJson(path, obj) { files.set(norm(path), enc.encode(JSON.stringify(obj))); return { ok: true, path: norm(path) }; },
    async writeBytes(path, bytes) { files.set(norm(path), new Uint8Array(bytes)); return { ok: true, path: norm(path) }; },
    async save(dir, name, bytes) { const p = unique(norm(dir), name.split(/[\\/]/).pop()); files.set(p, new Uint8Array(bytes)); return { ok: true, path: p }; },
    async move(from, dir, name) {
      from = norm(from); const b = files.get(from); if (!b) throw notFound();
      const target = norm(dir) + '/' + (name || from.split('/').pop());
      if (target === from) return { ok: true, path: from };
      const p = unique(norm(dir), name || from.split('/').pop()); files.delete(from); files.set(p, b); return { ok: true, path: p };
    },
    async remove(path) { path = norm(path); const b = files.get(path); if (b) { files.delete(path); files.set(unique('_삭제됨', path.split('/').pop()), b); } return { ok: true }; },
    async list(dir, recursive) {
      dir = norm(dir); const pre = dir ? dir + '/' : '';
      const out = [...files.entries()].filter(([p]) => p.startsWith(pre) && (recursive || !p.slice(pre.length).includes('/')))
        .map(([p, b]) => ({ path: p, size: b.length, mtime: new Date().toISOString() }));
      return { ok: true, files: out };
    },
    // 시연판: 실제 AI 대신 배운 문장을 공고문 문체로 정리한 예시를 돌려줌
    async ai(body) {
      await new Promise((r) => setTimeout(r, 900));
      const n = root.JH.notice.current && root.JH.notice.current();
      const secs = root.JH.notice.logic.draft(n.v, n.learned).map((s) => ({ title: s.title, body: s.body }));
      const q = secs.find((s) => /입찰참가자격/.test(s.title));
      if (q) q.body += `\n  ${'가나다라마바사아'[q.body.split('\n').length] || '※'}. 입찰참가자격 등록은 입찰서 제출 마감일 전일까지 마쳐야 합니다.(시연: 실제로는 Claude가 비슷한 공고 문장을 보고 씁니다)`;
      return { model: body.model, content: [{ type: 'text', text: JSON.stringify({ sections: secs }) }] };
    },
    async nara(url) { await new Promise((r) => setTimeout(r, 60)); return naraMock(url); },
    // PC 안 AI(시연): 설치돼 있고 준비된 것으로 보여 줌
    aiStatus: async () => ({ installed: true, status: { state: 'ready', pct: 100, model: 'gemma3:4b' } }),
    aiSetup: async () => ({ ok: true }),
    localTags: async () => ({ models: [{ name: 'gemma3:4b' }] }),
    async localChat(body) {
      await new Promise((r) => setTimeout(r, 700));
      const prompt = body.messages[body.messages.length - 1].content;
      if (/예정가격/.test(prompt) && /업체주소/.test(prompt)) {
        const m = prompt.match(/예\s*정\s*가\s*격[^\d]{0,20}([\d,]{6,})/);
        return { message: { content: JSON.stringify({ 예산액: null, 설계금액: null, 예정가격: m ? Number(m[1].replace(/,/g, '')) : null, 업체주소: null, 대표자: null }) } };
      }
      const r = await server.ai({ model: body.model });
      return { message: { content: r.content[0].text } };
    },
    async fetchFile() { return new Uint8Array(await (await fetch('samples/attach-notice.hwp')).arrayBuffer()); },
    async hwp2pdf() { throw new Error('시연판에서는 한글→PDF 변환을 하지 않습니다. 실제 프로그램은 설치된 한글로 자동 변환합니다.'); },
    async open() { throw new Error('시연판에서는 폴더를 열 수 없습니다. 실제 프로그램은 탐색기로 엽니다.'); },
    async openFile(path) { await showFile(norm(path)); return { ok: true }; },
    async view(path) { await showFile(norm(path)); },
    async pickFolder() { throw new Error('시연판에서는 폴더를 바꿀 수 없습니다.'); },
    async quit() { return { ok: true }; },
    fileUrl: (path) => '#',
    showPdf, showTable,
    _files: files,
  };
  root.JH = root.JH || {};
  root.JH.server = server;

  // ---------- 시연 준비: 설정·예시 공고문·한글 양식을 미리 넣고, 계약 불러오기와 샘플 서류 정리를 자동으로 ----------
  const SAMPLES = ['noname.pdf', 'noname(1).pdf', 'noname(2).pdf', 'noname(3).pdf', 'noname(4).pdf', 'noname(5).pdf', 'noname(6).pdf', 'noname(7).pdf', 'noname(8).jpg', 'noname(9).hwp', 'noname(10).hwpx'];
  async function seed() {
    files.clear();
    await server.writeJson('설정.json', { officer: ME, notice: { dept: '계약팀', phone: '031-000-0000', winwinMin: 50000000, aiKey: '시연용' },
      forms: { dept: '경영기획본부', committee: '도시건설위원회', confirmer: { pos: '재무관리처장' }, writer: { pos: '회계팀장' } } });
    const tpl = new Uint8Array(await (await fetch('samples/공고문양식.hwpx')).arrayBuffer());
    files.set('공고문/양식/공고문양식.hwpx', tpl);
    const now = Date.now();
    const done = { id: 'demo3', status: 'done', createdAt: now - 864e5, updatedAt: now - 864e5, manual: {}, learned: null, lastFile: '',
      v: { 구분: '공사', 공종: '전기공사', 공고명: '수지 주차장 수변전 설비 전기공사', 공고번호: '2026-091', 현장: '용인시 수지구 풍덕천동 일원', 기간: '착공일로부터 60일',
        추정가격: '60,000,000', 부가세: '6,000,000', 추정금액: '66,000,000', 기초금액: '', 계약방법: '제한경쟁', 낙찰자결정방법: '적격심사', 낙찰하한율: '86.745%',
        업종제한: '「전기공사업법」에 따른 전기공사업 등록업체', 지역제한: '경기도', 공동도급: '불허', 입찰보증금: '입찰금액의 100분의 5 이상', 상생결제: '적용',
        공고일: '', 입찰시작: '', 입찰마감: '', 개찰일시: '', 현장설명: '없음', 하자담보책임기간: '준공일로부터 2년', 담당부서: '계약팀', 담당자: ME, 연락처: '031-000-0000', 기관명: '용인도시공사' } };
    const posted = JSON.parse(JSON.stringify(done)); Object.assign(posted, { id: 'demo2', status: 'posted', createdAt: now - 20 * 864e5, updatedAt: now - 15 * 864e5,
      g2b: { no: 'R26BK00000002', ord: '000', name: '동백 체육공원 조명 교체 전기공사', org: '용인도시공사', close: '2026-09-09T10:00', open: '2026-09-09T11:00', checked: true } });
    Object.assign(posted.v, { 공고명: '동백 체육공원 조명 교체 전기공사', 공고번호: '2026-074', 현장: '용인시 기흥구 동백동 일원', 추정가격: '45,000,000', 부가세: '4,500,000', 추정금액: '49,500,000', 낙찰하한율: '87.745%', 지역제한: '용인시', 상생결제: '미적용' });
    await server.writeJson('공고문대장.json', { version: 1, notices: [{ id: 'demo1', status: 'draft', createdAt: now, updatedAt: now, manual: {}, learned: null,
      v: { 구분: '공사', 공종: '전기공사', 공고명: '신갈오거리 보안등 정비 전기공사', 공고번호: '', 현장: '용인시 기흥구 신갈동 일원', 기간: '착공일로부터 45일',
        추정가격: '32,000,000', 부가세: '3,200,000', 추정금액: '35,200,000', 기초금액: '', 계약방법: '제한경쟁', 낙찰자결정방법: '적격심사', 낙찰하한율: '',
        업종제한: '「전기공사업법」에 따른 전기공사업 등록업체', 지역제한: '용인시', 공동도급: '불허', 입찰보증금: '입찰금액의 100분의 5 이상', 상생결제: '미적용',
        공고일: '', 입찰시작: '', 입찰마감: '', 개찰일시: '', 현장설명: '없음', 하자담보책임기간: '준공일로부터 2년', 담당부서: '계약팀', 담당자: ME, 연락처: '031-000-0000', 기관명: '용인도시공사' } }, done, posted] });
  }
  async function runDemo() {
    const app = JH.app;
    await app.fetchContracts(true);
    const fs = [];
    for (const n of SAMPLES) { const b = await (await fetch('samples/' + encodeURIComponent(n))).arrayBuffer(); fs.push(new File([b], n)); }
    await app.ingest(fs);
    // 메모 예시
    const c = Object.values(app.db.contracts).find((x) => x.name === '시청사 옥상 방수공사');
    if (c) { c.memo = { dept: '시설관리팀', person: '홍감독', phone: '031-000-1234', note: '준공검사 10/20 예정. 하자보증서 원본은 업체가 직접 가져오기로 함.', aChgWhy: '준공정산', aExtWhy: '우천으로 방수층 양생 지연' }; await app.saveDb(true); }
    const r = Object.values(app.db.contracts).find((x) => x.name === '기흥 레스피아 진입로 보수공사');
    if (r) { r.memo = { ...(r.memo || {}), dept: '도로시설팀', aBudget: '30000000', aDesign: '27500000', aEst: '27500000' }; await app.saveDb(true); }
    app.setView('home');
    showBar();
  }
  function showBar() {
    JH.app.banner('<b>시연판</b> · 예시 계약 5건(공사·용역·물품)과 파일명이 noname인 샘플 서류 11개를 자동으로 넣어 두었습니다. 내 파일을 창에 끌어다 놓아도 됩니다(이 브라우저 안에서만 처리, 저장 안 됨). <button class="link" id="demoReset">처음부터 다시 보기</button>');
    const b = document.getElementById('demoReset');
    if (b) b.onclick = () => location.reload();
  }
  const ready = seed();
  root.JH.demo = { seed, runDemo, ready };
  ready.then(() => {
    // 앱이 다 뜬 뒤 자동 시연
    const wait = setInterval(() => {
      if (JH.app && JH.app.db && document.querySelector('#view-home.on') && document.getElementById('homeTitle').textContent.includes(ME)) {
        clearInterval(wait); runDemo().catch((e) => console.error(e));
      }
    }, 200);
  });
})(window);
