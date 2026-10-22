// 지출 회차(선금·기성·노무비): 서류가 어느 회차로 가는지, 회차별 단계
const test = require('node:test');
const assert = require('node:assert');
const L = require('../../src/app/js/logic.js');

const list = L.defaultChecklists().공사;
const cls = list.concat(L.roundOnly('공사'));
const kind = (name) => L.classifyItem(cls, name, '');

test('기성·노무비·선금 서류 종류를 찾음(준공 서류와 헷갈리지 않음)', () => {
  assert.strictEqual(kind('제2회 기성검사조서.pdf'), 'c-proginsp');
  assert.strictEqual(kind('기성부분 검사조서(3회).pdf'), 'c-proginsp');
  assert.strictEqual(kind('준공검사조서.pdf'), 'c-inspect');
  assert.strictEqual(kind('준공검사원 지정통보.hwp'), 'c-notice');
  assert.strictEqual(kind('준공계.pdf'), 'c-finish');
  assert.strictEqual(kind('2회 기성계.pdf'), 'c-progfin');
  assert.strictEqual(kind('10월분 노무비 청구서.pdf'), 'c-laborclaim');
  assert.strictEqual(kind('선금 지급 신청서.pdf'), 'c-advclaim');
});

test('준공 목록에 준공검사원 지정통보(문서함)가 준공조서 앞에', () => {
  const ids = list.map((x) => x.id);
  assert.ok(ids.indexOf('c-notice') >= 0 && ids.indexOf('c-notice') < ids.indexOf('c-inspect'));
  assert.ok(!L.defaultChecklists().물품.some((x) => /-notice$/.test(x.id)));
});

test('회차 힌트: 기성 n회, 노무비 n월분, 준공은 마지막', () => {
  assert.deepStrictEqual(L.roundHint('제3회 기성금 청구서.pdf', ''), { kind: 'prog', n: 3 });
  assert.deepStrictEqual(L.roundHint('기성(2차) 세금계산서.pdf', ''), { kind: 'prog', n: 2 });
  assert.deepStrictEqual(L.roundHint('9월분 노무비 청구.pdf', ''), { kind: 'labor', month: 9 });
  assert.strictEqual(L.roundHint('준공금 청구서.pdf', '').kind, 'final');
  assert.strictEqual(L.roundHint('대금청구서.pdf', '').kind, undefined);
});

test('서류 → 회차: 회차 서류는 늘 회차로, 청구 서류는 힌트 없으면 열린 첫 회차(없으면 준공)', () => {
  assert.deepStrictEqual(L.routeRound('공사', 'c-proginsp', '기성검사조서.pdf', '', []), { kind: 'prog', n: undefined, month: undefined, itemId: 'c-proginsp' });
  assert.strictEqual(L.routeRound('공사', 'c-finish', '2회 기성검사원.pdf', '', []).itemId, 'c-progfin'); // 준공계 칸으로 찾았어도 기성이면 기성계
  assert.strictEqual(L.routeRound('공사', 'c-notice', '1회 기성 검사원 지정통보.hwp', '', []).itemId, 'c-prognotice');
  assert.strictEqual(L.routeRound('공사', 'c-claim', '대금청구서.pdf', '', []), null);
  const open = [{ id: 'r1', kind: 'prog', n: 2 }];
  assert.strictEqual(L.routeRound('공사', 'c-tax', '국세 납세증명서.pdf', '', open).id, 'r1');
  assert.strictEqual(L.routeRound('공사', 'c-claim', '준공금 청구서.pdf', '', open), null);
  assert.strictEqual(L.routeRound('공사', 'c-contract', '계약서.pdf', '', open), null); // 계약 서류는 회차와 상관없음
  assert.strictEqual(L.routeRound('물품', 'g-claim', '기성 청구서.pdf', '', open), null); // 물품은 회차 없음
});

