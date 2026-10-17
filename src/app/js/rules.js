/* 규정·질문 답변: 법령 자동 받기 + 우리 규정집 올리기 + 질문하면 근거를 찾아 PC 안 AI로 답, 고쳐 저장하면 다음부터 그 답을 씀 */
(function (root) {
  'use strict';
  const R = root.JH.rulesLogic, L = root.JH.logic, S = root.JH.server;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = () => root.JH.app;
  const KB_PATH = '규정/지식.json', QA_PATH = '규정/질문답변.json';
  let kb = { sources: [] }, qa = { items: [] }, loaded = false, idx = null, qidx = null;
  const st = { tab: 'ask', q: '', res: null, busy: false, qaFilter: '', open: null };

  async function load() {
    if (loaded || !S.online) return;
    const [k, a] = await Promise.all([S.readJson(KB_PATH).catch(() => null), S.readJson(QA_PATH).catch(() => null)]);
    if (k && Array.isArray(k.sources)) kb = k;
    if (a && Array.isArray(a.items)) qa = a;
    loaded = true; idx = qidx = null;
  }
  const saveKb = () => { idx = null; return S.writeJson(KB_PATH, kb, true); };
  const saveQa = () => { qidx = null; return S.writeJson(QA_PATH, qa, true); };
  const kbIndex = () => idx || (idx = R.makeIndex(kb.sources.flatMap((s) => s.chunks.map((c) => ({ ...c, src: s.name, kind: s.kind })))));
  const qaIndex = () => qidx || (qidx = R.makeIndex(qa.items.map((x) => ({ h: x.q, t: `${x.q}\n${x.a}`, q: x.q, a: x.a, id: x.id }))));
  const cfg = () => app().cfg;
  const ocOf = () => String(cfg().lawOC || (app().org || {}).lawOC || '').trim();

  // ---------- 법령 받기(국가법령정보센터 Open API) ----------
  async function getJson(url) {
    const t = await S.law(url);
    try { return JSON.parse(t); } catch (_) {
      const msg = String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      throw new Error(/검증|인증|OC|미신청|등록/.test(msg) ? `국가법령정보센터 사용자 확인 실패 — OC(아이디)와 Open API 활용 신청(법령·행정규칙)을 확인하세요. (${msg})` : `알 수 없는 응답: ${msg}`);
    }
  }
  async function fetchLaws(quiet) {
    const oc = ocOf();
    if (!oc) { if (!quiet) { app().toast('국가법령정보센터 OC(아이디)를 먼저 넣어 주세요.', 'err'); const i = $('#rlOc'); if (i) i.focus(); } return; }
    const list = cfg().lawList && cfg().lawList.length ? cfg().lawList : R.DEFAULT_LAWS;
    let ok = 0; const bad = [];
    try {
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        app().progress(`법령 받는 중 ${i + 1}/${list.length} — ${it.name}`, i / list.length);
        try {
          const found = R.pickLaw(await getJson(R.lawSearchUrl(oc, it.name, it.kind)), it.name, it.kind);
          if (!found) { bad.push(`${it.name}(찾지 못함)`); continue; }
          const text = R.lawText(await getJson(R.lawServiceUrl(oc, found.id, it.kind)));
          const chunks = R.splitArticles(text);
          if (!chunks.length) { bad.push(`${it.name}(본문 없음)`); continue; }
          kb.sources = kb.sources.filter((s) => !(s.auto && s.name === found.name));
          kb.sources.push({ id: L.uid(), name: found.name, kind: it.kind === 'admrul' ? '예규·고시' : '법령', auto: true, date: found.date, at: new Date().toISOString(), chunks });
          ok++;
        } catch (e) { bad.push(`${it.name}(${e.message})`); if (/사용자 확인 실패/.test(e.message)) break; }
      }
      await saveKb();
      cfg().lawFetchedAt = new Date().toISOString(); await app().saveCfg();
      if (!quiet || bad.length) app().toast(`법령·예규 ${ok}건을 받았습니다.` + (bad.length ? ` 못 받음: ${bad.join(', ')}` : ''), bad.length ? (ok ? '' : 'err') : 'ok');
    } finally { app().progress(null); if (view() && view().classList.contains('on')) render(); }
  }

  // ---------- 우리 규정집 올리기 ----------
  async function uploadRules(files) {
    let ok = 0; const bad = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        app().progress(`규정 읽는 중 ${i + 1}/${files.length} — ${f.name}`, i / files.length);
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const kind = L.kindOf(f.name);
          let lines = [];
          if (kind === 'pdf' || kind === 'hwp') lines = await root.JH.readers.fullLines(bytes, kind === 'pdf' ? 'pdf' : 'hwp');
          else if (/\.(docx|xlsx)$/i.test(f.name)) lines = root.JH.readers.officeLines(bytes);
          else if (/\.(txt|md)$/i.test(f.name)) lines = new TextDecoder('utf-8').decode(bytes).split(/\r?\n/);
          else throw new Error('한글·PDF·워드·글 파일만');
          if (kind === 'pdf' && lines.length < 30) { const more = await root.JH.readers.pdfLines(bytes, 400); if (more.length > lines.length) lines = more; }
          const chunks = R.splitArticles(lines.join('\n'));
          if (!chunks.length) throw new Error('글자를 읽지 못함(스캔본이면 한글·워드 파일로)');
          const name = f.name.replace(/\.[^.]+$/, '');
          try { await S.save('규정/원본', f.name, bytes); } catch (_) { /* 원본 보관 못 해도 읽은 내용은 씀 */ }
          kb.sources = kb.sources.filter((s) => !(s.mine && s.name === name));
          kb.sources.push({ id: L.uid(), name, kind: '우리 규정', mine: true, file: f.name, at: new Date().toISOString(), chunks });
          ok++;
        } catch (e) { bad.push(`${f.name}(${e.message})`); }
      }
      await saveKb();
      if (ok) app().toast(`규정 ${ok}개를 읽어 조 단위로 넣었습니다. 이제 질문하면 이 규정에서도 근거를 찾습니다.` + (bad.length ? ` 못 읽음: ${bad.join(', ')}` : ''), 'ok');
      else app().toast('규정을 읽지 못했습니다: ' + bad.join(', '), 'err');
    } finally { app().progress(null); render(); }
  }

  // ---------- 질문 → 근거 찾기 → PC 안 AI로 답 ----------
  async function ask(q) {
    q = String(q || '').trim(); if (!q) { app().toast('질문을 넣어 주세요.', 'err'); return; }
    st.q = q; st.busy = true;
    const hits = R.search(kbIndex(), q, 6), qaHits = R.search(qaIndex(), q, 3);
    st.res = { q, hits, qaHits, answer: '', by: '', err: '' };
    render();
    try {
      await root.JH.ai.status(true); // 질문할 때마다 PC AI 상태를 새로 확인(설치 직후에도 바로 씀)
      const who = await root.JH.ai.pick(true);
      if (!who) { st.res.err = 'PC 안 AI가 준비되지 않아 답은 만들지 못했습니다. 아래 근거와 이전 답을 보고 직접 써서 저장해도 됩니다(설정 → AI에서 PC AI 설치).'; return; }
      if (!hits.length && !qaHits.length) { st.res.err = '자료에서 관련 조항을 찾지 못했습니다. 법령을 받거나 규정집을 올렸는지 확인하세요. 직접 답을 써서 저장하면 다음부터 씁니다.'; return; }
      app().progress('PC AI가 근거를 보고 답을 쓰는 중(30초~1분)', .5);
      const r = await root.JH.ai.ask({ system: R.SYSTEM, prompt: R.prompt(q, hits, qaHits), json: false, privateData: true });
      st.res.answer = String(r.text || '').trim(); st.res.by = r.model || 'PC AI';
    } catch (e) { st.res.err = 'AI가 답하지 못했습니다: ' + e.message; }
    finally { st.busy = false; app().progress(null); render(); }
  }
  async function saveAnswer() {
    const r = st.res; if (!r) return;
    const a = ($('#rqA') || {}).value || ''; const q = ($('#rqQ') || {}).value || r.q;
    if (!a.trim()) { app().toast('저장할 답을 넣어 주세요.', 'err'); return; }
    const refs = r.hits.slice(0, 4).map((h) => `${h.d.src} ${h.d.h}`);
    const same = qa.items.find((x) => L.norm(x.q) === L.norm(q));
    if (same) { same.a = a.trim(); same.refs = refs; same.uat = new Date().toISOString(); }
    else qa.items.unshift({ id: L.uid(), q: q.trim(), a: a.trim(), refs, at: new Date().toISOString() });
    await saveQa();
    app().toast(same ? '같은 질문의 답을 고쳐 저장했습니다. 다음부터 이 답을 먼저 씁니다.' : '질문과 답을 저장했습니다. 비슷한 질문이 오면 이 답을 먼저 씁니다.', 'ok');
    render();
  }

  // ---------- 화면 ----------
  const view = () => $('#view-rules');
  function render() {
    const el = view(); if (!el) return;
    const nMine = kb.sources.filter((s) => s.mine).length, nLaw = kb.sources.filter((s) => s.auto).length;
    const nChunk = kb.sources.reduce((a, s) => a + s.chunks.length, 0);
    el.innerHTML = `<div class="rules">
      <div class="rules-head"><h2>규정·질문 답변</h2><span class="muted">법령·예규 ${nLaw}건 · 우리 규정 ${nMine}건 · 조항 ${nChunk.toLocaleString('ko-KR')}개 · 저장한 질문답변 ${qa.items.length}건 — 모두 이 PC 안에서만 처리</span>
        <div class="seg" role="tablist"><button type="button" data-rtab="ask" class="${st.tab === 'ask' ? 'on' : ''}">질문하기</button><button type="button" data-rtab="qa" class="${st.tab === 'qa' ? 'on' : ''}">질문답변 모음 ${qa.items.length}</button><button type="button" data-rtab="src" class="${st.tab === 'src' ? 'on' : ''}">자료(법령·규정)</button></div></div>
      ${st.tab === 'ask' ? askPane() : st.tab === 'qa' ? qaPane() : srcPane()}</div>`;
  }
  function askPane() {
    const r = st.res;
    const best = r && r.qaHits[0] && r.qaHits[0].score >= 0.55 ? r.qaHits[0] : null;
    return `<section class="rq">
      <label class="rq-in"><span>업체·감독부서에서 받은 질문</span><textarea id="rqQ" rows="4" placeholder="예: 준공 후에 하자보수보증금 대신 지급각서로 내도 되나요? / 선금은 계약금액의 몇 %까지 줄 수 있나요?">${esc(st.q)}</textarea></label>
      <div class="rq-acts"><button type="button" class="btn primary" data-ract="ask"${st.busy ? ' disabled' : ''}>${st.busy ? '찾는 중…' : '답 찾기'}</button><span class="muted small">질문과 규정은 밖으로 나가지 않고 PC 안 AI만 씁니다.</span></div>
      ${r ? `<div class="rq-out">
        ${best ? `<div class="rq-prev"><b>이전에 저장한 답(비슷한 질문)</b> <small class="muted">${esc(best.d.q)}</small><pre>${esc(best.d.a)}</pre><button type="button" class="link sm" data-ract="useprev">이 답으로 쓰기</button></div>` : ''}
        <label class="rq-ans"><span>답 ${r.by ? `<small class="muted">${esc(r.by)} · 근거 ${r.hits.length}개를 보고 씀 — 꼭 확인 후 쓰세요</small>` : ''}</span>
          ${r.err ? `<p class="warn-t small">${esc(r.err)}</p>` : ''}
          <textarea id="rqA" rows="12" placeholder="${st.busy ? 'PC AI가 쓰는 중…' : '답을 고치거나 직접 써서 저장하면, 다음에 비슷한 질문에 이 답을 먼저 씁니다'}">${esc(r.answer)}</textarea></label>
        <div class="rq-acts"><button type="button" class="btn primary" data-ract="save"${st.busy ? ' disabled' : ''}>질문답변에 저장(학습)</button><button type="button" class="btn ghost" data-ract="copy">답 복사</button></div>
        <h4>찾은 근거 ${r.hits.length}개</h4>
        ${r.hits.length ? `<ol class="rq-refs">${r.hits.map((h) => `<li><details><summary><b>${esc(h.d.src)}</b> ${esc(h.d.h)} <small class="muted">${esc(h.d.kind || '')}</small></summary><pre>${esc(h.d.t)}</pre></details></li>`).join('')}</ol>` : '<p class="muted small">자료에서 찾은 조항이 없습니다.</p>'}
        ${r.qaHits.length ? `<h4>비슷한 이전 질문</h4><ul class="rq-refs">${r.qaHits.map((h) => `<li><details><summary>${esc(h.d.q)}</summary><pre>${esc(h.d.a)}</pre></details></li>`).join('')}</ul>` : ''}
      </div>` : `<div class="rq-help"><p>이렇게 쓰면 됩니다.</p><ol><li>[자료]에서 법령을 받고 우리 규정집을 올립니다(한 번만).</li><li>업체·감독부서 질문을 넣고 [답 찾기] — 법령·예규·우리 규정·이전 답에서 근거를 찾아 PC 안 AI가 답합니다.</li><li>답을 확인·수정해 [질문답변에 저장]하면, 다음부터 비슷한 질문엔 그 답을 먼저 씁니다. 쓸수록 우리 기관 방식에 맞아집니다.</li></ol></div>`}
    </section>`;
  }
  function qaPane() {
    const f = L.norm(st.qaFilter);
    const items = qa.items.filter((x) => !f || L.norm(x.q + x.a).includes(f));
    return `<section class="rqa"><input type="search" id="rqaQ" placeholder="저장한 질문·답에서 찾기" value="${esc(st.qaFilter)}">
      ${items.length ? items.map((x) => `<details class="rqa-it"${st.open === x.id ? ' open' : ''} data-qid="${esc(x.id)}"><summary><b>${esc(x.q)}</b> <small class="muted">${esc(L.fmtDate((x.uat || x.at).slice(0, 10)))}</small></summary>
        <label>질문<input type="text" data-qf="q" value="${esc(x.q)}"></label><label>답<textarea data-qf="a" rows="8">${esc(x.a)}</textarea></label>
        ${x.refs && x.refs.length ? `<p class="muted small">근거: ${esc(x.refs.join(' · '))}</p>` : ''}
        <div class="rq-acts"><button type="button" class="btn sm primary" data-ract="qasave">고쳐 저장</button><button type="button" class="btn sm ghost danger" data-ract="qadel">지우기</button></div></details>`).join('')
        : `<p class="muted">${qa.items.length ? '맞는 질문이 없습니다.' : '아직 저장한 질문답변이 없습니다. [질문하기]에서 답을 저장하면 여기에 쌓입니다.'}</p>`}
      <div class="rq-acts"><button type="button" class="btn sm" data-ract="qanew">질문답변 직접 추가</button></div></section>`;
  }
  function srcPane() {
    const oc = ocOf(), list = cfg().lawList && cfg().lawList.length ? cfg().lawList : R.DEFAULT_LAWS;
    const row = (s) => `<li><b>${esc(s.name)}</b> <small class="muted">${esc(s.kind)} · 조항 ${s.chunks.length}개${s.date ? ` · 시행 ${esc(L.fmtDate(s.date))}` : ''} · ${esc(L.fmtDate(s.at.slice(0, 10)))}</small> <button type="button" class="link sm danger" data-ract="srcdel" data-sid="${esc(s.id)}">빼기</button></li>`;
    return `<section class="rsrc">
      <div class="rsrc-box"><h3>우리 규정집</h3><p class="muted small">계약 사무 처리 규정, 내부 지침, 업무 매뉴얼 등을 올리면 조(제○조) 단위로 나눠 근거로 씁니다. 한글·PDF·워드 · 같은 이름으로 다시 올리면 새 것으로 바뀝니다. 원본은 데이터 폴더 규정\\원본에 보관.</p>
        <label class="btn primary">규정 파일 올리기<input type="file" id="rlUp" accept=".hwp,.hwpx,.pdf,.docx,.txt" multiple hidden></label>
        <ul class="rsrc-list">${kb.sources.filter((s) => s.mine).map(row).join('') || '<li class="muted">아직 없음</li>'}</ul></div>
      <div class="rsrc-box"><h3>법령·예규(자동으로 받기)</h3>
        <p class="muted small">국가법령정보센터 Open API에서 아래 법령·예규 본문을 받아 둡니다. 개정되면 [다시 받기]. 처음 한 번 <b>OC</b>가 필요합니다: open.law.go.kr 회원가입 → [OPEN API 신청]에서 법령·행정규칙 활용 신청 → 가입 이메일의 @ 앞부분이 OC입니다(무료).</p>
        <div class="rsrc-oc"><label>OC(아이디)<input type="text" id="rlOc" value="${esc(oc)}" placeholder="예: yongin_contract" autocomplete="off"></label><button type="button" class="btn${kb.sources.some((s) => s.auto) ? '' : ' primary'}" data-ract="laws">${kb.sources.some((s) => s.auto) ? '다시 받기' : '법령 받기'}</button></div>
        <ul class="rsrc-list">${list.map((it) => { const got = kb.sources.find((s) => s.auto && L.norm(s.name) === L.norm(it.name)); return got ? row(got) : `<li><b>${esc(it.name)}</b> <small class="muted">${it.kind === 'admrul' ? '예규·고시' : '법령'} · 아직 안 받음</small></li>`; }).join('')}</ul>
        <details class="adv"><summary>받을 법령 바꾸기</summary><p class="muted small">한 줄에 하나, 국가법령정보센터 이름 그대로. 예규·고시·훈령은 앞에 "예규:"를 붙입니다.</p>
          <textarea id="rlList" rows="8">${esc(list.map((x) => (x.kind === 'admrul' ? '예규: ' : '') + x.name).join('\n'))}</textarea><button type="button" class="btn sm" data-ract="lawlist">목록 저장</button></details></div>
    </section>`;
  }
  function onClick(e) {
    const tb = e.target.closest('[data-rtab]'); if (tb) { st.tab = tb.dataset.rtab; render(); return; }
    const b = e.target.closest('[data-ract]'); if (!b) return;
    const a = b.dataset.ract;
    if (a === 'ask') ask(($('#rqQ') || {}).value);
    else if (a === 'save') saveAnswer();
    else if (a === 'useprev') { const best = st.res && st.res.qaHits[0]; if (best) { $('#rqA').value = best.d.a; } }
    else if (a === 'copy') { const t = ($('#rqA') || {}).value || ''; navigator.clipboard.writeText(t).then(() => app().toast('답을 복사했습니다.', 'ok'), () => app().toast('복사하지 못했습니다. 답을 직접 선택해 복사해 주세요.', 'err')); }
    else if (a === 'laws') { const v = ($('#rlOc') || {}).value; if (v != null && v.trim() !== String(cfg().lawOC || '')) { cfg().lawOC = v.trim(); app().saveCfg(); } fetchLaws(); }
    else if (a === 'lawlist') {
      const ls = (($('#rlList') || {}).value || '').split('\n').map((x) => x.trim()).filter(Boolean).map((x) => (/^(예규|고시|훈령)\s*[:：]/.test(x) ? { name: x.replace(/^[^:：]+[:：]\s*/, ''), kind: 'admrul' } : { name: x, kind: 'law' }));
      cfg().lawList = ls; app().saveCfg(); app().toast('받을 법령 목록을 저장했습니다. [다시 받기]를 누르면 이 목록으로 받습니다.', 'ok'); render();
    } else if (a === 'srcdel') { const id = b.dataset.sid; const s = kb.sources.find((x) => x.id === id); if (s && confirm(`「${s.name}」을 자료에서 뺄까요?`)) { kb.sources = kb.sources.filter((x) => x.id !== id); saveKb().then(render); } }
    else if (a === 'qasave' || a === 'qadel') {
      const box = b.closest('[data-qid]'); const it = qa.items.find((x) => x.id === box.dataset.qid); if (!it) return;
      if (a === 'qadel') { if (!confirm('이 질문답변을 지울까요?')) return; qa.items = qa.items.filter((x) => x !== it); }
      else { it.q = $('[data-qf="q"]', box).value.trim() || it.q; it.a = $('[data-qf="a"]', box).value.trim(); it.uat = new Date().toISOString(); st.open = it.id; }
      saveQa().then(() => { app().toast(a === 'qadel' ? '지웠습니다.' : '고쳐 저장했습니다.', 'ok'); render(); });
    } else if (a === 'qanew') { const it = { id: L.uid(), q: '새 질문', a: '', refs: [], at: new Date().toISOString() }; qa.items.unshift(it); st.open = it.id; render(); }
  }
  function bind() {
    const el = view(); if (!el || el.dataset.bound) return; el.dataset.bound = '1';
    el.addEventListener('click', onClick);
    el.addEventListener('change', (e) => { if (e.target.id === 'rlUp') { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) uploadRules(fs); } });
    el.addEventListener('input', (e) => { if (e.target.id === 'rqaQ') { st.qaFilter = e.target.value; const pos = e.target.selectionStart; render(); const i = $('#rqaQ'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } } });
    el.addEventListener('keydown', (e) => { if (e.target.id === 'rqQ' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ask(e.target.value); } });
  }
  async function show() { bind(); try { await load(); } catch (e) { console.warn(e); } render(); }

  root.JH.rules = { show, load, ask, uploadRules, fetchLaws, get kb() { return kb; }, get qa() { return qa; } };
})(window);
