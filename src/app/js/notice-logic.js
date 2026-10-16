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
    { key: '공고명', sec: '기본', type: 'text', wide: true, ph: '예: ○○동 주거환경개선사업', hint: '초안 제목·한글 파일에 들어감' },
    { key: '구분', sec: '기본', type: 'select', opts: ['공사', '용역'] },
    { key: '공종', sec: '기본', type: 'select', optsFrom: 'work', label: '공종(주공종)' },
    { key: '부공종', sec: '기본', type: 'multi', optsFrom: 'work', wide: true, label: '함께 들어가는 공종', hint: '복합공사(예: 토목 + 조경)일 때만 고름' },
    { key: '공고번호', sec: '기본', type: 'text', label: '기관 공고번호', hint: '공고 제○○호', ph: '예: 2026-087' },
    { key: '현장', sec: '기본', type: 'text', wide: true, ph: '예: 용인시 처인구 중부대로 1199', label: '공사(용역) 장소' },
    { key: '개요', sec: '기본', type: 'text', wide: true, ph: '예: 도로 확포장(B=6m, L=91m) 등', label: '공사(용역) 개요' },
    { key: '기간', sec: '기본', type: 'text', ph: '예: 착공일로부터 60일', label: '공사(용역) 기간' },
    { key: '추정가격', sec: '금액', type: 'money', hint: '부가세 별도' },
    { key: '부가세', sec: '금액', type: 'money', auto: true },
    { key: '추정금액', sec: '금액', type: 'money', auto: true, hint: '부가세 포함' },
    { key: '관급자재', sec: '금액', type: 'money', label: '도급자 관급자재', hint: '있을 때' },
    { key: '공사예정금액', sec: '금액', type: 'money', auto: true, label: '공사(사업) 예정금액', hint: '추정금액 + 관급자재' },
    { key: '기초금액', sec: '금액', type: 'money' },
    { key: '순공사원가', sec: '금액', type: 'money', hint: '재료비·노무비·경비·부가세 합계(공고에 적을 때)' },
    { key: '주공종금액', sec: '금액', type: 'money', label: '주공종 추정가격', hint: '복합공사일 때, 부가세 별도', showIf: (v) => !!subWorks(v).length },
    { key: '계약방법', sec: '입찰', type: 'select', opts: ['제한경쟁', '일반경쟁', '지명경쟁', '수의계약(2인 이상 견적)', '수의계약(1인 견적)'] },
    { key: '공고종류', sec: '입찰', type: 'select', opts: ['입찰공고', '견적공고'], auto: true, hint: '한글 파일 만들 때 쓸 양식' },
    { key: '낙찰자결정방법', sec: '입찰', type: 'select', opts: ['적격심사', '최저가', '협상에 의한 계약', '2단계 경쟁'], label: '낙찰자 결정방법' },
    { key: '낙찰하한율', sec: '입찰', type: 'combo', hint: '유사 공고에서 배우기로 채울 수 있음' },
    { key: '업종제한', sec: '자격', type: 'text', auto: true, wide: true },
    { key: '지역제한', sec: '자격', type: 'combo', opts: ['제한 없음(전국)', '경기도', '용인시'] },
    { key: '공동도급', sec: '자격', type: 'select', opts: ['불허', '허용(공동이행)', '허용(분담이행)', '지역의무공동도급'] },
    { key: '입찰보증금', sec: '자격', type: 'text', wide: true },
    { key: '상생결제', sec: '자격', type: 'select', opts: ['적용', '미적용'], auto: true },
    { key: '국민건강보험료', sec: 'A값', type: 'money' },
    { key: '국민연금보험료', sec: 'A값', type: 'money' },
    { key: '노인장기요양보험료', sec: 'A값', type: 'money' },
    { key: '산업안전보건관리비', sec: 'A값', type: 'money' },
    { key: '퇴직공제부금비', sec: 'A값', type: 'money' },
    { key: '안전관리비', sec: 'A값', type: 'money' },
    { key: '품질관리비', sec: 'A값', type: 'money' },
    { key: 'A값', sec: 'A값', type: 'money', auto: true, hint: '위 항목 합계' },
    { key: '공고일', sec: '일정', type: 'date' },
    { key: '입찰시작', sec: '일정', type: 'datetime', label: '입찰서 제출 시작' },
    { key: '입찰마감', sec: '일정', type: 'datetime', label: '입찰서 제출 마감' },
    { key: '개찰일시', sec: '일정', type: 'datetime' },
    { key: '협정서마감', sec: '일정', type: 'datetime', auto: true, label: '공동수급협정서 제출 마감', hint: '입찰마감 전날 18:00', showIf: (v) => !!v.공동도급 && !/불허/.test(v.공동도급) },
    { key: '현장설명', sec: '일정', type: 'select', opts: ['없음', '있음'] },
    { key: '하자담보책임기간', sec: '기타', type: 'text', ph: '예: 준공일로부터 2년' },
    { key: '담당부서', sec: '기타', type: 'text' },
    { key: '담당자', sec: '기타', type: 'text' },
    { key: '연락처', sec: '기타', type: 'text' },
    { key: '사업부서', sec: '기타', type: 'text', label: '사업(감독) 부서', ph: '예: 건설사업처 건설사업1팀', hint: '설계서 열람·공사 문의' },
    { key: '사업부서연락처', sec: '기타', type: 'text', label: '사업부서 연락처', ph: '예: 070-0000-0000' },
    { key: '기관명', sec: '기타', type: 'text' },
  ];
  const SECTIONS = ['기본', '금액', 'A값', '입찰', '자격', '일정', '기타'];
  const SECTION_LABEL = { A값: '사후정산(A값) — 설계서 원가계산서에서' };
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
    set('공고종류', /수의|견적/.test(out.계약방법 || '') ? '견적공고' : '입찰공고');
    const p = money(out.추정가격);
    set('부가세', p ? won(Math.round(p * 0.1)) : '');
    set('추정금액', p ? won(p + money(out.부가세)) : '');
    set('공사예정금액', money(out.관급자재) && money(out.추정금액) ? won(money(out.추정금액) + money(out.관급자재)) : '');
    const aSum = ['국민건강보험료', '국민연금보험료', '노인장기요양보험료', '산업안전보건관리비', '퇴직공제부금비', '안전관리비', '품질관리비'].reduce((x, k) => x + money(out[k]), 0);
    set('A값', aSum ? won(aSum) : '');
    // 공동수급협정서 제출 마감: 입찰마감 전날 18:00(공동도급을 허용할 때)
    const close = String(out.입찰마감 || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (close && out.공동도급 && !/불허/.test(out.공동도급)) { const d = new Date(+close[1], close[2] - 1, +close[3] - 1); set('협정서마감', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T18:00`); }
    else set('협정서마감', '');
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
  // ---------- 한글 양식 그대로 채우기({{ }} 표시 없이) ----------
  // 회사 공고문 한글 파일(지난 공고문이나 빈 양식)을 그대로 두고, 이름표(공 사 명 : …)·표 칸·문장 안의 값만 이번 공고 값으로 바꿈
  // 이번 값이 없는데 양식에 지난 공고의 값(A값 금액 등)이 남으면 ○○로 비우고 "확인할 것"에 적음
  const xdec = (t) => String(t).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  // 본문 XML에서 글자가 있는 문단(표 안 문단 포함)과 그 문단의 글자 조각(hp:t) 위치, 표 칸 주소를 찾음
  function leafParagraphs(xml) {
    const re = /<(\/?)hp:(p|t|tc|tbl|cellAddr)\b([^>]*?)(\/?)>/g;
    const paras = [], open = { p: [], tc: [], tbl: [] };
    let m, curT = null, tcid = 0, tblid = 0;
    while ((m = re.exec(xml))) {
      const close = m[1] === '/', type = m[2], self = m[4] === '/';
      if (type === 't') {
        if (close) { if (curT) { curT.e = m.index; curT = null; } }
        else if (!self) { const p = open.p[open.p.length - 1]; if (p) { curT = { s: re.lastIndex, e: -1 }; p.runs.push(curT); } }
        continue;
      }
      if (type === 'p') {
        if (close) open.p.pop();
        else if (!self) { const tc = open.tc[open.tc.length - 1] || null; const p = { runs: [], tc }; paras.push(p); open.p.push(p); }
        continue;
      }
      if (type === 'tbl') { if (close) open.tbl.pop(); else if (!self) open.tbl.push(tblid++); continue; }
      if (type === 'tc') { if (close) open.tc.pop(); else if (!self) open.tc.push({ id: tcid++, tbl: open.tbl[open.tbl.length - 1], col: -1, row: -1 }); continue; }
      if (type === 'cellAddr') { const tc = open.tc[open.tc.length - 1]; if (tc) { const c = m[3].match(/colAddr="(\d+)"/), r = m[3].match(/rowAddr="(\d+)"/); if (c) tc.col = +c[1]; if (r) tc.row = +r[1]; } }
    }
    for (const p of paras) { p.texts = p.runs.filter((r) => r.e >= 0).map((r) => xdec(xml.slice(r.s, r.e))); p.orig = p.texts.slice(); }
    return paras.filter((p) => p.runs.length);
  }
  const ptext = (p) => p.texts.join('');
  // 문단 글자의 [a, b) 를 text로 바꿈(시작 자리가 든 조각에 넣고 나머지 조각에서는 지움 → 글자 모양 유지)
  function spliceRuns(arr, a, b, text) {
    const starts = []; let pos = 0; for (const t of arr) { starts.push(pos); pos += t.length; }
    let k = arr.findIndex((t, i) => a >= starts[i] && a < starts[i] + t.length);
    if (k < 0) k = arr.length - 1;
    for (let i = arr.length - 1; i >= 0; i--) {
      const s0 = starts[i], e0 = s0 + arr[i].length;
      const from = Math.min(Math.max(a, s0) - s0, arr[i].length), to = Math.max(from, Math.min(b, e0) - s0);
      if (i === k) arr[i] = arr[i].slice(0, from) + text + arr[i].slice(to);
      else if (b > s0 && a < e0) arr[i] = arr[i].slice(0, from) + arr[i].slice(to);
    }
  }
  const rx = (w) => w.split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  const alt2 = (ws) => '(?:' + ws.map(rx).join('|') + ')';
  // 사후정산(A값) 항목
  const AVAL = [['국민건강보험료', '국민건강보험료'], ['국민연금보험료', '국민연금보험료'], ['노인장기요양보험료', '노인장기요양보험료'], ['산업안전보건관리비', '산업안전보건관리비'],
    ['퇴직공제부금비', '퇴직공제부금비'], ['안전관리비', '안전관리비'], ['품질관리비', '품질관리비']];
  const NOTICE_LABELS = [
    { key: '공고명', re: alt2(['공사명', '용역명', '사업명', '물품명', '구매명', '과업명', '입찰건명', '견적건명', '공고명', '건명']) },
    { key: '현장', re: alt2(['공사현장', '공사장소', '공사위치', '사업장소', '사업위치', '용역장소', '과업장소', '납품장소', '이행장소', '현장위치', '설치장소']) },
    { key: '개요', re: alt2(['공사개요', '용역개요', '사업개요', '과업개요', '구매개요']) },
    { key: '기간', re: alt2(['공사기간', '용역기간', '사업기간', '과업기간', '계약기간', '이행기간', '납품기한', '납품기간']) },
    { key: '공사예정금액', re: alt2(['공사예정금액', '사업예정금액', '용역예정금액']), money: true },
    { key: '추정금액', re: alt2(['추정금액']), money: true },
    { key: '추정가격', re: alt2(['추정가격']), money: true },
    { key: '기초금액', re: alt2(['기초금액']), money: true },
    { key: '순공사원가', re: alt2(['순공사원가']), money: true },
    { key: '주공종금액', re: alt2(['주공종추정가격', '주공종금액']), money: true },
    { key: '협정서기간', re: alt2(['공동수급협정서제출기간', '공동수급협정서제출마감', '협정서제출기간']), dates: ['입찰시작', '협정서마감'] },
    { key: '입찰기간', re: alt2(['전자입찰서제출기간', '입찰서제출기간', '견적서제출기간', '전자견적서제출기간', '입찰서제출', '견적서제출', '제출기간', '입찰기간', '견적기간', '접수기간']), dates: ['입찰시작', '입찰마감'] },
    { key: '개찰일시', re: alt2(['개찰일시', '개찰일자', '개찰시간', '개찰일']), dates: ['개찰일시'] },
    { key: '열람장소', re: alt2(['설계서열람장소', '설계서열람', '과업지시서열람장소', '열람장소']), contact: ['사업부서', '사업부서연락처'] },
    { key: '계약문의', re: alt2(['계약에관한사항', '계약관련문의', '계약문의']), contact: ['담당부서', '연락처'] },
    { key: '사업문의', re: alt2(['공사에관한사항', '용역에관한사항', '사업에관한사항', '과업에관한사항', '물품에관한사항']), contact: ['사업부서', '사업부서연락처'] },
    { key: '하자담보책임기간', re: alt2(['하자담보책임기간', '하자보수기간', '하자담보기간']) },
    ...AVAL.map(([k, w]) => ({ key: k, re: alt2([w]), money: true, aval: true })),
    { key: 'A값', re: '(?:A\\s*값|A\\s*=)', money: true, aval: true },
  ];
  const BULLET0 = '^(\\s*(?:[가-하]\\s*[.)]|\\(?\\d{1,2}\\s*[.)]|[①-⑳]|[○◦▪·•\\-※□■▶*])?\\s*)';
  const RE_DT = /(20\d{2})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})\s*[.일]?\s*(\(\s*[월화수목금토일]\s*\))?\s*((?:오전|오후)?\s*\d{1,2}\s*[:시]\s*\d{0,2}\s*분?)?/g;
  const WEEK = '일월화수목금토';
  function fmtLike(old, iso) {
    const m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return '';
    const d = new Date(+m[1], m[2] - 1, +m[3]);
    const wk = /\([월화수목금토일]\s*\)/.test(old) ? `(${WEEK[d.getDay()]})` : '';
    const time = m[4] && /\d\s*[:시]/.test(old) ? (/시/.test(old) ? ` ${+m[4]}시${+m[5] ? ` ${+m[5]}분` : ''}` : ` ${m[4]}:${m[5]}`) : '';
    return /년/.test(old) ? `${m[1]}년 ${+m[2]}월 ${+m[3]}일${wk}${time}` : `${m[1]}. ${+m[2]}. ${+m[3]}.${wk}${time}`;
  }
  const BLANK_MONEY = '○○○';
  const PHONE_DIGITS = /0\d{1,2}\)?[-.\s]?\d{3,4}[-.\s]\d{4}/;
  // 값 바꾸기: 금액은 숫자만, 날짜는 날짜만, 연락처는 부서·전화만(앞뒤 글은 양식 그대로). null이면 그대로 둠
  function newValue(L0, oldV, v, notes) {
    if (L0.money) {
      const n = money(v[L0.key]);
      if (!/[\d,]{3,}/.test(oldV)) return n ? `금 ${won(n)}원` : null;
      if (!n) { if (L0.aval || /순공사원가|공사예정금액/.test(L0.key)) { notes.add(`${L0.key} 금액`); return oldV.replace(/[\d,]{3,}/, BLANK_MONEY); } return null; }
      return oldV.replace(/[\d,]{3,}/, won(n));
    }
    if (L0.dates) {
      const hits = [...oldV.matchAll(RE_DT)]; if (!hits.length) return null;
      let out = oldV, shift = 0;
      hits.forEach((h, i) => {
        const key = L0.dates[Math.min(i, L0.dates.length - 1)];
        const old = h[0].replace(/\s+$/, '');
        let rep = fmtLike(old, v[key]);
        if (!rep) { rep = '○○○○. ○○. ○○.' + (/\d\s*:/.test(old) ? ' ○○:○○' : ''); notes.add(labelOf(key) + ' 일시'); }
        out = out.slice(0, h.index + shift) + rep + out.slice(h.index + shift + old.length); shift += rep.length - old.length;
      });
      return out;
    }
    if (L0.contact) {
      const dept = v[L0.contact[0]], phone = v[L0.contact[1]];
      let out = oldV;
      if (phone) out = out.replace(PHONE_DIGITS, phone); // 전화번호 숫자만(괄호·☎는 그대로)
      if (dept) {
        // "용인도시공사 건설사업1팀 (☎ …)" / "재무관리처 회계팀(☏…)" — 괄호·☎·전화번호 앞의 부서 이름만 바꿈, 기관명은 그대로
        const org = v.기관명 && out.startsWith(v.기관명) ? v.기관명 + ' ' : '';
        const m = out.match(/^(.*?)(\s*)(\(|☎|☏|0\d{1,2}-\d)/);
        out = m ? `${org}${dept}${m[2]}${out.slice(m[1].length + m[2].length)}` : `${org}${dept}`;
      }
      if (!dept && !phone) notes.add(`${L0.key === '계약문의' ? '계약 담당' : '사업부서'} 부서·연락처`);
      return out === oldV ? null : out;
    }
    const x = v[L0.key]; return x ? String(x) : null;
  }
  const isLabelText = (t) => NOTICE_LABELS.some((x) => new RegExp('^' + x.re + '$').test(t)) || /^(업종|비율|구분|항목|금액|비고)$/.test(t);
  function fillNoticeXml(xml, v, opts = {}) {
    const paras = leafParagraphs(xml);
    const done = new Set(), notes = new Set(), oldNames = new Set();
    // 1) 이름표 + 값이 한 문단에: "가. 공 사 명 : ○○공사", "※ 순공사원가(재료비…) : 금…원"
    for (const p of paras) {
      const t = ptext(p); if (t.length > 220) continue;
      for (const L0 of NOTICE_LABELS) {
        const m = t.match(new RegExp(BULLET0 + '(' + L0.re + ')(\\s*\\([^)]{0,60}\\))?(\\s*[:：]\\s*)(\\S.*)$'));
        if (!m) continue;
        const a = m[1].length + m[2].length + (m[3] || '').length + m[4].length, oldV = m[5];
        if (L0.key === '공고명') oldNames.add(oldV.replace(/^「|」$/g, '').trim());
        const nv = newValue(L0, oldV, v, notes); if (nv == null) break;
        spliceRuns(p.texts, a, t.length, nv); done.add(L0.key); break;
      }
    }
    // 2) 표: 이름 칸의 오른쪽 칸 또는 바로 아래 칸이 값
    const cells = new Map(); for (const p of paras) if (p.tc) { if (!cells.has(p.tc.id)) cells.set(p.tc.id, { tc: p.tc, ps: [] }); cells.get(p.tc.id).ps.push(p); }
    const at = (tbl, row, col) => [...cells.values()].find((c) => c.tc.tbl === tbl && c.tc.row === row && c.tc.col === col);
    const ctext = (c) => c.ps.map(ptext).join('').replace(/\s+/g, ' ').trim();
    for (const c of cells.values()) {
      const label = ctext(c).replace(/[\s:：]/g, '');
      const L0 = NOTICE_LABELS.find((x) => new RegExp('^' + x.re + '$').test(label)); if (!L0) continue;
      const cands = [at(c.tc.tbl, c.tc.row, c.tc.col + 1), at(c.tc.tbl, c.tc.row + 1, c.tc.col)].filter(Boolean);
      const target = cands.find((q) => { const t = ctext(q).replace(/\s/g, ''); return t && !isLabelText(t) && (!L0.money && !L0.dates || /\d/.test(t)); });
      if (!target) continue;
      const oldV = ctext(target);
      if (L0.key === '공고명') oldNames.add(oldV);
      const nv = newValue(L0, oldV, v, notes); if (nv == null) continue;
      target.ps.forEach((q, i) => spliceRuns(q.texts, 0, ptext(q).length, i === 0 ? nv : ''));
      done.add(L0.key);
    }
    // 평가대상업종 표: "업종" 칸 아래에 업종명 → 이번 업종(공종이 하나일 때)
    const ws = worksOf(v);
    for (const c of cells.values()) {
      if (ctext(c).replace(/\s/g, '') !== '업종') continue;
      const below = at(c.tc.tbl, c.tc.row + 1, c.tc.col); if (!below) continue;
      if (ws.length === 1) { const old = ctext(below); if (old && old !== ws[0].license) { below.ps.forEach((q, i) => spliceRuns(q.texts, 0, ptext(q).length, i === 0 ? ws[0].license : '')); done.add('업종제한'); } }
      else if (ws.length > 1) notes.add('평가대상업종 표(공종별 추정가격·비율)');
    }
    // 제목의 「옛 공고명」
    for (const p of paras.slice(0, 12)) { const m = ptext(p).match(/「([^」]{4,80})」/); if (m && !/법|령|규칙|기준|조례/.test(m[1])) oldNames.add(m[1].trim()); }
    // 3) 문장 안 값
    const region = v.지역제한 && !/전국|없음/.test(v.지역제한) ? v.지역제한 : '';
    const lic = ws.length > 1 ? licensePhrase(ws) : ws.length ? `「${ws[0].law}」에 따른 ${ws[0].license}` : '';
    const subAll = (p, re, rep, cond) => {
      const t = ptext(p); if (cond && !cond.test(t)) return false;
      const hits = [...t.matchAll(re)]; if (!hits.length) return false;
      let changed = false;
      for (const h of hits.reverse()) { const r = typeof rep === 'function' ? rep(h) : rep; if (r == null || r === h[0]) continue; spliceRuns(p.texts, h.index, h.index + h[0].length, r); changed = true; }
      return changed || hits.length > 0;
    };
    const names = [...oldNames].filter((x) => x && x.length >= 4 && v.공고명 && x !== v.공고명).sort((a, b) => b.length - a.length);
    const numIn = (h, n) => h[0].replace(/[\d,]{3,}/, n ? won(n) : BLANK_MONEY);
    const licWords = new Set(), licCode = {}; let inQual = false;
    for (const p of paras) {
      const t0 = ptext(p);
      for (const nm of names) if (subAll(p, new RegExp(nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), v.공고명)) done.add('공고명');
      if (subAll(p, /(공\s*고\s*제\s*)([\d\s\-–‐]{0,20}?|[^\s호]{0,20})(\s*호)/g, (h) => `${h[1]}${v.공고번호 || '        '}${h[3]}`)) done.add('공고번호');
      // 괄호 안 금액: (추정가격 금184,000,000원 + 부가가치세 금18,400,000원 +도급자 관급자재 금58,740,000원)
      if (subAll(p, /추\s*정\s*가\s*격\s*:?\s*금\s*[\d,]{3,}/g, (h) => numIn(h, money(v.추정가격)))) done.add('추정가격');
      if (subAll(p, /부\s*가\s*가\s*치\s*세\s*:?\s*금\s*[\d,]{3,}/g, (h) => numIn(h, money(v.부가세)))) done.add('부가세');
      if (/관\s*급\s*자\s*재\s*:?\s*금\s*[\d,]{3,}/.test(t0)) { subAll(p, /관\s*급\s*자\s*재\s*:?\s*금\s*[\d,]{3,}/g, (h) => numIn(h, money(v.관급자재))); if (!money(v.관급자재)) notes.add('관급자재 금액'); else done.add('관급자재'); }
      // A값 항목: 국민건강보험료(금1,487,708원), (A= 7,268,916원), A값: 44,159,747원
      for (const [k, w] of AVAL) if (subAll(p, new RegExp(rx(w) + '\\s*\\(\\s*금\\s*[\\d,]{3,}', 'g'), (h) => numIn(h, money(v[k])))) { if (money(v[k])) done.add(k); else notes.add(k + ' 금액'); }
      if (subAll(p, /A\s*(?:값)?\s*[=:：]\s*금?\s*[\d,]{3,}/g, (h) => numIn(h, money(v.A값)))) { if (money(v.A값)) done.add('A값'); else notes.add('A값(사후정산) 금액'); }
      if (v.낙찰하한율 && subAll(p, /\d{1,3}\.\d{1,4}\s*%/g, String(v.낙찰하한율).replace(/\s/g, ''), /하한율/)) done.add('낙찰하한율');
      // 지역: "지역제한(용인시)", "본점 소재지가 용인시 관내", "경기도 내에 주된 영업소"
      if (region && subAll(p, /지역\s*제한\s*\(([^)]{2,20})\)/g, `지역제한(${region})`)) done.add('지역제한');
      if (region && subAll(p, new RegExp(RE_REGION.source, 'g'), region, /소재지|소재|주된\s*영업소/)) done.add('지역제한');
      if (!region && /지역\s*제한\s*\(|소재지가|주된\s*영업소를/.test(t0)) notes.add('지역제한 문장(이번 공고는 제한 없음)');
      // 업종: 「법」에 따른 ○○업, [토목공사업(0001)]
      if (lic && subAll(p, new RegExp(RE_LICENSE.source, 'g'), lic, /등록|면허|업종/)) done.add('업종제한');
      // 큰 제목으로 참가자격 절인지 따짐(업종 문장 점검은 그 절 안에서만)
      const hd = t0.match(/^\s*\d{1,2}\s*\.\s*(\S.{0,30})$/); if (hd) inQual = /참가\s*자격|견적\s*참가/.test(hd[1]);
      const codes = [...t0.matchAll(/\[\s*([가-힣·]{2,20}업)\s*\((\d{4})\)\s*\]/g)];
      codes.forEach((h) => { licWords.add(h[1]); licCode[h[1]] = h[2]; });
      if (ws.length && codes.length) {
        // [토목공사업(0001)] 꼴: 같은 업종은 코드 그대로, 새 업종은 코드 자리를 ○○○○로
        const first = codes[0], last = codes[codes.length - 1];
        const rep = ws.map((w) => `[${w.license}(${licCode[w.license] || '○○○○'})]`).join(', ');
        spliceRuns(p.texts, first.index, last.index + last[0].length, rep);
        const unk = ws.filter((w) => !licCode[w.license]).map((w) => w.license);
        if (unk.length) notes.add(`${unk.join('·')} 업종코드`); else done.add('업종제한');
      }
      if (inQual) for (const w of ['소방시설공사업', '전기공사업', '정보통신공사업', '토목공사업', '건축공사업', '토목건축공사업', '조경공사업', '상·하수도설비공사업']) if (t0.includes(w)) licWords.add(w);
      // 연락처: 계약 문의 문장만(감사실·콜센터·사업부서 전화는 그대로)
      if (v.연락처 && subAll(p, new RegExp(RE_PHONE.source, 'g'), (h) => h[0].replace(PHONE_DIGITS, v.연락처), /계약.{0,12}(문의|담당|사항)/)) done.add('연락처');
      // 공동계약 허용 여부가 이번 공고와 반대인 문장
      const t = ptext(p);
      if (v.공동도급 && /공동\s*(계약|도급|수급)/.test(t) && t.length < 240 && !/협정서/.test(t)) {
        const allow = !/불허/.test(v.공동도급), no = /허용하지\s*않|불허|허용\s*안\s*함/.test(t), yes = !no && /(허용|가능)(합니다|함|한다|하고|하며)/.test(t);
        if ((no && allow) || (yes && !allow)) {
          if (/하도급/.test(t)) notes.add('공동수급·하도급 문장(이번 공고는 ' + v.공동도급 + ')');
          else { const m = t.match(new RegExp(BULLET0)); spliceRuns(p.texts, m ? m[1].length : 0, t.length, jointBody(v).split('\n')[0].replace(/^\s*가\.\s*/, '')); done.add('공동도급'); }
        }
      }
      // 끝의 공고일 "2026년 7월 15일"
      if (/^\s*20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일\s*\.?\s*$/.test(t)) {
        const iso = v.공고일 || new Date().toISOString().slice(0, 10);
        spliceRuns(p.texts, 0, t.length, t.replace(/20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/, fmtLike('년', iso).replace(/\.$/, '')));
        done.add('공고일'); if (!v.공고일) notes.add('공고일(오늘 날짜로 넣음)');
      }
    }
    // 양식의 참가자격 업종이 이번 공종과 다르면 알림
    const mine = ws.map((w) => w.license);
    if (mine.length && licWords.size && !mine.every((x) => licWords.has(x))) notes.add(`참가자격 업종 문장(양식: ${[...licWords].join('·')} → 이번: ${mine.join('·')})`);
    // 바뀐 조각만 XML에 다시 씀(뒤에서부터)
    const edits = [];
    for (const p of paras) p.texts.forEach((t, i) => { if (t !== p.orig[i]) edits.push({ s: p.runs[i].s, e: p.runs[i].e, t }); });
    edits.sort((a, b) => b.s - a.s);
    let out = xml;
    for (const e of edits) out = out.slice(0, e.s) + xmlEsc(e.t) + out.slice(e.e);
    if (edits.length) out = out.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '');
    return { xml: out, count: edits.length, done: [...done], notes: [...notes] };
  }
  // 양식 HWPX 전체: {{항목}} 표시가 있으면 먼저 채우고, 이름표·표·문장 값을 이번 공고 값으로
  const NEED = { 공고명: '공고명', 입찰기간: '입찰(견적)서 제출 기간', 개찰일시: '개찰일시' };
  function fillNoticeHwpx(cfbLib, bytes, v, sections) {
    const z = cfbLib.read(bytes, { type: 'array' });
    const root0 = z.FullPaths[0];
    const entries = []; let count = 0; const done = new Set(), notes = new Set();
    const values = templateValues(v, sections);
    z.FullPaths.forEach((p, i) => {
      const fi = z.FileIndex[i];
      if (fi.type !== 2 || /\u0001Sh33tJ5$/.test(p) || p.endsWith('/')) return;
      const name = p.startsWith(root0) ? p.slice(root0.length) : p;
      let data = new Uint8Array(fi.content);
      if (/^Contents\/section\d+\.xml$/i.test(name)) {
        let xml = new TextDecoder('utf-8').decode(data);
        const a = fillHwpxXml(xml, values); if (a.count) { xml = a.xml; count += a.count; done.add('{{항목}}'); }
        const b = fillNoticeXml(xml, v); if (b.count) { xml = b.xml; count += b.count; } b.done.forEach((k) => done.add(k)); b.notes.forEach((k) => notes.add(k));
        data = new TextEncoder().encode(xml);
      }
      if (/^Preview\/PrvText\.txt$/i.test(name)) data = new TextEncoder().encode(`${v.공고명 || ''}`);
      entries.push({ name, data });
    });
    const missed = Object.entries(NEED).filter(([k]) => !done.has(k) && !done.has('{{항목}}')).map(([, l]) => l);
    return { bytes: zipStore(entries), count, done: [...done], missed, notes: mergeNotes([...notes]) };
  }
  // 확인할 것 묶기: A값 항목들, 일정들은 한 줄로
  function mergeNotes(ns) {
    const aval = /^(국민건강보험료|국민연금보험료|노인장기요양보험료|산업안전보건관리비|퇴직공제부금비|안전관리비|품질관리비|A값)( 금액|\(사후정산\) 금액)$/;
    const dates = / 일시$/;
    const a = ns.filter((x) => aval.test(x)).map((x) => x.replace(aval, '$1')).filter((x) => x !== 'A값');
    const d = ns.filter((x) => dates.test(x)).map((x) => x.replace(dates, ''));
    const rest = ns.filter((x) => !aval.test(x) && !dates.test(x));
    return [...(d.length ? [`일정 — 위 [일정] 칸에 넣으세요: ${d.join(', ')}`] : []), ...(ns.some((x) => aval.test(x)) ? [`A값(사후정산) 금액 — 설계서 원가계산서 값을 [사후정산(A값)] 칸에: ${a.length ? a.join(', ') : 'A값'}`] : []), ...rest];
  }
  // 공고 종류: 2인 이상 견적 수의계약은 견적공고, 나머지는 입찰공고
  const noticeKind = (v) => (v && v.공고종류 ? v.공고종류 : /수의|견적/.test(v && v.계약방법 || '') ? '견적공고' : '입찰공고');

  function placeholdersIn(text) {
    const plain = String(text).replace(/<[^>]+>/g, '');
    return [...new Set([...plain.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map((m) => m[1]))];
  }

  const api = { SECTION_LABEL, leafParagraphs, spliceRuns, fillNoticeXml, fillNoticeHwpx, noticeKind, WORK_TYPES, workType, subWorks, worksOf, separateIn, licensePhrase, licenseSentence, splitList, jointBody, FIELDS, SECTIONS, labelOf, money, won, blank, applyRules,
    BID_OPS, bidSearchUrl, bidDetailUrl, slotify, learnSentences, learnedSections, aiPrompt, parseAi, AI_SYSTEM, STATUS, STATUS_ORDER, statusOf, parseBidNo, bidByNoUrl, normalizeBid, attachmentsOf, extractClauses, regionLabel, learn, mapMethod, mapContract,
    draft, draftFull, parseNotice, learnDocument, mergeWrapped, secKey, regionSentence, templateValues, fillHwpxXml, fillHwpx, zipStore, crc32, placeholdersIn, fmtDT };
  root.JH = root.JH || {};
  root.JH.notice = Object.assign(root.JH.notice || {}, { logic: api });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
