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
  assert.strictEqual(L.roundLabel({ kind: 'prog', n: 2 }), '2회 기성');
  assert.strictEqual(L.roundLabel({ kind: 'labor', month: 10 }), '10월분 노무비');
});

test('스캔본(noname.pdf): 이름에 회차가 없으면 읽은 글자에서 "제4회 기성"을 찾음', () => {
  assert.strictEqual(L.routeRound('공사', 'c-progfin', 'noname(2).pdf', '기성계', [], '공사명시청사옥상방수공사제4회기성부분검사원').n, 4);
  assert.strictEqual(L.roundHint('noname.pdf', '준공계', '제2회기성').kind, 'final'); // 준공 서류 본문의 '기성'에 흔들리지 않음
});
