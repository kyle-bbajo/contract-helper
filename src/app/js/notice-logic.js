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
      { name: '조경공사', license: '조경공사업', law: '건설산업기본법' },
      { name: '건축공사(종합)', license: '건축공사업', law: '건설산업기본법' },
      { name: '토목공사(종합)', license: '토목공사업', law: '건설산업기본법' },
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

  // ---------- 항목 ----------
  // key는 한글 양식의 {{key}} 와 같음
  const FIELDS = [
    { key: '구분', sec: '기본', type: 'select', opts: ['공사', '용역'] },
    { key: '공종', sec: '기본', type: 'select', optsFrom: 'work' },
    { key: '공고명', sec: '기본', type: 'text', wide: true, ph: '예: 시청사 옥상 방수공사' },
    { key: '공고번호', sec: '기본', type: 'text', label: '기관 공고번호', hint: '공고 제○○호', ph: '예: 2026-087' },
    { key: '현장', sec: '기본', type: 'text', wide: true, ph: '예: 용인시 처인구 중부대로 1199', label: '공사(용역) 장소' },
    { key: '기간', sec: '기본', type: 'text', ph: '예: 착공일로부터 60일', label: '공사(용역) 기간' },
    { key: '추정가격', sec: '금액', type: 'money', hint: '부가세 별도' },
    { key: '부가세', sec: '금액', type: 'money', auto: true },
    { key: '추정금액', sec: '금액', type: 'money', auto: true, hint: '부가세 포함' },
    { key: '기초금액', sec: '금액', type: 'money' },
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
      구분: '공사', 공종: '전기공사', 공고명: '', 공고번호: '', 현장: '', 기간: '',
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
    if (w) set('업종제한', w.license ? `「${w.law}」에 따른 ${w.license} 등록업체` : out.업종제한 || '');
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
    const ls = learned ? learnedSections(learned, v) : null;
    const S = [];
    const line = (label, val) => (val ? `  ${label}: ${val}` : null);
    S.push({ title: '제목', body: `${v.기관명 || ''} 공고 제${v.공고번호 || '    '}호\n\n「${v.공고명 || '(공고명)'}」 입찰 공고\n\n${kind === '공사' ? '공사' : '용역'} 입찰을 다음과 같이 공고합니다.` });
    S.push({ title: '1. 입찰에 부치는 사항', body: [
      line(`${kind}명`, v.공고명), line(`${kind} 장소`, v.현장), line(`${kind} 기간`, v.기간),
      v.추정가격 ? `  추정가격: 금 ${won(money(v.추정가격))}원(부가가치세 별도)` : null,
      v.추정금액 ? `  추정금액: 금 ${won(money(v.추정금액))}원(부가가치세 포함)` : null,
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
    if (v.상생결제) S.push({ title: '6. 상생결제', body: v.상생결제 === '적용' ? '  이 계약의 대금은 상생결제시스템을 통해 지급합니다.' : '  해당 없음' });
    S.push({ title: `${v.상생결제 ? 7 : 6}. 기타`, body: [
      v.하자담보책임기간 ? `  하자담보책임기간: ${v.하자담보책임기간}` : null,
      '  기타 자세한 사항은 국가종합전자조달시스템(나라장터)의 공고문과 첨부 서류를 확인하시기 바랍니다.',
    ].filter(Boolean).join('\n') });
    S.push({ title: '문의', body: `  ${[v.기관명, v.담당부서, v.담당자].filter(Boolean).join(' ')}${v.연락처 ? ` (☎ ${v.연락처})` : ''}` });
    return S;
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
  function slotify(s) {
    return String(s).replace(RE_LICENSE, '{업종}').replace(RE_REGION, '{지역}').replace(RE_RATE, '{율}').replace(RE_MONEY, '{금액}')
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
    const lic = String(v.업종제한 || '').replace(/\s*(등록업체|등록을\s*(한|필한)\s*(자|업체)|등록\s*업체)\s*$/, '').trim();
    return key.replace(/\{지역\}/g, region).replace(/\{업종\}/g, lic || '○○업').replace(/\{율\}/g, v.낙찰하한율 || '○○%')
      .replace(/\{금액\}/g, '금 ○○원').replace(/\{날짜\}/g, '○○').replace(/\{시각\}/g, '○○:○○');
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
    const refs = (learned && learned.bids || []).filter((b) => b.clauses && b.clauses.length).slice(0, 6)
      .map((b, i) => `[${i + 1}] ${b.name} (${b.org})\n` + b.clauses.map((c) => `  <${c.title}>\n  ${String(c.text).replace(/\n/g, '\n  ')}`).join('\n')).join('\n\n');
    const now = sections.map((s) => `### ${s.title}\n${s.body}`).join('\n\n');
    return [
      '## 이번 공고 항목', facts || '(없음)', '',
      '## 비슷한 실제 공고문에서 뽑은 문장', refs || '(없음 — 이번 공고 항목과 지금 초안만 근거로 다듬으세요)', '',
      '## 지금 초안', now, '',
      '## 할 일',
      '지금 초안의 각 절을 실제 공고문 문체로 다시 쓰세요. 특히 "입찰참가자격"은 비슷한 공고들이 공통으로 쓴 요건을 이번 공고의 업종·지역 값으로 맞춰 쓰세요.',
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
    out['입찰참가자격'] = sec(/입찰참가자격/);
    out['낙찰자결정문장'] = sec(/낙찰자 결정/);
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

  const api = { WORK_TYPES, workType, FIELDS, SECTIONS, labelOf, money, won, blank, applyRules,
    BID_OPS, bidSearchUrl, bidDetailUrl, slotify, learnSentences, learnedSections, aiPrompt, parseAi, AI_SYSTEM, STATUS, STATUS_ORDER, statusOf, parseBidNo, bidByNoUrl, normalizeBid, attachmentsOf, extractClauses, regionLabel, learn, mapMethod, mapContract,
    draft, regionSentence, templateValues, fillHwpxXml, fillHwpx, zipStore, crc32, placeholdersIn, fmtDT };
  root.JH = root.JH || {};
  root.JH.notice = Object.assign(root.JH.notice || {}, { logic: api });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
