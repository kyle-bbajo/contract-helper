/*
 * 공고문 작성 — 순수 로직(브라우저·Node 공용)
 *  - 항목 정의와 자동 규칙(공종 → 업종제한, 금액 → 부가세·상생결제)
 *  - 유사 공고(나라장터 입찰공고) 모아서 조건별 빈도 계산
 *  - 문장 초안 만들기, 한글 양식 {{항목}} 값 만들기, HWPX 본문 치환
 */
(function (root) {
  'use strict';
  const L = (root.JH && root.JH.logic) || (typeof require !== 'undefined' ? require('./logic.js') : null);

  // ---------- 공종 → 업종(면허) ----------
  // 업종명은 2022년 전문건설업 대업종 개편 기준. 회사 기준과 다르면 공고문 화면에서 바로 고칠 수 있음
  const WORK_TYPES = {
    공사: [
      { name: '전기공사', license: '전기공사업', law: '전기공사업법' },
      { name: '정보통신공사', license: '정보통신공사업', law: '정보통신공사업법' },
      { name: '소방시설공사', license: '소방시설공사업', law: '소방시설공사업법' },
      { name: '기계설비공사', license: '기계설비·가스공사업', law: '건설산업기본법' },
      { name: '실내건축공사', license: '실내건축공사업', law: '건설산업기본법' },
      { name: '도장·방수공사', license: '도장·습식·방수·석공사업', law: '건설산업기본법' },
      { name: '금속·창호·지붕공사', license: '금속창호·지붕건축물조립공사업', law: '건설산업기본법' },
      { name: '철근·콘크리트공사', license: '철근·콘크리트공사업', law: '건설산업기본법' },
      { name: '지반조성·포장공사', license: '지반조성·포장공사업', law: '건설산업기본법' },
      { name: '해체·비계공사', license: '구조물해체·비계공사업', law: '건설산업기본법' },
      { name: '상·하수도설비공사', license: '상·하수도설비공사업', law: '건설산업기본법' },
      { name: '조경식재·시설물공사', license: '조경식재·시설물공사업', law: '건설산업기본법' },
      { name: '조경공사', license: '조경공사업', law: '건설산업기본법' },
      { name: '건축공사(종합)', license: '건축공사업', law: '건설산업기본법' },
      { name: '토목공사(종합)', license: '토목공사업', law: '건설산업기본법' },
      { name: '토목건축공사(종합)', license: '토목건축공사업', law: '건설산업기본법' },
      { name: '기타', license: '', law: '' },
    ],
    용역: [
      { name: '시설물 유지관리', license: '', law: '' },
      { name: '청소·경비 등 단순노무', license: '', law: '' },
      { name: '설계·감리 등 기술용역', license: '', law: '' },
      { name: '학술·연구', license: '', law: '' },
      { name: '정보화(SW)', license: '소프트웨어사업자', law: '소프트웨어 진흥법' },
      { name: '기타', license: '', law: '' },
    ],
  };
  const workType = (kind, name) => (WORK_TYPES[kind] || []).find((w) => w.name === name) || null;
  // 복합공사: 주공종 + 함께 들어가는 공종(부공종, "조경공사, 포장공사"처럼 쉼표로)
  const splitList = (s) => String(s || '').split(/\s*[,·、]\s*/).map((x) => x.trim()).filter(Boolean);
  const subWorks = (v) => splitList(v && v.부공종).filter((x) => x !== (v && v.공종)).map((x) => workType(v.구분, x) || { name: x, license: '', law: '' });
  const worksOf = (v) => [workType(v.구분, v.공종), ...subWorks(v)].filter((w) => w && w.license);
  const workLabel = (w) => `${String(w.name).replace(/\(.*\)/, '')}${w.license ? `(${w.license})` : ''}`;
  // 법에 따라 따로 발주해야 하는 공사(전기공사업법 제11조, 정보통신공사업법 제25조, 소방시설공사업법 제21조)
  const SEPARATE = /^(전기공사|정보통신공사|소방시설공사)$/;
  const separateIn = (v) => [workType(v.구분, v.공종), ...subWorks(v)].filter((w) => w && SEPARATE.test(w.name)).map((w) => w.name);
  // 업종 문구: 「법」에 따른 ○○업과 ○○업 (법이 다르면 법마다)
  function licensePhrase(ws) {
    const byLaw = []; for (const w of ws) { let g = byLaw.find((x) => x.law === w.law); if (!g) byLaw.push(g = { law: w.law, lic: [] }); g.lic.push(w.license); }
    const join = (xs) => (xs.length <= 2 ? xs.join('과 ') : xs.slice(0, -1).join('·') + '과 ' + xs[xs.length - 1]);
    return byLaw.map((g) => `${g.law ? `「${g.law}」에 따른 ` : ''}${join(g.lic)}`).join(' 및 ');
  }
  function licenseSentence(ws) {
    if (!ws.length) return '';
    if (ws.length === 1) return `「${ws[0].law}」에 따른 ${ws[0].license} 등록업체`;
    return `${licensePhrase(ws)}을 모두 등록한 자 또는 ${ws.map((w) => w.license + ' 등록업체').join('와 ')}가 분담이행방식으로 공동수급체를 구성한 자`;
  }

  // ---------- 항목 ----------
  // key는 한글 양식의 {{key}} 와 같음
  const FIELDS = [
    { key: '구분', sec: '기본', type: 'select', opts: ['공사', '용역'] },
    { key: '공종', sec: '기본', type: 'select', optsFrom: 'work', label: '공종(주공종)' },
    { key: '부공종', sec: '기본', type: 'multi', optsFrom: 'work', wide: true, label: '함께 들어가는 공종', hint: '복합공사(예: 토목 + 조경)일 때만 고름' },
    { key: '공고명', sec: '기본', type: 'text', wide: true, ph: '예: 시청사 옥상 방수공사' },
    { key: '공고번호', sec: '기본', type: 'text', label: '기관 공고번호', hint: '공고 제○○호', ph: '예: 2026-087' },
    { key: '현장', sec: '기본', type: 'text', wide: true, ph: '예: 용인시 처인구 중부대로 1199', label: '공사(용역) 장소' },
    { key: '기간', sec: '기본', type: 'text', ph: '예: 착공일로부터 60일', label: '공사(용역) 기간' },
    { key: '추정가격', sec: '금액', type: 'money', hint: '부가세 별도' },
    { key: '부가세', sec: '금액', type: 'money', auto: true },
    { key: '추정금액', sec: '금액', type: 'money', auto: true, hint: '부가세 포함' },
    { key: '기초금액', sec: '금액', type: 'money' },
    { key: '주공종금액', sec: '금액', type: 'money', label: '주공종 추정가격', hint: '복합공사일 때, 부가세 별도', showIf: (v) => !!subWorks(v).length },
    { key: '계약방법', sec: '입찰', type: 'select', opts: ['제한경쟁', '일반경쟁', '지명경쟁', '수의계약(2인 이상 견적)', '수의계약(1인 견적)'] },
    { key: '낙찰자결정방법', sec: '입찰', type: 'select', opts: ['적격심사', '최저가', '협상에 의한 계약', '2단계 경쟁'], label: '낙찰자 결정방법' },
    { key: '낙찰하한율', sec: '입찰', type: 'combo', hint: '유사 공고에서 배우기로 채울 수 있음' },
    { key: '업종제한', sec: '자격', type: 'text', auto: true, wide: true },
    { key: '지역제한', sec: '자격', type: 'combo', opts: ['제한 없음(전국)', '경기도', '용인시'] },
    { key: '공동도급', sec: '자격', type: 'select', opts: ['불허', '허용(공동이행)', '허용(분담이행)', '지역의무공동도급'] },
    { key: '입찰보증금', sec: '자격', type: 'text', wide: true },
    { key: '상생결제', sec: '자격', type: 'select', opts: ['적용', '미적용'], auto: true },
    { key: '공고일', sec: '일정', type: 'date' },
    { key: '입찰시작', sec: '일정', type: 'datetime', label: '입찰서 제출 시작' },
    { key: '입찰마감', sec: '일정', type: 'datetime', label: '입찰서 제출 마감' },
    { key: '개찰일시', sec: '일정', type: 'datetime' },
    { key: '현장설명', sec: '일정', type: 'select', opts: ['없음', '있음'] },
    { key: '하자담보책임기간', sec: '기타', type: 'text', ph: '예: 준공일로부터 2년' },
    { key: '담당부서', sec: '기타', type: 'text' },
    { key: '담당자', sec: '기타', type: 'text' },
    { key: '연락처', sec: '기타', type: 'text' },
    { key: '기관명', sec: '기타', type: 'text' },
  ];
  const SECTIONS = ['기본', '금액', '입찰', '자격', '일정', '기타'];
  const labelOf = (key) => (FIELDS.find((f) => f.key === key) || {}).label || key;

  const money = (v) => Number(String(v == null ? '' : v).replace(/[^\d]/g, '')) || 0;
  const won = (n) => (n ? Number(n).toLocaleString('ko-KR') : '');

  // 새 공고문 기본값(설정에서 담당자·기관·기본 지역제한을 가져옴)
  function blank(cfg) {
    const c = cfg || {};
    const n = c.notice || {};
    return {
      구분: '공사', 공종: '전기공사', 부공종: '', 주공종금액: '', 공고명: '', 공고번호: '', 현장: '', 기간: '',
      추정가격: '', 부가세: '', 추정금액: '', 기초금액: '',
      계약방법: '제한경쟁', 낙찰자결정방법: '적격심사', 낙찰하한율: '',
      업종제한: '', 지역제한: n.region || '경기도', 공동도급: '불허', 입찰보증금: '입찰금액의 100분의 5 이상',
      상생결제: '', 공고일: '', 입찰시작: '', 입찰마감: '', 개찰일시: '', 현장설명: '없음', 하자담보책임기간: '',
      담당부서: n.dept || '', 담당자: n.officer || c.officer || '', 연락처: n.phone || '', 기관명: c.insttNm || '',
    };
  }

  // 자동 규칙: manual에 들어 있는 항목(사용자가 직접 고친 것)은 건드리지 않음
  function applyRules(v, manual, cfg) {
    const m = manual || {};
    const out = { ...v };
    const set = (k, val) => { if (!m[k]) out[k] = val; };
    const w = workType(out.구분, out.공종);
    const ws = worksOf(out), subs = subWorks(out).filter((x) => x.license);
    if (subs.length && w && w.license) {
      set('업종제한', licenseSentence(ws));
      set('공동도급', '허용(분담이행)'); // 복합공사는 각 업종 등록업체끼리 분담이행 공동도급이 일반적
    } else {
      if (w) set('업종제한', w.license ? `「${w.law}」에 따른 ${w.license} 등록업체` : out.업종제한 || '');
      if (!m.공동도급 && out.공동도급 === '허용(분담이행)' && !subs.length) out.공동도급 = '불허';
      if (!subs.length) out.주공종금액 = m.주공종금액 ? out.주공종금액 : '';
    }
    const p = money(out.추정가격);
    set('부가세', p ? won(Math.round(p * 0.1)) : '');
    set('추정금액', p ? won(p + money(out.부가세)) : '');
    const th = money(cfg && cfg.notice && cfg.notice.winwinMin);
    if (p) set('상생결제', th ? (p >= th ? '적용' : '미적용') : out.상생결제 || '');
    return out;
  }

  // ---------- 유사 공고 ----------
  const BID_BASE = 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService';
  const BID_OPS = { 공사: 'getBidPblancListInfoCnstwkPPSSrch', 용역: 'getBidPblancListInfoServcPPSSrch' };
  function bidSearchUrl(kind, q, bgn, end, page, rows, apiKey) {
    const p = new URLSearchParams({ inqryDiv: '1', inqryBgnDt: bgn + '0000', inqryEndDt: end + '2359', pageNo: String(page), numOfRows: String(rows || 100), type: 'json' });
    if (q.indstrytyNm) p.set('indstrytyNm', q.indstrytyNm);
    if (q.bidNtceNm) p.set('bidNtceNm', q.bidNtceNm);
    if (q.ntceInsttNm) p.set('ntceInsttNm', q.ntceInsttNm);
    if (q.prtcptLmtRgnNm) p.set('prtcptLmtRgnNm', q.prtcptLmtRgnNm);
    if (q.priceMin) p.set('presmptPrceBgn', String(Math.round(q.priceMin)));
    if (q.priceMax) p.set('presmptPrceEnd', String(Math.round(q.priceMax)));
    return `${BID_BASE}/${BID_OPS[kind] || BID_OPS.공사}?serviceKey=${encodeURIComponent(String(apiKey || '').trim())}&${p.toString()}`;
  }
  // 공고문 진행 상태: 작성 중 → 작성 완료(한글 양식 만듦·직접 표시) → 나라장터 등록(사람이 나라장터에서 등록한 뒤 받은 입찰공고번호를 넣어 연결 — 등록 API는 없음)
  const STATUS = {
    draft: { label: '작성 중', cls: 'late' },
    done: { label: '작성 완료', cls: 'ready' },
    posted: { label: '나라장터 등록', cls: 'paid' },
  };
  const STATUS_ORDER = ['draft', 'done', 'posted'];
  const statusOf = (n) => (n && STATUS[n.status] ? n.status : n && n.lastFile ? 'done' : 'draft');
  // 나라장터 입찰공고번호: "R26BK01234567-000", "R26BK01234567 000", "20261012345-00" 등
  function parseBidNo(s) {
    const m = String(s || '').toUpperCase().replace(/\s+/g, ' ').trim().match(/^([A-Z0-9]{8,15})(?:[- ]?(\d{2,3}))?$/);
    if (!m) return null;
    return { no: m[1], ord: m[2] ? m[2].padStart(3, '0') : '' };
  }
  const BID_BY_NO = { 공사: 'getBidPblancListInfoCnstwk', 용역: 'getBidPblancListInfoServc' };
  const bidByNoUrl = (kind, no, apiKey) =>
    `${BID_BASE}/${BID_BY_NO[kind] || BID_BY_NO.공사}?serviceKey=${encodeURIComponent(String(apiKey || '').trim())}&inqryDiv=2&bidNtceNo=${encodeURIComponent(no)}&pageNo=1&numOfRows=10&type=json`;
  const bidDetailUrl = (op, no, ord, apiKey) =>
    `${BID_BASE}/${op}?serviceKey=${encodeURIComponent(String(apiKey || '').trim())}&inqryDiv=2&bidNtceNo=${encodeURIComponent(no)}&bidNtceOrd=${encodeURIComponent(ord || '000')}&pageNo=1&numOfRows=20&type=json`;

  function normalizeBid(x) {
    const d = (s) => String(s || '').slice(0, 16);
    return {
      no: x.bidNtceNo || '', ord: x.bidNtceOrd || '000', name: x.bidNtceNm || '', org: x.ntceInsttNm || '', demand: x.dminsttNm || '',
      date: d(x.bidNtceDt), begin: d(x.bidBeginDt), close: d(x.bidClseDt), open: d(x.opengDt),
      price: money(x.presmptPrce), rate: x.sucsfbidLwltRate ? String(x.sucsfbidLwltRate).replace(/%$/, '') : '',
      method: x.sucsfbidMthdNm || '', contract: x.cntrctCnclsMthdNm || '', bidMethod: x.bidMethdNm || '',
      joint: x.cmmnSpldmdMethdNm || '', regionDuty: x.rgnDutyJntcontrctYn === 'Y', briefing: !!x.dcmtgOprtnDt,
      site: x.cnstrtsiteRgnNm || '', mainWork: x.mainCnsttyNm || '', url: x.bidNtceDtlUrl || x.bidNtceUrl || '',
      files: attachmentsOf(x),
      regions: null, licenses: null, clauses: null,
    };
  }
  // 첨부(공고서·규격서) 목록 — 공고문으로 보이는 한글·PDF를 앞으로
  function attachmentsOf(x) {
    const out = [];
    for (let i = 1; i <= 10; i++) { const u = x['ntceSpecDocUrl' + i], n = x['ntceSpecFileNm' + i]; if (u) out.push({ name: n || `첨부${i}`, url: u }); }
    if (x.stdNtceDocUrl) out.push({ name: '표준공고서', url: x.stdNtceDocUrl });
    const score = (f) => (/공고/.test(f.name) ? 0 : 2) + (/\.(hwpx?|pdf)$/i.test(f.name) ? 0 : 1) + (/규격|내역|도면|설계/.test(f.name) ? 1 : 0);
    return out.sort((a, b) => score(a) - score(b));
  }
  // 실제 공고문에서 쓸 만한 문장 뽑기
  const CLAUSES = [
    ['입찰참가자격', /입\s*찰\s*참\s*가\s*자\s*격/],
    ['지역제한', /(본점|주된\s*영업소|소재지).{0,60}(있는|둔|두고)/],
    ['업종·면허', /(등록|면허).{0,30}(업체|자|사업자)|공사업|공사업법/],
    ['공동도급', /공동\s*(도급|수급|계약)/],
    ['낙찰자 결정', /낙찰하한율|적격심사|낙찰자\s*결정/],
    ['입찰보증금', /입찰\s*보증금/],
    ['상생결제', /상생\s*결제/],
  ];
  function extractClauses(lines) {
    const out = [];
    const isHead = (l) => /^\s*(\d{1,2}|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)\s*[\.\)]\s*\S/.test(l) && l.length < 40;
    // 입찰참가자격 단락: 제목 줄 다음부터 다음 큰 제목 전까지
    const st = lines.findIndex((l) => CLAUSES[0][1].test(l) && l.length < 40);
    if (st >= 0) {
      let en = st + 1; while (en < lines.length && en - st < 30 && !isHead(lines[en])) en++;
      const body = lines.slice(st + 1, en).join('\n').trim();
      if (body) out.push({ title: '입찰참가자격', text: body.slice(0, 1500) });
    }
    for (const [title, re] of CLAUSES.slice(1)) {
      const hits = lines.filter((l) => re.test(l) && l.length > 12).slice(0, 2);
      if (hits.length && !out.some((o) => o.text.includes(hits[0]))) out.push({ title, text: hits.join('\n').slice(0, 600) });
    }
    return out;
  }
  // 참가가능지역 → 지역제한 표기
  function regionLabel(list) {
    if (!list || !list.length) return '제한 없음(전국)';
    const names = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
    if (names.length === 1) {
      const n = names[0];
      if (/경기/.test(n) && !/시|군/.test(n.replace(/경기도/, ''))) return '경기도';
      const m = n.match(/([가-힣]+[시군])$/); if (m) return m[1];
      return n;
    }
    return names.join(', ');
  }
  const hoursBetween = (a, b) => {
    const t = (s) => { const m = String(s).match(/(\d{4})-?(\d{2})-?(\d{2})[ T]?(\d{2}):?(\d{2})/); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).getTime() : NaN; };
    const h = (t(b) - t(a)) / 36e5; return Number.isFinite(h) ? h : null;
  };
  const median = (xs) => { const a = xs.filter((x) => x != null).sort((p, q) => p - q); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
  // 조건별 빈도: 가장 많이 쓴 값부터
  function learn(bids) {
    const tally = (pick) => {
      const m = new Map(); let n = 0;
      for (const b of bids) { const v = pick(b); if (v == null || v === '') continue; n++; m.set(v, (m.get(v) || 0) + 1); }
      return { n, top: [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })) };
    };
    const days = median(bids.map((b) => { const h = hoursBetween(b.begin, b.close); return h == null ? null : Math.round(h / 24); }));
    const openAfter = median(bids.map((b) => hoursBetween(b.close, b.open)));
    return {
      total: bids.length,
      지역제한: tally((b) => (b.regions ? regionLabel(b.regions) : null)),
      업종제한: tally((b) => (b.licenses && b.licenses.length ? b.licenses.join(', ') : null)),
      낙찰하한율: tally((b) => (b.rate ? b.rate + '%' : null)),
      낙찰자결정방법: tally((b) => b.method || null),
      계약방법: tally((b) => b.contract || null),
      공동도급: tally((b) => (b.regionDuty ? '지역의무공동도급' : b.joint ? b.joint : null)),
      현장설명: tally((b) => (b.briefing ? '있음' : '없음')),
      입찰기간일수: days, 개찰시간차: openAfter,
    };
  }
  // 낙찰방법명 → 화면 선택지
  function mapMethod(s) {
    if (/적격/.test(s)) return '적격심사';
    if (/협상/.test(s)) return '협상에 의한 계약';
    if (/2단계/.test(s)) return '2단계 경쟁';
    if (/최저/.test(s)) return '최저가';
    return s;
  }
  function mapContract(s) {
    if (/제한/.test(s)) return '제한경쟁';
    if (/지명/.test(s)) return '지명경쟁';
    if (/일반/.test(s)) return '일반경쟁';
    if (/수의/.test(s)) return '수의계약(2인 이상 견적)';
    return s;
  }

  // ---------- 문장 초안 ----------
  const fmtDT = (s) => {
    const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return s || '';
    return `${m[1]}. ${+m[2]}. ${+m[3]}.` + (m[4] ? ` ${m[4]}:${m[5]}` : '');
  };
  function regionSentence(r) {
    if (!r || /전국|없음/.test(r)) return '';
    return `입찰공고일 전일부터 입찰일(낙찰자는 계약체결일)까지 법인등기부상 본점 소재지(개인사업자는 사업자등록증상 소재지)가 ${r}에 있는 자`;
  }
  function draft(v, learned) {
    const kind = v.구분 === '용역' ? '용역' : '공사';
    const full = learned ? learnDocument(learned.bids, v) : null;
    if (full && full.sections.length >= 3) return draftFull(v, full, kind);
    const ls = learned ? learnedSections(learned, v) : null;
    const S = [];
    const line = (label, val) => (val ? `  ${label}: ${val}` : null);
    S.push({ title: '제목', body: `${v.기관명 || ''} 공고 제${v.공고번호 || '    '}호\n\n「${v.공고명 || '(공고명)'}」 입찰 공고\n\n${kind === '공사' ? '공사' : '용역'} 입찰을 다음과 같이 공고합니다.` });
    S.push({ title: '1. 입찰에 부치는 사항', body: [
      line(`${kind}명`, v.공고명), line(`${kind} 장소`, v.현장), line(`${kind} 기간`, v.기간),
      subWorks(v).length ? `  공종: 주공종 ${workLabel(workType(v.구분, v.공종) || { name: v.공종 })}, 부공종 ${subWorks(v).map(workLabel).join(', ')}` : null,
      v.추정가격 ? `  추정가격: 금 ${won(money(v.추정가격))}원(부가가치세 별도)` : null,
      v.추정금액 ? `  추정금액: 금 ${won(money(v.추정금액))}원(부가가치세 포함)` : null,
      subWorks(v).length && v.주공종금액 ? `  주공종 추정가격: 금 ${won(money(v.주공종금액))}원(부가가치세 별도)${money(v.추정가격) > money(v.주공종금액) ? `, 부공종 금 ${won(money(v.추정가격) - money(v.주공종금액))}원` : ''}` : null,
      v.기초금액 ? `  기초금액: 금 ${won(money(v.기초금액))}원` : null,
      `  입찰방법: 전자입찰, ${v.계약방법 || ''}${v.낙찰자결정방법 ? `, ${v.낙찰자결정방법}` : ''}`,
    ].filter(Boolean).join('\n') });
    const q = [v.업종제한, regionSentence(v.지역제한), '관계 법령에 따른 경쟁입찰 참가자격을 갖추고 국가종합전자조달시스템(나라장터)에 입찰참가자격을 등록한 자'].filter(Boolean);
    if (ls && ls.입찰참가자격.length >= 2) {
      // 비슷한 공고들이 공통으로 쓴 참가자격 문장(이번 업종·지역으로 바꿈)
      S.push({ title: '2. 입찰참가자격', learned: ls.n, body: ls.입찰참가자격.map((x, i) => `  ${'가나다라마바사아'[i]}. ${x.text}`).join('\n') +
        (v.공동도급 && !ls.입찰참가자격.some((x) => /공동/.test(x.text)) ? `\n  ${'가나다라마바사아'[ls.입찰참가자격.length]}. 공동도급: ${v.공동도급}` : '') });
    } else S.push({ title: '2. 입찰참가자격', body: q.map((x, i) => `  ${'가나다라마'[i]}. ${x}`).join('\n') +
      (v.공동도급 ? `\n  ${'가나다라마'[q.length]}. 공동도급: ${v.공동도급}` : '') });
    S.push({ title: '3. 입찰 일정', body: [
      v.공고일 ? `  공고일: ${fmtDT(v.공고일)}` : null,
      `  입찰서 제출: ${fmtDT(v.입찰시작) || '(시작)'} ~ ${fmtDT(v.입찰마감) || '(마감)'}`,
      `  개찰: ${fmtDT(v.개찰일시) || '(일시)'}, 국가종합전자조달시스템(나라장터)`,
      `  현장설명: ${v.현장설명 || '없음'}`,
    ].filter(Boolean).join('\n') });
    if (ls && ls.낙찰자결정.length) S.push({ title: '4. 낙찰자 결정방법', learned: ls.n, body: ls.낙찰자결정.map((x) => `  ${x.text}`).join('\n') });
    else S.push({ title: '4. 낙찰자 결정방법', body: v.낙찰자결정방법 === '적격심사'
      ? `  예정가격 이하로서 낙찰하한율${v.낙찰하한율 ? `(${v.낙찰하한율})` : ''} 이상으로 입찰한 자 중 최저가격으로 입찰한 자 순으로 적격심사를 하여, 종합평점이 기준 이상인 자를 낙찰자로 결정합니다.`
      : `  ${v.낙찰자결정방법 || ''}${v.낙찰하한율 ? ` (낙찰하한율 ${v.낙찰하한율})` : ''}` });
    S.push({ title: '5. 입찰보증금', body: `  ${v.입찰보증금 || ''}` });
    S.push({ title: '6. 입찰의 무효', body: [
      '  가. 「지방자치단체를 당사자로 하는 계약에 관한 법률 시행규칙」 제42조에 해당하는 입찰은 무효로 합니다.',
      '  나. 입찰참가자격이 없는 자가 한 입찰, 담합하거나 타인의 입찰을 방해한 자의 입찰은 무효로 합니다.',
    ].join('\n') });
    S.push({ title: '7. 계약 체결', body: [
      '  가. 낙찰자는 낙찰통지를 받은 날부터 10일 이내에 계약을 체결하여야 하며, 정당한 이유 없이 계약을 체결하지 않으면 입찰보증금은 우리 기관에 귀속됩니다.',
      '  나. 계약보증금 등 계약에 관한 사항은 관계 법령과 계약일반조건·특수조건에 따릅니다.',
      v.상생결제 === '적용' ? '  다. 이 계약의 대금은 상생결제시스템을 통해 지급합니다.' : null,
    ].filter(Boolean).join('\n') });
    S.push({ title: '8. 기타', body: [
      '  가. 이 입찰은 청렴계약제를 시행하며, 입찰참가자는 청렴계약 이행서약에 동의한 것으로 봅니다.',
      v.하자담보책임기간 ? `  나. 하자담보책임기간: ${v.하자담보책임기간}` : null,
      `  ${v.하자담보책임기간 ? '다' : '나'}. 입찰자는 입찰공고, 계약일반조건·특수조건 등 입찰에 필요한 사항을 미리 확인하여야 하며, 확인하지 않아 생기는 책임은 입찰자에게 있습니다.`,
      '  ※ 기타 자세한 사항은 국가종합전자조달시스템(나라장터)의 공고문과 첨부 서류를 확인하시기 바랍니다.',
    ].filter(Boolean).join('\n') });
    S.push({ title: '문의', body: `  ${[v.기관명, v.담당부서, v.담당자].filter(Boolean).join(' ')}${v.연락처 ? ` (☎ ${v.연락처})` : ''}` });
    return S;
  }

  function jointBody(v) {
    const j = v.공동도급 || '';
    if (/불허/.test(j)) return '  가. 이 입찰은 공동계약을 허용하지 않습니다.';
    if (/지역의무/.test(j)) return `  가. 이 입찰은 지역업체와의 공동계약(지역의무공동도급)으로 하며, 지역업체의 최소 지분율은 관계 법령과 공고에서 정한 바에 따릅니다.`;
    const kind = /분담/.test(j) ? '분담이행방식' : '공동이행방식';
    return `  가. 이 입찰은 ${kind}의 공동계약을 허용합니다.` + (/분담/.test(j) && worksOf(v).length > 1 ? `\n  나. 구성원은 각자 분담하는 공종(${worksOf(v).map((w) => w.license).join(', ')})의 업종을 등록하여야 하며, 공동수급협정서를 입찰참가신청 마감일까지 제출하여야 합니다.` : '\n  나. 공동수급협정서는 입찰참가신청 마감일까지 제출하여야 합니다.');
  }
  // 비슷한 공고 전체를 뼈대로 쓴 초안: 1절(입찰에 부치는 사항)·일정·문의는 이번 값, 나머지는 실제 공고 문장
  function draftFull(v, full, kind) {
    const basic = draft(v); // 학습 없는 기본 초안(이번 값 문장)
    const sec = (re) => basic.find((x) => re.test(x.title));
    const S = [sec(/제목/)];
    let no = 0;
    const title = (head) => `${++no}. ${head}`;
    const have = new Set(full.sections.map((s) => s.key));
    S.push({ title: title('입찰에 부치는 사항'), body: sec(/입찰에 부치는/).body });
    for (const s of full.sections) {
      if (s.key === '입찰에 부치는 사항' || s.key === '문의') continue;
      let body = bodyOf(s.lines);
      if (s.key === '입찰서 제출·개찰') {
        // 이번 일정 줄을 앞에 두고 가. 나. 다. 를 다시 매김
        const sched = sec(/입찰 일정/).body.split('\n').map((t) => ({ mark: '', text: t.trim() })).filter((x) => x.text);
        body = bodyOf([...sched, ...s.lines].map((x, i) => ({ ...x, mark: !x.mark || /^[가-하][.)]$/.test(x.mark) ? `${MARKS[i] || '※'}.` : x.mark })));
      }
      if (s.key === '입찰참가자격' && v.공동도급 && !have.has('공동계약') && !s.lines.some((x) => /공동/.test(x.text))) body += `\n  ${MARKS[s.lines.length] || '※'}. 공동도급: ${v.공동도급}`;
      if (s.key === '입찰참가자격' && worksOf(v).length > 1 && !s.lines.some((x) => /분담/.test(x.text))) {
        const k = body.split('\n').length;
        body += `\n  ${MARKS[k] || '※'}. ${worksOf(v).map((w) => w.license + ' 등록업체').join('와 ')}가 분담이행방식으로 공동수급체를 구성하여 참가할 수 있으며, 구성원은 각자 분담하는 공종의 업종을 등록하여야 합니다.`;
      }
      // 공동계약 허용 여부가 이번 공고와 반대면 이번 값으로 씀
      if (s.key === '공동계약' && v.공동도급) {
        const allow = !/불허/.test(v.공동도급), said = /허용하지\s*않|불허|허용\s*안/.test(body) ? false : /허용/.test(body) ? true : null;
        if (said !== null && said !== allow) body = jointBody(v);
      }
      if (s.key === '낙찰자 결정방법' && v.낙찰하한율 && !/낙찰하한율|하한율/.test(body)) body += `\n  ※ 낙찰하한율: ${v.낙찰하한율}`;
      if (!body.trim()) continue;
      S.push({ title: title(s.head), body, learned: s.docs, check: s.lines.filter((x) => x.check).length });
    }
    if (!have.has('입찰서 제출·개찰')) S.splice(3, 0, { title: '', body: sec(/입찰 일정/).body, _sched: true });
    S.push({ title: '문의', body: sec(/^문의/).body });
    // 일정을 끼워 넣었으면 번호를 다시 매김
    let k = 0;
    return S.map((x) => (x._sched ? { title: `${++k}. 입찰 일정`, body: x.body } : x.title === '문의' || /제목/.test(x.title) ? x : { ...x, title: x.title.replace(/^\d+\./, `${++k}.`) }));
  }

  // ---------- 비슷한 공고의 실제 문장에서 배우기 ----------
  // 공고마다 다른 값(지역·업종·비율·금액·날짜)을 자리표시로 바꿔 같은 문장끼리 묶고, 여러 공고가 공통으로 쓴 문장을 이번 값으로 채움
  const BULLET = /^\s*([가-하]\s*[\.\)]|\(?\d{1,2}\s*[\.\)]|[①-⑳]|[-·•○◦▪※*□■])\s*/;
  const RE_REGION = /((서울|부산|대구|인천|광주|대전|울산|세종)(특별시|광역시|특별자치시)?|(경기|강원|충청북|충청남|충북|충남|전라북|전라남|전북|전남|경상북|경상남|경북|경남|제주)(특별자치)?도)(\s*[가-힣]{1,4}[시군구])?|[가-힣]{1,4}[시군](?=\s*(에|관내|내에|소재|지역))/g;
  const RE_LICENSE = /「[^」]{2,40}」\s*(에|의)?\s*(따른|따라|의한|의하여|규정에\s*의한)\s*[가-힣·]{2,20}?업(?=\s|을|를|으로|의|에|등록|\(|,|$)/g;
  const RE_RATE = /\d{1,3}(\.\d{1,4})?\s*%/g;
  const RE_MONEY = /금\s*[\d,]+\s*원|[\d,]{5,}\s*원/g;
  const RE_DATE = /(20\d{2})\s*[.\-\/년]\s*\d{1,2}\s*[.\-\/월]\s*\d{1,2}\s*[.일]?/g;
  const RE_TIME = /\d{1,2}\s*:\s*\d{2}/g;
  const RE_PHONE = /(?:☎\s*)?\(?0\d{1,2}\)?[-.\s]?\d{3,4}[-.\s]\d{4}/g;
  function slotify(s) {
    return String(s).replace(RE_PHONE, '{전화}').replace(RE_LICENSE, '{업종}').replace(RE_REGION, '{지역}').replace(RE_RATE, '{율}').replace(RE_MONEY, '{금액}')
      .replace(RE_DATE, '{날짜}').replace(RE_TIME, '{시각}').replace(/\s+/g, ' ').trim();
  }
  const CLAUSE_LINES = (text) => String(text || '').split(/\n+/).map((l) => l.replace(BULLET, '').replace(/\s+/g, ' ').trim()).filter((l) => l.length >= 10 && l.length <= 400);
  function learnSentences(bids) {
    const by = {}; let n = 0;
    for (const b of bids || []) {
      if (!b.clauses || !b.clauses.length) continue;
      n++;
      for (const c of b.clauses) {
        const seen = new Set();
        CLAUSE_LINES(c.text).forEach((line, i) => {
          const key = slotify(line); if (seen.has(key)) return; seen.add(key);
          const t = (by[c.title] = by[c.title] || {});
          const e = (t[key] = t[key] || { key, count: 0, pos: 0, samples: [] });
          e.count++; e.pos += i; if (e.samples.length < 2) e.samples.push(line);
        });
      }
    }
    const out = {};
    for (const [title, m] of Object.entries(by)) out[title] = Object.values(m).map((e) => ({ ...e, pos: e.pos / e.count })).sort((a, b) => b.count - a.count || a.pos - b.pos);
    return { n, by: out };
  }
  // 자리표시 채우기: 이번 공고 값이 없으면 ○○로 둠, 지역제한이 없는 공고면 지역 문장은 뺌
  function fillSlots(key, v) {
    const region = v.지역제한 && !/전국|없음/.test(v.지역제한) ? v.지역제한 : '';
    if (/\{지역\}/.test(key) && !region) return null;
    const ws = worksOf(v);
    const lic = ws.length > 1 ? licensePhrase(ws) : String(v.업종제한 || '').replace(/\s*(등록업체|등록을\s*(한|필한)\s*(자|업체)|등록\s*업체)\s*$/, '').trim();
    return key.replace(/\{지역\}/g, region).replace(/\{업종\}/g, lic || '○○업').replace(/\{율\}/g, v.낙찰하한율 || '○○%')
      .replace(/\{금액\}/g, '금 ○○원').replace(/\{날짜\}/g, '○○').replace(/\{시각\}/g, '○○:○○').replace(/\{전화\}/g, v.연락처 ? `☎ ${v.연락처}` : '☎ ○○○-○○○-○○○○');
  }
  // 배운 문장 초안: 절 제목별로 공통 문장(공고 3건 이상이면 2건 이상이 쓴 것)
  function learnedSections(learned, v) {
    if (!learned || !learned.bids) return null;
    const L = learnSentences(learned.bids);
    if (!L.n) return null;
    const min = L.n >= 3 ? 2 : 1;
    const pick = (title, max) => (L.by[title] || []).filter((e) => e.count >= min).slice(0, max)
      .sort((a, b) => a.pos - b.pos).map((e) => ({ text: fillSlots(e.key, v), count: e.count })).filter((x) => x.text);
    return { n: L.n, 입찰참가자격: pick('입찰참가자격', 8), 낙찰자결정: pick('낙찰자 결정', 2), 입찰보증금: pick('입찰보증금', 1), 공동도급: pick('공동도급', 1) };
  }

  // ---------- 공고문 전체 배우기 ----------
  // 첨부 공고문을 큰 제목(1. 2. … 또는 Ⅰ. Ⅱ.) 단위로 나누고, 제목 뜻으로 절 종류를 정함
  const SEC_KEYS = [
    ['입찰에 부치는 사항', /부치는|입찰\s*개요|(공사|용역|사업|구매|물품)\s*개요|입찰\s*건명/],
    ['입찰참가자격', /참가\s*자격|참가\s*요건/],
    ['공동계약', /공동\s*(계약|도급|수급)/],
    ['계약 체결', /계약\s*(체결|이행|조건|보증|의\s*체결|일반)|하도급|대가\s*지급|대금\s*지급/],
    ['입찰보증금', /보증금/],
    ['낙찰자 결정방법', /낙찰|적격\s*심사/],
    ['입찰 무효', /무효/],
    ['입찰서 제출·개찰', /입찰서|제출|개찰|전자\s*입찰|입찰\s*(일정|방법|일시|진행|참가\s*신청)/],
    ['문의', /문의|담당\s*부서|연락처/],
    ['기타', /기타|유의|청렴|일반|안내|참고|준수/],
  ];
  const secKey = (head) => { const h = String(head).replace(/\s+/g, ''); for (const [k, re] of SEC_KEYS) if (re.test(h) || re.test(head)) return k; return String(head).replace(/\s+/g, ' ').trim(); };
  const ROMAN = 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ';
  const HEAD_RE = /^\s*(\d{1,2}|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ])\s*\.\s*(\S.{0,40})$/;
  const SUB_START = /^\s*([가-하]\s*[\.\)]|\(?\d{1,2}\s*\)|\d{1,2}\s*\.|[①-⑳]|[-·•○◦▪※*□■▶]|\([가-하]\))/;
  // PDF처럼 문장이 줄 끝에서 끊긴 것은 앞줄에 이어 붙임
  function mergeWrapped(lines) {
    const out = [];
    for (const raw of lines || []) {
      const l = String(raw).replace(/\s+/g, ' ').trim(); if (!l) continue;
      const prev = out[out.length - 1];
      if (prev && !SUB_START.test(l) && !HEAD_RE.test(l) && !/[.:;)」』]$|다$|음$|함$|요$|오$|것$/.test(prev) && prev.length > 25) out[out.length - 1] = prev + ' ' + l;
      else out.push(l);
    }
    return out;
  }
  function parseNotice(lines) {
    const ls = mergeWrapped(lines);
    const sections = []; let cur = null, last = 0;
    for (const l of ls) {
      const m = l.match(HEAD_RE);
      const no = m ? (/\d/.test(m[1]) ? +m[1] : ROMAN.indexOf(m[1]) + 1) : 0;
      // 큰 제목: 번호가 1 또는 앞 번호 + 1, 짧은 줄
      if (m && no === last + 1 && l.length <= 45 && !/[다음]\.$/.test(m[2])) {
        last = no; cur = { no, head: m[2].replace(/[:：]\s*$/, '').trim(), key: secKey(m[2]), lines: [] }; sections.push(cur); continue;
      }
      if (cur && cur.lines.length < 80) cur.lines.push(l.slice(0, 500));
    }
    return { sections: sections.slice(0, 20) };
  }
  // 줄 앞 번호(가. 1) ① 등)를 떼고 비교용 열쇠
  const bulletOf = (l) => { const m = String(l).match(/^\s*([가-하]\s*[\.\)]|\(?\d{1,2}\s*[\.\)]|[①-⑳]|[-·•○◦▪※*□■▶]|\([가-하]\))\s*/); return m ? { mark: m[1].replace(/\s+/g, ''), body: l.slice(m[0].length) } : { mark: '', body: l }; };
  const lineKey = (sec, l) => sec + '|' + slotify(bulletOf(l).body);
  // 비슷한 공고 여러 건 → 가장 전형적인 공고 하나를 뼈대로, 이번 공고 값으로 바꾼 전체 초안
  function learnDocument(bids, v) {
    const docs = (bids || []).filter((b) => b.doc && b.doc.sections && b.doc.sections.length >= 3);
    if (!docs.length) return null;
    const n = docs.length, min = n >= 3 ? 2 : 1;
    const seen = new Map(), secSeen = new Map();
    docs.forEach((b, i) => b.doc.sections.forEach((s) => {
      (secSeen.get(s.key) || secSeen.set(s.key, new Set()).get(s.key)).add(i);
      s.lines.forEach((l) => { const k = lineKey(s.key, l); (seen.get(k) || seen.set(k, new Set()).get(k)).add(i); });
    }));
    const cnt = (k) => (seen.get(k) || new Set()).size;
    // 다른 공고와 겹치는 문장이 가장 많은 공고가 뼈대
    const score = docs.map((b) => b.doc.sections.reduce((a, s) => a + s.lines.reduce((x, l) => x + cnt(lineKey(s.key, l)) - 1, 0), 0) + b.doc.sections.length * 0.1);
    const R = docs[score.indexOf(Math.max(...score))];
    const swap = (t) => {
      let x = String(t);
      if (R.name && v.공고명) x = x.split(R.name).join(v.공고명);
      if (R.org && v.기관명 && R.org !== v.기관명) x = x.split(R.org).join(v.기관명);
      return x;
    };
    const fill = (sec, l) => {
      const { mark, body } = bulletOf(l);
      const key = slotify(swap(body));
      if (sec === '입찰서 제출·개찰' && /\{날짜\}|\{시각\}/.test(key)) return null; // 일정은 이번 값으로 따로 씀
      const text = fillSlots(key, v); if (!text) return null;
      return { mark, text, common: cnt(lineKey(sec, l)) >= Math.max(2, min), check: /○○/.test(text) };
    };
    const uniq = (ls) => { const seenT = new Set(); return ls.filter((x) => x && !seenT.has(x.text) && seenT.add(x.text)); };
    const sections = R.doc.sections.map((s) => ({ key: s.key, head: s.head, docs: (secSeen.get(s.key) || new Set()).size, lines: uniq(s.lines.map((l) => fill(s.key, l))) }));
    // 뼈대 공고에 없지만 여러 공고에 있는 절은 덧붙임(가장 많이 겹치는 공고의 것으로)
    for (const [key, set] of secSeen) {
      if (set.size < min || sections.some((s) => s.key === key)) continue;
      const b = docs[[...set][0]]; const s = b.doc.sections.find((x) => x.key === key);
      sections.push({ key, head: s.head, docs: set.size, lines: uniq(s.lines.map((l) => fill(key, l))) });
    }
    return { n, base: { name: R.name, org: R.org, no: R.no }, sections };
  }
  const MARKS = '가나다라마바사아자차카타파하';
  const bodyOf = (lines) => lines.map((x) => `  ${x.mark ? x.mark + ' ' : ''}${x.text}`).join('\n');

  // ---------- AI(Claude)로 다시 쓰기: 질문 만들기·답 읽기 ----------
  const AI_SYSTEM = [
    '당신은 한국 지방공기업 계약 담당자를 돕는 입찰 공고문 작성 보조입니다.',
    '주어진 이번 공고의 항목 값과, 비슷한 실제 공고문에서 뽑은 문장만 근거로 씁니다.',
    '근거에 없는 자격 요건·법령 조항·금액·날짜를 새로 지어내지 않습니다. 값이 없으면 ○○로 남깁니다.',
    '실제 공고문의 문체와 형식(가. 나. 다. 항목, ~한 자, ~합니다)을 따르고, 다른 공고의 지역·업종·기관명은 이번 공고 값으로 바꿉니다.',
    '답은 설명 없이 JSON 하나만 냅니다.',
  ].join('\n');
  function aiPrompt(v, learned, sections) {
    const facts = FIELDS.map((f) => [f.label || f.key, v[f.key]]).filter(([, x]) => x).map(([k, x]) => `- ${k}: ${x}`).join('\n');
    const bids = (learned && learned.bids) || [];
    const docs = bids.filter((b) => b.doc && b.doc.sections && b.doc.sections.length);
    // 공고문 전체가 있으면 전문(앞 2건, 길면 자름), 없으면 뽑은 문장
    const refs = docs.length
      ? docs.slice(0, 2).map((b, i) => `[${i + 1}] ${b.name} (${b.org})\n` + b.doc.sections.map((s) => `${s.no}. ${s.head}\n` + s.lines.map((l) => '  ' + l).join('\n')).join('\n').slice(0, 5000)).join('\n\n')
      : bids.filter((b) => b.clauses && b.clauses.length).slice(0, 6)
        .map((b, i) => `[${i + 1}] ${b.name} (${b.org})\n` + b.clauses.map((c) => `  <${c.title}>\n  ${String(c.text).replace(/\n/g, '\n  ')}`).join('\n')).join('\n\n');
    const now = sections.map((s) => `### ${s.title}\n${s.body}`).join('\n\n');
    return [
      '## 이번 공고 항목', facts || '(없음)', '',
      '## 비슷한 실제 공고문에서 뽑은 문장', refs || '(없음 — 이번 공고 항목과 지금 초안만 근거로 다듬으세요)', '',
      '## 지금 초안', now, '',
      '## 할 일',
      '지금 초안의 각 절을 실제 공고문 문체로 다시 쓰세요. 절을 빼거나 줄이지 말고, 실제 공고문만큼 자세히 씁니다. 특히 "입찰참가자격"은 비슷한 공고들이 공통으로 쓴 요건을 이번 공고의 업종·지역 값으로 맞춰 쓰세요.',
      '절 제목은 지금 초안과 똑같이 두고, 결과는 이 형식의 JSON 하나만: {"sections":[{"title":"절 제목","body":"본문"}]}',
    ].join('\n');
  }
  function parseAi(text) {
    const s = String(text || ''); const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('AI 답에서 결과를 찾지 못했습니다.');
    const j = JSON.parse(s.slice(a, b + 1));
    const secs = (j.sections || []).filter((x) => x && x.title && typeof x.body === 'string').map((x) => ({ title: String(x.title), body: x.body }));
    if (!secs.length) throw new Error('AI 답이 비어 있습니다.');
    return secs;
  }

  // ---------- 한글 양식 ----------
  // 양식에 쓸 값: {{공고명}} 같은 표시를 이 값으로 바꿈
  function templateValues(v, sections) {
    const out = {};
    for (const f of FIELDS) {
      let x = v[f.key] == null ? '' : String(v[f.key]);
      if (f.type === 'datetime' || f.type === 'date') x = fmtDT(x);
      out[f.key] = x;
    }
    out['지역제한문장'] = regionSentence(v.지역제한);
    const sec = (re) => { const s = (sections || draft(v)).find((x) => re.test(x.title)); return s ? s.body.replace(/^ {2}/gm, '') : ''; };
    out['입찰참가자격'] = sec(/입찰\s*참가\s*자격/);
    out['낙찰자결정문장'] = sec(/낙찰자\s*결정|낙찰/);
    // 초안 전체(제목 빼고) — 양식에 {{공고문전문}}을 두면 통째로 들어감
    out['공고문전문'] = (sections || draft(v)).filter((x) => !/^제목$/.test(x.title)).map((x) => `${x.title}\n${x.body}`).join('\n\n');
    return out;
  }
  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // HWPX 본문 XML의 {{항목}}을 값으로 바꿈. 표시가 서식 경계로 쪼개져 있어도(태그가 끼어 있어도) 찾음
  function fillHwpxXml(xml, values) {
    let n = 0;
    const found = new Set();
    const tag = '(?:<[^>]+>)*';
    for (const [k, val] of Object.entries(values)) {
      const pat = '\\{' + tag + '\\{' + tag + k.split('').map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(tag) + tag + '\\}' + tag + '\\}';
      xml = xml.replace(new RegExp(pat, 'g'), () => { n++; found.add(k); return xmlEsc(val); });
    }
    if (n) xml = xml.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, ''); // 줄 배치 정보는 한글이 다시 계산
    return { xml, count: n, found: [...found] };
  }
  // HWPX(zip) 쓰기: mimetype을 맨 앞에, 압축 없이 저장(한글·OCF 규칙)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zipStore(entries) {
    const enc = new TextEncoder();
    const list = [...entries].sort((a, b) => (a.name === 'mimetype' ? -1 : b.name === 'mimetype' ? 1 : 0));
    const parts = [], central = []; let off = 0;
    for (const e of list) {
      const name = enc.encode(e.name), data = e.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, a) => n + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, list.length, true); end.setUint16(10, list.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0)); let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  // CFB로 읽은 HWPX를 {{항목}} 채워 다시 zip으로
  function fillHwpx(cfbLib, bytes, values) {
    const z = cfbLib.read(bytes, { type: 'array' });
    const root = z.FullPaths[0];
    const entries = []; let count = 0;
    z.FullPaths.forEach((p, i) => {
      const fi = z.FileIndex[i];
      if (fi.type !== 2 || /\u0001Sh33tJ5$/.test(p) || p.endsWith('/')) return;
      const name = p.startsWith(root) ? p.slice(root.length) : p;
      let data = new Uint8Array(fi.content);
      if (/^Contents\/section\d+\.xml$/i.test(name)) {
        const r = fillHwpxXml(new TextDecoder('utf-8').decode(data), values);
        if (r.count) { data = new TextEncoder().encode(r.xml); count += r.count; }
      }
      entries.push({ name, data });
    });
    return { bytes: zipStore(entries), count };
  }
  function placeholdersIn(text) {
    const plain = String(text).replace(/<[^>]+>/g, '');
    return [...new Set([...plain.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map((m) => m[1]))];
  }

  const api = { WORK_TYPES, workType, subWorks, worksOf, separateIn, licensePhrase, licenseSentence, splitList, jointBody, FIELDS, SECTIONS, labelOf, money, won, blank, applyRules,
    BID_OPS, bidSearchUrl, bidDetailUrl, slotify, learnSentences, learnedSections, aiPrompt, parseAi, AI_SYSTEM, STATUS, STATUS_ORDER, statusOf, parseBidNo, bidByNoUrl, normalizeBid, attachmentsOf, extractClauses, regionLabel, learn, mapMethod, mapContract,
    draft, draftFull, parseNotice, learnDocument, mergeWrapped, secKey, regionSentence, templateValues, fillHwpxXml, fillHwpx, zipStore, crc32, placeholdersIn, fmtDT };
  root.JH = root.JH || {};
  root.JH.notice = Object.assign(root.JH.notice || {}, { logic: api });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
