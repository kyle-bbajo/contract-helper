// 순수 로직 단위 시험: node --test tests/unit/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/app/js/logic.js');

const lists = L.defaultChecklists();
const cls = (name, title, type = '공사') => L.classifyItem(lists[type], name, title ? L.norm(title) : '');

test('파일명으로 서류 종류 분류(가장 긴 단어 우선)', () => {
  assert.equal(cls('계약서.pdf'), 'c-contract');
  assert.equal(cls('견적서_산출내역.pdf'), 'c-calc');
  assert.deepEqual(L.itemsInName(L.defaultChecklists().공사, '견적서_산출내역.pdf'), ['c-estimate', 'c-calc'], '파일 이름에 서류가 둘이면 둘 다(하나는 함께 든 서류로)');
  assert.equal(cls('지방세 납세증명서.pdf'), 'c-ltax');
  assert.equal(cls('세금계산서.pdf'), 'c-invoice');
  assert.equal(cls('하자보수이행보증금지급각서.pdf'), 'c-defect');
});

test('파일명이 noname이면 문서 제목으로 분류(앞에 나온 단어 우선)', () => {
  assert.equal(cls('noname(3).pdf', '사업장 4대 사회보험 완납증명서 사업장명 다해토건'), 'c-inspaid');
  assert.equal(cls('noname.pdf', '사업장 4대 사회보험 가입증명서'), 'c-insjoin');
  assert.equal(cls('noname.pdf', '고용·산재 가입증명원 공사명'), 'c-empjoin');
  assert.equal(cls('noname.pdf', '고용·산재보험료 완납증명서'), 'c-emppaid');
  assert.equal(cls('noname.pdf', '지방세 납세증명서'), 'c-ltax');
  assert.equal(cls('noname.pdf', '착수계 용역명 청소', '용역'), 's-start');
  assert.equal(cls('noname.pdf', '회의록 안건'), null);
});

test('공사·용역 구비서류 목록(구비서류 안내 기준)', () => {
  const names = (t) => lists[t].map((x) => x.name);
  for (const n of ['노무비 지급확인제', '4대 사회보험 가입증명서', '고용·산재 가입증명원', '준공사진대지', '하자보수 이행보증금 지급각서', '국세 납세증명서', '세금계산서'])
    assert.ok(names('공사').includes(n), n);
  for (const n of ['보안각서·보안서약서', '작업결과물', '용역근로자 노무비 지급 내역서']) assert.ok(names('용역').includes(n), n);
  const ids = [...lists.공사, ...lists.용역].map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'id 중복 없음');
});

test('문서 글자에서 계약번호·계약명·업체명 찾기', () => {
  const m = L.findMeta(['공사 계약서', '계약번호 : R26BK01234567-00', '계약건명 : 시청사 옥상 방수공사 계약금액 : 금 48,000,000원', '계약상대자 상호 : (주)다해토건 대표자 : 홍길동', '발주기관 : 용인도시공사']);
  assert.deepEqual(m, { no: 'R26BK01234567-00', name: '시청사 옥상 방수공사', vendor: '(주)다해토건' });
  assert.equal(L.findMeta(['계 약 번 호 : R26BK0000111']).no, 'R26BK0000111');
  assert.equal(L.findMeta(['상호 : 용인도시공사']).vendor, '', '발주기관은 업체명이 아님');
});

test('계약 배정: 번호 > 계약명 > 업체명, 동점이면 배정 안 함', () => {
  const A = { key: 'a', nums: ['R26BK01234567-00'], name: '시청사 옥상 방수공사', vendor: '(주)다해토건' };
  const B = { key: 'b', nums: ['R26BS07654321'], name: '체육관 시설 청소 용역', vendor: '한빛환경 주식회사' };
  const C = { key: 'c', nums: [], name: '공영주차장 도색 공사', vendor: '(주)다해토건' };
  const m = (t) => (L.matchContract([A, B, C], L.norm(t)) || {}).key || null;
  assert.equal(m('R26BK01234567 청구서'), 'a');
  assert.equal(m('용역명 체육관 시설 청소 용역'), 'b');
  assert.equal(m('상호 한빛환경(주) 지방세 완납'), 'b', '업체명(주식회사·(주) 표기 달라도)');
  assert.equal(m('사업장명 다해토건'), null, '같은 업체 계약이 둘이면 정하지 않음');
  assert.equal(m('시청사 옥상 방수 상호 다해토건'), 'a', '계약명 일부 단어 + 업체명');
  assert.equal(m('회의록'), null);
});

