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
    // 공사·용역·물품 계약 일반조건은 따로 있는 예규가 아니라 「입찰 및 계약 집행기준」 안의 장(계약 일반조건)으로 들어 있음
    // 공종·업무별 — 업종 등록·하도급·안전·폐기물·노무 질문에 씀
    { name: '건설산업기본법', kind: 'law' },
    { name: '건설산업기본법 시행령', kind: 'law' },
    { name: '건설기술 진흥법', kind: 'law' },
    { name: '전기공사업법', kind: 'law' },
    { name: '정보통신공사업법', kind: 'law' },
    { name: '소방시설공사업법', kind: 'law' },
    { name: '폐기물관리법', kind: 'law' },
    { name: '건설폐기물의 재활용촉진에 관한 법률', kind: 'law' },
    { name: '엔지니어링산업 진흥법', kind: 'law' },
    { name: '하도급거래 공정화에 관한 법률', kind: 'law' },
    { name: '산업안전보건법', kind: 'law' },
    { name: '중소기업제품 구매촉진 및 판로지원에 관한 법률', kind: 'law' },
    { name: '건설근로자의 고용개선 등에 관한 법률', kind: 'law' },
  ];
  const LAW_BASE = 'https://www.law.go.kr/DRF';
  const lawSearchUrl = (oc, name, kind) => `${LAW_BASE}/lawSearch.do?OC=${encodeURIComponent(oc)}&target=${kind === 'admrul' ? 'admrul' : 'law'}&type=JSON&display=20&query=${encodeURIComponent(name)}`;
  const lawServiceUrl = (oc, id, kind) => (kind === 'admrul'
    ? `${LAW_BASE}/lawService.do?OC=${encodeURIComponent(oc)}&target=admrul&type=JSON&ID=${encodeURIComponent(id)}`
    : `${LAW_BASE}/lawService.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&MST=${encodeURIComponent(id)}`);
  const squash = (s) => String(s || '').replace(/\s+/g, '');

  // 국가법령정보센터 오류 응답({ result, msg }) → 알기 쉬운 말. 등록 안 된 IP에서 부르면 "사용자 정보 검증에 실패"
  function lawError(json) {
    if (!json || typeof json !== 'object' || !json.result || json.LawSearch || json.AdmRulSearch || json.법령) return '';
    const t = `${json.result} ${json.msg || ''}`;
    if (/IP|도메인|검증/.test(t)) return '국가법령정보센터가 이 PC의 인터넷 주소(IP)를 모릅니다. open.law.go.kr → 마이페이지 → OPEN API 신청 내역 → [수정] → 서버장비의 IP주소에 이 PC의 IP를 [추가]하세요(규정·질문 답변 화면 위쪽에 IP와 순서가 나옵니다).';
    return String(t).trim();
  }
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
  //  withAppendix: 조문 형식이 아닌 예규(집행기준 등)는 본문이 별표에 들어 있어 별표내용도 넣음
  function lawText(json, withAppendix) {
    const out = [];
    const skip = withAppendix ? /^(부칙|개정문|제개정이유)/ : /^(부칙|별표|개정문|제개정이유)/;
    const walk = (o, key) => {
      if (typeof o === 'string') { if (/내용$/.test(key || '')) out.push(o); return; }
      if (Array.isArray(o)) { o.forEach((x) => walk(x, key)); return; }
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (skip.test(k)) continue; walk(v, k); }
    };
    walk(json, '');
    return out.join('\n').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }

  // 본문이 첨부파일(PDF·한글)로만 있는 예규: 응답에서 파일 이름·링크를 모음(PDF 먼저). 링크는 http로 올 때가 있어 https로
  function lawFiles(json) {
    const out = [], seen = new Set();
    const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
    const walk = (o) => {
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if (/링크$/.test(k)) {
          const links = arr(v).map(String), names = arr(o[k.replace(/링크$/, '명')] || o['첨부파일명'] || o['별표제목']).map(String);
          links.forEach((u, i) => {
            if (!/^https?:\/\//i.test(u) && !/^\//.test(u)) return;
            const url = (/^\//.test(u) ? 'https://www.law.go.kr' + u : u).replace(/^http:\/\//i, 'https://');
            if (seen.has(url)) return; seen.add(url);
            const name = names[i] || names[0] || '';
            const pdf = /PDF/i.test(k) || /\.pdf$/i.test(name) || /\.pdf(\?|$)/i.test(url);
            out.push({ url, name, kind: pdf ? 'pdf' : /\.(hwpx?|hwp)$/i.test(name) || /hwp/i.test(url) ? 'hwp' : /서식파일링크$/.test(k) ? 'hwp' : 'unknown' });
          });
        } else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(json);
    const rank = { pdf: 0, hwp: 1, unknown: 2 };
    return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
  }

  // 글 → 조 단위 덩어리. "제12조(입찰참가자격)" 또는 "제12조의2" 머리로 나눔. 조가 없으면(지침·매뉴얼) 빈 줄·길이로 나눔
  const ARTICLE = /^\s*(제\s*\d+\s*조(?:\s*의\s*\d+)?)\s*(?:[(（]([^)）]{1,40})[)）])?/;
  function splitArticles(text, maxLen = 1800) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = []; let cur = null; let chapter = '';
    // 장·절 머리 한 줄뿐인 덩어리는 버림(바로 아래 절·조에 머리가 붙음)
    const push = () => { if (cur && cur.t.trim() && !(cur.t.trim().split('\n').length === 1 && /^제\s*\d+\s*(장|절)/.test(cur.t.trim()))) out.push({ h: cur.h, t: cur.t.trim() }); cur = null; };
    for (const ln of lines) {
      // 장·절 머리: 조문이 없는 예규(집행기준·일반조건)는 장·절마다 새 덩어리로 — 찾은 근거에 '제13장 공사계약 일반조건'처럼 나옴
      const ch = ln.match(/^\s*(제\s*\d+\s*(?:장|절)\s*\S.*)$/);
      if (ch && !ARTICLE.test(ln)) {
        const head = ch[1].replace(/\s+/g, ' ').trim().slice(0, 40);
        if (/장/.test(head.slice(0, 6))) chapter = head; else chapter = (chapter.split(' > ')[0] || '') + (chapter ? ' > ' : '') + head;
        if (!cur || !cur.art) { push(); cur = { h: chapter, t: ln.trim() + '\n' }; }
        continue;
      }
      const m = ln.match(ARTICLE);
      if (m) { push(); cur = { h: `${m[1].replace(/\s+/g, '')}${m[2] ? `(${m[2].trim()})` : ''}`, t: ln.trim() + '\n', chapter, art: true }; continue; }
      if (!cur) cur = { h: chapter || '앞부분', t: '' };
      cur.t += ln.trim() + '\n';
      if (cur.t.length > maxLen) { const h = cur.h.replace(/ \(이어서\)$/, ''); const art = cur.art; push(); cur = { h: h + ' (이어서)', t: '', art }; }
    }
    push();
    // 조도 장도 없는 글: 빈 줄 단위로 묶어 나눔
    if (out.length <= 1 && String(text || '').length > maxLen) {
      const paras = String(text).split(/\n\s*\n/); const res = []; let buf = '';
      for (const p of paras) { if ((buf + p).length > maxLen && buf) { res.push(buf); buf = ''; } buf += p.trim() + '\n\n'; }
      if (buf.trim()) res.push(buf);
      return res.map((t, i) => ({ h: (t.trim().split('\n')[0] || '').slice(0, 30) || `${i + 1}번째`, t: t.trim() }));
    }
    return out;
  }

  // 규정 글에서 가장 늦은 개정·시행 날짜: '<개정 2025. 3. 4.>', '개정 2025.03.04', '(2025.3.4. 일부개정)', '[시행 2026. 1. 1.]' → 'YYYYMMDD'
  function revDate(text) {
    const t = String(text || ''); let best = '';
    const take = (y, m, d) => { const v = `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`; if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31 && v > best) best = v; };
    const D = '(20\\d{2})\\s*[.\\-\\/년]\\s*(\\d{1,2})\\s*[.\\-\\/월]\\s*(\\d{1,2})';
    for (const m of t.matchAll(new RegExp('(?:개정|시행|제정)[^0-9\\n]{0,6}' + D, 'g'))) take(m[1], m[2], m[3]);
    for (const m of t.matchAll(new RegExp(D + '\\s*[.일]?\\s*[)\\]>〉]?\\s*(?:일부|전부)?\\s*(?:개정|시행|제정)', 'g'))) take(m[1], m[2], m[3]);
    return best;
  }

  // ---------- 규정 개정분 반영: 바뀐 조만 올리면 같은 조 번호를 바꿔 끼움 ----------
  // '제12조의2(입찰보증금)' → '12-2'. '삭제'만 있는 조는 지움, 없던 조는 번호 순서 자리에 넣음
  const artKey = (h) => { const m = String(h || '').match(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/); return m ? m[1] + (m[2] ? '-' + m[2] : '') : null; };
  const keyNum = (k) => { const [a, b] = String(k).split('-'); return +a + (+b || 0) / 100; };
  function mergeArticles(oldChunks, newChunks) {
    const fresh = new Map();
    for (const c of newChunks) { const k = artKey(c.h); if (!k) continue; (fresh.get(k) || fresh.set(k, []).get(k)).push(c); }
    if (!fresh.size) return null;
    const changed = [], added = [], removed = [];
    const isDel = (cs) => cs.length === 1 && /^\s*제\s*\d+\s*조(?:\s*의\s*\d+)?\s*(?:[(（][^)）]*[)）])?\s*삭\s*제/.test(cs[0].t) && cs[0].t.replace(/\s+/g, '').length < 40;
    const out = []; const done = new Set();
    for (const c of oldChunks) {
      const k = artKey(c.h);
      if (k && fresh.has(k)) {
        if (done.has(k)) continue; done.add(k);
        const cs = fresh.get(k);
        if (isDel(cs)) { removed.push(cs[0].h); continue; }
        const same = oldChunks.filter((x) => artKey(x.h) === k).map((x) => x.t).join('\n') === cs.map((x) => x.t).join('\n');
        if (!same) changed.push(cs[0].h);
        out.push(...cs);
      } else out.push(c);
    }
    // 없던 조: 번호 순서대로 들어갈 자리(앞 번호 조의 마지막 덩어리 뒤)
    for (const [k, cs] of fresh) {
      if (done.has(k) || isDel(cs)) continue;
      let at = -1; out.forEach((x, i) => { const xk = artKey(x.h); if (xk && keyNum(xk) < keyNum(k)) at = i; });
      out.splice(at + 1, 0, ...cs); added.push(cs[0].h);
    }
    return { chunks: out, changed, added, removed };
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

  const api = { DEFAULT_LAWS, LAW_BASE, lawError, lawSearchUrl, lawServiceUrl, pickLaw, lawText, lawFiles, artKey, mergeArticles, revDate, splitArticles, grams, makeIndex, search, SYSTEM, prompt };
  root.JH = root.JH || {};
  root.JH.rulesLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
