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
  for (const n of ['공사 노무비 구분관리 및 지급확인 적용제외 신청서', '4대 사회보험 가입증명서', '고용·산재 가입증명원', '준공사진대지', '하자보수 이행보증금 지급각서', '국세 납세증명서', '세금계산서'])
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
  assert.deepEqual(L.viaParts('c-finish'), ['준공계']);
  assert.deepEqual(L.viaParts('c-finishreq'), ['']);
  for (const id of ['c-calc', 'c-estimate', 'c-laborconfirm', 's-calc', 's-estimate', 's-laborconfirm']) assert.deepEqual(L.viaParts(id), [''], id);
  assert.equal(L.viaParts('g-estimate'), null, '물품은 없음'); assert.equal(L.viaParts('c-photo'), null);
  const list = L.defaultChecklists().공사;
  const has = (id) => ['c-start', 'c-estimate', 'c-finish', 'c-finishreq'].includes(id);
  const c = { via: { 'c-start:착공계': true, 'c-start:예정공정표': true, 'c-estimate': true } };
  const vs = L.viaStatus(c, list, has);
  assert.equal(vs.need, 6); assert.equal(vs.done, 3);
  assert.deepEqual(vs.missing, ['현장대리인계', '준공계', '준공검사원']);
  const m = L.vendorMail({ c: { name: '시험 공사' }, via: vs.missing });
  assert.match(m.body, /감독관 경유가 필요한 서류[\s\S]*- 현장대리인계: 감독관 경유\(확인\) 후 다시 제출/);
});

test('선금 보증서: 보증기간 읽기, 준공일 + 60일 이상이면 유효', () => {
  const d = L.extractDates(['선급금 이행보증증권', '보증기간 2026년 06월 01일 부터', '2027년 01월 31일 까지', '발행일 2026.05.30']);
  assert.equal(d.bondEnd, '20270131');
  assert.equal(L.extractDates(['보증기간: 2026.06.01 ~ 2026.11.30']).bondEnd, '20261130');
  assert.deepEqual(L.advBondCheck('20270131', '2026-11-30'), { status: 'ok', days: 62, end: '20270131', need: '20270129' });
  assert.equal(L.advBondCheck('20261230', '2026-11-30').status, 'short', '30일만 남음 → 유효하지 않음');
  assert.equal(L.advBondCheck('20270129', '20261130').status, 'ok', '딱 60일');
  assert.equal(L.advBondCheck('', '20261130').status, 'unknown');
  const list = L.defaultChecklists();
  assert.equal(L.classifyItem(list.공사, '선급금이행보증증권.pdf', ''), 'c-advbond');
  assert.equal(L.classifyItem(list.용역, '선금보증서_한빛.pdf', ''), 's-advbond');
  const ids = list.공사.map((x) => x.id); assert.ok(ids.indexOf('c-dmgins') < ids.indexOf('c-advbond') && ids.indexOf('c-advbond') < ids.indexOf('c-finish'), '착공계와 준공계 사이');
});

test('동료와 나누는 배운 말: 서류 종류 제목만, 계약·업체·사람·번호가 섞이면 이 PC에만', () => {
  const names = ['시청사 옥상 방수공사', '(주)한빛건설', '김담당', '시설관리팀'];
  assert.equal(L.shareSafe('4대보험 사업장 가입내역 확인서', names), false); // 숫자
  assert.equal(L.shareSafe('사업장 가입내역 확인서', names), true);
  assert.equal(L.shareSafe('안전점검 결과 확인서', names), true);
  assert.equal(L.shareSafe('한빛건설 안전점검 결과', names), false); // 업체명
  assert.equal(L.shareSafe('시청사 옥상 방수공사 준공검사', names), false); // 계약명
  assert.equal(L.shareSafe('김담당 확인 요청서', names), false); // 담당자
  assert.equal(L.shareSafe('주식회사 대한 납품서', names), false); // 회사 표시
  assert.equal(L.shareSafe('대표자 성명 확인', names), false);
  assert.equal(L.shareSafe('홍길동', names), false); // 짧은 말(사람 이름일 수 있음)
});

