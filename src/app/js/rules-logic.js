/* 규정·질문 답변: 법령(국가법령정보센터) 읽기, 규정집 조 단위로 나누기, 찾기, AI에 줄 질문 만들기 — 화면 없는 순수 로직 */
(function (root) {
  'use strict';

  // 우리 기관(지방공기업)이 적용받는 계약 관련 법령·예규 — 법령명은 국가법령정보센터 이름 그대로
  const DEFAULT_LAWS = [
    { name: '지방자치단체를 당사자로 하는 계약에 관한 법률', kind: 'law' },
    { name: '지방자치단체를 당사자로 하는 계약에 관한 법률 시행령', kind: 'law' },
    { name: '지방자치단체를 당사자로 하는 계약에 관한 법률 시행규칙', kind: 'law' },
    { name: '지방공기업법', kind: 'law' },
    { name: '지방공기업법 시행령', kind: 'law' },
    { name: '지방자치단체 입찰 및 계약 집행기준', kind: 'admrul' },
    { name: '지방자치단체 입찰시 낙찰자 결정기준', kind: 'admrul' },
    { name: '지방자치단체 공사계약 일반조건', kind: 'admrul' },
    { name: '지방자치단체 용역계약 일반조건', kind: 'admrul' },
    { name: '지방자치단체 물품구매계약 일반조건', kind: 'admrul' },
  ];
  const LAW_BASE = 'https://www.law.go.kr/DRF';
  const lawSearchUrl = (oc, name, kind) => `${LAW_BASE}/lawSearch.do?OC=${encodeURIComponent(oc)}&target=${kind === 'admrul' ? 'admrul' : 'law'}&type=JSON&display=20&query=${encodeURIComponent(name)}`;
  const lawServiceUrl = (oc, id, kind) => (kind === 'admrul'
    ? `${LAW_BASE}/lawService.do?OC=${encodeURIComponent(oc)}&target=admrul&type=JSON&ID=${encodeURIComponent(id)}`
    : `${LAW_BASE}/lawService.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&MST=${encodeURIComponent(id)}`);
  const squash = (s) => String(s || '').replace(/\s+/g, '');

  // 검색 결과에서 이름이 같은 것(현행) 하나 — 법령: 법령명한글·법령일련번호 / 행정규칙: 행정규칙명·행정규칙일련번호
  function pickLaw(json, name, kind) {
    const list = [];
    const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.법령명한글 || o.행정규칙명) list.push(o); else Object.values(o).forEach(walk); } };
    walk(json);
    const nm = (x) => x.법령명한글 || x.행정규칙명 || '';
    const id = (x) => (kind === 'admrul' ? x.행정규칙일련번호 || x.행정규칙ID : x.법령일련번호 || x.MST) || '';
    const cur = (x) => !/폐지|연혁/.test(String(x.현행연혁코드 || x.현행여부 || ''));
    const exact = list.filter((x) => squash(nm(x)) === squash(name));
    const best = exact.find(cur) || exact[0] || list.find((x) => squash(nm(x)).startsWith(squash(name)) && cur(x));
    return best ? { id: String(id(best)), name: nm(best), date: String(best.시행일자 || best.발령일자 || '') } : null;
  }
  // 본문 응답 → 글줄: '…내용'으로 끝나는 칸(조문내용·항내용·호내용·목내용, 행정규칙의 조문내용 배열)을 문서 순서대로
  function lawText(json) {
    const out = [];
    const walk = (o, key) => {
      if (typeof o === 'string') { if (/내용$/.test(key || '')) out.push(o); return; }
      if (Array.isArray(o)) { o.forEach((x) => walk(x, key)); return; }
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (/^(부칙|별표|개정문|제개정이유)/.test(k)) continue; walk(v, k); }
    };
    walk(json, '');
    return out.join('\n').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }

  // 글 → 조 단위 덩어리. "제12조(입찰참가자격)" 또는 "제12조의2" 머리로 나눔. 조가 없으면(지침·매뉴얼) 빈 줄·길이로 나눔
  const ARTICLE = /^\s*(제\s*\d+\s*조(?:\s*의\s*\d+)?)\s*(?:[(（]([^)）]{1,40})[)）])?/;
  function splitArticles(text, maxLen = 1800) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = []; let cur = null; let chapter = '';
    const push = () => { if (cur && cur.t.trim()) out.push({ h: cur.h, t: cur.t.trim() }); cur = null; };
    for (const ln of lines) {
      const ch = ln.match(/^\s*(제\s*\d+\s*(?:장|절)\s*\S.*)$/); if (ch && !ARTICLE.test(ln)) { chapter = ch[1].replace(/\s+/g, ' ').trim(); continue; }
      const m = ln.match(ARTICLE);
      if (m) { push(); cur = { h: `${m[1].replace(/\s+/g, '')}${m[2] ? `(${m[2].trim()})` : ''}`, t: ln.trim() + '\n', chapter }; continue; }
      if (!cur) cur = { h: chapter || '앞부분', t: '' };
      cur.t += ln.trim() + '\n';
      if (cur.t.length > maxLen) { const h = cur.h; push(); cur = { h: h + ' (이어서)', t: '' }; }
    }
    push();
    // 조가 하나도 없는 글: 빈 줄 단위로 묶어 나눔
    if (out.length <= 1 && String(text || '').length > maxLen) {
      const paras = String(text).split(/\n\s*\n/); const res = []; let buf = '';
      for (const p of paras) { if ((buf + p).length > maxLen && buf) { res.push(buf); buf = ''; } buf += p.trim() + '\n\n'; }
      if (buf.trim()) res.push(buf);
      return res.map((t, i) => ({ h: (t.trim().split('\n')[0] || '').slice(0, 30) || `${i + 1}번째`, t: t.trim() }));
    }
    return out;
  }

  // ---------- 찾기: 두 글자씩 끊어(띄어쓰기·조사에 덜 흔들림) 드문 말에 무게 ----------
  const grams = (s) => { const t = String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]+/g, ' ').trim(); const g = new Set(); for (const w of t.split(' ')) { if (w.length === 1) continue; for (let i = 0; i < w.length - 1; i++) g.add(w.slice(i, i + 2)); } return g; };
  const STOP = new Set(['하는', '있는', '경우', '어떻', '떻게', '되나', '나요', '인가', '해야', '합니', '니다', '입니', '대해', '관한', '에서', '으로', '에게', '하여', '그리', '리고', '것은', '것이', '수있', '있나', '가능', '능한', '한가', '업체', '계약']);
  function makeIndex(docs) {
    const df = new Map(); const items = docs.map((d) => { const g = grams(`${d.h || ''} ${d.t || ''}`); g.forEach((x) => df.set(x, (df.get(x) || 0) + 1)); return { d, g }; });
    return { items, df, n: items.length || 1 };
  }
  function search(index, query, k = 6) {
    const q = [...grams(query)].filter((x) => !STOP.has(x));
    if (!q.length) return [];
    const w = new Map(q.map((x) => [x, Math.log(1 + index.n / (1 + (index.df.get(x) || 0)))]));
    const tot = [...w.values()].reduce((a, b) => a + b, 0) || 1;
    return index.items.map(({ d, g }) => { let s = 0; for (const [x, wt] of w) if (g.has(x)) s += wt; return { d, score: s / tot }; })
      .filter((x) => x.score > 0.12).sort((a, b) => b.score - a.score).slice(0, k);
  }

  // ---------- AI에 줄 질문 ----------
  const SYSTEM = [
    '당신은 지방공기업(용인도시공사) 계약 담당자를 돕는 계약 업무 상담 보조입니다.',
    '아래 [근거]에 있는 법령·예규·우리 규정·이전 답변만 근거로 답합니다. 근거에 없는 조항 번호·금액·기한을 지어내지 않습니다.',
    '근거가 부족하면 "주어진 자료로는 판단하기 어렵다"고 말하고, 무엇을 더 확인해야 하는지 적습니다.',
    '우선순위: 우리 규정 > 이전에 저장한 답변(같은 상황이면 그대로 따름) > 예규 > 법령 시행규칙 > 시행령 > 법률 순으로 구체적인 것을 먼저 보되, 상위 법령과 어긋나면 상위 법령을 따릅니다.',
    '답 형식: 1) 결론 한두 문장 2) 이유와 근거(「법령명」 제○조처럼 [근거]에 있는 조항을 그대로 인용) 3) 업체·감독부서에 회신할 때 쓸 수 있는 짧은 문장. 한국어 공문체로 간결하게.',
  ].join('\n');
  function prompt(question, hits, qaHits) {
    const ref = hits.map((h, i) => `[${i + 1}] ${h.d.src} ${h.d.h}\n${String(h.d.t).slice(0, 1600)}`).join('\n\n');
    const prev = (qaHits || []).map((h, i) => `(이전 답변 ${i + 1}) 질문: ${h.d.q}\n답: ${String(h.d.a).slice(0, 1200)}`).join('\n\n');
    return `[질문]\n${question}\n\n[근거]\n${ref || '(찾은 조항 없음)'}${prev ? `\n\n[이전에 저장한 비슷한 질문과 답]\n${prev}` : ''}`;
  }

  const api = { DEFAULT_LAWS, LAW_BASE, lawSearchUrl, lawServiceUrl, pickLaw, lawText, splitArticles, grams, makeIndex, search, SYSTEM, prompt };
  root.JH = root.JH || {};
  root.JH.rulesLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
