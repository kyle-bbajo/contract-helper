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
    const n = { id: L.uid(), v: N.applyRules(N.blank(cfg), {}, cfg), manual: {}, learned: null, createdAt: Date.now(), updatedAt: Date.now() };
    store.notices.unshift(n); sel = n.id; save(true); render();
    setTimeout(() => { const t = $('#nTitle'); if (t) t.focus(); }, 0);
  }
  function setVal(key, val, manual) {
    const n = cur(); if (!n) return;
    n.v[key] = val;
    if (manual) n.manual[key] = true;
    if (key === '구분') { const ws = N.WORK_TYPES[val] || []; if (!ws.some((w) => w.name === n.v.공종)) n.v.공종 = ws[0] ? ws[0].name : ''; n.manual.업종제한 = false; }
    if (key === '공종') n.manual.업종제한 = false;
    n.v = N.applyRules(n.v, n.manual, app().cfg);
    n.updatedAt = Date.now(); save();
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
    if (w && w.license) tries.push({ ...base, indstrytyNm: w.license });
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
        if (bids.length) break;
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
      const withFiles = (keyword0 ? bids : near).filter((b) => b.files && b.files.some((f) => /\.(hwpx?|pdf)$/i.test(f.name))).slice(0, 5);
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

  // ---------- 한글 양식 ----------
  async function templates() {
    try { const r = await S.list(TPL_DIR, false); return r.files.filter((f) => /\.(hwp|hwpx)$/i.test(f.path)); } catch (_) { return []; }
  }
  async function fillTemplate(tplPath) {
    const n = cur(); const values = N.templateValues(n.v);
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
      n.lastFile = r.path; n.updatedAt = Date.now(); save(true);
      app().toast(`한글 공고문을 만들었습니다 (${r.replaced}개 항목).`, 'ok', { label: '한글로 열기', run: () => S.openFile(r.path) });
    } catch (e) { app().toast(e.message, 'err'); }
    finally { app().progress(null); render(); }
  }
  const fillHwpxBytes = (bytes, values) => N.fillHwpx(root.CFB, bytes, values);

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
    } else if (f.type === 'date') input = `<input type="date" ${attrs} value="${esc(v)}">`;
    else if (f.type === 'datetime') input = `<input type="datetime-local" ${attrs} value="${esc(v)}">`;
    else input = `<input type="text" ${attrs} value="${esc(v)}"${f.type === 'money' ? ' inputmode="numeric" class="num"' : ''} placeholder="${esc(f.ph || '')}">`;
    // 유사 공고에서 배운 추천
    let hint = '';
    const s = n.learned && n.learned.summary[f.key];
    if (s && s.top.length) {
      const t = s.top[0]; const sv = suggestionFor(f.key, t);
      hint = `<div class="learn-hint">비슷한 공고 ${s.n}건 중 ${t.count}건: <b>${esc(sv)}</b>${sv !== v ? ` <button type="button" class="link sm" data-apply="${esc(f.key)}" data-val="${esc(sv)}">적용</button>` : ' <span class="ok">✓</span>'}</div>`;
    }
    return `<label class="nf${f.wide ? ' wide' : ''}">${label}${input}${hint}</label>`;
  }
  function renderList() {
    $('#noticeList').innerHTML = store.notices.map((n) => `<div class="citem${n.id === sel ? ' on' : ''}" role="listitem" tabindex="0" data-nid="${n.id}">
      <div class="nm">${esc(n.v.공고명 || '제목 없는 공고문')}</div><div class="st"><span class="pill none">${esc(n.v.구분)}</span></div>
      <div class="meta"><span>${esc(n.v.공종 || '')}</span>${n.v.추정가격 ? `<span class="num">${esc(n.v.추정가격)}원</span>` : ''}<span>${esc(L.fmtDate(new Date(n.updatedAt).toISOString()))}</span></div></div>`).join('')
      || '<div class="empty-state" style="margin:40px 16px"><p>작성한 공고문이 없습니다.</p></div>';
  }
  function render() {
    if (!$('#view-notice').classList.contains('on')) return;
    if (!sel && store.notices.length) sel = store.notices[0].id;
    renderList();
    const el = $('#noticeMain'); const n = cur();
    if (!n) {
      el.innerHTML = `<div class="empty-state"><h2>새 공고문을 시작하세요</h2><p>공종과 금액을 넣으면 업종 제한·부가세·상생결제가 자동으로 채워지고, 나라장터의 비슷한 공고에서 지역 제한·낙찰하한율 같은 조건을 배워 추천합니다.</p><button class="btn primary" data-nact="new">새 공고문</button></div>`;
      return;
    }
    const s = n.learned;
    const secs = N.SECTIONS.map((sec) => `<fieldset class="nsec"><legend>${esc(sec)}</legend><div class="ngrid">${N.FIELDS.filter((f) => f.sec === sec && f.key !== '공고명').map((f) => field(f, n)).join('')}</div>
      ${sec === '일정' && s && s.summary.입찰기간일수 ? `<div class="learn-hint">비슷한 공고는 입찰서 제출 기간이 보통 <b>${s.summary.입찰기간일수}일</b>입니다. <button type="button" class="link sm" data-nact="schedule">공고일 기준으로 일정 채우기</button> <span class="muted">법정 공고기간을 꼭 확인하세요.</span></div>` : ''}</fieldset>`).join('');
    const draft = N.draft(n.v);
    el.innerHTML = `
      <div class="nhead">
        <input id="nTitle" class="ntitle" data-key="공고명" value="${esc(n.v.공고명)}" placeholder="공고명을 입력하세요" aria-label="공고명">
        <div class="actions">
          <button class="btn primary" data-nact="hwp">한글 양식으로 만들기</button>
          <button class="btn" data-nact="copyall">문장 초안 전체 복사</button>
          ${n.lastFile ? `<button class="btn ghost" data-nact="openlast">최근 만든 파일 열기</button>` : ''}
          <span class="spacer"></span>
          <button class="btn ghost" data-nact="dup">복제</button>
          <button class="btn ghost danger" data-nact="del">삭제</button>
        </div>
      </div>
      <section class="learn">
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
        ${s && s.bids.some((b) => b.clauses && b.clauses.length) ? `<details class="bids" open><summary>실제 공고문 문장 (${s.bids.filter((b) => b.clauses && b.clauses.length).length}건)</summary>
          ${s.bids.filter((b) => b.clauses && b.clauses.length).map((b, bi) => `<div class="ref">
            <div class="ref-head"><b>${esc(b.name)}</b><span class="muted">${esc(b.org)}</span>${b.savedPath ? `<button type="button" class="link sm" data-nact="openref" data-path="${esc(b.savedPath)}">원문 열기</button>` : ''}</div>
            ${b.clauses.map((c, ci) => `<div class="dsec"><div class="dsec-head"><b>${esc(c.title)}</b><button type="button" class="link sm" data-clause="${bi}:${ci}">복사</button></div><pre>${esc(c.text)}</pre></div>`).join('')}
          </div>`).join('')}</details>` : ''}
      </section>
      <div class="ncols">
        <div class="nform">${secs}</div>
        <aside class="draft"><div class="draft-head"><h3>문장 초안</h3><span class="muted">고칠 곳은 왼쪽에서 바꾸면 바로 반영됩니다</span></div>
          ${draft.map((d, i) => `<div class="dsec"><div class="dsec-head"><b>${esc(d.title)}</b><button type="button" class="link sm" data-copy="${i}">복사</button></div><pre>${esc(d.body)}</pre></div>`).join('')}
          <p class="muted small">초안입니다. 회사 표준 공고문과 관계 법령에 맞는지 확인한 뒤 사용하세요.</p>
        </aside>
      </div>`;
  }
  // 입력할 때마다 화면 전체를 다시 그리지 않고, 초안과 자동 항목만 갱신
  function refreshLive() {
    const n = cur(); if (!n) return;
    for (const f of N.FIELDS) { const el = $(`#nf-${CSS.escape(f.key)}`); if (el && document.activeElement !== el && f.auto) el.value = n.v[f.key] || ''; }
    const draft = N.draft(n.v);
    $$('.dsec pre').forEach((p, i) => { if (draft[i]) p.textContent = draft[i].body; });
    const t = $(`.citem[data-nid="${n.id}"] .nm`); if (t) t.textContent = n.v.공고명 || '제목 없는 공고문';
  }

  async function onClick(e) {
    const a = e.target.closest('[data-nact]');
    const ap = e.target.closest('[data-apply]'), ra = e.target.closest('[data-reauto]'), cp = e.target.closest('[data-copy]');
    const it = e.target.closest('[data-nid]');
    if (it) { sel = it.dataset.nid; render(); return; }
    const n = cur();
    if (ap) { setVal(ap.dataset.apply, ap.dataset.val, true); render(); return; }
    if (ra) { n.manual[ra.dataset.reauto] = false; setVal(ra.dataset.reauto, n.v[ra.dataset.reauto], false); render(); return; }
    if (cp) { const d = N.draft(n.v)[+cp.dataset.copy]; await copy(d.title + '\n' + d.body); return; }
    const cc = e.target.closest('[data-clause]');
    if (cc) { const [bi, ci] = cc.dataset.clause.split(':').map(Number); await copy(n.learned.bids.filter((b) => b.clauses && b.clauses.length)[bi].clauses[ci].text); return; }
    if (!a) return;
    const act = a.dataset.nact;
    if (act === 'new') create();
    else if (act === 'learn') learnSimilar($('#lScope').value, Number($('#lMonths').value), $('#lKeyword').value.trim());
    else if (act === 'schedule') applySchedule();
    else if (act === 'copyall') await copy(N.draft(n.v).map((d) => (d.title === '제목' ? '' : d.title + '\n') + d.body).join('\n\n'));
    else if (act === 'openlast') S.openFile(n.lastFile).catch((err) => app().toast(err.message, 'err'));
    else if (act === 'openref') S.openFile(a.dataset.path).catch((err) => app().toast(err.message, 'err'));
    else if (act === 'dup') { const c = JSON.parse(JSON.stringify(n)); c.id = L.uid(); c.v.공고명 = (c.v.공고명 || '') + ' (복사)'; c.v.공고번호 = ''; c.lastFile = ''; c.createdAt = c.updatedAt = Date.now(); store.notices.unshift(c); sel = c.id; save(true); render(); }
    else if (act === 'del') { if (confirm('이 공고문을 삭제할까요? 만든 한글 파일은 남습니다.')) { store.notices = store.notices.filter((x) => x !== n); sel = null; save(true); render(); } }
    else if (act === 'hwp') {
      const ts = await templates();
      if (!ts.length) { app().toast('먼저 설정 → 공고문에서 한글 양식을 올려 주세요. 양식 안의 바꿀 자리에 {{공고명}}처럼 적어 두면 됩니다.', 'err', { label: '설정 열기', run: () => JH.settings.open('notice') }); return; }
      const tpl = ts.length === 1 ? ts[0].path : await pickTemplate(ts);
      if (tpl) fillTemplate(tpl);
    }
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
  view().addEventListener('click', onClick);
  view().addEventListener('input', onInput);
  view().addEventListener('focusout', onBlur);
  $('#noticeList').addEventListener('keydown', (e) => { const it = e.target.closest('[data-nid]'); if (it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sel = it.dataset.nid; render(); } });

  root.JH.notice = Object.assign(root.JH.notice, {
    async show() { await load(); render(); },
    create, templates, TPL_DIR,
    stats() { return { count: store.notices.length, recent: store.notices[0] ? store.notices[0].v.공고명 : '' }; },
    load, fillHwpxBytes,
  });
})(window);
