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
  const ui = { view: 'home', sel: null, q: '', officer: '', officerTouched: false, type: '', state: '', board: '', sort: (() => { try { return localStorage.getItem('jh.sort') || 'end-desc'; } catch (_) { return 'end-desc'; } })() };

  const CHECKLIST_VER = 4; // 4: 선금 보증서
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
  function statusOf(c) {
    if (stCache && stCache.has(c.key)) return stCache.get(c.key);
    const st = statusOf0(c); if (stCache) stCache.set(c.key, st); return st;
  }
  function statusOf0(c) {
    const docs = docsOf(c.key);
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
    const docs = docsOf(c.key);
    const pick = (re, kind, label) => docs.filter((d) => re.test(d.itemId || '')).map((d) => ({ date: dateOfDoc(d, kind), label })).filter((x) => x.date);
    const cands = [...pick(/-inspect$/, 'inspect', '준공조서'), ...pick(/-finish$/, 'finish', '준공계')].sort((a, b) => (a.date < b.date ? 1 : -1));
    if (cands[0]) return { date: L.addDays(cands[0].date, 14), how: `${cands[0].label} ${L.fmtDate(cands[0].date)} + 2주` };
    if (c.endDate) return { date: L.addDays(String(c.endDate).replace(/\D/g, '').slice(0, 8), 14), how: `계약 준공일 ${L.fmtDate(c.endDate)} + 2주 (준공계·준공조서가 오면 그 날짜로 바뀜)`, guess: true };
    return null;
  }
  function validity(c) {
    const basis = payBasis(c), docs = docsOf(c.key), out = [];
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
  const saveCfg = () => S.writeJson(CFG_PATH, diffFromOrg(cfg));

  // ---------- 알림·진행 ----------
  function toast(msg, kind, action) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.innerHTML = `<span>${esc(msg)}</span>`;
    if (action) { const b = document.createElement('button'); b.className = 'link'; b.textContent = action.label; b.onclick = () => { action.run(); t.remove(); }; t.append(b); }
    const box = $('#toasts'); box.append(t);
    while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(() => t.remove(), kind === 'err' ? 9000 : 5000);
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
    const inBatch = top.filter((c) => batchKeys.has(c.key));
    if (inBatch.length === 1) return inBatch[0];
    const due = top.filter((c) => !c.paidDate && L.toDate(c.endDate) && L.toDate(c.endDate) <= today());
    if (due.length === 1) return due[0];
    const open = top.filter((c) => !c.paidDate);
    if (open.length === 1) return open[0];
    return null;
  }
  // 정리된 사본의 파일 이름: "서류명_계약명.확장자"(예: 견적서(계약금액)_시청사 옥상 방수공사.pdf). 같은 이름이 있으면 (2), (3)…
  //  원래 이름이 뜻이 있는 이름(noname·scan·숫자·download 같은 것이 아님)이면 뒤에 붙여 둠. 내려받은 원본 파일은 건드리지 않음
  function tidyName(item, c, orig) {
    if (!item) return orig;
    const ext = (String(orig).match(/\.[A-Za-z0-9]{2,5}$/) || [''])[0].toLowerCase();
    const stem = L.stem(orig).trim();
    const junk = /^(noname|scan|scanned|image|img|download|document|file|문서|새\s*문서|제목\s*없음|kakaotalk|캡처|스캔|복사본)?[\s_\-()\d]*$/i.test(stem) || /^(noname|scan|img|image|download|kakaotalk)[\s_\-()\d]*/i.test(stem);
    const itemNm = L.safeName(item.name, 30), cName = c ? L.safeName(c.name || '', 40) : '';
    const keep = !junk && !L.norm(stem).includes(L.norm(itemNm)) ? `_${L.safeName(stem, 40)}` : '';
    return `${itemNm}${cName ? '_' + cName : ''}${keep}${ext}`;
  }
  async function ingest(fileList, forceKey, forceItem, opt = {}) {
    const files = [...fileList].filter((f) => f && f.name && !f.name.startsWith('.') && !/^(thumbs\.db|desktop\.ini)$/i.test(f.name));
    if (!files.length) return;
    if (!S.online) { toast('바탕화면의 "계약업무 도우미" 아이콘으로 실행해야 서류를 저장할 수 있습니다.', 'err'); return; }
    const recs = []; let skipped = 0;
    try {
      // 1) 읽기
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        progress(`내용 읽는 중 ${i + 1}/${files.length}`, i / files.length);
        if (db.docs.some((d) => d.name === f.name && d.size === f.size)) { skipped++; continue; }
        const bytes = new Uint8Array(await f.arrayBuffer());
        const kind = L.kindOf(f.name);
        const { lines, ocr } = await R.read(bytes, kind, f.type);
        recs.push({
          id: L.uid(), name: f.name, kind, size: f.size, mime: f.type, bytes, ocr, lines,
          meta: L.findMeta(lines), text: L.norm(lines.join(' ')).slice(0, 6000), title: L.norm(lines.slice(0, 8).join(' ')).slice(0, 300),
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
        if (!c && (r.meta.no || r.meta.name)) {
          const res = upsertContract({ source: 'doc', type: L.guessType(r.title), name: r.meta.name || L.stem(r.name), vendor: r.meta.vendor,
            nums: r.meta.no ? [r.meta.no] : [], no: r.meta.no, officer: cfg.officer || '' });
          c = res.c; if (res.created) newContracts++;
        }
        if (c) r.key = c.key;
      }
      // 3) 나머지 서류는 내용으로 계약 찾기 → 서류 종류 → 저장
      // 먼저 확실히 한 계약으로 가는 서류를 모아 두고(같이 올린 묶음), 애매한 서류는 그 묶음 계약 쪽으로
      batchKeys = new Set(recs.map((r) => r.key || (() => { const m = L.matchCandidates(contracts(), L.norm(L.stem(r.name)) + '|' + r.text); return m.top.length === 1 ? m.top[0].key : null; })()).filter(Boolean));
      const byContract = {}, auditLines = {}; let inbox = 0, multiForm = 0;
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        progress(`정리하는 중 ${i + 1}/${recs.length}`, i / recs.length);
        let c = forced || (r.key && db.contracts[r.key]) || pickContract(L.norm(L.stem(r.name)) + '|' + r.text, r);
        // 계약 화면에서 [업로드]로 올렸어도(서류 줄 [+ 추가]가 아니면) 다른 계약 서류가 분명하면 그 계약으로 보냄
        //  - 내용·파일 이름에 다른 계약의 번호·이름이 있고, 지금 계약과는 맞지 않을 때만(애매하면 지금 계약)
        if (forced && !forceItem) {
          const hay = L.norm(L.stem(r.name)) + '|' + r.text;
          const m = L.matchCandidates(contracts(), hay);
          if (m.score >= 6 && m.top.length === 1 && m.top[0].key !== forced.key && L.contractScore(forced, hay) < m.score) { c = m.top[0]; r.rerouted = true; }
        }
        let itemId = c ? (forced && forceItem ? forceItem : L.classifyItem(lists(c.type), r.name, r.title)) : null;
        // 한 파일에 여러 양식(착공계 묶음 등): 쪽마다 서류 이름을 찾아 함께 든 서류로 표시
        let also = [], pagesOf = null;
        if (c) {
          try {
            progress(`여러 양식이 든 파일인지 보는 중 ${i + 1}/${recs.length}`, i / recs.length);
            const heads = await R.pageHeads(r.bytes, r.kind);
            pagesOf = heads ? L.classifyPages(lists(c.type), heads) : r.kind === 'hwp' ? L.classifyTitleLines(lists(c.type), r.lines) : null;
          } catch (e) { console.warn('쪽별 서류 찾기 실패', e); }
          // 파일 이름에 서류가 여럿이면(견적서_산출내역.pdf) 그것도 함께 든 서류로
          const named = forced && forceItem ? [] : L.itemsInName(lists(c.type), r.name);
          if (named.length > 1) { pagesOf = pagesOf || {}; for (const id of named) if (!pagesOf[id]) pagesOf[id] = []; }
          if (pagesOf) {
            const ids = Object.keys(pagesOf);
            if (!itemId && ids.length) itemId = ids.sort((a, b) => ((pagesOf[a][0] || 999) - (pagesOf[b][0] || 999)))[0];
            also = ids.filter((id) => id !== itemId);
          }
        }
        // 내려받은 폴더에서 온 파일: 우리 계약과 맞지 않으면(다른 공고문·개인 파일 등) 가져오지 않음
        if (opt.onlyMatched && !c) { r.ignored = true; continue; }
        const item = c && itemId ? lists(c.type).find((x) => x.id === itemId) : null;
        const dir = c ? folderOf(c) : INBOX;
        const fname = tidyName(item, c, r.name);
        const saved = await S.save(dir, fname, r.bytes);
        textDirty = true; db.docs.push({
          id: r.id, key: c ? c.key : null, itemId: item ? item.id : null, path: saved.path, name: r.name, kind: r.kind,
          size: r.size, mime: r.mime, addedAt: new Date().toISOString(), ocr: r.ocr, meta: r.meta, text: r.text, title: r.title, dates: r.dates, manual: !!forced && !r.rerouted, facts: L.docFacts(r.lines),
          ...(also.length ? { also, pagesOf } : {}),
        });
        if (c) { byContract[c.key] = (byContract[c.key] || 0) + 1; c.updatedAt = Date.now(); } else inbox++;
        if (c && item && (AUDIT_DOC.test(item.id) || also.some((id) => AUDIT_DOC.test(id)))) (auditLines[c.key] = auditLines[c.key] || []).push(r.lines);
        if (also.length) multiForm++;
      }
      // 3-1) 견적서·설계내역서·사업자등록증 등에서 감사·검사 칸(예정가격·설계금액·주소·대표자)을 바로 채움(비어 있을 때만)
      let auditFilled = 0;
      for (const [k, ls] of Object.entries(auditLines)) auditFilled += fillAuditFrom(db.contracts[k], ls);
      await saveDb(true);
      // 4) 알림
      const parts = Object.entries(byContract).map(([k, n]) => `${db.contracts[k].name} ${n}`);
      if (inbox) parts.push(`미분류 ${inbox}`);
      const ignored = recs.filter((r) => r.ignored).length;
      if (opt.onlyMatched && ignored === recs.length) { if (ignored) console.info(`${opt.from}: 계약과 상관없는 파일 ${ignored}개 건너뜀`); return; }
      let msg = (opt.from ? `${opt.from}에서 ` : '') + `${recs.length - ignored}개 정리했습니다` + (parts.length ? ` — ${parts.join(', ')}` : '') + '.';
      if (ignored) msg += ` 우리 계약과 상관없는 파일 ${ignored}개는 가져오지 않았습니다.`;
      if (newContracts) msg += ` 계약서에서 새 계약 ${newContracts}건을 만들었습니다.`;
      if (auditFilled) msg += ` 서류에서 감사·검사 칸 ${auditFilled}개를 채웠습니다.`;
      if (multiForm) msg += ` 여러 양식이 든 파일 ${multiForm}개는 안에 든 서류마다 표시했습니다.`;
      const moved = recs.filter((r) => r.rerouted).length;
      if (moved) msg += ` ${moved}개는 내용이 다른 계약 서류라 그 계약으로 보냈습니다.`;
      if (skipped) msg += ` 이미 있는 파일 ${skipped}개는 건너뛰었습니다.`;
      if (R.ocrBroken) msg += ' 스캔본 글자 인식을 시작하지 못해 일부는 미분류로 갔습니다.';
      toast(msg, inbox ? '' : 'ok', inbox ? { label: '미분류 보기', run: () => setView('inbox') } : null);
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
  async function moveDoc(d, key, itemId, manual = true) {
    const c = key ? db.contracts[key] : null;
    const list = c ? lists(c.type) : [];
    const item = itemId ? list.find((x) => x.id === itemId) : null;
    const dir = c ? folderOf(c) : INBOX;
    const name = tidyName(item, c, d.name);
    const r = await S.move(d.path, dir, name);
    d.path = r.path;
    if (d.pdfPath) { try { const p = await S.move(d.pdfPath, dir, L.stem(name) + '.pdf'); d.pdfPath = p.path; } catch (_) { d.pdfPath = ''; } }
    d.key = c ? c.key : null; d.itemId = item ? item.id : null; d.manual = manual;
    if (c) c.updatedAt = Date.now();
    await saveDb(true);
  }
  async function removeDoc(d) {
    await S.remove(d.path); if (d.pdfPath) { try { await S.remove(d.pdfPath); } catch (_) {} }
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
      await moveDoc(d, c.key, L.classifyItem(lists(c.type), d.name, d.title), false); moved++;
    }
    return moved;
  }

  // ---------- 폴더 정리 상태 맞추기 ----------
  // 탐색기에서 계약 폴더 이름을 바꾸거나 옮긴 파일을 이름·크기로 다시 찾고, 직접 넣은 파일은 읽어서 분류
  const DOC_EXT = /\.(pdf|jpe?g|png|gif|bmp|webp|hwpx?|xlsx|xls|docx)$/i;
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
      const top = [...dirs.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && /^계약\//.test(top[0]) && top[0] !== c.folder) c.folder = top[0];
    }
    // 직접 넣은 파일(기록에 없는 것)
    const known = new Set(db.docs.flatMap((d) => [d.path, d.pdfPath].filter(Boolean)));
    const unknown = all.filter((f) => !known.has(f.path));
    let added = 0;
    for (let i = 0; i < unknown.length; i++) {
      const f = unknown[i];
      progress(`폴더에 새로 넣은 파일 읽는 중 ${i + 1}/${unknown.length}`, i / unknown.length);
      const name = base(f.path), kind = L.kindOf(name), dir = f.path.split('/').slice(0, -1).join('/');
      // 한글을 PDF로 바꾼 파일이면 그 한글 서류에 연결
      if (kind === 'pdf') { const twin = db.docs.find((d) => (d.kind === 'hwp' || d.kind === 'other') && d.path.replace(/\.(hwpx?|xlsx?|docx?)$/i, '.pdf') === f.path); if (twin) { twin.pdfPath = f.path; continue; } }
      try {
        const bytes = await S.readBytes(f.path);
        const { lines, ocr } = await R.read(bytes, kind);
        const text = L.norm(lines.join(' ')).slice(0, 6000), title = L.norm(lines.slice(0, 8).join(' ')).slice(0, 300);
        let c = contracts().find((x) => x.folder && (dir === x.folder || dir.startsWith(x.folder + '/'))) || L.matchContract(contracts(), L.norm(L.stem(name)) + '|' + text);
        const doc = { id: L.uid(), key: c ? c.key : null, itemId: c ? L.classifyItem(lists(c.type), name, title) : null, path: f.path, name, kind, size: f.size,
          addedAt: new Date().toISOString(), ocr, meta: L.findMeta(lines), text, title, dates: L.extractDates(lines), manual: false };
        db.docs.push(doc); textDirty = true; added++;
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
      toast(parts.join('. ') + '.', missing ? 'err' : 'ok');
    }
  }

  // ---------- 자동으로 읽을 폴더(내려받는 곳, 여러 개) ----------
  // 몇 초마다 폴더를 보고, 새 파일이 다 받아졌으면(크기가 두 번 연속 같으면) 읽어서 계약별로 정리. 원래 파일은 그대로 두고 사본을 정리
  // 다운로드 폴더처럼 계약과 상관없는 파일도 섞인 곳이라, 우리 계약에 맞는 파일만 가져오고 나머지는 미분류에 쌓지 않고 건너뜀
  const watch = { dirs: [], last: new Map(), busy: false, timer: null };
  const watchSig = (f) => `${f.name}|${f.size}|${f.mtime}`;
  async function watchTick() {
    if (watch.busy || !S.online || !watch.dirs.length) return;
    watch.busy = true;
    try {
      const r = await S.watch();
      const lost = (r.dirs || []).filter((d) => d.missing).map((d) => d.dir);
      if (lost.length) banner(`자동으로 읽을 폴더를 찾지 못했습니다: ${esc(lost.join(', '))}. 설정 → 데이터 폴더에서 확인하세요.`, true);
      const seen = new Set(db.watchSeen || []);
      const fresh = (r.files || []).filter((f) => DOC_EXT.test(f.name) && !seen.has(watchSig(f)));
      const ready = fresh.filter((f) => watch.last.get(f.name) === f.size); // 받는 중인 파일은 다음 번에
      watch.last = new Map(fresh.map((f) => [f.name, f.size]));
      if (!ready.length) return;
      const files = [];
      for (const f of ready) {
        try { const b = await S.watchFile(f.name); files.push(new File([b], f.name.split('|').pop().split('/').pop(), { type: '' })); seen.add(watchSig(f)); }
        catch (e) { console.warn('자동 읽기 실패', f.name, e); }
      }
      db.watchSeen = [...seen].slice(-8000);
      if (files.length) await ingest(files, null, null, { onlyMatched: true, from: '내려받은 폴더' });
      else await saveDb();
    } catch (e) { console.warn('자동 읽기', e); }
    finally { watch.busy = false; }
  }
  function startWatch(dirs) {
    watch.dirs = (dirs || []).filter(Boolean); clearInterval(watch.timer); watch.timer = null;
    if (watch.dirs.length) { watch.timer = setInterval(watchTick, 5000); watchTick(); }
    if (JH.settings && JH.settings.showWatch) JH.settings.showWatch(watch.dirs);
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
      mergeSameContracts(); // 새로 받은 차수(-01 …)가 따로 생겼으면 바로 합침
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
  const printDocs = (c) => docsOf(c.key).filter((d) => d.itemId && !(c.noPrint || {})[d.itemId]);
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
      if (!ignoreState && ui.state) { const s = statusOf(c).state; if (ui.state === 'missing' ? !(s === 'missing' || s === 'empty') : s !== ui.state) return false; }
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
        <div class="st">${pillFor(st, c)}</div>
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
  function itemOptions(list, sel, withInbox) {
    return (withInbox ? '<option value="__inbox">미분류로 보내기</option>' : '') + '<option value="">서류 종류 고르기</option>' +
      list.map((x) => `<option value="${esc(x.id)}"${x.id === sel ? ' selected' : ''}>${esc(x.group)} · ${esc(x.name)}</option>`).join('');
  }
  const isoOf = (s) => { const m = String(s || '').replace(/\D/g, ''); return m.length >= 8 ? `${m.slice(0, 4)}-${m.slice(4, 6)}-${m.slice(6, 8)}` : ''; };
  function fileRow(d, list) {
    const tag = d.missing ? '<span class="ft warn" title="데이터 폴더에서 이 파일을 찾을 수 없습니다">파일 없음</span>'
      : d.ocr ? '<span class="ft" title="스캔본이라 글자 인식으로 읽었습니다">스캔</span>' : `<span class="ft${d.kind === 'hwp' && !d.pdfPath ? ' warn' : ''}">${d.kind === 'other' ? ({ xlsx: '엑셀', xls: '엑셀', docx: '워드' }[L.extOf(d.name)] || '기타') : KIND_LABEL[d.kind]}</span>`;
    const conv = d.kind === 'hwp' && !d.pdfPath ? `<button class="btn sm" data-act="hwp" data-doc="${d.id}">PDF로 변환</button>` : '';
    let dt = '';
    if (L.isAdvBond(d.itemId)) {
      const v = d.validOverride || (d.dates && d.dates.bondEnd) || '';
      dt = `<label class="vdate${v ? '' : ' empty'}" title="보증서에 적힌 보증기간 마지막 날. 준공일 + ${L.ADV_DAYS}일 이상이어야 합니다.">보증기간 끝<input type="date" data-act="validset" data-doc="${d.id}" value="${isoOf(v)}">${d.validOverride ? '<small>직접</small>' : v ? '<small>읽음</small>' : ''}</label>`;
    } else if (L.isCertItem(d.itemId)) {
      const v = d.validOverride || (d.dates && d.dates.valid) || '';
      const how = d.validOverride ? '직접' : d.dates && d.dates.validHow === 'calc' ? '계산' : v ? '읽음' : '';
      dt = `<label class="vdate${v ? '' : ' empty'}" title="증명서에 적힌 유효기간 마지막 날. 잘못 읽었으면 고치세요.">유효기간<input type="date" data-act="validset" data-doc="${d.id}" value="${isoOf(v)}">${how ? `<small>${how}</small>` : ''}</label>`;
    } else if (/-(finish|inspect)$/.test(d.itemId || '')) {
      const v = dateOfDoc(d, /-inspect$/.test(d.itemId) ? 'inspect' : 'finish');
      dt = `<label class="vdate${v ? '' : ' empty'}" title="지출요청일(이 날짜 + 2주) 계산에 씁니다">날짜<input type="date" data-act="docdate" data-doc="${d.id}" value="${isoOf(v)}">${d.dateOverride ? '<small>직접</small>' : ''}</label>`;
    }
    return `<div class="file">${tag}<span class="fn" title="${esc(d.name)}">${esc(d.name)}</span>${conv}${dt}
      <select data-act="moveitem" data-doc="${d.id}" aria-label="서류 종류">${itemOptions(list, d.itemId, true)}</select>
      <button class="link" data-act="view" data-doc="${d.id}">보기</button>
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
  const viaOf = (c) => { const docs = docsOf(c.key), got = gotMap(c); return L.viaStatus(c, lists(c.type), (id) => L.hasItem(docs, got, id) || docs.some((d) => (d.also || []).includes(id))); };
  function vendorNeeds(c, st) {
    const missing = st.missing.filter((x) => L.ORIGINAL_SOURCES.includes(x.source)).map((x) => itemView(c, x).name);
    const reissue = st.expired.map((x) => ({ name: itemView(c, x.item).name, valid: x.valid }));
    const via = viaOf(c).missing;
    const adv = advOf(c);
    if (adv && adv.status === 'short') reissue.push({ name: `${itemView(c, adv.item).name}(보증기간이 준공일 ${L.fmtDate(c.endDate)} + ${L.ADV_DAYS}일 이상이어야 함)`, valid: adv.end });
    return { missing, reissue, via, adv };
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
      <input type="date" data-act="payplan" value="${isoOf(b && b.date)}" aria-label="지출요청일(증명서 유효기간을 이 날짜로 따짐)">
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
  function renderDetail() {
    const el = $('#detail');
    const c = ui.sel && db.contracts[ui.sel];
    if (!c) {
      el.innerHTML = `<div class="empty-state"><h2>계약을 고르거나 서류를 넣어 시작하세요</h2>
        <p>받은 서류를 이 창에 끌어다 놓으면 내용을 읽어 계약 건과 서류 종류를 찾아 정리합니다. 계약서가 들어오면 계약 건도 자동으로 만들어집니다.</p>
        <button class="btn primary" data-act="add">업로드</button></div>`;
      return;
    }
    const list = lists(c.type), docs = docsOf(c.key), st = statusOf(c);
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
      <div class="dtop">${reqCard(c, st)}${memoCard(c)}${auditCard(c)}</div>
      <div class="stages">
        ${untyped.length ? `<section class="stage"><div class="stage-head"><span class="stage-no" style="background:var(--amber)">?</span><h3>서류 종류를 정해 주세요</h3><span class="where">이 계약 서류인데 어떤 서류인지 찾지 못했습니다</span></div>
          <div class="row"><span class="mark warn">!</span><div class="rname">종류 미정 ${untyped.length}개</div><div class="rside"></div><div class="files">${untyped.map((d) => fileRow(d, list)).join('')}</div></div></section>` : ''}
        ${groups.map((g, gi) => {
          const req = g.items.filter((x) => x.required);
          const done = req.filter((x) => L.hasItem(docs, gotMap(c), x.id) || (x.alt && L.hasItem(docs, gotMap(c), x.alt))).length;
          const where = [...new Set(g.items.map((x) => SRC_LABEL[x.source] || x.source))].join(', ');
          return `<section class="stage${req.length && done === req.length ? ' done' : ''}">
            <div class="stage-head"><span class="stage-no">${gi + 1}</span><h3>${esc(g.name)}</h3><span class="where">${esc(where)}</span>${(() => { const vs = L.viaStatus(c, g.items, (id) => L.hasItem(docs, gotMap(c), id) || docs.some((d) => (d.also || []).includes(id))); return vs.need ? `<span class="sum num via-sum${vs.done < vs.need ? ' bad-t' : ''}" title="${esc(vs.missing.length ? '경유 안 됨: ' + vs.missing.join(', ') : '모두 경유')}">감독관 경유 ${vs.done}/${vs.need}</span>` : ''; })()}<span class="sum num">필수 ${done}/${req.length}</span></div>
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
                <div class="rside">${prt}${tog}${side}${add}</div>${ds.length || inner.length ? `<div class="files">${ds.map((d) => fileRow(d, list)).join('')}${inner.map((d) => `<div class="file inner"><span class="ft">묶음</span><span class="fn" title="${esc(d.name)}">${esc(d.name)}</span><span class="muted small">${(d.pagesOf && d.pagesOf[x.id] && d.pagesOf[x.id].length) ? esc(d.pagesOf[x.id].join('·')) + '쪽' : '이 파일 안'}</span><button class="link sm" data-act="view" data-doc="${d.id}">보기</button></div>`).join('')}</div>` : ''}</div>`;
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
    const need = docsOf(c.key).filter((d) => !d.missing && !datesPending.has(d.id) && ((!d.dates && (L.isCertItem(d.itemId) || /-(finish|inspect)$/.test(d.itemId || ''))) || (L.isAdvBond(d.itemId) && !(d.dates && 'bondEnd' in d.dates))));
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
        sel = `<select data-chgkind="${esc(r.no)}">${opts}</select> ${tag}`;
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
      .filter(({ st }) => !ui.board || (ui.board === 'late' ? st.late : ui.board === 'missing' ? (st.state === 'missing' || st.state === 'empty') : st.state === ui.board))
      .sort((a, b) => (b.st.late - a.st.late) || ((L.toDate(a.c.endDate) || 9e15) - (L.toDate(b.c.endDate) || 9e15)));
  }
  function renderBoard() {
    const all = filtered(true).map((c) => ({ c, st: statusOf(c) }));
    const cnt = { '': all.length, missing: 0, ready: 0, late: 0, paid: 0 };
    all.forEach(({ st }) => { if (st.state === 'missing' || st.state === 'empty') cnt.missing++; if (st.state === 'ready') cnt.ready++; if (st.state === 'paid') cnt.paid++; if (st.late) cnt.late++; });
    const rows = boardRows();
    const chip = (k, label, alert) => `<button class="chip${ui.board === k ? ' on' : ''}${alert && cnt[k] ? ' alert' : ''}" data-board="${k}">${label} <b>${cnt[k]}</b></button>`;
    $('#view-board').innerHTML = `
      <div class="board-head"><h2>현황판</h2><span class="sub">${ui.officer ? `담당 ${esc(ui.officer)}` : '담당자 전체'}${ui.type ? ` · ${esc(ui.type)}` : ''}${cfg.lastFetch ? ` · 나라장터 ${esc(L.fmtDate(cfg.lastFetch.slice(0, 10)))} 기준` : ''}</span>
        <div class="right"><select id="bOfficer" aria-label="담당자">${$('#fOfficer').innerHTML}</select>
          <button class="btn" data-act="excel" title="지금 보이는 계약을 엑셀 파일로 저장하고 엽니다"${rows.length ? '' : ' disabled'}>${XLS_ICON}엑셀로 받기 <span class="num">${rows.length}건</span></button>
          <span class="btn-group" role="group" aria-label="감사·검사 서식 받기"><button class="btn" data-act="quickform" data-fk="audit" title="행정사무감사 「수의계약 현황(1,000만원 이상)」 한글 파일 — 나라장터·서류에서 채워 바로 받기">행정사무감사 서식</button><button class="btn" data-act="quickform" data-fk="inspect" title="종합감사 「계약집행 현황(총괄)」 엑셀 — 나라장터·서류에서 채워 바로 받기">종합감사 서식</button><button class="btn ghost" data-act="forms" title="기간·구분·기준 금액·넣을 계약을 고르고 빈칸 확인">고르기</button></span></div></div>
      <div class="chips">${chip('', '전체')}${chip('missing', '서류 미비')}${chip('ready', '지출 대기')}${chip('late', '준공 지남·미지출', true)}${chip('paid', '지출 완료')}</div>
      ${rows.length ? `<table class="grid"><thead><tr><th>계약</th><th>구분</th><th>준공일</th><th>서류</th><th class="r">원본</th><th>지출</th><th>상태</th></tr></thead><tbody>
        ${rows.map(({ c, st }) => `<tr data-key="${esc(c.key)}">
          <td><div class="nm">${esc(c.name)}</div><div class="sub">${esc(c.vendor || '')}${c.amount ? ` · ${esc(L.won(c.amount))}` : ''}</div>${(() => { const m = memoOf(c); const who = [m.dept, m.person, m.phone].filter(Boolean).join(' '); return who || m.note ? `<div class="sub memo-line" title="${esc(m.note || '')}">${who ? `감독 ${esc(who)}` : ''}${m.note ? `${who ? ' · ' : ''}${esc(m.note.replace(/\s+/g, ' ').slice(0, 40))}` : ''}</div>` : ''; })()}</td>
          <td>${esc(c.type)}</td>
          <td class="date"${st.late ? ' style="color:var(--seal);font-weight:650"' : ''}>${esc(L.fmtDate(c.endDate) || '-')}</td>
          <td><div class="prog${st.reqDone === st.reqTotal ? ' full' : ''}"><span class="track"><i style="width:${st.reqTotal ? Math.round(st.reqDone / st.reqTotal * 100) : 0}%"></i></span><span class="num">${st.reqDone}/${st.reqTotal}</span></div></td>
          <td class="r num">${st.origCount || ''}</td>
          <td class="date">${esc(L.fmtDate(c.paidDate) || '')}</td>
          <td>${pillFor(st, c)}</td></tr>`).join('')}
        </tbody></table>` : `<div class="empty-line">해당하는 계약이 없습니다.</div>`}`;
    const bo = $('#bOfficer'); bo.value = ui.officer;
  }

  // ---------- 화면: 미분류 ----------
  function contractOptions(sel) {
    const cs = contracts().sort((a, b) => b.updatedAt - a.updatedAt);
    return '<option value="">계약 고르기</option>' + cs.map((c) => `<option value="${esc(c.key)}"${c.key === sel ? ' selected' : ''}>${esc(c.name)}${c.vendor ? ` (${esc(c.vendor)})` : ''}</option>`).join('');
  }
  function renderInbox() {
    const docs = inboxDocs();
    $('#view-inbox').innerHTML = `
      <div class="board-head"><h2>미분류</h2><span class="sub">어느 계약 서류인지 찾지 못한 파일입니다. 계약을 고르면 그 계약 폴더로 옮기고 서류 종류도 찾아 줍니다.</span>
        <div class="right"><button class="btn" data-act="rematch">다시 자동 분류</button></div></div>
      ${docs.length ? `<table class="grid"><thead><tr><th>파일</th><th>읽은 내용</th><th>계약</th><th></th></tr></thead><tbody>
        ${docs.map((d) => `<tr class="inbox-row"><td><div class="nm">${esc(d.name)}</div><div class="sub">${KIND_LABEL[d.kind]}${d.ocr ? ' · 스캔 인식' : ''} · ${esc(L.fmtDate(d.addedAt))}</div></td>
          <td class="sub">${esc([d.meta && d.meta.name, d.meta && d.meta.vendor].filter(Boolean).join(' / ') || (d.text ? d.text.slice(0, 40) + '…' : '읽을 수 있는 글자가 없음'))}</td>
          <td><select data-act="assign" data-doc="${d.id}" aria-label="계약">${contractOptions('')}</select></td>
          <td style="white-space:nowrap"><button class="link" data-act="view" data-doc="${d.id}">보기</button> &nbsp; <button class="x" data-act="del" data-doc="${d.id}" aria-label="빼기">✕</button></td></tr>`).join('')}
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
    const ns = JH.notice && JH.notice.stats ? JH.notice.stats() : { count: 0 };
    $('#homeNotice').innerHTML = ns.count
      ? `<li><b class="num">${ns.draft}</b>작성 중</li><li><b class="num">${ns.done}</b>작성 완료</li>${ns.recent ? `<li class="recent">최근: ${esc(ns.recent)}</li>` : ''}`
      : '<li class="muted">아직 작성한 공고문이 없습니다.</li>';
  }

  function render() { return withIndex(render0); }
  function render0() {
    const n = inboxDocs().length;
    const ic = $('#inboxCount'); ic.hidden = !n; ic.textContent = n;
    if (ui.view === 'home') { renderHome(); return; }
    if (ui.view === 'notice') return;
    renderList(); renderDetail(); fitMemo();
    const cur = ui.view === 'contracts' && ui.sel && db.contracts[ui.sel]; if (cur && S.online) backfillDates(cur);
    if (ui.view === 'board') renderBoard();
    if (ui.view === 'inbox') renderInbox();
  }
  const MOD = { contracts: 'jichul', board: 'jichul', inbox: 'jichul', notice: 'notice', home: '' };
  function setView(v) {
    ui.view = v;
    const mod = MOD[v];
    $$('.views button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    $$('.vgroup').forEach((g) => g.classList.toggle('cur', g.dataset.mod === mod));
    $$('.bar-actions [data-for]').forEach((b) => { b.hidden = b.dataset.for !== mod; });
    $$('.view').forEach((s) => s.classList.toggle('on', s.id === 'view-' + v));
    document.body.dataset.mod = mod || 'home';
    if (v === 'notice') JH.notice.show();
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
      else if (act === 'additem') { pickTarget = { key: ui.sel, item: t.dataset.item }; $('#fileIn').click(); }
      else if (act === 'print') await printContract(c, 'print');
      else if (act === 'save') await printContract(c, 'save');
      else if (act === 'folder') await S.open(folderOf(c));
      else if (act === 'pay') openPay(c);
      else if (act === 'edit') openContract(c);
      else if (act === 'view') { const d = docById(t.dataset.doc); if (S.view) await S.view(d.pdfPath || d.path); else window.open(S.fileUrl(d.pdfPath || d.path), '_blank'); }
      else if (act === 'del') { const d = docById(t.dataset.doc); if (confirm(`"${d.name}"을 목록에서 뺄까요? 파일은 데이터 폴더의 _삭제됨으로 옮겨집니다.`)) { await removeDoc(d); render(); } }
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
        await moveDoc(d, c.key, L.classifyItem(lists(c.type), d.name, d.title));
        toast(`"${c.name}"으로 옮겼습니다.`, 'ok', { label: '계약 보기', run: () => { ui.sel = c.key; setView('contracts'); } });
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
  function openMail(c) {
    const st = statusOf(c), n = vendorNeeds(c, st);
    const m = L.vendorMail({ c, org: cfg.insttNm, dept: (cfg.notice && cfg.notice.dept) || '', officer: cfg.officer, phone: (cfg.notice && cfg.notice.phone) || '', missing: n.missing, reissue: n.reissue, via: n.via, basis: st.basis || {} });
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
    $('#ctArchive').hidden = !c;
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
  $('#ctArchive').onclick = async () => {
    if (!editing || !confirm('이 계약을 목록에서 숨길까요? 저장된 서류 파일은 그대로 남습니다.')) return;
    editing.archived = true; await saveDb(true); $('#dlgContract').close(); ui.sel = null; render();
  };
  // 지출 처리
  function openPay(c) {
    editing = c;
    $('#payDate').value = c.paidDate ? L.fmtDate(c.paidDate).replace(/\./g, '-') : new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    $('#payMemo').value = c.payMemo || ''; $('#payUndo').hidden = !c.paidDate;
    $('#dlgPay').showModal();
  }
  $('#paySave').onclick = async () => { editing.paidDate = $('#payDate').value.replace(/-/g, ''); editing.payMemo = $('#payMemo').value.trim(); editing.updatedAt = Date.now(); await saveDb(true); $('#dlgPay').close(); render(); };
  $('#payUndo').onclick = async () => { editing.paidDate = ''; editing.payMemo = ''; await saveDb(true); $('#dlgPay').close(); render(); };

  document.addEventListener('input', (e) => {
    const t = e.target.closest('[data-memo]'); if (!t) return;
    const c = ui.sel && db.contracts[ui.sel]; if (!c) return;
    c.memo = { ...(c.memo || {}), [t.dataset.memo]: t.value }; c.memoAt = new Date().toISOString();
    if (t.tagName === 'TEXTAREA') { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }
    const s = $('#memoState'); if (s) s.textContent = '저장 중…';
    saveDb().then(() => { const s2 = $('#memoState'); if (s2) s2.textContent = '저장됨 · 이 PC에만 저장, 인쇄본에는 들어가지 않습니다'; });
  });
  document.addEventListener('change', (e) => {
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
  document.addEventListener('click', onAct);
  document.addEventListener('change', onChange);
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
        const move = (ev) => apply(view, k, clamp(view, ev.clientX - left));
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
  $('#btnFetch').onclick = () => fetchContracts();
  $('#btnNewContract').onclick = () => openContract(null);
  let pickTarget = null;
  $('#fileIn').onchange = (e) => { const fs = [...e.target.files]; e.target.value = ''; const p = pickTarget || {}; pickTarget = null; ingest(fs, p.key || null, p.item || null); };

  // 끌어다 놓기: 서류 줄이면 그 계약·그 서류로, 업로드 칸이면 그 계약으로, 아니면 자동 분류
  const dropTarget = (e) => {
    if (ui.view !== 'contracts' || !ui.sel || !e.target.closest) return null;
    const row = e.target.closest('#detail [data-drop-item]'); if (row) return { el: row, key: ui.sel, item: row.dataset.dropItem };
    const di = e.target.closest('#dropin'); if (di) return { el: di, key: ui.sel };
    return null;
  };
  const clearOver = () => $$('#detail .over').forEach((x) => x.classList.remove('over'));
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#dropOverlay').hidden = false; });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; clearOver(); } });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return; e.preventDefault();
    const tg = dropTarget(e); clearOver(); if (tg) tg.el.classList.add('over');
    $('#dropOverlay').hidden = !!tg;
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; $('#dropOverlay').hidden = true;
    const tg = dropTarget(e); clearOver();
    const files = await collectDropped(e.dataTransfer);
    ingest(files, tg ? tg.key : null, tg ? tg.item || null : null);
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
      const info = await S.ping();
      try { const r = await fetch('org.json', { cache: 'no-store' }); if (r.ok) org = await r.json(); } catch (_) {}
      // 설정·서류대장·서류 본문을 한꺼번에 요청(차례로 기다리지 않음)
      const [cfg0, saved0, tx0] = await Promise.all([S.readJson(CFG_PATH), S.readJson(DB_PATH).catch((e) => { console.warn('서류대장 읽기 실패', e); return null; }), S.readJson(TEXT_PATH).catch(() => null)]);
      cfg = mergeCfg(cfg0 || {});
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
        setTimeout(() => S.writeJson(BACKUP_PATH, dbForSave(), true).catch(() => {}), 1500);
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
      startWatch(info.watchDirs || []);
      if (info.relocated) toast(`데이터 폴더가 옮겨진 것을 찾았습니다: ${info.dataDir}`, 'ok');
      if (info.lost) banner(`예전 데이터 폴더(${esc(info.oldDir)})를 찾지 못해 임시로 새 폴더를 쓰고 있습니다. <button class="link" id="bannerFind">옮긴 폴더 고르기</button>`, true);
      const bf = $('#bannerFind'); if (bf) bf.onclick = async () => { const r = await S.pickFolder(); if (r.ok) location.reload(); };
      if (!cfg.apiKey && !info.lost) banner('설정에서 나라장터 인증키와 기관명을 넣으면 내 담당 계약을 자동으로 불러옵니다. <button class="link" id="bannerSet">설정 열기</button>');
      const b = $('#bannerSet'); if (b) b.onclick = () => JH.settings.open('nara');
    } catch (e) { banner('연결 창구와 통신하지 못했습니다: ' + esc(e.message), true); }
    try { await JH.notice.load(); } catch (_) {}
    setView(ui.view);
    try { await reconcile(); render(); } catch (e) { console.warn('폴더 확인 실패', e); }
    if (!cfg.officer) openWelcome();
    setInterval(() => { S.ping().catch(() => banner('연결 창구가 꺼졌습니다. 바탕화면의 바로가기로 다시 실행해 주세요.', true)); }, 60000);
  }

  root.JH.app = {
    get cfg() { return cfg; }, set cfg(v) { cfg = v; }, get db() { return db; }, get org() { return org; },
    defaults, lists, printList, startWatch, saveCfg, saveDb, fetchContracts, enrichContracts, fillFromDocs, openForms, render, toast, banner, start, ingest, setView, progress,
    setChecklists(v) { db.checklists = v; return saveDb(true); },
  };
  document.addEventListener('DOMContentLoaded', () => {});
  setTimeout(start, 0);
})(window);