test('나라장터 응답 정리', () => {
  const x = { untyCntrctNo: 'R26BK01234567', dcsnCntrctNo: 'R26BK01234567-00', cnstwkNm: '시청사 옥상 방수공사', corpList: '[1^주계약업체^단독^100^(주)다해토건^홍길동^대한민국^1234567890]', totCntrctAmt: '48000000', ttalCcmpltDate: '2026-10-10', cntrctInsttOfclNm: '박주호', cntrctInsttChrgDeptNm: '계약팀' };
  const c = L.normalizeApiItem(x, '공사');
  assert.equal(c.vendor, '(주)다해토건'); assert.equal(c.amount, 48000000); assert.equal(c.officer, '박주호'); assert.equal(c.endDate, '2026-10-10');
  assert.deepEqual(L.parseCorpList('[1^공동^60^대한전기(주)^이몽룡]^[2^공동^40^서울건설^김구]'.replace(']^[', '],[')), ['대한전기(주)', '서울건설']);
  const body = L.parseApiBody({ response: { header: { resultCode: '00' }, body: { items: { item: x }, totalCount: '1' } } });
  assert.equal(body.items.length, 1); assert.equal(body.total, 1);
  assert.throws(() => L.parseApiText('<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>'), /인증키가 등록되지 않았습니다/);
});

test('조회 기간을 한 달씩 나눔·요청 주소', () => {
  assert.deepEqual(L.monthRanges(3, '2026-10-16'), [['20261001', '20261016'], ['20260901', '20260930'], ['20260801', '20260831']]);
  const u = L.apiUrl(L.API_OPS.공사, { apiKey: 'k+y', insttNm: '용인도시공사', insttDivCd: '1' }, '20261001', '20261016', 1, 100);
  assert.match(u, /getCntrctInfoListCnstwkPPSSrch\?serviceKey=k%2By&/);
  assert.match(u, /insttNm=%EC%9A%A9%EC%9D%B8/);
});

test('체크리스트 상태: 원본 체크도 받은 것으로', () => {
  const list = lists.공사;
  const st = L.checklistStatus(list, [{ itemId: 'c-contract', kind: 'pdf' }, { itemId: 'c-finish', kind: 'hwp' }], { 'c-start': true });
  assert.ok(!st.missing.some((x) => x.id === 'c-contract' || x.id === 'c-start'));
  assert.equal(st.conv.length, 1, '변환 안 된 한글');
});

test('외부재정연계(e나라도움 등) 알아내기: 이름이 Y이거나 값에 그런 말이 있으면', () => {
  const L = require('../../src/app/js/logic.js');
  assert.equal(L.normalizeApiItem({ cnstwkNm: 'a', untyCntrctNo: 'R26BK01234567' }, '공사').budgetAuto, ''); // 응답에 없으면 모름
  assert.equal(L.normalizeApiItem({ cnstwkNm: 'a', untyCntrctNo: 'R26BK01234567', extrnlFnncLnkYn: 'Y' }, '공사').budgetAuto, 'ext');
  assert.equal(L.normalizeApiItem({ cnstwkNm: 'a', untyCntrctNo: 'R26BK01234567', extrnlFnncLnkYn: 'N' }, '공사').budgetAuto, '');
  assert.equal(L.normalizeApiItem({ cntrctNm: 'b', baseDtls: '외부재정연계(e나라도움) 사업' }, '용역').budgetAuto, 'ext');
  assert.match(L.detectExtFinance({ payDivNm: 'e-나라도움 연계' }).why, /payDivNm/);
  assert.equal(L.detectExtFinance({ cntrctNm: '용인 보조금 지원센터 청소' }), null); // 계약명에 든 말은 보지 않음
});