test('기성 회차 단계: 기성계(경유) → 지정통보 → 검사조서 → 청구 서류 → 지출결의', () => {
  const st = L.roundSteps('prog', '공사', list);
  assert.deepStrictEqual(st.map((g) => g.name), ['기성계 제출(감독관 경유)', '기성검사원 지정통보', '기성부분 검사조서', '청구 서류', '지출결의']);
  assert.ok(st[3].items.some((x) => x.id === 'c-claim') && st[3].items.some((x) => x.id === 'c-invoice'));
  assert.strictEqual(L.roundSteps('labor', '용역', L.defaultChecklists().용역)[0].items[0].id, 's-laborclaim');
  assert.ok(L.roundSteps('adv', '공사', list)[0].items.find((x) => x.id === 'c-advbond').link);
  assert.strictEqual(L.roundLabel({ kind: 'prog', n: 2 }), '2차 기성');
  assert.strictEqual(L.roundLabel({ kind: 'labor', month: 10 }), '노무비 10월분');
});

test('스캔본(noname.pdf): 이름에 회차가 없으면 읽은 글자에서 "제4회 기성"을 찾음', () => {
  assert.strictEqual(L.routeRound('공사', 'c-progfin', 'noname(2).pdf', '기성계', [], '공사명시청사옥상방수공사제4회기성부분검사원').n, 4);
  assert.strictEqual(L.roundHint('noname.pdf', '준공계', '제2회기성').kind, 'final'); // 준공 서류 본문의 '기성'에 흔들리지 않음
});

test('계약 찾기: 나라장터 업체 사업자등록번호가 서류에 있으면 그 업체 계약 점수', () => {
  const a = { name: '시청사 옥상 방수공사', vendor: '(주)다해토건', bizno: '123-45-67890', nums: [] };
  const b = { name: '체육관 시설 청소 용역', vendor: '한빛환경', bizno: '222-33-44444', nums: [] };
  const hay = L.norm('사업자등록증 등록번호 123-45-67890 상호 다해토건');
  assert.ok(L.contractScore(a, hay) > L.contractScore(b, hay));
  assert.strictEqual(L.matchContract([a, b], hay), a);
  // 같은 업체 계약이 둘이면 동점 → 하나로 정하지 않음(미분류)
  assert.strictEqual(L.matchContract([a, { ...a, name: '도서관 외벽 보수공사' }], hay), null);
  const d = L.defaultChecklists(); const all = [...d.공사, ...d.용역];
  assert.strictEqual(L.classifyItem(all, 'scan.pdf', L.norm('지방세 납세증명(신청)서 납세자')), 'c-ltax');
  assert.strictEqual(L.classifyItem(all, 'scan.pdf', L.norm('납세증명서 발급번호')), 'c-tax');
  assert.strictEqual(L.classifyItem(all, 'scan.pdf', L.norm('4대보험 사업장 가입내역 확인서')), 'c-insjoin');
});

test('배우기: 헷갈림 판단, 고른 답을 제목으로 배워 다음부터 그 서류(다른 구분 계약에도), 계약명 줄·여러 서류 묶음 이름은 배우지 않음', () => {
  const c = L.defaultChecklists().공사, s = L.defaultChecklists().용역;
  assert.deepStrictEqual(L.classifyInfo(c, 'scan.pdf', L.norm('계약서 사본 제출 확약서')).alts, ['c-related']);
  assert.deepStrictEqual(L.classifyInfo(c, 'scan.pdf', L.norm('국세 납세증명서')).alts, []);
  const d = { name: '도시공사 준공보완서류 소1-69호.pdf', heads: L.headLines(['시청사 옥상 방수공사', '안전점검 결과 확인서', '2026.10.20']) };
  const sig = L.learnSigs(d, { name: '시청사 옥상 방수공사', vendor: '(주)다해토건' });
  assert.deepStrictEqual(sig, { heads: ['안전점검결과확인서'], name: '' });
  const rules = [{ head: '안전점검결과확인서', suf: 'related' }];
  assert.strictEqual(L.learnedItem(rules, s, 'x.hwp', ['안전점검결과확인서']).id, 's-related');
  assert.strictEqual(L.learnedItem(rules, c, 'x.hwp', ['다른제목']), null);
});
