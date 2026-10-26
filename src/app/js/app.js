/* 계약업무 도우미 — 화면과 동작(처음 화면, 지출서류) */
(function (root) {
  'use strict';
  const L = JH.logic, S = JH.server, R = JH.readers;
  const DB_PATH = '서류대장.json', TEXT_PATH = '서류본문.json', BACKUP_PATH = '서류대장.백업.json', CFG_PATH = '설정.json', INBOX = '미분류';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SRC_LABEL = { 문서함: '문서함', 나라장터: '나라장터', 업체: '업체 제출', 메일: '메일' };
  const KIND_LABEL = { pdf: 'PDF', image: '이미지', hwp: '한글', other: '기타' };

  // ---------- 상태 ----------
  const defaults = L.defaultChecklists();
  const BASE_CFG = { apiKey: '', insttNm: '용인도시공사', insttDivCd: '1', officer: '', months: 6, lastFetch: '' };
  let cfg = { ...BASE_CFG };
  // 기관 공용 설정(설치 묶음의 org.json): 인증키·기관명 등. 각자 설정에 값이 있으면 그것이 우선
  let org = {};
  const filled = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== '' && v != null));
  const mergeCfg = (user) => ({ ...BASE_CFG, ...filled(org), ...filled(user), notice: { ...filled(org.notice), ...filled(user && user.notice) } });
  // 각자 설정 파일에는 공용 값과 다른 것만 저장(공용 인증키를 개인 파일에 복사하지 않음)
  function diffFromOrg(c) {
    const out = {};
    for (const [k, v] of Object.entries(c)) {
      if (k === 'notice') { const n = {}; for (const [nk, nv] of Object.entries(v || {})) if (!org.notice || org.notice[nk] !== nv) n[nk] = nv; if (Object.keys(n).length) out.notice = n; }
      else if (org[k] !== v) out[k] = v;
    }
    return out;
  }
  let db = { version: 1, contracts: {}, docs: [], checklists: null };
  // 계약 화면 위 칸(지출요청일·메모·감사 자료) 펼침 상태 — 이 PC에 기억
  const cardOpen = (() => { try { return JSON.parse(localStorage.getItem('jh.cards') || '{}') || {}; } catch (_) { return {}; } })();
  // 창 구분: 공고문 전용 창(?only=notice)은 서류대장을 읽기만 하고 저장·폴더 읽기·자동 새로고침을 하지 않음(두 창이 서로 덮어쓰지 않게)
  const ONLY = (() => { try { return new URLSearchParams(location.search).get('only') || ''; } catch (_) { return ''; } })();
  const WIN = Math.random().toString(36).slice(2, 10), ROLE = ONLY === 'notice' ? 'notice' : 'main';
  const ui = { view: 'home', sel: null, q: '', officer: '', officerTouched: false, type: '', state: '', board: '', sort: (() => { try { return localStorage.getItem('jh.sort') || 'end-desc'; } catch (_) { return 'end-desc'; } })() };

  const CHECKLIST_VER = 11; // 11: 노무비 미체불 확약서·지급 명세서 찾는 말 · 10: 준공계·준공검사원을 두 칸으로, 준공검사원 지정통보는 필수 아님 · 9: 노무비 지급확인제 → 공사 노무비 구분관리 및 지급확인 적용제외 신청서(합의서도 이 칸) // (지난 것) 4: 선금 보증서 · 5: 준공검사원 지정통보 · 6: 사업장 가입내역 확인서(4대보험 가입증명서) 등 찾는 말 추가 · 7: 하도급 계약서·계약보증서는 그 밖의 계약 서류 · 8: 구매요구에 산업안전재해율 결과·안전보건관리계획서·적격수급업체 안전보건 수준 평가표(공사·용역)
  const lists = (type) => (db.checklists && db.checklists[type]) || defaults[type] || defaults.공사;
  const contracts = () => Object.values(db.contracts).filter((c) => !c.archived);
  // 계약별 서류: 화면을 그리는 동안은 한 번 만든 색인(docIndex)으로 찾음(서류 수천 개여도 계약마다 다시 훑지 않음)
  let docIndex = null, stCache = null;
  const docsOf = (key) => { if (docIndex) return docIndex.get(key) || []; return db.docs.filter((d) => d.key === key); };
  function withIndex(fn) {
    const nested = !!docIndex;
    if (!nested) { docIndex = new Map(); for (const d of db.docs) { if (!d.key) continue; const a = docIndex.get(d.key); if (a) a.push(d); else docIndex.set(d.key, [d]); } stCache = new Map(); }
    try { return fn(); } finally { if (!nested) { docIndex = null; stCache = null; } }
  }
  const inboxDocs = () => db.docs.filter((d) => !d.key);
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const ymd = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  // 파일 없이 갖춘 것으로 보는 서류: 종이 원본(원본) + 이미 받았거나 처리한 서류(받음 — 지난 계약 등)
  const gotMap = (c) => ({ ...(c.originals || {}), ...(c.received || {}) });

  // ---------- 지출 회차(선금·기성·노무비) ----------
  // c.pays = [{ id, kind: adv|prog|labor, n, month, at, paidDate, payMemo, payPlan, received, via }]
  // 회차 서류는 d.pay = 회차 id. d.pay가 없는 서류는 마지막 준공금(기존 서류 목록)
  const roundsOf = (c) => (L.hasRounds(c.type) ? (c.pays || []) : []);
  const KIND_ORDER = { adv: 0, prog: 1, labor: 2 };
  const sortedRounds = (c) => [...roundsOf(c)].sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || ((a.n || 0) - (b.n || 0)) || ((a.at || 0) - (b.at || 0)));
  const roundById = (c, id) => roundsOf(c).find((r) => r.id === id) || null;
  const roundDocs = (c, r) => docsOf(c.key).filter((d) => d.pay === r.id);
  const finalDocs = (c) => docsOf(c.key).filter((d) => !d.pay || !roundById(c, d.pay));
  // 분류할 때 쓰는 서류 목록: 계약 구분 목록 + 회차에만 쓰는 서류(기성계·기성 검사조서·노무비 청구서 …)
  function classList(c) {
    const base = lists(c.type); if (!L.hasRounds(c.type)) return base;
    const ids = new Set(base.map((x) => x.id));
    return base.concat(L.roundOnly(c.type).filter((x) => !ids.has(x.id)));
  }
  // ---------- 계약 폴더 정리 ----------
  // 계약 폴더\0 계약(구매요구·계약·착공·선금 보증서) \1차 기성 \2차 기성 … \노무비 10월분 \선금(회차) \준공(준공계·준공조서·청구·지출결의) \인쇄본
  // 폴더 안 파일 이름 앞에 단계 번호(1_기성계… 2_지정통보… 3_검사조서… 4_청구 서류 5_지출결의) → 탐색기에서 처리 순서대로 보임
  const SUB_CONTRACT = '0 계약', SUB_FINAL = '준공';
  const FINAL_GROUPS = new Set(['준공계', '준공조서', '대금청구', '지출결의', '납품']);
  const LAYOUT_DIR = /^(0 계약|준공|선금|인쇄본|\d+[차회] 기성|노무비 .+|\d+월분 노무비)$/;
  // ---------- 서류 종류 찾기 + 배우기 ----------
  // 1) 배운 규칙(팝업에서 사람이 고른 답) 2) 파일 이름 3) 제목 자리. 제목에 다른 서류 이름도 같이 있으면 '헷갈림' → 팝업으로 물음
  function classifyDoc(c, name, title, heads) {
    const list = classList(c);
    const lr = L.learnedItem(db.learned, list, name, heads);
    if (lr) return { id: lr.id, by: 'learned', alts: [] };
    const ci = L.classifyInfo(list, name, title);
    if (ci.id) return ci;
    // 찾는 말로 못 찾으면: 전에 배운 제목과 거의 같은지(같은 양식인데 글자 인식이 조금 다르게 된 경우) — 확인 팝업에서 확인
    const fz = L.learnedFuzzy(db.learned, list, heads);
    return fz ? { id: fz.id, by: 'learned', alts: [], fuzzy: true } : ci;
  }
  // ---------- 배운 규칙 나누기(GitHub 이슈 댓글) ----------
  // 배우면 잠시 뒤 올리고(한 번에 모아서), 켤 때 다른 PC가 배운 것을 받아 씀(이 PC가 배운 것이 먼저)
  let shareTimer = null; ui.share = ui.share || { state: '' };
  // 나누는 것은 '서류 제목 → 서류 종류' 규칙뿐. 계약·서류 파일·업체·금액은 올리지 않고, 계약명·업체명·사람·번호가 섞인 제목도 이 PC에만 둠
  function privateNames() {
    const out = [];
    for (const c of Object.values(db.contracts || {})) if (c) out.push(c.name, c.vendor, c.officer, c.dept, ...(c.aliases || []));
    return out.filter((x) => x && String(x).trim().length >= 2);
  }
  const shareable = (r, names) => (r.head ? L.shareSafe(r.head, names) : r.file ? L.shareSafe(r.file, names) : false);
  function queueShare(rules) {
    const names = privateNames();
    const ok = rules.filter((r) => shareable(r, names));
    if (!ok.length) return;
    db.sharePending = [...(db.sharePending || []), ...ok.map((r) => ({ head: r.head, file: r.file, suf: r.suf, item: r.item }))].slice(-300);
    clearTimeout(shareTimer); shareTimer = setTimeout(pushShare, 20000);
  }
  async function pushShare() {
    const names = privateNames();
    db.sharePending = (db.sharePending || []).filter((r) => shareable(r, names)); // 예전 버전이 모아 둔 것도 다시 거름
    const p = db.sharePending; if (!p.length || !S.online) return;
    try { const r = await S.sharePost(p); if (r.skipped) { ui.share = { state: 'off', why: r.skipped }; return; } db.sharePending = []; ui.share = { state: 'ok', at: Date.now() }; await saveDb(); }
    catch (e) { ui.share = { state: 'err', why: e.message }; }
  }
  async function pullShare() {
    try {
      const r = await S.shareGet(); if (r.skipped) { ui.share = { state: 'off', why: r.skipped }; return; }
      const mine = new Set((db.learned || []).filter((x) => !x.shared).map((x) => x.head || 'f:' + x.file));
      const got = new Map();
      for (const b of r.bodies || []) { const m = String(b).match(/```json\s*([\s\S]*?)```/); if (!m) continue; try { for (const x of JSON.parse(m[1])) if (x && x.suf && (x.head || x.file)) got.set(x.head || 'f:' + x.file, x); } catch (_) {} }
      const keep = (db.learned || []).filter((x) => !x.shared);
      const add = [...got.entries()].filter(([k]) => !mine.has(k)).map(([, x]) => ({ ...x, shared: true }));
      db.learned = [...add, ...keep].slice(-1500);
      ui.share = { state: 'ok', at: Date.now(), n: add.length };
      if (add.length) { await saveDb(); const n = await applyShared(); if (n) { render(); toast(`동료가 배운 규칙으로 서류 ${n}건의 종류를 정했습니다. [최근 작업]에서 되돌릴 수 있습니다.`, 'ok'); } }
      if ((db.sharePending || []).length) pushShare();
      try { const nq = await JH.rules.pullQa(); if (nq) toast(`동료가 저장한 규정 질문답변 ${nq}건을 받았습니다(규정·질문 → 질문답변 모음).`, 'ok'); } catch (_) {}
    } catch (e) { ui.share = { state: 'err', why: e.message }; }
  }
  // 새로 받은 동료 규칙으로, 계약은 정해졌는데 종류를 못 정했거나 [확인 필요]인 서류를 다시 봄(배운 규칙에 맞을 때만, 사람이 고른 것은 그대로)
  // any=true: 켤 때 — 배운 규칙뿐 아니라 새로 늘어난 찾는 말로도(확실할 때만) 다시 봄
  async function applyShared(any = false) {
    const ds = db.docs.filter((d) => d.key && db.contracts[d.key] && !d.manual && (!d.itemId || d.unsure));
    const hits = ds.map((d) => [d, classifyDoc(db.contracts[d.key], d.name, d.title, d.heads)]).filter(([, r]) => r.id && ((r.by === 'learned' && !r.fuzzy) || (any && !(r.alts && r.alts.length))));
    if (!hits.length) return 0;
    await recorded(any ? '켤 때 서류 종류 다시 정함' : '동료 규칙으로 서류 종류 정함', hits.map(([d]) => d.key), hits.map(([d]) => d.id), async () => {
      for (const [d, r] of hits) { try { await moveDoc(d, d.key, r.id, false, undefined, true); delete d.unsure; delete d.alts; } catch (_) {} }
      await saveDb(true);
    });
    return hits.length;
  }
  // 사람이 고른 답을 배움: 그 서류의 머리 줄(제목)을 그 서류 종류로. 같은 제목을 다르게 고르면 새 답으로 바꿈
  function learnFrom(d, c, itemId) {
    if (!d || !c || !itemId) return '';
    const sig = L.learnSigs(d, c), suf = L.suffixOf(itemId), item = classList(c).find((x) => x.id === itemId);
    if (!sig.heads.length && !sig.name) return '';
    db.learned = (db.learned || []).filter((r) => !sig.heads.includes(r.head) && !(sig.name && r.file === sig.name));
    for (const h of sig.heads) db.learned.push({ head: h, suf, item: item ? item.name : '', from: d.name, at: new Date().toISOString() });
    if (sig.name) db.learned.push({ file: sig.name, suf, item: item ? item.name : '', from: d.name, at: new Date().toISOString() });
    queueShare([...sig.heads.map((h) => ({ head: h, suf, item: item ? item.name : '' })), ...(sig.name ? [{ file: sig.name, suf, item: item ? item.name : '' }] : [])]);
    if (db.learned.length > 800) db.learned.splice(0, db.learned.length - 800);
    const what = sig.heads[0] || sig.name;
    logAct(`배움: 제목 「${what}」 → ${item ? item.name : itemId}`);
    return `다음부터 제목이 「${what.slice(0, 24)}」인 서류는 '${item ? item.name : itemId}'(으)로 넣습니다.`;
  }
  const roundDir = (c, r) => `${folderOf(c)}/${L.safeName(L.roundLabel(r), 30)}`;
  function docPlace(c, itemId, pay) {
    const r = pay ? roundById(c, pay) : null;
    if (r) { const st = L.roundSteps(r.kind, c.type, lists(c.type)); const i = st.findIndex((g) => g.items.some((x) => x.id === itemId)); return { dir: roundDir(c, r), n: i >= 0 ? i + 1 : 0 }; }
    const it = itemId ? classList(c).find((x) => x.id === itemId) : null;
    if (!it) return { dir: folderOf(c), n: 0 }; // 종류를 아직 모르는 서류는 계약 폴더 바로 아래
    const fin = FINAL_GROUPS.has(it.group);
    const groups = [...new Set(lists(c.type).filter((x) => FINAL_GROUPS.has(x.group) === fin).map((x) => x.group))];
    const gi = groups.indexOf(it.group);
    return { dir: `${folderOf(c)}/${fin ? SUB_FINAL : SUB_CONTRACT}`, n: gi >= 0 ? gi + 1 : 0 };
  }
  function addRound(c, kind, o = {}) {
    c.pays = c.pays || [];
    const same = c.pays.filter((x) => x.kind === kind);
    const r = { id: L.uid(), kind, at: Date.now(), received: {}, via: {} };
    if (kind === 'prog') r.n = o.n || (Math.max(0, ...same.map((x) => x.n || 0)) + 1);
    if (kind === 'labor') { r.n = (Math.max(0, ...same.map((x) => x.n || 0)) + 1); if (o.month) r.month = o.month; }
    c.pays.push(r); c.updatedAt = Date.now();
    return r;
  }
  // 서류 하나가 어느 회차로 가는지(없으면 null = 준공 목록). 필요하면 회차를 새로 만듦
  function routeDoc(c, itemId, name, title, forcePay, body) {
    if (!c || !itemId || !L.hasRounds(c.type)) return null;
    if (forcePay) {
      const r = roundById(c, forcePay); if (!r) return null;
      const suf = itemId.replace(/^[csg]-/, ''), map = { finish: 'progfin', notice: 'prognotice', inspect: 'proginsp' };
      return { pay: r.id, itemId: r.kind === 'prog' && map[suf] ? itemId.replace(suf, map[suf]) : itemId };
    }
    const open = sortedRounds(c).filter((r) => !r.paidDate);
    const t = L.routeRound(c.type, itemId, name, title, open, body);
    if (!t) return null;
    let r = t.id ? roundById(c, t.id) : null;
    if (!r) {
      const rs = sortedRounds(c).filter((x) => x.kind === t.kind), openK = rs.filter((x) => !x.paidDate);
      if (t.kind === 'prog' && t.n) r = rs.find((x) => x.n === t.n) || addRound(c, 'prog', { n: t.n });
      else if (t.kind === 'labor' && t.month) r = rs.find((x) => x.month === t.month) || addRound(c, 'labor', { month: t.month });
      else if (t.kind === 'adv') r = rs[0] || addRound(c, 'adv');
      else {
        r = openK[0] || null;
        // 번호 없는 기성계인데 열린 회차에 이미 기성계가 있으면 다음 회차
        if (r && /-(progfin|laborclaim)$/.test(t.itemId) && roundDocs(c, r).some((d) => d.itemId === t.itemId)) r = null;
        if (!r) r = addRound(c, t.kind);
      }
    }
    return { pay: r.id, itemId: t.itemId };
  }
  // 회차 하나의 상태: 단계별로 들어온 서류, 빠진 서류, 증명서 유효기간(기준: 지출 예정일 > 지출일 > 기성 검사조서 + 2주 > 오늘 + 2주), 감독관 경유
  function roundStatus(c, r) {
    const steps = L.roundSteps(r.kind, c.type, lists(c.type));
    const docs = roundDocs(c, r), got = r.received || {}, all = docsOf(c.key);
    const has = (x) => (x.link ? L.hasItem(all, gotMap(c), x.id) || !!got[x.id] : L.hasItem(docs, got, x.id));
    const insp = docs.filter((d) => /-proginsp$/.test(d.itemId || '')).map((d) => dateOfDoc(d, 'inspect')).filter(Boolean).sort().pop();
    const t14 = new Date(); t14.setDate(t14.getDate() + 14);
    const basis = r.payPlan ? { date: r.payPlan, how: '지출 예정일(직접 넣음)', manual: true }
      : r.paidDate ? { date: r.paidDate, how: '지출일' }
      : insp ? { date: L.addDays(insp, 14), how: `기성부분 검사조서 ${L.fmtDate(insp)} + 2주` }
      : { date: ymd(t14), how: '오늘 + 2주 (검사조서가 오면 그 날짜 + 2주로 바뀜)', guess: true };
    const missing = [], certs = [], via = [];
    let adv = null;
    const st = steps.map((g) => {
      const req = g.items.filter((x) => x.required);
      const done = req.filter(has).length;
      req.filter((x) => !has(x)).forEach((x) => missing.push(x));
      for (const x of g.items) {
        if (L.isCertItem(x.id)) {
          const ds = docs.filter((d) => d.itemId === x.id); if (!ds.length) continue;
          const best = ds.map((d) => ({ d, valid: d.validOverride || (d.dates && d.dates.valid) || '' })).filter((v) => v.valid).sort((a, b) => (a.valid < b.valid ? 1 : -1))[0];
          certs.push({ item: x, valid: best ? best.valid : '', status: !best ? 'unknown' : best.valid < basis.date ? 'short' : 'ok', doc: (best || { d: ds[0] }).d });
        }
        if (/-(progfin|laborclaim)$/.test(x.id) && has(x) && !(r.via || {})[x.id]) via.push(x.name);
        if (x.link && L.isAdvBond(x.id) && has(x)) adv = advOf(c);
      }
      return { ...g, req: req.length, done, complete: done === req.length };
    });
    const expired = certs.filter((x) => x.status === 'short');
    const advShort = !!(adv && adv.status === 'short');
    const need = missing.length + expired.length + via.length + (advShort ? 1 : 0);
    const anything = docs.length > 0 || Object.values(got).some(Boolean);
    const state = r.paidDate ? 'paid' : !anything ? 'empty' : need ? 'missing' : 'ready';
    const cur = st.findIndex((g) => !g.complete);
    const reqTotal = st.reduce((a, g) => a + g.req, 0), reqDone = st.reduce((a, g) => a + g.done, 0);
    return { label: L.roundLabel(r), reqTotal, reqDone, steps: st, docs, missing, certs, expired, unknownValid: certs.filter((x) => x.status === 'unknown'), via, adv, advShort, basis, need, state, cur };
  }
  function statusOf(c) {
    if (stCache && stCache.has(c.key)) return stCache.get(c.key);
    const st = statusOf0(c); if (stCache) stCache.set(c.key, st); return st;
  }
  function statusOf0(c) {
    const docs = finalDocs(c);
    const st = L.checklistStatus(lists(c.type), docs, gotMap(c));
    const anything = docs.length > 0 || Object.values(gotMap(c)).some(Boolean);
    const end = L.toDate(c.endDate);
    st.late = !!(end && end < today() && !c.paidDate);
    const v = validity(c);
    st.basis = v.basis; st.certs = v.certs;
    st.expired = v.certs.filter((x) => x.status === 'short');
    st.unknownValid = v.certs.filter((x) => x.status === 'unknown');
    const adv = advOf(c); st.advShort = !!(adv && adv.status === 'short');
    st.need = st.missing.length + st.expired.length + (st.advShort ? 1 : 0);
    st.state = c.paidDate ? 'paid' : !anything ? 'empty' : st.need ? 'missing' : 'ready';
    st.untyped = docs.filter((d) => !d.itemId).length;
    st.origCount = Object.values(c.originals || {}).filter(Boolean).length;
    st.rounds = sortedRounds(c).map((r) => ({ r, s: roundStatus(c, r) }));
    st.roundOpen = st.rounds.find((x) => x.s.state !== 'paid') || null;
    return st;
  }

  // 선금 보증서: 보증기간 끝(직접 넣은 날짜 > 읽은 날짜)이 준공일 + 60일 이상인지
  function advOf(c) {
    const ds = docsOf(c.key).filter((d) => L.isAdvBond(d.itemId));
    if (!ds.length) return null;
    const best = ds.map((d) => ({ d, end: d.validOverride || (d.dates && d.dates.bondEnd) || '' })).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
    return { ...L.advBondCheck(best.end, c.endDate), doc: best.d, item: lists(c.type).find((x) => L.isAdvBond(x.id)) };
  }
  // ---------- 지출요청일과 증명서 유효기간 ----------
  // 기준일: 직접 넣은 지출 예정일 > 지출일 > (준공조서·준공계 중 늦은 날짜) + 2주 > 계약 준공일 + 2주
  const dateOfDoc = (d, kind) => d.dateOverride || (d.dates && (kind === 'inspect' ? d.dates.inspect || d.dates.last : d.dates.finish || d.dates.last)) || '';
  function payBasis(c) {
    if (c.payPlan) return { date: c.payPlan, how: '지출 예정일(직접 넣음)', manual: true };
    if (c.paidDate) return { date: String(c.paidDate).replace(/\D/g, '').slice(0, 8), how: '지출일' };
    const docs = finalDocs(c);
    const pick = (re, kind, label) => docs.filter((d) => re.test(d.itemId || '')).map((d) => ({ date: dateOfDoc(d, kind), label })).filter((x) => x.date);
    const cands = [...pick(/-inspect$/, 'inspect', '준공조서'), ...pick(/-finish$/, 'finish', '준공계')].sort((a, b) => (a.date < b.date ? 1 : -1));
    if (cands[0]) return { date: L.addDays(cands[0].date, 14), how: `${cands[0].label} ${L.fmtDate(cands[0].date)} + 2주` };
    if (c.endDate) return { date: L.addDays(String(c.endDate).replace(/\D/g, '').slice(0, 8), 14), how: `계약 준공일 ${L.fmtDate(c.endDate)} + 2주 (준공계·준공조서가 오면 그 날짜로 바뀜)`, guess: true };
    return null;
  }
  function validity(c) {
    const basis = payBasis(c), docs = finalDocs(c), out = [];
    for (const x of lists(c.type)) {
      if (!L.isCertItem(x.id)) continue;
      const ds = docs.filter((d) => d.itemId === x.id);
      if (!ds.length) { const inn = docs.find((d) => (d.also || []).includes(x.id)); if (inn) out.push({ item: x, valid: inn.validOverride || '', status: inn.validOverride ? (basis && inn.validOverride < basis.date ? 'short' : 'ok') : 'unknown', doc: inn }); continue; }
      // 같은 서류가 여러 개면 가장 오래 유효한 것으로 판단
      const vs = ds.map((d) => ({ d, valid: d.validOverride || (d.dates && d.dates.valid) || '' }));
      const best = vs.filter((v) => v.valid).sort((a, b) => (a.valid < b.valid ? 1 : -1))[0];
      const status = !best ? 'unknown' : basis && best.valid < basis.date ? 'short' : 'ok';
      out.push({ item: x, valid: best ? best.valid : '', status, doc: (best || vs[0]).d });
    }
    return { basis, certs: out };
  }

  // ---------- 저장 ----------
  // 서류대장은 서류 본문(글자)을 뺀 가벼운 파일로 저장하고, 본문은 서류가 늘거나 줄 때만 따로(서류본문.json) 저장
  // → 체크 한 번에 수십 MB를 다시 쓰지 않음. 쓰는 중에 또 바뀌면 끝난 뒤 한 번 더 씀
  let saveTimer = null, saving = Promise.resolve(), textDirty = false, again = false, inFlight = false;
  const dbForSave = () => ({ ...db, docs: db.docs.map((d) => { if (!('text' in d)) return d; const { text, ...rest } = d; return rest; }) });
  const textsForSave = () => { const o = {}; for (const d of db.docs) if (d.text) o[d.id] = d.text; return o; };
  async function writeAll() {
    if (textDirty) { textDirty = false; await S.writeJson(TEXT_PATH, textsForSave(), true); }
    await S.writeJson(DB_PATH, dbForSave(), true);
  }
  function saveDb(now) {
    if (ONLY) return Promise.resolve(); // 공고문 전용 창은 서류대장을 저장하지 않음
    clearTimeout(saveTimer);
    const run = () => {
      if (inFlight) { again = true; return saving; }
      inFlight = true;
      saving = writeAll().catch((e) => toast('서류대장을 저장하지 못했습니다: ' + e.message, 'err')).finally(() => { inFlight = false; if (again) { again = false; run(); } });
      return saving;
    };
    if (now) return run();
    saveTimer = setTimeout(run, 350);
    return saving;
  }
  // 창을 닫거나 숨기면 미뤄 둔 저장을 바로 보냄
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveDb(true); } });
  // 설정 저장. 공고문 전용 창은 다른 창이 바꾼 설정을 덮지 않게 저장된 설정을 다시 읽어 공고문·법령·AI 칸만 바꿔 씀
  const saveCfg = async () => {
    if (!ONLY) return S.writeJson(CFG_PATH, diffFromOrg(cfg));
    const disk = mergeCfg((await S.readJson(CFG_PATH).catch(() => null)) || {});
    for (const k of ['notice', 'lawOC', 'lawList', 'lawFetchedAt', 'aiKey', 'aiModel', 'aiLocalModel', 'aiMode']) if (k in cfg) disk[k] = cfg[k];
    return S.writeJson(CFG_PATH, diffFromOrg(disk));
  };
  // 창 신호: 창마다 id로 '아직 열려 있음'을 알림. 다른 창에서 공고문 전용 창이 열려 있으면 이 창의 공고문 화면은 잠금
  async function pingWin() {
    const info = await S.ping({ w: WIN, role: ROLE });
    if (ROLE === 'main') {
      const other = (info.wins || []).some((x) => x.role === 'notice' && x.w !== WIN);
      if (ui.noticeElsewhere && !other && JH.notice && JH.notice.reload) JH.notice.reload(); // 공고문 창을 닫았으면 그 창에서 쓴 내용을 다시 읽음
      ui.noticeElsewhere = other; const v = $('#view-notice'); if (v) v.classList.toggle('locked', other);
    }
    return info;
  }
  // X로 창을 닫으면 알림 → 열린 창이 하나도 없으면 프로그램이 몇 초 뒤 스스로 꺼짐(새로고침은 바로 다시 들어오므로 안 꺼짐)
  window.addEventListener('pagehide', () => { try { if (S.online) navigator.sendBeacon(`/api/bye?${new URLSearchParams({ t: S.token, w: WIN })}`); } catch (_) {} });

  // ---------- 알림·진행 ----------
  function toast(msg, kind, action) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.innerHTML = `<span>${esc(msg)}</span>`;
    if (action) { const b = document.createElement('button'); b.className = 'link'; b.textContent = action.label; b.onclick = () => { action.run(); t.remove(); }; t.append(b); }
    const box = $('#toasts'); box.append(t);
    while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(() => t.remove(), (action && action.ms) || (kind === 'err' ? 9000 : 5000));
  }
  function progress(text, frac) {
    const p = $('#progress');
    if (text == null) { p.hidden = true; return; }
    p.hidden = false; $('#progressText').textContent = text;
    $('#progressFill').style.width = Math.round((frac || 0) * 100) + '%';
  }
  function banner(html, err) { const b = $('#banner'); if (!html) { b.hidden = true; return; } b.hidden = false; b.className = 'banner' + (err ? ' err' : ''); b.innerHTML = html; }

  // ---------- 계약 ----------
  function folderOf(c) {
    if (!c.folder) c.folder = `계약/${L.safeName(c.name || '계약', 40)}${c.no ? '_' + L.safeName(c.no, 24) : ''}`;
    return c.folder;
  }
  // 같은 계약이 차수(-00, -01)마다 따로 생긴 것을 하나로 합침: 서류·메모·원본/받음 표시를 옮기고 최신 차수 값을 남김
  // 한 계약이 번호 때문에 묶이는 열쇠들: 통합계약번호·계약번호들·차수별 번호·나라장터 변경이력에 나온 차수 번호
  const mergeKeys = (c) => [...new Set([c.untyNo, c.no, ...(c.nums || []), ...Object.values(c.ords || {}).map((o) => o.no), ...(((c.g2b || {}).chgRows) || []).map((r) => r.no)]
    .map(L.baseNo).filter((x) => x && x.length >= 10)),
    // 번호 모양이 달라도(예: 2025012345600, 20250123456-01) 끝 두 자리만 다르고 계약명이 같으면 같은 계약
    ...[c.no, ...(c.nums || [])].map((x) => String(x || '').replace(/\s+/g, '')).filter((x) => !/^[A-Za-z]\d{2}[A-Za-z]{2}\d{8}$/.test(x)).map((x) => x.match(/^(.{9,})-?\d{2}$/)).filter(Boolean).map((m) => `n:${L.norm(m[1])}|${L.norm(c.name || '')}`)];
  // 여러 계약을 하나로: 서류·메모·원본/받음/경유 표시·차수별 값을 옮기고, 금액·준공일은 최신 차수 기준. prefer가 있으면 그 계약을 남김
  function mergeContracts(cs, prefer) {
    const ordC = (c) => Math.max(c.ord == null ? -1 : c.ord, ...(c.nums || []).map((x) => L.ordOf(x) == null ? -1 : L.ordOf(x)), ...Object.keys(c.ords || {}).map(Number));
    cs = [...new Set(cs)].filter(Boolean); if (cs.length < 2) return 0;
    cs.sort((a, b) => (b === prefer) - (a === prefer) || docsOf(b.key).length - docsOf(a.key).length || ordC(b) - ordC(a));
    const keepC = cs[0];
    // 차수를 모르는 계약(번호가 없거나 직접 추가)은 날짜 순서로 차수를 매김: 아는 차수가 있으면 그 뒤에, 없으면 0부터
    const ordMap = new Map(cs.map((c) => [c, ordC(c)]));
    const dateOf = (c) => String(c.chgDt || c.contractDate || c.startDate || '').replace(/\D/g, '').slice(0, 12);
    const known = cs.filter((c) => ordMap.get(c) >= 0), unknown = cs.filter((c) => ordMap.get(c) < 0).sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || (a.updatedAt || 0) - (b.updatedAt || 0));
    let nextOrd = known.length ? Math.max(...known.map((c) => ordMap.get(c)), ...known.flatMap((c) => Object.keys(c.ords || {}).map(Number))) + 1 : 0;
    // 번호 끝 두 자리가 차수인 모양(2025012345601)이면 그 숫자로, 아니면 날짜 순서로 다음 차수
    const tail = (c) => { const m = String(c.no || (c.nums || [])[0] || '').replace(/\s+/g, '').match(/^.{9,}?-?(\d{2})$/); return m ? +m[1] : null; };
    const tails = unknown.map(tail);
    const tailOk = !known.length && tails.every((t) => t != null) && new Set(tails).size === tails.length;
    for (const c of unknown) ordMap.set(c, tailOk ? tail(c) : nextOrd++);
    const newest = [...cs].sort((a, b) => ordMap.get(b) - ordMap.get(a))[0];
    const ords = {};
    for (const c of cs) {
      Object.assign(ords, c.ords || {});
      const o = ordMap.get(c);
      if (ordC(c) < 0) { // 차수를 모르는 계약: 금액·준공일이 있고 이미 있는 차수와 다를 때만 차수 표에 넣음
        if (!(c.amount || c.endDate)) continue;
        if (Object.values(ords).some((x) => x.amount === (c.amount || 0) && x.end === (c.endDate || ''))) continue;
      }
      const no = (c.nums || []).find((x) => L.ordOf(x) === o) || c.no || '';
      ords[o] = ords[o] || L.ordSnap({ ...c, ord: o, no, untyNo: c.untyNo || keepC.untyNo || keepC.key });
    }
    keepC.ords = ords;
    let merged = 0;
    for (const o of cs.slice(1)) {
      db.docs.forEach((d) => { if (d.key === o.key) d.key = keepC.key; });
      keepC.nums = [...new Set([...(keepC.nums || []), ...(o.nums || [])])];
      for (const f of ['originals', 'received', 'edited', 'via']) keepC[f] = { ...(o[f] || {}), ...(keepC[f] || {}) };
      const ck = { ...((o.memo || {}).chgKind || {}), ...((keepC.memo || {}).chgKind || {}) };
      keepC.memo = { ...(o.memo || {}), ...(keepC.memo || {}) }; if (Object.keys(ck).length) keepC.memo.chgKind = ck;
      for (const f of ['paidDate', 'payMemo', 'payPlan', 'folder', 'docVals', 'untyNo', 'ntceNo', 'bizno', 'rep', 'method', 'law', 'lawDtl', 'url', 'corpRaw']) if (!keepC[f] && o[f]) keepC[f] = o[f];
      // 나라장터 세부 정보는 변경이력(차수 표)이 더 긴 쪽을 남김
      if (!keepC.g2b || ((o.g2b || {}).chgRows || []).length > ((keepC.g2b || {}).chgRows || []).length) { if (o.g2b) keepC.g2b = o.g2b; }
      if (ui.sel === o.key) ui.sel = keepC.key;
      delete db.contracts[o.key]; merged++;
    }
    // 금액·준공일 등은 최신 차수 값으로(직접 고른 합치기는 이 계약 값을 두고 빈 칸만 채움)
    if (newest !== keepC) for (const k of ['no', 'amount', 'endDate', 'period', 'chgDt']) if (newest[k] && !(keepC.edited || {})[k] && (!prefer || !keepC[k])) keepC[k] = newest[k];
    keepC.ord = Math.max(...cs.map((c) => ordMap.get(c)));
    keepC.updatedAt = Date.now();
    return merged;
  }
  // 같은 계약이 차수(-00, -01)마다 따로 생긴 것을 하나로 합침 — 번호 열쇠가 하나라도 겹치면 같은 계약으로 봄(묶음끼리도 이어 붙임)
  function mergeSameContracts() {
    const byKey = new Map(), parent = new Map();
    const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(a, b); };
    for (const c of Object.values(db.contracts)) {
      parent.set(c.key, c.key);
      for (const b of mergeKeys(c)) { if (byKey.has(b)) union(c.key, byKey.get(b)); else byKey.set(b, c.key); }
    }
    const groups = new Map();
    for (const c of Object.values(db.contracts)) { const r = find(c.key); (groups.get(r) || groups.set(r, []).get(r)).push(c); }
    let merged = 0;
    for (const cs of groups.values()) if (cs.length >= 2) merged += mergeContracts(cs);
    if (merged) { saveDb(true); setTimeout(() => toast(`차수(-00, -01)만 다른 같은 계약 ${merged}건을 하나로 합쳤습니다.`, 'ok'), 500); }
    return merged;
  }
  function upsertContract(n) {
    // 계약번호가 하나라도 같으면 같은 계약
    const nb = (n.nums || []).map(L.baseNo).filter((x) => x.length >= 6);
    let ex = Object.values(db.contracts).find((c) => (c.nums || []).some((x) => nb.includes(L.baseNo(x))));
    if (!ex && !nb.length && n.name) ex = Object.values(db.contracts).find((c) => L.norm(c.name) === L.norm(n.name));
    if (ex) {
      const keep = ex.edited || {};
      // 같은 계약의 예전 차수(-00)가 나중에 와도 최신 차수(-01) 값을 덮지 않음(빈 칸만 채움)
      const older = n.ord != null && ex.ord != null && n.ord < ex.ord;
      for (const k of ['type', 'name', 'vendor', 'no', 'amount', 'contractDate', 'startDate', 'endDate', 'period', 'officer', 'dept', 'org', 'url', 'method', 'law', 'lawDtl', 'rep', 'bizno', 'ntceNo', 'untyNo', 'chgDt', 'corpRaw']) {
        if (!keep[k] && n[k] && (!older || !ex[k])) ex[k] = n[k];
      }
      if (n.ord != null) ex.ords = { ...(ex.ords || {}), [n.ord]: L.ordSnap(n) };
      if (n.ord != null && (ex.ord == null || n.ord > ex.ord)) ex.ord = n.ord;
      if (n.budgetAuto) { ex.budgetAuto = n.budgetAuto; ex.budgetWhy = n.budgetWhy || ''; }
      ex.nums = [...new Set([...(ex.nums || []), ...(n.nums || [])])];
      if (n.source === 'api') ex.source = 'api';
      ex.updatedAt = Date.now();
      return { c: ex, created: false };
    }
    let key = n.key || L.contractKey(n);
    while (db.contracts[key]) key += '_';
    const c = { originals: {}, paidDate: '', payMemo: '', archived: false, edited: {}, ...n, key, updatedAt: Date.now() };
    if (n.ord != null) c.ords = { [n.ord]: L.ordSnap(n) };
    db.contracts[key] = c;
    return { c, created: true };
  }

  // ---------- 업로드 ----------
  // 서류 → 계약: 번호·계약명·업체로 점수를 매기고, 동점(예: 통장사본처럼 업체 이름만 있는데 그 업체 계약이 여럿)이면
  //  ① 함께 올린 다른 서류가 한 계약으로 갔으면 그 계약 ② 아직 지출 안 했고 준공이 지난 계약이 하나면 그 계약 ③ 아니면 미분류
  let batchKeys = new Set();
  function pickContract(hay, r) {
    const { top } = L.matchCandidates(contracts(), hay);
    if (top.length === 1) return top[0];
    if (!top.length) return null;
    // 같은 업체 계약이 여럿이라 하나로 정해지지 않으면: 같이 올린 서류들이 한 계약으로 가는 경우만 그 계약, 아니면 미분류(임의로 고르지 않음 → 팝업에서 고름)
    const inBatch = top.filter((c) => batchKeys.has(c.key));
    if (inBatch.length === 1) return inBatch[0];
    return null;
  }
  // 정리된 사본의 파일 이름: "서류명_계약명.확장자"(예: 견적서(계약금액)_시청사 옥상 방수공사.pdf). 같은 이름이 있으면 (2), (3)…
  //  원래 이름이 뜻이 있는 이름(noname·scan·숫자·download 같은 것이 아님)이면 뒤에 붙여 둠. 내려받은 원본 파일은 건드리지 않음
  function tidyName(item, c, orig, n) {
    if (!item) return orig;
    orig = String(orig).replace(/^\d{1,2}_/, ''); // 예전에 붙인 단계 번호는 떼고 다시 붙임
    const ext = (String(orig).match(/\.[A-Za-z0-9]{2,5}$/) || [''])[0].toLowerCase();
    const stem = L.stem(orig).trim();
    const junk = /^(noname|scan|scanned|image|img|download|document|file|문서|새\s*문서|제목\s*없음|kakaotalk|캡처|스캔|복사본)?[\s_\-()\d]*$/i.test(stem) || /^(noname|scan|img|image|download|kakaotalk)[\s_\-()\d]*/i.test(stem);
    const itemNm = L.safeName(item.name, 30), cName = c ? L.safeName(c.name || '', 40) : '';
    const keep = !junk && !L.norm(stem).includes(L.norm(itemNm)) ? `_${L.safeName(stem, 40)}` : '';
    return `${n ? n + '_' : ''}${itemNm}${cName ? '_' + cName : ''}${keep}${ext}`;
  }
  // 확인 팝업 띄우기: 다른 창(설정·계약 수정 등)이 열려 있으면 기다렸다가 그 창을 닫는 즉시 띄움. 이미 확인 팝업이 떠 있으면 뒤에 이어 붙임
  let askQueue = [];
  const keepSeen = new Set(); // 계약을 정해 넣은 파일 — 팝업에서 넘겨도 미분류로 옮기지 않음
  const dupSeen = new Set(); // 다시 올린(이미 있는) 파일 — 팝업에서 지금 자리를 보여 주고, 저장 안 하고 넘겨도 그 자리 그대로
  function askLater(ids) {
    ids = ids.filter((id) => docById(id));
    if (!ids.length) return;
    const pvOpen = $('#dlgPreview').open;
    if (pvOpen && pv.confirm) { for (const id of ids) if (!pv.ids.includes(id)) pv.ids.push(id); $('#pvTitle').textContent = `맞는지 확인해 주세요 (${pv.i + 1}/${pv.ids.length})`; $('#pvNext').textContent = pv.i < pv.ids.length - 1 ? '다음' : '닫기'; return; }
    askQueue = [...new Set([...askQueue, ...ids])];
    setTimeout(flushAsk, 300);
  }
  function flushAsk() {
    if (!askQueue.length || document.querySelector('dialog[open]')) return;
    const ids = askQueue.filter((id) => docById(id)); askQueue = [];
    if (ids.length) openPreview(ids, 0, true);
  }
  document.addEventListener('close', (e) => { if (e.target && e.target.tagName === 'DIALOG') setTimeout(flushAsk, 150); }, true);
  // 파일이 여러 개인 게 보통인 칸(수정본을 묻지 않음)
  const MULTI_ITEM = /-(related|agent|photo|result|roster|laborlist|bizreg|license|licbook)$/;
  async function ingest(fileList, forceKey, forceItem, opt = {}) {
    const files = [...fileList].filter((f) => f && f.name && !f.name.startsWith('.') && !/^(thumbs\.db|desktop\.ini)$/i.test(f.name));
    if (!files.length) return;
    if (!S.online) { toast('바탕화면의 "계약업무 도우미" 아이콘으로 실행해야 서류를 저장할 수 있습니다.', 'err'); return; }
    // 여러 파일을 올리고 하나씩 확인할 때: 다 읽을 때까지 기다리지 않고 한 파일씩 읽어 바로 팝업 — 확인하는 동안 나머지는 뒤에서 읽어 팝업 뒤에 붙임
    if (!opt.one && files.length > 1 && !opt.onlyMatched && cfg.uploadConfirm !== false) {
      const order = [...files].sort((a, b) => (/계약서/.test(b.name) - /계약서/.test(a.name))); // 계약서 먼저(계약을 먼저 찾게)
      for (let i = 0; i < order.length; i++) await ingest([order[i]], forceKey, forceItem, { ...opt, one: { i, n: order.length } });
      toast(`${order.length}개 파일을 모두 읽었습니다.${$('#dlgPreview').open ? ' 확인 팝업에서 차례로 확인하세요.' : ''}`, 'ok', undoAction());
      return;
    }
    const recs = []; let skipped = 0; const dupWhere = []; const dupIds = []; const again = [];
    const snap0 = snapshot([], [], true);
    try {
      // 1) 읽기
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        progress(opt.one ? `내용 읽는 중 ${opt.one.i + 1}/${opt.one.n}${$('#dlgPreview').open ? ' — 확인하는 동안 뒤에서 읽음' : ''}` : `내용 읽는 중 ${i + 1}/${files.length}`, opt.one ? opt.one.i / opt.one.n : i / files.length);
        const dup = db.docs.find((d) => d.name === f.name && d.size === f.size);
        // 이미 올린 파일: 다 정리된 것만 건너뜀. 종류를 못 정했거나 확인 필요·미분류이면 다시 보고, 다른 계약에 놓았으면 그 계약으로 옮김
        if (dup) {
          const fk = forceKey && db.contracts[forceKey];
          if ((fk && dup.key !== fk.key) || !dup.key || !dup.itemId || dup.unsure) { if (!again.includes(dup)) again.push(dup); continue; }
          skipped++; dupWhere.push(`「${f.name}」은 이미 ${whereOf(dup)}에 있음`); dupIds.push(dup.id); continue;
        }
        const bytes = new Uint8Array(await f.arrayBuffer());
        const kind = L.kindOf(f.name);
        const { lines, ocr } = await R.read(bytes, kind, f.type);
        recs.push({
          id: L.uid(), name: f.name, kind, size: f.size, mime: f.type, bytes, ocr, lines,
          meta: L.findMeta(lines), text: L.maskPrivate(L.norm(lines.join(' ')).slice(0, 6000)), title: L.maskPrivate(L.norm(lines.slice(0, 8).join(' ')).slice(0, 300)), heads: L.headLines(lines),
          dates: L.extractDates(lines),
        });
      }
      // 2) 계약서가 있으면 먼저 계약을 찾거나 만듦
      const forced = forceKey ? db.contracts[forceKey] : null;
      let newContracts = 0;
      for (const r of recs) {
        r.prov = L.classifyItem(defaults.공사, r.name, r.title);
        if (forced || r.prov !== 'c-contract') continue;
        const hay = L.norm(L.stem(r.name)) + '|' + r.text;
        let c = L.matchContract(contracts(), hay);
        // 맞는 계약이 없으면 계약서에서 새 계약을 만듦 — 단, 나라장터 계약번호(R26…)를 읽었거나 계약명이 멀쩡할 때만.
        // 스캔본은 글자 인식이 깨지기 쉬워 계약번호가 있을 때만. 아니면 미분류로 두고 팝업에서 고르게
        // 나라장터 인증키가 있으면 계약 목록(나라장터) 기준으로만 맞추고 서류로 새 계약은 만들지 않음 → 미분류·팝업에서 목록 중 고름
        const okNo = L.isG2bNo(r.meta.no), okName = !r.ocr && L.goodName(r.meta.name);
        if (!c && !cfg.apiKey && (okNo || okName)) {
          const name = L.goodName(r.meta.name) ? r.meta.name : (L.goodName(L.stem(r.name)) ? L.stem(r.name) : `계약번호 ${r.meta.no}`);
          const res = upsertContract({ source: 'doc', type: L.guessType(r.title), name, vendor: L.goodName(r.meta.vendor) || (r.meta.vendor && !r.ocr) ? r.meta.vendor : '',
            nums: okNo ? [r.meta.no] : [], no: okNo ? r.meta.no : '', officer: cfg.officer || '' });
          c = res.c; if (res.created) newContracts++;
        }
        if (c) r.key = c.key;
      }
      // 3) 나머지 서류는 내용으로 계약 찾기 → 서류 종류 → 저장
      // 먼저 확실히 한 계약으로 가는 서류를 모아 두고(같이 올린 묶음), 애매한 서류는 그 묶음 계약 쪽으로
      batchKeys = new Set(recs.map((r) => r.key || (() => { const m = L.matchCandidates(contracts(), L.norm(L.stem(r.name)) + '|' + r.text); return m.top.length === 1 ? m.top[0].key : null; })()).filter(Boolean));
      const byContract = {}, auditLines = {}, roundsHit = new Set(); let inbox = 0, multiForm = 0;
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        progress(`정리하는 중 ${i + 1}/${recs.length}`, i / recs.length);
        let c = forced || (r.key && db.contracts[r.key]) || pickContract(L.norm(L.stem(r.name)) + '|' + r.text, r);
        // 계약을 정하지 못했으면 점수가 같은 후보(같은 업체 계약 등)를 남겨 두고 팝업에서 '추천'으로 먼저 보여 줌
        if (!c) { const g0 = L.classifyInfo(defaults.공사, r.name, r.title).id || L.classifyInfo(defaults.용역, r.name, r.title).id || L.classifyInfo(defaults.물품, r.name, r.title).id; if (g0) r.guess = L.suffixOf(g0); }
        if (!c) { const m = L.matchCandidates(contracts(), L.norm(L.stem(r.name)) + '|' + r.text); r.cands = m.top.sort((a, b) => (!!a.paidDate - !!b.paidDate) || (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6).map((x) => x.key); }
        // 계약 화면 안에서 올린 서류는 그 계약으로(다른 계약으로 보내지 않음). 오른쪽 위 [업로드]는 전체 계약에서 찾아 정리
        const info = c && !(forced && forceItem) ? classifyDoc(c, r.name, r.title, r.heads) : null;
        let itemId = c ? (forced && forceItem ? forceItem : info.id) : null;
        r.unsure = !!(info && info.id && ((info.alts && info.alts.length) || info.fuzzy)); r.alts = r.unsure ? info.alts : null; r.learned = !!(info && info.by === 'learned');
        // 한 파일에 여러 양식(착공계 묶음 등): 쪽마다 서류 이름을 찾아 함께 든 서류로 표시
        let also = [], pagesOf = null;
        if (c && !(forced && forceItem)) { // 칸에 직접 넣은 것은 쪽마다 읽지 않음(빠르게)
          try {
            progress(`여러 양식이 든 파일인지 보는 중 ${i + 1}/${recs.length}`, i / recs.length);
            const heads = await R.pageHeads(r.bytes, r.kind, { ocrMax: 12, onPage: (p, n) => { if (n > 2) progress(`여러 양식이 든 파일인지 보는 중 — ${p}/${n}쪽 (스캔본은 쪽마다 몇 초)`, p / n); } }); r.pages = heads ? heads.total : null;
            pagesOf = heads ? L.classifyPages(classList(c), heads) : r.kind === 'hwp' ? L.classifyTitleLines(classList(c), r.lines) : null;
          } catch (e) { console.warn('쪽별 서류 찾기 실패', e); }
          // 파일 이름에 서류가 여럿이면(견적서_산출내역.pdf) 그것도 함께 든 서류로
          const named = forced && forceItem ? [] : L.itemsInName(classList(c), r.name);
          if (named.length > 1) { pagesOf = pagesOf || {}; for (const id of named) if (!pagesOf[id]) pagesOf[id] = []; }
          if (pagesOf) {
            const ids = Object.keys(pagesOf);
            if (!itemId && ids.length) itemId = ids.sort((a, b) => ((pagesOf[a][0] || 999) - (pagesOf[b][0] || 999)))[0];
            also = ids.filter((id) => id !== itemId);
          }
        }
        // 내려받은 폴더에서 온 파일: 우리 계약과 맞지 않으면(다른 공고문·개인 파일 등) 가져오지 않음
        // 내려받은 폴더에서 온 파일: 계약도 서류 종류도 모르면(다른 공고문·개인 파일 등) 가져오지 않음.
        // 착공계·청구서처럼 서류 종류는 알아보겠는데 계약만 못 찾았으면 미분류에 넣고 팝업으로 물음
        if (opt.onlyMatched && !c && !(L.classifyItem(defaults.공사, r.name, r.title) || L.classifyItem(defaults.용역, r.name, r.title) || L.classifyItem(defaults.물품, r.name, r.title))) { r.ignored = true; continue; }
        // 선금·기성·노무비 서류면 그 회차로(회차가 없으면 만듦). 회차 서류는 계약 폴더 안 회차 폴더에
        const rt = c && itemId ? routeDoc(c, itemId, r.name, r.title, forced && forced.key === c.key ? opt.pay : null, r.text) : null;
        if (rt) { itemId = rt.itemId; also = also.filter((id) => id !== itemId); }
        const rnd = rt ? roundById(c, rt.pay) : null;
        if (rnd) roundsHit.add(c.key + '|' + rnd.id);
        const item = c && itemId ? classList(c).find((x) => x.id === itemId) : null;
        const place = c ? docPlace(c, item ? item.id : null, rnd ? rnd.id : null) : { dir: INBOX, n: 0 };
        const dir = place.dir;
        const fname = tidyName(item, c, r.name, place.n);
        const saved = await S.save(dir, fname, r.bytes);
        // 같은 칸에 이미 서류가 있으면(사진대지·자격증처럼 여러 장이 보통인 칸 빼고) 수정본인지 팝업으로 물음
        const prev = c && item && !MULTI_ITEM.test(item.id) ? db.docs.find((x) => x.key === c.key && x.itemId === item.id && (x.pay || null) === (rnd ? rnd.id : null)) : null;
        textDirty = true; db.docs.push({
          ...(prev ? { revOf: prev.id } : {}),
          id: r.id, key: c ? c.key : null, itemId: item ? item.id : null, path: saved.path, name: r.name, kind: r.kind,
          size: r.size, mime: r.mime, addedAt: new Date().toISOString(), ocr: r.ocr, meta: r.meta, text: r.text, title: r.title, dates: r.dates, manual: !!forced && !r.rerouted, facts: L.docFacts(r.lines),
          ...(rnd ? { pay: rnd.id } : {}), ...(!c && r.cands && r.cands.length ? { cands: r.cands } : {}), ...(!c && r.guess ? { guess: r.guess } : {}), ...(r.heads && r.heads.length ? { heads: r.heads } : {}), ...(r.unsure ? { unsure: true, alts: r.alts } : {}),
          ...(also.length ? { also, pagesOf } : {}), ...(r.pages > 1 ? { pages: r.pages } : {}),
        });
        if (c) { byContract[c.key] = (byContract[c.key] || 0) + 1; c.updatedAt = Date.now(); } else inbox++;
        if (c && item && (AUDIT_DOC.test(item.id) || also.some((id) => AUDIT_DOC.test(id)))) (auditLines[c.key] = auditLines[c.key] || []).push(r.lines);
        if (also.length) multiForm++;
      }
      // 3-0) 다시 올린(이미 있던) 서류: 놓은 계약으로 옮기거나, 지금 규칙(배운 것 포함)으로 다시 분류. 그래도 모르면 팝업으로
      let againDone = 0;
      for (const d of again) {
        try {
          const c = forced || (d.key && db.contracts[d.key]) || null;
          if (!c) continue; // 계약을 모르면 팝업에서 추천과 함께 고르게
          const info = forced && forceItem ? { id: forceItem, alts: [] } : classifyDoc(c, d.name, d.title, d.heads);
          const sure = info.id && !(info.alts && info.alts.length);
          if (c.key !== d.key || (sure && info.id !== d.itemId)) {
            await moveDoc(d, c.key, info.id || null, !!forced, undefined, true);
            if (forced) delete d.cands;
          }
          if (sure) { delete d.unsure; delete d.alts; againDone++; } else if (info.id) { d.unsure = true; d.alts = info.alts; }
          byContract[c.key] = (byContract[c.key] || 0) + 1; c.updatedAt = Date.now();
        } catch (e) { console.warn('다시 정리 실패', d.name, e); }
      }
      // 3-1) 견적서·설계내역서·사업자등록증 등에서 감사·검사 칸(예정가격·설계금액·주소·대표자)을 바로 채움(비어 있을 때만)
      let auditFilled = 0;
      for (const [k, ls] of Object.entries(auditLines)) auditFilled += fillAuditFrom(db.contracts[k], ls);
      await saveDb(true);
      // 4) 알림
      const parts = Object.entries(byContract).map(([k, n]) => `${db.contracts[k].name} ${n}`);
      if (inbox) parts.push(`미분류 ${inbox}`);
      const ignored = recs.filter((r) => r.ignored).length;
      // 자동 읽기에서 계약도 서류 종류도 못 찾아 가져오지 않은 파일: 말없이 버리지 않고 알림 + [그래도 가져오기](미분류로 넣고 팝업)
      const ign = recs.filter((r) => r.ignored);
      const tellIgnored = () => {
        if (!ign.length) return;
        ign.forEach((r) => logAct(`자동 읽기 건너뜀(계약·서류 종류 모름): 「${r.name}」`)); saveDb(true);
        const files = ign.map((r) => new File([r.bytes], r.name, { type: r.mime || '' }));
        const names = ign.slice(0, 2).map((r) => `「${r.name}」`).join(', ') + (ign.length > 2 ? ` 외 ${ign.length - 2}개` : '');
        setTimeout(() => toast(`${opt.from || '자동 읽기'}: ${names}은(는) 계약·서류 종류를 찾지 못해 가져오지 않았습니다(스캔 글자를 못 읽었거나 계약과 상관없는 파일). 계약 서류면 [그래도 가져오기]를 누르세요.`, 'err',
          { label: '그래도 가져오기', ms: 30000, run: () => ingest(files, null, null, {}) }), 600);
      };
      if (opt.onlyMatched && ignored === recs.length) { tellIgnored(); return; }
      const nDone = recs.length - ignored + again.length;
      // 이미 있는 파일을 직접 다시 올렸으면(확인 켜짐): 말없이 넘기지 않고 지금 자리를 팝업으로 보여 줌 — 잘못 들어가 있으면 거기서 고침
      const askDup = !opt.onlyMatched && cfg.uploadConfirm !== false ? dupIds.filter((id) => docById(id)) : [];
      askDup.forEach((id) => { dupSeen.add(id); keepSeen.add(id); });
      if (!nDone && skipped) { toast((opt.from ? `${opt.from}의 ` : '') + `같은 파일이 이미 있어 새로 넣지 않았습니다: ${dupWhere.slice(0, 2).join(', ')}${dupWhere.length > 2 ? ` 외 ${dupWhere.length - 2}개` : ''}.${askDup.length ? ' 지금 자리를 팝업으로 보여 드립니다.' : ''}`); dupWhere.forEach((x) => logAct('올림 건너뜀: ' + x)); if (askDup.length) askLater(askDup); return; }
      let msg = (opt.from ? `${opt.from}에서 ` : '') + `${nDone}개 정리했습니다` + (parts.length ? ` — ${parts.join(', ')}` : '') + '.';
      if (again.length) msg += ` 전에 올렸던 파일 ${again.length}개는 다시 정리했습니다${againDone < again.length ? `(${again.length - againDone}개는 확인 필요)` : ''}.`;
      if (ignored) { msg += ` 계약·서류 종류를 못 찾은 파일 ${ignored}개는 가져오지 않았습니다.`; tellIgnored(); }
      if (newContracts) msg += ` 계약서에서 새 계약 ${newContracts}건을 만들었습니다.`;
      if (auditFilled) msg += ` 서류에서 감사·검사 칸 ${auditFilled}개를 채웠습니다.`;
      if (multiForm) msg += ` 여러 양식이 든 파일 ${multiForm}개는 안에 든 서류마다 표시했습니다(파일 줄의 [나누기]로 서류마다 따로 자를 수 있음).`;
      if (roundsHit.size) msg += ` 지출 회차: ${[...roundsHit].map((k) => { const [ck, rid] = k.split('|'); const rc = db.contracts[ck], rr = rc && roundById(rc, rid); if (!rr) return ''; const rs = roundStatus(rc, rr); return `${L.roundLabel(rr)} 서류 ${rs.reqDone}/${rs.reqTotal}${rs.cur >= 0 ? ` (다음: ${(NEXT[rr.kind] || [])[rs.cur] || rs.steps[rs.cur].name})` : ''}`; }).filter(Boolean).join(', ')}.`;
      const moved = recs.filter((r) => r.rerouted).length;
      if (moved) msg += ` ${moved}개는 내용이 다른 계약 서류라 그 계약으로 보냈습니다.`;
      if (skipped) msg += ` 이미 있는 파일 ${skipped}개는 건너뛰었습니다(${dupWhere.slice(0, 2).join(', ')}${dupWhere.length > 2 ? ' 외' : ''}).`;
      // 최근 작업: 파일마다 어디로 갔는지 + 이번 올림 전체를 한 번에 되돌릴 수 있게
      const placed = recs.filter((r) => !r.ignored).map((r) => db.docs.find((d) => d.id === r.id)).filter(Boolean);
      dupWhere.forEach((x) => logAct('올림 건너뜀: ' + x));
      again.forEach((d) => logAct(`다시 정리 「${d.name}」 → ${whereOf(d)}`));
      if (placed.length || again.length) { placed.forEach((d) => logAct(`올림 「${d.name}」 → ${whereOf(d)}`)); undoStack.push({ label: `서류 ${placed.length + again.length}개 올림`, s: snap0, at: Date.now() }); if (undoStack.length > 30) undoStack.shift(); paintUndo(); }
      if (R.ocrBroken) msg += ' 스캔본 글자 인식을 시작하지 못해 일부는 미분류로 갔습니다.';
      // 어느 계약인지·어떤 서류인지 못 찾은 것은 바로 팝업으로 보여 주고 고르게 함
      // 확인할 것: 계약·종류를 못 정함, 헷갈림, 같은 칸에 이미 서류가 있음(수정본?). 자동으로 읽은 폴더에서 온 것은 모두 확인(설정에서 끌 수 있음)
      // 올린 파일은 모두 확인 팝업으로 보여 줌(설정 → 서류 목록 '올릴 때마다 확인'으로 끌 수 있음). 자동으로 읽은 폴더는 따로 '자동으로 가져온 서류 확인'
      const confirmAll = opt.onlyMatched ? cfg.watchConfirm !== false : cfg.uploadConfirm !== false;
      // 서류 칸에 직접 넣은 것(계약·서류 종류를 사람이 정함)은 묻지 않음(수정본인지만 물음). 계약을 정해 넣은 것은 팝업에서 넘겨도 그 계약에 그대로
      const direct = !!(forced && forceItem);
      const unsure = [...recs.filter((r) => !r.ignored).map((r) => r.id), ...again.map((d) => d.id)].filter((id) => db.docs.some((d) => d.id === id && (direct ? d.revOf : (confirmAll || !d.key || !d.itemId || d.unsure || d.revOf))));
      if (forced) unsure.forEach((id) => keepSeen.add(id));
      const nLearned = recs.filter((r) => r.learned).length;
      if (nLearned) msg += ` ${nLearned}개는 전에 배운 대로 넣었습니다.`;
      if (!opt.one) toast(msg, inbox ? '' : 'ok', unsure.length ? { label: '확인하기', run: () => openPreview(unsure, 0, true) } : recs.length || again.length ? undoAction() : null);
      if (unsure.length || askDup.length) askLater([...unsure, ...askDup]);
      const keys = Object.keys(byContract);
      if (!forced && !opt.onlyMatched && keys.length === 1) ui.sel = keys[0]; // 폴더에서 자동으로 읽은 것은 보던 계약 화면을 바꾸지 않음
    } catch (e) {
      console.error(e); toast('서류를 정리하지 못했습니다: ' + e.message, 'err');
    } finally { progress(null); render(); }
  }
  // 마지막으로 불러온 때(새로고침 버튼 풍선말·목록 아래)
  function fetchStamp() {
    const d = cfg.lastFetch ? new Date(cfg.lastFetch) : null;
    if (!d || isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 서류를 다른 계약·종류로 옮김(파일도 해당 폴더로 이동)
  async function moveDoc(d, key, itemId, manual = true, pay, noSave) {
    const c = key ? db.contracts[key] : null;
    const list = c ? classList(c) : [];
    const item = itemId ? list.find((x) => x.id === itemId) : null;
    // 회차: 다른 계약으로 가면 풂, pay를 주면 그 회차로('' = 준공 목록)
    if (pay !== undefined) { if (pay) d.pay = pay; else delete d.pay; }
    if (!c || c.key !== d.key) delete d.pay;
    const rnd = c && d.pay ? roundById(c, d.pay) : null; if (!rnd) delete d.pay;
    const place = c ? docPlace(c, item ? item.id : null, rnd ? rnd.id : null) : { dir: INBOX, n: 0 };
    const dir = place.dir;
    const name = tidyName(item, c, d.name, place.n);
    const r = await S.move(d.path, dir, name);
    d.path = r.path;
    if (d.pdfPath) { try { const p = await S.move(d.pdfPath, dir, L.stem(name) + '.pdf'); d.pdfPath = p.path; } catch (_) { d.pdfPath = ''; } }
    d.key = c ? c.key : null; d.itemId = item ? item.id : null; d.manual = manual;
    if (c && !noSave) c.updatedAt = Date.now();
    if (!noSave) await saveDb(true);
  }
  async function removeDoc(d) {
    const r = await S.remove(d.path); let pr = null; if (d.pdfPath) { try { pr = await S.remove(d.pdfPath); } catch (_) {} }
    trashed.set(d.id, { doc: d, path: r && r.path, pdf: pr && pr.path });
    db.docs = db.docs.filter((x) => x !== d); textDirty = true; await saveDb(true);
    toast(`"${d.name}"을 빼고 데이터 폴더의 _삭제됨으로 옮겼습니다.`);
  }
  // 미분류를 다시 자동 분류(계약 목록을 새로 불러온 뒤 등)
  async function rematchInbox() {
    let moved = 0;
    for (const d of inboxDocs()) {
      if (d.manual) continue;
      const c = L.matchContract(contracts(), L.norm(L.stem(d.name)) + '|' + (d.text || ''));
      if (!c) continue;
      await moveDoc(d, c.key, classifyDoc(c, d.name, d.title, d.heads).id, false); moved++;
    }
    return moved;
  }

  // ---------- 폴더 정리 상태 맞추기 ----------
  // 탐색기에서 계약 폴더 이름을 바꾸거나 옮긴 파일을 이름·크기로 다시 찾고, 직접 넣은 파일은 읽어서 분류
  const DOC_EXT = /\.(pdf|jpe?g|png|gif|bmp|webp|hwpx?|xlsx|xls|docx)$/i;
  // ---------- 되돌리기(직전 작업) + 최근 작업 ----------
  // 작업 전에 그 계약(들)과 서류 상태를 떠 두고, [되돌리기]하면 그대로 돌려놓음(파일도 원래 폴더·이름으로).
  // 올린 서류는 지움(_삭제됨으로), 빼기한 서류는 _삭제됨에서 다시 꺼냄. 최근 작업 목록에는 서류가 어디로 갔는지 남김
  const undoStack = [], trashed = new Map();
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const dirOf = (p) => String(p || '').split('/').slice(0, -1).join('/'), baseOf = (p) => String(p || '').split('/').pop();
  function snapshot(keys, docIds = [], all = false) {
    keys = [...new Set((keys || []).filter(Boolean))];
    const ids = new Set(docIds.filter(Boolean));
    const docs = db.docs.filter((d) => all || keys.includes(d.key) || ids.has(d.id));
    return { all, keys, contracts: all ? clone(db.contracts) : Object.fromEntries(keys.map((k) => [k, clone(db.contracts[k] || null)])),
      docs: docs.map((d) => ({ ...d })), ids: new Set(db.docs.map((d) => d.id)) };
  }
  let recording = 0;
  async function recorded(label, keys, docIds, fn, opt = {}) {
    if (recording) return fn();
    const s = snapshot(keys, docIds, opt.all); recording++;
    try { const r = await fn(); pushUndo(label, s); return r; } finally { recording--; }
  }
  function pushUndo(label, s) {
    undoStack.push({ label, s, at: Date.now() }); if (undoStack.length > 30) undoStack.shift();
    logAct(label); paintUndo();
  }
  function logAct(text) { db.log = db.log || []; db.log.push({ at: new Date().toISOString(), text }); if (db.log.length > 300) db.log.splice(0, db.log.length - 300); }
  function paintUndo() { const b = $('#btnUndo'); if (!b) return; const u = undoStack[undoStack.length - 1]; b.disabled = !u; b.title = u ? `되돌리기: ${u.label} (Ctrl+Z)` : '되돌릴 작업이 없습니다'; }
  async function undo() {
    const u = undoStack.pop(); if (!u) { toast('되돌릴 작업이 없습니다.'); return; }
    const s = u.s;
    try {
      progress('되돌리는 중', .5);
      // 1) 작업 뒤에 생긴 서류(올림 등): 파일을 _삭제됨으로 옮기고 목록에서 뺌
      const fresh = db.docs.filter((d) => !s.ids.has(d.id) && (s.all || s.keys.includes(d.key) || (!d.key && s.keys.includes(null))));
      for (const d of (s.all ? db.docs.filter((x) => !s.ids.has(x.id)) : fresh)) { try { await S.remove(d.path); if (d.pdfPath) await S.remove(d.pdfPath); } catch (_) {} }
      db.docs = db.docs.filter((d) => s.ids.has(d.id));
      // 2) 그때 있던 서류: 빼기했으면 _삭제됨에서 꺼내고, 옮겼으면 원래 자리로
      for (const sd of s.docs) {
        let d = db.docs.find((x) => x.id === sd.id);
        if (!d) { const t = trashed.get(sd.id); if (t && t.path) { try { const r = await S.move(t.path, dirOf(sd.path), baseOf(sd.path)); sd.path = r.path; if (t.pdf && sd.pdfPath) { const p2 = await S.move(t.pdf, dirOf(sd.pdfPath), baseOf(sd.pdfPath)); sd.pdfPath = p2.path; } } catch (_) {} db.docs.push({ ...sd }); trashed.delete(sd.id); } continue; }
        if (d.path !== sd.path && !d.missing) { try { const r = await S.move(d.path, dirOf(sd.path), baseOf(sd.path)); sd.path = r.path; } catch (_) {} }
        if (d.pdfPath && sd.pdfPath && d.pdfPath !== sd.pdfPath) { try { const r = await S.move(d.pdfPath, dirOf(sd.pdfPath), baseOf(sd.pdfPath)); sd.pdfPath = r.path; } catch (_) {} }
        for (const k of Object.keys(d)) if (!(k in sd)) delete d[k];
        Object.assign(d, sd);
      }
      // 3) 계약(체크·회차·지출 표시 등)
      if (s.all) db.contracts = s.contracts;
      else for (const [k, c] of Object.entries(s.contracts)) { if (c) db.contracts[k] = c; else delete db.contracts[k]; }
      textDirty = true; logAct(`되돌림: ${u.label}`); await saveDb(true);
      toast(`되돌렸습니다: ${u.label}`, 'ok');
    } catch (e) { console.error(e); toast('되돌리지 못했습니다: ' + e.message, 'err'); }
    finally { progress(null); paintUndo(); render(); }
  }
  const undoAction = () => ({ label: '되돌리기', run: undo });
  // 최근 작업: 올린 서류가 어디로 갔는지·무엇을 바꿨는지(최근 300개)
  function openLog() {
    const rows = (db.log || []).slice().reverse().slice(0, 150);
    const t = (s) => { const d = new Date(s); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
    $('#logBody').innerHTML = rows.length ? `<ol class="log-list">${rows.map((r) => `<li><span class="date">${esc(t(r.at))}</span> ${esc(r.text)}</li>`).join('')}</ol>` : '<p class="muted">아직 기록이 없습니다.</p>';
    $('#logUndo').disabled = !undoStack.length; $('#logUndo').textContent = undoStack.length ? `되돌리기: ${undoStack[undoStack.length - 1].label}` : '되돌릴 작업 없음';
    $('#dlgLog').showModal();
  }

  // 서류 파일을 계약 폴더 안 정리 폴더(0 계약·1차 기성 …·준공)로 옮기고 단계 번호를 붙임 — 이미 제자리면 건드리지 않음(켤 때마다 확인)
  async function relayout() {
    const todo = db.docs.filter((d) => {
      if (!d.key || d.missing || !d.path) return false;
      const c = db.contracts[d.key]; if (!c) return false;
      const p = docPlace(c, d.itemId, d.pay), dir = d.path.split('/').slice(0, -1).join('/'), base = d.path.split('/').pop();
      return dir !== p.dir || (p.n && !base.startsWith(p.n + '_'));
    });
    if (!todo.length) return 0;
    let n = 0;
    for (let i = 0; i < todo.length; i++) {
      const d = todo[i];
      if (todo.length > 20) progress(`계약 폴더를 서류별로 정리하는 중 ${i + 1}/${todo.length}`, i / todo.length);
      try { await moveDoc(d, d.key, d.itemId, d.manual, undefined, true); n++; } catch (e) { console.warn('옮기지 못함', d.path, e); }
    }
    progress(null); await saveDb(true); render();
    if (n > 3) toast(`계약 폴더를 정리했습니다: 서류 ${n}개를 '0 계약'·'1차 기성'·'준공' 같은 폴더로 옮기고 처리 순서 번호를 붙였습니다.`, 'ok');
    return n;
  }
  async function reconcile() {
    const r = await S.list('', true);
    const all = r.files.filter((f) => /^(계약|미분류)\//.test(f.path) && !/\/인쇄본\//.test(f.path) && DOC_EXT.test(f.path));
    const exists = new Set(r.files.map((f) => f.path));
    const base = (p) => p.split('/').pop();
    const byName = new Map(); all.forEach((f) => { const n = base(f.path); if (!byName.has(n)) byName.set(n, []); byName.get(n).push(f); });
    let relinked = 0, missing = 0;
    for (const d of db.docs) {
      if (exists.has(d.path)) { d.missing = false; continue; }
      const c = (byName.get(base(d.path)) || []).filter((f) => !d.size || f.size === d.size);
      if (c.length === 1) { d.path = c[0].path; d.missing = false; relinked++; } else { if (!d.missing) missing++; d.missing = true; }
      if (d.pdfPath && !exists.has(d.pdfPath)) { const pc = byName.get(base(d.pdfPath)) || []; d.pdfPath = pc.length === 1 ? pc[0].path : ''; }
    }
    // 계약 폴더는 그 계약 서류가 실제로 있는 폴더를 따라감
    for (const c of contracts()) {
      const dirs = new Map();
      docsOf(c.key).filter((d) => !d.missing).forEach((d) => { const dir = d.path.split('/').slice(0, -1).join('/'); dirs.set(dir, (dirs.get(dir) || 0) + 1); });
      // 정리 폴더(0 계약·준공·1차 기성 …) 안이면 그 위가 계약 폴더
      [...dirs.keys()].forEach((k) => { const p = k.split('/'); if (p.length > 2 && LAYOUT_DIR.test(p[p.length - 1])) { const up = p.slice(0, -1).join('/'); dirs.set(up, (dirs.get(up) || 0) + dirs.get(k)); dirs.delete(k); } });
      const top = [...dirs.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && /^계약\//.test(top[0]) && top[0] !== c.folder) c.folder = top[0];
    }
    // 직접 넣은 파일(기록에 없는 것)
    const known = new Set(db.docs.flatMap((d) => [d.path, d.pdfPath].filter(Boolean)));
    const unknown = all.filter((f) => !known.has(f.path));
    let added = 0; const addedIds = [];
    for (let i = 0; i < unknown.length; i++) {
      const f = unknown[i];
      progress(`폴더에 새로 넣은 파일 읽는 중 ${i + 1}/${unknown.length}`, i / unknown.length);
      const name = base(f.path), kind = L.kindOf(name), dir = f.path.split('/').slice(0, -1).join('/');
      // 한글을 PDF로 바꾼 파일이면 그 한글 서류에 연결
      if (kind === 'pdf') { const twin = db.docs.find((d) => (d.kind === 'hwp' || d.kind === 'other') && d.path.replace(/\.(hwpx?|xlsx?|docx?)$/i, '.pdf') === f.path); if (twin) { twin.pdfPath = f.path; continue; } }
      try {
        const bytes = await S.readBytes(f.path);
        const { lines, ocr } = await R.read(bytes, kind);
        const text = L.maskPrivate(L.norm(lines.join(' ')).slice(0, 6000)), title = L.maskPrivate(L.norm(lines.slice(0, 8).join(' ')).slice(0, 300));
        let c = contracts().find((x) => x.folder && (dir === x.folder || dir.startsWith(x.folder + '/'))) || L.matchContract(contracts(), L.norm(L.stem(name)) + '|' + text);
        const doc = { id: L.uid(), key: c ? c.key : null, itemId: c ? classifyDoc(c, name, title, L.headLines(lines)).id : null, heads: L.headLines(lines), path: f.path, name, kind, size: f.size,
          addedAt: new Date().toISOString(), ocr, meta: L.findMeta(lines), text, title, dates: L.extractDates(lines), manual: false };
        db.docs.push(doc); textDirty = true; added++; addedIds.push(doc.id);
        if (c && /^미분류\//.test(f.path)) await moveDoc(doc, c.key, doc.itemId, false);
      } catch (e) { console.warn('새 파일 읽기 실패', f.path, e); }
    }
    progress(null);
    if (relinked || added || missing) {
      await saveDb(true);
      const parts = [];
      if (relinked) parts.push(`옮겨진 서류 ${relinked}개를 다시 찾았습니다`);
      if (added) parts.push(`폴더에 직접 넣은 파일 ${added}개를 읽어 정리했습니다`);
      if (missing) parts.push(`찾을 수 없는 서류 ${missing}개가 있습니다(계약 화면에 "파일 없음"으로 표시)`);
      // 탐색기에서 직접 넣은 파일도 '올릴 때마다 확인'이면 팝업으로 보여 줌(아니면 못 정한 것만)
      const ask = addedIds.filter((id) => { const d = docById(id); return d && (cfg.uploadConfirm !== false || !d.key || !d.itemId); });
      toast(parts.join('. ') + '.', missing ? 'err' : 'ok', ask.length ? { label: '확인하기', run: () => openPreview(ask, 0, true) } : null);
      if (ask.length) askLater(ask);
    }
  }

  // ---------- 자동으로 읽을 폴더(내려받는 곳, 여러 개) ----------
  // 몇 초마다 폴더를 보고, 새 파일이 다 받아졌으면(크기가 두 번 연속 같으면) 읽어서 계약별로 정리. 원래 파일은 그대로 두고 사본을 정리
  // 다운로드 폴더처럼 계약과 상관없는 파일도 섞인 곳이라, 우리 계약에 맞는 파일만 가져오고 나머지는 미분류에 쌓지 않고 건너뜀
  const watch = { dirs: [], last: new Map(), busy: false, timer: null };
  const watchSig = (f) => `${f.name}|${f.size}|${f.mtime}`;
  // opt.now: 다 받아졌는지 두 번 보지 않고 바로(지금 읽기) · opt.all: 폴더를 더하기 전부터 있던 파일도(이미 읽은 것·같은 파일은 빼고)
  async function watchTick(opt = {}) {
    if (watch.busy || !S.online || !watch.dirs.length) { if (opt.now && !watch.dirs.length) toast('자동으로 읽을 폴더가 없습니다. 설정 → 데이터 폴더 → 자동으로 읽을 폴더에서 더하세요.', 'err'); return; }
    watch.busy = true;
    try {
      const r = await S.watch();
      const lost = (r.dirs || []).filter((d) => d.missing).map((d) => d.dir);
      if (lost.length) banner(`자동으로 읽을 폴더를 찾지 못했습니다: ${esc(lost.join(', '))}. 설정 → 데이터 폴더에서 확인하세요.`, true);
      // 폴더마다 '읽기 시작한 때'를 기억하고, 그 뒤에 새로 생기거나 고친 파일만 읽음(원래 있던 파일·한 번 읽은 파일은 안 읽음)
      db.watchSince = db.watchSince || {};
      const nowIso = new Date().toISOString().slice(0, 19);
      let sinceNew = false;
      (r.dirs || []).forEach((d) => { if (!d.missing && !db.watchSince[d.dir]) { db.watchSince[d.dir] = nowIso; sinceNew = true; } });
      const dirOfIdx = (name) => { const i = +String(name).split('|')[0]; return ((r.dirs || [])[i] || {}).dir; };
      const newer = (f) => { const since = db.watchSince[dirOfIdx(f.name)]; const t = [f.mtime, f.ctime].filter(Boolean).sort().pop() || ''; return !!since && t > since; };
      const seen = new Set(db.watchSeen || []);
      const fresh = (r.files || []).filter((f) => DOC_EXT.test(f.name) && (opt.all || newer(f)) && !seen.has(watchSig(f)));
      if (sinceNew) await saveDb();
      const ready = opt.now ? fresh : fresh.filter((f) => watch.last.get(f.name) === f.size); // 받는 중인 파일은 다음 번에
      if (!opt.now) watch.last = new Map(fresh.map((f) => [f.name, f.size]));
      if (!ready.length) { if (opt.now) toast(opt.all ? '자동으로 읽을 폴더에 새로 읽을 파일이 없습니다(이미 읽은 파일은 다시 읽지 않음).' : '자동으로 읽을 폴더에 새로 들어온 파일이 없습니다.', 'ok'); return; }
      const files = [];
      for (const f of ready) {
        try { const b = await S.watchFile(f.name); files.push(new File([b], f.name.split('|').pop().split('/').pop(), { type: '' })); }
        catch (e) { console.warn('자동 읽기 실패', f.name, e); }
        seen.add(watchSig(f)); // 읽지 못한 파일도 다시 시도하지 않음(고치면 수정한 때가 바뀌어 다시 읽음)
      }
      db.watchSeen = [...seen].slice(-3000); // 시작한 때 뒤의 것만 담으니 작음
      if (files.length) await ingest(files, null, null, { onlyMatched: true, from: '내려받은 폴더' });
      else await saveDb();
    } catch (e) { console.warn('자동 읽기', e); }
    finally { watch.busy = false; }
  }
  // 자동으로 읽을 폴더 기능은 뺌(1.6.26) — 서류는 직접 올리기·끌어다 놓기로만. 예전에 더해 둔 폴더는 읽지 않고 목록도 비움
  function startWatch(dirs) {
    clearInterval(watch.timer); watch.timer = null; watch.dirs = [];
    if ((dirs || []).filter(Boolean).length && S.watchClear) (async () => { try { for (let i = dirs.length - 1; i >= 0; i--) await S.watchClear(i); } catch (_) {} })();
  }

  // ---------- 켤 때 연결 확인 + 점심시간 자동 새로고침 ----------
  // 처음 화면에 나라장터 인증키·국가법령정보센터 OC·PC AI가 되는지 한 줄씩 보여 줌(각각 한 번씩만 조회)
  async function checkAccounts() {
    const el = $('#acctLine'); if (!el || !S.online) return;
    const rows = [];
    const put = (k, cls, t) => { rows[k] = `<li class="${cls}">${esc(t)}</li>`; el.innerHTML = rows.filter(Boolean).join(''); };
    put(0, 'wait', '나라장터 인증키 확인 중…'); put(1, 'wait', '법령 OC 확인 중…'); put(2, 'wait', 'PC AI 확인 중…');
    // 1) 나라장터
    try {
      if (!cfg.apiKey || !cfg.insttNm) put(0, 'bad', '나라장터: 설정에서 인증키·기관명을 넣어 주세요');
      else { const [b, e] = L.monthRanges(1)[0]; const r = L.parseApiBody(await S.nara(L.apiUrl(L.API_OPS.공사, cfg, b, e, 1, 1))); put(0, 'ok', `나라장터 연결됨 (이번 달 공사 계약 ${r.total}건)`); }
    } catch (e) { put(0, 'bad', '나라장터 안 됨: ' + e.message); }
    // 2) 국가법령정보센터
    try {
      const oc = String(cfg.lawOC || org.lawOC || '').trim();
      if (!oc) put(1, 'warn', '법령 자동 받기: OC를 아직 안 넣음(규정·질문 답변 → 자료)');
      else {
        const t = await S.law(JH.rulesLogic.lawSearchUrl(oc, '지방공기업법', 'law'));
        let j = null; try { j = JSON.parse(t); } catch (_) {}
        const ok = j && JH.rulesLogic.pickLaw(j, '지방공기업법', 'law'), why = JH.rulesLogic.lawError(j);
        if (ok) put(1, 'ok', `법령 OC(${oc}) 사용 가능`);
        else if (/IP/.test(why)) {
          // IP 미등록: 이 PC의 공인 IP를 자동으로 알아내 [복사]·[등록하러 가기]로 바로
          let ip = ''; try { ip = (await S.myIp()).ip; } catch (_) {}
          rows[1] = `<li class="bad">법령 OC(${esc(oc)}): 이 PC의 인터넷 주소${ip ? ` <b class="num">${esc(ip)}</b>` : ''}가 국가법령정보센터에 등록되지 않았습니다. ${ip ? `<button type="button" class="link sm" data-copyip="${esc(ip)}">IP 복사</button> ` : ''}<a class="link sm" href="https://open.law.go.kr" target="_blank" rel="noopener">등록하러 가기</a> <small class="muted">(마이페이지 → OPEN API 신청 내역 → 수정 → 서버장비의 IP주소에 붙여 넣고 [추가])</small></li>`;
          el.innerHTML = rows.filter(Boolean).join('');
        } else put(1, 'bad', `법령 OC(${oc}) 안 됨: ${why || '활용 신청(법령·행정규칙)을 open.law.go.kr에서 확인하세요'}`);
      }
    } catch (e) { put(1, 'bad', '법령 연결 안 됨: ' + e.message); }
    // 3) PC AI
    try { const st = await JH.ai.status(true); put(2, st.ready ? 'ok' : 'warn', JH.ai.statusText(st)); } catch (_) { put(2, 'warn', 'PC AI 상태를 모름'); }
    // 4) 이 PC의 인터넷 주소(공인 IP) — 국가법령정보센터에 등록할 값, 늘 보여 줌
    try { const ip = (await S.myIp()).ip; rows[3] = `<li class="info">현재 이 PC의 IP는 <b class="num">${esc(ip)}</b> 입니다 <button type="button" class="link sm" data-copyip="${esc(ip)}">복사</button></li>`; el.innerHTML = rows.filter(Boolean).join(''); } catch (_) { /* 인터넷 안 됨 */ }
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-copyip]'); if (!b) return; navigator.clipboard.writeText(b.dataset.copyip).then(() => toast(`${b.dataset.copyip}를 복사했습니다. 국가법령정보센터 신청 내역의 '서버장비의 IP주소'에 붙여 넣고 [추가]하세요.`, 'ok'), () => toast(`IP: ${b.dataset.copyip} (복사가 안 되면 직접 적어 주세요)`)); });
  // 자동 새로고침(나라장터 계약·세부 정보, 법령·예규): 하루 세 번 — 켜자마자(오전 한 번), 12시부터, 18시부터. 각 칸마다 하루 한 번만
  const slotOf = (d) => (d.getHours() >= 18 ? 'evening' : d.getHours() >= 12 ? 'noon' : 'morning');
  async function autoRefresh(first) {
    if (!cfg.apiKey || !cfg.insttNm) return;
    const now = new Date(), today = now.toISOString().slice(0, 10), slot = slotOf(now);
    const done = (cfg.autoDone && cfg.autoDone.date === today) ? cfg.autoDone.slots || [] : [];
    if (done.includes(slot) || $('#btnFetch').classList.contains('busy')) return;
    cfg.autoDone = { date: today, slots: [...done, slot] }; await saveCfg();
    toast(`${first ? '켜자마자' : slot === 'noon' ? '점심시간' : '저녁'} 자동 새로고침: 나라장터 계약과 법령·예규를 받습니다. 그동안 다른 일을 하셔도 됩니다.`);
    try { await fetchContracts(); } catch (_) {}
    try { if (JH.rules && (cfg.lawOC || org.lawOC)) { await JH.rules.load(); await JH.rules.fetchLaws(true); } } catch (_) {}
  }

  // ---------- 나라장터 계약 목록 ----------
  // full이 아니면 지난번에 불러온 달부터만(여럿이 인증키 하나를 같이 쓰므로 조회 횟수를 아낌)
  // 나라장터에서 받아 두는 항목이 늘면 올림 → 한 번은 기간 전체를 다시 받아 예전에 불러온 계약도 새 항목(계약방법·대표자·사업자번호·통합계약번호 등)을 채움
  const FETCH_VER = 5; // 3: 업체목록을 화면 순서로도 읽음(업체명·대표자) · 4: 차수(-00, -01)별 금액·준공일 기억 · 5: 다른 모양 계약번호의 차수도
  async function fetchContracts(full) {
    if (!cfg.apiKey || !cfg.insttNm) { toast('설정에서 인증키와 기관명을 먼저 넣어 주세요.', 'err'); JH.settings.open('nara'); return; }
    const stale = contracts().some((c) => c.source === 'api' && !c.untyNo && !c.method && !c.corpRaw);
    if (cfg.fetchVer !== FETCH_VER || stale) full = true;
    let months = Number(cfg.months) || 6;
    const last = cfg.lastFetch ? new Date(cfg.lastFetch) : null;
    if (!full && last && !isNaN(last)) {
      const now = new Date();
      const since = (now.getFullYear() - last.getFullYear()) * 12 + now.getMonth() - last.getMonth() + 1;
      months = Math.max(1, Math.min(months, since));
    }
    const ranges = L.monthRanges(months);
    const btn = $('#btnFetch'); if (btn.classList.contains('busy')) return; btn.classList.add('busy'); btn.disabled = true;
    const steps = ranges.length * L.TYPES.length; let step = 0, created = 0; const seen = new Set(); const raw = [];
    try {
      for (const type of L.TYPES) {
        for (const [b, e] of ranges) {
          progress(`나라장터에서 ${type} 계약 불러오는 중 (${b.slice(0, 4)}.${b.slice(4, 6)})`, step++ / steps);
          for (let page = 1; page < 50; page++) {
            const { items, total } = L.parseApiBody(await S.nara(L.apiUrl(L.API_OPS[type], cfg, b, e, page, 100)));
            for (const x of items) { raw.push({ 구분: type, ...x }); const r = upsertContract(L.normalizeApiItem(x, type)); seen.add(r.c.key); if (r.created) created++; }
            if (page * 100 >= total || !items.length) break;
          }
        }
      }
      mergeSameContracts();
      // 예전 버전이 저장한 서류 글자에서도 개인 식별번호를 한 번 가림(서류본문.json)
      if (!db.masked) { let n = 0; for (const d of db.docs) { for (const k of ['text', 'title']) if (d[k]) { const v = L.maskPrivate(d[k]); if (v !== d[k]) { d[k] = v; n++; } } } db.masked = 1; if (n) textDirty = true; saveDb(true); } // 새로 받은 차수(-01 …)가 따로 생겼으면 바로 합침
      cfg.lastFetch = new Date().toISOString(); await saveCfg();
      // 나라장터가 준 그대로를 남겨 둠(어떤 항목이 오는지 확인할 때: 데이터 폴더 \진단\나라장터_계약응답.json)
      if (raw.length) S.writeJson('진단/나라장터_계약응답.json', { at: cfg.lastFetch, count: raw.length, items: raw }).catch(() => {});
      if (full && cfg.fetchVer !== FETCH_VER) { cfg.fetchVer = FETCH_VER; saveCfg().catch(() => {}); }
      await saveDb(true);
      const moved = await rematchInbox();
      toast(`나라장터 계약 ${seen.size}건을 확인했습니다. 새 계약 ${created}건` + (moved ? `, 미분류 서류 ${moved}개를 계약으로 옮겼습니다.` : '.'), 'ok');
      // 이어서 계약마다 세부 정보(변경이력·예정가격·낙찰·업체 주소)
      const en = await enrichContracts([...seen].map((k) => db.contracts[k]));
      if (en.errs.length) toast(`세부 정보 일부를 받지 못했습니다: ${en.errs.map(([n]) => n).join(', ')}. 공공데이터포털에서 같은 인증키로 이 서비스들을 활용신청하면 다음 새로고침부터 받습니다.`, 'err');
      else if (en.soft) toast(`계약 ${en.soft}건은 세부 정보 일부를 받지 못했습니다(나라장터 응답 오류). 다음 새로고침 때 다시 받습니다. 계약 화면 [감사·검사 자료]에 이유가 나옵니다.`, 'err');
    } catch (e) {
      console.error(e); toast(e.message, 'err');
    } finally { btn.classList.remove('busy'); btn.disabled = false; progress(null); render(); }
  }

  // ---------- 인쇄·저장 ----------
  async function getFile(d) {
    if (d.kind === 'hwp') {
      if (!d.pdfPath) {
        try { const r = await S.hwp2pdf(d.path); d.pdfPath = r.path; saveDb(); } catch (e) { console.warn(e); }
      }
      if (d.pdfPath) return { kind: 'pdf', name: d.name, bytes: await S.readBytes(d.pdfPath) };
      return { kind: 'hwp', name: d.name };
    }
    // 엑셀·워드: 설치된 오피스로 PDF로 바꿔 같이 인쇄(오피스가 없으면 '별도 인쇄' 자리)
    if (d.kind === 'other' && /\.(xlsx?|docx?)$/i.test(d.name)) {
      if (!d.pdfPath) { try { const r = await S.office2pdf(d.path); d.pdfPath = r.path; saveDb(); } catch (e) { console.warn(e); } }
      if (d.pdfPath) return { kind: 'pdf', name: d.name, bytes: await S.readBytes(d.pdfPath) };
    }
    return { kind: d.kind, name: d.name, bytes: d.kind === 'other' ? null : await S.readBytes(d.path) };
  }
  // 인쇄할 서류: 줄마다 [인쇄] 체크를 뺀 서류(c.noPrint)는 한 번에 인쇄·PDF·표지 목록에서 뺌
  const printList = (c) => lists(c.type).filter((x) => !(c.noPrint || {})[x.id]);
  const printDocs = (c) => finalDocs(c).filter((d) => d.itemId && !(c.noPrint || {})[d.itemId]);
  async function printContract(c, mode) {
    const docs = printDocs(c);
    try {
      progress('인쇄할 서류를 합치는 중', .3);
      const r = await JH.pdfbuild.build(c, printList(c), docs, getFile, { cover: true, holder: true });
      progress(null);
      let msg = `${r.pages}쪽`;
      if (r.missing.length) msg += ` · 필수 누락 ${r.missing.length}건(표지에 표시)`;
      if (r.errors.length) msg += ` · 읽지 못한 파일: ${r.errors.join(', ')}`;
      if (S.demo) {
        await S.showPdf(r.bytes, `${c.name} — ${mode === 'save' ? 'PDF로 저장' : '인쇄'} 미리보기`, `${msg}. 실제 프로그램에서는 ${mode === 'save' ? '계약 폴더에 저장됩니다' : '바로 인쇄 창이 열립니다'}.`);
      } else if (mode === 'save') {
        const s = await S.save(`${folderOf(c)}/인쇄본`, `지출서류_${ymd()}.pdf`, r.bytes);
        toast(`PDF로 저장했습니다 (${msg}).`, r.errors.length ? 'err' : 'ok', { label: '폴더 열기', run: () => S.open(s.path) });
      } else {
        printBytes(r.bytes);
        toast(`인쇄 창을 열었습니다 (${msg}).`, r.errors.length ? 'err' : 'ok');
      }
    } catch (e) { console.error(e); toast('인쇄 파일을 만들지 못했습니다: ' + e.message, 'err'); }
    finally { progress(null); }
  }
  // 회차 하나만 인쇄: 그 회차 서류(선금 보증서는 계약 것)를 단계 순서대로, 표지에 회차 이름
  async function printRound(c, r, mode) {
    const s = roundStatus(c, r), items = s.steps.flatMap((g) => g.items);
    const docs = [...s.docs, ...docsOf(c.key).filter((d) => items.some((x) => x.link && x.id === d.itemId))].filter((d) => d.itemId);
    const c2 = { ...c, name: `${c.name} — ${s.label}`, originals: {}, received: r.received || {} };
    try {
      progress('인쇄할 서류를 합치는 중', .3);
      const out = await JH.pdfbuild.build(c2, items, docs, getFile, { cover: true, holder: true });
      progress(null);
      const msg = `${out.pages}쪽` + (out.missing.length ? ` · 필수 누락 ${out.missing.length}건(표지에 표시)` : '');
      if (S.demo) await S.showPdf(out.bytes, `${c2.name} — 미리보기`, `${msg}. 실제 프로그램에서는 ${mode === 'save' ? '회차 폴더에 저장됩니다' : '바로 인쇄 창이 열립니다'}.`);
      else if (mode === 'save') { const sv = await S.save(roundDir(c, r), `지출서류_${L.safeName(s.label, 20)}_${ymd()}.pdf`, out.bytes); toast(`PDF로 저장했습니다 (${msg}).`, 'ok', { label: '폴더 열기', run: () => S.open(sv.path) }); }
      else { printBytes(out.bytes); toast(`인쇄 창을 열었습니다 (${msg}).`, 'ok'); }
    } catch (e) { console.error(e); toast('인쇄 파일을 만들지 못했습니다: ' + e.message, 'err'); }
    finally { progress(null); }
  }
  function printBytes(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
    f.src = url;
    f.onload = () => setTimeout(() => {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (_) { window.open(url, '_blank'); }
    }, 400);
    document.body.append(f);
    setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 10 * 60 * 1000);
  }

  // ---------- 화면: 계약 목록 ----------
  function officerNames() {
    const m = new Map();
    contracts().forEach((c) => { if (c.officer) m.set(c.officer, (m.get(c.officer) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }
  // 검색 대상: 계약명·업체·계약번호·담당자 + 내 메모(감독부서·감독관·연락처·특이사항)
  const memoOf = (c) => c.memo || {};
  const hay = (c) => { const m = memoOf(c); return L.norm([c.name, c.vendor, c.no, ...(c.nums || []), c.officer, c.dept, m.dept, m.person, m.phone, m.note].join(' ')); };
  const hits = (c, q) => !q || hay(c).includes(q) || (/\d{3,}/.test(q) && hay(c).replace(/\D/g, '').includes(q.replace(/\D/g, '')));
  function filtered(ignoreState) {
    const q = L.norm(ui.q);
    return contracts().filter((c) => {
      if (ui.officer && c.officer !== ui.officer) return false;
      if (ui.type && c.type !== ui.type) return false;
      if (q && !hits(c, q)) return false;
      if (!ignoreState && ui.state && !inState(statusOf(c), ui.state)) return false;
      return true;
    }).sort(SORTS[ui.sort] || SORTS['end-desc']);
  }
  // 목록 정렬: 날짜가 없는 계약은 맨 뒤
  const d8 = (s) => { const t = L.toDate(s); return t ? t.getTime() : null; };
  const byDate = (pick, dir) => (a, b) => { const x = d8(pick(a)), y = d8(pick(b)); if (x == null || y == null) return (x == null) - (y == null) || b.updatedAt - a.updatedAt; return (x - y) * dir || KO.compare(a.name || '', b.name || ''); };
  const KO = new Intl.Collator('ko', { numeric: true }); // 비교 때마다 새로 만들지 않음(목록 정렬이 수십 배 빨라짐)
  const ko = (pick) => (a, b) => KO.compare(String(pick(a) || '힣'), String(pick(b) || '힣')) || KO.compare(a.name || '', b.name || '');
  const SORTS = {
    'end-desc': byDate((c) => c.endDate, -1), 'end-asc': byDate((c) => c.endDate, 1),
    'date-desc': byDate((c) => c.contractDate || c.startDate, -1), 'date-asc': byDate((c) => c.contractDate || c.startDate, 1),
    name: ko((c) => c.name), vendor: ko((c) => c.vendor), touched: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
  };
  function pillFor(st, c) {
    if (st.state === 'paid') return `<span class="pill paid">지출 ${esc(L.fmtDate(c.paidDate).slice(5))}</span>`;
    if (st.state === 'empty') return '<span class="pill none">서류 없음</span>';
    if (st.state === 'missing') return `<span class="pill miss" title="${st.expired.length ? `빠진 서류 ${st.missing.length} · 유효기간 부족 ${st.expired.length}` : ''}">미비 ${st.need}</span>`;
    return '<span class="pill ready">지출 대기</span>';
  }
  function renderFilters() {
    const sel = $('#fOfficer');
    const names = officerNames();
    // 사용자가 직접 바꾸기 전까지는 설정의 '내 이름'을 기본으로
    if (!ui.officerTouched) ui.officer = cfg.officer && names.some(([n]) => n === cfg.officer) ? cfg.officer : '';
    sel.innerHTML = `<option value="">담당자 전체</option>` + names.map(([n, k]) => `<option value="${esc(n)}"${n === ui.officer ? ' selected' : ''}>${esc(n)} (${k})</option>`).join('');
    $('#fType').value = ui.type;
    $$('#fState button').forEach((b) => b.classList.toggle('on', b.dataset.state === ui.state));
  }
  function renderList() {
    renderFilters();
    const list = filtered();
    if (ui.sel && !db.contracts[ui.sel]) ui.sel = null;
    if (!ui.sel && list.length) ui.sel = list[0].key;
    // 검색어가 있는데 담당자·구분·상태 거름 때문에 안 보이는 계약이 있으면 알려 줌
    const q = L.norm(ui.q);
    const hidden = q ? contracts().filter((c) => hits(c, q) && !list.includes(c)).length : 0;
    const raw = (ui.q || '').trim();
    const hl = (s) => { s = String(s || ''); const i = raw ? s.toLowerCase().indexOf(raw.toLowerCase()) : -1; return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + raw.length)) + '</mark>' + esc(s.slice(i + raw.length)); };
    $('#contractList').innerHTML = list.map((c) => {
      const st = statusOf(c), m = memoOf(c);
      const pct = st.reqTotal ? Math.round((st.reqDone / st.reqTotal) * 100) : 0;
      // 메모에서 찾은 경우 어느 내용인지 한 줄 보여 줌
      const memoHit = raw && !L.norm([c.name, c.vendor, c.no, ...(c.nums || [])].join(' ')).includes(q) ? [m.dept, m.person, m.phone, m.note, c.officer].find((x) => x && L.norm(x).includes(q)) : '';
      return `<div class="citem${c.key === ui.sel ? ' on' : ''}" role="listitem" tabindex="0" data-key="${esc(c.key)}">
        <div class="nm" title="${esc(c.name)}">${hl(c.name || '이름 없는 계약')}</div>
        <div class="st">${pillFor(st, c)}${roundFocus(st) && st.state !== 'paid' ? roundPill(roundFocus(st), true) : ''}</div>
        <div class="meta"><span>${hl(c.vendor || '업체 미상')}</span><span>${esc(c.type)}</span>${isExt(c) ? '<span class="ext-dot" title="외부 예산(e나라도움 등)">외부</span>' : ''}${/^date/.test(ui.sort) ? ((c.contractDate || c.startDate) ? `<span class="date">계약 ${esc(L.fmtDate(c.contractDate || c.startDate))}</span>` : '') : c.endDate ? `<span class="date"${st.late ? ' style="color:var(--seal)"' : ''}>준공 ${esc(L.fmtDate(c.endDate))}</span>` : ''}${m.note || m.person ? `<span class="memo-dot" title="${esc([m.dept, m.person, m.phone].filter(Boolean).join(' ') + (m.note ? '\n' + m.note : ''))}">메모</span>` : ''}</div>
        ${memoHit ? `<div class="hit">${hl(String(memoHit).replace(/\s+/g, ' ').slice(0, 80))}</div>` : ''}
        <div class="bar-mini"><i style="width:${pct}%"></i></div></div>`;
    }).join('') + (hidden ? `<button type="button" class="more-hits" data-act="searchall">담당자·구분·상태 거름 때문에 안 보이는 계약 <b>${hidden}건</b> — 모두에서 찾기</button>` : '')
      || `<div class="empty-state" style="margin:40px 16px"><p>${contracts().length ? (q ? `"${esc(raw)}"에 맞는 계약이 없습니다.` : '조건에 맞는 계약이 없습니다.') : '아직 계약이 없습니다. 나라장터에서 불러오거나 계약서를 넣으면 생깁니다.'}</p></div>`;
    const stamp = fetchStamp();
    $('#listCount').textContent = `${list.length}건` + (stamp ? ` · 나라장터 ${stamp} 기준` : '');
    $('#btnFetch').title = '나라장터 계약목록 새로고침' + (stamp ? ` (마지막 ${stamp})` : '');
  }

  // ---------- 화면: 계약 상세 ----------
  function sealSvg(st, c) {
    let cls = '', a = '', b = '';
    if (st.state === 'paid') { a = '지출'; b = L.fmtDate(c.paidDate).slice(2); }
    else if (st.state === 'empty') { cls = 'none'; a = '서류'; b = '없음'; }
    else if (st.need) { a = '미비'; b = `${st.need}건`; }
    else { cls = 'ok'; a = '서류'; b = '완료'; }
    return `<svg class="seal ${cls}" viewBox="0 0 120 120" role="img" aria-label="${esc(a + ' ' + b)}">
      <defs><filter id="ink" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="2.2"/></filter></defs>
      <g filter="url(#ink)"><circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" stroke-width="5"/>
      <circle cx="60" cy="60" r="45" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <text x="60" y="57" text-anchor="middle" font-size="27" font-weight="800" fill="currentColor">${esc(a)}</text>
      <text x="60" y="86" text-anchor="middle" font-size="${b.length > 6 ? 16 : 20}" font-weight="700" fill="currentColor">${esc(b)}</text></g></svg>`;
  }
  function itemOptions(list, sel, withInbox, rec) {
    const o = (x) => `<option value="${esc(x.id)}" data-q="${esc(L.norm([x.group, x.name, ...(x.keywords || [])].join(' ')))}"${x.id === sel ? ' selected' : ''}>${esc(x.group)} · ${esc(x.name)}</option>`;
    const head = (withInbox ? '<option value="__inbox">미분류로 보내기</option>' : '') + '<option value="">서류 종류 고르기</option>';
    const rs = (rec || []).map((id) => list.find((x) => x.id === id)).filter(Boolean);
    if (rs.length) return head + `<optgroup label="추천 — 제목으로 찾은 서류">${rs.map(o).join('')}</optgroup><optgroup label="전체">${list.filter((x) => !rs.includes(x)).map(o).join('')}</optgroup>`;
    return head + list.map(o).join('');
  }
  // 사람이 미분류 서류를 계약으로 정리하면: 서류에 적힌 공사명·용역명이 나라장터 계약명과 다르게 쓰였으면 그 표기를 이 계약의 다른 이름으로 배움
  function learnAlias(d, c) {
    const nm = L.norm((d && d.meta && d.meta.name) || ''), cn = L.norm(c && c.name || '');
    if (!c || nm.length < 4 || nm.length > 60 || cn.includes(nm) || nm.includes(cn)) return '';
    c.aliases = [...new Set([...(c.aliases || []), nm])].slice(-10);
    logAct(`배움: 서류의 이름 「${d.meta.name}」 → 계약 「${c.name}」`);
    return `다음부터 「${d.meta.name}」이라고 적힌 서류는 「${c.name}」으로 넣습니다.`;
  }
  // 서류 줄의 '회차' 고르기(회차가 있는 계약만): 준공(마지막) / 1차 기성 / …
  function payOptions(d) {
    const c = d.key && db.contracts[d.key]; const rs = c ? sortedRounds(c) : [];
    if (!rs.length) return '';
    const cur = d.pay && roundById(c, d.pay) ? d.pay : '';
    return `<select data-act="docpay" data-doc="${d.id}" aria-label="지출 회차" class="paysel">${[['', '준공(마지막)'], ...rs.map((r) => [r.id, L.roundLabel(r)])].map(([v, t]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  }
  const isoOf = (s) => { const m = String(s || '').replace(/\D/g, ''); return m.length >= 8 ? `${m.slice(0, 4)}-${m.slice(4, 6)}-${m.slice(6, 8)}` : ''; };
  function fileRow(d, list) {
    const tag = d.missing ? '<span class="ft warn" title="데이터 폴더에서 이 파일을 찾을 수 없습니다">파일 없음</span>'
      : d.ocr ? '<span class="ft" title="스캔본이라 글자 인식으로 읽었습니다">스캔</span>' : `<span class="ft${d.kind === 'hwp' && !d.pdfPath ? ' warn' : ''}">${d.kind === 'other' ? ({ xlsx: '엑셀', xls: '엑셀', docx: '워드' }[L.extOf(d.name)] || '기타') : KIND_LABEL[d.kind]}</span>`;
    const conv = d.kind === 'hwp' && !d.pdfPath ? `<button class="btn sm" data-act="hwp" data-doc="${d.id}">PDF로 변환</button>` : '';
    let dt = '';
    if (L.isAdvBond(d.itemId)) {
      const v = d.validOverride || (d.dates && d.dates.bondEnd) || '';
      dt = `<label class="vdate${v ? '' : ' empty'}" title="보증서에 적힌 보증기간 마지막 날. 준공일 + ${L.ADV_DAYS}일 이상이어야 합니다.">보증기간 끝<input type="text" data-date inputmode="numeric" maxlength="10" placeholder="예: 20261023" autocomplete="off" data-act="validset" data-doc="${d.id}" value="${isoOf(v)}">${d.validOverride ? '<small>직접</small>' : v ? '<small>읽음</small>' : ''}</label>`;
    } else if (L.isCertItem(d.itemId)) {
      const v = d.validOverride || (d.dates && d.dates.valid) || '';
      const how = d.validOverride ? '직접' : d.dates && d.dates.validHow === 'calc' ? '계산' : v ? '읽음' : '';
      dt = `<label class="vdate${v ? '' : ' empty'}" title="증명서에 적힌 유효기간 마지막 날. 잘못 읽었으면 고치세요.">유효기간<input type="text" data-date inputmode="numeric" maxlength="10" placeholder="예: 20261023" autocomplete="off" data-act="validset" data-doc="${d.id}" value="${isoOf(v)}">${how ? `<small>${how}</small>` : ''}</label>`;
    } else if (/-(finish|inspect|progfin|proginsp)$/.test(d.itemId || '')) {
      const v = dateOfDoc(d, /-(inspect|proginsp)$/.test(d.itemId) ? 'inspect' : 'finish');
      dt = `<label class="vdate${v ? '' : ' empty'}" title="지출요청일(이 날짜 + 2주) 계산에 씁니다">날짜<input type="text" data-date inputmode="numeric" maxlength="10" placeholder="예: 20261023" autocomplete="off" data-act="docdate" data-doc="${d.id}" value="${isoOf(v)}">${d.dateOverride ? '<small>직접</small>' : ''}</label>`;
    }
    const revTag = d.rev ? '<span class="ft" title="같은 칸에 있던 서류의 수정본">수정본</span>' : '';
    const chk = d.unsure ? `<button type="button" class="ft warn chk-btn" data-act="confirmdoc" data-doc="${d.id}" title="제목에 다른 서류 이름도 있어 헷갈립니다. 눌러서 확인하면 배웁니다">확인 필요</button>` : '';
    return `<div class="file">${tag}${revTag}${chk}<span class="fn" title="${esc(d.name)}">${esc(d.name)}</span>${conv}${dt}
      <span class="cpick mini"><input type="search" class="cpick-q" placeholder="종류 찾기" autocomplete="off" aria-label="서류 종류 찾기" title="면허·등록증·통장처럼 치면 맞는 종류만 남고, Enter를 누르면 첫 번째로 옮깁니다"><select data-act="moveitem" data-doc="${d.id}" aria-label="서류 종류">${itemOptions(list, d.itemId, true)}</select></span>${payOptions(d)}
      <button class="link" data-act="view" data-doc="${d.id}">보기</button>${d.kind === 'pdf' && d.key && !(d.pages === 1) ? `
      <button class="link" data-act="split" data-doc="${d.id}" title="한 파일에 여러 서류를 스캔했으면 서류마다 따로 잘라 각 칸에 넣음">나누기</button>` : ''}
      <button class="x" data-act="del" data-doc="${d.id}" title="빼기" aria-label="빼기">✕</button></div>`;
  }
  // 우리 예산이 아닌 사업(e나라도움 보조금 등)은 구매요구서 대신 일반 기안문이 옴
  // 예산 판단 순서: 직접 고른 값 > 서류 내용(e나라도움·보조금 등 → 외부, 구매요구서 → 우리) > 나라장터 응답 > 모름
  const EXT_TEXT = /(e나라도움|이나라도움|국고보조|보조금|외부재정|재정연계)/;
  const extMemo = new WeakMap();
  function budgetOf(c) {
    if (!c) return { v: 'unknown' };
    if (c.budget) return { v: c.budget, why: '직접 고름', manual: true };
    const docs = docsOf(c.key);
    // 서류 본문(수천 자)을 그릴 때마다 다시 훑지 않도록 서류마다 한 번만 찾아 둠
    const extWord = (d) => { if (!extMemo.has(d)) { const m = (d.text || '').match(EXT_TEXT); extMemo.set(d, m ? m[1] : ''); } return extMemo.get(d); };
    const ext = docs.find((d) => extWord(d));
    if (ext) return { v: 'ext', why: `서류 "${ext.name}"에 '${extWord(ext)}'` };
    const req = docs.find((d) => /-req$/.test(d.itemId || '') && /구매요구|구매요청/.test((d.title || '') + L.norm(d.name)));
    if (req) return { v: 'own', why: `구매요구서 "${req.name}"` };
    const nm = L.norm(c.name || ''); const hit = (cfg.extNames || []).find((w) => w && nm.includes(L.norm(w)));
    if (hit) return { v: 'ext', why: `사업 이름 '${hit}'(설정)` };
    if (c.budgetAuto === 'ext') return { v: 'ext', why: '나라장터: 외부재정연계' };
    return { v: 'unknown', why: '' };
  }
  const isExt = (c) => budgetOf(c).v === 'ext';
  const budgetText = (c) => ({ own: '우리 예산', ext: '외부 예산(e나라도움 등)', unknown: '모름' }[budgetOf(c).v]);
  const BUDGET = { own: '우리 예산', ext: '외부 예산(e나라도움 등)' };
  function itemView(c, x) {
    if (isExt(c) && /-req$/.test(x.id)) return { name: '일반 기안문', note: '우리 예산이 아니라 구매요구서 대신 기안문으로 옴' };
    if (budgetOf(c).v === 'own' && /-req$/.test(x.id)) return { name: '구매요구서', note: '설계내역서·시방서 등 포함' };
    if (/-req$/.test(x.id)) return { name: '구매요구서 또는 기안문', note: '우리 예산이면 구매요구서, 외부 예산(e나라도움 등)이면 일반 기안문 — 들어온 서류로 예산을 알아냅니다' };
    return { name: x.name, note: x.note };
  }
  // 업체에 다시 받을 서류: 업체·메일로 받는 서류 중 빠진 것 + 유효기간이 지출요청일보다 먼저 끝나는 증명서
  // 감독관 경유: 들어온 서류(파일·묶음 안·원본·받음) 중 경유 체크 안 된 것
  const viaOf = (c) => { const docs = finalDocs(c), got = gotMap(c); return L.viaStatus(c, lists(c.type), (id) => L.hasItem(docs, got, id) || docs.some((d) => (d.also || []).includes(id))); };
  function vendorNeeds(c, st) {
    const missingItems = st.missing.filter((x) => L.ORIGINAL_SOURCES.includes(x.source));
    const missing = missingItems.map((x) => itemView(c, x).name);
    const reissue = st.expired.map((x) => ({ name: itemView(c, x.item).name, valid: x.valid }));
    const via = viaOf(c).missing;
    const adv = advOf(c);
    if (adv && adv.status === 'short') reissue.push({ name: `${itemView(c, adv.item).name}(보증기간이 준공일 ${L.fmtDate(c.endDate)} + ${L.ADV_DAYS}일 이상이어야 함)`, valid: adv.end });
    return { missing, missingItems, reissue, via, adv };
  }
  function reqCard(c, st) {
    const b = st.basis, n = vendorNeeds(c, st);
    const items = [
      n.missing.length ? `<li><b class="num">${n.missing.length}</b> 업체 서류 빠짐</li>` : '',
      n.reissue.length ? `<li class="bad"><b class="num">${n.reissue.length}</b> 유효기간 부족 → 재발급</li>` : '',
      st.unknownValid.length ? `<li class="unk"><b class="num">${st.unknownValid.length}</b> 유효기간 못 읽음(서류 줄에서 입력)</li>` : '',
      n.via.length ? `<li class="bad"><b class="num">${n.via.length}</b> 감독관 경유 안 됨 <span class="muted">${esc(n.via.join('·'))}</span></li>` : '',
      n.adv && n.adv.status === 'short' ? `<li class="bad">선금 보증서 기간 부족 <span class="muted">${esc(L.fmtDate(n.adv.end))}까지 — 준공일+${L.ADV_DAYS}일(${esc(L.fmtDate(n.adv.need))}) 이상 필요</span></li>` : '',
      n.adv && n.adv.status === 'unknown' ? '<li class="unk">선금 보증서 보증기간 못 읽음(서류 줄에서 입력)</li>' : '',
    ].join('');
    const sum = [n.missing.length ? `<span class="warn-t">업체 서류 빠짐 ${n.missing.length}</span>` : '', n.reissue.length ? `<span class="bad-t">재발급 ${n.reissue.length}</span>` : '', st.unknownValid.length ? `<span class="muted">유효기간 못 읽음 ${st.unknownValid.length}</span>` : '', n.via.length ? `<span class="bad-t">감독관 경유 ${n.via.length}</span>` : ''].filter(Boolean).join(' · ') || '<span class="ok-t">다시 받을 서류 없음</span>';
    return `<details class="dcard req" data-card="req"${cardOpen.req ? ' open' : ''} aria-label="지출요청일과 업체 보완 요청">
      <summary><h3>지출요청일</h3><b class="date">${b && b.date ? esc(L.fmtDate(b.date)) : '모름'}</b><span class="csum">${sum}</span></summary>
      <div class="cbody">
      <div class="memo-head"><span class="muted">${c.payPlan ? '직접 넣은 날짜' : '자동'}</span>${c.payPlan ? '<button type="button" class="link sm" data-act="payauto">자동으로</button>' : ''}</div>
      <input type="text" data-date inputmode="numeric" maxlength="10" placeholder="예: 20261023" autocomplete="off" data-act="payplan" value="${isoOf(b && b.date)}" aria-label="지출요청일(증명서 유효기간을 이 날짜로 따짐)">
      <p class="req-how">${b ? esc(b.how) : '준공일을 알 수 없어 직접 넣어 주세요'}<br>증명서 유효기간은 이 날짜까지 남아 있어야 합니다.</p>
      ${items ? `<ul class="req-list">${items}</ul>` : '<p class="req-ok">업체에 다시 받을 서류가 없습니다.</p>'}
      ${st.missing.length ? `<button type="button" class="link sm recvall" data-act="recvall" title="이미 처리한 지난 계약처럼 서류를 따로 넣지 않을 때">빠진 서류 ${st.missing.length}개 모두 '받음'으로 표시</button>` : ''}
      <button type="button" class="btn${n.missing.length || n.reissue.length || n.via.length ? ' primary' : ''} block" data-act="mail"${n.missing.length || n.reissue.length || n.via.length ? '' : ' disabled'}>보완 요청 메일 쓰기</button>
    </div></details>`;
  }
  function memoCard(c) {
    const m = memoOf(c);
    const f = (k, label, ph, extra = '') => `<label class="mf"><span>${label}</span><input type="text" data-memo="${k}" value="${esc(m[k] || '')}" placeholder="${esc(ph)}" autocomplete="off"${extra}></label>`;
    const bo = budgetOf(c), b = bo.v;
    // 예산 출처: 직접 / 서류 / 나라장터 / 모름
    const src = bo.manual ? `직접 고름 · <button type="button" class="link sm" data-act="budgetauto">자동으로</button>`
      : b === 'unknown' ? '<span class="unk">모름 — 구매요구서·기안문이 오거나 설정의 외부 예산 사업 이름에 맞으면 자동으로</span>' : `<span title="${esc(bo.why)}">자동: ${esc(bo.why.length > 28 ? bo.why.slice(0, 28) + '…' : bo.why)}</span>`;
    const who = [m.dept, m.person, m.phone].filter(Boolean).join(' ');
    const sum = [`예산 ${b === 'ext' ? '외부' : b === 'own' ? '우리' : '모름'}`, who ? `감독 ${who}` : '', m.note ? String(m.note).replace(/\s+/g, ' ').slice(0, 40) : ''].filter(Boolean).map(esc).join(' · ');
    return `<details class="dcard memo" data-card="memo"${cardOpen.memo ? ' open' : ''} aria-label="계약 메모">
      <summary><h3>메모</h3><span class="csum">${sum}</span></summary>
      <div class="cbody">
      <div class="memo-head"><span class="muted" id="memoState">자동 저장</span></div>
      <div class="mf"><span>예산${src ? ` <small class="bsrc">${src}</small>` : ''}</span><div class="seg budget" role="group" aria-label="예산 구분">${[['own', '우리 예산'], ['ext', '외부(e나라도움 등)']].map(([k, v]) => `<button type="button" data-act="budget" data-v="${k}" class="${k === b ? 'on' : ''}" aria-pressed="${k === b}" title="${esc(BUDGET[k])}">${esc(v)}</button>`).join('')}</div></div>
      <div class="memo-grid">
        ${f('dept', '감독부서', '예: 시설관리팀')}${f('person', '감독관', '이름')}${f('phone', '연락처', '예: 031-000-0000', ' inputmode="tel"')}
        ${f('vmail', '업체 메일', '보완 요청 메일 받는 사람', ' inputmode="email"')}
        <label class="mf wide"><span>특이사항</span><textarea data-memo="note" rows="4" placeholder="예: 준공검사 10/20 예정, 하자보증서 원본은 업체가 직접 가져오기로 함">${esc(m.note || '')}</textarea></label>
      </div>
      <p class="memo-foot">이 PC에만 저장되고 인쇄본에는 들어가지 않습니다.</p></div></details>`;
  }
  // ---------- 지출 회차 화면 ----------
  const NEXT = {
    prog: ['업체 기성계 접수(감독관 경유 확인)', '감독부서에 기성검사원 지정통보 발송', '기성부분 검사조서 접수', '업체에 청구 서류 요청·접수', '지출결의'],
    labor: ['노무비 청구서(감독관 경유)·지급 내역 받기', '지출결의'],
    adv: ['선금 청구서·보증서 받기', '지출결의'],
  };
  // 계약이 어느 상태 목록에 드는지: 준공(마지막) 상태 + 회차(선금·기성·노무비) 상태
  //  - 서류 미비: 준공이나 아직 지출 안 한 회차에 빠진 서류 / 지출 대기: 준공이나 회차 하나라도 서류를 다 갖춤 / 지출 완료: 준공이나 회차 하나라도 지출함
  function inState(st, k) {
    const rs = st.rounds || [];
    if (k === 'missing') return st.state === 'missing' || st.state === 'empty' || rs.some((x) => x.s.state === 'missing');
    if (k === 'ready') return st.state === 'ready' || rs.some((x) => x.s.state === 'ready');
    if (k === 'paid') return st.state === 'paid' || rs.some((x) => x.s.state === 'paid');
    if (k === 'round') return !!st.roundOpen;
    return true;
  }
  // 목록에 같이 보일 회차 하나: 지출 대기인 회차 > 진행 중인 회차 > 마지막으로 지출한 회차
  const roundFocus = (st) => { const rs = st.rounds || []; return rs.find((x) => x.s.state === 'ready') || st.roundOpen || [...rs].reverse().find((x) => x.s.state === 'paid') || null; };
  function roundPill(x, small) {
    const s = x.s, r = x.r, cls = small ? ' sub' : '';
    const lb = small ? `${esc(s.label)} ` : '';
    if (s.state === 'paid') return `<span class="pill paid${cls}">${lb}${small ? '지출 완료' : '지출'} ${esc(L.fmtDate(r.paidDate).slice(5))}</span>`;
    if (s.state === 'empty') return `<span class="pill none${cls}">${lb}시작 전</span>`;
    if (s.state === 'missing') return `<span class="pill miss${cls}">${lb}미비 ${s.need}</span>`;
    return `<span class="pill ready${cls}">${lb}지출 대기</span>`;
  }
  // 진행 막대: 필수 서류 들어온 비율(지출 처리하면 꽉 참)
  const pbar = (done, total, paid, title) => { const pct = paid ? 100 : total ? Math.round((done / total) * 100) : 0; return `<span class="pbar${paid ? ' paid' : pct === 100 ? ' full' : ''}" title="${esc(title || '')}"><span class="track"><i style="width:${pct}%"></i></span><span class="num">${paid ? '완료' : `${done}/${total}`}</span></span>`; };
  function nextText(x) {
    const s = x.s;
    if (s.state === 'paid') return `${L.fmtDate(x.r.paidDate)} 지출 완료${x.r.payMemo ? ` · ${x.r.payMemo}` : ''}`;
    if (s.cur < 0) return s.need ? '서류 보완(유효기간·경유) 후 지출 처리' : '[지출 처리]로 완료 표시';
    return '다음: ' + ((NEXT[x.r.kind] || [])[s.cur] || s.steps[s.cur].name);
  }
  function roundRow(c, r, x, rs, list) {
    const docs = rs.docs;
    const got = r.received || {}, all = docsOf(c.key);
    const ds = x.link ? all.filter((d) => d.itemId === x.id) : docs.filter((d) => d.itemId === x.id);
    const inner = x.link ? [] : docs.filter((d) => d.itemId !== x.id && (d.also || []).includes(x.id));
    const rcv = !!got[x.id] || (x.link && !!gotMap(c)[x.id]);
    let mark, side;
    if (ds.length || inner.length) { mark = '<span class="mark ok">✓</span>'; side = ds.length ? `<span class="num">${ds.length}개</span>` : '<span class="muted">묶음 파일 안</span>'; }
    else if (rcv) { mark = '<span class="mark rcv">✓</span>'; side = '<span class="rcv-t">받음 표시</span>'; }
    else if (x.required) { mark = '<span class="mark miss">✕</span>'; side = '<span class="missing">누락</span>'; }
    else { mark = '<span class="mark opt">–</span>'; side = '<span class="optional">해당 시</span>'; }
    if (x.link) side += ' <span class="muted small">(아래 선금 칸과 같은 서류)</span>';
    const cv = rs.certs.find((v) => v.item.id === x.id);
    if (cv) {
      if (cv.status === 'short') { mark = '<span class="mark miss">!</span>'; side = `<span class="valid bad" title="지출요청일 ${esc(L.fmtDate(rs.basis.date))}보다 먼저 끝남">${esc(L.fmtDate(cv.valid).slice(5))}까지 · 재발급</span>`; }
      else if (cv.status === 'unknown') side = '<span class="valid unk">유효기간 확인</span>';
      else side = `<span class="valid ok">${esc(L.fmtDate(cv.valid).slice(5))}까지 유효</span>`;
    }
    if (x.link && L.isAdvBond(x.id) && ds.length) { const a = advOf(c); if (a && a.status === 'short') { mark = '<span class="mark miss">!</span>'; side = `<span class="valid bad">${esc(L.fmtDate(a.end))}까지 · 준공일+${a.days}일 — 유효하지 않음</span>`; } else if (a && a.status === 'ok') side = `<span class="valid ok">${esc(L.fmtDate(a.end))}까지 · 준공일+${a.days}일 유효</span>`; }
    const present = !!(ds.length || inner.length || rcv);
    const via = /-(progfin|laborclaim)$/.test(x.id) ? (() => { const on = !!(r.via || {})[x.id]; return `<div class="via${present ? '' : ' off'}"><span class="via-l">감독관 경유</span><label class="via-c${on ? ' on' : present ? ' no' : ''}"><input type="checkbox" data-act="rvia" data-round="${esc(r.id)}" data-item="${esc(x.id)}"${on ? ' checked' : ''}> 경유함</label></div>`; })() : '';
    const tog = ds.length || x.link ? '' : `<label class="orig-toggle recv" title="파일 없이 이미 받았거나 처리했으면 체크"><input type="checkbox" data-act="rrecv" data-round="${esc(r.id)}" data-item="${esc(x.id)}"${got[x.id] ? ' checked' : ''}> 받음</label>`;
    const add = x.link ? '' : `<button class="add-item" data-act="additem" data-item="${esc(x.id)}" data-pay="${esc(r.id)}" title="${esc(x.name)}(으)로 바로 넣기">+ 추가</button>`;
    return `<div class="row"${x.link ? '' : ` data-drop-item="${esc(x.id)}" data-drop-pay="${esc(r.id)}"`}>${mark}<div class="rname">${esc(x.name)}${x.note ? `<span class="note">${esc(x.note)}</span>` : ''}${via}</div>
      <div class="rside">${tog}${side}${add}</div>${ds.length || inner.length ? `<div class="files">${ds.map((d) => fileRow(d, list)).join('')}${inner.map((d) => `<div class="file inner"><span class="ft">묶음</span><span class="fn" title="${esc(d.name)}">${esc(d.name)}</span><button class="link sm" data-act="view" data-doc="${d.id}">보기</button><button class="x" data-act="unalso" data-doc="${d.id}" data-item="${esc(x.id)}" title="이 칸에서만 빼기(묶음 파일과 다른 칸은 그대로)" aria-label="이 칸에서만 빼기">✕</button></div>`).join('')}</div>` : ''}</div>`;
  }
  function roundBlock(c, x, st) {
    const r = x.r, s = x.s, list = classList(c);
    const open = ui.roundOpen && r.id in ui.roundOpen ? ui.roundOpen[r.id] : (s.state !== 'paid' && !!st.roundOpen && st.roundOpen.r.id === r.id);
    const chips = s.steps.map((g, i) => `<span class="rstep${g.complete ? ' ok' : i === s.cur && s.state !== 'paid' ? ' now' : ''}" title="${esc(g.name)}${g.req ? ` · 필수 ${g.done}/${g.req}` : ''}">${g.complete ? '✓' : i + 1}<i>${esc(g.name.replace(/\(.*\)/, ''))}</i></span>`).join('');
    const vendorNeed = s.missing.filter((y) => L.ORIGINAL_SOURCES.includes(y.source) && !y.link).length + s.expired.length + s.via.length;
    const askNow = s.state !== 'paid' && (r.kind !== 'prog' || s.cur >= 3) && vendorNeed;
    return `<details class="round${s.state === 'paid' ? ' paid' : ''}" data-round="${esc(r.id)}"${open ? ' open' : ''}>
      <summary><b class="rlabel">${esc(s.label)}</b>${pbar(s.reqDone, s.reqTotal, s.state === 'paid', `필수 서류 ${s.reqDone}/${s.reqTotal}`)}<span class="rsteps">${chips}</span><span class="rnext${s.state === 'paid' ? ' ok-t' : ''}">${esc(nextText(x))}</span>${roundPill(x)}
        <button type="button" class="btn sm${s.state === 'ready' ? ' primary' : ''}" data-act="roundpay" data-round="${esc(r.id)}">${r.paidDate ? '지출 수정' : '지출 처리'}</button></summary>
      <div class="rbody">
        ${r.kind === 'labor' ? `<label class="rmonth">몇 월분<select data-act="rmonth" data-round="${esc(r.id)}"><option value="">모름</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${r.month === i + 1 ? ' selected' : ''}>${i + 1}월분</option>`).join('')}</select></label>` : ''}
        ${s.steps.map((g, i) => `<section class="rstage${g.complete ? ' done' : ''}"><div class="stage-head"><span class="stage-no">${i + 1}</span><h4>${esc(g.name)}</h4>${g.req ? `<span class="sum num">필수 ${g.done}/${g.req}</span>` : ''}</div>
          ${g.items.map((it) => roundRow(c, r, it, s, list)).join('')}</section>`).join('')}
        <div class="rfoot">
          <label class="rplan">지출요청일 <input type="text" data-date inputmode="numeric" maxlength="10" placeholder="예: 20261023" autocomplete="off" data-act="rpayplan" data-round="${esc(r.id)}" value="${isoOf(s.basis.date)}"><small class="muted">${esc(s.basis.how)} — 증명서 유효기간을 이 날짜로 따짐</small>${r.payPlan ? ` <button type="button" class="link sm" data-act="rpayauto" data-round="${esc(r.id)}">자동으로</button>` : ''}</label>
          <span class="spacer"></span>
          <button type="button" class="btn${askNow ? ' primary' : ''}" data-act="rmail" data-round="${esc(r.id)}"${vendorNeed ? '' : ' disabled'}>${r.kind === 'prog' ? '청구 서류 요청 메일' : '보완 요청 메일'}${vendorNeed ? ` <small>(${vendorNeed})</small>` : ''}</button>
          <button type="button" class="btn" data-act="rprint" data-round="${esc(r.id)}"${s.docs.length ? '' : ' disabled'}>이 회차 인쇄</button>
          <button type="button" class="btn" data-act="rsave" data-round="${esc(r.id)}"${s.docs.length ? '' : ' disabled'}>PDF로 저장</button>
          <button type="button" class="btn ghost danger" data-act="rdel" data-round="${esc(r.id)}">회차 지우기</button>
        </div>
      </div></details>`;
  }
  function roundsCard(c, st) {
    if (!L.hasRounds(c.type)) return '';
    const hasAdv = roundsOf(c).some((r) => r.kind === 'adv');
    const add = `<span class="radd"><button type="button" class="btn sm" data-act="roundadd" data-kind="prog">+ 기성 회차</button><button type="button" class="btn sm" data-act="roundadd" data-kind="labor">+ 노무비 회차</button>${hasAdv ? '' : '<button type="button" class="btn sm" data-act="roundadd" data-kind="adv">+ 선금 회차</button>'}</span>`;
    if (!st.rounds.length) return `<section class="rounds none"><div class="rounds-head"><h3>지출 회차 <small>기성·노무비·선금</small></h3><span class="muted small">중간에 나가는 지출이 있으면 여기서 회차마다 확인합니다. <b>기성계·기성 검사조서·노무비 청구서</b>를 올리면 회차가 저절로 생기고, 오른쪽 버튼으로 직접 만들어도 됩니다.</span>${add}</div></section>`;
    const paid = st.rounds.filter((x) => x.s.state === 'paid').length;
    // 회차가 많은 장기 공사(10회 이상)도 한눈에: 회차마다 칸 하나(지출 완료·지출 대기·미비·시작 전), 누르면 그 회차를 펼침
    const short = (r) => (r.kind === 'prog' ? `${r.n}차` : r.kind === 'adv' ? '선금' : r.month ? `${r.month}월` : `노${r.n}`);
    const track = `<div class="rtrack" role="list" aria-label="회차별 지출">${st.rounds.map((x) => `<button type="button" role="listitem" class="rt ${x.s.state}" data-act="rjump" data-round="${esc(x.r.id)}" title="${esc(x.s.label)} · ${esc({ paid: '지출 완료 ' + L.fmtDate(x.r.paidDate), ready: '지출 대기', missing: '미비 ' + x.s.need, empty: '시작 전' }[x.s.state])}">${x.r.kind === 'labor' ? '<small>노</small>' : ''}${esc(short(x.r))}</button>`).join('')}<button type="button" class="rt next" data-act="roundadd" data-kind="prog" title="다음 기성 회차를 지금 만들기(기성계가 오면 저절로 생김)">+</button></div>`;
    const fin = st.state === 'paid' ? `<span class="pill paid">지출 ${esc(L.fmtDate(c.paidDate).slice(5))}</span>` : pillFor(st, c);
    return `<section class="rounds"><div class="rounds-head"><h3>지출 회차</h3><span class="muted small">지금까지 <b>${paid}회 지출</b>${st.roundOpen ? ` · 진행 중 ${esc(st.roundOpen.s.label)}` : ''} · 몇 회가 될지 몰라도 됩니다 — 다음 기성계·노무비 청구서가 오면 다음 회차가 저절로 생깁니다</span>${add}</div>
      ${track}
      ${st.rounds.map((x) => roundBlock(c, x, st)).join('')}
      <div class="round final"><b class="rlabel">준공(마지막)</b>${pbar(st.reqDone, st.reqTotal, st.state === 'paid', `필수 서류 ${st.reqDone}/${st.reqTotal}`)}<span class="rnext muted">아래 서류 목록 — 준공계 → 준공검사원 지정통보 → 준공조서 → 청구 서류 → 지출결의</span>${fin}</div></section>`;
  }
  function renderDetail() {
    const el = $('#detail');
    const c = ui.sel && db.contracts[ui.sel];
    if (!c) {
      el.innerHTML = `<div class="empty-state"><h2>계약을 고르거나 서류를 넣어 시작하세요</h2>
        <p>받은 서류를 이 창에 끌어다 놓으면 내용을 읽어 계약 건과 서류 종류를 찾아 정리합니다. 계약서가 들어오면 계약 건도 자동으로 만들어집니다.</p>
        <button class="btn primary" data-act="add">업로드</button></div>`;
      return;
    }
    const list = lists(c.type), docs = finalDocs(c), st = statusOf(c);
    const srcLabel = { api: '나라장터', doc: '계약서에서 만듦', manual: '직접 추가' }[c.source] || '';
    const period = c.startDate || c.endDate ? `${L.fmtDate(c.startDate) || '?'} – ${L.fmtDate(c.endDate) || '?'}` : (c.period || '');
    const groups = [];
    list.forEach((x) => { let g = groups.find((g) => g.name === x.group); if (!g) { g = { name: x.group, items: [] }; groups.push(g); } g.items.push(x); });
    const untyped = docs.filter((d) => !d.itemId);
    el.innerHTML = `
      <div class="dhead">
        <div>
          <div class="kicker"><span class="tag">${esc(c.type)}</span>${isExt(c) ? '<span class="tag ext" title="우리 예산이 아닌 사업(e나라도움 등)">외부 예산</span>' : ''}${srcLabel ? `<span class="tag src">${esc(srcLabel)}</span>` : ''}${c.no ? `<span class="num">${esc(c.no)}</span>` : ''}</div>
          <h1 class="cname">${esc(c.name || '이름 없는 계약')}</h1>
          <div class="facts">
            <span>업체 <b>${esc(c.vendor || '-')}</b></span>
            ${c.amount ? `<span>계약금액 <b class="amount">${esc(L.won(c.amount))}</b></span>` : ''}
            ${period ? `<span>기간 <b class="date">${esc(period)}</b>${st.late ? ' <b style="color:var(--seal)">준공 지남</b>' : ''}</span>` : ''}
            ${c.officer ? `<span>담당 <b>${esc(c.officer)}</b>${c.dept ? ` (${esc(c.dept)})` : ''}</span>` : ''}
            ${c.paidDate ? `<span>지출 <b class="date">${esc(L.fmtDate(c.paidDate))}</b>${c.payMemo ? ` ${esc(c.payMemo)}` : ''}</span>` : ''}
            ${st.rounds && st.rounds.length ? `<span>중간 지출 <b class="num">${st.rounds.filter((x) => x.s.state === 'paid').length}회</b>${st.roundOpen ? ` · 진행 중 ${esc(st.roundOpen.s.label)}` : ''}</span>` : ''}
          </div>
          <div class="actions">
            <button class="btn primary" data-act="print"${Object.keys(c.noPrint || {}).length ? ` title="인쇄에서 뺀 서류 ${Object.keys(c.noPrint).length}개는 빼고 인쇄합니다"` : ''}>한 번에 인쇄${Object.keys(c.noPrint || {}).length ? ` <small>(${Object.keys(c.noPrint).length}개 뺌)</small>` : ''}</button>
            <button class="btn" data-act="save">PDF로 저장</button>
            <button class="btn" data-act="folder">폴더 열기</button>
            ${c.url ? `<a class="btn ghost" href="${esc(c.url)}" target="_blank" rel="noopener">나라장터에서 보기</a>` : ''}
            <span class="spacer"></span>
            <button class="btn" data-act="pay">${c.paidDate ? '지출 정보 수정' : '지출 처리'}</button>
            <button class="btn ghost" data-act="edit">계약 수정</button>
          </div>
        </div>
        ${sealSvg(st, c)}
      </div>
      <div class="dbody">
      <div class="dropin" id="dropin"><button class="btn primary" data-act="addhere">업로드</button>
        <span>이 계약 서류로 올립니다. 서류 종류는 자동으로 찾고, 파일을 여기에 끌어다 놓아도 됩니다.</span></div>
      ${roundsCard(c, st)}
      <div class="dtop">${reqCard(c, st)}${memoCard(c)}${auditCard(c)}</div>
      ${st.rounds && st.rounds.length ? '<h3 class="final-head">준공(마지막 지출) 서류</h3>' : ''}
      <div class="stages">
        ${untyped.length ? `<section class="stage"><div class="stage-head"><span class="stage-no" style="background:var(--amber)">?</span><h3>서류 종류를 정해 주세요</h3><span class="where">이 계약 서류인데 어떤 서류인지 찾지 못했습니다</span></div>
          <div class="row"><span class="mark warn">!</span><div class="rname">종류 미정 ${untyped.length}개</div><div class="rside"></div><div class="files">${untyped.map((d) => fileRow(d, list)).join('')}</div></div></section>` : ''}
        ${groups.map((g, gi) => {
          const req = g.items.filter((x) => x.required);
          const done = req.filter((x) => L.hasItem(docs, gotMap(c), x.id) || (x.alt && L.hasItem(docs, gotMap(c), x.alt))).length;
          const where = [...new Set(g.items.map((x) => SRC_LABEL[x.source] || x.source))].join(', ');
          const folded = foldSet().has(g.name);
          return `<section class="stage${req.length && done === req.length ? ' done' : ''}${folded ? ' folded' : ''}">
            <div class="stage-head" data-fold="${esc(g.name)}" role="button" tabindex="0" aria-expanded="${!folded}" title="${folded ? '눌러서 펼치기' : '눌러서 접기'} (접어 둔 단계는 다른 계약에서도 접혀 있음)"><span class="fold-ic" aria-hidden="true">▾</span><span class="stage-no">${gi + 1}</span><h3>${esc(g.name)}</h3><span class="where">${esc(where)}</span>${(() => { const vs = L.viaStatus(c, g.items, (id) => L.hasItem(docs, gotMap(c), id) || docs.some((d) => (d.also || []).includes(id))); return vs.need ? `<span class="sum num via-sum${vs.done < vs.need ? ' bad-t' : ''}" title="${esc(vs.missing.length ? '경유 안 됨: ' + vs.missing.join(', ') : '모두 경유')}">감독관 경유 ${vs.done}/${vs.need}</span>` : ''; })()}<span class="sum num">필수 ${done}/${req.length}</span></div>
            ${g.items.map((x) => {
              const ds = docs.filter((d) => d.itemId === x.id);
              const inner = docs.filter((d) => d.itemId !== x.id && (d.also || []).includes(x.id));
              const orig = !!(c.originals || {})[x.id], rcv = !!(c.received || {})[x.id];
              const canOrig = L.ORIGINAL_SOURCES.includes(x.source);
              const altItem = x.alt && L.hasItem(docs, gotMap(c), x.alt) ? list.find((y) => y.id === x.alt) : null;
              let mark, side;
              if (!ds.length && inner.length) { mark = '<span class="mark ok">✓</span>'; side = '<span class="muted">묶음 파일 안</span>'; }
              else if (!ds.length && !orig && !rcv && altItem) { mark = '<span class="mark opt">–</span>'; side = `<span class="optional">대신 ${esc(itemView(c, altItem).name)} 있음</span>`; }
              else if (ds.length) { const warn = ds.some((d) => (d.kind === 'hwp' && !d.pdfPath) || (d.kind === 'other' && !/\.(xlsx?|docx?)$/i.test(d.name))); mark = warn ? '<span class="mark warn">!</span>' : '<span class="mark ok">✓</span>'; side = `<span class="num">${ds.length}개</span>`; }
              else if (orig) { mark = '<span class="mark orig">원</span>'; side = '<span>원본 받음</span>'; }
              else if (rcv) { mark = '<span class="mark rcv">✓</span>'; side = '<span class="rcv-t">받음 표시</span>'; }
              else if (x.required) { mark = '<span class="mark miss">✕</span>'; side = '<span class="missing">누락</span>'; }
              else { mark = '<span class="mark opt">–</span>'; side = '<span class="optional">해당 시</span>'; }
              const tog = (canOrig ? `<label class="orig-toggle" title="종이 원본으로 받았으면 체크하세요. 인쇄본의 이 자리에 원본을 끼울 안내 페이지가 들어갑니다."><input type="checkbox" data-act="orig" data-item="${esc(x.id)}"${orig ? ' checked' : ''}> 원본</label>` : '')
                + (ds.length ? '' : `<label class="orig-toggle recv" title="파일 없이 이미 받았거나 처리한 서류면 체크하세요(지난 계약 등). 빠진 서류에서 빠지고, 인쇄 목록표에는 '받음 표시'로 나옵니다."><input type="checkbox" data-act="recv" data-item="${esc(x.id)}"${rcv ? ' checked' : ''}> 받음</label>`);
              const xv = itemView(c, x);
              // 법인등기사항증명서·인감증명서: 계약일 기준 3개월 이내 발급분인지
              if (ds.length && L.isRecentItem(x.id)) {
                const iss = ds.map((d) => (d.dates && (d.dates.issue || d.dates.last)) || '').filter(Boolean).sort().pop();
                const early = L.issuedTooEarly(iss, c.contractDate);
                if (early === true) { mark = '<span class="mark miss">!</span>'; side = `<span class="valid bad" title="계약일 ${esc(L.fmtDate(c.contractDate))} 기준 3개월 이내 발급분이어야 합니다">${esc(L.fmtDate(iss))} 발급 · 3개월 넘음</span>`; }
                else if (early === false) side = `<span class="valid ok">${esc(L.fmtDate(iss))} 발급 · 3개월 이내</span>`;
              }
              // 선금 보증서: 보증기간 끝 - 준공일 ≥ 60일
              if (ds.length && L.isAdvBond(x.id)) {
                const a = advOf(c);
                if (a.status === 'ok') side = `<span class="valid ok" title="보증기간 끝이 준공일 ${esc(L.fmtDate(c.endDate))}로부터 ${a.days}일 뒤">${esc(L.fmtDate(a.end))}까지 · 준공일+${a.days}일 유효</span>`;
                else if (a.status === 'short') { mark = '<span class="mark miss">!</span>'; side = `<span class="valid bad" title="준공일 ${esc(L.fmtDate(c.endDate))}로부터 ${L.ADV_DAYS}일 이상(${esc(L.fmtDate(a.need))}까지) 남아야 합니다">${esc(L.fmtDate(a.end))}까지 · 준공일+${a.days}일 — 유효하지 않음</span>`; }
                else if (a.status === 'noend') side = '<span class="valid unk">준공일을 몰라 판단 못 함</span>';
                else side = '<span class="valid unk" title="보증기간을 읽지 못했습니다. 아래 날짜 칸에 끝 날짜를 넣어 주세요.">보증기간 확인</span>';
              }
              const cv = (st.certs || []).find((v) => v.item.id === x.id);
              if (cv && ds.length) {
                if (cv.status === 'short') { mark = '<span class="mark miss">!</span>'; side = `<span class="valid bad" title="지출요청일 ${esc(L.fmtDate(st.basis.date))}보다 먼저 끝남">${esc(L.fmtDate(cv.valid).slice(5))}까지 · 재발급</span>`; }
                else if (cv.status === 'unknown') side = '<span class="valid unk" title="유효기간을 읽지 못했습니다. 아래 날짜 칸에 넣어 주세요.">유효기간 확인</span>';
                else side = `<span class="valid ok" title="지출요청일까지 유효">${esc(L.fmtDate(cv.valid).slice(5))}까지 유효</span>`;
              }
              const add = `<button class="add-item" data-act="additem" data-item="${esc(x.id)}" title="${esc(xv.name)}(으)로 바로 넣기">+ 추가</button>`;
              const np = !!(c.noPrint || {})[x.id], printable = !!(ds.length || inner.length || orig);
              const prt = printable ? `<label class="orig-toggle prt${np ? ' off' : ''}" title="체크를 빼면 [한 번에 인쇄]·[PDF로 저장]에서 이 서류를 뺍니다"><input type="checkbox" data-act="noprint" data-item="${esc(x.id)}"${np ? '' : ' checked'}> 인쇄</label>` : '';
              const vps = L.viaParts(x.id), vv = c.via || {}, present = !!(ds.length || inner.length || orig || rcv);
              const viaHtml = vps ? `<div class="via${present ? '' : ' off'}"${present ? '' : ' title="서류가 들어오면 경유를 체크하세요"'}><span class="via-l">감독관 경유</span>${vps.map((p) => { const on = !!vv[L.viaKey(x.id, p)]; return `<label class="via-c${on ? ' on' : present ? ' no' : ''}"><input type="checkbox" data-act="via" data-item="${esc(x.id)}" data-part="${esc(p)}"${on ? ' checked' : ''}> ${esc(p || '경유함')}</label>`; }).join('')}</div>` : '';
              return `<div class="row" data-drop-item="${esc(x.id)}">${mark}<div class="rname">${esc(xv.name)}${xv.note ? `<span class="note">${esc(xv.note)}</span>` : ''}${viaHtml}</div>
                <div class="rside">${prt}${tog}${side}${add}</div>${ds.length || inner.length ? `<div class="files">${ds.map((d) => fileRow(d, list)).join('')}${inner.map((d) => `<div class="file inner"><span class="ft">묶음</span><span class="fn" title="${esc(d.name)}">${esc(d.name)}</span><span class="muted small">${(d.pagesOf && d.pagesOf[x.id] && d.pagesOf[x.id].length) ? esc(d.pagesOf[x.id].join('·')) + '쪽' : '이 파일 안'}</span><button class="link sm" data-act="view" data-doc="${d.id}">보기</button><button class="x" data-act="unalso" data-doc="${d.id}" data-item="${esc(x.id)}" title="이 칸에서만 빼기(묶음 파일과 다른 칸은 그대로)" aria-label="이 칸에서만 빼기">✕</button></div>`).join('')}</div>` : ''}</div>`;
            }).join('')}
          </section>`;
        }).join('')}
      </div>
      </div>`;
    autoAudit(c);
  }

  // 예전 버전에서 올린 서류(날짜를 아직 안 읽은 증명서·준공계·준공조서)는 계약을 열 때 한 번 읽어 둠 — 다시 설치해도 그대로 이어서 씀
  const datesPending = new Set();
  async function backfillDates(c) {
    const need = docsOf(c.key).filter((d) => !d.missing && !datesPending.has(d.id) && ((!d.dates && (L.isCertItem(d.itemId) || /-(finish|inspect|progfin|proginsp)$/.test(d.itemId || ''))) || (L.isAdvBond(d.itemId) && !(d.dates && 'bondEnd' in d.dates))));
    if (!need.length) return;
    need.forEach((d) => datesPending.add(d.id));
    for (const d of need) {
      try { const b = await S.readBytes(d.path); const { lines } = await R.read(b, d.kind, d.mime); d.dates = L.extractDates(lines); }
      catch (e) { console.warn('날짜 읽기 실패', d.path, e); d.dates = L.extractDates([]); }
    }
    await saveDb(true);
    if (ui.sel === c.key) render();
  }

  // 메모 칸 높이를 내용에 맞춤
  const fitMemo = () => $$('textarea[data-memo]').forEach((t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; });

  // ---------- 엑셀로 받기 ----------
  const XLS_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const stateText = (st) => (st.state === 'paid' ? '지출 완료' : st.state === 'empty' ? '서류 없음' : st.state === 'missing' ? '서류 미비' : '지출 대기');
  function excelSheets(rows) {
    const contractsSheet = {
      name: '계약 현황',
      cols: [{ h: '번호', w: 6, type: 'int' }, { h: '상태', w: 10 }, { h: '계약명', w: 36 }, { h: '구분', w: 7 }, { h: '예산', w: 12 }, { h: '업체', w: 22 },
        { h: '계약번호', w: 20 }, { h: '계약금액', w: 15, type: 'money' }, { h: '시작일', w: 12, type: 'date' }, { h: '준공일', w: 12, type: 'date' }, { h: '준공 지남', w: 10 },
        { h: '계약 담당', w: 10 }, { h: '담당부서', w: 12 }, { h: '감독부서', w: 14 }, { h: '감독관', w: 10 }, { h: '감독 연락처', w: 15 },
        { h: '필수 서류', w: 10 }, { h: '빠진 서류', w: 40, type: 'wrap' }, { h: '재발급 필요(유효기간)', w: 34, type: 'wrap' }, { h: '지출요청일', w: 12, type: 'date' }, { h: '원본 받음', w: 9, type: 'int' }, { h: '지출일', w: 12, type: 'date' }, { h: '지출 메모', w: 18 }, { h: '특이사항', w: 44, type: 'wrap' }],
      rows: rows.map(({ c, st }, i) => {
        const m = memoOf(c);
        return [i + 1, stateText(st), c.name, c.type, budgetText(c), c.vendor, c.no, c.amount || '', c.startDate, c.endDate, st.late ? '준공 지남' : '',
          c.officer, c.dept, m.dept, m.person, m.phone, `${st.reqDone}/${st.reqTotal}`, st.missing.map((x) => itemView(c, x).name).join(', '),
          st.expired.map((x) => `${itemView(c, x.item).name}(${L.fmtDate(x.valid)}까지)`).join(', '), st.basis ? st.basis.date : '', st.origCount || '', c.paidDate, c.payMemo, m.note];
      }),
    };
    const detail = { name: '서류 상세', cols: [{ h: '계약명', w: 36 }, { h: '계약번호', w: 20 }, { h: '단계', w: 10 }, { h: '서류', w: 30 }, { h: '필수', w: 7 }, { h: '상태', w: 10 }, { h: '파일', w: 50, type: 'wrap' }], rows: [] };
    for (const { c } of rows) {
      const docs = docsOf(c.key);
      for (const x of lists(c.type)) {
        const ds = docs.filter((d) => L.holds(d, x.id)); const orig = !!(c.originals || {})[x.id], rcv = !!(c.received || {})[x.id];
        detail.rows.push([c.name, c.no, x.group, itemView(c, x).name, x.required ? '필수' : '해당 시', ds.length ? '받음' : orig ? '원본 받음' : rcv ? '받음 표시' : x.required ? '누락' : '', ds.map((d) => d.name).join('\n')]);
      }
    }
    return [contractsSheet, detail];
  }
  async function exportExcel(rows) {
    if (!rows.length) { toast('엑셀로 받을 계약이 없습니다.', 'err'); return; }
    const sheets = excelSheets(rows);
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const name = `계약현황_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`;
    const bytes = JH.xlsx.build({ title: '계약 현황', sheets });
    const saved = await S.save('현황', name, bytes);
    if (S.showTable) { S.showTable(name, sheets); return; } // 시연판: 화면 미리보기
    toast(`계약 ${rows.length}건을 엑셀로 저장했습니다 (현황 폴더).`, 'ok', { label: '폴더 열기', run: () => S.open('현황') });
    try { await S.openFile(saved.path); } catch (_) { /* 엑셀이 없으면 폴더에서 열면 됨 */ }
  }

  // ---------- 나라장터 세부 정보(감사·검사 서식용) ----------
  // 변경이력 → 당초 계약금액·설계변경·기간연장, 공고가 있는 계약은 입찰공고(예산)·예비가격(예정가격·기초금액)·낙찰(업체 주소), 그 밖엔 조달업체 기본정보(주소)
  const needsEnrich = (c) => c && (c.untyNo || c.ntceNo || c.bizno) && (!c.g2b || c.g2b.v !== 3 || c.g2b.chgDt !== (c.chgDt || '') || c.g2b.retry);
  // 서비스마다 결과를 남김(st): ok 받음 · none 자료 없음 · skip 해당 없음(공고번호·사업자번호 없음) · err 못 받음(이유)
  const G2B_LABEL = { chg: '변경이력', bid: '입찰공고(예산)', prepar: '예정가격', scsbid: '낙찰', corp: '업체 정보' };
  async function enrichOne(c, errs, corpCache, diag) {
    const g = { v: 3, at: new Date().toISOString(), chgDt: c.chgDt || '', st: {} }; let retry = false;
    const get = async (kind, arg) => {
      const name = L.G2B[kind].name; if (errs.has(name)) { retry = true; g.st[kind] = 'err:' + errs.get(name); return null; }
      try {
        const body = await S.nara(L.g2bUrl(kind, c.type, arg, cfg.apiKey));
        if (diag && diag.length < 40) diag.push({ 계약: c.name, 종류: G2B_LABEL[kind], 응답: body });
        const items = L.parseApiBody(body).items;
        g.st[kind] = items.length ? 'ok' : 'none';
        return items;
      } catch (e) {
        if (/활용신청|권한|등록되지|횟수|기간이 끝/.test(e.message)) errs.set(name, e.message); // 권한 문제면 다른 계약도 건너뜀
        retry = true; g.st[kind] = 'err:' + e.message;
        if (diag && diag.length < 40) diag.push({ 계약: c.name, 종류: G2B_LABEL[kind], 오류: e.message });
        return null;
      }
    };
    if (c.untyNo) { const sm = L.summarizeChanges(await get('chg', c.untyNo)); if (sm) Object.assign(g, sm); } else g.st.chg = 'skip';
    if (c.ntceNo) {
      const b = L.pickBid(await get('bid', c.ntceNo), c.ntceNo); if (b) Object.assign(g, b);
      const p = L.pickPrepar(await get('prepar', c.ntceNo), c.ntceNo); if (p) Object.assign(g, p);
      const w = L.pickScsbid(await get('scsbid', c.ntceNo), c.ntceNo);
      if (w) { g.sucsfAmt = w.amount; g.sucsfRate = w.rate; if (w.addr) g.addr = w.addr; if (w.rep) g.rep = w.rep; if (w.bizno) g.bizno = w.bizno; }
    } else { g.st.bid = g.st.prepar = g.st.scsbid = 'skip'; }
    const bz = c.bizno || g.bizno;
    if (bz && !g.addr) {
      // 같은 업체는 한 번만 조회(동시에 받는 계약끼리도 같은 조회를 기다려 씀)
      const first = !(bz in corpCache);
      if (first) corpCache[bz] = get('corp', bz).then((items) => L.pickCorp(items, bz));
      const k = await corpCache[bz];
      if (!first) g.st.corp = k ? 'ok' : 'none';
      if (k) { g.addr = k.addr; if (!g.rep) g.rep = k.rep; }
    } else if (!bz) g.st.corp = 'skip';
    if (retry) g.retry = true;
    c.g2b = g;
  }
  async function enrichContracts(cs, force) {
    const todo = cs.filter((c) => c && (force ? (c.untyNo || c.ntceNo || c.bizno) : needsEnrich(c)));
    if (!todo.length || !cfg.apiKey) return { done: 0, errs: [] };
    const errs = new Map(), corp = {}, diag = [];
    try {
      // 계약 3건씩 같이 받음(한 건씩 차례로 받을 때보다 2~3배 빠름 · 나라장터는 하루 조회 횟수만 제한)
      let next = 0, done = 0;
      const worker = async () => {
        while (next < todo.length) {
          const c = todo[next++];
          await enrichOne(c, errs, corp, diag);
          done++; progress(`나라장터에서 세부 정보(예정가격·변경이력·업체 주소) 받는 중 ${done}/${todo.length}`, done / todo.length);
          if (done % 10 === 0) saveDb();
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    } finally {
      await saveDb(true); progress(null);
      // 받은 그대로(앞 40개) — 안 채워질 때 원인 확인용: 데이터 폴더 \진단\나라장터_세부응답.json
      if (diag.length) S.writeJson('진단/나라장터_세부응답.json', { at: new Date().toISOString(), items: diag }).catch(() => {});
    }
    const soft = todo.filter((c) => c.g2b && Object.values(c.g2b.st || {}).some((v) => String(v).startsWith('err:'))).length;
    return { done: todo.length, errs: [...errs.entries()], soft };
  }

  // ---------- 감사·검사 자료 칸 ----------
  // 실제 준공일: 준공계 날짜(없으면 준공조서)
  function finishOf(c) {
    const docs = docsOf(c.key);
    const f = docs.filter((d) => /-finish$/.test(d.itemId || '')).map((d) => dateOfDoc(d, 'finish')).filter(Boolean).sort().pop();
    return f || docs.filter((d) => /-inspect$/.test(d.itemId || '')).map((d) => dateOfDoc(d, 'inspect')).filter(Boolean).sort().pop() || '';
  }
  const formRow = (c) => JH.forms.rowOf(c, { finish: finishOf(c) });
  const wonText = (n) => (n ? Number(n).toLocaleString('ko-KR') + '원' : '');
  // 나라장터 세부 정보 받은 결과 한 줄
  function g2bLine(c) {
    if (c.source !== 'api') return '<p class="g2bst muted small">나라장터에서 불러온 계약이 아니라 서류에서만 채웁니다.</p>';
    if (!cfg.apiKey) return '<p class="g2bst warn-t small">나라장터 인증키가 없어 세부 정보를 받지 못했습니다(설정 → 나라장터 연결).</p>';
    const g = c.g2b;
    if (!g) return `<p class="g2bst muted small">${c.untyNo || c.ntceNo || c.bizno ? '아직 세부 정보를 받지 않았습니다. [나라장터에서 다시 받기]를 누르세요.' : '예전 버전에서 불러온 계약이라 계약방법·대표자·사업자번호 등이 아직 없습니다. [새로고침]을 누르면 불러올 기간 전체를 다시 받아 채웁니다(한 번만, 몇 분 걸릴 수 있음).'}</p>`;
    const st = g.st || {};
    const part = (k) => { const v = st[k] || ''; const l = G2B_LABEL[k];
      if (v === 'ok') return `<span class="ok-t">${l} 받음</span>`;
      if (v === 'none') return `<span class="muted">${l} 자료 없음</span>`;
      if (v === 'skip') return k === 'corp' ? `<span class="muted">${l} 해당 없음(사업자번호 없음)</span>` : k === 'chg' ? `<span class="muted">${l} 해당 없음</span>` : '';
      if (v.startsWith('err:')) return `<span class="bad-t" title="${esc(v.slice(4))}">${l} 못 받음</span>`;
      return '';
    };
    const parts = ['chg', 'bid', 'prepar', 'scsbid', 'corp'].map(part).filter(Boolean);
    const noNtce = st.bid === 'skip';
    const errs = [...new Set(Object.values(st).filter((v) => String(v).startsWith('err:')).map((v) => v.slice(4)))];
    const raw = c.corpRaw ? `<details class="g2braw"><summary>나라장터 업체 칸 원문 보기</summary><code>${esc(c.corpRaw)}</code><p class="muted small">사업자번호 ${esc(c.bizno || '없음')} · 대표자 ${esc(c.rep || '없음')}</p></details>` : '';
    return `${raw}<p class="g2bst small">나라장터 ${esc(L.fmtDate(String(g.at).slice(0, 10)))}: ${parts.join(' · ')}${noNtce ? ' · <span class="muted">입찰공고 없는 수의계약이라 예산액·설계금액·예정가격은 서류(견적서·설계내역서·기안문)에서 읽습니다</span>' : ''}</p>${errs.length ? `<p class="g2bst bad-t small">못 받은 이유: ${esc(errs.join(' / '))}</p>` : ''}`;
  }
  // 나라장터(기준)와 서류 맞춰 보기
  function checksOf(c) {
    const list = lists(c.type);
    return L.verifyFacts(c, docsOf(c.key), (d) => ((list.find((x) => x.id === d.itemId) || {}).name || d.name));
  }
  function checkBlock(cks) {
    if (!cks.length) return '<p class="g2bst muted small">서류에서 계약금액·기간·업체를 읽으면 나라장터 값과 맞춰 봅니다(계약서·착공계·준공계·사업자등록증 등을 올리면).</p>';
    return `<div class="vchecks"><div class="agroup">나라장터와 서류 맞춰 보기 <span class="muted">(나라장터가 기준)</span></div>
      ${cks.map((k) => `<div class="vck ${k.ok === true ? 'ok' : k.ok === false ? 'bad' : 'info'}"><span class="vm">${k.ok === true ? '✓' : k.ok === false ? '!' : '·'}</span><span class="vl">${esc(k.label)}</span>
        <span class="vn">나라장터 <b>${esc(k.nara)}</b></span><span class="vd">서류 <b>${esc(k.doc)}</b> <small class="muted">${esc(k.from)}</small></span>${k.note ? `<span class="vnote">${esc(k.note)}</span>` : ''}</div>`).join('')}</div>`;
  }
  // 나라장터 변경이력: 차수마다 설계변경·기간연장을 고름(기본값은 앞 차수와 비교한 자동 판단)
  function chgTable(c, m) {
    const ch = L.changesOf(c), rows = ch ? ch.rows : [];
    if (!rows.length) return '';
    const picked = m.chgKind || {}, K = L.CHG_KINDS;
    const first = rows[0] ? rows[0].ord : 0;
    const ordLabel = (r) => (r.first ? `원계약${r.ord ? ` (-${String(r.ord).padStart(2, '0')})` : ''}` : `${r.ord - first}차 변경${r.gap ? ` <small class="as warn">앞에 빠진 차수 ${r.gap}개 — 바로 앞 차수와 비교</small>` : ''}`);
    const body = rows.map((r) => {
      const amt = wonText(r.amount) + (r.diff ? ` <small class="${r.diff > 0 ? 'up' : 'down'}">(${r.diff > 0 ? '+' : '−'}${esc(wonText(Math.abs(r.diff)))})</small>` : '');
      const end = r.prevEnd && r.end && r.prevEnd !== r.end ? `${esc(L.fmtDate(r.prevEnd))} → <b>${esc(L.fmtDate(r.end))}</b>` : esc(L.fmtDate(r.end));
      let sel = '<span class="muted">—</span>';
      if (!r.first) {
        const cur = picked[r.no] || r.auto || '';
        const opts = (cur ? '' : '<option value="" selected>고르세요</option>') + Object.entries(K).map(([k, t]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(t)}${k === r.auto ? ' (자동)' : ''}</option>`).join('');
        const tag = picked[r.no] ? '<small class="as">직접</small>' : r.auto ? '<small class="as">자동</small>' : '<small class="as warn">앞 차수가 없어 직접 골라 주세요</small>';
        sel = `<select data-chgkind="${esc(r.no)}">${opts}</select> ${tag}${cur === 'etc' ? ` <input type="text" class="chg-etc" data-chgetc="${esc(r.no)}" value="${esc((m.chgEtc || {})[r.no] || '')}" placeholder="구분 직접 쓰기(예: 물가변동)" aria-label="기타 구분">` : ''}`;
      }
      return `<tr${picked[r.no] === 'none' || (!picked[r.no] && r.auto === 'none') ? ' class="off"' : ''}><td>${ordLabel(r)}<br><small class="muted">${esc(r.no)}</small></td><td>${esc(L.fmtDate(r.date))}</td><td class="num">${amt}</td><td>${end}</td><td>${sel}</td></tr>`;
    }).join('');
    return `<div class="chgtbl"><div class="agroup">${ch.src === '나라장터 계약 차수' ? '나라장터 계약 차수(-00, -01 …)' : '나라장터 변경이력'}${c.url ? ` <a class="link sm" href="${esc(c.url)}" target="_blank" rel="noopener">나라장터에서 보기</a>` : ''} <small class="muted">차수마다 구분을 고르면 서식의 설계변경·공사기간 연장 칸에 들어갑니다. 해당 없음은 빠집니다</small></div>
      <div class="tblwrap"><table><thead><tr><th>차수</th><th>변경일</th><th>계약금액(증감)</th><th>준공일</th><th>구분</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
  }
  function auditCard(c) {
    const F = JH.forms, m = memoOf(c);
    // 비워 두면 쓰는 값(자동) — 직접 넣은 감사 칸을 뺀 메모로 계산
    const bare = {}; for (const [k, v] of Object.entries(m)) if (!/^a[A-Z]/.test(k)) bare[k] = v;
    const a = F.rowOf({ ...c, memo: bare }, { finish: finishOf(c) });
    const chg = a.chg || [];
    const auto = {
      aBudget: [wonText(a.budget), a.src.budget], aDesign: [wonText(a.design), a.src.design], aEst: [wonText(a.est), a.src.est], aAward: [wonText(a.award), a.src.award],
      aRep: [a.rep, a.src.rep], aAddr: [a.addr, a.src.addr], aActual: [L.fmtDate(a.actual), a.src.actual], aMethod: [a.method, a.src.method], aReason: [a.reason, a.src.reason], aTeam: [a.team, '감독부서'],
      aExtOrig: [L.fmtDate(a.extOrig), a.src.extOrig], aExtDate: [String(a.extDate || '').split('\n').map(L.fmtDate).join(', '), a.src.extDate],
      aChgDate: [chg.map((x) => L.fmtDate(x.date)).join(', '), chg.length ? '나라장터 변경이력' : ''], aChgAmt: [chg.map((x) => wonText(x.amount)).join(', '), chg.length ? '나라장터 변경이력' : ''],
    };
    const r = F.rowOf(c, { finish: finishOf(c) });
    const blanks = F.missingOf(r, 'inspect').concat(F.isSole(r) && r.amount >= 10000000 ? F.missingOf(r, 'audit') : []);
    const uniq = [...new Set(blanks)];
    const cks = checksOf(c), bad = cks.filter((k) => k.ok === false);
    let group = '';
    const edit = !!ui.auditEdit;
    let autoN = 0;
    const fields = F.FIELDS.map((f) => {
      const [av, as] = auto[f.k] || ['', ''];
      const mine = String(m[f.k] || '').trim();
      if (!mine && av) autoN++;
      const head = f.group && f.group !== group ? `<div class="agroup">${esc(f.group)}</div>` : ''; group = f.group || '';
      if (!edit) {
        const val = mine ? (f.money ? wonText(L.num(mine)) || mine : mine) : av;
        return `${head}<div class="av${f.wide ? ' wide' : ''}"><span class="al">${esc(f.label)}</span><span class="vv${val ? '' : ' none'}">${val ? esc(val) : '—'}</span>${val ? `<small class="as">${esc(mine ? '직접' : as || '자동')}</small>` : ''}</div>`;
      }
      return `${head}<label class="mf${f.wide ? ' wide' : ''}"><span>${esc(f.label)}</span><input type="text" data-memo="${f.k}" value="${esc(m[f.k] || '')}" placeholder="${esc(av ? '자동: ' + av : f.ph)}"${av ? ` title="${esc('비워 두면 ' + av + (as ? ' (' + as + ')' : ''))}"` : ''}${f.money ? ' inputmode="numeric"' : ''} autocomplete="off"></label>`;
    }).join('');
    return `<details class="dcard memo audit" data-card="audit"${cardOpen.audit || ui.auditOpen ? ' open' : ''} data-audit="1">
      <summary><h3>감사·검사 자료</h3><span class="csum">${bad.length ? `<span class="bad-t">서류와 다름 ${esc(bad.map((k) => k.label).join('·'))}</span> · ` : ''}${uniq.length ? `<span class="ablank">빈칸 ${esc(uniq.join('·'))}</span>` : '<span class="afull">다 채움</span>'}<span class="muted"> · 나라장터 기준, 서류로 확인</span></span></summary>
      <div class="cbody">
      <p class="memo-foot" style="margin:0 0 8px">나라장터와 올린 서류(견적서·설계내역서·사업자등록증 등)에서 자동으로 채워 종합감사(엑셀)·행정사무감사(한글) 서식에 들어갑니다. 따로 쓸 필요 없고, 틀린 것만 [직접 고치기]로 고치세요.</p>
      ${g2bLine(c)}
      ${chgTable(c, m)}
      ${checkBlock(cks)}
      <div class="audit-acts"><button type="button" class="btn sm" data-act="auditdocs" title="견적서·설계내역서·사업자등록증 등을 다시 읽어 빈칸을 채웁니다(PC 안 AI 사용, 외부로 보내지 않음)">서류에서 다시 읽기</button>${c.source === 'api' ? '<button type="button" class="btn sm ghost" data-act="g2bre" title="변경이력·예정가격·낙찰·업체 주소를 나라장터에서 다시 받습니다">나라장터에서 다시 받기</button>' : ''}<button type="button" class="btn sm ghost" data-act="auditedit">${edit ? '다 고침' : '직접 고치기'}</button></div>
      <div class="${edit ? 'memo-grid audit-grid' : 'audit-view'}">${fields}</div></div></details>`;
  }

  // 서류 글자 → 감사 칸(정규식으로 먼저, 남은 칸은 PC 안 AI)
  const AUDIT_DOC = /-(estimate|calc|related|bizreg|corpreg|seal|req|contract|start|finish|inspect)$/;
  const AUDIT_AI_SYSTEM = '너는 공공기관 계약 서류에서 값을 찾아 JSON으로만 답한다. 서류에 적혀 있지 않은 값은 null로 둔다. 추측하거나 계산하지 않는다. 금액은 원 단위 정수(쉼표 없이)로 쓴다.';
  const AUDIT_MAP = { budget: 'aBudget', design: 'aDesign', est: 'aEst', addr: 'aAddr', rep: 'aRep' };
  // 서류 글자(줄 묶음 여러 개)에서 글자 규칙으로 찾은 값을 빈 감사 칸에만 넣음. 넣은 칸 수를 돌려줌(저장은 부른 쪽에서)
  // 서류에서 읽은 값(예정가격·설계금액·예산액·주소·대표자)은 c.docVals에 따로 둠 — 나라장터 값이 있으면 나라장터가 먼저(서류는 확인용)
  function fillAuditFrom(c, lineSets) {
    if (!c) return 0;
    const found = {};
    for (const ls of lineSets) for (const [k, v] of Object.entries(L.scanAuditFields(ls || []))) if (!found[k]) found[k] = v;
    const before = formRow(c); let n = 0;
    const dv = { ...(c.docVals || {}) };
    for (const k of Object.keys(AUDIT_MAP)) if (found[k] && !dv[k]) { dv[k] = found[k]; if (!before[k]) n++; }
    c.docVals = dv;
    return n;
  }
  async function fillFromDocs(c, quiet, opt = {}) {
    const docs = docsOf(c.key).filter((d) => AUDIT_DOC.test(d.itemId || '') && d.kind !== 'other');
    if (!docs.length) { if (!quiet) toast('이 계약에 견적서·설계내역서·계약 관련서류(사업자등록증 등)가 아직 없습니다.', 'err'); return 0; }
    const texts = [];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      if (!quiet) progress(`서류에서 예정가격·주소 등을 찾는 중 (${i + 1}/${docs.length})`, i / docs.length * .5);
      try { const b = await S.readBytes(d.path); const { lines } = await R.read(b, d.kind, d.mime); if (!d.facts) d.facts = L.docFacts(lines); texts.push({ name: (lists(c.type).find((x) => x.id === d.itemId) || {}).name || d.name, lines }); } catch (_) { /* 못 읽는 파일은 건너뜀 */ }
    }
    const found = {};
    for (const t of texts) for (const [k, v] of Object.entries(L.scanAuditFields(t.lines))) if (!found[k]) found[k] = v;
    const MAP = AUDIT_MAP;
    const cur = formRow(c);
    const empty = (k) => !String(memoOf(c)[MAP[k]] || '').trim() && !cur[k] && !(c.docVals || {})[k];
    let by = '서류';
    if (opt.ai !== false && Object.keys(MAP).some((k) => empty(k) && !found[k]) && await JH.ai.pick(true)) {
      if (!quiet) progress('PC AI가 서류를 읽는 중 (1~2분 걸릴 수 있습니다)', .6);
      try {
        const body = texts.map((t) => `### ${t.name}\n${t.lines.join('\n').slice(0, 2500)}`).join('\n\n').slice(0, 9000);
        const prompt = `계약명: ${c.name}\n업체: ${c.vendor || ''}\n\n아래 서류에서 다음 값을 찾아 JSON으로 답하세요.\n{"예산액": 숫자|null, "설계금액": 숫자|null, "예정가격": 숫자|null, "업체주소": "글"|null, "대표자": "글"|null}\n업체주소·대표자는 계약 상대 업체(${c.vendor || '업체'})의 것만.\n\n${body}`;
        const r = await JH.ai.ask({ system: AUDIT_AI_SYSTEM, prompt, json: true, privateData: true });
        const j = JH.ai.json(r.text);
        const pairs = { budget: j['예산액'], design: j['설계금액'], est: j['예정가격'], addr: j['업체주소'], rep: j['대표자'] };
        for (const [k, v] of Object.entries(pairs)) {
          if (found[k] || v == null || v === '') continue;
          if (['budget', 'design', 'est'].includes(k)) { const n = L.num(v); if (n >= 100000) found[k] = n; } else if (String(v).trim().length >= 2) found[k] = String(v).trim();
        }
        by = '서류·PC AI';
      } catch (e) { console.warn('AI 읽기 실패', e); }
    }
    const filled = [];
    for (const [k, mk] of Object.entries(MAP)) if (found[k] && empty(k)) { c.docVals = { ...(c.docVals || {}), [k]: found[k] }; filled.push(JH.forms.FIELDS.find((f) => f.k === mk).label); }
    await saveDb(true);
    if (!quiet) { progress(null); toast(filled.length ? `${by}에서 ${filled.join('·')}을(를) 채웠습니다. 맞는지 확인해 주세요.` : '서류에서 새로 채울 값을 찾지 못했습니다.', filled.length ? 'ok' : ''); }
    return filled.length;
  }

  // 계약 화면을 열면 감사 칸이 비어 있고 아직 안 읽은 서류가 있을 때 뒤에서 한 번 읽어 채움(글자 규칙만, 빠름)
  const autoTried = new Set();
  function autoAudit(c) {
    const docs = docsOf(c.key).filter((d) => AUDIT_DOC.test(d.itemId || '') && d.kind !== 'other');
    if (!docs.length || !S.online) return;
    const sig = docs.map((d) => d.id).join(',');
    if (c.auditSig === sig || autoTried.has(c.key + '|' + sig)) return;
    autoTried.add(c.key + '|' + sig);
    const needFacts = docs.some((d) => !d.facts);
    if (!needFacts && !JH.forms.missingOf(formRow(c), 'inspect').length) { c.auditSig = sig; return; }
    fillFromDocs(c, true, { ai: false }).then((n) => {
      c.auditSig = sig; saveDb();
      if ((n || needFacts) && ui.sel === c.key && ui.view === 'contracts') { if (n) toast(`서류에서 감사·검사 칸 ${n}개를 채웠습니다.`, 'ok'); render(); }
    }).catch(() => {});
  }

  // ---------- 감사·검사 제출 서식 ----------
  const fm = { kind: 'inspect', skip: new Set() };
  const isoOf8 = (s) => { const v = String(s || '').replace(/\D/g, ''); return v.length >= 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : ''; };
  function formsOpts() {
    return { from: $('#fmFrom').value, to: $('#fmTo').value, types: $$('#fmTypes input:checked').map((i) => i.value), min: L.num($('#fmMin').value) || 10000000 };
  }
  function formsRows(o) {
    let rows = contracts().map(formRow).filter((r) => o.types.includes(r.type) && JH.forms.inPeriod(r, o.from, o.to));
    if (fm.kind === 'audit') rows = JH.forms.auditCandidates(rows, o.min);
    return rows;
  }
  function openForms(kind) {
    const f = cfg.forms || {}; const y = new Date().getFullYear();
    if (kind) fm.kind = kind;
    fm.skip = new Set(f.skip || []);
    $('#fmFrom').value = f.from || `${y}-01-01`; $('#fmTo').value = f.to || isoOf8(ymd());
    $$('#fmTypes input').forEach((i) => { i.checked = !f.types || f.types.includes(i.value); });
    $('#fmMin').value = (f.min || 10000000).toLocaleString('ko-KR');
    formsKind(fm.kind);
    $('#dlgForms').showModal();
  }
  function formsKind(kind) {
    fm.kind = kind;
    $$('#fmKind button').forEach((b) => { b.classList.toggle('on', b.dataset.fk === kind); b.setAttribute('aria-pressed', b.dataset.fk === kind); });
    $$('#dlgForms .audit-only').forEach((e) => { e.hidden = kind !== 'audit'; });
    $$('#dlgForms .inspect-only').forEach((e) => { e.hidden = kind !== 'inspect'; });
    formsPreview();
  }
  function formsPreview() {
    const o = formsOpts(), rows = formsRows(o);
    const on = rows.filter((r) => !fm.skip.has(r.key));
    const cnt = (t) => on.filter((r) => r.type === t).length;
    const blanks = on.filter((r) => JH.forms.missingOf(r, fm.kind).length).length;
    $('#fmSummary').innerHTML = rows.length
      ? `대상 <b>${on.length}</b>건 (${o.types.map((t) => `${t} ${cnt(t)}`).join(' · ')})${blanks ? ` · <span class="warn-t">빈칸 있는 계약 ${blanks}건</span>` : ''}`
      : '이 기간에 해당하는 계약이 없습니다. 나라장터 새로고침을 했는지, 기간을 확인해 주세요.';
    $('#fmList').innerHTML = rows.length ? `<table class="grid fm-grid"><thead><tr><th><span class="sr">넣기</span></th><th>구분</th><th>계약</th><th>계약일</th><th class="r">계약금액</th><th>계약방법</th><th>빈칸</th><th></th></tr></thead><tbody>
      ${rows.map((r) => { const miss = JH.forms.missingOf(r, fm.kind); return `<tr><td><input type="checkbox" data-fmkey="${esc(r.key)}"${fm.skip.has(r.key) ? '' : ' checked'} aria-label="${esc(r.name)} 넣기"></td><td>${esc(r.type)}</td><td><div class="nm">${esc(r.name)}</div><div class="sub">${esc(r.vendor)}</div></td><td class="date">${esc(L.fmtDate(r.contractDate))}</td><td class="r num">${esc(L.won(r.amount))}</td><td>${r.method ? esc(r.method) : '<span class="warn-t">모름</span>'}</td><td>${miss.length ? `<span class="warn-t">${esc(miss.join('·'))}</span>` : '<span class="ok-t">없음</span>'}</td><td><button type="button" class="link sm" data-fmopen="${esc(r.key)}">열기</button></td></tr>`; }).join('')}
      </tbody></table>` : '';
    $('#fmMake').disabled = !on.length;
  }
  // 서식 파일 만들기(대화상자·현황판 바로 받기 공용)
  async function formsBuild(kind, o, rows) {
    const stamp = ymd();
    let name, bytes, preview;
    if (kind === 'audit') {
      const opt = { min: o.min, types: o.types };
      await JH.lib('formtpl'); // 한글 양식 본문(큰 파일)은 처음 만들 때 불러옴
      bytes = JH.forms.auditHwpx(rows, opt);
      name = `행정사무감사_수의계약현황(${JH.forms.manLabel(o.min).replace(/,/g, '')}이상)_${stamp}.hwpx`;
      preview = JH.forms.auditPreview(rows, opt);
    } else {
      const sheet = JH.forms.inspectSheet(rows, { types: o.types });
      bytes = JH.xlsx.build({ title: sheet.name, sheets: [sheet] });
      name = `종합감사_계약집행현황_${stamp}.xlsx`;
      preview = [{ name: sheet.name, cols: INSPECT_PREVIEW_COLS.map((h) => ({ h })), rows: rows.map((r) => [r.type, r.name, JH.forms.kfmt(r.budget), JH.forms.kfmt(r.design), JH.forms.kfmt(r.est), JH.forms.kfmt(r.award), r.rate == null ? '' : r.rate.toFixed(3), JH.forms.dShort(r.start), JH.forms.dShort(r.due), JH.forms.dShort(r.actual), (r.chg || []).map((x) => `${JH.forms.dShort(x.date)} ${JH.forms.signed(x.diff)}`).join(' '), r.method, r.vendor]) }];
    }
    const saved = await S.save('감사자료', name, bytes);
    return { name, preview, saved };
  }
  async function formsDone(r, extra) {
    if (S.showTable) { S.showTable(r.name, r.preview); return; }
    toast(`${r.name}을(를) 만들었습니다 (감사자료 폴더).${extra || ''} 내용을 확인한 뒤 제출하세요.`, 'ok', { label: '폴더 열기', run: () => S.open('감사자료') });
    try { await S.openFile(r.saved.path); } catch (_) { /* 프로그램이 없으면 폴더에서 열면 됨 */ }
  }
  async function formsMake() {
    const o = formsOpts(); const rows = formsRows(o).filter((r) => !fm.skip.has(r.key));
    if (!rows.length) return;
    cfg.forms = { ...(cfg.forms || {}), from: o.from, to: o.to, types: o.types, min: o.min, skip: [...fm.skip] };
    await saveCfg();
    const r = await formsBuild(fm.kind, o, rows);
    $('#dlgForms').close();
    await formsDone(r);
  }
  // 현황판 [행정사무감사 서식]·[종합감사 서식]: 지난번 고른 기간·구분(처음이면 올해 1월 1일~오늘, 전부)으로
  // 나라장터 세부 정보 받기 → 서류에서 빈칸 채우기 → 파일까지 한 번에
  async function quickForms(kind) {
    const f = cfg.forms || {}, y = new Date().getFullYear();
    const o = { from: f.from || `${y}-01-01`, to: f.to || isoOf8(ymd()), types: f.types || ['공사', '용역', '물품'], min: f.min || 10000000 };
    const prevKind = fm.kind; fm.kind = kind;
    const skip = new Set(f.skip || []);
    const pick = () => formsRows(o).filter((r) => !skip.has(r.key));
    try {
      let rows = pick();
      if (!rows.length) { toast(`${o.from} ~ ${o.to}에 ${kind === 'audit' ? '수의계약(1천만 원 이상)' : '계약'}이 없습니다. 기간을 바꾸려면 [고르기]를 누르세요.`, 'err', { label: '고르기', run: () => openForms(kind) }); return; }
      if (cfg.apiKey) {
        progress('나라장터에서 예산·예정가격·변경이력·업체 주소 받는 중', .1);
        try { await enrichContracts(contracts().filter((c) => rows.some((r) => r.key === c.key)), false); } catch (e) { console.warn('세부 정보 받기 실패', e); }
      }
      const blank = pick().filter((r) => JH.forms.missingOf(r, kind).length);
      let docN = 0;
      for (let i = 0; i < blank.length; i++) { progress(`서류에서 빈칸 채우는 중 ${i + 1}/${blank.length}`, .4 + .5 * i / blank.length); try { docN += await fillFromDocs(db.contracts[blank[i].key], true); } catch (_) { /* 다음 계약 */ } }
      progress('파일 만드는 중', .95);
      rows = pick();
      const left = rows.filter((r) => JH.forms.missingOf(r, kind).length).length;
      const r = await formsBuild(kind, o, rows);
      progress(null);
      await formsDone(r, ` ${rows.length}건${docN ? `, 서류에서 빈칸 ${docN}개 채움` : ''}${left ? ` · 아직 빈칸 있는 계약 ${left}건` : ''}.`);
      if (left) toast(`빈칸 있는 계약 ${left}건은 [고르기]에서 계약을 열어 직접 넣을 수 있습니다.`, '', { label: '고르기', run: () => openForms(kind) });
    } catch (e) { progress(null); toast('서식을 만들지 못했습니다: ' + e.message, 'err'); }
    finally { fm.kind = prevKind; }
  }
  const INSPECT_PREVIEW_COLS = ['구분', '사업명', '예산액', '설계금액', '예정가격', '낙찰금액', '낙찰률(%)', '착공일자', '준공기한', '실제준공일', '설계변경', '계약방법', '도급자'];
  $('#fmKind').addEventListener('click', (e) => { const b = e.target.closest('[data-fk]'); if (b) formsKind(b.dataset.fk); });
  $('#dlgForms').addEventListener('change', (e) => {
    const k = e.target.dataset && e.target.dataset.fmkey;
    if (k) { if (e.target.checked) fm.skip.delete(k); else fm.skip.add(k); }
    if (e.target.id === 'fmMin') e.target.value = (L.num(e.target.value) || 0).toLocaleString('ko-KR');
    formsPreview();
  });
  $('#dlgForms').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fmopen]'); if (!b) return;
    $('#dlgForms').close(); ui.sel = b.dataset.fmopen; ui.auditOpen = true; setView('contracts');
  });
  $('#fmMake').onclick = () => formsMake().catch((e) => toast('서식을 만들지 못했습니다: ' + e.message, 'err'));
  $('#fmEnrich').onclick = async () => {
    const o = formsOpts(); const keys = new Set(formsRows(o).map((r) => r.key));
    const cs = contracts().filter((c) => keys.has(c.key));
    if (!cfg.apiKey) { toast('설정에서 나라장터 인증키를 먼저 넣어 주세요.', 'err'); return; }
    const r = await enrichContracts(cs, true);
    toast(r.errs.length ? `일부 서비스는 받지 못했습니다: ${r.errs.map(([n]) => n).join(', ')} (공공데이터포털 활용신청 필요)` : `${r.done}건의 세부 정보를 받았습니다.`, r.errs.length ? 'err' : 'ok');
    formsPreview();
  };
  $('#fmDocs').onclick = async () => {
    const o = formsOpts(); const rows = formsRows(o).filter((r) => !fm.skip.has(r.key) && JH.forms.missingOf(r, fm.kind).length);
    if (!rows.length) { toast('빈칸 있는 계약이 없습니다.', 'ok'); return; }
    let n = 0;
    try { for (let i = 0; i < rows.length; i++) { progress(`서류에서 빈칸 채우는 중 ${i + 1}/${rows.length}`, i / rows.length); n += await fillFromDocs(db.contracts[rows[i].key], true); } }
    finally { progress(null); }
    toast(n ? `빈칸 ${n}개를 서류에서 채웠습니다. 계약마다 맞는지 확인해 주세요.` : '서류에서 새로 채울 값을 찾지 못했습니다.', n ? 'ok' : '');
    formsPreview();
  };

  // ---------- 화면: 현황판 ----------
  function boardRows() {
    return filtered(true).map((c) => ({ c, st: statusOf(c) }))
      .filter(({ st }) => !ui.board || (ui.board === 'late' ? st.late : inState(st, ui.board)))
      .sort((a, b) => (b.st.late - a.st.late) || ((L.toDate(a.c.endDate) || 9e15) - (L.toDate(b.c.endDate) || 9e15)));
  }
  function renderBoard() {
    const all = filtered(true).map((c) => ({ c, st: statusOf(c) }));
    const cnt = { '': all.length, missing: 0, ready: 0, late: 0, paid: 0, round: 0 };
    all.forEach(({ st }) => { for (const k of ['missing', 'ready', 'paid', 'round']) if (inState(st, k)) cnt[k]++; if (st.late) cnt.late++; });
    const rows = boardRows();
    const chip = (k, label, alert) => `<button class="chip${ui.board === k ? ' on' : ''}${alert && cnt[k] ? ' alert' : ''}" data-board="${k}">${label} <b>${cnt[k]}</b></button>`;
    $('#view-board').innerHTML = `
      <div class="board-head"><h2>현황판</h2><span class="sub">${ui.officer ? `담당 ${esc(ui.officer)}` : '담당자 전체'}${ui.type ? ` · ${esc(ui.type)}` : ''}${cfg.lastFetch ? ` · 나라장터 ${esc(L.fmtDate(cfg.lastFetch.slice(0, 10)))} 기준` : ''}</span>
        <div class="right"><select id="bOfficer" aria-label="담당자">${$('#fOfficer').innerHTML}</select>
          <button class="btn" data-act="excel" title="지금 보이는 계약을 엑셀 파일로 저장하고 엽니다"${rows.length ? '' : ' disabled'}>${XLS_ICON}엑셀로 받기 <span class="num">${rows.length}건</span></button>
          <span class="btn-group" role="group" aria-label="감사·검사 서식 받기"><button class="btn" data-act="quickform" data-fk="audit" title="행정사무감사 「수의계약 현황(1,000만원 이상)」 한글 파일 — 나라장터·서류에서 채워 바로 받기">행정사무감사 서식</button><button class="btn" data-act="quickform" data-fk="inspect" title="종합감사 「계약집행 현황(총괄)」 엑셀 — 나라장터·서류에서 채워 바로 받기">종합감사 서식</button><button class="btn ghost" data-act="forms" title="기간·구분·기준 금액·넣을 계약을 고르고 빈칸 확인">고르기</button></span></div></div>
      <div class="chips">${chip('', '전체')}${chip('missing', '서류 미비')}${chip('ready', '지출 대기')}${chip('late', '준공 지남·미지출', true)}${chip('round', '기성·노무비 진행 중')}${chip('paid', '지출 완료')}</div>
      ${rows.length ? `<table class="grid"><thead><tr><th>계약</th><th>구분</th><th>준공일</th><th>서류</th><th class="r">원본</th><th>지출</th><th>상태</th></tr></thead><tbody>
        ${rows.map(({ c, st }) => `<tr data-key="${esc(c.key)}">
          <td><div class="nm">${esc(c.name)}</div><div class="sub">${esc(c.vendor || '')}${c.amount ? ` · ${esc(L.won(c.amount))}` : ''}</div>${(() => { const m = memoOf(c); const who = [m.dept, m.person, m.phone].filter(Boolean).join(' '); return who || m.note ? `<div class="sub memo-line" title="${esc(m.note || '')}">${who ? `감독 ${esc(who)}` : ''}${m.note ? `${who ? ' · ' : ''}${esc(m.note.replace(/\s+/g, ' ').slice(0, 40))}` : ''}</div>` : ''; })()}</td>
          <td>${esc(c.type)}</td>
          <td class="date"${st.late ? ' style="color:var(--seal);font-weight:650"' : ''}>${esc(L.fmtDate(c.endDate) || '-')}</td>
          <td><div class="prog${st.reqDone === st.reqTotal ? ' full' : ''}"><span class="track"><i style="width:${st.reqTotal ? Math.round(st.reqDone / st.reqTotal * 100) : 0}%"></i></span><span class="num">${st.reqDone}/${st.reqTotal}</span></div></td>
          <td class="r num">${st.origCount || ''}</td>
          <td class="date">${esc(L.fmtDate(c.paidDate) || '')}${st.rounds.length ? `<div class="sub">중간 지출 ${st.rounds.filter((x) => x.s.state === 'paid').length}회</div>` : ''}</td>
          <td>${pillFor(st, c)}${roundFocus(st) ? `<div>${roundPill(roundFocus(st), true)}</div>` : ''}</td></tr>`).join('')}
        </tbody></table>` : `<div class="empty-line">해당하는 계약이 없습니다.</div>`}`;
    const bo = $('#bOfficer'); bo.value = ui.officer;
  }

  // ---------- 미리 보기(팝업) · 헷갈리는 서류 확인 ----------
  // 파일을 따로 열지 않고 창 안에서 보고, 그 자리에서 계약·서류 종류를 맞게 고름. 여러 개면 [이전]·[다음]
  const pv = { ids: [], i: 0, confirm: false, tok: 0, done: new Set(), split: false };
  function openPreview(ids, i = 0, confirmMode = false) {
    if (!$('#dlgPreview').open) { pv.lastKey = null; pv.done = new Set(); }
    pv.ids = ids.filter((id) => docById(id)); pv.i = Math.min(i, pv.ids.length - 1); pv.confirm = confirmMode;
    if (!pv.ids.length) return;
    $('#dlgPreview').showModal(); showPreview();
  }
  // 확인 팝업에서 [이대로 저장] 없이 [다음]·[닫기]·✕로 넘긴 파일은 미분류로 — 고른 계약·종류는 추천으로 남겨 미분류 화면·다음 팝업에서 맨 위에
  async function skipToInbox(ids) {
    const ds = ids.map(docById).filter((d) => d && d.key && !pv.done.has(d.id) && !keepSeen.has(d.id));
    if (!ds.length) return 0;
    await recorded(`확인 안 한 파일 ${ds.length}개 미분류로`, ds.map((d) => d.key), ds.map((d) => d.id), async () => {
      for (const d of ds) {
        const was = whereOf(d);
        d.cands = [d.key, ...(d.cands || []).filter((k) => k !== d.key)].slice(0, 6);
        if (d.itemId) d.guess = L.suffixOf(d.itemId);
        delete d.unsure; delete d.alts; delete d.revOf; delete d.pay;
        try { await moveDoc(d, null, null, false, undefined, true); logAct(`확인 안 함 「${d.name}」 ${was} → 미분류`); } catch (e) { console.warn('미분류로 못 옮김', d.name, e); }
      }
      await saveDb(true);
    });
    return ds.length;
  }
  async function showPreview() {
    const d = docById(pv.ids[pv.i]); if (!d) return;
    // 확인 중에 여러 서류가 든 묶음 파일(착수계 묶음 등)이 오면 바로 '쪽별로 나누기' 화면으로 — 나누거나 닫으면 다음 파일로 이어짐
    if (pv.confirm && d.kind === 'pdf' && d.key && db.contracts[d.key] && d.also && d.also.length && !d.splitAsked) {
      d.splitAsked = true; saveDb();
      sp.resume = pv.ids.slice(pv.i + 1);
      pv.split = true; if ($('#dlgPreview').open) $('#dlgPreview').close();
      openSplit(d); return;
    }
    const tok = ++pv.tok, c = d.key ? db.contracts[d.key] : null;
    $('#pvTitle').textContent = pv.confirm ? `맞는지 확인해 주세요 (${pv.i + 1}/${pv.ids.length})` : d.name;
    $('#pvName').textContent = d.name;
    const cands = !d.key ? (d.cands || []).filter((k) => db.contracts[k]) : [];
    $('#pvContract').innerHTML = contractOptions(d.key || cands[0] || '', cands).replace('<option value="">계약 고르기</option>', '<option value="">미분류(계약 모름)</option>');
    $('#pvSearch').value = '';
    // 서류 종류: 그 계약 목록에서 제목으로 찾은 것을 '추천'으로 맨 위에 두고 골라 둠(사람이 확인)
    const fillItems = (key) => {
      const cc = key ? db.contracts[key] : null;
      if (!cc) { $('#pvItem').innerHTML = '<option value="">계약을 먼저 고르세요</option>'; $('#pvItem').disabled = true; $('#pvItemSearch').value = ''; return; }
      const g = classifyDoc(cc, d.name, d.title, d.heads);
      if (!g.id && d.guess) { const gi = classList(cc).find((x) => L.suffixOf(x.id) === d.guess); if (gi) g.id = gi.id; } // 계약을 몰라도 미리 찾아 둔 종류
      const sel = key === d.key && d.itemId ? d.itemId : g.id || '';
      $('#pvItem').innerHTML = itemOptions(classList(cc), sel, false, [g.id, ...(g.alts || []), ...(key === d.key && d.itemId ? [d.itemId] : [])].filter(Boolean)); $('#pvItem').disabled = false;
      $('#pvItemSearch').value = ''; $('#pvItemSearch').title = '';
    };
    fillItems(d.key || cands[0]); $('#pvContract').onchange = (e) => fillItems(e.target.value);
    const altNames = (d.alts || []).map((id) => (c && classList(c).find((x) => x.id === id) || {}).name).filter(Boolean);
    const revPrev = d.revOf && docById(d.revOf);
    if (pv.confirm && revPrev && !d.unsure && d.key && d.itemId === revPrev.itemId) {
      $('#pvWhy').textContent = `이 칸(${(classList(db.contracts[d.key]).find((x) => x.id === d.itemId) || {}).name || ''})에 이미 「${revPrev.name}」이 있습니다. 새 파일이 수정본이면 [이대로 저장]을 누르세요 — 둘 다 두고 새 파일에 '수정본' 표시를 합니다. 다른 서류면 종류를 고르세요.`;
    } else if (pv.confirm && d.key && d.itemId && !d.unsure && !d.revOf) {
      $('#pvWhy').textContent = '이렇게 넣었습니다. 계약과 서류 종류가 맞으면 [이대로 저장], 틀리면 고르세요(고친 것은 배웁니다). 묻지 않고 바로 넣으려면 설정 → 서류 목록 → 올릴 때마다 확인을 끄세요.';
      if (d.also && d.also.length) { const nmv = (id) => (classList(db.contracts[d.key]).find((x) => x.id === id) || {}).name || id; $('#pvWhy').textContent += ` 이 파일 안에서 ${d.also.map(nmv).join(', ')}도 찾았습니다 — 잘못 찾은 게 있으면 그 칸 줄의 ✕(이 칸에서만 빼기), 서류마다 자르려면 [쪽별로 나누기].`; }
    } else
    $('#pvWhy').textContent = pv.confirm ? (!c ? (cands.length > 1 ? `같은 업체(또는 비슷한 이름) 계약이 ${cands.length}개라 확실하지 않습니다. 가장 가까운 계약을 골라 두었으니 맞는지 확인해 주세요.` : cands.length ? '확실하지 않아 가장 가까운 계약을 골라 두었습니다.' : '어느 계약 서류인지 찾지 못했습니다.') : !d.itemId ? '어떤 서류인지 찾지 못했습니다.' : d.unsure ? (altNames.length ? `제목에 다른 서류 이름(${altNames.join(', ')})도 있어 헷갈립니다.` : '전에 배운 서류와 제목이 거의 같아 그 종류로 골라 두었습니다(글자 인식이 조금 다르게 됨).') : '') + ' 내용을 보고 맞게 골라 주세요. 고른 답은 배워서 다음부터 같은 제목이면 바로 넣습니다.' : '';
    if (pv.confirm && !d.key && d.guess) { const gn = (defaults.공사.concat(defaults.용역, defaults.물품).find((x) => L.suffixOf(x.id) === d.guess) || {}).name; if (gn) $('#pvWhy').textContent += ` 서류 종류는 '${gn}'(으)로 보입니다 — 계약만 고르면 골라집니다.`; }
    if (pv.confirm && revPrev && d.unsure) $('#pvWhy').textContent += ` 이 칸에는 이미 「${revPrev.name}」이 있습니다(같은 서류의 수정본이면 그대로 저장).`;
    if (pv.confirm && dupSeen.has(d.id)) $('#pvWhy').textContent = `이미 올린 파일입니다 — 지금 ${whereOf(d)}에 있습니다. 맞으면 [맞음 · 다음], 다른 계약·서류면 골라서 저장하세요(넘겨도 지금 자리 그대로).`;
    $('#pvAi').hidden = true;
    if (pv.confirm && (c || cands[0]) && (!d.itemId || d.unsure)) aiGuess(d, c || db.contracts[cands[0]], tok);
    $('#pvPrev').disabled = pv.i === 0; $('#pvNext').textContent = pv.i < pv.ids.length - 1 ? '다음' : '닫기';
    $('#pvSave').textContent = pv.confirm ? '맞음 · 다음' : '이대로 저장';
    const box = $('#pvBody'); box.innerHTML = '<p class="muted">불러오는 중…</p>';
    try {
      let path = d.pdfPath || d.path, kind = d.pdfPath ? 'pdf' : d.kind;
      if (kind === 'hwp' || (kind === 'other' && /\.(xlsx?|docx?)$/i.test(d.name))) {
        try { const r = await (kind === 'hwp' ? S.hwp2pdf(d.path) : S.office2pdf(d.path)); d.pdfPath = r.path; saveDb(); path = r.path; kind = 'pdf'; } catch (_) { /* 변환 못 하면 글자로 */ }
      }
      if (tok !== pv.tok) return;
      if (kind === 'pdf') {
        const bytes = await S.readBytes(path); const lib = await JH.lib('pdfjs');
        const doc = await lib.getDocument({ data: bytes, isEvalSupported: false, cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true }).promise;
        if (tok !== pv.tok) return; box.innerHTML = '';
        const n = Math.min(doc.numPages, 12);
        for (let p = 1; p <= n; p++) {
          const page = await doc.getPage(p); const v1 = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: Math.min(1.6, 900 / v1.width) });
          const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
          await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; if (tok !== pv.tok) return; box.append(cv);
        }
        if (doc.numPages > n) box.insertAdjacentHTML('beforeend', `<p class="muted">… 모두 ${doc.numPages}쪽 중 ${n}쪽까지 보여 줍니다.</p>`);
        const spb = $('#pvSplit'); if (spb) { spb.hidden = !(doc.numPages > 1 && d.key && db.contracts[d.key]); const multi = !!(d.also && d.also.length); spb.className = multi ? 'btn sm split-hot' : 'link sm'; spb.textContent = multi ? `쪽별로 나누기 — 이 파일에 서류 ${d.also.length + 1}개(권장)` : '쪽별로 나누기'; }
        doc.destroy();
      } else if (kind === 'image') {
        const url = URL.createObjectURL(new Blob([await S.readBytes(path)])); box.innerHTML = `<img alt="${esc(d.name)}" src="${url}">`;
      } else box.innerHTML = `<pre class="pv-text">${esc((d.text || '읽을 수 있는 글자가 없습니다.').slice(0, 4000))}</pre>`;
    } catch (e) { if (tok === pv.tok) box.innerHTML = `<p class="warn-t">미리 볼 수 없습니다: ${esc(e.message)}</p>`; }
  }
  // ---------- 쪽별로 나누기: 한 파일에 여러 서류를 스캔한 PDF를 서류마다 잘라 각 칸에 ----------
  // 쪽마다 위쪽 제목을 읽어 '제목 쪽부터 다음 제목 앞 쪽까지'를 한 서류로 보는 안을 만들고, 사람이 확인·고친 뒤 저장.
  // 원래 파일은 _삭제됨으로(되돌리기 가능). 사람이 종류를 고친 줄은 배움
  const sp = { doc: null, bytes: null, n: 0, lines: [], rows: [], on: 0, tok: 0 };
  async function openSplit(d) {
    const c = d && d.key && db.contracts[d.key];
    if (!d || d.kind !== 'pdf') { toast('PDF 파일만 쪽별로 나눌 수 있습니다(한글 파일은 PDF로 바꾼 뒤).', 'err'); return; }
    if (!c) { toast('먼저 어느 계약 서류인지 정해 주세요. 계약을 고른 뒤 나눌 수 있습니다.', 'err'); return; }
    const tok = ++sp.tok;
    Object.assign(sp, { doc: d, rows: [], lines: [], n: 0, act: null, lastP: null, bytes: null });
    $('#spName').textContent = d.name + (sp.resume ? ` — 여러 서류가 든 파일이라 나누기 화면을 열었습니다. 나누지 않으려면 [닫기](묶음 그대로 두고 다음으로)` : ''); $('#spErr').hidden = true; $('#spSave').disabled = true;
    $('#spRows').innerHTML = '<p class="muted small">쪽을 읽는 중…</p>'; $('#spView').innerHTML = '';
    if ($('#dlgPreview').open) { if (pv.confirm && !sp.resume) sp.resume = pv.ids.slice(pv.i + 1); pv.split = true; $('#dlgPreview').close(); }
    $('#dlgSplit').showModal();
    try {
      sp.bytes = await S.readBytes(d.path);
      const heads = await R.pageHeads(sp.bytes, 'pdf', { max: 120, ocrMax: 120, onPage: (p, n) => { if (tok === sp.tok) $('#spRows').innerHTML = `<p class="muted small">쪽 제목 읽는 중 ${p}/${n}… (스캔본은 쪽마다 몇 초)</p>`; } });
      if (tok !== sp.tok) return;
      sp.n = (heads && heads.total) || 1; sp.lines = (heads && heads.rows) || [];
      sp.rows = L.splitPlan(pagesByRules(classList(c), heads || []), sp.n).map((r) => { const ps = []; for (let p = r.from; p <= r.to; p++) ps.push(p); return { pages: ps, item: r.item, sugg: r.item }; });
      sp.act = sp.rows[0]; sp.lastP = null;
      paintSplit(); renderSplitPages(tok);
    } catch (e) { if (tok === sp.tok) $('#spRows').innerHTML = `<p class="warn-t small">이 파일을 읽지 못했습니다: ${esc(e.message)}</p>`; }
  }
  // 쪽마다 서류 찾기: 배운 규칙(내가 고친 것·동료에게서 받은 것)이 먼저, 없으면 찾는 말
  function pagesByRules(list, heads) {
    const out = {};
    (heads || []).forEach((h, i) => {
      const hl = L.headLines((heads.rows && heads.rows[i]) || [h]);
      const lr = L.learnedItem(db.learned, list, '', hl);
      let id = lr ? lr.id : Object.keys(L.classifyPages(list, [h]))[0];
      if (!id) { const fz = L.learnedFuzzy(db.learned, list, hl); if (fz) id = fz.id; } // 배운 제목과 거의 같은 쪽(글자 인식 오류 감안)
      if (id) (out[id] = out[id] || []).push(i + 1);
    });
    return out;
  }
  // 쪽 묶음 글: [1,2,3,5] → '1~3, 5쪽'
  function pagesText(ps) {
    const a = [...ps].sort((x, y) => x - y), out = [];
    for (let i = 0; i < a.length; i++) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(i === j ? `${a[i]}` : `${a[i]}~${a[j]}`); i = j; }
    return out.length ? out.join(', ') + '쪽' : '쪽 없음';
  }
  const firstPage = (r) => (r.pages.length ? Math.min(...r.pages) : 1e9);
  // 나누기 화면: 왼쪽은 서류 줄(쪽 묶음 + 서류 종류), 오른쪽은 쪽 그림.
  // 서류 줄을 고르고 쪽 그림을 누르면 그 쪽이 그 서류로(Shift+누르기 = 범위). 떨어진 쪽도 한 서류로 묶을 수 있음
  // 나눌 때 직접 쓴 서류 이름: 이 PC에 기억(동료와 나누지 않음) → 다음에 치면 자동완성, 고르면 그때 고른 서류 종류도 같이
  const pageHead = (p) => L.norm((L.headLines(sp.lines[p - 1] || [])[0]) || '').slice(0, 60);
  const splitNames = () => (db.splitNames = db.splitNames || []);
  function rememberName(name, itemId, head) {
    const nm = String(name || '').trim(); if (!nm) return;
    const list = splitNames().filter((x) => !(x.name === nm && (!head || x.head === head || !x.head)));
    list.unshift({ name: nm, item: itemId ? L.suffixOf(itemId) : '', head: head || '', at: Date.now() });
    db.splitNames = list.slice(0, 200);
  }
  function fillSpNames() {
    const seen = new Set(), o = [];
    for (const x of splitNames()) if (!seen.has(x.name)) { seen.add(x.name); o.push(`<option value="${esc(x.name)}"></option>`); }
    $('#spNames').innerHTML = o.join('');
  }
  // 이름으로 서류 종류 찾기: 전에 이 이름으로 고른 종류 → 서류 목록 이름과 같으면 그것
  function itemForName(list, name) {
    const nm = L.norm(name); if (!nm) return null;
    const m = splitNames().find((x) => L.norm(x.name) === nm && x.item);
    const bySuf = m && list.find((x) => L.suffixOf(x.id) === m.item); if (bySuf) return bySuf.id;
    const eq = list.find((x) => L.norm(x.name) === nm); return eq ? eq.id : null;
  }
  // 목록에 없는 이름(서류 종류 없이 쓴 이름)을 자주 쓰면(3번) 서류 목록에 넣을지 물음 — 넣으면 그 이름의 '종류 미정' 파일도 그 칸으로
  const NAME_ASK = 3;
  function countName(nm, c, group) {
    const k = L.norm(nm); if (!k) return;
    const u = (db.nameUses = db.nameUses || {}); const e = (u[k] = u[k] || { name: nm, n: 0, types: {} });
    e.n++; e.name = nm; e.types[c.type] = group || e.types[c.type] || '';
    saveDb();
    if (e.n < NAME_ASK || e.asked || lists(c.type).some((x) => L.norm(x.name) === k)) return;
    e.asked = Date.now(); saveDb();
    setTimeout(() => toast(`「${nm}」을 ${e.n}번 직접 썼습니다. ${c.type} 서류 목록에 추가할까요? 추가하면 체크리스트 칸이 생기고 다음부터 이 종류로 자동 분류합니다.`, '',
      { label: '서류 목록에 추가', ms: 30000, run: () => addNamedItem(nm, c.type, e.types[c.type]) }), 900);
  }
  async function addNamedItem(nm, type, group) {
    const all = db.checklists ? JSON.parse(JSON.stringify(db.checklists)) : { 공사: JSON.parse(JSON.stringify(lists('공사'))), 용역: JSON.parse(JSON.stringify(lists('용역'))), 물품: JSON.parse(JSON.stringify(lists('물품'))) };
    const arr = all[type] || (all[type] = JSON.parse(JSON.stringify(lists(type))));
    if (arr.some((x) => L.norm(x.name) === L.norm(nm))) { toast(`「${nm}」은 이미 서류 목록에 있습니다.`); return; }
    const g = group && arr.some((x) => x.group === group) ? group : ((arr[arr.length - 1] || {}).group || '기타');
    const it = { id: (type === '공사' ? 'c-' : 's-') + L.uid(), group: g, name: nm, keywords: [L.norm(nm)], required: false, source: '업체', note: '나누기에서 직접 쓴 이름으로 추가' };
    let at = -1; arr.forEach((x, i) => { if (x.group === g) at = i; }); arr.splice(at + 1, 0, it);
    db.checklists = all;
    // 그 이름으로 저장해 둔 '종류 미정' 파일을 새 칸으로
    const k = L.norm(nm); let moved = 0;
    for (const d of db.docs.filter((x) => x.key && !x.itemId && db.contracts[x.key] && db.contracts[x.key].type === type && L.norm(L.stem(x.name)) === k)) {
      try { await moveDoc(d, d.key, it.id, true, d.pay, true); moved++; } catch (_) {}
    }
    for (const x of splitNames()) if (L.norm(x.name) === k && !x.item) x.item = L.suffixOf(it.id);
    logAct(`서류 목록에 추가(${type}): 「${nm}」 — ${g}`);
    await saveDb(true); render();
    toast(`${type} 서류 목록의 '${g}' 단계에 「${nm}」을 추가했습니다(꼭 필요한 서류는 아님 — 설정 → 서류 목록에서 바꿀 수 있음).${moved ? ` 그 이름의 파일 ${moved}개를 이 칸으로 옮겼습니다.` : ''}`, 'ok');
  }
  function paintSplit() {
    const list = classList(db.contracts[sp.doc.key]);
    sp.rows.sort((x, y) => firstPage(x) - firstPage(y));
    if (!sp.rows.includes(sp.act)) sp.act = sp.rows[0] || null;
    // 전에 같은 제목 쪽에 직접 쓴 이름이 있으면 미리 채움(지울 수 있음)
    for (const r of sp.rows) if (r.name == null && r.pages.length) { const h = pageHead(Math.min(...r.pages)); const m = h && splitNames().find((x) => x.head === h && (!r.item || !x.item || x.item === L.suffixOf(r.item))); if (m) { r.name = m.name; r.nameAuto = true; if (!r.item) r.item = itemForName(list, m.name); } }
    fillSpNames();
    $('#spRows').innerHTML = (sp.rows.length ? '' : '<p class="muted small">잘라 낼 서류가 없습니다. [+ 새 서류]를 누르고 종류를 고른 뒤 쪽을 누르세요.</p>') + sp.rows.map((r, i) => `<div class="sp-row${r === sp.act ? ' on' : ''}" data-spi="${i}">
      <div class="sp-pg"><span class="sp-no">${i + 1}</span><b class="sp-pages">${pagesText(r.pages)}</b>${r.item && r.item === r.sugg ? ' <small class="muted">제목으로 찾음</small>' : ''}<button type="button" class="x" data-spdel="${i}" title="이 서류 빼기(쪽은 앞 서류에 붙고, 앞 서류가 없으면 원래 파일에 남음)" aria-label="이 서류 빼기">✕</button></div>
      <div class="cpick"><input type="search" class="cpick-q" placeholder="서류 찾기(예: 재해율, 보험)" autocomplete="off" aria-label="서류 찾기"><select data-spf="item" data-autopick aria-label="서류 종류">${itemOptions(list, r.item, false)}</select></div>
      <input type="text" class="sp-nm" data-spf="name" list="spNames" autocomplete="off" value="${esc(r.name || '')}" placeholder="서류 이름 직접 쓰기(비우면 서류 종류 이름)" aria-label="서류 이름" title="저장할 파일 이름. 쓴 이름은 기억해 다음에 치면 자동완성되고, 같은 제목 쪽에는 미리 채웁니다">${r.nameAuto ? '<small class="muted">전에 쓴 이름</small>' : ''}
    </div>`).join('');
    checkSplitUi(); markPages();
  }
  function checkSplitUi() {
    const used = new Set(sp.rows.flatMap((r) => r.pages)), miss = [];
    for (let p = 1; p <= sp.n; p++) if (!used.has(p)) miss.push(p);
    const empty = sp.rows.filter((r) => !r.pages.length).length;
    const keepNm = sp.doc && db.contracts[sp.doc.key] ? ((classList(db.contracts[sp.doc.key]).find((x) => x.id === sp.doc.itemId) || {}).name || '종류 미정') : '';
    const msg = '', note = !sp.n ? '' : miss.length ? `고르지 않은 쪽 ${pagesText(miss)}은 원래 파일 칸(${keepNm})에 남깁니다.` : '';
    $('#spErr').textContent = note; $('#spErr').hidden = !note; $('#spErr').classList.toggle('warn-t', false);
    const filled = sp.rows.filter((r) => r.pages.length).length;
    const can = filled >= 2 || (filled >= 1 && miss.length > 0);
    $('#spSave').disabled = !!msg || !can;
    $('#spSave').title = !can ? '잘라 낼 쪽이 없습니다. [+ 새 서류]를 누르고 서류 종류를 고른 뒤 그 서류의 쪽을 누르세요' : '';
  }
  function markPages(scroll) {
    const list = sp.doc && db.contracts[sp.doc.key] ? classList(db.contracts[sp.doc.key]) : [];
    $$('#spView .sp-pgv').forEach((el) => {
      const p = +el.dataset.p, i = sp.rows.findIndex((x) => x.pages.includes(p)), r = sp.rows[i];
      el.classList.toggle('on', !!sp.act && sp.act.pages.includes(p));
      el.classList.toggle('cut', !!r && p > 1 && firstPage(r) === p);
      const it = r && r.item && list.find((x) => x.id === r.item);
      el.querySelector('small').textContent = r ? `${i + 1}. ${r.name || (it ? it.name : '종류 모름')}` : '아직 안 넣음';
    });
    if (scroll && sp.act && sp.act.pages.length) { const el = $(`#spView .sp-pgv[data-p="${firstPage(sp.act)}"]`); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  async function renderSplitPages(tok) {
    const lib = await JH.lib('pdfjs');
    const doc = await lib.getDocument({ data: sp.bytes.slice(), isEvalSupported: false, cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true }).promise;
    try {
      const n = Math.min(doc.numPages, 120);
      for (let p = 1; p <= n; p++) {
        if (tok !== sp.tok || !$('#dlgSplit').open) return;
        const page = await doc.getPage(p); const v1 = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: 240 / v1.width });
        const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        const fig = document.createElement('div'); fig.className = 'sp-pgv'; fig.dataset.p = p;
        fig.title = `${p}쪽 — 누르면 고른 서류 줄로 넣음(Shift+누르기 = 앞에 누른 쪽부터 여기까지), 두 번 누르면 이 쪽부터 새 서류로 자름`;
        fig.append(cv); fig.insertAdjacentHTML('beforeend', `<b>${p}</b><small></small>`);
        $('#spView').append(fig); markPages();
      }
    } finally { doc.destroy(); }
  }
  // 쪽들을 고른 서류 줄로 옮김(다른 줄에서는 빠짐). 비게 된 다른 줄은 지움
  function putPages(ps) {
    if (!sp.act) return;
    for (const r of sp.rows) if (r !== sp.act) r.pages = r.pages.filter((x) => !ps.includes(x));
    sp.act.pages = [...new Set([...sp.act.pages, ...ps])].sort((x, y) => x - y);
    sp.rows = sp.rows.filter((r) => r === sp.act || r.pages.length);
    paintSplit();
  }
  // 이 쪽부터(그 서류 안에서 뒤쪽) 새 서류로 자름
  function cutAt(p) {
    const r = sp.rows.find((x) => x.pages.includes(p)); if (!r) return;
    const tail = r.pages.filter((x) => x >= p), head = r.pages.filter((x) => x < p);
    if (!head.length) return;
    r.pages = head; const nr = { pages: tail, item: null, sugg: undefined }; sp.rows.push(nr); sp.act = nr; paintSplit();
  }
  $('#spRows').addEventListener('change', (e) => {
    const row = e.target.closest('[data-spi]'); if (!row) return;
    const r = sp.rows[+row.dataset.spi]; if (!r) return;
    if (e.target.dataset.spf === 'item') { r.item = e.target.value || null; markPages(); }
    if (e.target.dataset.spf === 'name') {
      r.name = e.target.value.trim(); r.nameAuto = false;
      const it = itemForName(classList(db.contracts[sp.doc.key]), r.name);
      if (it && it !== r.item) { r.item = it; const sel = row.querySelector('select[data-spf="item"]'); if (sel) sel.value = it; }
      markPages();
    }
  });
  $('#spRows').addEventListener('input', (e) => { if (e.target.dataset.spf !== 'name') return; const r = sp.rows[+e.target.closest('[data-spi]').dataset.spi]; if (r) { r.name = e.target.value.trim(); r.nameAuto = false; } });
  $('#spRows').addEventListener('click', (e) => {
    const x = e.target.closest('[data-spdel]');
    if (x) { const i = +x.dataset.spdel, r = sp.rows[i], to = sp.rows[i - 1] || sp.rows[i + 1]; if (to && !e.shiftKey) to.pages = [...to.pages, ...r.pages].sort((a, b) => a - b); sp.rows.splice(i, 1); sp.act = to || sp.rows[0] || null; paintSplit(); return; }
    const row = e.target.closest('[data-spi]'); if (!row) return;
    const r = sp.rows[+row.dataset.spi]; if (!r || r === sp.act) return;
    sp.act = r; $$('#spRows .sp-row').forEach((el) => el.classList.toggle('on', sp.rows[+el.dataset.spi] === sp.act)); markPages(true);
  });
  // 한 번 누르기는 잠깐 기다렸다 처리(두 번 누르기면 자르기만)
  let spClick = null;
  $('#spView').addEventListener('click', (e) => {
    const f = e.target.closest('.sp-pgv'); if (!f) return;
    clearTimeout(spClick); if (e.detail > 1) return;
    const p = +f.dataset.p, shift = e.shiftKey;
    spClick = setTimeout(() => {
      if (!sp.act) { toast('먼저 왼쪽에서 서류 줄을 고르거나 [+ 새 서류]를 누르세요.', 'err'); return; }
      if (shift && sp.lastP) { const a = Math.min(sp.lastP, p), b = Math.max(sp.lastP, p), ps = []; for (let q = a; q <= b; q++) ps.push(q); putPages(ps); }
      else if (sp.act.pages.includes(p)) { sp.act.pages = sp.act.pages.filter((x) => x !== p); paintSplit(); } // 이미 든 쪽을 다시 누르면 빠짐(원래 파일에 남음)
      else putPages([p]);
      sp.lastP = p;
    }, 260);
  });
  $('#spView').addEventListener('dblclick', (e) => { clearTimeout(spClick); const f = e.target.closest('.sp-pgv'); if (f) cutAt(+f.dataset.p); });
  // 처음부터 직접 고르기: 자동 안을 비우고 내가 고른 쪽만 잘라 냄(나머지는 원래 파일로 남음)
  $('#spClear').onclick = () => { sp.rows = []; sp.act = null; paintSplit(); $('#spAddRow').click(); };
  $('#spAddRow').onclick = () => {
    const nr = { pages: [], item: null, sugg: undefined }; sp.rows.push(nr); sp.act = nr; paintSplit();
    toast('새 서류 줄을 만들었습니다. 오른쪽에서 이 서류에 넣을 쪽 그림을 누르세요(Shift+누르기로 범위).', 'ok');
  };
  $('#spCancel').onclick = () => { sp.tok++; $('#dlgSplit').close(); };
  // 나누기 화면을 닫으면(나눴든 안 나눴든) 확인하던 다음 파일로 이어짐
  $('#dlgSplit').addEventListener('close', () => { sp.tok++; const rest = sp.resume || []; sp.resume = null; if (rest.length) askLater(rest); });
  $('#spSave').onclick = async () => {
    checkSplitUi(); if ($('#spSave').disabled) return;
    const d = sp.doc, c = d && db.contracts[d.key]; if (!c) return;
    // 고르지 않은 쪽은 원래 파일 칸으로 남김(남은 쪽 묶음)
    const used = new Set(sp.rows.flatMap((r) => r.pages)), rest = []; for (let p = 1; p <= sp.n; p++) if (!used.has(p)) rest.push(p);
    const rows0 = sp.rows.filter((r) => r.pages.length);
    if (rest.length) rows0.push({ pages: rest, item: d.itemId || null, sugg: d.itemId || null, rest: true });
    const rows = rows0.sort((x, y) => firstPage(x) - firstPage(y));
    $('#spSave').disabled = true;
    try {
      const PDFLib = await JH.lib('pdflib');
      const src = await PDFLib.PDFDocument.load(sp.bytes, { ignoreEncryption: true });
      const stem = L.stem(d.name).replace(/^\d{1,2}_/, '');
      const list = classList(c), rnd = d.pay ? roundById(c, d.pay) : null; let learned = 0; const noType = [];
      const baseGroup = ((list.find((x) => x.id === d.itemId) || {}).group) || '';
      await recorded(`「${d.name}」 쪽별로 나눔`, [c.key], [d.id], async () => {
        for (const r of rows) {
          const ps = [...r.pages].sort((x, y) => x - y);
          progress(`나누어 저장하는 중 ${pagesText(ps)}`, ps[0] / sp.n);
          const out = await PDFLib.PDFDocument.create();
          (await out.copyPages(src, ps.map((p) => p - 1))).forEach((pg) => out.addPage(pg));
          const bytes = await out.save();
          const item = r.item ? list.find((x) => x.id === r.item) : null;
          const place = docPlace(c, item ? item.id : null, rnd ? rnd.id : null);
          const own = !r.rest && r.name ? L.safeName(r.name, 60) : '';
          const nm = own ? `${own}.pdf` : `${stem}_${pagesText(ps).replace(/~/g, '-').replace(/,\s*/g, ',')}.pdf`;
          const fname = own ? `${place.n ? place.n + '_' : ''}${own}_${L.safeName(c.name || '', 40)}.pdf` : tidyName(item, c, nm, place.n);
          const saved = await S.save(place.dir, fname, bytes);
          if (own) rememberName(r.name, item && item.id, pageHead(ps[0]));
          if (own && !item) noType.push(r.name.trim());
          const top = sp.lines[ps[0] - 1] || [], heads = L.headLines(top);
          const nd = { id: L.uid(), key: c.key, itemId: item ? item.id : null, path: saved.path, name: nm, kind: 'pdf', size: bytes.length, mime: 'application/pdf',
            addedAt: new Date().toISOString(), ocr: d.ocr, text: L.maskPrivate(L.norm(ps.flatMap((p) => sp.lines[p - 1] || []).join(' ')).slice(0, 6000)), title: L.maskPrivate(L.norm(top.join(' ')).slice(0, 300)),
            manual: true, splitFrom: d.name, ...(heads.length ? { heads } : {}), ...(rnd ? { pay: rnd.id } : {}), ...(ps.length > 1 ? { pages: ps.length } : {}) };
          db.docs.push(nd);
          if (item && r.sugg !== item.id && learnFrom(nd, c, item.id)) learned++; // 사람이 정하거나 고친 종류는 배움
        }
        c.updatedAt = Date.now();
        await removeDoc(d);
      });
      textDirty = true; await saveDb(true);
      ui.sel = c.key; if (!(sp.resume && sp.resume.length)) setView('contracts'); // 나눈 계약 화면으로
      $('#dlgSplit').close(); render();
      logAct(`나눔 「${d.name}」 → ${rows.length}개 파일`);
      toast(`「${d.name}」을 ${rows.length}개 파일로 나눠 서류마다 넣었습니다.${learned ? ` 직접 정한 종류 ${learned}개는 배웠습니다.` : ''} 원래 파일은 _삭제됨에 있습니다.`, 'ok', undoAction());
      for (const nm of new Set(noType)) countName(nm, c, baseGroup);
    } catch (e) { console.error(e); toast('나누지 못했습니다: ' + e.message, 'err'); }
    finally { progress(null); checkSplitUi(); }
  };
  $('#pvSplit') && ($('#pvSplit').onclick = () => { const d = docById(pv.ids[pv.i]); if (d) openSplit(d); });
  $('#pvPrev').onclick = () => { if (pv.i > 0) { pv.i--; showPreview(); } };
  // 확인 팝업을 다 마치면(닫으면) 마지막으로 저장한 서류의 계약 화면으로 이동
  $('#dlgPreview').addEventListener('close', async () => {
    // 저장하지 않고 닫으면 지금 파일과 아직 못 본 파일은 미분류로(나누기 화면으로 넘어갈 때는 빼고 — 그건 나누기 뒤에 이어서 확인)
    const splitting = pv.split; pv.split = false;
    if (pv.confirm && !splitting) {
      const n = await skipToInbox(pv.ids.slice(pv.i));
      if (n) { render(); toast(`확인하지 않은 파일 ${n}개는 미분류로 옮겼습니다. 왼쪽 [미분류]에서 계약·종류를 고르면 됩니다(고른 계약은 추천으로 맨 위).`, '', undoAction()); }
    }
    const k = pv.lastKey; pv.lastKey = null;
    if (!k || !db.contracts[k] || ONLY || sp.resume || askQueue.length) return;
    ui.sel = k; setView('contracts');
    setTimeout(() => { const el = $(`.citem[data-key="${CSS.escape(k)}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }, 50);
  });
  $('#pvNext').onclick = async () => {
    if (pv.i >= pv.ids.length - 1) { $('#dlgPreview').close(); render(); return; } // 마지막: 닫기와 같음(아래 close에서 미분류로)
    if (pv.confirm) { const n = await skipToInbox([pv.ids[pv.i]]); if (n) toast('확인하지 않고 넘긴 파일은 미분류로 옮겼습니다(고른 계약은 추천으로 남김).', '', undoAction()); }
    pv.i++; showPreview(); render();
  };
  // PC 안 AI가 준비돼 있으면 헷갈리는 서류의 종류를 추정해 보여 줌(서류 내용은 이 PC 안 AI에만, 사람이 고르기 전까지 미리 골라만 둠)
  async function aiGuess(d, c, tok) {
    try {
      if (!JH.ai) return; const st = await JH.ai.status(); if (!st || !st.ready || tok !== pv.tok) return;
      const list = lists(c.type);
      $('#pvAi').hidden = false; $('#pvAi').textContent = 'AI가 내용을 보는 중…';
      const r = await JH.ai.ask({ privateData: true, json: true,
        system: '공공기관 계약 담당자의 서류 분류를 돕는다. 문서 앞부분을 보고 [목록]에서 가장 맞는 서류 이름 하나를 그대로 고른다. 확실하지 않으면 "모름". JSON {"item":"..."}만 답한다.',
        prompt: `[목록]\n${list.map((x) => x.name).join('\n')}\n\n[파일 이름] ${d.name}\n[문서 앞부분]\n${(d.heads || []).join('\n')}\n${String(d.text || '').slice(0, 700)}` });
      if (tok !== pv.tok) return;
      let name = ''; try { name = JSON.parse(String(r.text).match(/\{[\s\S]*\}/)[0]).item || ''; } catch (_) { name = ''; }
      const it = list.find((x) => L.norm(x.name) === L.norm(name)) || list.find((x) => name && L.norm(x.name).includes(L.norm(name)));
      if (!it) { $('#pvAi').textContent = 'AI도 확실히 모르겠다고 합니다. 직접 골라 주세요.'; return; }
      $('#pvAi').textContent = `AI 추정: ${it.name} — 맞으면 [맞음 · 다음]`;
      if ($('#pvContract').value === c.key && (!$('#pvItem').value || d.unsure)) $('#pvItem').value = it.id;
    } catch (e) { $('#pvAi').hidden = true; }
  }
  // 버리기: 우리 서류가 아니면 _삭제됨으로(되돌리기 가능) 하고 다음 파일로
  $('#pvTrash').onclick = async () => {
    const d = docById(pv.ids[pv.i]); if (!d) return;
    await recorded(`「${d.name}」 버리기`, [d.key], [d.id], () => removeDoc(d));
    toast(`「${d.name}」을 버렸습니다(_삭제됨으로).`, 'ok', undoAction());
    pv.ids = pv.ids.filter((id) => id !== d.id);
    if (!pv.ids.length) { $('#dlgPreview').close(); render(); return; }
    pv.i = Math.min(pv.i, pv.ids.length - 1); showPreview();
  };
  $('#pvOpen').onclick = () => { const d = docById(pv.ids[pv.i]); if (d) S.openFile(d.path).catch((e) => toast(e.message, 'err')); };
  $('#pvSave').onclick = async () => {
    const d = docById(pv.ids[pv.i]); if (!d) return;
    const key = $('#pvContract').value || null, item = key ? $('#pvItem').value || null : null;
    if (pv.confirm && key) pv.lastKey = key; // 확인을 마치면 이 계약 화면으로
    pv.done.add(d.id); // 확인함 — 닫거나 넘겨도 미분류로 옮기지 않음
    // 수정본 확인: 같은 칸 그대로 저장하면 '수정본' 표시
    if (d.revOf) { const p0 = docById(d.revOf); if (p0 && key === p0.key && item === p0.itemId) d.rev = true; delete d.revOf; await saveDb(true); }
    // 사람이 고른(또는 '맞음'으로 확인한) 서류 종류를 배움
    if (key && key !== d.key) { const am = learnAlias(d, db.contracts[key]); delete d.cands; if (am) setTimeout(() => toast(am, 'ok'), 80); }
    if (key && item && (pv.confirm || item !== d.itemId)) { const was = d.unsure; delete d.unsure; delete d.alts; const msg = learnFrom(d, db.contracts[key], item); if (msg && (was || item !== d.itemId || !d.itemId)) setTimeout(() => toast(msg, 'ok'), 50); await saveDb(true); }
    if (key !== d.key || item !== d.itemId) { const before = whereOf(d); await recorded(`「${d.name}」 정리`, [d.key, key], [d.id], () => moveDoc(d, key, item, true)); logAct(`「${d.name}」 ${before} → ${whereOf(d)}`); toast(`"${d.name}"을 ${key ? `${db.contracts[key].name}${item ? ' · ' + (lists(db.contracts[key].type).find((x) => x.id === item) || {}).name : ''}` : '미분류'}(으)로 정리했습니다.`, 'ok', undoAction()); }
    if (pv.i < pv.ids.length - 1) { pv.i++; showPreview(); } else { $('#dlgPreview').close(); render(); }
  };

  // ---------- 화면: 미분류 ----------
  function contractOptions(sel, rec) {
    const cs = contracts().sort((a, b) => b.updatedAt - a.updatedAt);
    // 설정에서 뺀 담당자의 계약은 고르기 목록에서 뺌(지금 골라져 있는 계약은 남김). data-q: 타자로 찾을 때 쓰는 글(이름·업체·번호·담당자)
    const hide = new Set((cfg.hideOfficers || []).map((x) => L.norm(x)).filter(Boolean));
    const opt = (c) => `<option value="${esc(c.key)}" data-q="${esc(L.norm([c.name, c.vendor, c.no, ...(c.nums || []), c.officer].join(' ')))}"${c.key === sel ? ' selected' : ''}>${esc(c.name)}${c.vendor ? ` (${esc(c.vendor)})` : ''}${c.officer ? ` · ${esc(c.officer)}` : ''}</option>`;
    // 추천(서류 내용으로 찾은 후보)을 맨 위에
    const recs = (rec || []).map((k) => db.contracts[k]).filter(Boolean);
    if (recs.length) return '<option value="">계약 고르기</option>' + `<optgroup label="추천 — 서류 내용으로 찾은 계약">${recs.map(opt).join('')}</optgroup><optgroup label="전체">` + cs.filter((c) => !rec.includes(c.key) && (c.key === sel || !hide.has(L.norm(c.officer || '')))).map(opt).join('') + '</optgroup>';
    return '<option value="">계약 고르기</option>' + cs.filter((c) => c.key === sel || !hide.has(L.norm(c.officer || ''))).map((c) => `<option value="${esc(c.key)}" data-q="${esc(L.norm([c.name, c.vendor, c.no, ...(c.nums || []), c.officer].join(' ')))}"${c.key === sel ? ' selected' : ''}>${esc(c.name)}${c.vendor ? ` (${esc(c.vendor)})` : ''}${c.officer ? ` · ${esc(c.officer)}` : ''}</option>`).join('');
  }
  // 계약 고르기 + 타자로 찾기: 글자를 치면 맞는 계약만 남기고 첫 번째를 고름, Enter면 그 계약으로 정함
  const contractPicker = (selectHtml) => `<div class="cpick"><input type="search" class="cpick-q" placeholder="계약 찾기: 이름·업체·번호 입력" autocomplete="off" aria-label="계약 찾기">${selectHtml}</div>`;
  document.addEventListener('input', (e) => {
    const q = e.target.closest && e.target.closest('.cpick-q'); if (!q) return;
    const sel = q.parentElement.querySelector('select'), t = L.norm(q.value);
    let first = null;
    for (const o of sel.options) { if (!o.value) continue; const hit = !t || (o.dataset.q || '').includes(t) || (/\d{3,}/.test(t) && (o.dataset.q || '').replace(/\D/g, '').includes(t.replace(/\D/g, ''))); o.hidden = !hit; if (hit && !first) first = o; }
    // 묶음(추천/전체) 안에 맞는 것이 하나도 없으면 묶음 이름도 숨김
    for (const g of sel.querySelectorAll('optgroup')) g.hidden = ![...g.children].some((o) => !o.hidden);
    if ((sel.id === 'pvContract' || sel.id === 'pvItem' || sel.hasAttribute('data-autopick')) && first && t) { sel.value = first.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    const left = [...sel.options].filter((o) => o.value && !o.hidden && o.value !== '__inbox');
    q.title = t ? `${left.length}건${sel.dataset.act === 'moveitem' && left[0] ? ` — Enter면 「${left[0].textContent}」(으)로` : ''}` : '';
    q.classList.toggle('none', !!t && !left.length);
  });
  document.addEventListener('keydown', (e) => {
    const q = e.target.closest && e.target.closest('.cpick-q'); if (!q || e.key !== 'Enter') return;
    e.preventDefault();
    const sel = q.parentElement.querySelector('select'); const first = [...sel.options].find((o) => o.value && !o.hidden && o.value !== '__inbox');
    if (first) { sel.value = first.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  function renderInbox() {
    const docs = inboxDocs();
    $('#view-inbox').innerHTML = `
      <div class="board-head"><h2>미분류</h2><span class="sub">어느 계약 서류인지 찾지 못한 파일입니다. 계약을 고르면 그 계약 폴더로 옮기고 서류 종류도 찾아 줍니다.</span>
        <div class="right"><button class="btn" data-act="rematch">다시 자동 분류</button></div></div>
      ${docs.length ? `<table class="grid"><thead><tr><th>파일</th><th>읽은 내용</th><th>계약</th><th></th></tr></thead><tbody>
        ${docs.map((d) => `<tr class="inbox-row"><td><div class="nm">${esc(d.name)}</div><div class="sub">${KIND_LABEL[d.kind]}${d.ocr ? ' · 스캔 인식' : ''} · ${esc(L.fmtDate(d.addedAt))}</div></td>
          <td class="sub">${esc([d.meta && d.meta.name, d.meta && d.meta.vendor].filter(Boolean).join(' / ') || (d.text ? d.text.slice(0, 40) + '…' : '읽을 수 있는 글자가 없음'))}</td>
          <td>${contractPicker(`<select data-act="assign" data-doc="${d.id}" aria-label="계약">${contractOptions('', (d.cands || []).filter((k) => db.contracts[k]))}</select>`)}${(d.cands || []).filter((k) => db.contracts[k]).length ? `<div class="sub rec-t">추천: ${esc(db.contracts[(d.cands || []).find((k) => db.contracts[k])].name)}${d.cands.length > 1 ? ` 외 ${d.cands.length - 1}` : ''} — 목록 맨 위</div>` : ''}</td>
          <td style="white-space:nowrap"><button class="link" data-act="view" data-doc="${d.id}">보기</button> &nbsp; <button class="btn sm ghost" data-act="del" data-doc="${d.id}" title="우리 서류가 아니면 버림(_삭제됨으로 옮김, 되돌리기 가능)">버리기</button></td></tr>`).join('')}
        </tbody></table>` : `<div class="empty-line">미분류 서류가 없습니다.</div>`}`;
  }

  // ---------- 화면: 처음 ----------
  function renderHome() {
    $('#homeTitle').textContent = cfg.officer ? `${cfg.officer}님, 어떤 일을 하시겠어요?` : '어떤 일을 하시겠어요?';
    const mine = contracts().filter((c) => !cfg.officer || !c.officer || c.officer === cfg.officer);
    const cnt = { miss: 0, ready: 0, late: 0 };
    mine.forEach((c) => { const st = statusOf(c); if (st.state === 'missing') cnt.miss++; if (st.state === 'ready') cnt.ready++; if (st.late) cnt.late++; });
    const inbox = inboxDocs().length;
    $('#homeJichul').innerHTML = mine.length
      ? `<li><b class="num">${cnt.miss}</b>서류 미비</li><li><b class="num">${cnt.ready}</b>지출 대기</li><li class="${cnt.late ? 'alert' : ''}"><b class="num">${cnt.late}</b>준공 지남·미지출</li>${inbox ? `<li class="alert"><b class="num">${inbox}</b>미분류</li>` : ''}`
      : '<li class="muted">아직 계약이 없습니다. 서류를 넣거나 나라장터에서 불러오세요.</li>';
    const rh = $('#homeRules'); if (rh && JH.rules) { JH.rules.load().catch(() => {}).then(() => { const k = JH.rules.kb, q = JH.rules.qa; rh.innerHTML = k.sources.length || q.items.length ? `<li><b class="num">${k.sources.length}</b>법령·규정</li><li><b class="num">${q.items.length}</b>저장한 답변</li>` : '<li class="muted">법령을 받고 규정집을 올리면 질문에 답합니다.</li>'; }); }
    const ns = JH.notice && JH.notice.stats ? JH.notice.stats() : { count: 0 };
    $('#homeNotice').innerHTML = ns.count
      ? `<li><b class="num">${ns.draft}</b>작성 중</li><li><b class="num">${ns.done}</b>작성 완료</li>${ns.recent ? `<li class="recent">최근: ${esc(ns.recent)}</li>` : ''}`
      : '<li class="muted">아직 작성한 공고문이 없습니다.</li>';
  }

  function render() { const r = withIndex(render0); syncTab(); return r; }
  function render0() {
    const n = inboxDocs().length;
    const ic = $('#inboxCount'); ic.hidden = !n; ic.textContent = n;
    if (ui.view === 'home') { renderHome(); return; }
    if (ui.view === 'notice' || ui.view === 'rules') return;
    renderList(); renderDetail(); fitMemo();
    const cur = ui.view === 'contracts' && ui.sel && db.contracts[ui.sel]; if (cur && S.online) backfillDates(cur);
    if (ui.view === 'board') renderBoard();
    if (ui.view === 'inbox') renderInbox();
  }
  const MOD = { contracts: 'jichul', board: 'jichul', inbox: 'jichul', notice: 'notice', rules: 'rules', home: '' };
  // ---------- 탭(한 창 안에서 여러 화면) ----------
  // 탭마다 '어느 화면 + 어느 계약(또는 공고문)'을 기억. 데이터는 하나라 덮어쓰기 걱정 없음. [+]는 지금 화면을 복사한 새 탭
  const TAB_KEY = 'jh.tabs';
  const tabs = { list: [], on: null };
  const VIEW_NAME = { home: '처음 화면', contracts: '계약별', board: '현황판', inbox: '미분류', notice: '공고문', rules: '규정·질문' };
  const curState = () => ({ view: ui.view || 'home', sel: ui.sel || null, nid: (JH.notice && JH.notice.selId && JH.notice.selId()) || null });
  function tabTitle(t) {
    if (t.view === 'contracts' && t.sel && db.contracts[t.sel]) return db.contracts[t.sel].name;
    if (t.view === 'notice' && JH.notice && JH.notice.selTitle) return JH.notice.selTitle(t.nid) || '공고문';
    return VIEW_NAME[t.view] || '화면';
  }
  const tabKind = (t) => (t.view === 'contracts' && t.sel ? '계약' : t.view === 'notice' && t.nid ? '공고문' : '');
  function saveTabs() { try { localStorage.setItem(TAB_KEY, JSON.stringify(tabs)); } catch (_) { /* 기억 못 해도 됨 */ } }
  function paintTabs() {
    const el = $('#tabs'); if (!el) return;
    if (ONLY) { el.hidden = true; return; }
    el.innerHTML = tabs.list.map((t) => {
      const on = t.id === tabs.on, k = tabKind(t), title = tabTitle(t);
      return `<div class="tab-it${on ? ' on' : ''}" role="tab" aria-selected="${on}" tabindex="0" data-tab="${t.id}" title="${esc((k ? k + ': ' : '') + title)}">${k ? `<span class="tk">${k}</span>` : ''}<span class="tl">${esc(title)}</span>${tabs.list.length > 1 ? `<button type="button" class="tx" data-tabx="${t.id}" aria-label="${esc(title)} 탭 닫기" title="탭 닫기">×</button>` : ''}</div>`;
    }).join('') + '<button type="button" class="tab-add" id="tabAdd" title="새 탭: 지금 화면을 하나 더 열어 두기(다른 계약·공고문을 나란히)" aria-label="새 탭">+</button>';
  }
  // 뒤로: 탭마다 지나온 화면(화면 + 계약 + 공고문)을 기억해 [←]·Alt+←·마우스 뒤로 버튼으로 돌아감
  const hist = new Map(); let navLock = false;
  const sameState = (a, b) => a && b && a.view === b.view && (a.sel || null) === (b.sel || null) && (a.view !== 'notice' || (a.nid || null) === (b.nid || null));
  function noteNav() {
    if (navLock || ONLY || !tabs.on) return;
    const h = hist.get(tabs.on) || []; const s = curState();
    if (!sameState(h[h.length - 1], s)) { h.push(s); if (h.length > 60) h.shift(); hist.set(tabs.on, h); }
    const b = $('#btnBack'); if (b) b.disabled = h.length < 2;
  }
  function goBack() {
    const h = hist.get(tabs.on) || []; if (h.length < 2) return;
    h.pop(); const s = h[h.length - 1];
    navLock = true;
    try { if (s.sel && db.contracts[s.sel]) ui.sel = s.sel; if (s.nid && JH.notice && JH.notice.select) JH.notice.select(s.nid); setView(s.view || 'home'); }
    finally { navLock = false; }
    syncTab();
  }
  // 지금 보이는 화면을 켜져 있는 탭에 기억
  function syncTab() {
    if (ONLY || !tabs.on) return;
    const t = tabs.list.find((x) => x.id === tabs.on); if (!t) return;
    Object.assign(t, curState()); saveTabs(); paintTabs(); noteNav();
  }
  // 단계(구매요구·계약·착공계…) 접기: 기본은 펼침, 제목을 누르면 접힘. 접은 단계는 이 PC에 기억(모든 계약에 같이)
  let foldCache = null;
  function foldSet() { if (!foldCache) { foldCache = new Set(); try { for (const x of JSON.parse(localStorage.getItem('jh.fold') || '[]')) foldCache.add(x); } catch (_) { /* 처음 */ } } return foldCache; }
  function toggleFold(name) {
    const f = foldSet(); if (f.has(name)) f.delete(name); else f.add(name);
    try { localStorage.setItem('jh.fold', JSON.stringify([...f])); } catch (_) { /* 기억 못 해도 됨 */ }
    const y = $('#detail') ? $('#detail').scrollTop : 0; render(); if ($('#detail')) $('#detail').scrollTop = y;
  }
  document.addEventListener('click', (e) => { const h = e.target.closest && e.target.closest('[data-fold]'); if (h && !e.target.closest('button, a, input, select, label')) toggleFold(h.dataset.fold); });
  document.addEventListener('keydown', (e) => { const h = e.target.closest && e.target.closest('[data-fold]'); if (h && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleFold(h.dataset.fold); } });
  // 계약을 새 탭으로(현황판·목록에서 가운데 버튼): 보던 화면은 그대로 두고 탭만 하나 더
  function openInNewTab(key) {
    if (ONLY || !db.contracts[key]) return;
    syncTab();
    const t = { id: L.uid(), view: 'contracts', sel: key, nid: null };
    const i = tabs.list.findIndex((x) => x.id === tabs.on);
    tabs.list.splice(i + 1, 0, t); hist.set(t.id, [{ ...t }]); saveTabs(); paintTabs();
    toast(`「${db.contracts[key].name}」을 새 탭에 열었습니다. 위 탭을 누르면 갑니다.`, 'ok');
  }
  function openTabState(t) {
    ui.sel = t.sel && db.contracts[t.sel] ? t.sel : ui.sel;
    if (t.nid && JH.notice && JH.notice.select) JH.notice.select(t.nid);
    setView(t.view || 'home');
  }
  function switchTab(id) {
    if (id === tabs.on) return;
    syncTab();
    const t = tabs.list.find((x) => x.id === id); if (!t) return;
    navLock = true; try { tabs.on = id; openTabState(t); } finally { navLock = false; } saveTabs(); paintTabs(); noteNav();
  }
  function addTab() {
    syncTab();
    const t = { id: L.uid(), ...curState() };
    const i = tabs.list.findIndex((x) => x.id === tabs.on);
    tabs.list.splice(i + 1, 0, t); tabs.on = t.id; saveTabs(); paintTabs();
    toast('새 탭을 열었습니다. 여기서 다른 계약이나 공고문을 고르면 이 탭에 남고, 원래 탭은 그대로입니다.', 'ok');
  }
  function closeTab(id) {
    if (tabs.list.length < 2) return;
    const i = tabs.list.findIndex((x) => x.id === id); if (i < 0) return;
    tabs.list.splice(i, 1);
    if (tabs.on === id) { const n = tabs.list[Math.min(i, tabs.list.length - 1)]; tabs.on = n.id; openTabState(n); }
    saveTabs(); paintTabs();
  }
  function initTabs() {
    if (ONLY) { paintTabs(); return; }
    let saved = null; try { saved = JSON.parse(localStorage.getItem(TAB_KEY) || 'null'); } catch (_) { /* 처음 */ }
    if (saved && Array.isArray(saved.list) && saved.list.length) {
      tabs.list = saved.list.filter((t) => t && t.id && VIEW_NAME[t.view]).slice(0, 20);
      tabs.on = tabs.list.some((t) => t.id === saved.on) ? saved.on : (tabs.list[0] || {}).id;
    }
    if (!tabs.list.length) { const t = { id: L.uid(), ...curState() }; tabs.list = [t]; tabs.on = t.id; }
    paintTabs();
    const t = tabs.list.find((x) => x.id === tabs.on); if (t && (t.view !== ui.view || t.sel !== ui.sel)) openTabState(t);
  }
  document.addEventListener('click', (e) => {
    const x = e.target.closest && e.target.closest('[data-tabx]'); if (x) { e.stopPropagation(); closeTab(x.dataset.tabx); return; }
    if (e.target.closest && e.target.closest('#tabAdd')) { addTab(); return; }
    const t = e.target.closest && e.target.closest('[data-tab]'); if (t) switchTab(t.dataset.tab);
  });
  document.addEventListener('auxclick', (e) => {
    if (e.button !== 1 || !e.target.closest) return;
    const t = e.target.closest('[data-tab]'); if (t) { e.preventDefault(); closeTab(t.dataset.tab); return; } // 가운데 버튼으로 탭 닫기
    const k = e.target.closest('#view-board tr[data-key], .citem[data-key], #homeNotice [data-key]'); if (k) { e.preventDefault(); openInNewTab(k.dataset.key); } // 계약을 새 탭으로
  });
  // 가운데 버튼을 누를 때 생기는 자동 스크롤 표시를 막음(계약 줄 위에서만)
  document.addEventListener('mousedown', (e) => { if (e.button === 1 && e.target.closest && e.target.closest('#view-board tr[data-key], .citem[data-key], [data-tab]')) e.preventDefault(); });
  // 뒤로: 버튼, Alt+←, 마우스 뒤로 버튼(4번째 버튼)
  $('#btnBack').onclick = () => goBack();
  document.addEventListener('mouseup', (e) => { if (e.button === 3) { e.preventDefault(); goBack(); } });
  document.addEventListener('keydown', (e) => { if (e.altKey && e.key === 'ArrowLeft' && !ONLY) { e.preventDefault(); goBack(); } });
  document.addEventListener('keydown', (e) => {
    const t = e.target.closest && e.target.closest('[data-tab]');
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); switchTab(t.dataset.tab); return; }
    // Ctrl+Tab / Ctrl+Shift+Tab: 다음·이전 탭
    if (e.ctrlKey && e.key === 'Tab' && tabs.list.length > 1 && !ONLY) {
      e.preventDefault(); const i = tabs.list.findIndex((x) => x.id === tabs.on);
      switchTab(tabs.list[(i + (e.shiftKey ? -1 : 1) + tabs.list.length) % tabs.list.length].id);
    }
  });
  function setView(v) {
    if (ONLY && v !== 'notice' && v !== 'rules') v = 'notice';
    ui.view = v;
    const mod = MOD[v];
    $$('.views button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    $$('.vgroup').forEach((g) => g.classList.toggle('cur', g.dataset.mod === mod));
    $$('.bar-actions [data-for]').forEach((b) => { b.hidden = b.dataset.for !== mod; });
    $$('.view').forEach((s) => s.classList.toggle('on', s.id === 'view-' + v));
    document.body.dataset.mod = mod || 'home';
    if (v === 'notice') JH.notice.show();
    if (v === 'rules' && JH.rules) JH.rules.show();
    render();
  }

  // ---------- 동작 연결 ----------
  const docById = (id) => db.docs.find((d) => d.id === id);
  async function onAct(e) {
    const t = e.target.closest('[data-act]'); if (!t || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && e.type === 'click')) return;
    const act = t.dataset.act, c = ui.sel && db.contracts[ui.sel];
    try {
      if (act === 'add') $('#fileIn').click();
      else if (act === 'addhere') { pickTarget = { key: ui.sel }; $('#fileIn').click(); }
      else if (act === 'additem') { pickTarget = { key: ui.sel, item: t.dataset.item, pay: t.dataset.pay || null }; $('#fileIn').click(); }
      else if (act === 'roundadd') {
        const o = {}; if (t.dataset.kind === 'labor') { const d = new Date(); d.setMonth(d.getMonth() - 1); o.month = d.getMonth() + 1; }
        const r = addRound(c, t.dataset.kind, o); ui.roundOpen = { ...(ui.roundOpen || {}), [r.id]: true }; render(); await saveDb(true);
        toast(`${L.roundLabel(r)} 회차를 만들었습니다. 서류를 이 회차 줄에 끌어다 놓거나, 그냥 올려도 이름·내용으로 찾아 넣습니다.`, 'ok');
      } else if (act === 'roundpay') { e.preventDefault(); const r = roundById(c, t.dataset.round); if (r) openPay(r, `${L.roundLabel(r)} 지출 처리`);
      } else if (act === 'rjump') {
        ui.roundOpen = { ...(ui.roundOpen || {}), [t.dataset.round]: true }; render();
        const el = document.querySelector(`details.round[data-round="${t.dataset.round}"]`); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else if (act === 'rmail') { const r = roundById(c, t.dataset.round); if (r) openMail(c, r);
      } else if (act === 'rprint' || act === 'rsave') { const r = roundById(c, t.dataset.round); if (r) await printRound(c, r, act === 'rsave' ? 'save' : 'print');
      } else if (act === 'rpayauto') { const r = roundById(c, t.dataset.round); if (r) { delete r.payPlan; c.updatedAt = Date.now(); render(); await saveDb(true); }
      } else if (act === 'rdel') {
        const r = roundById(c, t.dataset.round); if (!r) return;
        const ds = roundDocs(c, r);
        if (!confirm(`${L.roundLabel(r)} 회차를 지울까요?${ds.length ? ` 이 회차 서류 ${ds.length}개는 준공(마지막) 목록으로 옮겨집니다.` : ''}`)) return;
        for (const d of ds) await moveDoc(d, c.key, d.itemId, true, '');
        c.pays = (c.pays || []).filter((x) => x !== r); c.updatedAt = Date.now(); await saveDb(true); render();
      }
      else if (act === 'print') await printContract(c, 'print');
      else if (act === 'save') await printContract(c, 'save');
      else if (act === 'folder') await S.open(folderOf(c));
      else if (act === 'pay') openPay(c);
      else if (act === 'edit') openContract(c);
      else if (act === 'confirmdoc') openPreview([t.dataset.doc], 0, true);
      else if (act === 'view') { const d = docById(t.dataset.doc); openPreview([d.id], 0); }
      else if (act === 'split') openSplit(docById(t.dataset.doc));
      else if (act === 'del') {
        const d = docById(t.dataset.doc); if (!d) return;
        const c0 = d.key && db.contracts[d.key], nm = (id) => ((c0 && classList(c0).find((x) => x.id === id)) || {}).name || id;
        // 여러 서류가 든 묶음 파일: 파일은 남기고 이 칸 표시만 뺌(다른 칸은 그대로). 대표 칸이었으면 남은 것 중 하나가 대표
        if (c0 && d.also && d.also.length) {
          if (!confirm(`「${d.name}」은 여러 서류가 든 묶음 파일입니다(${[d.itemId, ...d.also].filter(Boolean).map(nm).join(', ')}).\n이 칸(${nm(d.itemId)})에서만 뺄까요? 파일과 다른 칸은 그대로 남습니다.\n(파일째 지우려면 [보기] → [버리기])`)) return;
          const next = d.also[0], was = nm(d.itemId);
          d.also = d.also.slice(1); if (d.pagesOf) delete d.pagesOf[d.itemId];
          if (!d.also.length) delete d.also;
          await moveDoc(d, d.key, next, true);
          logAct(`「${d.name}」 묶음 파일에서 '${was}' 칸만 뺌(대표 칸은 '${nm(next)}')`); render();
          toast(`'${was}' 칸에서만 뺐습니다. 파일은 '${nm(next)}' 칸 등 다른 칸에 그대로 있습니다.`, 'ok', undoAction()); return;
        }
        if (confirm(`"${d.name}"을 목록에서 뺄까요? 파일은 데이터 폴더의 _삭제됨으로 옮겨집니다.`)) { await removeDoc(d); render(); }
      }
      else if (act === 'unalso') {
        // 함께 든 서류 표시만 뺌(잘못 찾은 경우)
        const d = docById(t.dataset.doc), id = t.dataset.item; if (!d || !d.also) return;
        d.also = d.also.filter((x) => x !== id); if (d.pagesOf) delete d.pagesOf[id]; if (!d.also.length) delete d.also;
        await saveDb(true); render();
        toast(`이 칸에서 「${d.name}」 표시를 뺐습니다(파일과 다른 칸은 그대로).`, 'ok', undoAction());
      }
      else if (act === 'hwp') {
        const d = docById(t.dataset.doc); t.disabled = true; t.textContent = '변환 중…';
        try { const r = await S.hwp2pdf(d.path); d.pdfPath = r.path; await saveDb(true); toast('PDF로 변환했습니다.', 'ok'); }
        catch (err) { toast('한글 변환 실패: ' + err.message, 'err'); }
        render();
      } else if (act === 'budget') { c.budget = t.dataset.v === 'ext' ? 'ext' : 'own'; c.updatedAt = Date.now(); render(); await saveDb(true);
        toast(c.budget === 'ext' ? '외부 예산 사업으로 바꿨습니다. 구매요구서 자리가 "일반 기안문"으로 바뀝니다.' : '우리 예산 사업으로 바꿨습니다.', 'ok');
      } else if (act === 'mail') { openMail(c);
      } else if (act === 'recvall') {
        const st = statusOf(c);
        if (!confirm(`빠진 서류 ${st.missing.length}개(${st.missing.map((x) => itemView(c, x).name).join(', ')})를 '받음'으로 표시할까요? 하나씩 다시 풀 수 있습니다.`)) return;
        c.received = c.received || {}; st.missing.forEach((x) => { c.received[x.id] = true; }); c.updatedAt = Date.now(); render(); await saveDb(true);
        toast(`${st.missing.length}개를 '받음'으로 표시했습니다.`, 'ok');
      } else if (act === 'payauto') { delete c.payPlan; c.updatedAt = Date.now(); render(); await saveDb(true);
      } else if (act === 'budgetauto') { delete c.budget; c.updatedAt = Date.now(); render(); await saveDb(true);
      } else if (act === 'excel') { await exportExcel(t.dataset.from === 'list' ? filtered().map((x) => ({ c: x, st: statusOf(x) })) : boardRows());
      } else if (act === 'searchall') { ui.officer = ''; ui.officerTouched = true; ui.type = ''; ui.state = ''; $$('#fState button').forEach((b) => b.classList.toggle('on', !b.dataset.state)); render();
      } else if (act === 'quickform') { await quickForms(t.dataset.fk);
      } else if (act === 'forms') { openForms();
      } else if (act === 'auditedit') { ui.auditEdit = !ui.auditEdit; cardOpen.audit = true; render();
      } else if (act === 'auditdocs') { await fillFromDocs(c); render();
      } else if (act === 'g2bre') {
        if (!cfg.apiKey) { toast('설정에서 나라장터 인증키를 먼저 넣어 주세요.', 'err'); return; }
        const r = await enrichContracts([c], true); render();
        toast(r.errs.length ? `일부 서비스는 받지 못했습니다: ${r.errs.map(([n]) => n).join(', ')} (공공데이터포털에서 같은 인증키로 활용신청 필요)` : '나라장터에서 세부 정보를 다시 받았습니다.', r.errs.length ? 'err' : 'ok');
      } else if (act === 'rematch') { const n = await rematchInbox(); toast(n ? `${n}개를 계약으로 옮겼습니다.` : '새로 찾은 계약이 없습니다.'); render(); }
    } catch (err) { console.error(err); toast(err.message, 'err'); }
  }
  async function onChange(e) {
    const t = e.target;
    try {
      const rOf = () => { const c = db.contracts[ui.sel]; return c ? roundById(c, t.dataset.round) : null; };
      if (t.dataset.act === 'rvia' || t.dataset.act === 'rrecv') {
        const c = db.contracts[ui.sel], r = rOf(); if (!r) return; const k = t.dataset.act === 'rvia' ? 'via' : 'received';
        r[k] = r[k] || {}; if (t.checked) r[k][t.dataset.item] = true; else delete r[k][t.dataset.item];
        c.updatedAt = Date.now(); render(); await saveDb(); return;
      }
      if (t.dataset.act === 'rpayplan' || t.dataset.act === 'rmonth') {
        const c = db.contracts[ui.sel], r = rOf(); if (!r) return;
        if (t.dataset.act === 'rpayplan') { const v = t.value.replace(/-/g, ''); if (v) r.payPlan = v; else delete r.payPlan; }
        else { const old = roundDir(c, r); if (t.value) r.month = +t.value; else delete r.month; if (roundDir(c, r) !== old) for (const d of roundDocs(c, r)) await moveDoc(d, c.key, d.itemId, d.manual); }
        c.updatedAt = Date.now(); await saveDb(true); render(); return;
      }
      if (t.dataset.act === 'docpay') {
        const d = docById(t.dataset.doc), c = db.contracts[d.key]; const r = t.value ? roundById(c, t.value) : null;
        // 기성 회차 ↔ 준공: 준공계·지정통보·조서를 기성계·기성 지정통보·기성 검사조서로 바꿔 줌
        const suf = String(d.itemId || '').replace(/^[csg]-/, ''); let item = d.itemId;
        const toProg = { finish: 'progfin', finishreq: 'progfin', notice: 'prognotice', inspect: 'proginsp' }, toFin = { progfin: 'finish', prognotice: 'notice', proginsp: 'inspect' };
        if (r && r.kind === 'prog' && toProg[suf]) item = d.itemId.replace(suf, toProg[suf]);
        if (!r && toFin[suf]) item = d.itemId.replace(suf, toFin[suf]);
        await moveDoc(d, c.key, item, true, r ? r.id : ''); render(); return;
      }
      if (t.dataset.act === 'noprint') {
        const c = db.contracts[ui.sel]; c.noPrint = c.noPrint || {};
        if (t.checked) delete c.noPrint[t.dataset.item]; else c.noPrint[t.dataset.item] = true;
        c.updatedAt = Date.now(); render(); await saveDb();
      } else if (t.dataset.act === 'via') {
        const c = db.contracts[ui.sel]; c.via = c.via || {};
        const k = L.viaKey(t.dataset.item, t.dataset.part || '');
        if (t.checked) c.via[k] = true; else delete c.via[k];
        c.updatedAt = Date.now(); render(); await saveDb();
      } else if (t.dataset.act === 'recv') {
        const c = db.contracts[ui.sel]; c.received = c.received || {};
        if (t.checked) c.received[t.dataset.item] = true; else delete c.received[t.dataset.item];
        c.updatedAt = Date.now(); render(); await saveDb();
      } else if (t.dataset.act === 'orig') {
        const c = db.contracts[ui.sel]; c.originals = c.originals || {}; c.originals[t.dataset.item] = t.checked; c.updatedAt = Date.now();
        await saveDb(); render();
      } else if (t.dataset.act === 'moveitem') {
        const d = docById(t.dataset.doc);
        if (t.value === '__inbox') await moveDoc(d, null, null); else await moveDoc(d, d.key, t.value || null);
        render();
      } else if (t.dataset.act === 'assign') {
        const d = docById(t.dataset.doc); const c = db.contracts[t.value]; if (!c) return;
        await moveDoc(d, c.key, classifyDoc(c, d.name, d.title, d.heads).id);
        const am = learnAlias(d, c); delete d.cands; if (am) await saveDb(true);
        toast(`"${c.name}"으로 옮겼습니다.${am ? ' ' + am : ''}`, 'ok', { label: '계약 보기', run: () => { ui.sel = c.key; setView('contracts'); } });
        render();
      } else if (t.dataset.act === 'validset' || t.dataset.act === 'docdate') {
        const d = docById(t.dataset.doc); const v = t.value.replace(/-/g, '');
        if (t.dataset.act === 'validset') { if (v) d.validOverride = v; else delete d.validOverride; } else { if (v) d.dateOverride = v; else delete d.dateOverride; }
        await saveDb(true); render();
      } else if (t.dataset.act === 'payplan') {
        const c = db.contracts[ui.sel]; const v = t.value.replace(/-/g, '');
        if (v) c.payPlan = v; else delete c.payPlan; c.updatedAt = Date.now(); await saveDb(true); render();
      } else if (t.id === 'bOfficer') { ui.officer = t.value; ui.officerTouched = true; render(); }
    } catch (err) { console.error(err); toast(err.message, 'err'); render(); }
  }

  // 업체 보완 요청 메일
  function openMail(c, r) {
    let st = statusOf(c), n = vendorNeeds(c, st), round = '';
    if (r) {
      const s = roundStatus(c, r); round = s.label;
      const mi = s.missing.filter((x) => L.ORIGINAL_SOURCES.includes(x.source) && !x.link);
      n = { missing: mi.map((x) => x.name), missingItems: mi, reissue: s.expired.map((x) => ({ name: x.item.name, valid: x.valid })), via: s.via };
      if (s.advShort) n.reissue.push({ name: `선금 보증서(보증기간이 준공일 ${L.fmtDate(c.endDate)} + ${L.ADV_DAYS}일 이상이어야 함)`, valid: s.adv.end });
      st = { basis: s.basis, unknownValid: s.unknownValid };
    }
    // 빠진 서류마다 발급·유효 조건을 붙여 씀(3개월 이내 발급분, 지급 예정일 이후까지 유효, 보증기간 등)
    const bd = (st.basis || {}).date;
    const withCond = (n.missingItems || []).map((x) => ({ name: itemView(c, x).name, cond: L.issueCond(x, c, bd) }));
    const m = L.vendorMail({ c, org: cfg.insttNm, dept: (cfg.notice && cfg.notice.dept) || '', officer: cfg.officer, phone: (cfg.notice && cfg.notice.phone) || '', missing: withCond.length ? withCond : n.missing, reissue: n.reissue, via: n.via, basis: st.basis || {}, round });
    $('#mailTo').value = memoOf(c).vmail || ''; $('#mailSubj').value = m.title; $('#mailBody').value = m.body;
    $('#mailNote').textContent = st.unknownValid.length ? `유효기간을 읽지 못한 증명서 ${st.unknownValid.length}개는 빠져 있습니다. 서류 줄에서 날짜를 넣으면 반영됩니다.` : '';
    $('#dlgMail').showModal();
  }
  $('#mailCopy').onclick = async () => {
    const text = `제목: ${$('#mailSubj').value}\n\n${$('#mailBody').value}`;
    try { await navigator.clipboard.writeText(text); toast('메일 내용을 복사했습니다. 메일 쓰기 화면에 붙여 넣으세요.', 'ok'); }
    catch (_) { $('#mailBody').select(); toast('복사하지 못했습니다. 본문을 직접 선택해 복사해 주세요.', 'err'); }
  };
  $('#mailOpen').onclick = () => {
    const c = db.contracts[ui.sel]; const to = $('#mailTo').value.trim();
    if (c && to !== (memoOf(c).vmail || '')) { c.memo = { ...(c.memo || {}), vmail: to }; saveDb(); }
    location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent($('#mailSubj').value)}&body=${encodeURIComponent($('#mailBody').value)}`;
  };

  // 첫 실행: 이름·부서·연락처만 받음(인증키·기관은 공용 설정)
  function openWelcome() {
    $('#wName').value = cfg.officer || ''; $('#wDept').value = (cfg.notice && cfg.notice.dept) || ''; $('#wPhone').value = (cfg.notice && cfg.notice.phone) || '';
    $('#wOrg').textContent = cfg.insttNm || '';
    $('#wKeyNote').hidden = !cfg.apiKey;
    $('#dlgWelcome').showModal(); $('#wName').focus();
  }
  $('#wSave').onclick = async () => {
    const name = $('#wName').value.trim(); if (!name) { $('#wName').focus(); return; }
    cfg.officer = name; cfg.notice = { ...(cfg.notice || {}), dept: $('#wDept').value.trim(), phone: $('#wPhone').value.trim() };
    await saveCfg(); $('#dlgWelcome').close(); ui.officerTouched = false; render();
    if (cfg.apiKey && cfg.insttNm) fetchContracts(true);
  };

  // 계약 직접 추가·수정
  let editing = null;
  function openContract(c) {
    editing = c || null;
    $('#ctTitle').textContent = c ? '계약 수정' : '계약 직접 추가';
    $('#ctType').value = c ? c.type : '공사'; $('#ctNo').value = c ? c.no || '' : ''; $('#ctName').value = c ? c.name || '' : '';
    $('#ctVendor').value = c ? c.vendor || '' : ''; $('#ctAmount').value = c && c.amount ? Number(c.amount).toLocaleString('ko-KR') : '';
    const iso = (s) => { const d = L.fmtDate(s); return d ? d.replace(/\./g, '-') : ''; };
    $('#ctStart').value = c ? iso(c.startDate) : ''; $('#ctEnd').value = c ? iso(c.endDate) : '';
    $('#ctArchive').hidden = !c; $('#ctDelete').hidden = !c || c.source === 'api';
    $('#dlgContract').showModal(); $('#ctName').focus();
  }
  $('#ctSave').onclick = async () => {
    const name = $('#ctName').value.trim(); if (!name) { $('#ctName').focus(); return; }
    const v = { type: $('#ctType').value, no: $('#ctNo').value.trim(), name, vendor: $('#ctVendor').value.trim(),
      amount: Number($('#ctAmount').value.replace(/[^\d]/g, '')) || 0, startDate: $('#ctStart').value.replace(/-/g, ''), endDate: $('#ctEnd').value.replace(/-/g, '') };
    if (editing) {
      for (const k of Object.keys(v)) if (String(editing[k] || '') !== String(v[k] || '')) { editing[k] = v[k]; editing.edited = { ...(editing.edited || {}), [k]: true }; }
      if (v.no) editing.nums = [...new Set([...(editing.nums || []), v.no])];
      editing.updatedAt = Date.now();
    } else {
      const r = upsertContract({ source: 'manual', ...v, nums: v.no ? [v.no] : [], officer: cfg.officer || '' });
      ui.sel = r.c.key;
    }
    await saveDb(true); $('#dlgContract').close(); render();
  };
  // 계약 지우기(나라장터에서 온 계약이 아닐 때): 그 안 서류는 미분류로 옮기고 계약은 지움(되돌리기 가능)
  async function dropContracts(keys, label) {
    keys = keys.filter((k) => db.contracts[k]); if (!keys.length) return 0;
    const ids = db.docs.filter((d) => keys.includes(d.key)).map((d) => d.id);
    await recorded(label, keys, ids, async () => {
      for (const d of db.docs.filter((x) => keys.includes(x.key))) { try { await moveDoc(d, null, null, false, '', true); } catch (e) { console.warn('미분류로 옮기기 실패', d.name, e); } }
      const dirs = keys.map((k) => folderOf(db.contracts[k]));
      for (const k of keys) delete db.contracts[k];
      await saveDb(true);
      for (const dir of dirs) { try { await S.removeEmptyDir(dir); } catch (_) { /* 남아도 됨 */ } }
    });
    if (keys.includes(ui.sel)) ui.sel = null;
    logAct(`${label}: ${keys.length}건, 서류 ${ids.length}개는 미분류로`);
    render(); return ids.length;
  }
  const junkContracts = () => Object.values(db.contracts).filter((c) => c && c.source === 'doc' && !L.goodName(c.name) && !(c.nums || []).some((n) => L.isG2bNo(n)));
  $('#ctDelete').onclick = async () => {
    if (!editing || editing.source === 'api') return;
    const n = docsOf(editing.key).length;
    if (!confirm(`「${editing.name}」 계약을 지울까요?${n ? ` 그 안 서류 ${n}개는 미분류로 옮깁니다.` : ''} (최근 작업에서 되돌릴 수 있습니다)`)) return;
    const k = editing.key; $('#dlgContract').close();
    const m = await dropContracts([k], '계약 지우기');
    toast(`계약을 지웠습니다.${m ? ` 서류 ${m}개는 미분류에 있습니다.` : ''}`, 'ok', undoAction());
  };
  $('#ctArchive').onclick = async () => {
    if (!editing || !confirm('이 계약을 목록에서 숨길까요? 저장된 서류 파일은 그대로 남습니다.')) return;
    editing.archived = true; await saveDb(true); $('#dlgContract').close(); ui.sel = null; render();
  };
  // 지출 처리
  function openPay(c, title) {
    editing = c; $('#payTitle').textContent = title || '지출 처리';
    $('#payDate').value = c.paidDate ? L.fmtDate(c.paidDate).replace(/\./g, '-') : new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    $('#payMemo').value = c.payMemo || ''; $('#payUndo').hidden = !c.paidDate;
    $('#dlgPay').showModal();
  }
  const touch = () => { const c = db.contracts[ui.sel]; if (c) c.updatedAt = Date.now(); };
  const payWhat = () => { const c = db.contracts[ui.sel]; return c && editing !== c && editing.kind ? `${L.roundLabel(editing)} (${c.name})` : (c ? c.name : ''); };
  $('#paySave').onclick = () => recorded(`지출 처리 ${payWhat()}`, [ui.sel], [], async () => { editing.paidDate = $('#payDate').value.replace(/-/g, ''); editing.payMemo = $('#payMemo').value.trim(); editing.updatedAt = Date.now(); touch(); await saveDb(true); $('#dlgPay').close(); render(); });
  $('#payUndo').onclick = () => recorded(`지출 처리 취소 ${payWhat()}`, [ui.sel], [], async () => { editing.paidDate = ''; editing.payMemo = ''; touch(); await saveDb(true); $('#dlgPay').close(); render(); });

  document.addEventListener('toggle', (e) => { const d = e.target; if (d.matches && d.matches('details.round[data-round]')) ui.roundOpen = { ...(ui.roundOpen || {}), [d.dataset.round]: d.open }; }, true);
  document.addEventListener('input', (e) => {
    const t = e.target.closest('[data-memo]'); if (!t) return;
    const c = ui.sel && db.contracts[ui.sel]; if (!c) return;
    c.memo = { ...(c.memo || {}), [t.dataset.memo]: t.value }; c.memoAt = new Date().toISOString();
    if (t.tagName === 'TEXTAREA') { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }
    const s = $('#memoState'); if (s) s.textContent = '저장 중…';
    saveDb().then(() => { const s2 = $('#memoState'); if (s2) s2.textContent = '저장됨 · 이 PC에만 저장, 인쇄본에는 들어가지 않습니다'; });
  });
  document.addEventListener('change', (e) => {
    const te = e.target.closest && e.target.closest('[data-chgetc]');
    if (te) { const c = db.contracts[ui.sel]; if (!c) return; const ce = { ...((c.memo || {}).chgEtc || {}) }; if (te.value.trim()) ce[te.dataset.chgetc] = te.value.trim(); else delete ce[te.dataset.chgetc]; c.memo = { ...(c.memo || {}), chgEtc: ce }; c.memoAt = new Date().toISOString(); saveDb(); return; }
    const t = e.target.closest && e.target.closest('[data-chgkind]'); if (!t) return;
    const c = ui.sel && db.contracts[ui.sel]; if (!c) return;
    const row = ((L.changesOf(c) || {}).rows || []).find((r) => r.no === t.dataset.chgkind);
    const ck = { ...((c.memo || {}).chgKind || {}) };
    if (!t.value || (row && t.value === row.auto)) delete ck[t.dataset.chgkind]; else ck[t.dataset.chgkind] = t.value;
    c.memo = { ...(c.memo || {}), chgKind: ck }; c.memoAt = new Date().toISOString();
    saveDb().then(() => render());
  });
  document.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('[data-memo]')) renderList(); });
  document.addEventListener('toggle', (e) => {
    const d = e.target; if (!d.dataset || !d.dataset.card) return;
    cardOpen[d.dataset.card] = d.open; if (d.dataset.audit) ui.auditOpen = d.open;
    try { localStorage.setItem('jh.cards', JSON.stringify(cardOpen)); } catch (_) { /* 기억 못 해도 됨 */ }
  }, true);
  // 어디서든 / 를 누르면 계약 찾기, Esc로 지움
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === '/' && !typing && !document.querySelector('dialog[open]') && MOD[ui.view] === 'jichul') { e.preventDefault(); if (ui.view !== 'contracts') setView('contracts'); $('#q').focus(); $('#q').select(); }
    if (e.key === 'Escape' && document.activeElement === $('#q') && $('#q').value) { $('#q').value = ''; ui.q = ''; renderList(); }
  });
  // 바꾸는 작업은 되돌릴 수 있게 감쌈(작업 전 상태를 떠 둠). 서류가 다른 칸·계약으로 가면 어디로 갔는지 알림 + [되돌리기]
  const ACT_LABEL = { unalso: '묶음 파일 표시 빼기', recvall: '빠진 서류 모두 받음 표시', budget: '예산 구분 바꿈', budgetauto: '예산 구분 자동으로', payauto: '지출요청일 자동으로', roundadd: '지출 회차 만들기', rpayauto: '회차 지출요청일 자동으로', rdel: '지출 회차 지우기', del: '서류 빼기' };
  const CHG_LABEL = { noprint: '인쇄 체크', via: '감독관 경유 체크', rvia: '감독관 경유 체크', recv: '받음 체크', rrecv: '받음 체크', orig: '원본 체크', validset: '유효기간 날짜 고침', docdate: '서류 날짜 고침', payplan: '지출요청일 고침', rpayplan: '회차 지출요청일 고침', rmonth: '노무비 월 고침', moveitem: '서류 종류 바꿈', assign: '서류를 계약으로 옮김', docpay: '서류 회차 바꿈' };
  const docLabel = (id) => { const d = id && docById(id); return d ? `「${d.name}」 ` : ''; };
  const whereOf = (d) => { if (!d) return ''; const c = d.key && db.contracts[d.key]; if (!c) return '미분류'; const it = d.itemId && classList(c).find((x) => x.id === d.itemId); const r = d.pay && roundById(c, d.pay); return `${c.name}${r ? ' · ' + L.roundLabel(r) : ''} · ${it ? it.name : '종류 미정'}`; };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]'); const act = t && t.dataset.act;
    if (!act || !ACT_LABEL[act] || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && e.type === 'click')) return onAct(e);
    const c = ui.sel && db.contracts[ui.sel];
    return recorded(docLabel(t.dataset.doc) + ACT_LABEL[act] + (c ? ` (${c.name})` : ''), [c && c.key], [t.dataset.doc], () => onAct(e));
  });
  document.addEventListener('change', (e) => {
    const t = e.target, act = t.dataset && t.dataset.act;
    if (!act || !CHG_LABEL[act]) return onChange(e);
    const d = t.dataset.doc && docById(t.dataset.doc), before = d ? whereOf(d) : '';
    const keys = [ui.sel, d && d.key, act === 'assign' ? t.value : null];
    const moving = act === 'moveitem' || act === 'assign' || act === 'docpay';
    return recorded(docLabel(t.dataset.doc) + CHG_LABEL[act], keys, [t.dataset.doc], async () => {
      await onChange(e);
      // 서류가 화면에서 사라져 어디 갔는지 모르는 일이 없게
      if (moving && d) {
        const nd = docById(d.id), after = whereOf(nd); logAct(`「${d.name}」 ${before} → ${after}`);
        // 서류 종류를 손으로 고치면 그것도 배움(다음부터 같은 제목이면 그 칸으로)
        let learned = '';
        if (act === 'moveitem' && nd && nd.key && nd.itemId) { delete nd.unsure; delete nd.alts; learned = learnFrom(nd, db.contracts[nd.key], nd.itemId); if (learned) await saveDb(true); }
        if (act !== 'assign') toast(`「${d.name}」 → ${after}${learned ? ' · ' + learned : ''}`, 'ok', undoAction());
      }
    });
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') && !document.querySelector('dialog[open]')) { e.preventDefault(); undo(); }
  });
  $('#btnUndo').onclick = () => undo();
  // 종료: 프로그램(뒤의 연결 창구)까지 끔. 다른 창(공고문 창)도 같이 닫힘
  $('#btnExit').onclick = async () => {
    if (!confirm(ROLE === 'notice' ? '프로그램을 끌까요? 원래 창도 같이 꺼집니다. (이 창만 닫으려면 오른쪽 위 X)' : '프로그램을 끌까요? 다시 쓰려면 바탕화면의 계약업무 도우미를 누르세요.')) return;
    try { await saveDb(true); } catch (_) {}
    try { await S.quit(); } catch (_) {}
    window.close(); setTimeout(() => banner('프로그램을 껐습니다. 이 창을 닫아 주세요.'), 500);
  };
  // 공고문을 새 창으로: 공고문 전용 창을 열고 이 창은 계약 서류 쪽으로
  $('#btnNoticeWin').onclick = async () => {
    try { await S.openNoticeWindow(); ui.noticeElsewhere = true; $('#view-notice').classList.add('locked'); setView('contracts'); toast('공고문 창을 따로 열었습니다. 이 창에서는 계약 서류를 계속 다루세요. 공고문 창을 닫으면 여기서도 이어서 씁니다.', 'ok'); }
    catch (e) { toast('새 창을 열지 못했습니다: ' + e.message, 'err'); }
  };
  // 금액 칸(숫자 입력 칸)은 치는 대로 세 자리마다 쉼표(커서 자리는 그대로). 다른 처리보다 먼저 하도록 capture
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'INPUT' || t.getAttribute('inputmode') !== 'numeric' || e.isComposing) return;
    if (t.hasAttribute('data-date')) return dateInput(t);
    const v = t.value, pos = t.selectionStart == null ? v.length : t.selectionStart;
    const digitsBefore = v.slice(0, pos).replace(/[^\d]/g, '').length;
    const d = v.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
    const f = d ? d.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
    if (f === v) return;
    t.value = f;
    let i = 0, n = 0; while (i < f.length && n < digitsBefore) { if (/\d/.test(f[i])) n++; i++; }
    try { t.setSelectionRange(i, i); } catch (_) {}
  }, true);
  // 날짜 칸: 숫자만 쳐도 2026-10-23 꼴로(달력에서 고르지 않아도 됨). 다 치고 나가면(바뀜) 맞는 날짜인지 확인
  function dateInput(t) {
    const v = t.value, pos = t.selectionStart == null ? v.length : t.selectionStart;
    const digitsBefore = v.slice(0, pos).replace(/[^\d]/g, '').length;
    const d = v.replace(/[^\d]/g, '').slice(0, 8);
    const f = d.slice(0, 4) + (d.length > 4 ? '-' + d.slice(4, 6) : '') + (d.length > 6 ? '-' + d.slice(6, 8) : '');
    if (f === v) return;
    t.value = f;
    let i = 0, n = 0; while (i < f.length && n < digitsBefore) { if (/\d/.test(f[i])) n++; i++; }
    try { t.setSelectionRange(i, i); } catch (_) {}
  }
  function dateFix(raw) {
    let d = String(raw || '').replace(/[^\d]/g, '');
    if (!d) return '';
    if (d.length === 6) d = '20' + d; // 261023
    else if (d.length === 4) d = String(new Date().getFullYear()) + d; // 1023 → 올해
    if (d.length !== 8) return null;
    const y = +d.slice(0, 4), m = +d.slice(4, 6), dd = +d.slice(6, 8);
    const dt = new Date(y, m - 1, dd);
    if (y < 1990 || y > 2100 || dt.getMonth() !== m - 1 || dt.getDate() !== dd) return null;
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  document.addEventListener('change', (e) => {
    const t = e.target; if (!t || !t.hasAttribute || !t.hasAttribute('data-date')) return;
    const f = dateFix(t.value);
    if (f === null) { toast(`날짜를 알아보지 못했습니다: ${t.value} — 20261023처럼 8자리로 넣어 주세요.`, 'err'); t.value = ''; }
    else t.value = f;
  }, true);
  $('#btnLog').onclick = () => openLog();
  $('#logUndo').onclick = async () => { $('#dlgLog').close(); await undo(); };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b && !b.disabled && !b.closest('dialog')) setView(b.dataset.view); });
  $('#btnNewNotice').onclick = () => { setView('notice'); JH.notice.create(); };
  $('#contractList').addEventListener('click', (e) => { const it = e.target.closest('.citem'); if (it) { ui.sel = it.dataset.key; render(); } });
  $('#contractList').addEventListener('keydown', (e) => {
    const it = e.target.closest('.citem'); if (!it) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.sel = it.dataset.key; render(); $(`.citem[data-key="${CSS.escape(ui.sel)}"]`).focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = e.key === 'ArrowDown' ? it.nextElementSibling : it.previousElementSibling; if (n) n.focus(); }
  });
  $('#view-board').addEventListener('click', (e) => {
    const ch = e.target.closest('[data-board]'); if (ch) { ui.board = ch.dataset.board; renderBoard(); return; }
    const tr = e.target.closest('tr[data-key]'); if (tr) { ui.sel = tr.dataset.key; setView('contracts'); }
  });
  $('#q').addEventListener('input', (e) => { ui.q = e.target.value; renderList(); });
  $('#fOfficer').addEventListener('change', (e) => { ui.officer = e.target.value; ui.officerTouched = true; ui.sel = null; render(); });
  $('#fType').addEventListener('change', (e) => { ui.type = e.target.value; ui.sel = null; render(); });
  $('#fSort').value = ui.sort;
  // 목록 너비 조절: 경계를 끌면 목록이 넓어지고(긴 이름이 더 보임), 이 PC에 기억. 두 번 누르거나 Home 키로 원래대로
  // 좁은 창(화면 분할 등): 1000px보다 좁으면 화면 전체를 비율대로 줄여 두 칸 그대로 보이게(아래로 쌓여 스크롤하지 않게).
  // 설정 → 정보의 '좁은 창에서 줄여 보기'로 끌 수 있음. Ctrl + 마우스 휠 확대·축소는 따로 그대로 됨
  const FIT_W = 1000, FIT_MIN = 0.62;
  function fitWindow() {
    const on = !cfg || cfg.autoFit !== false;
    const w = window.innerWidth || FIT_W;
    const z = on && w < FIT_W ? Math.max(FIT_MIN, Math.floor((w / FIT_W) * 100) / 100) : 1;
    document.documentElement.style.zoom = z === 1 ? '' : String(z);
    document.documentElement.classList.toggle('fitted', z !== 1);
  }
  window.addEventListener('resize', () => { clearTimeout(fitWindow.t); fitWindow.t = setTimeout(fitWindow, 80); });
  fitWindow();
  (function splitters() {
    const DEF = { contracts: 360, notice: 300 };
    const keyOf = (k) => 'jh.listW.' + k;
    const apply = (view, k, w) => {
      if (w) view.style.setProperty('--list-w', w + 'px'); else view.style.removeProperty('--list-w');
      view.classList.toggle('wide-list', (w || DEF[k]) >= 440);
    };
    const clamp = (view, w) => Math.round(Math.max(240, Math.min(w, view.clientWidth * 0.7 || w)));
    document.querySelectorAll('.splitter[data-split]').forEach((sp) => {
      const k = sp.dataset.split, view = sp.closest('.view');
      let saved = 0; try { saved = +localStorage.getItem(keyOf(k)) || 0; } catch (_) { /* 기억 못 해도 됨 */ }
      apply(view, k, saved);
      const store = (w) => { try { if (w) localStorage.setItem(keyOf(k), String(w)); else localStorage.removeItem(keyOf(k)); } catch (_) { /* 기억 못 해도 됨 */ } };
      sp.addEventListener('pointerdown', (e) => {
        e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add('drag'); document.body.classList.add('resizing');
        const left = view.getBoundingClientRect().left;
        const z = parseFloat(document.documentElement.style.zoom) || 1; // 좁은 창에서 줄여 보일 때
        const move = (ev) => apply(view, k, clamp(view, (ev.clientX - left) / z));
        const up = () => { sp.releasePointerCapture(e.pointerId); sp.classList.remove('drag'); document.body.classList.remove('resizing'); sp.removeEventListener('pointermove', move); store(parseInt(view.style.getPropertyValue('--list-w'), 10) || 0); };
        sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up, { once: true }); sp.addEventListener('pointercancel', up, { once: true });
      });
      sp.addEventListener('dblclick', () => { apply(view, k, 0); store(0); });
      sp.addEventListener('keydown', (e) => {
        const curW = parseInt(view.style.getPropertyValue('--list-w'), 10) || DEF[k];
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const w = clamp(view, curW + (e.key === 'ArrowRight' ? 40 : -40)); apply(view, k, w); store(w); }
        else if (e.key === 'Home') { e.preventDefault(); apply(view, k, 0); store(0); }
      });
    });
  })();
  $('#fSort').addEventListener('change', (e) => { ui.sort = e.target.value; try { localStorage.setItem('jh.sort', ui.sort); } catch (_) { /* 저장 못 해도 이번엔 적용 */ } renderList(); });
  $('#fState').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { ui.state = b.dataset.state; ui.sel = null; render(); } });
  $('#btnAdd').onclick = () => { pickTarget = null; $('#fileIn').click(); };
  // 새로고침: 나라장터 계약 목록 + 계약 폴더 다시 읽기(탐색기에서 직접 넣은·옮긴·지운 파일 반영)
  $('#btnFetch').onclick = async () => {
    try { await fetchContracts(); } catch (e) { console.warn(e); }
    try { progress('계약 폴더 다시 읽는 중', .5); await reconcile(); } catch (e) { console.warn('폴더 확인 실패', e); } finally { progress(null); render(); }
  };
  $('#btnNewContract').onclick = () => openContract(null);
  let pickTarget = null;
  $('#fileIn').onchange = (e) => { const fs = [...e.target.files]; e.target.value = ''; const p = pickTarget || {}; pickTarget = null; ingest(fs, p.key || null, p.item || null, p.pay ? { pay: p.pay } : {}); };

  // 끌어다 놓기: 서류 줄이면 그 계약·그 서류로, 업로드 칸이면 그 계약으로, 아니면 자동 분류
  // 놓는 곳: 왼쪽 목록의 계약 → 그 계약, 계약 화면의 서류 줄·놓는 칸 → 그 계약(그 서류), 규정·질문 화면 → 규정 파일, 공고문 화면 → 공고문 파일, 그 밖 → 전체 계약에서 찾아 정리
  const dropTarget = (e) => {
    if (!e.target || !e.target.closest) return { kind: 'all' };
    if (!ONLY) {
      const ci = e.target.closest('.citem[data-key]');
      if (ci && db.contracts[ci.dataset.key]) return { el: ci, key: ci.dataset.key, kind: 'contract' };
      if (ui.view === 'contracts' && ui.sel) {
        const row = e.target.closest('#detail [data-drop-item]'); if (row) return { el: row, key: ui.sel, item: row.dataset.dropItem, pay: row.dataset.dropPay || null, kind: 'contract' };
        const di = e.target.closest('#dropin'); if (di) return { el: di, key: ui.sel, kind: 'contract' };
      }
    }
    if (ui.view === 'rules') return { kind: 'rules' };
    if (ui.view === 'notice' && !$('#view-notice').classList.contains('locked')) return { kind: 'notice' };
    return ONLY ? { kind: 'none' } : { kind: 'all' };
  };
  const DROP_TEXT = {
    all: ['놓으면 자동으로 정리합니다', '내용을 읽어 계약 건과 서류 종류를 찾습니다 (특정 계약에 넣으려면 왼쪽 목록의 그 계약 위에 놓으세요)'],
    rules: ['놓으면 규정 자료로 올립니다', '한글·PDF·워드·텍스트 규정 파일 — 조 단위로 나눠 찾을 수 있게 합니다'],
    notice: ['놓으면 공고문으로 배웁니다', '나라장터에서 내려받은 공고문(한글·PDF) — 지금 쓰는 공고문의 참고로 씁니다'],
    none: ['이 창에서는 받을 수 없습니다', '계약 서류는 원래 창에 놓아 주세요'],
  };
  const showDrop = (tg) => {
    const box = !tg.el; $('#dropOverlay').hidden = !box;
    if (box) { const [a, b] = DROP_TEXT[tg.kind] || DROP_TEXT.all; $('#dropTitle').textContent = a; $('#dropSub').textContent = b; }
  };
  const clearOver = () => $$('.over').forEach((x) => x.classList.remove('over'));
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#dropOverlay').hidden = false; });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; clearOver(); } });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return; e.preventDefault();
    const tg = dropTarget(e); clearOver(); if (tg.el) tg.el.classList.add('over');
    showDrop(tg);
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; $('#dropOverlay').hidden = true;
    const tg = dropTarget(e); clearOver();
    const files = await collectDropped(e.dataTransfer);
    if (tg.kind === 'none') { toast('공고문 창에서는 계약 서류를 받지 않습니다. 원래 창에 놓아 주세요.', 'err'); return; }
    if (tg.kind === 'rules') { const fs = files.filter((f) => /\.(hwpx?|pdf|docx|txt)$/i.test(f.name)); if (fs.length) JH.rules.uploadRules(fs); if (fs.length < files.length) toast('규정 자료는 한글·PDF·워드·텍스트 파일만 받습니다.', 'err'); return; }
    if (tg.kind === 'notice') { const fs = files.filter((f) => /\.(hwpx?|pdf)$/i.test(f.name)); if (fs.length) JH.notice.uploadNotices(fs); if (fs.length < files.length) toast('공고문은 한글·PDF 파일만 받습니다.', 'err'); return; }
    if (tg.kind === 'contract') { const c = db.contracts[tg.key]; if (c && !tg.item) toast(`「${c.name}」 계약에 넣습니다.`); }
    ingest(files, tg.key || null, tg.item || null, tg.pay ? { pay: tg.pay } : {});
  });
  async function collectDropped(dt) {
    const entries = dt.items ? [...dt.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean) : [];
    if (!entries.length) return [...dt.files];
    const out = [];
    const walk = async (en) => {
      if (en.isFile) { try { out.push(await new Promise((r, j) => en.file(r, j))); } catch (_) {} }
      else if (en.isDirectory) { const rd = en.createReader(); let b; do { b = await new Promise((r, j) => rd.readEntries(r, j)); for (const c of b) await walk(c); } while (b.length); }
    };
    for (const en of entries) await walk(en);
    return out;
  }

  // ---------- 시작 ----------
  async function start() {
    if (JH.demo && JH.demo.ready) { try { await JH.demo.ready; } catch (_) {} }
    if (!S.online) {
      banner('이 화면은 바탕화면의 <b>계약업무 도우미</b> 아이콘으로 실행해야 서류를 저장하고 나라장터에 연결할 수 있습니다.', true);
      setView(ui.view); return;
    }
    try {
      const info = await pingWin();
      if (ONLY) { document.body.classList.add('only-notice'); document.title = '공고문 작성 — 계약업무 도우미'; ui.view = 'notice'; }
      try { const r = await fetch('org.json', { cache: 'no-store' }); if (r.ok) org = await r.json(); } catch (_) {}
      // 설정·서류대장·서류 본문을 한꺼번에 요청(차례로 기다리지 않음)
      const [cfg0, saved0, tx0] = await Promise.all([S.readJson(CFG_PATH), S.readJson(DB_PATH).catch((e) => { console.warn('서류대장 읽기 실패', e); return null; }), S.readJson(TEXT_PATH).catch(() => null)]);
      cfg = mergeCfg(cfg0 || {}); fitWindow();
      let saved = saved0, fromBackup = false;
      if (!(saved && saved.contracts)) {
        // 저장 중에 끊겨 망가졌으면 지난번 켤 때 떠 둔 백업으로
        let bk = null; try { bk = await S.readJson(BACKUP_PATH); } catch (_) { /* 없음 */ }
        if (bk && bk.contracts) { saved = bk; fromBackup = true; }
      }
      if (saved && saved.contracts) {
        db = { ...db, ...saved };
        // 서류 본문(글자)은 따로 둔 파일에서 붙임(예전 버전 파일은 서류대장 안에 그대로 있음)
        const tx = tx0;
        if (tx) { for (const d of db.docs) if (!('text' in d) && tx[d.id]) d.text = tx[d.id]; }
        else if (db.docs.some((d) => d.text)) textDirty = true; // 예전 형식(본문이 서류대장 안에) → 다음 저장 때 본문 파일을 만듦
        // 백업은 화면을 그린 뒤에(켜기를 늦추지 않음)
        if (!ONLY) setTimeout(() => S.writeJson(BACKUP_PATH, dbForSave(), true).catch(() => {}), 1500);
        if (fromBackup) { toast('서류대장 파일이 망가져 있어 지난번 백업으로 열었습니다. 마지막에 한 일 몇 가지가 빠졌을 수 있습니다.', 'err'); saveDb(true); }
      }
      mergeSameContracts();
      // 서류 목록이 바뀌면(2: 대금청구에 완납증명서·지역개발채권, 착공계 손해배상공제·노무비 개인정보 동의서, 준공계 하자보수보증서)
      // 저장해 둔 목록에 새 기본 목록을 넣고, 직접 추가한 서류는 그대로 둠
      if (db.checklists && db.checklistsVer !== CHECKLIST_VER) {
        const fresh = {};
        const OLD_DEFAULT = /^[csg]-(req|contract|estimate|related|start|agent|laborconfirm|roster|insjoin|empjoin|finish|photo|inspaid|nounpaid|laborlist|emppaid|defect|security|result|spec|inspect|claim|bank|tax|ltax|invoice|pay)$/;
        for (const t of Object.keys(defaults)) { const ids = new Set(defaults[t].map((x) => x.id)); fresh[t] = [...defaults[t], ...((db.checklists[t] || []).filter((x) => !ids.has(x.id) && !OLD_DEFAULT.test(x.id)))]; }
        db.checklists = fresh; db.checklistsVer = CHECKLIST_VER; saveDb(true);
      } else if (!db.checklists) db.checklistsVer = CHECKLIST_VER;
      JH.settings.setInfo(info);
      // 자동으로 읽을 폴더가 정해져 있으면 보기 시작(고른 뒤에 들어온 파일만 — 고를 때 있던 파일은 설정에서 '본 것'으로 둠)
      if (!ONLY) startWatch(info.watchDirs || []);
      if (info.relocated) toast(`데이터 폴더가 옮겨진 것을 찾았습니다: ${info.dataDir}`, 'ok');
      if (info.lost) banner(`예전 데이터 폴더(${esc(info.oldDir)})를 찾지 못해 임시로 새 폴더를 쓰고 있습니다. <button class="link" id="bannerFind">옮긴 폴더 고르기</button>`, true);
      const bf = $('#bannerFind'); if (bf) bf.onclick = async () => { const r = await S.pickFolder(); if (r.ok) location.reload(); };
      if (!cfg.apiKey && !info.lost) banner('설정에서 나라장터 인증키와 기관명을 넣으면 내 담당 계약을 자동으로 불러옵니다. <button class="link" id="bannerSet">설정 열기</button>');
      const b = $('#bannerSet'); if (b) b.onclick = () => JH.settings.open('nara');
    } catch (e) { banner('연결 창구와 통신하지 못했습니다: ' + esc(e.message), true); }
    try { await JH.notice.load(); } catch (_) {}
    setView(ui.view);
    initTabs(); // 지난번에 열어 둔 탭들(이 PC에 기억)
    setInterval(() => { pingWin().catch(() => banner('연결 창구가 꺼졌습니다. 바탕화면의 바로가기로 다시 실행해 주세요.', true)); }, 20000);
    if (ONLY) return; // 공고문 전용 창: 폴더 확인·정리·자동 새로고침은 원래 창이 함
    try { await reconcile(); render(); } catch (e) { console.warn('폴더 확인 실패', e); }
    try { await relayout(); } catch (e) { console.warn('폴더 정리 실패', e); }
    // 스캔 글자가 깨져 이상한 이름으로 만들어진 계약(예전 버전): 알려 주고 [정리하기]로 서류는 미분류, 계약은 지움
    try {
      const junk = junkContracts();
      if (junk.length) setTimeout(() => toast(`서류에서 잘못 읽은 이름으로 만들어진 계약이 ${junk.length}건 있습니다(예: 「${junk[0].name.slice(0, 24)}」). 정리하면 그 안 서류는 미분류로 옮기고 계약은 지웁니다.`, 'err',
        { label: '정리하기', run: async () => { const m = await dropContracts(junkContracts().map((c) => c.key), '잘못 만들어진 계약 정리'); toast(`정리했습니다. 서류 ${m}개는 미분류에서 계약을 골라 주세요.`, 'ok', undoAction()); } }), 1500);
    } catch (e) { console.warn(e); }
    // 계약에는 들어갔는데 종류를 못 정한 서류: 지금 규칙으로 다시 보고, 그래도 남은 것은 알림에서 [확인하기]
    try {
      const n = await applyShared(true);
      const left = db.docs.filter((d) => d.key && db.contracts[d.key] && (!d.itemId || d.unsure)).map((d) => d.id);
      if (n || left.length) { render(); toast((n ? `종류를 못 정했던 서류 ${n}개를 지금 규칙으로 정리했습니다. ` : '') + (left.length ? `종류를 정해야 할 서류가 ${left.length}개 있습니다.` : ''), n ? 'ok' : '', left.length ? { label: '확인하기', run: () => openPreview(left, 0, true) } : undoAction()); }
    } catch (e) { console.warn('다시 정리 실패', e); }
    pullShare(); // 다른 PC가 배운 규칙 받기(뒤에서). 켜 둔 동안에도 30분마다 받고, 못 올린 것은 그때 다시 올림
    setInterval(() => { pullShare(); }, 30 * 60000);
    if (!cfg.officer) openWelcome();
    if (cfg.officer) { checkAccounts().finally(() => autoRefresh(true)); setInterval(() => autoRefresh(false), 5 * 60000); }
  }

  root.JH.app = {
    get cfg() { return cfg; }, get ui() { return ui; }, set cfg(v) { cfg = v; }, get db() { return db; }, get org() { return org; },
    readWatch: (all) => watchTick({ now: true, all: !!all }), countName, get share() { return ui.share; }, get recording() { return recording; }, get undoLabels() { return undoStack.map((u) => u.label); }, pullShare, pushShare, fitWindow, syncTab, shareableRule: (r) => shareable(r, privateNames()),
    defaults, lists, printList, startWatch, checkAccounts, saveCfg, saveDb, fetchContracts, enrichContracts, fillFromDocs, openForms, render, toast, banner, start, ingest, setView, progress,
    setChecklists(v) { db.checklists = v; return saveDb(true); },
  };
  document.addEventListener('DOMContentLoaded', () => {});
  setTimeout(start, 0);
})(window);
