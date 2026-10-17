/* 공고문 작성 화면 */
(function (root) {
  'use strict';
  const L = JH.logic, S = JH.server, N = JH.notice.logic;
  const PATH = '공고문대장.json', TPL_DIR = '공고문/양식', OUT_DIR = '공고문/작성';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = () => JH.app;

  let store = { version: 1, notices: [] };
  let sel = null, loaded = false;
  let saveTimer = null;
  const cur = () => store.notices.find((n) => n.id === sel);
  const save = (now) => { clearTimeout(saveTimer); const run = () => S.writeJson(PATH, store).catch((e) => app().toast('공고문을 저장하지 못했습니다: ' + e.message, 'err')); if (now) return run(); saveTimer = setTimeout(run, 400); };

  async function load() {
    if (loaded || !S.online) return;
    const s = await S.readJson(PATH);
    if (s && Array.isArray(s.notices)) store = s;
    loaded = true;
  }
  function create() {
    const cfg = app().cfg;
    const n = { id: L.uid(), status: 'draft', v: N.applyRules(N.blank(cfg), {}, cfg), manual: {}, learned: null, createdAt: Date.now(), updatedAt: Date.now() };
    store.notices.unshift(n); sel = n.id; save(true); render();
    setTimeout(() => { const t = $('#nf-공고명'); if (t) t.focus(); }, 0);
  }
  function setVal(key, val, manual) {
    const n = cur(); if (!n) return;
    n.v[key] = val;
    if (manual) n.manual[key] = true;
    if (key === '구분') { const ws = N.WORK_TYPES[val] || []; if (!ws.some((w) => w.name === n.v.공종)) n.v.공종 = ws[0] ? ws[0].name : ''; n.manual.업종제한 = false; }
    if (key === '공종') n.manual.업종제한 = false;
    n.v = N.applyRules(n.v, n.manual, app().cfg);
    n.updatedAt = n.vAt = Date.now(); save();
  }

  // n개씩 같이 처리(나라장터 조회·첨부 받기를 차례로 기다리지 않음)
  async function pmap(items, n, fn) { let i = 0; const w = async () => { while (i < items.length) await fn(items[i++]); }; await Promise.all(Array.from({ length: Math.min(n, items.length) }, w)); }
  // ---------- 유사 공고에서 배우기 ----------
  async function learnSimilar(scope, months, keyword0, org0) {
    const n = cur(), cfg = app().cfg;
    if (!cfg.apiKey) { app().toast('설정에서 나라장터 인증키를 먼저 넣어 주세요.', 'err'); JH.settings.open('nara'); return; }
    const v = n.v, kind = v.구분 === '용역' ? '용역' : '공사';
    const w = N.workType(kind, v.공종);
    const p = N.money(v.추정가격);
    const org = scope === 'mine' ? cfg.insttNm : scope === 'org' ? String(org0 || '').trim() : '';
    if (scope === 'org' && !org) { app().toast('찾을 기관 이름을 넣어 주세요. 예: 성남도시개발공사', 'err'); const i = $('#lOrg'); if (i) i.focus(); return; }
    const base = { ntceInsttNm: org, priceMin: p ? p * 0.3 : 0, priceMax: p ? p * 3 : 0 };
    const keyword = (w && w.q) || (v.공종 || '').replace(/\(.*\)|공사$|·.*/g, '').trim();
    const tries = [];
    // 공고명 검색어가 있으면 그 공고들 먼저(금액 범위 없이)
    if (keyword0) tries.push({ ntceInsttNm: base.ntceInsttNm, bidNtceNm: keyword0 });
    const subs = N.subWorks(v).filter((x) => x.license);
    if (w && w.license) tries.push({ ...base, indstrytyNm: w.license });
    for (const x of subs) tries.push({ ...base, indstrytyNm: x.license });
    if (keyword && keyword !== '기타') tries.push({ ...base, bidNtceNm: keyword });
    if (!tries.length) { app().toast('공종을 고르면 비슷한 공고를 찾을 수 있습니다.', 'err'); return; }
    const ranges = L.monthRanges(months);
    let bids = [];
    try {
      const log = []; // 찾아 본 검색어마다 받은 건수(못 찾을 때 보여 줌, 진단 파일에도 남김)
      const fetchAll = async (q, k = kind, rs = ranges, pages = 3) => {
        const got = []; const ent = { 구분: k, 검색어: q.bidNtceNm || '', 업종: q.indstrytyNm || '', 기관: q.ntceInsttNm || '전국', 금액: q.priceMin ? `${Math.round(q.priceMin)}~${Math.round(q.priceMax)}` : '', 건수: 0, 오류: '' }; log.push(ent);
        for (let i = 0; i < rs.length; i++) {
          app().progress(`비슷한 공고 찾는 중 (${rs[i][0].slice(0, 4)}.${rs[i][0].slice(4, 6)})`, i / rs.length * 0.6);
          for (let page = 1; page <= pages; page++) {
            let r;
            try { r = L.parseApiBody(await S.nara(N.bidSearchUrl(k, q, rs[i][0], rs[i][1], page, 100, cfg.apiKey))); }
            catch (e) { ent.오류 = e.message; throw e; }
            got.push(...r.items.map(N.normalizeBid)); ent.건수 += r.items.length;
            if (page * 100 >= r.total || !r.items.length) break;
          }
        }
        return got;
      };
      // 공고명 검색: 띄어쓴 것·붙여 쓴 것 둘 다 → 없으면 낱말 하나로 넓게 찾아 나머지 낱말로 거름
      const byName = async (q, k = kind, rs = ranges) => {
        const nq = N.nameQueries(q.bidNtceNm); let got = [];
        for (const e of nq.exact) got.push(...await fetchAll({ ...q, bidNtceNm: e }, k, rs));
        if (!got.length && nq.word) { got = (await fetchAll({ ...q, bidNtceNm: nq.word }, k, rs, 5)).filter((b) => N.nameHas(b.name, q.bidNtceNm)); log[log.length - 1].거른뒤 = got.length; }
        return got;
      };
      for (const q of tries) {
        bids.push(...(q.bidNtceNm ? await byName(q) : await fetchAll(q)));
        if (bids.length && !subs.length) break; // 복합공사는 공종마다 찾아 합침
      }
      // 검색어로 찾았는데 이 구분(공사/용역)에 없으면 다른 구분에 있는지 최근 3달만 살펴 알려 줌
      if (!bids.length && keyword0) {
        const other = kind === '용역' ? '공사' : '용역';
        const peek = await byName({ ntceInsttNm: org, bidNtceNm: keyword0 }, other, ranges.slice(0, 3));
        if (peek.length) {
          app().toast(`'${keyword0}' 공고는 ${kind}에는 없고 ${other}에 ${peek.length}건 있습니다. 구분을 ${other}(으)로 바꾸고 다시 찾아 보세요.`, '', { label: `${other}(으)로 바꾸기`, run: () => { setVal('구분', other, true); render(); } });
          return;
        }
      }
      const seen = new Set();
      bids = bids.filter((b) => b.no && !seen.has(b.no + b.ord) && seen.add(b.no + b.ord)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40);
      // 가까운 금액 순으로 12건만 지역·면허 제한 자세히(3건씩 같이 받음)
      const near = [...bids].sort((a, b) => Math.abs(a.price - p) - Math.abs(b.price - p)).slice(0, 12);
      let seenN = 0;
      await pmap(near, 3, async (b) => {
        try { const r = L.parseApiBody(await S.nara(N.bidDetailUrl('getBidPblancListInfoPrtcptPsblRgn', b.no, b.ord, cfg.apiKey))); b.regions = r.items.map((x) => x.prtcptPsblRgnNm).filter(Boolean); } catch (_) {}
        try { const r = L.parseApiBody(await S.nara(N.bidDetailUrl('getBidPblancListInfoLicenseLimit', b.no, b.ord, cfg.apiKey))); b.licenses = [...new Set(r.items.map((x) => x.lcnsLmtNm).filter(Boolean))]; } catch (_) {}
        seenN++; app().progress(`조건 자세히 보는 중 ${seenN}/${near.length}`, 0.6 + (seenN / near.length) * 0.4);
      });
      // 첨부 공고문 읽기: 가까운 공고 5건의 공고서(한글·PDF)를 받아 문장 뽑기, 원본은 데이터 폴더에 보관
      // 복합공사면 우리 공종 면허를 더 많이 요구한 공고를 앞으로(예: 토목 + 조경 둘 다 요구한 공고)
      const mine = N.worksOf(v).map((x) => x.license);
      const overlap = (b) => (b.licenses || []).filter((l) => mine.some((m) => l.includes(m.replace(/업$/, '')))).length;
      if (mine.length > 1) near.sort((a, b) => overlap(b) - overlap(a));
      const withFiles = (keyword0 ? bids : near).filter((b) => b.files && b.files.some((f) => /\.(hwpx?|pdf)$/i.test(f.name))).slice(0, 6);
      let read = 0, tried = 0;
      await pmap(withFiles, 2, async (b) => { if (await readDoc(b)) read++; tried++; app().progress(`첨부 공고문 읽는 중 ${tried}/${withFiles.length}`, tried / withFiles.length); });
      S.writeJson('진단/공고검색.json', { at: new Date().toISOString(), 범위: scope, 기간개월: months, 찾아본것: log }).catch(() => {});
      const mine0 = ((n.learned && n.learned.bids) || []).filter((b) => b.uploaded); // 직접 올린 공고문은 다시 찾아도 남김
      bids = [...mine0, ...bids];
      n.learned = { at: new Date().toISOString(), scope, org: scope === 'org' ? org : '', months, keyword: keyword0 || '', total: bids.length, summary: N.learn(bids), bids, read: read + mine0.length };
      n.updatedAt = Date.now(); save(true);
      if (bids.length > mine0.length) app().toast(`비슷한 공고 ${bids.length - mine0.length}건에서 조건을 모았습니다.` + (withFiles.length ? ` 첨부 공고문 ${read}/${withFiles.length}건을 읽었습니다.` : '') + ' [찾은 공고]에서 참고할 공고만 고를 수 있습니다.', 'ok');
      else if (scope !== 'all') app().toast(`${org}의 비슷한 공고가 없습니다. 다른 기관(전국) 공고에서 찾아 볼까요?`, '', { label: '전국에서 찾기', run: () => learnSimilar('all', months, keyword0) });
      else {
        const tried = log.filter((x) => x.검색어 || x.업종).map((x) => `'${x.검색어 || x.업종}' ${x.거른뒤 != null ? `${x.건수}건 중 ${x.거른뒤}건` : `${x.건수}건`}`).join(', ');
        app().toast(`나라장터 ${kind} 공고에서 찾지 못했습니다${tried ? ` (찾아 본 것: ${tried})` : ''}. 나라장터에서 공고문을 내려받아 [공고문 파일 올리기]로 올리면 그 공고문으로 배웁니다.`, '', { label: '공고문 올리기', run: () => $('#lUpload') && $('#lUpload').click() });
      }
    } catch (e) { console.error(e); app().toast(e.message, 'err'); }
    finally { app().progress(null); render(); }
  }
  // 공고 하나의 첨부 공고문(한글·PDF)을 받아 절 단위로 읽고 원본은 데이터 폴더에 보관
  async function readDoc(b) {
    const f = (b.files || []).find((x) => /\.(hwpx?|pdf)$/i.test(x.name)); if (!f) return false;
    try {
      const bytes = await S.fetchFile(f.url);
      const lines = await JH.readers.fullLines(bytes, L.kindOf(f.name));
      b.clauses = N.extractClauses(lines);
      b.doc = N.parseNotice(lines); // 공고문 전체를 절 단위로(전체 초안에 씀)
      const saved = await S.save('공고문/참고', `${b.no}_${L.safeName(f.name, 80)}`, bytes);
      b.savedPath = saved.path; b.savedName = f.name; delete b.fileError; return true;
    } catch (e) { console.warn('첨부 읽기 실패', b.no, e); b.fileError = e.message; return false; }
  }
  // 나라장터에서 못 찾을 때: 내려받은 공고문(한글·PDF)을 직접 올려 같은 방식으로 배움(원본은 데이터 폴더 공고문/참고에 보관)
  async function uploadNotices(files) {
    const n = cur(); if (!n || !files.length) return;
    let ok = 0; const bad = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        app().progress(`올린 공고문 읽는 중 ${i + 1}/${files.length}`, i / files.length);
        if (!/\.(hwpx?|pdf)$/i.test(f.name)) { bad.push(`${f.name}(한글·PDF만)`); continue; }
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const lines = await JH.readers.fullLines(bytes, L.kindOf(f.name));
          if (!lines.length) throw new Error('글자를 읽지 못함(스캔본이면 한글 파일로 올려 주세요)');
          const b = N.uploadedBid(lines, f.name);
          b.clauses = N.extractClauses(lines); b.doc = N.parseNotice(lines);
          if (S.online) { try { const sv = await S.save('공고문/참고', `올림_${L.safeName(f.name, 80)}`, bytes); b.savedPath = sv.path; b.savedName = f.name; } catch (_) { /* 보관 못 해도 읽은 내용은 씀 */ } }
          n.learned = n.learned || { at: new Date().toISOString(), scope: 'upload', org: '', months: 0, keyword: '', total: 0, summary: null, bids: [], read: 0 };
          n.learned.bids.unshift(b); ok++;
        } catch (e) { bad.push(`${f.name}(${e.message})`); }
      }
    } finally { app().progress(null); }
    if (n.learned) {
      n.learned.total = n.learned.bids.length; n.learned.read = n.learned.bids.filter(isRead).length;
      n.learned.summary = N.learn(used(n.learned)); n.updatedAt = Date.now(); save(true);
    }
    render();
    if (ok) app().toast(`공고문 ${ok}건을 읽었습니다. 아래 [실제 공고문]과 문장 초안·공고마다 다른 문장에 반영했습니다.` + (bad.length ? ` 못 읽음: ${bad.join(', ')}` : ''), 'ok');
    else app().toast('공고문을 읽지 못했습니다: ' + bad.join(', '), 'err');
  }
  // 찾은 공고 중 참고할 것만 고름(빼면 추천·배운 문장·업종 문장에서 빠짐)
  const openBids = new Set(); // 찾은 공고 목록을 펼쳐 둔 공고문(고르는 중엔 계속 펼침)
  const openSubs = new Set(); // '함께 들어가는 공고' 칸을 펼쳐 둔 공고문
  const used = (s) => (s && s.bids ? s.bids.filter((b) => b.use !== false) : []);
  const lv = (n) => (n.learned ? { ...n.learned, bids: used(n.learned) } : null);
  const isRead = (b) => !!((b.doc && b.doc.sections && b.doc.sections.length) || (b.clauses && b.clauses.length));
  const hasFile = (b) => (b.files || []).some((f) => /\.(hwpx?|pdf)$/i.test(f.name));
  function setUse(n, pred) {
    n.learned.bids.forEach((b, i) => { const u = pred(b, i); if (u != null) b.use = u; });
    n.learned.summary = N.learn(used(n.learned)); n.updatedAt = Date.now(); save(true); render();
  }
  async function readPicked(n) {
    const todo = used(n.learned).filter((b) => !isRead(b) && hasFile(b)).slice(0, 10);
    if (!todo.length) { app().toast('고른 공고 중 아직 안 읽은 첨부 공고문이 없습니다.'); return; }
    let ok = 0, tried = 0;
    try { await pmap(todo, 2, async (b) => { if (await readDoc(b)) ok++; tried++; app().progress(`고른 공고의 공고문 읽는 중 ${tried}/${todo.length}`, tried / todo.length); }); }
    finally { app().progress(null); }
    n.learned.read = n.learned.bids.filter(isRead).length; n.updatedAt = Date.now(); save(true); render();
    app().toast(`공고문 ${ok}/${todo.length}건을 읽었습니다.`, ok ? 'ok' : 'err');
  }
  // 배운 값 → 화면 값
  function suggestionFor(key, top) {
    const v = top.value;
    if (key === '낙찰자결정방법') return N.mapMethod(v);
    if (key === '계약방법') return N.mapContract(v);
    if (key === '공동도급') return /지역의무/.test(v) ? '지역의무공동도급' : /분담/.test(v) ? '허용(분담이행)' : /공동/.test(v) ? '허용(공동이행)' : v;
    if (key === '업종제한') { const n = cur(); const w = N.workType(n.v.구분, n.v.공종); return w && w.law ? `「${w.law}」에 따른 ${v} 등록업체` : `${v} 등록업체`; }
    return v;
  }
  function applySchedule() {
    const n = cur(), s = n.learned && n.learned.summary; if (!s) return;
    const d0 = n.v.공고일 ? new Date(n.v.공고일) : new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const at = (d, h) => `${iso(d)}T${pad(h)}:00`;
    const days = Math.max(1, s.입찰기간일수 || 7);
    const begin = new Date(d0); begin.setDate(begin.getDate() + 1);
    const close = new Date(begin); close.setDate(close.getDate() + days);
    const open = new Date(close); open.setHours(10 + Math.round(s.개찰시간차 || 1));
    setVal('공고일', iso(d0), true); setVal('입찰시작', at(begin, 10), true); setVal('입찰마감', at(close, 10), true); setVal('개찰일시', at(open, open.getHours()), true);
    render();
  }

  // ---------- 문장 초안: 배운 문장(기본값) · 기본 문장 · AI ----------
  const refBids = (s) => used(s).filter(isRead);
  const hasLearned = (n) => used(n.learned).some(isRead);
  const modeOf = (n) => (n.dmode === 'ai' && n.ai ? 'ai' : n.dmode === 'basic' || !hasLearned(n) ? 'basic' : 'learned');
  // 문장 초안: 고른 종류(배운 문장·기본·AI)에 담당자가 초안에서 직접 고친 절을 덮어씀
  const editKey = (n, d) => `${modeOf(n)}|${d.title}`;
  function baseSections(n) {
    const m = modeOf(n);
    if (m === 'ai') return n.ai.sections;
    return m === 'basic' ? N.draft(n.v) : N.draft(n.v, lv(n));
  }
  function sectionsOf(n) {
    const ed = n.edits || {};
    return baseSections(n).map((d) => { const e = ed[editKey(n, d)]; return e != null ? { ...d, body: e, edited: true } : d; });
  }
  // AI: PC 안 AI(설치 때 함께 깔림)가 기본, 설정에 키를 넣으면 Gemini·Claude (JH.ai)
  let aiWho = null; // 지금 쓸 수 있는 AI('local'|'gemini'|'claude'|null) — 화면을 그릴 때 확인해 바뀌면 다시 그림
  const checkAi = () => root.JH.ai.pick(false).then((p) => { if (p !== aiWho) { aiWho = p; render(); } }).catch(() => {});
  const aiQuestion = (n) => `${N.AI_SYSTEM}\n\n${N.aiPrompt(n.v, lv(n), hasLearned(n) ? N.draft(n.v, lv(n)) : N.draft(n.v))}`;
  function pasteAiAnswer(n) {
    const d = $('#dlgAiPaste'); $('#aiPasteText').value = ''; $('#aiPasteErr').textContent = ''; d.showModal(); $('#aiPasteText').focus();
    $('#aiPasteGo').onclick = () => {
      try { n.ai = { at: Date.now(), model: '붙여넣기', sections: N.parseAi($('#aiPasteText').value) }; n.dmode = 'ai'; n.updatedAt = Date.now(); save(true); d.close(); render(); app().toast('AI 답을 초안에 넣었습니다. 내용을 꼭 확인한 뒤 쓰세요.', 'ok'); }
      catch (e) { $('#aiPasteErr').textContent = e.message + ' 답 전체(중괄호 { } 포함)를 붙여 넣어 주세요.'; }
    };
  }
  const aiNotReady = () => app().toast('AI가 아직 준비되지 않았습니다. 설정 → AI에서 [PC AI 설치](이 PC 안에서만 처리)를 하거나 Gemini 키를 넣으면 바로 다듬을 수 있습니다.', 'err', { label: '설정 열기', run: () => JH.settings.open('ai') });
  // 절 하나만 AI로 다듬기: 뜻·금액·날짜·업종·조항은 그대로, 문체·띄어쓰기·맞춤법·어색한 문장만. 결과는 '고침'으로 저장(되돌리기 가능)
  async function polishSection(n, i) {
    const who = await root.JH.ai.pick(false); if (!who) { aiNotReady(); return; }
    const d = sectionsOf(n)[i]; if (!d) return;
    app().progress(`${root.JH.ai.label(who)}로 「${d.title}」 다듬는 중${who === 'local' ? ' (PC AI는 30초~1분)' : ''}`, .4);
    try {
      const vals = Object.entries(n.v).filter(([, x]) => x).map(([k, x]) => `${k}: ${x}`).join('\n');
      const prompt = `아래는 입찰 공고문의 「${d.title}」 절입니다. 공고문 문체로 다듬어 주세요.\n- 금액·날짜·시각·업종·법령 조항·비율은 절대 바꾸지 말 것\n- 맞춤법·띄어쓰기·어색한 문장·중복만 고칠 것, 번호(가. 나. 1) 등)와 줄 나눔은 그대로\n- ○○ 자리는 아래 이번 공고 값으로 채울 수 있으면 채우고, 없으면 그대로 둘 것\n- 다듬은 본문만 답할 것(설명·머리말 없이)\n\n[이번 공고 값]\n${vals}\n\n[본문]\n${d.body}`;
      const r = await root.JH.ai.ask({ system: N.AI_SYSTEM, prompt, json: false });
      const text = String(r.text || '').replace(/^```[a-z]*\n?|```$/g, '').trim();
      if (!text) throw new Error('빈 답');
      n.edits = { ...(n.edits || {}), [editKey(n, d)]: text }; n.updatedAt = Date.now(); save(true);
      app().toast(`「${d.title}」을 다듬었습니다. 바뀐 곳을 확인하세요([되돌리기]로 원래대로).`, 'ok');
    } catch (e) { console.error(e); app().toast('AI로 다듬지 못했습니다: ' + e.message, 'err'); }
    finally { app().progress(null); render(); }
  }
  async function writeWithAi(n) {
    const who = await root.JH.ai.pick(false);
    if (!who) { aiNotReady(); return; }
    app().progress(`${root.JH.ai.label(who)}로 초안 전체를 다듬는 중${who === 'local' ? ' (PC AI는 1~2분 걸립니다)' : ''}`, .4);
    try {
      const base = hasLearned(n) ? N.draft(n.v, lv(n)) : N.draft(n.v);
      const r = await root.JH.ai.ask({ system: N.AI_SYSTEM, prompt: N.aiPrompt(n.v, lv(n), base), json: true });
      n.ai = { at: Date.now(), model: r.model, by: r.by, sections: N.parseAi(r.text) };
      n.dmode = 'ai'; n.updatedAt = Date.now(); save(true);
      app().toast('AI로 다듬었습니다. 내용을 꼭 확인한 뒤 쓰세요.', 'ok');
    } catch (e) { console.error(e); app().toast('AI로 쓰지 못했습니다: ' + e.message, 'err'); }
    finally { app().progress(null); render(); }
  }

  // ---------- 진행 상태 ----------
  function setStatus(n, st) { n.status = st; n.updatedAt = Date.now(); save(true); render(); }

  // ---------- 한글 양식 ----------
  async function templates() {
    try { const r = await S.list(TPL_DIR, false); return r.files.filter((f) => /\.(hwp|hwpx)$/i.test(f.path)); } catch (_) { return []; }
  }
  async function fillTemplate(tplPath) {
    const n = cur(); const values = N.templateValues(n.v, sectionsOf(n));
    const name = L.safeName(n.v.공고명 || '공고문', 60) + (/\.hwpx$/i.test(tplPath) ? '.hwpx' : '.hwp');
    app().progress('한글 양식에 채우는 중', .5);
    try {
      let r;
      try {
        if (S.demo) throw new Error('시연판');
        // 1순위: 설치된 한글로 바꾸기(HWP·HWPX 모두)
        r = await fetch('/api/hwpfill', { method: 'POST', headers: { 'X-JH-Token': S.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ template: tplPath, dir: OUT_DIR, name, values }) }).then((x) => x.json());
        if (!r.ok) throw new Error(r.error);
      } catch (e) {
        // 2순위: HWPX는 이 창에서 직접 바꿈
        if (!/\.hwpx$/i.test(tplPath)) throw new Error('한글 프로그램으로 양식을 열지 못했습니다(' + e.message + '). 양식을 한글에서 HWPX로 저장해 올리면 한글 없이도 채울 수 있습니다.');
        const bytes = await S.readBytes(tplPath);
        const out = fillHwpxBytes(bytes, values);
        if (!out.count) throw new Error('양식에서 {{항목}} 표시를 찾지 못했습니다.');
        r = await S.save(OUT_DIR, name, out.bytes); r.replaced = out.count;
      }
      const moved = N.statusOf(n) === 'draft' || !n.status;
      n.lastFile = r.path; if (moved) n.status = 'done'; n.updatedAt = Date.now(); save(true);
      app().toast(`한글 공고문을 만들었습니다 (${r.replaced}개 항목).` + (moved ? ' 작성 완료로 옮겼습니다.' : ''), 'ok', { label: '한글로 열기', run: () => S.openFile(r.path) });
    } catch (e) { app().toast(e.message, 'err'); }
    finally { app().progress(null); render(); }
  }
  const fillHwpxBytes = (bytes, values) => N.fillHwpx(root.CFB, bytes, values);

  // ---------- 입찰공고·견적공고 기본 양식(설정에서 올림, {{ }} 표시 없이 그대로 채움) ----------
  const SLOT_DIR = '공고문/양식/기본';
  const KINDS = ['입찰공고', '견적공고'];
  const slotPath = (kind) => `${SLOT_DIR}/${kind}.hwpx`;
  // 회사 기본 양식(프로그램에 들어 있음) — 올린 양식이 없으면 이것을 씀. 설정에서 올리면 그 양식으로 바뀜
  const BUNDLED = { 입찰공고: 'tpl/notice-bid', 견적공고: 'tpl/notice-est' };
  const BUNDLED_NAME = '회사 기본 양식(프로그램에 포함)';
  const fetchBytes = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return new Uint8Array(await r.arrayBuffer()); };
  // 기본 양식을 내 폴더에 깔아 둠: 원본 .hwp를 설치된 한글로 .hwpx로 바꾸고(모양이 가장 정확), 한글이 없으면 미리 바꿔 둔 .hwpx를 씀
  async function installBundled(kind) {
    const base = BUNDLED[kind]; if (!base) return false;
    let ok = false;
    try {
      const src = `${SLOT_DIR}/${kind}.hwp`;
      await S.writeBytes(src, await fetchBytes(base + '.hwp'));
      await S.hwpConvert(src, 'HWPX');
      ok = !!(await S.readBytes(slotPath(kind))).length;
    } catch (_) { /* 한글이 없거나 바꾸기 실패 */ }
    if (!ok) {
      try { await S.writeBytes(slotPath(kind), await fetchBytes(base + '.hwpx')); ok = true; } catch (_) { return false; }
    }
    const meta = (await S.readJson(`${SLOT_DIR}/양식정보.json`).catch(() => null)) || {};
    meta[kind] = { name: BUNDLED_NAME, at: new Date().toISOString(), bundled: true };
    await S.writeJson(`${SLOT_DIR}/양식정보.json`, meta);
    return true;
  }
  let seeding = null;
  async function listSlots() {
    let files = []; try { files = (await S.list(SLOT_DIR, false)).files; } catch (_) { /* 아직 없음 */ }
    return files;
  }
  async function slotInfo() {
    let files = await listSlots();
    const missing = KINDS.filter((k) => !files.some((f) => f.path === slotPath(k)) && BUNDLED[k]);
    if (missing.length && S.online) {
      seeding = seeding || (async () => { app().progress('회사 기본 공고문 양식 준비 중', .3); for (const k of missing) await installBundled(k); })().finally(() => { seeding = null; app().progress(null); });
      await seeding; files = await listSlots();
    }
    const meta = (await S.readJson(`${SLOT_DIR}/양식정보.json`).catch(() => null)) || {};
    return KINDS.map((k) => ({ kind: k, path: slotPath(k), has: files.some((f) => f.path === slotPath(k)), canReset: !!BUNDLED[k], ...(meta[k] || {}) }));
  }
  // 올린 양식을 빼고 회사 기본 양식으로 되돌림
  async function resetSlot(kind) {
    for (const p of [slotPath(kind), `${SLOT_DIR}/${kind}.hwp`]) { try { await S.remove(p); } catch (_) { /* 없음 */ } }
    if (!(await installBundled(kind))) throw new Error('기본 양식을 깔지 못했습니다.');
  }
  // 양식에서 바꿀 수 있는 자리 미리 보기(모든 값을 넣어 시험으로 채워 봄)
  function probeTemplate(bytes) {
    const v = { ...N.blank(app().cfg), 공고명: '시험 공고명', 공고번호: '0000', 현장: '시험', 기간: '시험', 추정가격: '1,000,000', 추정금액: '1,100,000', 기초금액: '1,000,000',
      입찰시작: '2030-01-01T10:00', 입찰마감: '2030-01-02T10:00', 개찰일시: '2030-01-02T11:00', 낙찰하한율: '88.000%', 지역제한: '용인시', 연락처: '031-000-0000', 현장설명: '없음' };
    v.업종제한 = N.applyRules(v, {}, app().cfg).업종제한;
    return N.fillNoticeHwpx(root.CFB, bytes, v, N.draft(v));
  }
  const LABEL = { 공고명: '공고명', 현장: '장소', 기간: '기간', 추정가격: '추정가격', 추정금액: '추정금액', 기초금액: '기초금액', 입찰기간: '제출 기간', 개찰일시: '개찰일시', 공고번호: '공고번호', 낙찰하한율: '하한율', 지역제한: '지역', 업종제한: '업종', 연락처: '연락처', 현장설명: '현장설명', 하자담보책임기간: '하자담보', '{{항목}}': '{{항목}} 표시' };
  const doneText = (keys) => keys.map((k) => LABEL[k] || k).join('·');
  async function uploadSlot(kind, file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let hwpx = bytes;
    app().progress(`${kind} 양식 올리는 중`, .4);
    try {
      if (/\.hwp$/i.test(file.name)) {
        // .hwp는 설치된 한글로 .hwpx로 바꿔 둠(원본도 보관)
        const src = `${SLOT_DIR}/${kind}.hwp`;
        await S.writeBytes(src, bytes);
        try { await S.remove(slotPath(kind)); } catch (_) { /* 처음 */ }
        try { await S.hwpConvert(src, 'HWPX'); }
        catch (e) { throw new Error(`한글 프로그램으로 .hwp를 바꾸지 못했습니다(${e.message}). 한글에서 [다른 이름으로 저장 → 파일 형식 HWPX]로 저장해 올려 주세요.`); }
        hwpx = await S.readBytes(slotPath(kind));
      } else if (/\.hwpx$/i.test(file.name)) await S.writeBytes(slotPath(kind), bytes);
      else throw new Error('한글 파일(.hwp, .hwpx)만 올릴 수 있습니다.');
      const probe = probeTemplate(hwpx);
      const meta = (await S.readJson(`${SLOT_DIR}/양식정보.json`).catch(() => null)) || {};
      meta[kind] = { name: file.name, at: new Date().toISOString(), found: probe.done };
      await S.writeJson(`${SLOT_DIR}/양식정보.json`, meta);
      app().toast(probe.done.length ? `${kind} 양식을 올렸습니다. 바꿀 자리를 찾았습니다: ${doneText(probe.done)}${probe.missed.length ? ` (못 찾음: ${probe.missed.join(', ')})` : ''}` : `${kind} 양식을 올렸지만 바꿀 자리(공사명: … 같은 이름표)를 찾지 못했습니다. 양식을 보내 주시면 맞춰 드립니다.`, probe.done.length ? 'ok' : 'err');
    } finally { app().progress(null); }
  }
  // 최근 만든 한글 파일: 바꾼 자리와 확인할 것
  function reportPanel(n) {
    const r = n.lastReport; if (!r || !n.lastFile) return '';
    const items = [...(r.missed || []).map((x) => `양식에서 "${x}" 자리를 찾지 못함`), ...(r.notes || [])];
    return `<div class="hreport${items.length ? ' warn' : ''}" role="status"><div><b>${esc(r.kind)} 한글 파일</b> <span class="muted">${esc(L.fmtDate(r.at))}</span>
      <button type="button" class="link sm" data-nact="openlast">열기</button></div>
      <div class="muted small">바꾼 자리: ${esc(doneText(r.done || []))}</div>
      ${items.length ? `<div class="hcheck"><b>확인할 것</b><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><span class="muted small">○○로 비운 곳은 한글에서 직접 채우세요. 위 칸(공종·금액·A값 등)에 넣고 다시 만들면 자동으로 들어갑니다.</span></div>` : ''}</div>`;
  }
  async function makeHwp(n) {
    const kind = N.noticeKind(n.v);
    const info = (await slotInfo()).find((x) => x.kind === kind);
    if (!info || !info.has) {
      const old = await templates();
      if (old.length) { const tpl = old.length === 1 ? old[0].path : await pickTemplate(old); if (tpl) fillTemplate(tpl); return; }
      app().toast(`${kind} 양식을 찾지 못했습니다. 설정 → 공고문에서 [${kind} 양식]에 한글 파일을 올려 주세요.`, 'err', { label: '설정 열기', run: () => JH.settings.open('notice') });
      return;
    }
    app().progress(`${kind} 양식에 이번 공고 내용을 채우는 중`, .5);
    try {
      const bytes = await S.readBytes(info.path);
      const out = N.fillNoticeHwpx(root.CFB, bytes, n.v, sectionsOf(n));
      if (!out.count) throw new Error(`${kind} 양식에서 바꿀 자리를 찾지 못했습니다. 양식 파일을 보내 주시면 맞춰 드립니다.`);
      const name = `${L.safeName(n.v.공고명 || '공고문', 60)}_${kind}.hwpx`;
      const r = await S.save(OUT_DIR, name, out.bytes);
      const moved = N.statusOf(n) === 'draft' || !n.status;
      n.lastFile = r.path; if (moved) n.status = 'done';
      n.lastReport = { at: new Date().toISOString(), kind, done: out.done, missed: out.missed, notes: out.notes };
      n.updatedAt = Date.now(); save(true);
      app().toast(`${kind} 한글 파일을 만들었습니다.${out.notes.length || out.missed.length ? ' 화면의 "확인할 것"을 꼭 보세요.' : ''}${moved ? ' 작성 완료로 옮겼습니다.' : ''}`, out.notes.length ? '' : 'ok', { label: '한글로 열기', run: () => S.openFile(r.path) });
    } catch (e) { app().toast(e.message, 'err'); }
    finally { app().progress(null); render(); }
  }

  // ---------- 화면 ----------
  function field(f, n) {
    const v = n.v[f.key] == null ? '' : n.v[f.key];
    const auto = f.auto && !n.manual[f.key];
    const label = `<span class="flabel">${esc(f.label || f.key)}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}${f.auto ? (auto ? '<em class="auto">자동</em>' : `<button type="button" class="link sm" data-reauto="${esc(f.key)}">자동으로</button>`) : ''}</span>`;
    let input;
    const attrs = `data-key="${esc(f.key)}" id="nf-${esc(f.key)}"`;
    if (f.type === 'select' && f.optsFrom === 'work') {
      // 공종: 묶음(전문공사·종합공사, 환경·폐기물·건물 관리·기술용역 등)으로 나눠 고름
      const ws = N.WORK_TYPES[n.v.구분] || [], groups = [...new Set(ws.map((w) => w.g || ''))];
      const opt = (w) => `<option value="${esc(w.name)}"${w.name === v ? ' selected' : ''}>${esc(w.name)}${w.license ? ` — ${esc(w.license)}` : ''}</option>`;
      input = `<select ${attrs}>${groups.map((g) => (g ? `<optgroup label="${esc(g)}">${ws.filter((w) => w.g === g).map(opt).join('')}</optgroup>` : ws.filter((w) => !w.g).map(opt).join(''))).join('')}${v && !ws.some((w) => w.name === v) ? `<option selected>${esc(v)}</option>` : ''}</select>`;
    } else if (f.type === 'select') {
      const opts = f.opts;
      input = `<select ${attrs}>${opts.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}${v && !opts.includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select>`;
    } else if (f.type === 'combo') {
      const learned = (n.learned && n.learned.summary[f.key] && n.learned.summary[f.key].top.map((t) => suggestionFor(f.key, t))) || [];
      const opts = [...new Set([...(f.opts || []), ...learned])];
      input = `<input type="text" ${attrs} value="${esc(v)}" list="dl-${esc(f.key)}" autocomplete="off"><datalist id="dl-${esc(f.key)}">${opts.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`;
    } else if (f.type === 'multi') {
      // 복합공사: 주공종 말고 함께 들어가는 공종을 고름
      const ws = (N.WORK_TYPES[n.v.구분] || []).filter((w) => w.name !== n.v.공종 && w.name !== '기타');
      const on = N.splitList(v), groups = [...new Set(ws.map((w) => w.g || ''))];
      const chip = (o) => `<label class="mchip${on.includes(o) ? ' on' : ''}"><input type="checkbox" data-mkey="${esc(f.key)}" value="${esc(o)}"${on.includes(o) ? ' checked' : ''}>${esc(o)}</label>`;
      // 복합공사일 때만 쓰므로 접어 둠(고른 게 있거나 펼쳐 둔 공고문은 펼침)
      const open = on.length || openSubs.has(n.id);
      input = `<details class="msub" data-msub${open ? ' open' : ''}><summary>${on.length ? `<b>${esc(on.join(', '))}</b>` : '<span class="muted">없음 — 복합공사일 때 펼쳐서 고르기</span>'}</summary>
        <div class="multi" id="nf-${esc(f.key)}" role="group" aria-label="${esc(f.label || f.key)}">${groups.map((g) => `${g && groups.length > 1 ? `<div class="mgroup">${esc(g)}</div>` : ''}${ws.filter((w) => (w.g || '') === g).map((w) => chip(w.name)).join('')}`).join('')}</div></details>`;
      const sep = N.separateIn(n.v);
      if (on.length && sep.length) input += `<div class="learn-hint warn">${esc(sep.join('·'))}는 법에 따라 따로 발주(분리발주)하는 것이 원칙입니다(전기공사업법 제11조, 정보통신공사업법 제25조, 소방시설공사업법 제21조). 함께 발주해도 되는 예외인지 확인하세요.</div>`;
      else if (on.length) input += `<div class="learn-hint">업종제한을 "${esc(N.worksOf(n.v).map((w) => w.license).join(' + '))} 모두 등록 또는 분담이행 공동도급"으로, 공동도급을 분담이행으로 자동으로 바꿨습니다.</div>`;
    } else if (f.type === 'date') input = `<input type="date" ${attrs} value="${esc(v)}">`;
    else if (f.type === 'datetime') input = `<input type="datetime-local" ${attrs} value="${esc(v)}">`;
    else if (f.type === 'textarea') input = `<textarea ${attrs} rows="2" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
    else input = `<input type="text" ${attrs} value="${esc(v)}"${f.type === 'money' ? ' inputmode="numeric" class="num"' : f.key === '공고명' && !v ? ' class="need"' : ''} placeholder="${esc(f.ph || '')}">`;
    // 유사 공고에서 배운 추천
    let hint = '';
    const s = n.learned && n.learned.summary[f.key];
    if (s && s.top.length) {
      const t = s.top[0]; const sv = suggestionFor(f.key, t);
      hint = `<div class="learn-hint">비슷한 공고 ${s.n}건 중 ${t.count}건: <b>${esc(sv)}</b>${sv !== v ? ` <button type="button" class="link sm" data-apply="${esc(f.key)}" data-val="${esc(sv)}">적용</button>` : ' <span class="ok">✓</span>'}</div>`;
    }
    const tag = f.type === 'multi' ? 'div' : 'label'; // 체크 상자 여러 개는 label로 감싸지 않음
    return `<${tag} class="nf${f.wide ? ' wide' : ''}">${label}${input}${hint}</${tag}>`;
  }
  // ---------- 공고마다 다른 문장 고르기(업종·지역·공동도급·하도급·보증금·낙찰자 결정 등) ----------
  let topics = [];
  function setPick(k, text) {
    const n = cur(); if (!n) return;
    const t = String(text || '').trim();
    if (k === '업종') setVal('업종문장', t, true);
    else { const o = { ...(n.v.고른문장 || {}) }; if (t) o[k] = t; else delete o[k]; setVal('고른문장', o, true); }
  }
  // 문장 고르기 칸을 누르면 오른쪽 초안의 같은 주제 문장으로 옮겨 가서 잠깐 표시
  let jumpKey = '';
  function jumpTo(key, quiet) {
    const n = cur(); if (!n || !key) return;
    jumpKey = key;
    const place = N.topicPlace(sectionsOf(n), key, n.v);
    $$('.draft .dsec.target').forEach((x) => { x.classList.remove('target'); const b = x.querySelector('.tgt'); if (b) b.remove(); });
    const tp = topics.find((t) => t.key === key);
    if (!place) { if (!quiet) app().toast(`문장 초안에 ${tp ? tp.label : ''} 문장이 없습니다. 고르면 알맞은 절 끝에 들어갑니다.`); return; }
    const box = $$('.draft .dsec')[place.si]; if (!box) return;
    box.classList.add('target');
    const head = box.querySelector('.dsec-head b'); if (head) head.insertAdjacentHTML('afterend', `<span class="lbadge tgt">${esc(tp ? tp.label : '')} ${place.li + 1}번째 줄</span>`);
    const ta = box.querySelector('textarea.dbody');
    const lineY = ta ? ta.offsetTop + place.li * 23 : box.offsetTop;
    const pane = $('.draft');
    if (pane && pane.scrollHeight > pane.clientHeight + 4 && getComputedStyle(pane).position === 'sticky') {
      const top = box.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop + (lineY - box.offsetTop) - 80;
      pane.scrollTo({ top: Math.max(0, top), behavior: quiet ? 'auto' : 'smooth' });
    } else if (!quiet) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (!quiet) { box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
  }
  function pickPanel(n) {
    topics = N.topicVariants(lv(n), store.notices, n.v, n.id);
    if (!topics.length) return `<fieldset class="nsec picks"><legend>공고마다 다른 문장 고르기</legend><p class="muted small">위 [비슷한 공고에서 배우기]로 공고를 찾고 공고문을 읽으면, 업종·지역·공동도급·하도급·입찰보증금·낙찰자 결정처럼 공고마다 다르게 쓴 문장이 여기에 모입니다. 그중 골라 고쳐 쓰면 문장 초안과 한글 파일에 들어갑니다.</p></fieldset>`;
    const norm = (x) => String(x || '').replace(/\s+/g, '');
    const card = (tp, ti) => {
      const cur0 = norm(tp.current);
      const on = tp.variants.findIndex((e) => norm(e.shown) === cur0);
      const many = tp.variants.length > 1;
      return `<div class="pick${tp.current ? ' set' : ''}" data-topic="${ti}" title="누르면 오른쪽 초안의 이 문장 자리로 갑니다"><div class="pick-h"><b>${esc(tp.label)}</b>${many ? `<span class="lbadge warn">공고마다 다름 · ${tp.variants.length}가지</span>` : ''}<span class="muted small">${tp.docs ? `공고문 ${tp.docs}건에 있음` : ''}</span></div>
        <ul>
          <li><label><input type="radio" name="pk-${ti}" data-pick="${ti}" value="-1"${tp.current ? '' : ' checked'}><span>${tp.key === '업종' ? '양식 문장 그대로(업종 이름만 이번 공종으로)' : '양식·초안 문장 그대로'}</span></label></li>
          ${tp.variants.map((e, i) => `<li class="${e.match ? 'match' : ''}"><label><input type="radio" name="pk-${ti}" data-pick="${ti}" value="${i}"${i === on ? ' checked' : ''}><span class="pv-t">${esc(e.shown)}</span></label>
            <div class="pv-s muted small">${e.srcs.slice(0, 3).map((x) => `${x.kind === 'mine' ? '내 공고문: ' : ''}${esc(x.name)}${x.org ? ` (${esc(x.org)})` : ''}${x.price ? ` · ${esc(N.won(x.price))}원` : ''}`).join(' / ')}${e.srcs.length > 3 ? ` 외 ${e.srcs.length - 3}건` : ''}</div></li>`).join('')}
          ${tp.current && on < 0 ? `<li><label><input type="radio" name="pk-${ti}" data-pick="${ti}" value="own" checked><span>직접 고친 문장</span></label></li>` : ''}
        </ul>
        ${tp.current ? `<textarea data-picktext="${ti}" rows="3" aria-label="${esc(tp.label)} 문장 고치기">${esc(tp.current)}</textarea>` : ''}</div>`;
    };
    const order = topics.map((t, i) => [t, i]).sort((a, b) => (b[0].variants.length > 1) - (a[0].variants.length > 1));
    return `<fieldset class="nsec picks"><legend>공고마다 다른 문장 고르기</legend>
      <p class="muted small">고른 공고들(위 [찾은 공고])의 공고문에서 모았습니다. 하나를 고르고 아래 칸에서 고치면 문장 초안과 한글 파일의 같은 자리에 들어갑니다. 고르지 않으면 양식 문장을 씁니다.</p>
      <div class="picks-list">${order.map(([t, i]) => card(t, i)).join('')}</div></fieldset>`;
  }
  function listItem(n) {
    const st = N.statusOf(n);
    return `<div class="citem${n.id === sel ? ' on' : ''}" role="listitem" tabindex="0" data-nid="${n.id}">
      <div class="nm">${esc(n.v.공고명 || '제목 없는 공고문')}</div><div class="st"><span class="pill ${N.STATUS[st].cls}">${esc(N.STATUS[st].label)}</span></div>
      <div class="meta"><span>${esc(n.v.공종 || n.v.구분)}</span>${n.v.추정가격 ? `<span class="num">${esc(n.v.추정가격)}원</span>` : ''}<span>${esc(L.fmtDate(new Date(n.updatedAt).toISOString()))}</span></div></div>`;
  }
  function renderList() {
    const groups = N.STATUS_ORDER.map((k) => ({ k, items: store.notices.filter((n) => N.statusOf(n) === k) })).filter((g) => g.items.length);
    $('#noticeList').innerHTML = groups.map((g) => `<div class="lgroup"><span>${esc(N.STATUS[g.k].label)}</span><b class="num">${g.items.length}</b></div>${g.items.map(listItem).join('')}`).join('')
      || '<div class="empty-state" style="margin:40px 16px"><p>작성한 공고문이 없습니다.</p></div>';
  }
  function statusPanel(n, st) {
    const steps = N.STATUS_ORDER.map((k, i) => `<span class="nstep${k === st ? ' on' : ''}${N.STATUS_ORDER.indexOf(st) > i ? ' past' : ''}"><i>${N.STATUS_ORDER.indexOf(st) > i ? '✓' : i + 1}</i>${esc(N.STATUS[k].label)}</span>`).join('<span class="nstep-line" aria-hidden="true"></span>');
    return `<div class="nstatus"><div class="nsteps">${steps}</div>${st === 'done' ? '<span class="muted small">만든 한글 파일을 나라장터에 직접 첨부해 등록하세요.</span>' : ''}</div>`;
  }
  function render() {
    if (!$('#view-notice').classList.contains('on')) return;
    renderMain();
    if (jumpKey) jumpTo(jumpKey, true);
  }
  function renderMain() {
    checkAi();
    if (!sel && store.notices.length) sel = store.notices[0].id;
    renderList();
    const el = $('#noticeMain'); const n = cur();
    if (!n) {
      el.innerHTML = `<div class="empty-state"><h2>새 공고문을 시작하세요</h2><p>공종과 금액을 넣으면 업종 제한·부가세·상생결제가 자동으로 채워지고, 나라장터의 비슷한 공고에서 지역 제한·낙찰하한율 같은 조건을 배워 추천합니다.</p><button class="btn primary" data-nact="new">새 공고문</button></div>`;
      return;
    }
    const s = n.learned;
    const st = N.statusOf(n);
    const secs = N.SECTIONS.map((sec) => `<fieldset class="nsec"><legend>${esc(N.SECTION_LABEL[sec] || sec)}</legend><div class="ngrid">${N.FIELDS.filter((f) => f.sec === sec && (!f.showIf || f.showIf(n.v))).map((f) => field(f, n)).join('')}</div>
      ${sec === '일정' && s && s.summary.입찰기간일수 ? `<div class="learn-hint">비슷한 공고는 입찰서 제출 기간이 보통 <b>${s.summary.입찰기간일수}일</b>입니다. <button type="button" class="link sm" data-nact="schedule">공고일 기준으로 일정 채우기</button> <span class="muted">법정 공고기간을 꼭 확인하세요.</span></div>` : ''}</fieldset>`).join('');
    const draft = sectionsOf(n), dm = modeOf(n);
    const stale = dm === 'ai' && n.vAt && n.vAt > n.ai.at;
    el.innerHTML = `
      <div class="nhead">
        <h2 class="ntitle" id="nTitle">${n.v.공고명 ? esc(n.v.공고명) : '<span class="muted">새 공고문 — 아래 [기본]의 공고명부터 넣으세요</span>'}</h2>
        <div class="actions">
          <button class="btn primary" data-nact="hwp">${n.lastFile ? `한글 파일로 다시 만들기` : `한글 파일로 만들기`} <small class="kind">${esc(N.noticeKind(n.v))} 양식</small></button>
          ${n.lastFile ? `<button class="btn ghost" data-nact="openlast">최근 만든 파일 열기</button>` : ''}
          <span class="spacer"></span>
          ${st === 'draft' ? '<button class="btn ghost" data-nact="markdone" title="한글 양식 없이 문장 초안만 쓸 때">작성 완료로 표시</button>' : ''}
          ${st === 'done' ? '<button class="btn ghost" data-nact="markdraft">작성 중으로 되돌리기</button>' : ''}
          <button class="btn ghost" data-nact="dup">복사해서 새로 쓰기</button>
          <button class="btn ghost danger" data-nact="del">삭제</button>
        </div>
        ${reportPanel(n)}
        ${statusPanel(n, st)}
      </div>
      <section class="learn">
        <div class="learn-head"><h3>비슷한 공고에서 배우기</h3>
          <span class="muted">${s ? `${s.scope === 'upload' ? `직접 올린 공고문 ${s.total}건` : `${esc(s.scope === 'mine' ? app().cfg.insttNm : s.scope === 'org' ? s.org : '전국(모든 기관)')} · 최근 ${s.months}개월 · ${s.total}건`}${used(s).length < s.bids.length ? ` 중 ${used(s).length}건 참고` : ''} · ${esc(L.fmtDate(s.at.slice(0, 10)))}` : '같은 업종·비슷한 금액의 나라장터 공고를 모아 조건별로 가장 많이 쓴 값을 추천합니다.'}</span>
          <div class="learn-ctl">
            <input type="search" id="lKeyword" placeholder="공고명 검색어(선택), 예: 신갈오거리" value="${esc(s && s.keyword || '')}" aria-label="공고명 검색어">
            <select id="lScope" aria-label="범위"><option value="mine"${s && s.scope === 'mine' ? ' selected' : ''}>우리 기관</option><option value="all"${s && s.scope === 'all' ? ' selected' : ''}>전국(모든 기관)</option><option value="org"${s && s.scope === 'org' ? ' selected' : ''}>기관 지정</option></select>
            <input type="search" id="lOrg" placeholder="기관 이름, 예: 성남도시개발공사" value="${esc(s && s.org || '')}" aria-label="기관 이름"${s && s.scope === 'org' ? '' : ' hidden'}>
            <select id="lMonths" aria-label="기간"><option value="6"${s && s.months === 6 ? ' selected' : ''}>최근 6개월</option><option value="12"${s && s.months === 12 ? ' selected' : ''}>최근 1년</option></select>
            <button class="btn" data-nact="learn">${s ? '다시 찾기' : '찾기'}</button>
            <label class="btn ghost" title="나라장터에서 내려받은 공고문(한글·PDF)을 올리면 그 공고문으로 배웁니다. 여러 개 한 번에 올려도 됩니다">공고문 파일 올리기<input type="file" id="lUpload" accept=".hwp,.hwpx,.pdf" multiple hidden></label>
          </div></div>
        ${s && s.bids.length ? `<details class="bids"${openBids.has(n.id) ? ' open' : ''} data-bidsbox><summary>찾은 공고 ${s.bids.length}건 — 참고할 공고 고르기 <span class="muted">(${used(s).length}건 고름 · 공고문 ${s.bids.filter(isRead).length}건 읽음)</span></summary>
          <div class="bids-ctl"><span class="muted small">체크를 빼면 추천·배운 문장·업종 문장에서 빠집니다. 다른 기관 공고도 골라 참고하세요.</span>
            <button type="button" class="link sm" data-nact="useall">모두 고르기</button><button type="button" class="link sm" data-nact="usenone">모두 빼기</button><button type="button" class="link sm" data-nact="usefile">공고문 있는 것만</button>
            ${used(s).some((b) => !isRead(b) && hasFile(b)) ? `<button type="button" class="btn sm primary" data-nact="readpicked">고른 공고의 공고문 읽기 (${Math.min(10, used(s).filter((b) => !isRead(b) && hasFile(b)).length)}건)</button>` : ''}</div>
          <div class="tbl-wrap"><table class="grid"><thead><tr><th class="c">참고</th><th>공고</th><th class="r">추정가격</th><th>지역</th><th class="r">하한율</th><th>낙찰방법</th><th>공고문</th></tr></thead><tbody>
          ${s.bids.map((b, i) => `<tr class="${b.use === false ? 'off' : ''}"><td class="c"><input type="checkbox" data-buse="${i}"${b.use === false ? '' : ' checked'} aria-label="${esc(b.name)} 참고"></td><td><div class="nm">${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)}</a>` : esc(b.name)}</div><div class="sub">${b.uploaded ? '<span class="tag">올림</span> ' : ''}${esc(b.org || (b.uploaded ? '기관 모름' : ''))} · ${esc(b.date.slice(0, 10))}</div></td>
            <td class="r num">${b.price ? esc(N.won(b.price)) : '-'}</td><td>${esc(b.regions ? N.regionLabel(b.regions) : '-')}</td><td class="r num">${esc(b.rate ? b.rate + '%' : '-')}</td><td>${esc(b.method)}</td>
            <td>${isRead(b) ? '<span class="ok-t small">읽음</span>' : b.fileError ? '<span class="warn-t small" title="' + esc(b.fileError) + '">못 읽음</span>' : hasFile(b) ? '<span class="muted small">첨부 있음</span>' : '<span class="muted small">-</span>'}</td></tr>`).join('')}
          </tbody></table></div></details>` : ''}
        ${s && refBids(s).length ? `<details class="bids"${refBids(s).some((b) => b.doc) ? '' : ' open'}><summary>실제 공고문 (${refBids(s).length}건) — 전체 초안의 바탕</summary>
          ${refBids(s).map((b, bi) => `<details class="ref"${bi === 0 ? ' open' : ''}>
            <summary class="ref-head"><b>${esc(b.name)}</b><span class="muted">${esc(b.org || (b.uploaded ? '직접 올린 공고문' : ''))}${b.doc ? ` · ${b.doc.sections.length}개 절` : ''}</span>${b.savedPath ? `<button type="button" class="link sm" data-nact="openref" data-path="${esc(b.savedPath)}">원문 열기</button>` : ''}</summary>
            ${b.doc && b.doc.sections.length ? b.doc.sections.map((c, ci) => `<div class="dsec"><div class="dsec-head"><b>${c.no}. ${esc(c.head)}</b><button type="button" class="link sm" data-docsec="${bi}:${ci}">복사</button></div><pre>${esc(c.lines.join('\n'))}</pre></div>`).join('')
              : (b.clauses || []).map((c, ci) => `<div class="dsec"><div class="dsec-head"><b>${esc(c.title)}</b><button type="button" class="link sm" data-clause="${bi}:${ci}">복사</button></div><pre>${esc(c.text)}</pre></div>`).join('')}
          </details>`).join('')}</details>` : ''}
      </section>
      <div class="ncols">
        <div class="nform">${secs}${pickPanel(n)}</div>
        <aside class="draft"><div class="draft-head"><h3>문장 초안</h3>
            <div class="seg dmode" role="group" aria-label="초안 종류">
              ${hasLearned(n) ? `<button type="button" data-dmode="learned" class="${dm === 'learned' ? 'on' : ''}" title="비슷한 공고들이 공통으로 쓴 실제 문장을 이번 업종·지역으로 바꿈">배운 문장</button>` : ''}
              <button type="button" data-dmode="basic" class="${dm === 'basic' ? 'on' : ''}" title="항목 값으로 만든 기본 문장">기본</button>
              ${n.ai ? `<button type="button" data-dmode="ai" class="${dm === 'ai' ? 'on' : ''}" title="AI가 다시 쓴 문장">AI</button>` : ''}
            </div>
            <button type="button" class="btn sm${n.ai ? '' : ' primary'}" data-nact="ai" title="${aiWho ? `초안 전체를 ${esc(root.JH.ai.label(aiWho))}로 공고문 문체에 맞게 다듬습니다(금액·날짜·업종은 그대로)` : 'AI가 아직 준비되지 않았습니다 — 누르면 설정 방법을 알려 드립니다'}">${n.ai ? 'AI로 다시 다듬기' : 'AI로 다듬기'}</button></div>
          <p class="muted small draft-note">${dm === 'ai' ? `AI 초안${stale ? ' · <b class="warn-t">항목을 바꿨습니다. 반영하려면 [AI로 다시 쓰기]</b>' : ''} — 지어낸 내용이 없는지 꼭 확인하세요.` : dm === 'learned' ? (used(n.learned).some((b) => b.doc && b.doc.sections && b.doc.sections.length >= 3)
              ? `비슷한 공고 ${used(n.learned).filter((b) => b.doc && b.doc.sections && b.doc.sections.length >= 3).length}건의 공고문 전체를 읽어, 가장 전형적인 공고의 절·문장을 이번 공고 값(공고명·업종·지역·하한율)으로 바꿨습니다. 일정·금액은 이번 값으로 씁니다.`
              : `비슷한 공고 ${used(n.learned).filter((b) => b.clauses && b.clauses.length).length}건의 실제 문장에서 배웠습니다. 왼쪽 값을 바꾸면 바로 반영됩니다.`) : '왼쪽 값을 바꾸면 바로 반영됩니다. 위에서 [비슷한 공고 찾기]를 하면 실제 공고 문장으로 배웁니다.'}</p>
          ${(() => { const bl = N.blanksIn(draft); return bl.length ? `<div class="blanks"><b>채울 곳 ${bl.length}곳</b> <span class="muted small">다른 공고에서 가져와 값이 없는 자리입니다. 넣으면 초안·한글 파일에 바로 들어갑니다.</span>
            <div class="blank-list">${bl.map((b) => `<label class="blank"><span class="ctx"><small>${esc(b.title)}</small> …${esc(b.before)}<mark>${esc(b.text)}</mark>${esc(b.after)}…</span><input type="text" data-blank="${b.si}:${b.k}" placeholder="${esc(b.text.includes('원') ? '예: 금 50,000,000원' : b.text.includes(':') ? '예: 10:00' : '넣을 값')}"></label>`).join('')}</div></div>` : ''; })()}
          ${draft.map((d, i) => `<div class="dsec${d.edited ? ' edited' : ''}"><div class="dsec-head"><b>${esc(d.title)}</b>${d.learned ? `<span class="lbadge" title="비슷한 공고 ${d.learned}건에 있는 절 — 실제 공고 문장을 이번 값으로 바꿈">공고 ${d.learned}건</span>` : ''}${d.check && !d.edited ? `<span class="lbadge warn" title="다른 공고의 금액·날짜 자리를 ○○로 비워 둠">○○ ${d.check}곳 확인</span>` : ''}${d.edited ? `<span class="lbadge ok" title="초안에서 직접 고친 절 — 왼쪽 값을 바꿔도 그대로">고침</span><button type="button" class="link sm" data-dreset="${i}" title="고친 것을 버리고 자동 초안으로">되돌리기</button>` : ''}<button type="button" class="link sm" data-polish="${i}" title="이 절만 AI로 다듬기">AI로 다듬기</button></div><textarea class="dbody" data-dedit="${i}" spellcheck="false" rows="${Math.min(30, Math.max(2, d.body.split('\n').length + Math.ceil(d.body.length / 60)))}" aria-label="${esc(d.title)} 고치기">${esc(d.body)}</textarea></div>`).join('')}
          <p class="muted small">초안입니다. 각 절을 눌러 바로 고칠 수 있고(고친 절은 왼쪽 값을 바꿔도 그대로), 고친 대로 [한글 파일로 만들기]에 들어갑니다. 한글 파일은 회사 양식 문장에 값만 바꾸므로, 양식 문장 자체를 바꾸려면 [공고마다 다른 문장 고르기]를 쓰세요. 회사 표준 공고문과 관계 법령에 맞는지 확인한 뒤 사용하세요.</p>
        </aside>
      </div>`;
  }
  // 입력할 때마다 화면 전체를 다시 그리지 않고, 초안과 자동 항목만 갱신
  function refreshLive() {
    const n = cur(); if (!n) return;
    for (const f of N.FIELDS) { const el = $(`#nf-${CSS.escape(f.key)}`); if (el && document.activeElement !== el && f.auto) el.value = n.v[f.key] || ''; }
    if (modeOf(n) === 'ai') { const note = $('.draft-note'); if (note && !note.querySelector('.warn-t')) render(); return; } // AI 문장은 그대로, 다시 쓰라는 안내만
    const draft = sectionsOf(n);
    $$('.draft .dsec textarea.dbody').forEach((t, i) => { if (draft[i] && !draft[i].edited && document.activeElement !== t) t.value = draft[i].body; });
    const t = $(`.citem[data-nid="${n.id}"] .nm`); if (t) t.textContent = n.v.공고명 || '제목 없는 공고문';
    const h = $('#nTitle'); if (h) { if (n.v.공고명) h.textContent = n.v.공고명; else h.innerHTML = '<span class="muted">새 공고문 — 아래 [기본]의 공고명부터 넣으세요</span>'; }
    const nm = $('#nf-공고명'); if (nm) nm.classList.toggle('need', !n.v.공고명);
  }

  async function onClick(e) {
    const a = e.target.closest('[data-nact]');
    const ap = e.target.closest('[data-apply]'), ra = e.target.closest('[data-reauto]'), cp = e.target.closest('[data-copy]');
    const it = e.target.closest('[data-nid]');
    if (it) { sel = it.dataset.nid; jumpKey = ''; render(); return; }
    const n = cur();
    const pc = e.target.closest('.pick[data-topic]');
    if (pc && !e.target.closest('textarea')) { const tp = topics[+pc.dataset.topic]; if (tp) setTimeout(() => jumpTo(tp.key), 0); if (!e.target.closest('input')) return; }
    const pl = e.target.closest('[data-polish]'); if (pl) { const n = cur(); if (n) polishSection(n, +pl.dataset.polish); return; }
    const dr = e.target.closest('[data-dreset]');
    if (dr && n) { const d = baseSections(n)[+dr.dataset.dreset]; if (d && n.edits) { delete n.edits[editKey(n, d)]; n.updatedAt = Date.now(); save(true); render(); } return; }
    if (ap) { setVal(ap.dataset.apply, ap.dataset.val, true); render(); return; }
    if (ra) { n.manual[ra.dataset.reauto] = false; setVal(ra.dataset.reauto, n.v[ra.dataset.reauto], false); render(); return; }
    if (cp) { const d = sectionsOf(n)[+cp.dataset.copy]; await copy(d.title + '\n' + d.body); return; }
    const dmb = e.target.closest('[data-dmode]');
    if (dmb) { n.dmode = dmb.dataset.dmode; save(); render(); return; }
    const cc = e.target.closest('[data-clause]');
    if (cc) { const [bi, ci] = cc.dataset.clause.split(':').map(Number); await copy(refBids(n.learned)[bi].clauses[ci].text); return; }
    const dc = e.target.closest('[data-docsec]');
    if (dc) { const [bi, ci] = dc.dataset.docsec.split(':').map(Number); const c = refBids(n.learned)[bi].doc.sections[ci]; await copy(`${c.no}. ${c.head}\n${c.lines.join('\n')}`); return; }
    if (!a) return;
    const act = a.dataset.nact;
    if (act === 'new') create();
    else if (act === 'learn') learnSimilar($('#lScope').value, Number($('#lMonths').value), $('#lKeyword').value.trim(), ($('#lOrg') || {}).value);
    else if (act === 'useall') { openBids.add(n.id); setUse(n, () => true); }
    else if (act === 'usenone') { openBids.add(n.id); setUse(n, () => false); }
    else if (act === 'usefile') { openBids.add(n.id); setUse(n, (b) => isRead(b) || hasFile(b)); }
    else if (act === 'readpicked') { openBids.add(n.id); await readPicked(n); }
    else if (act === 'schedule') applySchedule();
    else if (act === 'copyall') await copy(sectionsOf(n).map((d) => (d.title === '제목' ? '' : d.title + '\n') + d.body).join('\n\n'));
    else if (act === 'ai') await writeWithAi(n);
    else if (act === 'aiq') { await copy(aiQuestion(n)); app().toast('질문을 복사했습니다. 쓰는 AI 채팅에 붙여 넣고, 받은 답을 [답 붙여넣기]로 넣으세요.', 'ok'); }
    else if (act === 'aip') pasteAiAnswer(n);
    else if (act === 'openlast') S.openFile(n.lastFile).catch((err) => app().toast(err.message, 'err'));
    else if (act === 'openref') S.openFile(a.dataset.path).catch((err) => app().toast(err.message, 'err'));
    else if (act === 'dup') { const c = JSON.parse(JSON.stringify(n)); c.id = L.uid(); c.v.공고명 = (c.v.공고명 || '') + ' (복사)'; c.v.공고번호 = ''; c.lastFile = ''; c.status = 'draft'; delete c.g2b; delete c.ai; delete c.dmode; c.createdAt = c.updatedAt = Date.now(); store.notices.unshift(c); sel = c.id; save(true); render(); }
    else if (act === 'markdone') setStatus(n, 'done');
    else if (act === 'markdraft') setStatus(n, 'draft');
    else if (act === 'del') { if (confirm('이 공고문을 삭제할까요? 만든 한글 파일은 남습니다.')) { store.notices = store.notices.filter((x) => x !== n); sel = null; save(true); render(); } }
    else if (act === 'hwp') await makeHwp(n);
  }
  function pickTemplate(ts) {
    return new Promise((res) => {
      const d = $('#dlgTpl');
      $('#tplList').innerHTML = ts.map((t, i) => `<label class="tpl"><input type="radio" name="tpl" value="${esc(t.path)}"${i === 0 ? ' checked' : ''}> ${esc(t.path.split('/').pop())}</label>`).join('');
      d.showModal();
      $('#tplGo').onclick = () => { const r = $('input[name=tpl]:checked', d); d.close(); res(r ? r.value : null); };
      d.addEventListener('close', () => res(null), { once: true });
    });
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); app().toast('복사했습니다. 한글에 붙여 넣으세요.', 'ok'); }
    catch (_) { app().toast('복사하지 못했습니다. 초안을 직접 선택해 복사해 주세요.', 'err'); }
  }
  function onInput(e) {
    const de = e.target.closest('[data-dedit]');
    if (de) { const n = cur(); if (!n) return; const d = baseSections(n)[+de.dataset.dedit]; if (!d) return;
      n.edits = { ...(n.edits || {}), [editKey(n, d)]: de.value }; n.updatedAt = Date.now(); save();
      const box = de.closest('.dsec'); if (box && !box.classList.contains('edited')) { box.classList.add('edited'); const h = box.querySelector('.dsec-head'); if (h && !h.querySelector('[data-dreset]')) h.querySelector('[data-polish]').insertAdjacentHTML('beforebegin', `<span class="lbadge ok">고침</span><button type="button" class="link sm" data-dreset="${de.dataset.dedit}">되돌리기</button>`); }
      return; }
    const pt = e.target.closest('[data-picktext]');
    if (pt) { const tp = topics[+pt.dataset.picktext]; if (tp) { setPick(tp.key, pt.value); tp.current = pt.value; refreshLive(); } return; }
    const t = e.target.closest('[data-key]'); if (!t || !t.closest('#noticeMain')) return;
    const n = cur(); if (!n) return;
    const f = N.FIELDS.find((x) => x.key === t.dataset.key);
    setVal(t.dataset.key, t.value, true);
    if (f && (f.type === 'select' || f.key === '구분' || f.key === '공종')) render(); else refreshLive();
  }
  function onBlur(e) {
    const t = e.target.closest('[data-key]'); if (!t) return;
    const f = N.FIELDS.find((x) => x.key === t.dataset.key);
    if (f && f.type === 'money' && t.value) { const w = N.won(N.money(t.value)); if (w !== t.value) { t.value = w; setVal(f.key, w, true); refreshLive(); } }
  }
  const view = () => $('#view-notice');
  // 채울 곳 칸: 다 넣고 칸을 벗어나면 그 자리에 들어감
  view().addEventListener('change', (e) => {
    const bi = e.target.closest('[data-blank]'); if (!bi || !bi.value.trim()) return;
    const n = cur(); if (!n) return; const [si, k] = bi.dataset.blank.split(':').map(Number);
    const d = sectionsOf(n)[si]; if (!d) return;
    n.edits = { ...(n.edits || {}), [editKey(n, d)]: N.fillBlank(d.body, k, bi.value.trim()) }; n.updatedAt = Date.now(); save(true); render();
  });
  // 찾은 공고 목록을 직접 접으면 다시 그려도 접힌 채로
  view().addEventListener('toggle', (e) => { const d = e.target; if (!d.matches || !d.matches('[data-bidsbox]')) return; const n = cur(); if (!n) return; if (d.open) openBids.add(n.id); else openBids.delete(n.id); }, true);
  view().addEventListener('toggle', (e) => { const d = e.target; if (!d.matches || !d.matches('[data-msub]')) return; const n = cur(); if (!n) return; if (d.open) openSubs.add(n.id); else openSubs.delete(n.id); }, true);
  view().addEventListener('click', onClick);
  view().addEventListener('input', onInput);
  view().addEventListener('focusout', onBlur);
  view().addEventListener('change', (e) => {
    const pk = e.target.closest('[data-pick]');
    if (pk) { const tp = topics[+pk.dataset.pick]; if (!tp) return; const i = pk.value;
      if (i === '-1') setPick(tp.key, ''); else if (i !== 'own') setPick(tp.key, tp.variants[+i].shown);
      render(); const ta = $(`[data-picktext="${pk.dataset.pick}"]`); if (ta) ta.focus(); return; }
    const bu = e.target.closest('[data-buse]');
    if (bu) { const n = cur(); if (!n || !n.learned) return; openBids.add(n.id); const i = +bu.dataset.buse; setUse(n, (b, j) => (j === i ? bu.checked : null)); return; }
    if (e.target.id === 'lUpload') { const fs = [...e.target.files]; e.target.value = ''; uploadNotices(fs); return; }
    if (e.target.id === 'lScope') { const o = $('#lOrg'); if (o) { o.hidden = e.target.value !== 'org'; if (!o.hidden) o.focus(); } return; }
    const t = e.target.closest('[data-mkey]'); if (!t) return;
    const n = cur(); if (!n) return;
    const vals = $$(`[data-mkey="${t.dataset.mkey}"]:checked`).map((x) => x.value);
    setVal(t.dataset.mkey, vals.join(', '), true); render();
  });
  $('#noticeList').addEventListener('keydown', (e) => { const it = e.target.closest('[data-nid]'); if (it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sel = it.dataset.nid; render(); } });

  root.JH.notice = Object.assign(root.JH.notice, {
    async show() { await load(); render(); },
    create, templates, TPL_DIR, slotInfo, uploadSlot, resetSlot, slotPath, KINDS,
    stats() {
      const by = { draft: 0, done: 0 }; store.notices.forEach((n) => by[N.statusOf(n)]++);
      return { count: store.notices.length, recent: store.notices[0] ? store.notices[0].v.공고명 : '', ...by };
    },
    current: () => cur(),
    refresh: () => render(),
    load, fillHwpxBytes,
  });
})(window);