test('증명서 유효기간·준공 날짜 읽기, 보완 요청 메일', () => {
  const L = require('../../src/app/js/logic.js');
  let r = L.extractDates(['납세증명서', '발급일자 : 2026. 10. 1.', '유효기간 : 2026. 10. 31.', '2026년 10월 1일 용인세무서장']);
  assert.deepEqual([r.valid, r.validHow, r.issue], ['20261031', 'read', '20261001']);
  r = L.extractDates(['완납증명서', '유효기간', '2026.09.25 ~ 2026.10.15']);
  assert.equal(r.valid, '20261015');
  r = L.extractDates(['지방세 납세증명서', '유효기간 : 발급일로부터 30일', '발급일 2026년 10월 2일']);
  assert.deepEqual([r.valid, r.validHow], ['20261031', 'calc']);
  r = L.extractDates(['준공계', '<준공일자><2026. 10. 8.>']); assert.equal(r.finish, '20261008');
  r = L.extractDates(['준공검사조서', '검사일자 : 2026-10-12', '준공일자 2026-10-08']); assert.deepEqual([r.inspect, r.finish], ['20261012', '20261008']);
  assert.equal(L.extractDates(['아무 날짜 없음']).valid, '');
  assert.ok(L.isCertItem('c-ltax') && L.isCertItem('s-inspaid') && !L.isCertItem('c-claim'));
  const m = L.vendorMail({ c: { name: '시청사 옥상 방수공사', no: 'R26BK01234567-00' }, org: '용인도시공사', dept: '계약팀', officer: '용도공', phone: '031-000-0000',
    missing: ['대금청구서'], reissue: [{ name: '국세 납세증명서', valid: '20261015' }], basis: { date: '20261022' } });
  assert.equal(m.title, '[용인도시공사] 「시청사 옥상 방수공사」 대금 청구 서류 보완 요청');
  assert.match(m.body, /^안녕하십니까\. 용인도시공사 계약팀 용도공입니다\./);
  assert.match(m.body, /1\. 미제출 서류\n  - 대금청구서/);
  assert.match(m.body, /2\. 재발급 필요 서류\(유효기간 부족\)\n  - 국세 납세증명서: 유효기간 2026\.10\.15까지 → 2026\.10\.22 이후까지/);
  assert.match(m.body, /용도공 드림\n용인도시공사 계약팀 \/ 031-000-0000$/);
});

test('업체목록: 실제 나라장터 응답 형식(이름 위치·공동도급에서 주계약업체 우선)', () => {
  const L = require('../../src/app/js/logic.js');
  assert.deepEqual(L.parseCorpList('[1^주계약업체^단독^크렉스^박학순^대한민국^100^크렉스^^7800300048]'), ['크렉스']);
  assert.deepEqual(L.parseCorpList('[1^주계약업체^단독^프라임안전기술원^김형준^대한민국^^프라임안전기술원^^4932601706]'), ['프라임안전기술원']);
  assert.deepEqual(L.parseCorpList('[1^도급업체^혼합방식^주식회사 수양엔지니어링^박상일^대한민국^5^주식회사 수양엔지니어링^^1248149079],[2^주계약업체^혼합방식^주식회사 에이플러스건축사사무소^이윤호^대한민국^39^주식회사 에이플러스건축사사무소^^3048131796]')[0], '주식회사 에이플러스건축사사무소');
  assert.deepEqual(L.parseCorpList('[1^주계약업체^단독^100^(주)다해토건^홍길동^대한민국^1234567890]'), ['(주)다해토건']); // 예전 시험 형식도
  const n = L.normalizeApiItem({ untyCntrctNo: 'R26TE17592369', dcsnCntrctNo: 'R26TA0216731800', cntrctRefNo: 'R26TA0216731800', cntrctNm: '아르피아 수영장 샤워실 청소 용역',
    corpList: '[1^주계약업체^단독^크렉스^박학순^대한민국^100^크렉스^^7800300048]', totCntrctAmt: '4160000', wbgnDate: '2026-08-30', ttalScmpltDate: '2026-09-05',
    cntrctInsttOfclNm: '이창구', cntrctInsttChrgDeptNm: '회계팀', baseDtls: '추정가격 2천만원 이하 물품 또는 용역', payDivNm: '' }, '용역');
  assert.deepEqual([n.vendor, n.amount, n.startDate, n.endDate, n.officer, n.dept, n.budgetAuto], ['크렉스', 4160000, '2026-08-30', '2026-09-05', '이창구', '회계팀', '']);
});

