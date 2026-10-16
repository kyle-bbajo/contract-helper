/* 계약업무 도우미 — 화면과 동작(처음 화면, 지출서류) */
(function (root) {
  'use strict';
  const L = JH.logic, S = JH.server, R = JH.readers;
  const DB_PATH = '서류대장.json', CFG_PATH = '설정.json', INBOX = '미분류';
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
  const ui = { view: 'home', sel: null, q: '', officer: '', officerTouched: false, type: '', state: '', board: '' };

  const lists = (type) => (db.checklists && db.checklists[type]) || defaults[type] || defaults.공사;
  const contracts = () => Object.values(db.contracts).filter((c) => !c.archived);
  const docsOf = (key) => db.docs.filter((d) => d.key === key);
  const inboxDocs = () => db.docs.filter((d) => !d.key);
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const ymd = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  function statusOf(c) {
    const docs = docsOf(c.key);
    const st = L.checklistStatus(lists(c.type), docs, c.originals);
    const anything = docs.length > 0 || Object.values(c.originals || {}).some(Boolean);
    const end = L.toDate(c.endDate);
    st.late = !!(end && end < today() && !c.paidDate);
    st.state = c.paidDate ? 'paid' : !anything ? 'empty' : st.missing.length ? 'missing' : 'ready';
    st.untyped = docs.filter((d) => !d.itemId).length;
    st.origCount = Object.values(c.originals || {}).filter(Boolean).length;
    return st;
  }

  // ---------- 저장 ----------
  let saveTimer = null, saving = Promise.resolve();
  function saveDb(now) {
    clearTimeout(saveTimer);
    const run = () => { saving = saving.then(() => S.writeJson(DB_PATH, db)).catch((e) => toast('서류대장을 저장하지 못했습니다: ' + e.message, 'err')); return saving; };
    if (now) return run();
    saveTimer = setTimeout(run, 350);
    return saving;
  }
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
  function upsertContract(n) {
    // 계약번호가 하나라도 같으면 같은 계약
    const nb = (n.nums || []).map(L.baseNo).filter((x) => x.length >= 6);
    let ex = Object.values(db.contracts).find((c) => (c.nums || []).some((x) => nb.includes(L.baseNo(x))));
    if (!ex && !nb.length && n.name) ex = Object.values(db.contracts).find((c) => L.norm(c.name) === L.norm(n.name));
    if (ex) {
      const keep = ex.edited || {};
      for (const k of ['type', 'name', 'vendor', 'no', 'amount', 'contractDate', 'startDate', 'endDate', 'period', 'officer', 'dept', 'org', 'url']) {
        if (!keep[k] && n[k]) ex[k] = n[k];
      }
      ex.nums = [...new Set([...(ex.nums || []), ...(n.nums || [])])];
      if (n.source === 'api') ex.source = 'api';
      ex.updatedAt = Date.now();
      return { c: ex, created: false };
    }
    let key = n.key || L.contractKey(n);
    while (db.contracts[key]) key += '_';
    const c = { originals: {}, paidDate: '', payMemo: '', archived: false, edited: {}, ...n, key, updatedAt: Date.now() };
    db.contracts[key] = c;
    return { c, created: true };
  }

  // ---------- 업로드 ----------
  async function ingest(fileList, forceKey, forceItem) {
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
          id: L.uid(), name: f.name, kind, size: f.size, mime: f.type, bytes, ocr,
          meta: L.findMeta(lines), text: L.norm(lines.join(' ')).slice(0, 6000), title: L.norm(lines.slice(0, 8).join(' ')).slice(0, 300),
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
      const byContract = {}; let inbox = 0;
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        progress(`정리하는 중 ${i + 1}/${recs.length}`, i / recs.length);
        let c = forced || (r.key && db.contracts[r.key]) || L.matchContract(contracts(), L.norm(L.stem(r.name)) + '|' + r.text);
        const itemId = c ? (forced && forceItem ? forceItem : L.classifyItem(lists(c.type), r.name, r.title)) : null;
        const item = c && itemId ? lists(c.type).find((x) => x.id === itemId) : null;
        const dir = c ? folderOf(c) : INBOX;
        const fname = item ? `${L.safeName(item.name, 30)}_${r.name}` : r.name;
        const saved = await S.save(dir, fname, r.bytes);
        db.docs.push({
          id: r.id, key: c ? c.key : null, itemId: item ? item.id : null, path: saved.path, name: r.name, kind: r.kind,
          size: r.size, mime: r.mime, addedAt: new Date().toISOString(), ocr: r.ocr, meta: r.meta, text: r.text, title: r.title, manual: !!forced,
        });
        if (c) { byContract[c.key] = (byContract[c.key] || 0) + 1; c.updatedAt = Date.now(); } else inbox++;
      }
      await saveDb(true);
      // 4) 알림
      const parts = Object.entries(byContract).map(([k, n]) => `${db.contracts[k].name} ${n}`);
      if (inbox) parts.push(`미분류 ${inbox}`);
      let msg = `${recs.length}개 정리했습니다` + (parts.length ? ` — ${parts.join(', ')}` : '') + '.';
      if (newContracts) msg += ` 계약서에서 새 계약 ${newContracts}건을 만들었습니다.`;
      if (skipped) msg += ` 이미 있는 파일 ${skipped}개는 건너뛰었습니다.`;
      if (R.ocrBroken) msg += ' 스캔본 글자 인식을 시작하지 못해 일부는 미분류로 갔습니다.';
      toast(msg, inbox ? '' : 'ok', inbox ? { label: '미분류 보기', run: () => setView('inbox') } : null);
      const keys = Object.keys(byContract);
      if (!forced && keys.length === 1) ui.sel = keys[0];
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
    const name = item ? `${L.safeName(item.name, 30)}_${d.name}` : d.name;
    const r = await S.move(d.path, dir, name);
    d.path = r.path;
    if (d.pdfPath) { try { const p = await S.move(d.pdfPath, dir, L.stem(name) + '.pdf'); d.pdfPath = p.path; } catch (_) { d.pdfPath = ''; } }
    d.key = c ? c.key : null; d.itemId = item ? item.id : null; d.manual = manual;
    if (c) c.updatedAt = Date.now();
    await saveDb(true);
  }
  async function removeDoc(d) {
    await S.remove(d.path); if (d.pdfPath) { try { await S.remove(d.pdfPath); } catch (_) {} }
    db.docs = db.docs.filter((x) => x !== d); await saveDb(true);
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
  const DOC_EXT = /\.(pdf|jpe?g|png|gif|bmp|webp|hwpx?)$/i;
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
      if (kind === 'pdf') { const twin = db.docs.find((d) => d.kind === 'hwp' && d.path.replace(/\.hwpx?$/i, '.pdf') === f.path); if (twin) { twin.pdfPath = f.path; continue; } }
      try {
        const bytes = await S.readBytes(f.path);
        const { lines, ocr } = await R.read(bytes, kind);
        const text = L.norm(lines.join(' ')).slice(0, 6000), title = L.norm(lines.slice(0, 8).join(' ')).slice(0, 300);
        let c = contracts().find((x) => x.folder && (dir === x.folder || dir.startsWith(x.folder + '/'))) || L.matchContract(contracts(), L.norm(L.stem(name)) + '|' + text);
        const doc = { id: L.uid(), key: c ? c.key : null, itemId: c ? L.classifyItem(lists(c.type), name, title) : null, path: f.path, name, kind, size: f.size,
          addedAt: new Date().toISOString(), ocr, meta: L.findMeta(lines), text, title, manual: false };
        db.docs.push(doc); added++;
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

  // ---------- 나라장터 계약 목록 ----------
  // full이 아니면 지난번에 불러온 달부터만(여럿이 인증키 하나를 같이 쓰므로 조회 횟수를 아낌)
  async function fetchContracts(full) {
    if (!cfg.apiKey || !cfg.insttNm) { toast('설정에서 인증키와 기관명을 먼저 넣어 주세요.', 'err'); JH.settings.open('nara'); return; }
    let months = Number(cfg.months) || 6;
    const last = cfg.lastFetch ? new Date(cfg.lastFetch) : null;
    if (!full && last && !isNaN(last)) {
      const now = new Date();
      const since = (now.getFullYear() - last.getFullYear()) * 12 + now.getMonth() - last.getMonth() + 1;
      months = Math.max(1, Math.min(months, since));
    }
    const ranges = L.monthRanges(months);
    const btn = $('#btnFetch'); if (btn.classList.contains('busy')) return; btn.classList.add('busy'); btn.disabled = true;
    const steps = ranges.length * 2; let step = 0, created = 0; const seen = new Set();
    try {
      for (const type of ['공사', '용역']) {
        for (const [b, e] of ranges) {
          progress(`나라장터에서 ${type} 계약 불러오는 중 (${b.slice(0, 4)}.${b.slice(4, 6)})`, step++ / steps);
          for (let page = 1; page < 50; page++) {
            const { items, total } = L.parseApiBody(await S.nara(L.apiUrl(L.API_OPS[type], cfg, b, e, page, 100)));
            for (const x of items) { const r = upsertContract(L.normalizeApiItem(x, type)); seen.add(r.c.key); if (r.created) created++; }
            if (page * 100 >= total || !items.length) break;
          }
        }
      }
      cfg.lastFetch = new Date().toISOString(); await saveCfg();
      await saveDb(true);
      const moved = await rematchInbox();
      toast(`나라장터 계약 ${seen.size}건을 확인했습니다. 새 계약 ${created}건` + (moved ? `, 미분류 서류 ${moved}개를 계약으로 옮겼습니다.` : '.'), 'ok');
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
    return { kind: d.kind, name: d.name, bytes: d.kind === 'other' ? null : await S.readBytes(d.path) };
  }
  async function printContract(c, mode) {
    const docs = docsOf(c.key).filter((d) => d.itemId);
    try {
      progress('인쇄할 서류를 합치는 중', .3);
      const r = await JH.pdfbuild.build(c, lists(c.type), docs, getFile, { cover: true, holder: true });
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
    }).sort((a, b) => (L.toDate(b.endDate) || 0) - (L.toDate(a.endDate) || 0) || b.updatedAt - a.updatedAt);
  }
  function pillFor(st, c) {
    if (st.state === 'paid') return `<span class="pill paid">지출 ${esc(L.fmtDate(c.paidDate).slice(5))}</span>`;
    if (st.state === 'empty') return '<span class="pill none">서류 없음</span>';
    if (st.state === 'missing') return `<span class="pill miss">미비 ${st.missing.length}</span>`;
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
        <div class="meta"><span>${hl(c.vendor || '업체 미상')}</span><span>${esc(c.type)}</span>${c.endDate ? `<span class="date"${st.late ? ' style="color:var(--seal)"' : ''}>준공 ${esc(L.fmtDate(c.endDate))}</span>` : ''}${m.note || m.person ? `<span class="memo-dot" title="${esc([m.dept, m.person, m.phone].filter(Boolean).join(' ') + (m.note ? '\n' + m.note : ''))}">메모</span>` : ''}</div>
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
    else if (st.missing.length) { a = '미비'; b = `${st.missing.length}건`; }
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
  function fileRow(d, list) {
    const tag = d.missing ? '<span class="ft warn" title="데이터 폴더에서 이 파일을 찾을 수 없습니다">파일 없음</span>'
      : d.ocr ? '<span class="ft" title="스캔본이라 글자 인식으로 읽었습니다">스캔</span>' : `<span class="ft${d.kind === 'hwp' && !d.pdfPath ? ' warn' : ''}">${KIND_LABEL[d.kind]}</span>`;
    const conv = d.kind === 'hwp' && !d.pdfPath ? `<button class="btn sm" data-act="hwp" data-doc="${d.id}">PDF로 변환</button>` : '';
    return `<div class="file">${tag}<span class="fn" title="${esc(d.name)}">${esc(d.name)}</span>${conv}
      <select data-act="moveitem" data-doc="${d.id}" aria-label="서류 종류">${itemOptions(list, d.itemId, true)}</select>
      <button class="link" data-act="view" data-doc="${d.id}">보기</button>
      <button class="x" data-act="del" data-doc="${d.id}" title="빼기" aria-label="빼기">✕</button></div>`;
  }
  function memoCard(c) {
    const m = memoOf(c);
    const f = (k, label, ph, extra = '') => `<label class="mf"><span>${label}</span><input type="text" data-memo="${k}" value="${esc(m[k] || '')}" placeholder="${esc(ph)}" autocomplete="off"${extra}></label>`;
    return `<section class="memo" aria-label="메모">
      <div class="memo-head"><h3>메모</h3><span class="muted" id="memoState">이 PC에만 저장 · 인쇄본에는 들어가지 않습니다</span></div>
      <div class="memo-grid">
        ${f('dept', '감독부서', '예: 시설관리팀')}${f('person', '감독관', '이름')}${f('phone', '연락처', '예: 031-000-0000', ' inputmode="tel"')}
        <label class="mf wide"><span>특이사항</span><textarea data-memo="note" rows="2" placeholder="예: 준공검사 10/20 예정, 하자보증서 원본은 업체가 직접 가져오기로 함">${esc(m.note || '')}</textarea></label>
      </div></section>`;
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
          <div class="kicker"><span class="tag">${esc(c.type)}</span>${srcLabel ? `<span class="tag src">${esc(srcLabel)}</span>` : ''}${c.no ? `<span class="num">${esc(c.no)}</span>` : ''}</div>
          <h1 class="cname">${esc(c.name || '이름 없는 계약')}</h1>
          <div class="facts">
            <span>업체 <b>${esc(c.vendor || '-')}</b></span>
            ${c.amount ? `<span>계약금액 <b class="amount">${esc(L.won(c.amount))}</b></span>` : ''}
            ${period ? `<span>기간 <b class="date">${esc(period)}</b>${st.late ? ' <b style="color:var(--seal)">준공 지남</b>' : ''}</span>` : ''}
            ${c.officer ? `<span>담당 <b>${esc(c.officer)}</b>${c.dept ? ` (${esc(c.dept)})` : ''}</span>` : ''}
            ${c.paidDate ? `<span>지출 <b class="date">${esc(L.fmtDate(c.paidDate))}</b>${c.payMemo ? ` ${esc(c.payMemo)}` : ''}</span>` : ''}
          </div>
          <div class="actions">
            <button class="btn primary" data-act="print">한 번에 인쇄</button>
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
      ${memoCard(c)}
      <div class="dropin" id="dropin"><button class="btn primary" data-act="addhere">업로드</button>
        <span>이 계약 서류로 올립니다. 서류 종류는 자동으로 찾고, 파일을 여기에 끌어다 놓아도 됩니다.</span></div>
      <div class="stages">
        ${untyped.length ? `<section class="stage"><div class="stage-head"><span class="stage-no" style="background:var(--amber)">?</span><h3>서류 종류를 정해 주세요</h3><span class="where">이 계약 서류인데 어떤 서류인지 찾지 못했습니다</span></div>
          <div class="row"><span class="mark warn">!</span><div class="rname">종류 미정 ${untyped.length}개</div><div class="rside"></div><div class="files">${untyped.map((d) => fileRow(d, list)).join('')}</div></div></section>` : ''}
        ${groups.map((g, gi) => {
          const req = g.items.filter((x) => x.required);
          const done = req.filter((x) => docs.some((d) => d.itemId === x.id) || (c.originals || {})[x.id]).length;
          const where = [...new Set(g.items.map((x) => SRC_LABEL[x.source] || x.source))].join(', ');
          return `<section class="stage${req.length && done === req.length ? ' done' : ''}">
            <div class="stage-head"><span class="stage-no">${gi + 1}</span><h3>${esc(g.name)}</h3><span class="where">${esc(where)}</span><span class="sum num">필수 ${done}/${req.length}</span></div>
            ${g.items.map((x) => {
              const ds = docs.filter((d) => d.itemId === x.id);
              const orig = !!(c.originals || {})[x.id];
              const canOrig = L.ORIGINAL_SOURCES.includes(x.source);
              let mark, side;
              if (ds.length) { const warn = ds.some((d) => (d.kind === 'hwp' && !d.pdfPath) || d.kind === 'other'); mark = warn ? '<span class="mark warn">!</span>' : '<span class="mark ok">✓</span>'; side = `<span class="num">${ds.length}개</span>`; }
              else if (orig) { mark = '<span class="mark orig">원</span>'; side = '<span>원본 받음</span>'; }
              else if (x.required) { mark = '<span class="mark miss">✕</span>'; side = '<span class="missing">누락</span>'; }
              else { mark = '<span class="mark opt">–</span>'; side = '<span class="optional">해당 시</span>'; }
              const tog = canOrig ? `<label class="orig-toggle" title="종이 원본으로 받았으면 체크하세요. 인쇄본의 이 자리에 원본을 끼울 안내 페이지가 들어갑니다."><input type="checkbox" data-act="orig" data-item="${esc(x.id)}"${orig ? ' checked' : ''}> 원본</label>` : '';
              const add = `<button class="add-item" data-act="additem" data-item="${esc(x.id)}" title="${esc(x.name)}(으)로 바로 넣기">+ 추가</button>`;
              return `<div class="row" data-drop-item="${esc(x.id)}">${mark}<div class="rname">${esc(x.name)}${x.note ? `<span class="note">${esc(x.note)}</span>` : ''}</div>
                <div class="rside">${tog}${side}${add}</div>${ds.length ? `<div class="files">${ds.map((d) => fileRow(d, list)).join('')}</div>` : ''}</div>`;
            }).join('')}
          </section>`;
        }).join('')}
      </div>`;
  }

  // 메모 칸 높이를 내용에 맞춤
  const fitMemo = () => $$('textarea[data-memo]').forEach((t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; });

  // ---------- 화면: 현황판 ----------
  function renderBoard() {
    const all = filtered(true).map((c) => ({ c, st: statusOf(c) }));
    const cnt = { '': all.length, missing: 0, ready: 0, late: 0, paid: 0 };
    all.forEach(({ st }) => { if (st.state === 'missing' || st.state === 'empty') cnt.missing++; if (st.state === 'ready') cnt.ready++; if (st.state === 'paid') cnt.paid++; if (st.late) cnt.late++; });
    const rows = all.filter(({ st }) => !ui.board || (ui.board === 'late' ? st.late : ui.board === 'missing' ? (st.state === 'missing' || st.state === 'empty') : st.state === ui.board))
      .sort((a, b) => (b.st.late - a.st.late) || ((L.toDate(a.c.endDate) || 9e15) - (L.toDate(b.c.endDate) || 9e15)));
    const chip = (k, label, alert) => `<button class="chip${ui.board === k ? ' on' : ''}${alert && cnt[k] ? ' alert' : ''}" data-board="${k}">${label} <b>${cnt[k]}</b></button>`;
    $('#view-board').innerHTML = `
      <div class="board-head"><h2>현황판</h2><span class="sub">${ui.officer ? `담당 ${esc(ui.officer)}` : '담당자 전체'}${ui.type ? ` · ${esc(ui.type)}` : ''}${cfg.lastFetch ? ` · 나라장터 ${esc(L.fmtDate(cfg.lastFetch.slice(0, 10)))} 기준` : ''}</span>
        <div class="right"><select id="bOfficer" aria-label="담당자">${$('#fOfficer').innerHTML}</select></div></div>
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
      ? `<li><b class="num">${ns.draft}</b>작성 중</li><li><b class="num">${ns.done}</b>작성 완료</li><li><b class="num">${ns.posted}</b>나라장터 등록</li>${ns.recent ? `<li class="recent">최근: ${esc(ns.recent)}</li>` : ''}`
      : '<li class="muted">아직 작성한 공고문이 없습니다.</li>';
  }

  function render() {
    const n = inboxDocs().length;
    const ic = $('#inboxCount'); ic.hidden = !n; ic.textContent = n;
    if (ui.view === 'home') { renderHome(); return; }
    if (ui.view === 'notice') return;
    renderList(); renderDetail(); fitMemo();
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
      } else if (act === 'searchall') { ui.officer = ''; ui.officerTouched = true; ui.type = ''; ui.state = ''; $$('#fState button').forEach((b) => b.classList.toggle('on', !b.dataset.state)); render();
      } else if (act === 'rematch') { const n = await rematchInbox(); toast(n ? `${n}개를 계약으로 옮겼습니다.` : '새로 찾은 계약이 없습니다.'); render(); }
    } catch (err) { console.error(err); toast(err.message, 'err'); }
  }
  async function onChange(e) {
    const t = e.target;
    try {
      if (t.dataset.act === 'orig') {
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
      } else if (t.id === 'bOfficer') { ui.officer = t.value; ui.officerTouched = true; render(); }
    } catch (err) { console.error(err); toast(err.message, 'err'); render(); }
  }

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
  document.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('[data-memo]')) renderList(); });
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
      cfg = mergeCfg((await S.readJson(CFG_PATH)) || {});
      const saved = await S.readJson(DB_PATH);
      if (saved && saved.contracts) { db = { ...db, ...saved }; await S.writeJson('서류대장.백업.json', saved); }
      JH.settings.setInfo(info);
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
    defaults, lists, saveCfg, saveDb, fetchContracts, render, toast, banner, start, ingest, setView, progress,
    setChecklists(v) { db.checklists = v; return saveDb(true); },
  };
  document.addEventListener('DOMContentLoaded', () => {});
  setTimeout(start, 0);
})(window);