test('구매요구 안전보건 서류(공사·용역): 산업안전재해율 결과·안전보건관리계획서·적격수급업체 안전보건 수준 평가표', () => {
  const d = L.defaultChecklists();
  for (const t of ['공사', '용역']) {
    const list = d[t], name = (f, title = '') => (list.find((x) => x.id === L.classifyItem(list, f, title)) || {}).name;
    assert.equal(name('스캔001.pdf', L.norm('사업장 산업재해율 조회 결과')), '사업장 산업안전재해율 결과');
    assert.equal(name('안전보건관리계획서(최종).hwp'), '안전보건관리계획서');
    assert.equal(name('평가표.pdf', L.norm('적격 수급업체 안전보건 수준 평가표')), '적격수급업체 안전보건 수준 평가표');
    assert.ok(list.filter((x) => x.group === '구매요구').length === 4);
  }
  assert.equal(d.물품.filter((x) => x.group === '구매요구').length, 1, '물품에는 없음');
});

test('쪽별로 나누기 안: 제목 쪽부터 다음 제목 앞까지, 제목 없는 쪽은 앞 서류, 겹침·빠짐 알림', () => {
  assert.deepEqual(L.splitPlan({ a: [1], b: [3], c: [5], d: [6] }, 6), [{ from: 1, to: 2, item: 'a' }, { from: 3, to: 4, item: 'b' }, { from: 5, to: 5, item: 'c' }, { from: 6, to: 6, item: 'd' }]);
  assert.deepEqual(L.splitPlan({ a: [2, 3], b: [5] }, 6), [{ from: 1, to: 1, item: null }, { from: 2, to: 4, item: 'a' }, { from: 5, to: 6, item: 'b' }]);
  assert.deepEqual(L.splitPlan({}, 3), [{ from: 1, to: 3, item: null }]);
  assert.equal(L.checkSplit([{ from: 1, to: 2 }, { from: 3, to: 6 }], 6), '');
  assert.match(L.checkSplit([{ from: 1, to: 3 }, { from: 3, to: 6 }], 6), /겹칩니다/);
  assert.match(L.checkSplit([{ from: 1, to: 2 }, { from: 4, to: 6 }], 6), /빠진 쪽.*3쪽/);
});

test('요청 메일: 빠진 서류마다 발급·유효 조건(3개월 이내, 지급 예정일 이후 유효, 보증기간)', () => {
  const d = L.defaultChecklists().공사, by = (id) => d.find((x) => x.id === id);
  const c = { name: '시청사 옥상 방수공사', contractDate: '20260901', endDate: '20261130' };
  assert.match(L.issueCond(by('c-corpreg'), c), /계약일\(2026\.09\.01\) 기준 3개월 이내 발급분/);
  assert.match(L.issueCond(by('c-seal'), c), /3개월 이내/);
  assert.match(L.issueCond(by('c-inspaid'), c, '20261214'), /2026\.12\.14\) 이후까지 유효/);
  assert.match(L.issueCond(by('c-advbond'), c), /2027\.01\.29 이후\(준공일 \+ 60일 이상\)/);
  assert.match(L.issueCond(by('c-empjoin'), c), /공사명·공사기간·계약금액 필수|공사명/);
  assert.match(L.issueCond(by('c-defectbond'), c), /하자담보책임기간/);
  assert.equal(L.issueCond(by('c-bizreg'), c), '');
  const m = L.vendorMail({ c, org: '용인도시공사', officer: '담당', missing: [{ name: '법인등기사항증명서', cond: L.issueCond(by('c-corpreg'), c) }, '통장사본'], basis: {} });
  assert.match(m.body, /- 법인등기사항증명서 \(계약일\(2026\.09\.01\) 기준 3개월 이내 발급분/);
  assert.match(m.body, /- 통장사본\n/);
});

test('계약명으로 쓸 만한지: 스캔 글자가 깨진 이름은 새 계약을 만들지 않음', () => {
  assert.equal(L.goodName(".,'(신갈동 40-36)석명하체 및. ㅓ리용역 _ _. ㅗ ㄱㄱ 기시,"), false);
  assert.equal(L.goodName('석명하체 및. 리용역 _ 기시'), false);
  assert.equal(L.goodName('noname(3)'), false);
  for (const ok of ['시청사 옥상 방수공사', '(신갈동 40-36) 석면 해체·처리 용역', '2026년 용인시 공공시설물 LED 교체공사(2차)']) assert.equal(L.goodName(ok), true, ok);
  assert.equal(L.isG2bNo('R26BK01234567-00'), true);
  assert.equal(L.isG2bNo('2026-087'), false);
});