test('서류 목록: 대금청구에 완납증명서·지역개발채권, 착공계 손해배상공제·노무비 개인정보 동의서, 하자보수보증서 ↔ 지급각서', () => {
  const d = L.defaultChecklists();
  const g = (t, id) => d[t].find((x) => x.id === id);
  assert.equal(g('공사', 'c-inspaid').group, '대금청구'); assert.equal(g('공사', 'c-emppaid').group, '대금청구');
  assert.equal(g('용역', 's-inspaid').group, '대금청구');
  assert.ok(g('공사', 'c-bond') && g('용역', 's-bond') && g('물품', 'g-bond'));
  assert.equal(g('공사', 'c-dmgins').group, '착공계'); assert.ok(g('공사', 'c-laborpriv') && g('용역', 's-laborpriv'));
  assert.equal(g('공사', 'c-roster').required, true, '착공계는 가입자명부 필수');
  // 둘 중 하나: 보증서만 있어도 지급각서는 빠진 것으로 보지 않음
  const st = L.checklistStatus(d.공사, [{ itemId: 'c-defectbond' }], {});
  assert.ok(!st.missing.some((x) => x.id === 'c-defect') && !st.missing.some((x) => x.id === 'c-defectbond'));
  // 여러 양식이 든 파일: 쪽마다 제목으로
  const pages = L.classifyPages(d.공사, ['착 공 계 공사명: 시청사 방수공사', '현장대리인계', '예정공정표', '4대 사회보험 가입증명서 사업장명 (주)다해', '노무비 개인정보 수집·이용·제공 동의서', '제 3 조 (계약의 이행) 계약상대자는 이 계약서에서 정한 바에 따라 성실히 이행하여야 하며 착공']);
  assert.deepEqual(pages['c-start'], [1, 2, 3]); assert.deepEqual(pages['c-insjoin'], [4]); assert.deepEqual(pages['c-laborpriv'], [5]);
  assert.ok(!(pages['c-start'] || []).includes(6), '쪽 앞부분에 없는 말은 안 셈');
  const st2 = L.checklistStatus(d.공사, [{ itemId: 'c-start', also: ['c-insjoin', 'c-laborpriv'] }], {});
  assert.ok(!st2.missing.some((x) => ['c-start', 'c-insjoin', 'c-laborpriv'].includes(x.id)));
});

test('계약 관련서류 세분화, 법인등기·인감증명서 계약일 기준 3개월 이내', () => {
  const d = L.defaultChecklists();
  const ids = d.공사.filter((x) => x.group === '계약').map((x) => x.id);
  assert.deepEqual(ids, ['c-contract', 'c-pledge', 'c-bizreg', 'c-corpreg', 'c-seal', 'c-useseal', 'c-license', 'c-licbook', 'c-estimate', 'c-calc', 'c-bank', 'c-related']);
  assert.ok(!d.공사.some((x) => x.group === '대금청구' && x.id === 'c-bank'), '통장사본은 계약 서류로');
  assert.equal(L.classifyItem(d.공사, '사업자등록증 사본.pdf', ''), 'c-bizreg');
  assert.equal(L.classifyItem(d.공사, '건설업등록증.pdf', ''), 'c-license');
  assert.equal(L.classifyItem(d.공사, '법인인감증명서.pdf', ''), 'c-seal');
  assert.equal(L.classifyItem(d.공사, '산출내역서.xlsx', ''), 'c-calc');
  assert.equal(L.classifyItem(d.공사, '견적서.pdf', ''), 'c-estimate');
  assert.equal(L.issuedTooEarly('20260301', '20260610'), true);
  assert.equal(L.issuedTooEarly('20260401', '20260610'), false);
});

test('계약번호 차수(-00/-01)는 같은 계약으로', () => {
  for (const n of ['R26TA0191434800', 'R26TA01914348-01', 'R26TA01914348', ' R26TA01914348-001 ']) assert.equal(L.baseNo(n), 'r26ta01914348');
  assert.equal(L.ordOf('R26TA0191434800'), 0); assert.equal(L.ordOf('R26TA01914348-01'), 1); assert.equal(L.ordOf('R26TA01914348'), null);
});

test('감독관 경유: 착공계·현장대리인계·예정공정표, 산출내역서, 견적서, 노무비 지급확인제, 준공계·준공검사원', () => {
  assert.deepEqual(L.viaParts('c-start'), ['착공계', '현장대리인계', '예정공정표']);
  assert.deepEqual(L.viaParts('s-start'), ['착수계(착공계)', '현장대리인계', '예정공정표']);
  assert.deepEqual(L.viaParts('c-finish'), ['준공계', '준공검사원']);
  for (const id of ['c-calc', 'c-estimate', 'c-laborconfirm', 's-calc', 's-estimate', 's-laborconfirm']) assert.deepEqual(L.viaParts(id), [''], id);
  assert.equal(L.viaParts('g-estimate'), null, '물품은 없음'); assert.equal(L.viaParts('c-photo'), null);
  const list = L.defaultChecklists().공사;
  const has = (id) => ['c-start', 'c-estimate', 'c-finish'].includes(id);
  const c = { via: { 'c-start:착공계': true, 'c-start:예정공정표': true, 'c-estimate': true } };
  const vs = L.viaStatus(c, list, has);
  assert.equal(vs.need, 6); assert.equal(vs.done, 3);
  assert.deepEqual(vs.missing, ['현장대리인계', '준공계', '준공검사원']);
  const m = L.vendorMail({ c: { name: '시험 공사' }, via: vs.missing });
  assert.match(m.body, /감독관 경유가 필요한 서류[\s\S]*- 현장대리인계: 감독관 경유\(확인\) 후 다시 제출/);
});
