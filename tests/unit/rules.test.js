// 규정·질문 답변 로직
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../src/app/js/rules-logic.js');

test('법령 검색·본문 읽기(국가법령정보센터 응답 모양)', () => {
  const sr = { LawSearch: { law: [{ 법령명한글: '지방자치단체를 당사자로 하는 계약에 관한 법률 시행령', 법령일련번호: '111', 현행연혁코드: '현행' }, { 법령명한글: '지방자치단체를 당사자로 하는 계약에 관한 법률', 법령일련번호: '222', 현행연혁코드: '현행', 시행일자: '20260101' }] } };
  assert.deepEqual(R.pickLaw(sr, '지방자치단체를 당사자로 하는 계약에 관한 법률', 'law'), { id: '222', name: '지방자치단체를 당사자로 하는 계약에 관한 법률', date: '20260101' });
  const ar = { AdmRulSearch: { admrul: [{ 행정규칙명: '지방자치단체 입찰 및 계약 집행기준', 행정규칙일련번호: '333' }] } };
  assert.equal(R.pickLaw(ar, '지방자치단체 입찰 및 계약 집행기준', 'admrul').id, '333');
  const body = { 법령: { 기본정보: { 법령명_한글: 'x' }, 조문: { 조문단위: [
    { 조문번호: '9', 조문내용: '제9조(계약의 방법) 지방자치단체의 장은 계약을 체결하려는 경우에는 일반입찰에 부쳐야 한다.', 항: [{ 항내용: '① 다만, 다음 각 호의 경우에는 수의계약을 할 수 있다.', 호: [{ 호내용: '1. 추정가격이 2천만원 이하인 경우' }] }] },
    { 조문번호: '10', 조문내용: '제10조(입찰참가자격) 입찰참가자격은 ...' }] }, 부칙: { 부칙내용: '부칙 내용은 뺌' } } };
  const t = R.lawText(body);
  assert.match(t, /제9조\(계약의 방법\)[\s\S]*① 다만[\s\S]*1\. 추정가격이 2천만원 이하/); assert.doesNotMatch(t, /부칙 내용/);
  const ch = R.splitArticles(t);
  assert.deepEqual(ch.map((c) => c.h), ['제9조(계약의 방법)', '제10조(입찰참가자격)']);
  assert.match(R.lawSearchUrl('me', '지방공기업법', 'law'), /^https:\/\/www\.law\.go\.kr\/DRF\/lawSearch\.do\?OC=me&target=law&type=JSON/);
  assert.match(R.lawServiceUrl('me', '333', 'admrul'), /target=admrul&type=JSON&ID=333/);
});

test('규정집 조 단위 나누기·찾기·질문 만들기', () => {
  const text = '제1장 총칙\n제1조(목적) 이 규정은 계약 사무를 정한다.\n제15조(선금 지급) ① 계약금액의 100분의 70 범위에서 선금을 줄 수 있다.\n② 선금을 받는 자는 보증서를 내야 한다.\n제15조의2(선금 정산) 기성금에서 정산한다.';
  const ch = R.splitArticles(text);
  assert.deepEqual(ch.map((c) => c.h), ['제1조(목적)', '제15조(선금 지급)', '제15조의2(선금 정산)']);
  const idx = R.makeIndex([...ch.map((c) => ({ ...c, src: '계약규정' })), { h: '제9조(계약의 방법)', t: '수의계약 추정가격 2천만원 이하', src: '지방계약법 시행령' }]);
  const hits = R.search(idx, '선금은 계약금액의 몇 퍼센트까지 줄 수 있나요?');
  assert.equal(hits[0].d.h, '제15조(선금 지급)');
  assert.equal(R.search(idx, '수의계약 금액 기준')[0].d.src, '지방계약법 시행령');
  assert.deepEqual(R.search(idx, '어떻게 하나요'), [], '뜻 없는 말만 있으면 찾지 않음');
  const p = R.prompt('선금 비율?', hits.slice(0, 1), [{ d: { q: '선금 몇 %?', a: '70%까지' } }]);
  assert.match(p, /\[근거\]\n\[1\] 계약규정 제15조\(선금 지급\)/); assert.match(p, /이전 답변 1\) 질문: 선금 몇 %\?/);
  assert.match(R.SYSTEM, /지어내지 않습니다/);
});
