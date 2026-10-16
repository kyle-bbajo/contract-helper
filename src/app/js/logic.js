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
  });

  function defaultChecklists() {
    seq = 0;
    const g1 = '구매요구', g2 = '계약', g5 = '준공조서', g6 = '대금청구', g7 = '지출결의';
    const head = (k) => [
      it(g1, '구매요구서 또는 기안문', '구매요구,구매요청,계약의뢰,계약요청,일반기안,기안문', { source: '문서함', note: '설계내역서·시방서 등 포함. 우리 예산이 아닌 사업(e나라도움 등)은 일반 기안문', id: k + '-req' }),
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
    const 물품 = [
      ...head('g'),
      it('납품', '납품계·납품서', '납품계,납품서,납품신고,납품확인', { id: 'g-finish' }),
      it('납품', '거래명세서', '거래명세,명세표', { required: false, note: '해당 시', id: 'g-spec' }),
      it('납품', '하자보수 이행보증금 지급각서', '하자보수,하자이행,지급각서', { required: false, note: '해당 시', id: 'g-defect' }),
      ...tail('g'),
    ];
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
    return `${g.base}/${g.op(type)}?serviceKey=${encodeURIComponent(String(apiKey || '').trim())}&${q.toString()}`;
  }
  const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return isFinite(n) && String(v || '').trim() !== '' ? n : 0; };
  const ymd8 = (s) => { const m = String(s || '').match(/(\d{4})[-.\/]?(\d{2})[-.\/]?(\d{2})/); return m ? m[1] + m[2] + m[3] : ''; };
  // 변경이력 → 당초 금액·준공일, 금액 바뀐 차수(설계변경), 준공일 바뀐 차수(기간연장)
  function summarizeChanges(items) {
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
  // 업체목록: 실제 응답은 [순번^주계약업체^단독^업체명^대표자^대한민국^지분율^업체명^^사업자번호] 형태, 여러 업체면 ],[ 로 이어짐
  // 주계약업체를 맨 앞으로(공동도급이면 도급업체가 먼저 올 수 있음)
  function parseCorpList(s) {
    if (!s) return [];
    const STOP = /^(단독|공동|주계약|부계약|대표사|구성원|분담|주계약업체|도급업체|분담업체|부계약업체|공동수급업체|구성원업체|혼합방식|혼합|공동이행|분담이행|주계약자관리방식|대한민국|한국|내국|외국|국내|국외|[\d.,\s%]*|Y|N)$/;
    const rows = String(s).split(/\]\s*,?\s*\[/).map((e) => e.replace(/^\[|\]$/g, '')).map((e) => {
      const f = e.split('^').map((x) => x.trim());
      const role = f[1] || '';
      const name = f.slice(2).find((x) => x && /[가-힣A-Za-z]/.test(x) && !STOP.test(x)) || '';
      return { role, name };
    }).filter((r) => r.name);
    rows.sort((a, b) => (/주계약|대표/.test(b.role) ? 1 : 0) - (/주계약|대표/.test(a.role) ? 1 : 0));
    return rows.map((r) => r.name);
  }
  // 업체 한 줄을 칸으로: [순번^구분^방식^업체명^대표자^국가^지분율^업체명^^사업자번호]
  function parseCorpRows(s) {
    if (!s) return [];
    const rows = String(s).split(/\]\s*,?\s*\[/).map((e) => e.replace(/^\[|\]$/g, '').split('^').map((x) => x.trim())).map((f) => {
      const bizno = (f.find((x) => /^\d{3}-?\d{2}-?\d{5}$/.test(x)) || '').replace(/\D/g, '');
      return { role: f[1] || '', name: f[3] || '', rep: /^[가-힣A-Za-z ,·]{2,30}$/.test(f[4] || '') && !/대한민국|한국/.test(f[4]) ? f[4] : '', bizno };
    }).filter((r) => r.name);
    rows.sort((a, b) => (/주계약|대표/.test(b.role) ? 1 : 0) - (/주계약|대표/.test(a.role) ? 1 : 0));
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
      rep: corp.rep || '', bizno: corp.bizno || '', ntceNo: x.ntceNo || '', untyNo: x.untyCntrctNo || '', chgDt: x.chgDt || '',
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
    const r = { valid: '', validHow: '', issue: '', finish: '', inspect: '', last: '' };
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
      if (!r.issue && /(발\s*급|발\s*행|증\s*명)\s*일/.test(s) && here.length) r.issue = here[0];
      if (!r.finish && /(준\s*공|완\s*료)\s*(일\s*자|년\s*월\s*일|일)/.test(s) && !/검\s*사/.test(s) && here.length) r.finish = here[0];
      if (!r.inspect && /(검\s*사|검\s*수)\s*(일\s*자|일)/.test(s) && here.length) r.inspect = here[0];
    }
    // "발급일로부터 30일" 같은 경우: 발급일(없으면 문서 마지막 날짜)부터 계산 — 첫날 포함으로 보수적으로
    if (!r.valid && validDays && (r.issue || r.last)) { r.valid = addDays(r.issue || r.last, validDays - 1); r.validHow = 'calc'; }
    return r;
  }
  // 유효기간을 따지는 증명서: 4대 사회보험·고용산재 완납증명서, 국세·지방세 납세증명서
  const isCertItem = (id) => /-(inspaid|emppaid|tax|ltax)$/.test(String(id || ''));

  // 업체 보완 요청 메일(빠진 서류 + 유효기간 부족으로 재발급할 서류)
  function vendorMail({ c, org, dept, officer, phone, missing = [], reissue = [], basis }) {
    const f = (s) => fmtDate(s);
    const title = `[${org || '발주기관'}] 「${c.name || '계약'}」 대금 청구 서류 보완 요청`;
    const secs = [];
    if (missing.length) secs.push(['미제출 서류', missing.map((n) => `  - ${n}`)]);
    if (reissue.length) secs.push(['재발급 필요 서류(유효기간 부족)', reissue.map((x) => `  - ${x.name}: 유효기간 ${f(x.valid)}까지 → ${f(basis.date)} 이후까지 유효한 증명서로 재발급`)]);
    if (reissue.length && basis && basis.date) secs.push(['기준', [`  - 대금 지급 예정일(${f(basis.date)}) 기준으로 유효한 증명서가 필요합니다.`]]);
    const who = [org, dept, officer].filter(Boolean).join(' ');
    const body = [
      '안녕하십니까.' + (who ? ` ${who}입니다.` : ''),
      '',
      `「${c.name || ''}」${c.no ? `(계약번호 ${c.no})` : ''} 대금 지급을 위해 제출 서류를 확인한 결과, 아래 서류의 보완을 요청드리고자 합니다.`,
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
    API_BASE, API_OPS, TYPES, apiUrl, monthRanges, parseApiText, parseApiBody, parseCorpList, parseCorpRows, normalizeApiItem, detectExtFinance,
    G2B, g2bUrl, scanAuditFields, summarizeChanges, pickBid, pickPrepar, pickScsbid, pickCorp, contractReason, bareNtce, periodEnd, num,
    checklistStatus, fmtDate, toDate, won, safeName, datesIn, extractDates, addDays, isCertItem, vendorMail,
  };
  root.JH = root.JH || {};
  root.JH.logic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