test('노무비 구분관리 및 지급확인제 합의서·적용 제외 신청서 → 한 칸', () => {
  const list = L.defaultChecklists().공사, name = (f, t = '') => (list.find((x) => x.id === L.classifyItem(list, f, L.norm(t))) || {}).name;
  const want = '공사 노무비 구분관리 및 지급확인 적용제외 신청서';
  assert.equal(name('노무비 구분관리 및 지급확인제 합의서.pdf'), want);
  assert.equal(name('스캔01.pdf', '공사 노무비 구분관리 및 지급 확인 적용 제외 신청서'), want);
  assert.equal(name('스캔02.pdf', '노무비 구분관리 및 지급확인제 합의서'), want);
  assert.equal(name('사대보험 가입자명부.pdf'), '4대 사회보험 가입자명부');
  assert.equal(name('고용산재가입증명원.pdf'), '고용·산재 가입증명원');
});

test('계약명 끝까지 확인: …조성공사 감리용역 서류는 공사 계약이 아님, 차수·공구가 다르면 다른 계약', () => {
  const A = { key: 'a', name: '용인 평온의숲 봉안담 신규 조성공사', vendor: '(주)대한건설' };
  const B = { key: 'b', name: '용인 평온의숲 봉안담 신규 조성공사 감리용역', vendor: '(주)한국감리' };
  const hay = (t) => '준공계|' + L.norm(t);
  const sup = hay('준공계 용역명 : 용인 평온의숲 봉안담 신규 조성 공사 감리용역 계약상대자 (주)한국감리');
  const con = hay('준공계 공사명 : 용인 평온의숲 봉안담 신규 조성공사 시공자 (주)대한건설');
  assert.equal(L.matchContract([A, B], sup).key, 'b');
  assert.equal(L.matchContract([A, B], con).key, 'a');
  assert.equal(L.matchContract([A], sup), null, '목록에 감리용역이 없으면 공사로 보내지 않음(미분류)');
  assert.equal(L.matchContract([A], hay('공사명 : 용인 평온의숲 봉안담 신규 조성공사(2차)')), null);
  assert.equal(L.matchContract([A], hay('공사명 : 용인 평온의숲 봉안담 신규 조성공사 준공계')).key, 'a');
});

test('준공계·준공검사원 두 칸, 지정통보는 필수 아님', () => {
  for (const t of ['공사', '용역']) {
    const list = L.defaultChecklists()[t], name = (f) => (list.find((x) => x.id === L.classifyItem(list, f, '')) || {}).name;
    assert.equal(name('준공계.pdf'), '준공계');
    assert.equal(name('준공검사원.pdf'), '준공검사원');
    assert.equal(name('준공검사 요청서.pdf'), '준공검사원');
    assert.equal(name('준공검사원 지정통보.pdf'), '준공검사원 지정통보');
    assert.equal(list.find((x) => /-notice$/.test(x.id)).required, false);
  }
});

test('면허 등록증·등록수첩·통장사본: 파일 이름·제목(통장 글자가 없는 통장 표지도)', () => {
  const list = L.defaultChecklists().공사, name = (f, t = '') => (list.find((x) => x.id === L.classifyInfo(list, f, L.norm(t)).id) || {}).name;
  assert.equal(name('스캔.pdf', '전기공사업 등록증'), '면허 등록증 사본');
  assert.equal(name('스캔.pdf', '건설업 등록수첩'), '면허 등록수첩 사본');
  assert.equal(name('통장 사본.jpg'), '통장사본');
  assert.equal(name('스캔.pdf', '입출금이 자유로운 예금 기업은행 예금주'), '통장사본');
  assert.equal(name('계좌사본.pdf'), '통장사본');
  assert.equal(name('스캔.pdf', '엔지니어링사업자 신고증'), '면허 등록증 사본');
  assert.equal(name('스캔.pdf', '사업자등록증 등록번호 123-45-67890'), '사업자등록증 사본');
});

