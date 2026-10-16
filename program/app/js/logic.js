/*
 * 지출서류 도우미 — 순수 로직 (브라우저·Node 공용, 화면/파일 접근 없음)
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
  });

  function defaultChecklists() {
    seq = 0;
    const g1 = '구매요구', g2 = '계약', g5 = '준공조서', g6 = '대금청구', g7 = '지출결의';
    const head = (k) => [
      it(g1, '구매요구서', '구매요구,구매요청', { source: '문서함', note: '설계내역서·시방서 등 포함', id: k + '-req' }),
      it(g2, '계약서', '계약서,계약문서,계약체결', { source: '나라장터', id: k + '-contract' }),
      it(g2, '견적서·설계내역서', '견적,설계내역,내역서,산출내역', { source: '나라장터', id: k + '-estimate' }),
      it(g2, '계약 관련서류', '관련서류,관련문서,이행각서,서약서,청렴계약,수의계약,등기부,인감,사업자등록,면허', { source: '나라장터', note: '이행각서·서약서·등기부등본·사업자등록증 등', id: k + '-related' }),
    ];
    const tail = (k) => [
      it(g5, '준공조서', '준공조서,검사조서,검수조서,준공검사조서', { source: '문서함', id: k + '-inspect' }),
      it(g6, '대금청구서', '청구서,대금청구,대가청구,청구', { source: '메일', id: k + '-claim' }),
      it(g6, '통장사본', '통장', { source: '메일', id: k + '-bank' }),
      it(g6, '국세 납세증명서', '국세,납세증명', { source: '메일', id: k + '-tax' }),
      it(g6, '지방세 납세증명서', '지방세,지방세납세,지방세완납', { source: '메일', id: k + '-ltax' }),
      it(g6, '세금계산서', '세금계산서,계산서', { source: '메일', id: k + '-invoice' }),
      it(g7, '지출결의서', '지출결의,지출품의', { source: '문서함', id: k + '-pay' }),
    ];
    const 공사 = [
      ...head('c'),
      it('착공계', '착공계·현장대리인계·예정공정표', '착공,현장대리인계,예정공정', { id: 'c-start' }),
      it('착공계', '현장대리인 재직증명서·자격증', '재직증명,자격증', { required: false, note: '해당 시', id: 'c-agent' }),
      it('착공계', '노무비 지급확인제', '노무비지급확인,지급확인제', { id: 'c-laborconfirm' }),
      it('착공계', '4대 사회보험 가입자명부', '가입자명부', { required: false, note: '상용근로자 해당 시', id: 'c-roster' }),
      it('착공계', '4대 사회보험 가입증명서', '사회보험가입증명,보험가입증명서,가입증명서', { id: 'c-insjoin' }),
      it('착공계', '고용·산재 가입증명원', '고용산재가입,가입증명원,고용보험가입,산재보험가입', { note: '공사명·공사기간·계약금액 필수', id: 'c-empjoin' }),
      it('준공계', '준공계·준공검사원', '준공계,준공검사원,준공신고', { id: 'c-finish' }),
      it('준공계', '준공사진대지', '사진대지,준공사진', { id: 'c-photo' }),
      it('준공계', '4대 사회보험 완납증명서', '사회보험완납,사회보험료완납,4대보험완납,보험료완납', { id: 'c-inspaid' }),
      it('준공계', '노무비 미체불 확약서', '미체불', { required: false, note: '일용근로자 해당 시', id: 'c-nounpaid' }),
      it('준공계', '노무비 지급 내역서', '노무비지급내역,지급내역서', { required: false, note: '일용근로자 해당 시', id: 'c-laborlist' }),
      it('준공계', '고용·산재 완납증명서', '고용산재완납,고용보험료완납,산재보험료완납', { note: '공사명 기재 필수', id: 'c-emppaid' }),
      it('준공계', '하자보수 이행보증금 지급각서', '하자보수,하자이행,지급각서', { id: 'c-defect' }),
      ...tail('c'),
    ];
    const 용역 = [
      ...head('s'),
      it('착수계', '착수계·현장대리인계·예정공정표', '착수,현장대리인계,예정공정', { id: 's-start' }),
      it('착수계', '현장대리인 재직증명서·자격증', '재직증명,자격증', { required: false, note: '해당 시', id: 's-agent' }),
      it('착수계', '보안각서·보안서약서', '보안각서,보안서약', { required: false, note: '해당 용역', id: 's-security' }),
      it('착수계', '4대 사회보험 가입증명서', '사회보험가입증명,보험가입증명서,가입증명서', { id: 's-insjoin' }),
      it('착수계', '고용·산재 가입증명원', '고용산재가입,가입증명원,고용보험가입,산재보험가입', { required: false, note: '단순노무용역', id: 's-empjoin' }),
      it('착수계', '노무비 지급확인제', '노무비지급확인,지급확인제', { required: false, note: '단순노무용역', id: 's-laborconfirm' }),
      it('준공계', '준공계·준공검사원', '준공계,준공검사원,준공신고,완료계', { id: 's-finish' }),
      it('준공계', '준공사진대지', '사진대지,준공사진', { id: 's-photo' }),
      it('준공계', '작업결과물', '결과물,결과보고,최종보고', { required: false, note: '해당 시', id: 's-result' }),
      it('준공계', '4대 사회보험 완납증명서', '사회보험완납,사회보험료완납,4대보험완납,보험료완납', { id: 's-inspaid' }),
      it('준공계', '하자보수 이행보증금 지급각서', '하자보수,하자이행,지급각서', { id: 's-defect' }),
      it('준공계', '노무비 미체불 확약서', '미체불', { required: false, note: '단순노무용역', id: 's-nounpaid' }),
      it('준공계', '용역근로자 노무비 지급 내역서', '노무비지급내역,지급내역서', { required: false, note: '단순노무용역', id: 's-laborlist' }),
      ...tail('s'),
    ];
    return { 공사, 용역 };
  }
  const STAGES = ['구매요구', '계약', '착공계', '착수계', '준공계', '준공조서', '대금청구', '지출결의'];

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
  // 계약서 제목으로 공사/용역 추정
  function guessType(title) {
    const t = title || '';
    const a = t.indexOf('용역'), b = t.indexOf('공사');
    if (a >= 0 && (b < 0 || a < b)) return '용역';
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
  const baseNo = (n) => norm(String(n || '').split('-')[0]);

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
  const contractKey = (c) => baseNo((c.nums || [])[0]) || ('n:' + norm(c.name)) || ('x:' + uid());

  // ---------- 나라장터 계약정보 API ----------
  const API_BASE = 'https://apis.data.go.kr/1230000/ao/CntrctInfoService';
  const API_OPS = { 공사: 'getCntrctInfoListCnstwkPPSSrch', 용역: 'getCntrctInfoListServcPPSSrch' };
  function apiUrl(op, cfg, bgn, end, page, rows) {
    const q = new URLSearchParams({
      inqryDiv: '1', inqryBgnDate: bgn, inqryEndDate: end, insttDivCd: cfg.insttDivCd || '1',
      pageNo: String(page), numOfRows: String(rows || 100), type: 'json',
    });
    if (cfg.insttCd) q.set('insttCd', cfg.insttCd); else if (cfg.insttNm) q.set('insttNm', cfg.insttNm);
    return `${API_BASE}/${op}?serviceKey=${encodeURIComponent(String(cfg.apiKey || '').trim())}&${q.toString()}`;
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
    if (t.startsWith('{')) return JSON.parse(t);
    const m = t.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/) || t.match(/<resultMsg>([^<]+)<\/resultMsg>/) || t.match(/<errMsg>([^<]+)<\/errMsg>/);
    const code = m ? m[1].trim() : '';
    throw new Error(API_ERRORS[code] || `나라장터 응답을 읽지 못했습니다${code ? ` (${code})` : ''}.`);
  }
  function parseApiBody(json) {
    const r = json && (json.response || json);
    const h = (r && r.header) || {};
    if (h.resultCode && h.resultCode !== '00') throw new Error(`나라장터 응답 오류 ${h.resultCode}: ${h.resultMsg || ''}`.trim());
    const b = (r && r.body) || {};
    let items = b.items;
    if (items && !Array.isArray(items)) items = items.item || [];
    if (items && !Array.isArray(items)) items = [items];
    return { items: items || [], total: Number(b.totalCount || 0) };
  }
  // corpList: "[순번^구분^...^업체명^대표자^...],[...]" — 형식이 바뀌어도 업체명 같은 칸을 고름
  function parseCorpList(s) {
    if (!s) return [];
    const STOP = /^(단독|공동|주계약|부계약|대표사|구성원|분담|대한민국|한국|내국|외국|국내|국외|\d.*|Y|N)$/;
    return String(s).split(/\]\s*,?\s*\[/).map((e) => e.replace(/^\[|\]$/g, '')).map((e) => {
      const f = e.split('^').map((x) => x.trim()).filter(Boolean);
      const ko = f.filter((x) => /[가-힣]/.test(x) && !STOP.test(x));
      const corp = ko.find((x) => /(주식회사|\(주\)|㈜|유한|건설|전기|산업|기업|엔지니어링|기술|개발|공업|종합|토건|통신|조경|환경|상사|시스템|컨설팅|디자인)/.test(x));
      return corp || ko[0] || '';
    }).filter(Boolean);
  }
  function normalizeApiItem(x, type) {
    const vendors = parseCorpList(x.corpList);
    const nums = [x.dcsnCntrctNo, x.untyCntrctNo, x.cntrctRefNo].filter(Boolean);
    return {
      key: baseNo(x.untyCntrctNo || x.dcsnCntrctNo) || contractKey({ nums, name: x.cnstwkNm || x.cntrctNm }),
      source: 'api', type,
      name: x.cnstwkNm || x.cntrctNm || '',
      vendor: vendors[0] || x.crdtrNm || '',
      nums,
      no: x.dcsnCntrctNo || x.untyCntrctNo || '',
      amount: Number(String(x.totCntrctAmt || x.thtmCntrctAmt || '0').replace(/[^\d]/g, '')) || 0,
      contractDate: x.cntrctCnclsDate || x.cntrctDate || '',
      startDate: x.cbgnDate || x.wbgnDate || '',
      endDate: x.ttalCcmpltDate || x.thtmCcmpltDate || x.ttalScmpltDate || x.thtmScmpltDate || '',
      period: x.cntrctPrd || '',
      officer: x.cntrctInsttOfclNm || '',
      dept: x.cntrctInsttChrgDeptNm || '',
      org: x.cntrctInsttNm || '',
      url: x.cntrctDtlInfoUrl || x.cntrctInfoUrl || '',
    };
  }

  // ---------- 상태 계산 ----------
  function checklistStatus(list, docs, physical) {
    let reqTotal = 0, reqDone = 0; const missing = [], conv = [];
    for (const item of list) {
      const ds = docs.filter((d) => d.itemId === item.id);
      const got = ds.length > 0 || !!(physical && physical[item.id]);
      if (item.required) { reqTotal++; if (got) reqDone++; else missing.push(item); }
      ds.forEach((d) => { if ((d.kind === 'hwp' && !d.pdfFile) || d.kind === 'other') conv.push(d); });
    }
    return { reqTotal, reqDone, missing, conv };
  }
  const fmtDate = (s) => { const m = String(s || '').match(/(\d{4})[-.\/]?(\d{2})[-.\/]?(\d{2})/); return m ? `${m[1]}.${m[2]}.${m[3]}` : ''; };
  const toDate = (s) => { const m = String(s || '').match(/(\d{4})[-.\/]?(\d{2})[-.\/]?(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const won = (n) => (n ? Number(n).toLocaleString('ko-KR') + '원' : '');
  const safeName = (s, max = 60) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, max) || '이름없음';

  const api = {
    norm, uid, stem, extOf, kindOf, defaultChecklists, STAGES, ORIGINAL_SOURCES,
    classifyItem, guessType, findMeta, vendorCore, baseNo, contractScore, matchContract, contractKey,
    API_BASE, API_OPS, apiUrl, monthRanges, parseApiText, parseApiBody, parseCorpList, normalizeApiItem,
    checklistStatus, fmtDate, toDate, won, safeName,
  };
  root.JH = root.JH || {};
  root.JH.logic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
