/*
 * 계약업무 도우미 — 순수 로직 (브라우저·Node 공용, 화면/파일 접근 없음)
 *  - 서류 목록(체크리스트) 기본값: 「전자·서면계약 구비서류 안내」 기준
 *  - 문서 글자에서 계약번호·계약명·업체명 찾기
 *  - 서류 종류 분류, 계약 건 배정
 *  - 나라장터 계약정보 API 응답 정리
 */
(function (root) {
  'use strict';

  // ---------- 공통 ----------
  const norm = (s) => String(s == null ? '' : s).toLowerCase()
    .replace(/[\s_\-\.\(\)\[\]·・ㆍ,:：'"“”‘’「」『』<>〈〉《》\/\\~]+/g, '');
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const stem = (n) => String(n).replace(/\.[^.]+$/, '');
  const extOf = (n) => (String(n).split('.').pop() || '').toLowerCase();

  function kindOf(name) {
    const e = extOf(name);
    if (e === 'pdf') return 'pdf';
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(e)) return 'image';
    if (e === 'hwp' || e === 'hwpx') return 'hwp';
    return 'other';
  }

  // ---------- 서류 목록 ----------
  // source: 문서함(내부) · 나라장터 · 업체(원본 제출) · 메일
  const ORIGINAL_SOURCES = ['업체', '메일'];
  let seq = 0;
  const it = (group, name, kw, opt = {}) => ({
    id: opt.id || ('d' + (++seq)),
    group, name,
    keywords: kw.split(',').map((s) => s.trim()).filter(Boolean),
    required: opt.required !== false,
    source: opt.source || '업체',
    note: opt.note || '',
    ...(opt.alt ? { alt: opt.alt } : {}), // 둘 중 하나만 있으면 되는 서류(예: 하자보수보증서 ↔ 하자보수 이행보증금 지급각서)
  });

  // 검사원 지정통보(기성·준공 공통 말) — '준공검사원'(준공계 칸)보다 긴 말이라 지정통보가 이김
  const NOTICE_KW = '검사원지정통보,검사자지정통보,검사원지정,검사자지정,검사공무원지정,검사원임명,지정통보';
  function defaultChecklists() {
    seq = 0;
    const g1 = '구매요구', g2 = '계약', g5 = '준공조서', g6 = '대금청구', g7 = '지출결의';
    const head = (k) => [
      it(g1, '구매요구서 또는 기안문', '구매요구,구매요청,계약의뢰,계약요청,일반기안,기안문', { source: '문서함', note: '설계내역서·시방서 등 포함. 우리 예산이 아닌 사업(e나라도움 등)은 일반 기안문', id: k + '-req' }),
      it(g2, '계약서', '계약서,계약문서,계약체결', { source: '나라장터', id: k + '-contract' }),
      // 계약 관련서류(세분화)
      it(g2, '계약이행 통합 서약서', '통합서약서,계약이행통합,이행통합서약,통합 서약서', { source: '나라장터', id: k + '-pledge' }),
      it(g2, '사업자등록증 사본', '사업자등록증,사업자등록', { source: '나라장터', id: k + '-bizreg' }),
      it(g2, '법인등기사항증명서', '법인등기,등기사항증명,등기사항전부,등기부등본', { source: '나라장터', note: '계약일 기준 3개월 이내 발급분 · 개인사업자는 해당 없음', id: k + '-corpreg' }),
      it(g2, '인감증명서', '인감증명,법인인감,개인인감', { source: '나라장터', note: '법인인감(개인사업자는 개인인감) · 계약일 기준 3개월 이내 발급분', id: k + '-seal' }),
      it(g2, '사용인감계', '사용인감', { source: '나라장터', required: false, note: '사용인감도장 사용 시', id: k + '-useseal' }),
      it(g2, '면허 등록증 사본', '면허등록증,건설업등록증,공사업등록증,업등록증,면허증,등록증사본', { source: '나라장터', required: k !== 'g', note: k === 'g' ? '해당 시' : '해당 면허', id: k + '-license' }),
      it(g2, '면허 등록수첩 사본', '등록수첩,면허수첩', { source: '나라장터', required: false, note: '해당 면허', id: k + '-licbook' }),
      it(g2, '견적서(계약금액)', '견적서,견적', { source: '나라장터', note: '계약금액으로 작성', id: k + '-estimate' }),
      it(g2, '산출내역서', '산출내역,설계내역,내역서', { source: '나라장터', id: k + '-calc' }),
      it(g2, '통장사본', '통장', { source: '나라장터', id: k + '-bank' }),
      it(g2, '그 밖의 계약 서류', '관련서류,관련문서,이행각서,서약서,청렴계약,수의계약각서,배제사유,확약서,하도급계약,하도급통보,계약보증,계약이행보증', { source: '나라장터', required: false, note: '각서·서약서·확약서 등', id: k + '-related' }),
    ];
    // 대금청구: 4대보험·고용산재 완납증명서와 지역개발채권도 여기서 받음(업체가 청구 때 냄)
    const tail = (k, mid = []) => [
      ...(k === 'g' ? [] : [it(g5, '준공검사원 지정통보', NOTICE_KW + ',준공검사원지정,준공검사자지정,준공검사공무원지정', { source: '문서함', note: '감독부서에 발송', id: k + '-notice' })]),
      it(g5, '준공조서', '준공조서,검사조서,검수조서,준공검사조서', { source: '문서함', id: k + '-inspect' }),
      it(g6, '대금청구서', '청구서,대금청구,대가청구,청구', { source: '메일', id: k + '-claim' }),
      it(g6, '국세 납세증명서', '국세,납세증명,세증명서', { source: '메일', id: k + '-tax' }),
      it(g6, '지방세 납세증명서', '지방세,지방세납세,지방세완납,지방세납세증명,지방세납세증명신청서,지방세완납증명', { source: '메일', id: k + '-ltax' }),
      ...mid,
      it(g6, '지역개발채권 매입필증', '지역개발채권,지역개발공채,채권매입,매입필증,도시철도채권', { source: '메일', id: k + '-bond' }),
      it(g6, '세금계산서', '세금계산서,계산서', { source: '메일', id: k + '-invoice' }),
      it(g7, '지출결의서', '지출결의,지출품의', { source: '문서함', id: k + '-pay' }),
    ];
    const LABOR_PRIV = '노무비개인정보,개인정보수집,개인정보 수집,개인정보제공,개인정보 제공,개인정보이용';
    const 공사 = [
      ...head('c'),
      it('착공계', '착공계·현장대리인계·예정공정표', '착공,현장대리인계,예정공정', { id: 'c-start' }),
      it('착공계', '현장대리인 재직증명서·자격증', '재직증명,자격증', { required: false, note: '해당 시', id: 'c-agent' }),
      it('착공계', '노무비 지급확인제', '노무비지급확인,지급확인제', { id: 'c-laborconfirm' }),
      it('착공계', '노무비 개인정보 수집·이용·제공 동의서', LABOR_PRIV, { id: 'c-laborpriv' }),
      it('착공계', '4대 사회보험 가입자명부', '가입자명부', { id: 'c-roster' }),
      it('착공계', '4대 사회보험 가입증명서', '사회보험가입증명,보험가입증명서,가입증명서,가입내역확인서,가입내역확인,사업장가입내역,사업장가입내역확인서,4대보험가입내역', { id: 'c-insjoin' }),
      it('착공계', '고용·산재 가입증명원', '고용산재가입,가입증명원,고용보험가입,산재보험가입', { note: '공사명·공사기간·계약금액 필수', id: 'c-empjoin' }),
      it('착공계', '손해배상공제(보험) 증권', '손해배상공제,손해배상보험,손해배상책임,배상책임보험,공제증권', { id: 'c-dmgins' }),
      it('선금', '선금 보증서(선급금 이행보증증권)', '선금보증,선급금보증,선급금이행보증,선금이행보증,선급금 보증,선금 보증,선급금보증서,선급금 이행', { required: false, note: '선금 받을 때 · 보증기간이 준공일 + 60일 이상', id: 'c-advbond' }),
      it('준공계', '준공계·준공검사원', '준공계,준공검사원,준공신고', { id: 'c-finish' }),
      it('준공계', '준공사진대지', '사진대지,준공사진', { id: 'c-photo' }),
      it('준공계', '노무비 미체불 확약서', '미체불', { required: false, note: '일용근로자 해당 시', id: 'c-nounpaid' }),
      it('준공계', '노무비 지급 내역서', '노무비지급내역,지급내역서', { required: false, note: '일용근로자 해당 시', id: 'c-laborlist' }),
      it('준공계', '하자보수보증서(하자이행보증증권)', '하자보수보증서,하자보증서,하자이행보증,하자보수보증금,하자보증증권', { note: '또는 지급각서', alt: 'c-defect', id: 'c-defectbond' }),
      it('준공계', '하자보수 이행보증금 지급각서', '하자보수이행보증금지급각서,하자지급각서,지급각서', { note: '또는 하자보수보증서', alt: 'c-defectbond', id: 'c-defect' }),
      ...tail('c', [
        it(g6, '4대 사회보험 완납증명서', '사회보험완납,사회보험료완납,4대보험완납,보험료완납', { source: '메일', id: 'c-inspaid' }),
        it(g6, '고용·산재 완납증명서', '고용산재완납,고용보험료완납,산재보험료완납', { source: '메일', note: '공사명 기재 필수', id: 'c-emppaid' }),
      ]),
    ];
    const 용역 = [
      ...head('s'),
      it('착수계', '착수계(착공계)·현장대리인계·예정공정표', '착수,착공,현장대리인계,예정공정', { id: 's-start' }),
      it('착수계', '현장대리인 재직증명서·자격증', '재직증명,자격증', { required: false, note: '해당 시', id: 's-agent' }),
      it('착수계', '보안각서·보안서약서', '보안각서,보안서약', { required: false, note: '해당 용역', id: 's-security' }),
      it('착수계', '4대 사회보험 가입증명서', '사회보험가입증명,보험가입증명서,가입증명서,가입내역확인서,가입내역확인,사업장가입내역,사업장가입내역확인서,4대보험가입내역', { id: 's-insjoin' }),
      it('착수계', '4대 사회보험 가입자명부', '가입자명부', { required: false, note: '착공계로 낼 때·상용근로자', id: 's-roster' }),
      it('착수계', '고용·산재 가입증명원', '고용산재가입,가입증명원,고용보험가입,산재보험가입', { required: false, note: '단순노무용역', id: 's-empjoin' }),
      it('착수계', '노무비 지급확인제', '노무비지급확인,지급확인제', { required: false, note: '단순노무용역', id: 's-laborconfirm' }),
      it('착수계', '노무비 개인정보 수집·이용·제공 동의서', LABOR_PRIV, { id: 's-laborpriv' }),
      it('착수계', '손해배상공제(보험) 증권', '손해배상공제,손해배상보험,손해배상책임,배상책임보험,공제증권', { required: false, note: '착공계로 낼 때', id: 's-dmgins' }),
      it('선금', '선금 보증서(선급금 이행보증증권)', '선금보증,선급금보증,선급금이행보증,선금이행보증,선급금 보증,선금 보증,선급금보증서,선급금 이행', { required: false, note: '선금 받을 때 · 보증기간이 준공일 + 60일 이상', id: 's-advbond' }),
      it('준공계', '준공계·준공검사원', '준공계,준공검사원,준공신고,완료계', { id: 's-finish' }),
      it('준공계', '준공사진대지', '사진대지,준공사진', { id: 's-photo' }),
      it('준공계', '작업결과물', '결과물,결과보고,최종보고', { required: false, note: '해당 시', id: 's-result' }),
      it('준공계', '하자보수보증서(하자이행보증증권)', '하자보수보증서,하자보증서,하자이행보증,하자보수보증금,하자보증증권', { note: '또는 지급각서', alt: 's-defect', id: 's-defectbond' }),
      it('준공계', '하자보수 이행보증금 지급각서', '하자보수이행보증금지급각서,하자지급각서,지급각서', { note: '또는 하자보수보증서', alt: 's-defectbond', id: 's-defect' }),
      it('준공계', '노무비 미체불 확약서', '미체불', { required: false, note: '단순노무용역', id: 's-nounpaid' }),
      it('준공계', '용역근로자 노무비 지급 내역서', '노무비지급내역,지급내역서', { required: false, note: '단순노무용역', id: 's-laborlist' }),
      ...tail('s', [
        it(g6, '4대 사회보험 완납증명서', '사회보험완납,사회보험료완납,4대보험완납,보험료완납', { source: '메일', id: 's-inspaid' }),
        it(g6, '고용·산재 완납증명서', '고용산재완납,고용보험료완납,산재보험료완납', { source: '메일', required: false, note: '해당 시(용역명 기재)', id: 's-emppaid' }),
      ]),
    ];
    const 물품 = [
      ...head('g'),
      it('납품', '납품계·납품서', '납품계,납품서,납품신고,납품확인', { id: 'g-finish' }),
      it('납품', '거래명세서', '거래명세,명세표', { required: false, note: '해당 시', id: 'g-spec' }),
      it('납품', '하자보수 이행보증금 지급각서', '하자보수,하자이행,지급각서', { required: false, note: '해당 시', id: 'g-defect' }),
      ...tail('g'),
    ];
    물품.find((x) => x.id === 'g-bond').required = false; 물품.find((x) => x.id === 'g-bond').note = '해당 시';
    return { 공사, 용역, 물품 };
  }
  const STAGES = ['구매요구', '계약', '착공계', '착수계', '납품', '준공계', '준공조서', '대금청구', '지출결의'];

  // ---------- 서류 종류 분류 ----------
  // 파일명에서 먼저 찾고(가장 긴 단어), 없으면 문서 앞부분(제목)에서 가장 앞에 나오는 단어
  function classifyItem(list, fileName, title) {
    const byName = bestKeyword(list, norm(stem(fileName)), false);
    if (byName) return byName;
    return title ? bestKeyword(list, title, true) : null;
  }
  function bestKeyword(list, hay, byPos) {
    let best = null, bp = 1e9, bl = 0;
    for (const item of list) for (const k of item.keywords) {
      const nk = norm(k); if (!nk) continue;
      const p = hay.indexOf(nk); if (p < 0) continue;
      if (!byPos) { if (nk.length > bl) { best = item.id; bl = nk.length; } }
      else if (p < bp || (p === bp && nk.length > bl)) { best = item.id; bp = p; bl = nk.length; }
    }
    return best;
  }
  // 파일 이름에 서류 이름이 여럿(예: 견적서_산출내역.pdf, 사업자등록증·통장사본.pdf) → 이름에 나온 순서대로 서류 id
  function itemsInName(list, fileName) {
    const hay = norm(stem(fileName)); const hits = [];
    for (const item of list) {
      let pos = -1, len = 0;
      for (const k of item.keywords) { const nk = norm(k); if (nk.length < 2) continue; const p = hay.indexOf(nk); if (p >= 0 && (pos < 0 || p < pos || (p === pos && nk.length > len))) { pos = p; len = nk.length; } }
      if (pos >= 0) hits.push({ id: item.id, pos, len });
    }
    // 같은 자리에 겹친 짧은 단어(예: '등록증' 속 '사업자등록증')는 긴 쪽만
    const keep = hits.filter((h) => !hits.some((o) => o !== h && o.pos <= h.pos && o.pos + o.len >= h.pos + h.len && o.len > h.len));
    return keep.sort((a, b) => a.pos - b.pos).map((h) => h.id);
  }
  // 한 파일에 여러 양식(예: 착공계 묶음 PDF): 쪽마다 앞부분(제목 자리)에서 서류 이름을 찾음 → { 서류 id: [쪽 번호] }
  function classifyPages(list, pageHeads, head = 40) {
    const out = {};
    (pageHeads || []).forEach((h, i) => {
      const hay = norm(h); if (!hay) return;
      let best = null, bp = 1e9, bl = 0;
      for (const item of list) for (const k of item.keywords) {
        const nk = norm(k); if (nk.length < 2) continue;
        const p = hay.indexOf(nk); if (p < 0 || p > head) continue;
        if (p < bp || (p === bp && nk.length > bl)) { best = item.id; bp = p; bl = nk.length; }
      }
      if (best) (out[best] = out[best] || []).push(i + 1);
    });
    return out;
  }
  // 한글처럼 쪽을 모를 때: 짧은 제목 줄(서류 이름만 있는 줄)에서 찾음
  function classifyTitleLines(list, lines) {
    const heads = (lines || []).filter((l) => { const t = String(l).replace(/\s+/g, ''); return t.length >= 3 && t.length <= 30; });
    const pages = classifyPages(list, heads, 4);
    for (const k of Object.keys(pages)) pages[k] = [];
    return pages;
  }
  // 계약서 제목으로 공사/용역 추정
  function guessType(title) {
    const t = title || '';
    const a = t.indexOf('용역'), b = t.indexOf('공사');
    if (a >= 0 && (b < 0 || a < b)) return '용역';
    if (b < 0 && /물품|구매|구입|납품/.test(t)) return '물품';
    return '공사';
  }

  // ---------- 문서 글자에서 계약 정보 찾기 ----------
  const sp = (w) => w.split('').join('\\s*');
  const alt = (ws) => '(?:' + ws.map(sp).join('|') + ')';
  const RE_NO = new RegExp(alt(['계약번호', '통합계약번호', '확정계약번호']) + '\\s*[:：]?\\s*([A-Za-z0-9][A-Za-z0-9\\-]{7,})');
  const RE_NAME = new RegExp(alt(['계약건명', '계약명', '공사명', '용역명', '구매건명', '건명']) + '\\s*[:：]?\\s*(.+)');
  const RE_NSTOP = new RegExp(alt(['계약금액', '계약기간', '계약일자', '계약상대자', '계약보증금', '착공', '착수', '준공', '금액', '현장', '납품기한', '기간', '위치']));
  const VLABELS = ['상호또는법인명', '상호명', '상호', '업체명', '법인명', '사업장명', '사업장명칭', '계약상대자'];
  const RE_VEND = new RegExp(alt(VLABELS) + '\\s*(?:\\(\\s*' + sp('법인명') + '\\s*\\))?\\s*[:：]?\\s*(.+)');
  const RE_VLABEL = new RegExp('^\\s*' + alt(['상호또는법인명', '상호명', '상호', '업체명', '법인명', '성명']) + '\\s*(?:\\(\\s*' + sp('법인명') + '\\s*\\))?\\s*[:：]?\\s*');
  const RE_VSTOP = new RegExp(alt(['대표자', '대표', '성명', '주소', '사업자', '소재지', '전화', '등록번호', '법인등록', '생년월일', '관리번호']));
  const OWN_ORG = ['도시공사', '공사사장']; // 발주기관 이름은 업체명으로 쓰지 않음

  function cut(v, stop) {
    for (let k = 0; k < 3; k++) { const n = v.replace(RE_VLABEL, ''); if (n === v) break; v = n; }
    const s = v.search(stop); if (s >= 0) v = v.slice(0, s);
    return v.replace(/\(\s*인\s*\)/g, '').replace(/^[\s:：\-]+|[\s:：\-]+$/g, '');
  }
  function findMeta(lines) {
    let no = '', name = '', vendor = '';
    for (const l of lines) {
      if (!no) { const m = l.match(RE_NO); if (m) no = m[1]; }
      if (!name) { const m = l.match(RE_NAME); if (m) { const v = cut(m[1], RE_NSTOP); if (v.length >= 2) name = v.slice(0, 80); } }
      if (!vendor) {
        const m = l.match(RE_VEND);
        if (m) { const v = cut(m[1], RE_VSTOP); if (v.length >= 2 && !OWN_ORG.some((o) => norm(v).includes(o))) vendor = v.slice(0, 40); }
      }
      if (no && name && vendor) break;
    }
    return { no, name, vendor };
  }
  const vendorCore = (v) => norm(String(v || '').replace(/주\s*식\s*회\s*사|\(\s*주\s*\)|㈜|（\s*주\s*）|유\s*한\s*회\s*사|\(\s*유\s*\)|합\s*자\s*회\s*사|\(\s*합\s*\)/g, ''));
  // 계약번호 뒤의 차수(-00 최초, -01 변경…)를 뗀 번호. 나라장터 번호는 'R26TA01914348' + 차수 2자리(대시가 없어도)
  const G2B_NO = /^([A-Za-z]\d{2}[A-Za-z]{2}\d{8})(?:-?(\d{2,3}))?$/;
  const baseNo = (n) => { const t = String(n || '').trim().replace(/\s+/g, ''); const m = t.match(G2B_NO); return norm(m ? m[1] : t.split('-')[0]); };
  const ordOf = (n) => { const m = String(n || '').trim().replace(/\s+/g, '').match(G2B_NO); return m && m[2] != null ? +m[2] : null; };

  // ---------- 계약 건 배정 ----------
  // 계약번호(10) > 계약명 전체(6) > 계약명 단어 2개 이상(4) > 업체명(3). 동점이면 배정하지 않음
  function contractScore(c, hay) {
    let s = 0;
    for (const n of c.nums || []) { const b = baseNo(n); if (b.length >= 6 && hay.includes(b)) { s += 10; break; } }
    if (c.name) {
      const n = norm(c.name);
      if (n.length >= 4 && hay.includes(n)) s += 6;
      else {
        const toks = String(c.name).split(/[\s·,()\[\]]+/).map(norm).filter((t) => t.length >= 2 && !['공사', '용역', '구매', '설치', '보수', '정비'].includes(t));
        const hit = toks.filter((t) => hay.includes(t)).length;
        if (toks.length >= 2 && hit >= 2) s += 4;
      }
    }
    const v = vendorCore(c.vendor);
    if (v.length >= 2 && hay.includes(v)) s += 3;
    // 나라장터 업체 사업자등록번호(10자리)가 서류에 있으면 그 업체 계약(사업자등록증·통장사본·납세증명 등)
    const bz = String(c.bizno || '').replace(/\D/g, '');
    if (bz.length === 10 && hay.includes(bz)) s += 4;
    return s;
  }
  function matchContract(contracts, hay) {
    let best = null, bs = 0, tie = false;
    for (const c of contracts) {
      if (c.archived) continue;
      const s = contractScore(c, hay);
      if (s > bs) { best = c; bs = s; tie = false; } else if (s > 0 && s === bs) tie = true;
    }
    return bs > 0 && !tie ? best : null;
  }
  // 가장 높은 점수의 계약들(동점 포함) — 통장사본처럼 업체 이름만 있는 서류는 같은 업체 계약이 여럿이면 동점
  function matchCandidates(contracts, hay) {
    let bs = 0, top = [];
    for (const c of contracts) {
      if (c.archived) continue;
      const s = contractScore(c, hay);
      if (s > bs) { bs = s; top = [c]; } else if (s > 0 && s === bs) top.push(c);
    }
    return { score: bs, top };
  }
  const contractKey = (c) => baseNo((c.nums || [])[0]) || ('n:' + norm(c.name)) || ('x:' + uid());

  // ---------- 나라장터 계약정보 API ----------
  const API_BASE = 'https://apis.data.go.kr/1230000/ao/CntrctInfoService';
  // 인증키: 공공데이터포털의 '인코딩' 키(%2B 등이 이미 든 것)를 넣어도 두 번 바꾸지 않음
  const keyParam = (k) => { const t = String(k || '').trim(); return /%[0-9A-Fa-f]{2}/.test(t) ? t : encodeURIComponent(t); };
  const API_OPS = { 공사: 'getCntrctInfoListCnstwkPPSSrch', 용역: 'getCntrctInfoListServcPPSSrch', 물품: 'getCntrctInfoListThngPPSSrch' };
  const TYPES = ['공사', '용역', '물품'];
  // 계약 한 건을 더 자세히: 변경이력(설계변경·기간연장), 입찰공고(예산), 개찰 예비가격(예정가격·기초금액), 낙찰(낙찰률·업체 주소), 조달업체 기본정보(주소·대표자)
  // 서비스마다 공공데이터포털 활용신청이 따로 필요함(같은 인증키로 신청만 하면 됨)
  const KIND = { 공사: 'Cnstwk', 용역: 'Servc', 물품: 'Thng' };
  const G2B = {
    chg: { name: '계약정보서비스(변경이력)', base: API_BASE, op: (t) => `getCntrctInfoList${KIND[t] || 'Cnstwk'}ChgHstry` },
    bid: { name: '입찰공고정보서비스', base: 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService', op: (t) => `getBidPblancListInfo${KIND[t] || 'Cnstwk'}` },
    prepar: { name: '낙찰정보서비스(예비가격)', base: 'https://apis.data.go.kr/1230000/as/ScsbidInfoService', op: (t) => `getOpengResultListInfo${KIND[t] || 'Cnstwk'}PreparPcDetail` },
    scsbid: { name: '낙찰정보서비스', base: 'https://apis.data.go.kr/1230000/as/ScsbidInfoService', op: (t) => `getScsbidListSttus${KIND[t] || 'Cnstwk'}` },
    corp: { name: '사용자정보서비스', base: 'https://apis.data.go.kr/1230000/ao/UsrInfoService02', op: () => 'getPrcrmntCorpBasicInfo02' },
  };
  const bareNtce = (s) => String(s || '').trim().toUpperCase().replace(/[-\s]\d{2,3}$/, '');
  function g2bUrl(kind, type, arg, apiKey) {
    const g = G2B[kind];
    const q = new URLSearchParams({ pageNo: '1', numOfRows: kind === 'chg' ? '50' : '20', type: 'json' });
    if (kind === 'chg') { q.set('inqryDiv', '2'); q.set('untyCntrctNo', arg); }
    else if (kind === 'bid') { q.set('inqryDiv', '2'); q.set('bidNtceNo', bareNtce(arg)); }
    else if (kind === 'prepar') { q.set('inqryDiv', '2'); q.set('bidNtceNo', bareNtce(arg)); }
    else if (kind === 'scsbid') { q.set('inqryDiv', '4'); q.set('bidNtceNo', bareNtce(arg)); }
    else if (kind === 'corp') { q.set('inqryDiv', '3'); q.set('bizno', String(arg).replace(/\D/g, '')); }
    return `${g.base}/${g.op(type)}?serviceKey=${keyParam(apiKey)}&${q.toString()}`;
  }
  const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return isFinite(n) && String(v || '').trim() !== '' ? n : 0; };
  const ymd8 = (s) => { const m = String(s || '').match(/(\d{4})[-.\/]?(\d{2})[-.\/]?(\d{2})/); return m ? m[1] + m[2] + m[3] : ''; };
  // 변경이력 → 당초 금액·준공일, 금액 바뀐 차수(설계변경), 준공일 바뀐 차수(기간연장)
  function summarizeChanges(items, opt = {}) {
    const rows = (items || []).map((x) => ({
      at: String(x.chgDt || x.rgstDt || ''), date: ymd8(x.cntrctDate || x.cntrctCnclsDate || x.chgDt),
      amount: num(x.totCntrctAmt || x.thtmCntrctAmt), end: ymd8(x.ttalCcmpltDate || x.thtmCcmpltDate || x.ttalScmpltDate || x.thtmScmpltDate || x.dlvrTmlmtDate || periodEnd(x.cntrctPrd)),
      no: x.dcsnCntrctNo || '',
    })).sort((a, b) => (a.no < b.no ? -1 : a.no > b.no ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    if (!rows.length) return null;
    const out = { origAmount: rows[0].amount, origEnd: rows[0].end, amount: rows[rows.length - 1].amount, end: rows[rows.length - 1].end, amtChanges: [], endChanges: [] };
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      if (b.amount && a.amount && b.amount !== a.amount) out.amtChanges.push({ date: b.date || ymd8(b.at), amount: b.amount, diff: b.amount - a.amount });
      if (b.end && a.end && b.end !== a.end) out.endChanges.push({ date: b.date || ymd8(b.at), from: a.end, to: b.end });
    }
    // 차수별 원본 행: 화면에서 차수마다 설계변경·기간연장을 고르게 함
    out.chgRows = rows.map((b, i) => {
      const a = i ? rows[i - 1] : null, ord = ordOf(b.no);
      const r = { no: b.no || String(i), ord: ord == null ? i : ord, date: b.date || ymd8(b.at), amount: b.amount, end: b.end };
      if (a) { r.prevAmount = a.amount; r.prevEnd = a.end; r.diff = b.amount && a.amount ? b.amount - a.amount : 0; }
      r.first = !a && (r.ord === 0 || !!opt.firstIsOrig); // 원계약(0차, 또는 차수 계약 중 맨 앞 — 01부터 시작해도)
      if (a) { const pa = ordOf(a.no), pb = ordOf(b.no); if (pa != null && pb != null && pb - pa > 1) r.gap = pb - pa - 1; } // 사이에 빠진 차수
      r.auto = a ? autoKind(r) : (r.first ? 'orig' : '');
      return r;
    });
    // 원계약(0차) 없이 변경 차수만 왔으면 당초 금액·준공일은 모름
    if (!out.chgRows[0].first) { out.origAmount = 0; out.origEnd = ''; }
    return out;
  }
  // 차수별 계약(같은 계약번호의 -00, -01 …)에서 본 값 → 변경이력과 같은 모양. 변경이력 응답이 비어도 차수 표를 만듦
  const ordSnap = (n) => ({ no: n.no || `${String(n.untyNo || n.key || '').toUpperCase()}-${String(n.ord == null ? 0 : n.ord).padStart(2, '0')}`, amount: n.amount || 0, end: n.endDate || '', date: (n.ord > 0 ? n.chgDt || n.contractDate : n.contractDate) || '' });
  function changesOf(c) {
    const g = (c && c.g2b) || {}, ords = Object.values((c && c.ords) || {});
    // 차수 계약(-00·-01·-02 또는 -01·-02)은 실제 계약 기록이므로 맨 앞 차수를 원계약으로 보고, 차수 순서대로 앞 차수와 비교
    const fromOrds = ords.length > 1 ? summarizeChanges(ords.map((o) => ({ dcsnCntrctNo: o.no, totCntrctAmt: o.amount, ttalCcmpltDate: o.end, cntrctDate: o.date })), { firstIsOrig: true }) : null;
    if (g.chgRows && g.chgRows.length && (!fromOrds || g.chgRows.length >= fromOrds.chgRows.length)) return { rows: g.chgRows, origAmount: g.origAmount, origEnd: g.origEnd, src: '나라장터 변경이력' };
    if (fromOrds) return { rows: fromOrds.chgRows, origAmount: fromOrds.origAmount, origEnd: fromOrds.origEnd, src: '나라장터 계약 차수' };
    return null;
  }
  // 앞 차수와 비교한 기본값: 금액이 바뀌었으면 설계변경(준공일도 바뀌었으면 둘 다), 금액이 그대로면 기간연장
  // (변경 차수가 있다는 건 무언가 바뀐 것이므로, 금액이 같으면 준공일을 못 읽었어도 기간연장으로 둠)
  function autoKind(r) {
    const amt = !!(r.amount && r.prevAmount && r.amount !== r.prevAmount), end = !!(r.end && r.prevEnd && r.end !== r.prevEnd);
    return amt && end ? 'both' : amt ? 'design' : 'ext';
  }
  const CHG_KINDS = { design: '설계변경', ext: '기간연장', both: '둘 다', none: '해당 없음' };
  // 차수마다 고른 값(chgKind[차수번호]) > 자동. 원계약은 빼고, 해당 없음·모름도 뺌
  function chgPlan(rows, picked = {}) {
    const out = { design: [], ext: [] };
    for (const r of rows || []) {
      if (r.first) continue;
      const k = (picked && picked[r.no]) || r.auto;
      if (k === 'design' || k === 'both') out.design.push(r);
      if (k === 'ext' || k === 'both') out.ext.push(r);
    }
    return out;
  }
  function periodEnd(s) { const all = String(s || '').match(/\d{4}[-.\/]?\d{2}[-.\/]?\d{2}/g); return all && all.length ? all[all.length - 1] : ''; }
  // 공고번호로 찾은 목록에서 같은 공고만(조회 조건이 무시돼 엉뚱한 목록이 와도 쓰지 않음)
  const sameNtce = (items, no) => (items || []).filter((x) => bareNtce(x.bidNtceNo) === bareNtce(no));
  function pickBid(items, no) {
    const x = sameNtce(items, no).sort((a, b) => String(b.bidNtceOrd || '').localeCompare(String(a.bidNtceOrd || '')))[0];
    return x ? { budget: num(x.bdgtAmt || x.asignBdgtAmt), presmpt: num(x.presmptPrce) } : null;
  }
  function pickPrepar(items, no) {
    const x = sameNtce(items, no).find((y) => num(y.plnprc)) || sameNtce(items, no)[0];
    return x ? { plnprc: num(x.plnprc), bssamt: num(x.bssamt) } : null;
  }
  function pickScsbid(items, no) {
    const x = sameNtce(items, no).find((y) => y.bidwinnrNm) || null;
    return x ? { amount: num(x.sucsfbidAmt), rate: num(x.sucsfbidRate), name: x.bidwinnrNm || '', rep: x.bidwinnrCeoNm || '', addr: x.bidwinnrAdrs || '', bizno: String(x.bidwinnrBizno || '').replace(/\D/g, '') } : null;
  }
  function pickCorp(items, bizno) {
    const b = String(bizno || '').replace(/\D/g, '');
    const x = (items || []).find((y) => String(y.bizno || '').replace(/\D/g, '') === b) || null;
    return x ? { addr: [x.adrs, x.dtlAdrs].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(), rep: x.ceoNm || '', name: x.corpNm || '' } : null;
  }
  // 수의계약 사유: 근거법률 "지방계약법 (제25조제1항5호나목)" + 근거내역 "추정가격 2천만원 이하 물품 또는 용역"
  function contractReason(law, dtl) {
    const s = String(law || '').trim(); if (!s && !dtl) return '';
    let name = s.replace(/\(.*\)/, '').trim(), art = (s.match(/\(([^)]*)\)/) || [])[1] || '';
    if (/^지방계약법$|지방자치단체를 당사자로 하는 계약에 관한 법률$/.test(name) && /제\s*25\s*조/.test(art)) name = '지방계약법 시행령';
    if (/^국가계약법$|국가를 당사자로 하는 계약에 관한 법률$/.test(name) && /제\s*26\s*조/.test(art)) name = '국가계약법 시행령';
    art = art.replace(/제?\s*(\d+)\s*조/, '제$1조 ').replace(/제?\s*(\d+)\s*항/, '제$1항 ').replace(/(?:제\s*)?(\d+)\s*호/, '제$1호 ').replace(/\s+/g, ' ').trim();
    const head = [name, art].filter(Boolean).join(' ');
    const d = String(dtl || '').trim();
    return d ? `${head}${head ? ' ' : ''}(${d})` : head;
  }
  function apiUrl(op, cfg, bgn, end, page, rows) {
    const q = new URLSearchParams({
      inqryDiv: '1', inqryBgnDate: bgn, inqryEndDate: end, insttDivCd: cfg.insttDivCd || '1',
      pageNo: String(page), numOfRows: String(rows || 100), type: 'json',
    });
    if (cfg.insttCd) q.set('insttCd', cfg.insttCd); else if (cfg.insttNm) q.set('insttNm', cfg.insttNm);
    return `${API_BASE}/${op}?serviceKey=${keyParam(cfg.apiKey)}&${q.toString()}`;
  }
  // 조회 기간을 한 달 단위로 쪼갬
  function monthRanges(months, today) {
    const d = today ? new Date(today) : new Date();
    const out = [];
    const ymd = (x) => `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`;
    let end = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    for (let i = 0; i < months; i++) {
      const bgn = new Date(end.getFullYear(), end.getMonth(), 1);
      out.push([ymd(bgn), ymd(end)]);
      end = new Date(bgn.getFullYear(), bgn.getMonth(), 0);
    }
    return out;
  }
  // 공공데이터포털은 인증 오류를 JSON 요청에도 XML로 돌려줌 → 알아들을 수 있는 말로 바꿈
  const API_ERRORS = {
    SERVICE_KEY_IS_NOT_REGISTERED_ERROR: '인증키가 등록되지 않았습니다. 활용신청 승인 직후라면 1~2시간 뒤에 다시 해 보세요.',
    SERVICE_ACCESS_DENIED_ERROR: '이 인증키로 계약정보서비스를 쓸 권한이 없습니다. 공공데이터포털에서 활용신청을 확인하세요.',
    LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR: '오늘 조회할 수 있는 횟수를 넘었습니다. 내일 다시 하거나 불러올 기간을 줄이세요.',
    DEADLINE_HAS_EXPIRED_ERROR: '인증키 사용 기간이 끝났습니다. 공공데이터포털에서 연장하세요.',
    INVALID_REQUEST_PARAMETER_ERROR: '조회 조건이 잘못됐습니다. 기관명을 확인하세요.',
  };
  function parseApiText(text) {
    const t = String(text || '').trim();
    if (/^(Forbidden|Unauthorized)\b/i.test(t)) throw new Error('이 서비스를 쓸 권한이 없습니다(403). 공공데이터포털에서 같은 인증키로 활용신청했는지 확인하세요.');
    if (t.startsWith('{')) return JSON.parse(t);
    const m = t.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/) || t.match(/<resultMsg>([^<]+)<\/resultMsg>/) || t.match(/<errMsg>([^<]+)<\/errMsg>/);
    const code = m ? m[1].trim() : '';
    throw new Error(API_ERRORS[code] || `나라장터 응답을 읽지 못했습니다${code ? ` (${code})` : ''}.`);
  }
  // 공공데이터포털 결과코드(새 게이트웨이는 JSON에 영어 문장으로 줌)
  const RESULT_CODES = { '20': 'SERVICE_ACCESS_DENIED_ERROR', '22': 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR', '30': 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', '31': 'DEADLINE_HAS_EXPIRED_ERROR', '10': 'INVALID_REQUEST_PARAMETER_ERROR', '11': 'INVALID_REQUEST_PARAMETER_ERROR' };
  function parseApiBody(json) {
    const r = json && (json.response || json);
    const h = (r && r.header) || {};
    if (h.resultCode && h.resultCode !== '00') {
      if (h.resultCode === '03' || /NODATA|NO_DATA|NO DATA/i.test(h.resultMsg || '')) return { items: [], total: 0 }; // 자료 없음
      const key = RESULT_CODES[h.resultCode] || String(h.resultMsg || '').trim().toUpperCase().replace(/[.\s]+$/, '').replace(/\s+/g, '_');
      throw new Error(API_ERRORS[key] || `나라장터 응답 오류 ${h.resultCode}: ${h.resultMsg || ''}`.trim());
    }
    const b = (r && r.body) || {};
    let items = b.items;
    if (items && !Array.isArray(items)) items = items.item || [];
    if (items && !Array.isArray(items)) items = [items];
    return { items: items || [], total: Number(b.totalCount || 0) };
  }
  // corpList: "[순번^구분^...^업체명^대표자^...],[...]" — 형식이 바뀌어도 업체명 같은 칸을 고름
  // 업체목록: 실제 응답은 [순번^주계약업체^단독^업체명^대표자^대한민국^지분율^업체명^^사업자번호] 형태, 여러 업체면 ],[ 로 이어짐
  // 주계약업체를 맨 앞으로(공동도급이면 도급업체가 먼저 올 수 있음)
  // 업체목록 칸 하나하나: 명세는 [순번^업체구분^공동도급방식^업체명^대표자명^국적명^지분율^채권자명^담당자성명^사업자등록번호]지만
  // 나라장터 화면은 [구분^공동도급방식^사업자등록번호^업체명^공종^지분율^전체지분율^업체담당자^대표자명] 순서라 순서에 기대지 않음
  //  - 업체명: (주)·주식회사·건설·사무소 같은 말이 든 칸 → 없으면 사람 이름처럼 보이지 않는 첫 글자 칸
  //  - 대표자: 사람 이름처럼 보이는 칸. 여럿이면 가리지 않은 이름(담당자는 송** 처럼 가려 오는 일이 많음), 그다음 업체명 바로 뒤
  const CORP_STOP = /^(단독|공동|단독계약|공동계약|주계약|부계약|대표|대표사|구성원|분담|주계약업체|도급업체|분담업체|부계약업체|공동수급업체|구성원업체|혼합방식|혼합|공동이행|분담이행|공동이행방식|분담이행방식|주계약자관리방식|일반|대한민국|한국|내국|외국|국내|국외|[\d.,\s%*-]*|Y|N)$/;
  const CORP_MARK = /(주식회사|유한회사|합자회사|합명회사|\(주\)|㈜|\(유\)|\(합\)|회사|건설|산업|사무소|기술|엔지니어링|이앤씨|이엔씨|E&C|개발|공사|설비|전기|통신|환경|조경|건축|종합|상사|테크|시스템|코리아|그룹|컨설팅|디자인|연구소|협동조합)/;
  const isPerson = (x) => !!x && !CORP_STOP.test(x) && !CORP_MARK.test(x) && (/^[가-힣*○●]{2,5}$/.test(x) && /[가-힣]/.test(x) || /^[A-Za-z][A-Za-z .]{1,29}$/.test(x));
  const masked = (x) => /[*○●]/.test(x);
  function corpFields(s) {
    return String(s || '').split(/\]\s*,?\s*\[/).map((e) => e.replace(/^\[|\]$/g, '').split('^').map((x) => x.trim())).map((f) => {
      const cand = f.map((x, i) => ({ x, i })).filter(({ x, i }) => i >= 1 && x && /[가-힣A-Za-z]/.test(x) && !CORP_STOP.test(x) && !/^(주계약|부계약|대표|구성원)/.test(x) && !/(계약|방식)$/.test(x));
      const nm = cand.find(({ x }) => CORP_MARK.test(x)) || cand.find(({ x }) => !isPerson(x)) || cand[0];
      const name = nm ? nm.x : '';
      const people = cand.filter(({ x, i }) => (!nm || i !== nm.i) && isPerson(x));
      // 명세 순서(국적 '대한민국'이 있음)면 업체명 바로 뒤 칸만, 아니면(화면 순서) 끝 쪽의 가리지 않은 이름 → 없으면 끝 쪽 이름
      const spec = f.some((x) => /^(대한민국|한국)$/.test(x));
      const pick = spec ? people.find(({ i }) => nm && i === nm.i + 1) || null
        : [...people].reverse().find(({ x }) => !masked(x)) || [...people].reverse()[0] || null;
      const bizno = (f.find((x) => /^\d{3}-?\d{2}-?\d{5}$/.test(x)) || '').replace(/\D/g, '');
      const role = f.slice(1).find((x) => /주계약|부계약|^대표|구성원|도급|분담/.test(x)) || f[1] || '';
      return { role, name, rep: pick ? pick.x : '', bizno };
    }).filter((r) => r.name);
  }
  // corpList → 업체명들(주계약업체를 맨 앞으로)
  function parseCorpList(s) {
    if (!s) return [];
    return parseCorpRows(s).map((r) => r.name);
  }
  // 업체 한 줄을 칸으로(주계약업체 먼저). 대표자명은 가려져 올 수 있음(예: 홍*동) — 그대로 받음
  function parseCorpRows(s) {
    if (!s) return [];
    const rows = corpFields(s);
    rows.sort((a, b) => (/주계약|^대표/.test(b.role) ? 1 : 0) - (/주계약|^대표/.test(a.role) ? 1 : 0));
    return rows;
  }
  // 외부재정연계(e나라도움 등 우리 예산이 아닌 사업) 알아내기
  // 공개 명세에는 정해진 항목 이름이 없어서, 응답의 모든 항목을 훑어 이름·값으로 판단함
  //  - 이름이 재정·연계·보조금 계열이고 값이 Y/예  - 값에 '외부재정', '재정연계', 'e나라도움', '보조금' 같은 말
  const EXT_KEY = /(fnnc|fnc|fin|extrnl|extnl|lnk|link|sbsd|subsid|grnt|nrdm|enara)/i;
  const EXT_VAL = /(외부\s*재정|재정\s*연계|e\s*-?\s*나라\s*도움|이나라도움|국고\s*보조|보조금)/i;
  const NAME_KEYS = /^(cnstwkNm|cntrctNm|bidNtceNm|ntceNm|corpList|crdtrNm|cntrctInsttNm|dminsttNm|cntrctInfoUrl|cntrctDtlInfoUrl)$/;
  function detectExtFinance(x) {
    if (!x || typeof x !== 'object') return null;
    for (const [k, v] of Object.entries(x)) {
      const s = v == null ? '' : String(v).trim();
      if (!s || NAME_KEYS.test(k)) continue; // 계약명·업체명에 '보조금'이 들어가도 예산 출처와는 무관
      if (EXT_VAL.test(s)) return { why: `${k}: ${s.slice(0, 40)}` };
      if (EXT_KEY.test(k) && /^(y|yes|예|해당|1)$/i.test(s)) return { why: `${k}: ${s}` };
    }
    return null;
  }
  function normalizeApiItem(x, type) {
    const ext = detectExtFinance(x);
    const vendors = parseCorpList(x.corpList);
    const corp = parseCorpRows(x.corpList)[0] || {};
    const nums = [x.dcsnCntrctNo, x.untyCntrctNo, x.cntrctRefNo].filter(Boolean);
    return {
      key: baseNo(x.untyCntrctNo || x.dcsnCntrctNo) || contractKey({ nums, name: x.cnstwkNm || x.cntrctNm }),
      ord: ordOf(x.dcsnCntrctNo) != null ? ordOf(x.dcsnCntrctNo) : (() => { const m = String(x.dcsnCntrctNo || '').replace(/\s+/g, '').match(/^.{9,}?-(\d{2,3})$/) || String(x.dcsnCntrctNo || '').replace(/\s+/g, '').match(/^\d{11}(\d{2})$/); return m ? +m[1] : null; })(),
      source: 'api', type,
      name: x.cnstwkNm || x.cntrctNm || '',
      vendor: vendors[0] || x.crdtrNm || '',
      nums,
      no: x.dcsnCntrctNo || x.untyCntrctNo || '',
      amount: Number(String(x.totCntrctAmt || x.thtmCntrctAmt || '0').replace(/[^\d]/g, '')) || 0,
      contractDate: x.cntrctCnclsDate || x.cntrctDate || '',
      startDate: x.cbgnDate || x.wbgnDate || '',
      endDate: x.ttalCcmpltDate || x.thtmCcmpltDate || x.ttalScmpltDate || x.thtmScmpltDate || x.dlvrTmlmtDate || periodEnd(x.cntrctPrd) || '',
      period: x.cntrctPrd || '',
      officer: x.cntrctInsttOfclNm || '',
      dept: x.cntrctInsttChrgDeptNm || '',
      org: x.cntrctInsttNm || '',
      url: x.cntrctDtlInfoUrl || x.cntrctInfoUrl || '',
      budgetAuto: ext ? 'ext' : '', budgetWhy: ext ? ext.why : '',
      method: x.cntrctCnclsMthdNm || '', law: x.baseLawNm || '', lawDtl: x.baseDtls || '',
      rep: corp.rep || '', bizno: corp.bizno || '', ntceNo: x.ntceNo || '', untyNo: x.untyCntrctNo || (/^[A-Z]\d{2}[A-Z]{2}\d{10}$/.test(String(x.dcsnCntrctNo || '')) ? String(x.dcsnCntrctNo).slice(0, 13) : ''), chgDt: x.chgDt || '', corpRaw: String(x.corpList || '').slice(0, 600),
    };
  }

  // ---------- 서류 글자에서 감사 자료 칸 찾기(예정가격·설계금액·예산액·업체 주소·대표자) ----------
  // 표 칸이 줄로 흩어진 문서도 있어 '이름 다음 가까운 숫자/글'을 찾음. 못 찾으면 비워 둠(AI가 이어서 봄)
  function scanAuditFields(lines) {
    const t = (lines || []).join('\n');
    const out = {};
    const money = (re) => {
      const m = t.match(re); if (!m) return 0;
      const n = Number(String(m[1]).replace(/[^\d]/g, ''));
      return n >= 100000 ? n : 0;
    };
    const W = '[^\\d\\n]{0,24}?\\n?[^\\d\\n]{0,12}?';
    out.est = money(new RegExp(`예\\s*정\\s*가\\s*격${W}([\\d,]{6,})`));
    out.design = money(new RegExp(`(?:설\\s*계\\s*금\\s*액|설\\s*계\\s*가\\s*격|기\\s*초\\s*금\\s*액)${W}([\\d,]{6,})`));
    out.budget = money(new RegExp(`(?:예\\s*산\\s*액|배\\s*정\\s*예\\s*산|예\\s*산\\s*금\\s*액|사\\s*업\\s*예\\s*산|소\\s*요\\s*예\\s*산)${W}([\\d,]{6,})`));
    const addr = t.match(/(?:사업장\s*소재지|본\s*점\s*소재지|소\s*재\s*지|주\s*소)\s*[:：]?\s*((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)[^\n]{4,70})/);
    if (addr) out.addr = addr[1].replace(/\s*(전화|TEL|tel|☎|대표자|성명|업태|종목|사업자).*$/, '').replace(/\s+/g, ' ').trim();
    const rep = t.match(/대\s*표\s*자(?:\s*성\s*명)?\s*[:：]?\s*([가-힣]{2,4})(?![가-힣])/);
    if (rep && !/성명|명의|이름|주소|직인/.test(rep[1])) out.rep = rep[1];
    for (const k of Object.keys(out)) if (!out[k]) delete out[k];
    return out;
  }

  // ---------- 상태 계산 ----------
  // 서류가 이 칸에 들어 있나: 그 칸으로 분류됐거나, 여러 양식이 든 파일 안에 그 양식이 있음(d.also)
  const holds = (d, id) => d.itemId === id || (d.also || []).includes(id);
  const hasItem = (docs, physical, id) => (docs || []).some((d) => holds(d, id)) || !!(physical && physical[id]);
  function checklistStatus(list, docs, physical) {
    let reqTotal = 0, reqDone = 0; const missing = [], conv = [];
    for (const item of list) {
      const ds = docs.filter((d) => d.itemId === item.id);
      const got = hasItem(docs, physical, item.id) || !!(item.alt && hasItem(docs, physical, item.alt));
      if (item.required) { reqTotal++; if (got) reqDone++; else missing.push(item); }
      ds.forEach((d) => { if ((d.kind === 'hwp' && !d.pdfFile) || d.kind === 'other') conv.push(d); });
    }
    return { reqTotal, reqDone, missing, conv };
  }
  const fmtDate = (s) => { const m = String(s || '').match(/(\d{4})[-.\/]?(\d{2})[-.\/]?(\d{2})/); return m ? `${m[1]}.${m[2]}.${m[3]}` : ''; };
  const toDate = (s) => { const m = String(s || '').match(/(\d{4})[-.\/]?(\d{2})[-.\/]?(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const won = (n) => (n ? Number(n).toLocaleString('ko-KR') + '원' : '');
  // ---------- 날짜 읽기(증명서 유효기간, 준공계·준공조서 날짜) ----------
  const p2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
  const addDays = (s, n) => { const d = toDate(s); if (!d) return ''; d.setDate(d.getDate() + n); return ymd(d); };
  const DATE_RE = /(20\d{2})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/g;
  function datesIn(s) {
    const out = [];
    for (const m of String(s || '').matchAll(DATE_RE)) { const mo = +m[2], d = +m[3]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(`${m[1]}${p2(mo)}${p2(d)}`); }
    return out;
  }
  // 줄 단위 원문에서: 유효기간(끝 날짜), 발급일, 준공일, 검사일, 문서에 나온 가장 늦은 날짜
  function extractDates(lines) {
    const ls = (lines || []).map((x) => String(x || ''));
    const r = { valid: '', validHow: '', issue: '', finish: '', inspect: '', last: '', bondEnd: '' };
    const all = ls.flatMap(datesIn).sort(); r.last = all.length ? all[all.length - 1] : '';
    let validDays = 0;
    for (let i = 0; i < ls.length; i++) {
      const s = ls[i], here = datesIn(s);
      if (!r.valid && /유\s*효\s*(기\s*간|기\s*한|일)/.test(s)) {
        const days = s.replace(DATE_RE, '').match(/(\d{1,3})\s*일\s*(간|까지|이내)?/);
        const ds = here.length ? here : days ? [] : datesIn(ls[i + 1]);
        if (ds.length) { r.valid = ds.sort()[ds.length - 1]; r.validHow = 'read'; }
        else if (days) validDays = +days[1];
      }
      // 보증서·보험증권: "보증기간 2026.06.01 ~ 2027.01.31" → 끝 날짜(같은 줄에 없으면 다음 줄)
      if (!r.bondEnd && /(보\s*증|보\s*험|공\s*제)\s*(기\s*간|기\s*한)/.test(s)) { const ds = here.length >= 2 ? here : [...here, ...datesIn(ls[i + 1])]; if (ds.length) r.bondEnd = ds.sort()[ds.length - 1]; }
      if (!r.issue && /(발\s*급|발\s*행|증\s*명)\s*일/.test(s) && here.length) r.issue = here[0];
      if (!r.finish && /(준\s*공|완\s*료)\s*(일\s*자|년\s*월\s*일|일)/.test(s) && !/검\s*사/.test(s) && here.length) r.finish = here[0];
      if (!r.inspect && /(검\s*사|검\s*수)\s*(일\s*자|일)/.test(s) && here.length) r.inspect = here[0];
    }
    // "발급일로부터 30일" 같은 경우: 발급일(없으면 문서 마지막 날짜)부터 계산 — 첫날 포함으로 보수적으로
    if (!r.valid && validDays && (r.issue || r.last)) { r.valid = addDays(r.issue || r.last, validDays - 1); r.validHow = 'calc'; }
    return r;
  }
  // ---------- 서류에서 읽은 값으로 나라장터 값 확인(나라장터가 기준) ----------
  // 서류 한 건에서: 계약금액, 계약기간(시작·끝), 착공일, 준공기한, 준공일·검사일, 업체·대표자·주소, 예정가격·설계금액·예산액
  function docFacts(lines) {
    const ls = (lines || []).map((x) => String(x || ''));
    const t = ls.join('\n'), out = {};
    const amt = t.match(/(?:총\s*)?계\s*약\s*금\s*액[^\d\n]{0,24}([\d,]{6,})/); if (amt) { const n = Number(amt[1].replace(/\D/g, '')); if (n >= 100000) out.amount = n; }
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (!out.end && /(계\s*약|공\s*사|용\s*역|과\s*업|이\s*행)\s*기\s*간/.test(l)) {
        let ds = datesIn(l); if (ds.length < 2) ds = ds.concat(datesIn(ls[i + 1]));
        if (ds.length >= 2) { out.start = ds[0]; out.end = ds[ds.length - 1]; }
      }
      if (!out.startDay && /착\s*공\s*(일|년\s*월\s*일|일\s*자|예\s*정\s*일)/.test(l)) { const d = datesIn(l)[0] || datesIn(ls[i + 1])[0]; if (d) out.startDay = d; }
      if (!out.due && /준\s*공\s*(기\s*한|예\s*정\s*일|예\s*정)|완\s*료\s*(기\s*한|예\s*정)|납\s*품\s*기\s*한/.test(l)) { const d = datesIn(l)[0] || datesIn(ls[i + 1])[0]; if (d) out.due = d; }
    }
    const dt = extractDates(ls); if (dt.finish) out.finish = dt.finish; if (dt.inspect) out.inspect = dt.inspect;
    const m = findMeta(ls); if (m.vendor) out.vendor = m.vendor;
    Object.assign(out, scanAuditFields(ls));
    return out;
  }
  // 나라장터 값과 서류 값 비교 → [{ key, label, nara, doc, from, ok, note }]. ok: true 같음 · false 다름(서류 확인) · null 참고
  function verifyFacts(c, docs, nameOf) {
    const g = c.g2b || {}, out = [];
    const facts = (re) => (docs || []).filter((d) => d.facts && re.test(d.itemId || ''));
    const pickF = (re, k) => { for (const d of facts(re)) if (d.facts[k]) return { v: d.facts[k], d }; return null; };
    const src = (d) => (nameOf ? nameOf(d) : d.name);
    const f8 = fmtDate;
    // 계약금액: 당초 또는 변경 후 금액 중 하나와 같으면 맞음
    const ca = pickF(/-contract$/, 'amount');
    if (ca && (c.amount || g.origAmount)) {
      const known = [[g.origAmount, '당초'], ...(g.amtChanges || []).map((x, i) => [x.amount, `${i + 1}차 변경`]), [c.amount, '현재']].filter(([v]) => v);
      const hit = known.find(([v]) => v === ca.v);
      out.push({ key: 'amount', label: '계약금액', nara: won(c.amount) + (g.origAmount && g.origAmount !== c.amount ? ` (당초 ${won(g.origAmount)})` : ''), doc: won(ca.v), from: src(ca.d), ok: !!hit, note: hit ? (hit[1] === '현재' ? '' : `${hit[1]} 금액과 같음`) : '나라장터 금액과 다릅니다 — 서류를 확인하세요' });
    }
    // 계약기간 끝(준공기한): 당초·변경 후 준공일 중 하나와 같으면 맞음
    const ce = pickF(/-contract$/, 'end') || pickF(/-contract$|-start$/, 'due');
    if (ce && c.endDate) {
      const known = [[g.origEnd, '당초'], ...(g.endChanges || []).map((x, i) => [x.to, `${i + 1}차 연장`]), [String(c.endDate).replace(/\D/g, '').slice(0, 8), '현재']].filter(([v]) => v);
      const hit = known.find(([v]) => v === ce.v);
      out.push({ key: 'end', label: '준공기한', nara: f8(c.endDate) + (g.origEnd && g.origEnd !== String(c.endDate).replace(/\D/g, '').slice(0, 8) ? ` (당초 ${f8(g.origEnd)})` : ''), doc: f8(ce.v), from: src(ce.d), ok: !!hit, note: hit ? (hit[1] === '현재' ? '' : `${hit[1]} 준공일과 같음`) : '나라장터 준공기한과 다릅니다 — 변경계약을 나라장터에 등록했는지, 서류가 맞는지 확인하세요' });
    }
    // 착공일
    const cs = pickF(/-start$/, 'startDay') || pickF(/-contract$/, 'start');
    if (cs && c.startDate) { const n = String(c.startDate).replace(/\D/g, '').slice(0, 8); out.push({ key: 'start', label: '착공일', nara: f8(n), doc: f8(cs.v), from: src(cs.d), ok: cs.v === n, note: cs.v === n ? '' : '나라장터 착공일과 다릅니다' }); }
    // 실제 준공일이 준공기한을 넘으면 알림(지체상금·기간연장 확인)
    const fin = pickF(/-finish$/, 'finish') || pickF(/-inspect$/, 'inspect');
    if (fin && c.endDate) { const due = String(c.endDate).replace(/\D/g, '').slice(0, 8); const late = fin.v > due; out.push({ key: 'finish', label: '실제 준공일', nara: `준공기한 ${f8(due)}`, doc: f8(fin.v), from: src(fin.d), ok: late ? false : null, note: late ? '준공기한이 지나 준공 — 기간연장 등록 또는 지체상금을 확인하세요' : '준공기한 안에 준공' }); }
    // 업체·대표자·주소
    const vd = pickF(/-contract$|-related$|-estimate$|-bizreg$|-corpreg$/, 'vendor');
    if (vd && c.vendor) { const same = vendorCore(vd.v) === vendorCore(c.vendor) || vendorCore(vd.v).includes(vendorCore(c.vendor)) || vendorCore(c.vendor).includes(vendorCore(vd.v)); out.push({ key: 'vendor', label: '업체', nara: c.vendor, doc: vd.v, from: src(vd.d), ok: same, note: same ? '' : '나라장터 업체와 다릅니다' }); }
    const rp = pickF(/-bizreg$|-corpreg$|-related$|-contract$|-estimate$/, 'rep'), naraRep = c.rep || g.rep;
    if (rp && naraRep) out.push({ key: 'rep', label: '대표자', nara: naraRep, doc: rp.v, from: src(rp.d), ok: norm(rp.v) === norm(naraRep), note: norm(rp.v) === norm(naraRep) ? '' : '나라장터 대표자와 다릅니다(대표자 변경 여부 확인)' });
    const ad = pickF(/-bizreg$|-corpreg$|-related$|-contract$|-estimate$/, 'addr');
    if (ad && g.addr) { const a = norm(ad.v).slice(0, 12), b = norm(g.addr).slice(0, 12); const same = a === b || norm(g.addr).includes(a) || norm(ad.v).includes(b); out.push({ key: 'addr', label: '업체 주소', nara: g.addr, doc: ad.v, from: src(ad.d), ok: same, note: same ? '' : '나라장터 주소와 다릅니다(본점 이전 여부 확인)' }); }
    // 예정가격·기초금액·예산액(나라장터에 있을 때만)
    for (const [k, nk, label] of [['est', 'plnprc', '예정가격'], ['design', 'bssamt', '기초금액·설계금액'], ['budget', 'budget', '예산액']]) {
      const dv = pickF(/./, k); if (!dv || !g[nk]) continue;
      out.push({ key: k, label, nara: won(g[nk]), doc: won(dv.v), from: src(dv.d), ok: dv.v === g[nk], note: dv.v === g[nk] ? '' : '나라장터 값과 다릅니다' });
    }
    return out;
  }
  // 계약일 기준 3개월 이내 발급분이어야 하는 서류(법인등기사항증명서·인감증명서): 발급일이 계약일보다 3개월 넘게 앞서면 알림
  const isRecentItem = (id) => /-(corpreg|seal)$/.test(String(id || ''));
  function issuedTooEarly(issue, contractDate) {
    const a = String(issue || '').replace(/\D/g, '').slice(0, 8), b = String(contractDate || '').replace(/\D/g, '').slice(0, 8);
    if (a.length < 8 || b.length < 8) return null;
    const lim = new Date(+b.slice(0, 4), +b.slice(4, 6) - 1 - 3, +b.slice(6, 8));
    const d = new Date(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8));
    return d < lim;
  }
  // 유효기간을 따지는 증명서: 4대 사회보험·고용산재 완납증명서, 국세·지방세 납세증명서
  const isCertItem = (id) => /-(inspaid|emppaid|tax|ltax)$/.test(String(id || ''));
  // 선금 보증서: 보증기간 끝이 준공일로부터 60일 이상 남아 있어야 유효
  const ADV_DAYS = 60;
  const isAdvBond = (id) => /-advbond$/.test(String(id || ''));
  function advBondCheck(bondEnd, endDate) {
    const a = toDate(bondEnd), b = toDate(endDate);
    if (!a) return { status: 'unknown' };
    if (!b) return { status: 'noend', end: ymd(a) };
    const days = Math.round((a - b) / 864e5);
    return { status: days >= ADV_DAYS ? 'ok' : 'short', days, end: ymd(a), need: addDays(ymd(b), ADV_DAYS) };
  }

  // 업체 보완 요청 메일(빠진 서류 + 유효기간 부족으로 재발급할 서류)
  // 감독관 경유가 필요한 서류(공사·용역): 착공(착수)계·현장대리인계·예정공정표, 산출내역서, 견적서, 노무비 지급확인제, 준공계·준공검사원
  // 한 줄에 여러 서류가 묶인 것은 서류마다 따로 체크. 저장: c.via['c-start:착공계'] = true
  const VIA_PARTS = { start: ['착공계', '현장대리인계', '예정공정표'], calc: [''], estimate: [''], laborconfirm: [''], finish: ['준공계', '준공검사원'] };
  function viaParts(id) {
    const m = String(id || '').match(/^([cs])-(start|calc|estimate|laborconfirm|finish)$/); if (!m) return null;
    return m[1] === 's' && m[2] === 'start' ? ['착수계(착공계)', '현장대리인계', '예정공정표'] : VIA_PARTS[m[2]];
  }
  const viaKey = (id, part) => (part ? `${id}:${part}` : id);
  // 들어온 서류만 따짐(has(id)): 경유 안 된 것 이름 목록
  function viaStatus(c, list, has) {
    const out = { need: 0, done: 0, missing: [] }, v = (c && c.via) || {};
    for (const x of list || []) {
      const ps = viaParts(x.id); if (!ps || !has(x.id)) continue;
      for (const p of ps) { out.need++; if (v[viaKey(x.id, p)]) out.done++; else out.missing.push(p || x.name.replace(/\(.*\)$/, '')); }
    }
    return out;
  }
  // ---------- 지출 회차(선금·기성·노무비) — 마지막 준공금은 기존 서류 목록 ----------
  // 처리 순서(기성): 1 업체 기성계 제출(감독관 경유)·계약팀 접수 → 2 기성검사원 지정통보 감독부서 발송 → 3 기성부분 검사조서 접수 → 4 업체에 청구 서류 요청·접수 → 5 지출결의
  const PAY_KINDS = { adv: '선금', prog: '기성', labor: '노무비' };
  const typeKey = (type) => (type === '용역' ? 's' : type === '물품' ? 'g' : 'c');
  const hasRounds = (type) => type === '공사' || type === '용역';
  // 회차에만 쓰는 서류(준공 목록에는 없음)
  function roundOnly(type) {
    const k = typeKey(type);
    return [
      it('기성계', '기성계·기성검사원', '기성계,기성검사원,기성부분검사원,기성검사신청,기성검사요청,기성신고,기성부분내역,기성내역서,기성고내역', { note: '기성부분 내역서 포함 · 감독관 경유 · 스캔본', id: k + '-progfin' }),
      it('검사원 지정', '기성검사원 지정통보', NOTICE_KW + ',기성검사원지정,기성검사자지정,기성검사공무원지정', { source: '문서함', note: '감독부서에 발송', id: k + '-prognotice' }),
      it('검사조서', '기성부분 검사조서', '기성부분검사조서,기성검사조서,기성부분검사결과,기성검사결과,기성부분검사', { source: '문서함', id: k + '-proginsp' }),
      it('노무비 청구', '노무비 청구서', '노무비청구,노무비지급청구,노무비지급요청,노무비신청,노무비청구서', { note: '감독관 경유 · 스캔본', id: k + '-laborclaim' }),
      it('노무비 청구', '전월 노무비 지급 확인(이체확인증)', '이체확인증,이체확인,이체내역,입금확인,노무비지급확인서,노무비이체', { source: '메일', required: false, note: '전달 지급분을 근로자에게 줬는지', id: k + '-laborxfer' }),
      it('선금 청구', '선금 청구서(선금 지급 신청서)', '선금청구,선급금청구,선금지급신청,선급금지급신청,선금신청,선급금신청,선금지급요청,선급금지급요청', { source: '메일', id: k + '-advclaim' }),
      it('선금 청구', '선금 사용계획서', '선금사용계획,선급금사용계획,선금사용', { source: '메일', required: false, note: '해당 시', id: k + '-advplan' }),
    ].map((x) => ({ ...x, round: true }));
  }
  // 회차 하나의 단계별 서류. list = 그 계약 구분의 서류 목록(직접 고친 것 포함) — 청구 서류는 거기 것을 그대로 씀
  function roundSteps(kind, type, list) {
    const k = typeKey(type), only = roundOnly(type);
    const pick = (suf, over = {}) => { const x = (list || []).find((y) => y.id === `${k}-${suf}`) || only.find((y) => y.id === `${k}-${suf}`); return x ? { ...x, ...over } : null; };
    const opt = (note) => ({ required: false, note });
    const claim = (step) => [pick('claim', { group: step }), pick('tax', { group: step }), pick('ltax', { group: step }), pick('inspaid', { group: step }),
      pick('emppaid', { group: step, ...(k === 's' ? opt('해당 시') : {}) }), pick('bond', { group: step, ...opt('해당 시') }), pick('invoice', { group: step }), pick('laborlist', { group: step, ...opt('노무비 구분관리 대상') })];
    const pay = (step) => [pick('pay', { group: step })];
    const st = (name, items) => ({ name, items: items.filter(Boolean).map((x) => ({ ...x, group: name })) });
    if (kind === 'prog') return [
      st('기성계 제출(감독관 경유)', [pick('progfin')]),
      st('기성검사원 지정통보', [pick('prognotice')]),
      st('기성부분 검사조서', [pick('proginsp')]),
      st('청구 서류', claim()),
      st('지출결의', pay()),
    ];
    if (kind === 'labor') return [
      st('노무비 청구(감독관 경유)', [pick('laborclaim'), pick('laborlist', { required: true, note: '근로자별 근로일수·금액' }), pick('laborxfer')]),
      st('지출결의', pay()),
    ];
    return [ // adv
      st('선금 청구', [pick('advclaim'), pick('advbond', { required: true, note: '보증기간이 준공일 + 60일 이상', link: true }), pick('advplan'), pick('tax'), pick('ltax')]),
      st('지출결의', pay()),
    ];
  }
  const ROUND_SUF = { progfin: 'prog', prognotice: 'prog', proginsp: 'prog', laborclaim: 'labor', laborxfer: 'labor', advclaim: 'adv', advplan: 'adv' };
  const FINAL_TO_PROG = { finish: 'progfin', notice: 'prognotice', inspect: 'proginsp' };
  const SHARED_PAY = /^(claim|tax|ltax|inspaid|emppaid|bond|invoice|pay|laborlist)$/;
  // 파일 이름·제목에서 어느 지출 회차 서류인지 힌트: { kind: prog|labor|adv|final, n, month }
  //  스캔본(noname.pdf 등)은 이름에 회차가 없으니 글자 앞부분(body)에서 '제3회 기성'을 찾음 — 구분(기성·준공)은 이름·제목으로만(본문엔 준공예정일 같은 말이 흔함)
  function roundHint(name, title, body) {
    const h = norm(stem(name || '')) + '|' + String(title || '');
    const out = {};
    if (/최종기성|준공기성|준공금|준공대가|준공검사|준공계|준공조서/.test(h)) out.kind = 'final';
    else if (/기성/.test(h)) out.kind = 'prog';
    else if (/노무비(청구|지급청구|지급요청|신청)|\d{1,2}월분노무비|노무비\d{1,2}월/.test(h)) out.kind = 'labor';
    else if (/선금|선급금/.test(h)) out.kind = 'adv';
    const n = h.match(/(?:제)?(\d{1,2})(?:회|차)(?:분)?기성/) || h.match(/기성(?:금|부분|검사|계|고)*(?:제)?(\d{1,2})(?:회|차)/);
    const nb = !n && body && out.kind === 'prog' ? (String(body).slice(0, 2500).match(/(?:제)?(\d{1,2})(?:회|차)(?:분)?기성/) || String(body).slice(0, 2500).match(/기성(?:금|부분|검사|계|고)*(?:제)?(\d{1,2})(?:회|차)/)) : null;
    if (n || nb) out.n = +(n || nb)[1];
    const m = h.match(/(\d{1,2})월분/) || (out.kind === 'labor' && h.match(/(\d{1,2})월/));
    if (m && +m[1] >= 1 && +m[1] <= 12) out.month = +m[1];
    return out;
  }
  // 회차 이름 = 계약 폴더 안 회차 폴더 이름: '1차 기성', '노무비 10월분', '선금'
  const roundLabel = (r) => (r.kind === 'prog' ? `${r.n || 1}차 기성` : r.kind === 'adv' ? '선금' : r.month ? `노무비 ${r.month}월분` : `노무비 ${r.n || 1}차`);
  // 서류 하나를 어느 회차로: 반환 { kind, n?, month?, itemId } 또는 null(준공 목록)
  //  open = 아직 지출 안 한 회차들(앞선 것부터). 회차 전용 서류는 늘 회차로, 청구 서류는 힌트가 없으면 열려 있는 첫 회차로(없으면 준공)
  function routeRound(type, itemId, name, title, open, body) {
    if (!hasRounds(type) || !itemId) return null;
    const suf = String(itemId).replace(/^[csg]-/, '');
    const h = roundHint(name, title, body);
    if (ROUND_SUF[suf] === 'prog' && !h.kind) h.kind = 'prog';
    if (h.kind === 'prog' && !h.n && body) { const b = roundHint(name, title + '기성', body); if (b.n) h.n = b.n; }
    if (ROUND_SUF[suf]) return { kind: ROUND_SUF[suf], n: h.n, month: h.month, itemId };
    if (FINAL_TO_PROG[suf] && h.kind === 'prog') return { kind: 'prog', n: h.n, itemId: itemId.replace(suf, FINAL_TO_PROG[suf]) };
    if (!SHARED_PAY.test(suf)) return null;
    if (h.kind === 'final') return null;
    if (h.kind) return { kind: h.kind, n: h.n, month: h.month, itemId };
    const first = (open || [])[0];
    return first ? { kind: first.kind, n: first.n, month: first.month, id: first.id, itemId } : null;
  }

  function vendorMail({ c, org, dept, officer, phone, missing = [], reissue = [], via = [], basis, round }) {
    const f = (s) => fmtDate(s);
    const title = round ? `[${org || '발주기관'}] 「${c.name || '계약'}」 ${round} 대금 청구 서류 제출 요청` : `[${org || '발주기관'}] 「${c.name || '계약'}」 대금 청구 서류 보완 요청`;
    const secs = [];
    if (missing.length) secs.push([round ? '제출할 서류' : '미제출 서류', missing.map((n) => `  - ${n}`)]);
    if (reissue.length) secs.push(['재발급 필요 서류(유효기간 부족)', reissue.map((x) => `  - ${x.name}: 유효기간 ${f(x.valid)}까지 → ${f(basis.date)} 이후까지 유효한 증명서로 재발급`)]);
    if (via.length) secs.push(['감독관 경유가 필요한 서류', via.map((n) => `  - ${n}: 감독관 경유(확인) 후 다시 제출`)]);
    if (reissue.length && basis && basis.date) secs.push(['기준', [`  - 대금 지급 예정일(${f(basis.date)}) 기준으로 유효한 증명서가 필요합니다.`]]);
    const who = [org, dept, officer].filter(Boolean).join(' ');
    const body = [
      '안녕하십니까.' + (who ? ` ${who}입니다.` : ''),
      '',
      round ? `「${c.name || ''}」${c.no ? `(계약번호 ${c.no})` : ''} ${round} 검사를 마쳐 대금을 지급하고자 하오니, 아래 서류를 제출해 주시기 바랍니다.`
        : `「${c.name || ''}」${c.no ? `(계약번호 ${c.no})` : ''} 대금 지급을 위해 제출 서류를 확인한 결과, 아래 서류의 보완을 요청드리고자 합니다.`,
      '',
      ...secs.flatMap(([h, ls], i) => [`${i + 1}. ${h}`, ...ls, '']),
      '회신 메일로 보내 주시면 확인 후 지급 절차를 진행하겠습니다.',
      '감사합니다.',
      '',
      `${officer || ''} 드림`,
      [org, dept].filter(Boolean).join(' ') + (phone ? ` / ${phone}` : ''),
    ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { title, body };
  }

  const safeName = (s, max = 60) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, max) || '이름없음';

  const api = {
    norm, uid, stem, extOf, kindOf, defaultChecklists, STAGES, ORIGINAL_SOURCES,
    classifyItem, guessType, findMeta, vendorCore, baseNo, contractScore, matchContract, contractKey,
    API_BASE, API_OPS, TYPES, apiUrl, keyParam, monthRanges, parseApiText, parseApiBody, parseCorpList, parseCorpRows, normalizeApiItem, detectExtFinance,
    G2B, g2bUrl, scanAuditFields, summarizeChanges, chgPlan, autoKind, CHG_KINDS, changesOf, ordSnap, pickBid, pickPrepar, pickScsbid, pickCorp, contractReason, bareNtce, periodEnd, num,
    ordOf, viaParts, viaKey, viaStatus, itemsInName, isRecentItem, issuedTooEarly, isAdvBond, advBondCheck, ADV_DAYS, matchCandidates, checklistStatus, holds, hasItem, classifyPages, classifyTitleLines, fmtDate, toDate, won, safeName, datesIn, extractDates, docFacts, verifyFacts, addDays, isCertItem, vendorMail,
    PAY_KINDS, typeKey, hasRounds, roundOnly, roundSteps, roundHint, roundLabel, routeRound,
  };
  root.JH = root.JH || {};
  root.JH.logic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