test('변경 구분: 기간변경·설계변경·둘 다·준공정산·기타·해당 없음', () => {
  assert.equal(L.CHG_KINDS.ext, '기간변경');
  assert.equal(L.CHG_KINDS.both, '둘 다(기간변경+설계변경)');
  assert.equal(L.CHG_KINDS.settle, '준공정산');
  const rows = [{ no: 'a', first: true }, { no: 'b', amount: 90, prevAmount: 100, end: '20261130', prevEnd: '20261130', auto: 'design' }, { no: 'c', amount: 90, prevAmount: 90, end: '20261231', prevEnd: '20261130', auto: 'ext' }];
  const p = L.chgPlan(rows, { b: 'settle', c: 'etc' });
  assert.deepEqual(p.design.map((r) => [r.no, r.kind]), [['b', 'settle']]);
  assert.deepEqual(p.ext.map((r) => [r.no, r.kind]), [['c', 'etc']], '기타는 실제로 바뀐 준공일 쪽');
  assert.equal(L.chgPlan(rows, { b: 'none', c: 'none' }).design.length + L.chgPlan(rows, { b: 'none', c: 'none' }).ext.length, 0);
});

test('저장하는 서류 글자에서 주민등록번호·휴대전화·카드번호 가림(사업자번호·계약번호는 그대로)', () => {
  const t = L.maskPrivate('대표자 홍길동 800101-1234567 연락처 010-1234-5678 사업자등록번호 123-45-67890 계약번호 R26BK01234567-00 카드 1234-5678-9012-3456');
  assert.ok(!/1234567(?!\d)/.test(t.replace('R26BK01234567', '')), t);
  assert.match(t, /800101-\*{7}/); assert.match(t, /010-\*{4}-5678/); assert.match(t, /123-45-67890/); assert.match(t, /R26BK01234567-00/); assert.match(t, /1234-\*{4}-\*{4}-3456/);
  assert.match(L.maskPrivate(L.norm('주민번호 8001011234567')), /800101\*{7}/);
});

test('노무비 서류: 파일 이름·제목으로 각 칸', () => {
  const d = L.defaultChecklists();
  for (const t of ['공사', '용역']) {
    const k = t === '공사' ? 'c' : 's';
    const want = { '노무비 구분관리 및 지급확인제 합의서.pdf': 'laborconfirm', '공사 노무비 구분관리 및 지급 확인 적용 제외 신청서.pdf': 'laborconfirm', '노무비 개인정보 이용 동의서.pdf': 'laborpriv',
      '노무비 미체불 확약서.pdf': 'nounpaid', '노무비 지급명세서.pdf': 'laborlist', '노무비 지급내역서.pdf': 'laborlist' };
    for (const [n, suf] of Object.entries(want)) assert.equal(L.classifyItem(d[t], n, ''), `${k}-${suf}`, `${t} ${n}`);
    assert.equal(L.classifyItem(d[t], 'scan001.pdf', L.norm('노 무 비 구 분 관 리 및 지 급 확 인 제 합 의 서')), `${k}-laborconfirm`);
  }
});

test('계좌·여권·운전면허 번호·전자우편도 가림(띄어쓰기를 지운 글자에서도)', () => {
  for (const raw of ['예금주 홍길동 농협 302-1234-5678-91', '통장사본 국민은행 123456-01-234567', '여권번호 M12345678', '운전면허번호 11-23-456789-01', '이메일 hong.gd@naver.com']) {
    for (const t of [L.maskPrivate(raw), L.maskPrivate(L.norm(raw))]) {
      assert.ok(!/1234-5678-91|12345601234567|234567(?!\d)|12345678|456789|hong\.?gd/i.test(t), raw + ' → ' + t);
    }
  }
  assert.match(L.maskPrivate('계약금액 금18,364,000원 사업자등록번호 123-45-67890'), /18,364,000원.*123-45-67890/, '금액·사업자번호는 그대로');
  assert.ok(L.headLines(['주민등록번호 800101-1234567 홍길동']).every((h) => !/1234567/.test(h)), '머리 줄도 가림');
});
