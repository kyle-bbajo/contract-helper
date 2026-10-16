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

  // ---------- 유사 공고에서 배우기 ----------
  async function learnSimilar(scope, months, keyword0) {
    const n = cur(), cfg = app().cfg;
    if (!cfg.apiKey) { app().toast('설정에서 나라장터 인증키를 먼저 넣어 주세요.', 'err'); JH.settings.open('nara'); return; }
    const v = n.v, kind = v.구분 === '용역' ? '용역' : '공사';
    const w = N.workType(kind, v.공종);
    const p = N.money(v.추정가격);
    const base = { ntceInsttNm: scope === 'mine' ? cfg.insttNm : '', priceMin: p ? p * 0.3 : 0, priceMax: p ? p * 3 : 0 };
    const keyword = (v.공종 || '').replace(/\(.*\)|공사$|·.*/g, '').trim();
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
      for (const q of tries) {
        for (let i = 0; i < ranges.length; i++) {
          app().progress(`비슷한 공고 찾는 중 (${ranges[i][0].slice(0, 4)}.${ranges[i][0].slice(4, 6)})`, i / ranges.length * 0.6);
          for (let page = 1; page <= 3; page++) {
            const r = L.parseApiBody(await S.nara(N.bidSearchUrl(kind, q, ranges[i][0], ranges[i][1], page, 100, cfg.apiKey)));
            bids.push(...r.items.map(N.normalizeBid));
            if (page * 100 >= r.total || !r.items.length) break;
          }
        }
        if (bids.length && !subs.length) break; // 복합공사는 공종마다 찾아 합침
      }
      const seen = new Set();
      bids = bids.filter((b) => b.no && !seen.has(b.no + b.ord) && seen.add(b.no + b.ord)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40);
      // 가까운 금액 순으로 12건만 지역·면허 제한 자세히
      const near = [...bids].sort((a, b) => Math.abs(a.price - p) - Math.abs(b.price - p)).slice(0, 12);
      for (let i = 0; i < near.length; i++) {
        app().progress(`조건 자세히 보는 중 ${i + 1}/${near.length}`, 0.6 + (i / near.length) * 0.4);
        const b = near[i];
        try { const r = L.parseApiBody(await S.nara(N.bidDetailUrl('getBidPblancListInfoPrtcptPsblRgn', b.no, b.ord, cfg.apiKey))); b.regions = r.items.map((x) => x.prtcptPsblRgnNm).filter(Boolean); } catch (_) {}
        try { const r = L.parseApiBody(await S.nara(N.bidDetailUrl('getBidPblancListInfoLicenseLimit', b.no, b.ord, cfg.apiKey))); b.licenses = [...new Set(r.items.map((x) => x.lcnsLmtNm).filter(Boolean))]; } catch (_) {}
      }
      // 첨부 공고문 읽기: 가까운 공고 5건의 공고서(한글·PDF)를 받아 문장 뽑기, 원본은 데이터 폴더에 보관
      // 복합공사면 우리 공종 면허를 더 많이 요구한 공고를 앞으로(예: 토목 + 조경 둘 다 요구한 공고)
      const mine = N.worksOf(v).map((x) => x.license);
      const overlap = (b) => (b.licenses || []).filter((l) => mine.some((m) => l.includes(m.replace(/업$/, '')))).length;
      if (mine.length > 1) near.sort((a, b) => overlap(b) - overlap(a));
      const withFiles = (keyword0 ? bids : near).filter((b) => b.files && b.files.some((f) => /\.(hwpx?|pdf)$/i.test(f.name))).slice(0, 6);
      let read = 0;
      for (let i = 0; i < withFiles.length; i++) {
        const b = withFiles[i];
        app().progress(`첨부 공고문 읽는 중 ${i + 1}/${withFiles.length}`, i / withFiles.length);
        const f = b.files.find((x) => /\.(hwpx?|pdf)$/i.test(x.name));
        try {
          const bytes = await S.fetchFile(f.url);
          const kind = L.kindOf(f.name);
          const lines = await JH.readers.fullLines(bytes, kind);
          b.clauses = N.extractClauses(lines);
          b.doc = N.parseNotice(lines); // 공고문 전체를 절 단위로(전체 초안에 씀)
          const saved = await S.save('공고문/참고', `${b.no}_${L.safeName(f.name, 80)}`, bytes);
          b.savedPath = saved.path; b.savedName = f.name; read++;
        } catch (e) { console.warn('첨부 읽기 실패', b.no, e); b.fileError = e.message; }
      }
      n.learned = { at: new Date().toISOString(), scope, months, keyword: keyword0 || '', total: bids.length, summary: N.learn(bids), bids, read };
      n.updatedAt = Date.now(); save(true);
      app().toast(bids.length ? `비슷한 공고 ${bids.length}건에서 조건을 모았습니다.` + (withFiles.length ? ` 첨부 공고문 ${read}/${withFiles.length}건을 읽었습니다.` : '') : '비슷한 공고를 찾지 못했습니다. 범위를 전국이나 1년으로 넓혀 보세요.', bids.length ? 'ok' : '');
    } catch (e) { console.error(e); app().toast(e.message, 'err'); }
    finally { app().progress(null); render(); }
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
  const refBids = (s) => (s && s.bids ? s.bids.filter((b) => (b.doc && b.doc.sections && b.doc.sections.length) || (b.clauses && b.clauses.length)) : []);
  const hasLearned = (n) => !!(n.learned && n.learned.bids && n.learned.bids.some((b) => (b.clauses && b.clauses.length) || (b.doc && b.doc.sections && b.doc.sections.length)));
  const modeOf = (n) => (n.dmode === 'ai' && n.ai ? 'ai' : n.dmode === 'basic' || !hasLearned(n) ? 'basic' : 'learned');
  function sectionsOf(n) {
    const m = modeOf(n);
    if (m === 'ai') return n.ai.sections;
    return m === 'basic' ? N.draft(n.v) : N.draft(n.v, n.learned);
  }
  // AI: PC 안 AI(설치 때 함께 깔림)가 기본, 설정에 키를 넣으면 Gemini·Claude (JH.ai)
  let aiWho = null; // 지금 쓸 수 있는 AI('local'|'gemini'|'claude'|null) — 화면을 그릴 때 확인해 바뀌면 다시 그림
  const checkAi = () => root.JH.ai.pick(false).then((p) => { if (p !== aiWho) { aiWho = p; render(); } }).catch(() => {});
  const aiQuestion = (n) => `${N.AI_SYSTEM}\n\n${N.aiPrompt(n.v, n.learned, hasLearned(n) ? N.draft(n.v, n.learned) : N.draft(n.v))}`;
  function pasteAiAnswer(n) {
    const d = $('#dlgAiPaste'); $('#aiPasteText').value = ''; $('#aiPasteErr').textContent = ''; d.showModal(); $('#aiPasteText').focus();
    $('#aiPasteGo').onclick = () => {
      try { n.ai = { at: Date.now(), model: '붙여넣기', sections: N.parseAi($('#aiPasteText').value) }; n.dmode = 'ai'; n.updatedAt = Date.now(); save(true); d.close(); render(); app().toast('AI 답을 초안에 넣었습니다. 내용을 꼭 확인한 뒤 쓰세요.', 'ok'); }
      catch (e) { $('#aiPasteErr').textContent = e.message + ' 답 전체(중괄호 { } 포함)를 붙여 넣어 주세요.'; }
    };
  }
  async function writeWithAi(n) {
    const who = await root.JH.ai.pick(false);
    if (!who) { app().toast('AI가 아직 준비되지 않았습니다. [AI 질문 복사]로 업무용 AI·Gemini 등 아무 AI 채팅에 붙여 넣고, 답을 [답 붙여넣기]로 넣으면 됩니다.', 'err', { label: '질문 복사', run: () => copy(aiQuestion(n)) }); return; }
    app().progress(`${root.JH.ai.label(who)}가 비슷한 공고 문장을 보고 다시 쓰는 중${who === 'local' ? ' (PC AI는 1~2분 걸립니다)' : ''}`, .4);
    try {
      const base = hasLearned(n) ? N.draft(n.v, n.learned) : N.draft(n.v);
      const r = await root.JH.ai.ask({ system: N.AI_SYSTEM, prompt: N.aiPrompt(n.v, n.learned, base), json: true });
      n.ai = { at: Date.now(), model: r.model, by: r.by, sections: N.parseAi(r.text) };
      n.dmode = 'ai'; n.updatedAt = Date.now(); save(true);
      app().toast('AI 초안을 만들었습니다. 내용을 꼭 확인한 뒤 쓰세요.', 'ok');
    } catch (e) { console.error(e); app().toast('AI로 쓰지 못했습니다: ' + e.message, 'err'); }
    finally { app().progress(null); render(); }
  }

  // ---------- 진행 상태 ----------
  function setStatus(n, st) { n.status = st; n.updatedAt = Date.now(); save(true); render(); }
  // 나라장터 입찰공고번호를 넣으면 '나라장터 등록'으로 넘기고, 나라장터에서 실제 공고를 찾아 공고명·개찰일시를 받아 둠
  async function registerBid(n, text) {
    const p = N.parseBidNo(text);
    if (!p) { app().toast('나라장터 입찰공고번호를 확인해 주세요. 예: R26BK01234567-000', 'err'); const i = $('#g2bNo'); if (i) i.focus(); return; }
    n.g2b = { no: p.no, ord: p.ord, at: new Date().toISOString(), checked: false };
    n.status = 'posted'; n.updatedAt = Date.now(); save(true); render();
    await checkBid(n);
  }
  async function checkBid(n) {
    const cfg = app().cfg, g = n.g2b; if (!g) return;
    if (!cfg.apiKey) { app().toast('나라장터 등록으로 옮겼습니다. 인증키가 없어 나라장터 확인은 건너뛰었습니다.'); return; }
    app().progress('나라장터에서 공고 확인 중', .5);
    try {
      const kind = n.v.구분 === '용역' ? '용역' : '공사';
      const found = L.parseApiBody(await S.nara(N.bidByNoUrl(kind, g.no, cfg.apiKey))).items.map(N.normalizeBid).filter((b) => b.no === g.no);
      const b = found.find((x) => x.ord === g.ord) || found.sort((a, c) => (a.ord < c.ord ? 1 : -1))[0];
      if (b) {
        Object.assign(g, { ord: b.ord, name: b.name, org: b.org, date: b.date, close: b.close, open: b.open, url: b.url, checked: true, checkedAt: new Date().toISOString() });
        app().toast(`나라장터에서 확인했습니다: ${b.name}` + (b.open ? ` · 개찰 ${b.open.replace('T', ' ')}` : ''), 'ok');
      } else {
        g.checked = false; g.checkedAt = new Date().toISOString();
        app().toast('나라장터 등록으로 옮겼습니다. 다만 나라장터에서 이 번호를 아직 찾지 못했습니다(등록 직후엔 조회에 늦게 나올 수 있음). 번호를 확인하거나 나중에 [다시 확인]을 누르세요.');
      }
    } catch (e) { console.error(e); app().toast('나라장터 확인 실패: ' + e.message, 'err'); }
    finally { n.updatedAt = Date.now(); save(true); app().progress(null); render(); }
  }

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
    if (f.type === 'select') {
      const opts = f.optsFrom === 'work' ? (N.WORK_TYPES[n.v.구분] || []).map((w) => w.name) : f.opts;
      input = `<select ${attrs}>${opts.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}${v && !opts.includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select>`;
    } else if (f.type === 'combo') {
      const learned = (n.learned && n.learned.summary[f.key] && n.learned.summary[f.key].top.map((t) => suggestionFor(f.key, t))) || [];
      const opts = [...new Set([...(f.opts || []), ...learned])];
      input = `<input type="text" ${attrs} value="${esc(v)}" list="dl-${esc(f.key)}" autocomplete="off"><datalist id="dl-${esc(f.key)}">${opts.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`;
    } else if (f.type === 'multi') {
      // 복합공사: 주공종 말고 함께 들어가는 공종을 고름
      const opts = (N.WORK_TYPES[n.v.구분] || []).map((w) => w.name).filter((x) => x !== n.v.공종 && x !== '기타');
      const on = N.splitList(v);
      input = `<div class="multi" id="nf-${esc(f.key)}" role="group" aria-label="${esc(f.label || f.key)}">${opts.map((o) => `<label class="mchip${on.includes(o) ? ' on' : ''}"><input type="checkbox" data-mkey="${esc(f.key)}" value="${esc(o)}"${on.includes(o) ? ' checked' : ''}>${esc(o)}</label>`).join('')}</div>`;
      const sep = N.separateIn(n.v);
      if (on.length && sep.length) input += `<div class="learn-hint warn">${esc(sep.join('·'))}는 법에 따라 따로 발주(분리발주)하는 것이 원칙입니다(전기공사업법 제11조, 정보통신공사업법 제25조, 소방시설공사업법 제21조). 함께 발주해도 되는 예외인지 확인하세요.</div>`;
      else if (on.length) input += `<div class="learn-hint">업종제한을 "${esc(N.worksOf(n.v).map((w) => w.license).join(' + '))} 모두 등록 또는 분담이행 공동도급"으로, 공동도급을 분담이행으로 자동으로 바꿨습니다.</div>`;
    } else if (f.type === 'date') input = `<input type="date" ${attrs} value="${esc(v)}">`;
    else if (f.type === 'datetime') input = `<input type="datetime-local" ${attrs} value="${esc(v)}">`;
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
  function listItem(n) {
    const st = N.statusOf(n);
    return `<div class="citem${n.id === sel ? ' on' : ''}" role="listitem" tabindex="0" data-nid="${n.id}">
      <div class="nm">${esc(n.v.공고명 || '제목 없는 공고문')}</div><div class="st"><span class="pill ${N.STATUS[st].cls}">${esc(N.STATUS[st].label)}</span></div>
      <div class="meta"><span>${esc(n.v.공종 || n.v.구분)}</span>${st === 'posted' && n.g2b ? `<span class="num">${esc(n.g2b.no)}</span>` : `${n.v.추정가격 ? `<span class="num">${esc(n.v.추정가격)}원</span>` : ''}<span>${esc(L.fmtDate(new Date(n.updatedAt).toISOString()))}</span>`}</div></div>`;
  }
  function renderList() {
    const groups = N.STATUS_ORDER.map((k) => ({ k, items: store.notices.filter((n) => N.statusOf(n) === k) })).filter((g) => g.items.length);
    $('#noticeList').innerHTML = groups.map((g) => `<div class="lgroup"><span>${esc(N.STATUS[g.k].label)}</span><b class="num">${g.items.length}</b></div>${g.items.map(listItem).join('')}`).join('')
      || '<div class="empty-state" style="margin:40px 16px"><p>작성한 공고문이 없습니다.</p></div>';
  }
  function statusPanel(n, st) {
    const steps = N.STATUS_ORDER.map((k, i) => `<span class="nstep${k === st ? ' on' : ''}${N.STATUS_ORDER.indexOf(st) > i ? ' past' : ''}"><i>${N.STATUS_ORDER.indexOf(st) > i ? '✓' : i + 1}</i>${esc(N.STATUS[k].label)}</span>`).join('<span class="nstep-line" aria-hidden="true"></span>');
    let body;
    if (st === 'posted') {
      const g = n.g2b || {};
      body = `<div class="g2b posted"><div class="g2b-main"><span class="muted">나라장터 입찰공고번호</span> <b class="num">${esc(g.no || '')}${g.ord ? '-' + esc(g.ord) : ''}</b>
          ${g.checked ? `<span class="ok">✓ 나라장터에서 확인</span>${g.name ? `<div class="g2b-sub">${esc(g.name)}${g.close ? ` · 마감 ${esc(g.close.replace('T', ' '))}` : ''}${g.open ? ` · 개찰 ${esc(g.open.replace('T', ' '))}` : ''}</div>` : ''}`
            : `<span class="warn-t">나라장터에서 아직 확인 안 됨</span> <button type="button" class="link sm" data-nact="g2bcheck">다시 확인</button>`}</div>
        <div class="g2b-side">${g.url ? `<a class="btn sm" href="${esc(g.url)}" target="_blank" rel="noopener">나라장터에서 보기</a>` : ''}<button type="button" class="link sm" data-nact="unpost">연결 풀기</button></div>
        <p class="g2b-note">등록된 공고문은 고칠 수 없게 잠겨 있습니다. 바꿔야 하면 [복사해서 새로 쓰기]를 누르세요.</p></div>`;
    } else {
      body = `<div class="g2b"><label for="g2bNo">나라장터에서 직접 등록한 뒤, 받은 입찰공고번호를 넣으면 이 공고문과 연결됩니다 <small class="muted">(이 프로그램이 나라장터에 등록하지는 않습니다)</small></label>
        <div class="g2b-in"><input id="g2bNo" placeholder="예: R26BK01234567-000" autocomplete="off" spellcheck="false"><button type="button" class="btn${st === 'done' ? ' primary' : ''}" data-nact="g2b">번호 연결</button></div></div>`;
    }
    return `<div class="nstatus"><div class="nsteps">${steps}</div>${body}</div>`;
  }
  function render() {
    if (!$('#view-notice').classList.contains('on')) return;
    checkAi();
    if (!sel && store.notices.length) sel = store.notices[0].id;
    renderList();
    const el = $('#noticeMain'); const n = cur();
    if (!n) {
      el.innerHTML = `<div class="empty-state"><h2>새 공고문을 시작하세요</h2><p>공종과 금액을 넣으면 업종 제한·부가세·상생결제가 자동으로 채워지고, 나라장터의 비슷한 공고에서 지역 제한·낙찰하한율 같은 조건을 배워 추천합니다.</p><button class="btn primary" data-nact="new">새 공고문</button></div>`;
      return;
    }
    const s = n.learned;
    const st = N.statusOf(n), locked = st === 'posted';
    const secs = N.SECTIONS.map((sec) => `<fieldset class="nsec"${locked ? ' disabled' : ''}><legend>${esc(N.SECTION_LABEL[sec] || sec)}</legend><div class="ngrid">${N.FIELDS.filter((f) => f.sec === sec && (!f.showIf || f.showIf(n.v))).map((f) => field(f, n)).join('')}</div>
      ${sec === '일정' && s && s.summary.입찰기간일수 ? `<div class="learn-hint">비슷한 공고는 입찰서 제출 기간이 보통 <b>${s.summary.입찰기간일수}일</b>입니다. <button type="button" class="link sm" data-nact="schedule">공고일 기준으로 일정 채우기</button> <span class="muted">법정 공고기간을 꼭 확인하세요.</span></div>` : ''}</fieldset>`).join('');
    const draft = sectionsOf(n), dm = modeOf(n);
    const stale = dm === 'ai' && n.vAt && n.vAt > n.ai.at;
    el.innerHTML = `
      <div class="nhead">
        <h2 class="ntitle" id="nTitle">${n.v.공고명 ? esc(n.v.공고명) : '<span class="muted">새 공고문 — 아래 [기본]의 공고명부터 넣으세요</span>'}</h2>
        <div class="actions">
          <button class="btn${locked ? '' : ' primary'}" data-nact="hwp">${n.lastFile ? `한글 파일로 다시 만들기` : `한글 파일로 만들기`} <small class="kind">${esc(N.noticeKind(n.v))} 양식</small></button>
          <button class="btn" data-nact="copyall">문장 초안 전체 복사</button>
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
      <section class="learn"${locked ? ' hidden' : ''}>
        <div class="learn-head"><h3>비슷한 공고에서 배우기</h3>
          <span class="muted">${s ? `${esc(s.scope === 'mine' ? app().cfg.insttNm : '전국')} · 최근 ${s.months}개월 · ${s.total}건 · ${esc(L.fmtDate(s.at.slice(0, 10)))}` : '같은 업종·비슷한 금액의 나라장터 공고를 모아 조건별로 가장 많이 쓴 값을 추천합니다.'}</span>
          <div class="learn-ctl">
            <input type="search" id="lKeyword" placeholder="공고명 검색어(선택), 예: 신갈오거리" value="${esc(s && s.keyword || '')}" aria-label="공고명 검색어">
            <select id="lScope" aria-label="범위"><option value="mine"${s && s.scope === 'mine' ? ' selected' : ''}>우리 기관</option><option value="all"${s && s.scope === 'all' ? ' selected' : ''}>전국</option></select>
            <select id="lMonths" aria-label="기간"><option value="6"${s && s.months === 6 ? ' selected' : ''}>최근 6개월</option><option value="12"${s && s.months === 12 ? ' selected' : ''}>최근 1년</option></select>
            <button class="btn" data-nact="learn">${s ? '다시 찾기' : '찾기'}</button>
          </div></div>
        ${s && s.bids.length ? `<details class="bids"><summary>찾은 공고 ${s.bids.length}건 보기</summary><table class="grid"><thead><tr><th>공고</th><th class="r">추정가격</th><th>지역</th><th class="r">하한율</th><th>낙찰방법</th></tr></thead><tbody>
          ${s.bids.map((b) => `<tr><td><div class="nm">${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)}</a>` : esc(b.name)}</div><div class="sub">${esc(b.org)} · ${esc(b.date.slice(0, 10))}</div></td>
            <td class="r num">${esc(N.won(b.price))}</td><td>${esc(b.regions ? N.regionLabel(b.regions) : '-')}</td><td class="r num">${esc(b.rate ? b.rate + '%' : '-')}</td><td>${esc(b.method)}</td></tr>`).join('')}
          </tbody></table></details>` : ''}
        ${s && refBids(s).length ? `<details class="bids"${refBids(s).some((b) => b.doc) ? '' : ' open'}><summary>실제 공고문 (${refBids(s).length}건) — 전체 초안의 바탕</summary>
          ${refBids(s).map((b, bi) => `<details class="ref"${bi === 0 ? ' open' : ''}>
            <summary class="ref-head"><b>${esc(b.name)}</b><span class="muted">${esc(b.org)}${b.doc ? ` · ${b.doc.sections.length}개 절` : ''}</span>${b.savedPath ? `<button type="button" class="link sm" data-nact="openref" data-path="${esc(b.savedPath)}">원문 열기</button>` : ''}</summary>
            ${b.doc && b.doc.sections.length ? b.doc.sections.map((c, ci) => `<div class="dsec"><div class="dsec-head"><b>${c.no}. ${esc(c.head)}</b><button type="button" class="link sm" data-docsec="${bi}:${ci}">복사</button></div><pre>${esc(c.lines.join('\n'))}</pre></div>`).join('')
              : (b.clauses || []).map((c, ci) => `<div class="dsec"><div class="dsec-head"><b>${esc(c.title)}</b><button type="button" class="link sm" data-clause="${bi}:${ci}">복사</button></div><pre>${esc(c.text)}</pre></div>`).join('')}
          </details>`).join('')}</details>` : ''}
      </section>
      <div class="ncols">
        <div class="nform">${secs}</div>
        <aside class="draft"><div class="draft-head"><h3>문장 초안</h3>
            <div class="seg dmode" role="group" aria-label="초안 종류">
              ${hasLearned(n) ? `<button type="button" data-dmode="learned" class="${dm === 'learned' ? 'on' : ''}" title="비슷한 공고들이 공통으로 쓴 실제 문장을 이번 업종·지역으로 바꿈">배운 문장</button>` : ''}
              <button type="button" data-dmode="basic" class="${dm === 'basic' ? 'on' : ''}" title="항목 값으로 만든 기본 문장">기본</button>
              ${n.ai ? `<button type="button" data-dmode="ai" class="${dm === 'ai' ? 'on' : ''}" title="AI가 다시 쓴 문장">AI</button>` : ''}
            </div>
            ${aiWho ? `<button type="button" class="btn sm${n.ai ? '' : ' primary'}" data-nact="ai" title="비슷한 공고의 실제 문장과 이번 항목 값을 ${root.JH.ai.label(aiWho)}에 보내 공고문 문체로 다시 씁니다">${n.ai ? 'AI로 다시 쓰기' : 'AI로 쓰기'}</button>`
              : `<button type="button" class="btn sm" data-nact="aiq" title="업무용 AI·Gemini·ChatGPT 등 쓰는 AI 채팅에 붙여 넣을 질문(비슷한 공고 문장 + 이번 값)을 복사합니다">AI 질문 복사</button><button type="button" class="btn sm" data-nact="aip" title="AI가 준 답을 붙여 넣으면 초안에 들어갑니다">답 붙여넣기</button>`}</div>
          <p class="muted small draft-note">${dm === 'ai' ? `AI 초안${stale ? ' · <b class="warn-t">항목을 바꿨습니다. 반영하려면 [AI로 다시 쓰기]</b>' : ''} — 지어낸 내용이 없는지 꼭 확인하세요.` : dm === 'learned' ? (n.learned.bids.some((b) => b.doc && b.doc.sections && b.doc.sections.length >= 3)
              ? `비슷한 공고 ${n.learned.bids.filter((b) => b.doc && b.doc.sections && b.doc.sections.length >= 3).length}건의 공고문 전체를 읽어, 가장 전형적인 공고의 절·문장을 이번 공고 값(공고명·업종·지역·하한율)으로 바꿨습니다. 일정·금액은 이번 값으로 씁니다.`
              : `비슷한 공고 ${n.learned.bids.filter((b) => b.clauses && b.clauses.length).length}건의 실제 문장에서 배웠습니다. 왼쪽 값을 바꾸면 바로 반영됩니다.`) : '왼쪽 값을 바꾸면 바로 반영됩니다. 위에서 [비슷한 공고 찾기]를 하면 실제 공고 문장으로 배웁니다.'}</p>
          ${draft.map((d, i) => `<div class="dsec"><div class="dsec-head"><b>${esc(d.title)}</b>${d.learned ? `<span class="lbadge" title="비슷한 공고 ${d.learned}건에 있는 절 — 실제 공고 문장을 이번 값으로 바꿈">공고 ${d.learned}건</span>` : ''}${d.check ? `<span class="lbadge warn" title="다른 공고의 금액·날짜 자리를 ○○로 비워 둠">○○ ${d.check}곳 확인</span>` : ''}<button type="button" class="link sm" data-copy="${i}">복사</button></div><pre>${esc(d.body)}</pre></div>`).join('')}
          <p class="muted small">초안입니다. 회사 표준 공고문과 관계 법령에 맞는지 확인한 뒤 사용하세요.</p>
        </aside>
      </div>`;
  }
  // 입력할 때마다 화면 전체를 다시 그리지 않고, 초안과 자동 항목만 갱신
  function refreshLive() {
    const n = cur(); if (!n) return;
    for (const f of N.FIELDS) { const el = $(`#nf-${CSS.escape(f.key)}`); if (el && document.activeElement !== el && f.auto) el.value = n.v[f.key] || ''; }
    if (modeOf(n) === 'ai') { const note = $('.draft-note'); if (note && !note.querySelector('.warn-t')) render(); return; } // AI 문장은 그대로, 다시 쓰라는 안내만
    const draft = sectionsOf(n);
    $$('.draft .dsec pre').forEach((p, i) => { if (draft[i]) p.textContent = draft[i].body; });
    const t = $(`.citem[data-nid="${n.id}"] .nm`); if (t) t.textContent = n.v.공고명 || '제목 없는 공고문';
    const h = $('#nTitle'); if (h) { if (n.v.공고명) h.textContent = n.v.공고명; else h.innerHTML = '<span class="muted">새 공고문 — 아래 [기본]의 공고명부터 넣으세요</span>'; }
    const nm = $('#nf-공고명'); if (nm) nm.classList.toggle('need', !n.v.공고명);
  }

  async function onClick(e) {
    const a = e.target.closest('[data-nact]');
    const ap = e.target.closest('[data-apply]'), ra = e.target.closest('[data-reauto]'), cp = e.target.closest('[data-copy]');
    const it = e.target.closest('[data-nid]');
    if (it) { sel = it.dataset.nid; render(); return; }
    const n = cur();
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
    else if (act === 'learn') learnSimilar($('#lScope').value, Number($('#lMonths').value), $('#lKeyword').value.trim());
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
    else if (act === 'g2b') await registerBid(n, $('#g2bNo').value);
    else if (act === 'g2bcheck') await checkBid(n);
    else if (act === 'unpost') { if (confirm('입찰공고번호 연결을 풀고 작성 완료로 되돌릴까요? (나라장터의 실제 공고는 그대로입니다)')) { delete n.g2b; setStatus(n, 'done'); } }
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
    const t = e.target.closest('[data-key]'); if (!t || !t.closest('#noticeMain')) return;
    const n = cur(); if (!n || N.statusOf(n) === 'posted') return;
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
  view().addEventListener('click', onClick);
  view().addEventListener('input', onInput);
  view().addEventListener('focusout', onBlur);
  view().addEventListener('change', (e) => {
    const t = e.target.closest('[data-mkey]'); if (!t) return;
    const n = cur(); if (!n || N.statusOf(n) === 'posted') return;
    const vals = $$(`[data-mkey="${t.dataset.mkey}"]:checked`).map((x) => x.value);
    setVal(t.dataset.mkey, vals.join(', '), true); render();
  });
  view().addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'g2bNo') { e.preventDefault(); const n = cur(); if (n) registerBid(n, e.target.value); } });
  $('#noticeList').addEventListener('keydown', (e) => { const it = e.target.closest('[data-nid]'); if (it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sel = it.dataset.nid; render(); } });

  root.JH.notice = Object.assign(root.JH.notice, {
    async show() { await load(); render(); },
    create, templates, TPL_DIR, slotInfo, uploadSlot, resetSlot, slotPath, KINDS,
    stats() {
      const by = { draft: 0, done: 0, posted: 0 }; store.notices.forEach((n) => by[N.statusOf(n)]++);
      return { count: store.notices.length, recent: store.notices[0] ? store.notices[0].v.공고명 : '', ...by };
    },
    current: () => cur(),
    refresh: () => render(),
    load, fillHwpxBytes,
  });
})(window);
