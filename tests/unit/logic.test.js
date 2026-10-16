// 순수 로직 단위 시험: node --test tests/unit/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/app/js/logic.js');

const lists = L.defaultChecklists();
const cls = (name, title, type = '공사') => L.classifyItem(lists[type], name, title ? L.norm(title) : '');

test('파일명으로 서류 종류 분류(가장 긴 단어 우선)', () => {
  assert.equal(cls('계약서.pdf'), 'c-contract');
  assert.equal(cls('견적서_산출내역.pdf'), 'c-estimate');
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
