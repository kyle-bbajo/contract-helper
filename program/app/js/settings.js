/* 설정: 나라장터 연결(인증키·기관·내 이름), 데이터 폴더, 서류 목록 편집 */
(function (root) {
  'use strict';
  const L = JH.logic, S = JH.server;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dlg = $('#dlgSettings');
  const SOURCES = ['문서함', '나라장터', '업체', '메일'];
  const SRC_LABEL = { 문서함: '문서함', 나라장터: '나라장터', 업체: '업체 제출', 메일: '메일' };
  let info = {};
  let draft = null, edType = '공사';

  function tab(name) {
    $$('.dlg-tabs button', dlg).forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $$('.tab', dlg).forEach((p) => p.classList.toggle('on', p.dataset.pane === name));
  }
  function open(name) {
    const cfg = JH.app.cfg;
    const org = JH.app.org || {};
    const usingOrgKey = org.apiKey && cfg.apiKey === org.apiKey;
    $('#cfgKey').value = usingOrgKey ? '' : (cfg.apiKey || '');
    $('#cfgKey').placeholder = org.apiKey ? '비워 두면 기관 공용 인증키를 씁니다' : '';
    $('#cfgInstt').value = cfg.insttNm || '';
    $('#cfgInsttDiv').value = cfg.insttDivCd || '1'; $('#cfgOfficer').value = cfg.officer || '';
    $('#cfgMonths').value = String(cfg.months || 6);
    $('#cfgExtNames').value = (cfg.extNames || []).join('\n');
    note('');
    draft = JSON.parse(JSON.stringify({ 공사: JH.app.lists('공사'), 용역: JH.app.lists('용역'), 물품: JH.app.lists('물품') }));
    renderRows();
    $('#dataDir').textContent = info.dataDir || '-';
    const nt = cfg.notice || {};
    $('#ntDept').value = nt.dept || ''; $('#ntPhone').value = nt.phone || ''; $('#ntRegion').value = nt.region || '경기도';
    $('#ntWinwin').value = nt.winwinMin ? Number(nt.winwinMin).toLocaleString('ko-KR') : '';
    $('#ntAiProvider').value = JH.ai.cfg().mode; $('#ntAiKey').value = nt.aiKey || ''; $('#ntAiModel').value = nt.aiModel || ''; $('#ntAiLocalModel').value = nt.aiLocalModel || '';
    showAi(false);
    $('#phKeys').innerHTML = [...JH.notice.logic.FIELDS.map((f) => f.key), '지역제한문장', '입찰참가자격', '낙찰자결정문장', '공고문전문'].map((k) => `<button type="button" class="phk" data-ph="${esc(k)}">{{${esc(k)}}}</button>`).join('');
    renderTpls();
    tab(name || 'nara');
    dlg.showModal();
  }
  function note(t, kind) { const n = $('#naraNote'); n.textContent = t; n.className = 'note' + (kind ? ' ' + kind : ''); }
  function readNara() {
    return { ...JH.app.cfg, apiKey: $('#cfgKey').value.trim() || (JH.app.org || {}).apiKey || '', insttNm: $('#cfgInstt').value.trim(), insttDivCd: $('#cfgInsttDiv').value,
      officer: $('#cfgOfficer').value.trim(), months: Number($('#cfgMonths').value) || 6,
      extNames: $('#cfgExtNames').value.split(/\n+/).map((s) => s.trim()).filter(Boolean) };
  }
  async function testNara() {
    const c = readNara();
    if (!c.apiKey) { note('인증키를 넣어 주세요.', 'err'); return false; }
    if (!c.insttNm) { note('기관명을 넣어 주세요.', 'err'); return false; }
    note('확인 중…');
    try {
      const [b, e] = L.monthRanges(1)[0];
      const r = L.parseApiBody(await S.nara(L.apiUrl(L.API_OPS.공사, c, b, e, 1, 1)));
      note(`연결됐습니다. 이번 달 ${c.insttNm} 공사 계약이 ${r.total}건 조회됩니다.`, 'ok');
      return true;
    } catch (err) { note(err.message, 'err'); return false; }
  }

  // 서류 목록 편집
  function renderRows() {
    $$('#listType button').forEach((b) => b.classList.toggle('on', b.dataset.type === edType));
    $('#edRows').innerHTML = draft[edType].map((x, i) => `<div class="ed-row" data-i="${i}">
      <input type="text" data-k="group" value="${esc(x.group)}" aria-label="단계">
      <input type="text" data-k="name" value="${esc(x.name)}" aria-label="서류">
      <input type="text" data-k="kw" value="${esc(x.keywords.join(', '))}" aria-label="찾을 단어">
      <select data-k="source" aria-label="받는 곳">${SOURCES.map((s) => `<option value="${s}"${s === x.source ? ' selected' : ''}>${SRC_LABEL[s]}</option>`).join('')}</select>
      <input type="checkbox" data-k="req"${x.required ? ' checked' : ''} aria-label="필수">
      <span class="mv"><button type="button" class="x" data-mv="-1" aria-label="위로">↑</button><button type="button" class="x" data-mv="1" aria-label="아래로">↓</button><button type="button" class="x" data-rm aria-label="삭제">✕</button></span>
    </div>`).join('');
  }
  function syncRows() {
    $$('#edRows .ed-row').forEach((r) => {
      const x = draft[edType][+r.dataset.i];
      x.group = $('[data-k=group]', r).value.trim(); x.name = $('[data-k=name]', r).value.trim();
      x.keywords = $('[data-k=kw]', r).value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      x.source = $('[data-k=source]', r).value; x.required = $('[data-k=req]', r).checked;
    });
  }

  $$('.dlg-tabs button', dlg).forEach((b) => b.addEventListener('click', () => tab(b.dataset.tab)));
  $('#btnSettings').onclick = () => open();
  $('#btnTestNara').onclick = testNara;
  $('#cfgExtNames').addEventListener('change', async () => { JH.app.cfg.extNames = readNara().extNames; await JH.app.saveCfg(); JH.app.render(); JH.app.toast('외부 예산 사업 이름을 저장했습니다.', 'ok'); });
  $('#btnSaveNara').onclick = async () => {
    const c = readNara();
    if (!(await testNara())) return;
    JH.app.cfg = c; await JH.app.saveCfg(); JH.app.banner('');
    dlg.close(); JH.app.fetchContracts(true);
  };
  $('#btnOpenData').onclick = () => S.open('').catch((e) => JH.app.toast(e.message, 'err'));
  $('#btnPickData').onclick = async () => {
    try {
      const r = await S.pickFolder();
      if (r.ok) { info.dataDir = r.dataDir; $('#dataDir').textContent = r.dataDir; JH.app.toast('데이터 폴더를 바꿨습니다. 새 폴더 기준으로 다시 엽니다.', 'ok'); setTimeout(() => location.reload(), 900); }
    } catch (e) { JH.app.toast('폴더를 바꾸지 못했습니다: ' + e.message, 'err'); }
  };
  $('#listType').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; syncRows(); edType = b.dataset.type; renderRows(); });
  $('#edRows').addEventListener('click', (e) => {
    const r = e.target.closest('.ed-row'); const mv = e.target.closest('[data-mv]'), rm = e.target.closest('[data-rm]');
    if (!r || (!mv && !rm)) return;
    syncRows(); const rows = draft[edType], i = +r.dataset.i;
    if (mv) { const j = i + Number(mv.dataset.mv); if (j >= 0 && j < rows.length) [rows[i], rows[j]] = [rows[j], rows[i]]; }
    else rows.splice(i, 1);
    renderRows();
  });
  $('#btnAddRow').onclick = () => {
    syncRows(); const rows = draft[edType], last = rows[rows.length - 1];
    rows.push({ id: (edType === '공사' ? 'c-' : 's-') + L.uid(), group: last ? last.group : '기타', name: '새 서류', keywords: [], required: false, source: '업체', note: '' });
    renderRows(); const ins = $$('#edRows [data-k=name]'); ins[ins.length - 1].select();
  };
  $('#btnResetLists').onclick = () => { if (confirm('공사·용역 서류 목록을 「전자·서면계약 구비서류 안내」 기준으로 되돌릴까요?')) { draft = L.defaultChecklists(); renderRows(); } };
  $('#btnSaveLists').onclick = async () => {
    syncRows();
    for (const t of Object.keys(draft)) draft[t] = draft[t].filter((x) => x.name);
    await JH.app.setChecklists(draft); JH.app.render(); JH.app.toast('서류 목록을 저장했습니다.', 'ok');
  };
  // 입찰공고·견적공고 기본 양식 칸
  let slotKind = null;
  async function renderSlots() {
    const el = $('#tplSlots'); if (!el) return;
    if (!S.online) { el.innerHTML = '<p class="muted">바탕화면 아이콘으로 실행하면 양식을 올릴 수 있습니다.</p>'; return; }
    const xs = await JH.notice.slotInfo();
    el.innerHTML = xs.map((x) => `<div class="tpl-slot${x.has ? ' on' : ''}">
      <div class="ts-head"><b>${esc(x.kind)} 양식</b>${x.has ? `<span class="ok-t">올림</span>` : '<span class="warn-t">아직 없음</span>'}</div>
      <div class="ts-body">${x.has ? `${esc(x.name || '')}${x.at ? ` <span class="muted">· ${esc(L.fmtDate(x.at))}</span>` : ''}${x.found && x.found.length ? `<div class="muted small">바꿀 자리: ${esc(x.found.map((k) => ({ 현장: '장소', 입찰기간: '제출 기간', 지역제한: '지역', 업종제한: '업종', 낙찰하한율: '하한율' }[k] || k)).join('·'))}</div>` : ''}` : `<span class="muted">${x.kind === '견적공고' ? '수의계약(2인 이상 견적)' : '경쟁입찰'} 공고문에 씁니다</span>`}</div>
      <div class="ts-acts"><button type="button" class="btn sm${x.has ? '' : ' primary'}" data-slotup="${esc(x.kind)}">${x.has ? '바꾸기' : '올리기'}</button>${x.has ? `<button type="button" class="link sm" data-tplopen="${esc(x.path)}">한글로 열기</button>` : ''}</div></div>`).join('');
  }
  $('#tplSlots').addEventListener('click', (e) => {
    const u = e.target.closest('[data-slotup]'); if (u) { slotKind = u.dataset.slotup; $('#tplSlotIn').click(); return; }
    const o = e.target.closest('[data-tplopen]'); if (o) S.openFile(o.dataset.tplopen).catch((err) => JH.app.toast(err.message, 'err'));
  });
  $('#tplSlotIn').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f || !slotKind) return;
    try { await JH.notice.uploadSlot(slotKind, f); } catch (err) { JH.app.toast('양식을 올리지 못했습니다: ' + err.message, 'err'); }
    renderSlots();
  };
  async function renderTpls() {
    renderSlots();
    const ts = S.online ? await JH.notice.templates() : [];
    $('#tplFiles').innerHTML = ts.length ? ts.map((t) => `<div class="tpl-row"><span>${esc(t.path.split('/').pop())}</span><button type="button" class="link sm" data-tplopen="${esc(t.path)}">한글로 열기</button><button type="button" class="x" data-tpldel="${esc(t.path)}" aria-label="양식 빼기">✕</button></div>`).join('')
      : '<p class="muted">올린 양식이 없습니다.</p>';
  }
  $('#btnSaveNotice').onclick = async () => {
    const c = JH.app.cfg;
    c.notice = { ...(c.notice || {}), dept: $('#ntDept').value.trim(), phone: $('#ntPhone').value.trim(), region: $('#ntRegion').value,
      winwinMin: Number($('#ntWinwin').value.replace(/[^\d]/g, '')) || 0 };
    await JH.app.saveCfg(); JH.app.toast('공고문 설정을 저장했습니다. 담당 정보·기준 금액은 새 공고문부터 적용됩니다.', 'ok');
    if (JH.notice && JH.notice.refresh) JH.notice.refresh();
  };
  // AI
  async function showAi(force) {
    const el = $('#aiState'); if (!el) return;
    if (!S.online) { el.textContent = '바탕화면 아이콘으로 실행하면 PC AI 상태를 볼 수 있습니다.'; return; }
    const st = await JH.ai.status(force);
    el.className = 'ai-state' + (st.ready ? ' ok' : st.state === 'error' ? ' err' : '');
    el.textContent = JH.ai.statusText(st) + (st.cloud ? ' · Gemini·Claude 키 있음' : '');
    if (!st.ready && ['download', 'install', 'pull'].includes(st.state) && $('#dlgSettings').open) setTimeout(() => showAi(true), 3000);
  }
  $('#btnAiCheck').onclick = () => showAi(true);
  $('#btnAiSetup').onclick = async () => {
    try { await JH.ai.setup(); JH.app.toast('PC AI 설치를 시작했습니다. 뒤에서 내려받으며, 이 화면에 진행 상황이 보입니다.', 'ok'); setTimeout(() => showAi(true), 1500); }
    catch (e) { JH.app.toast('PC AI 설치를 시작하지 못했습니다: ' + e.message, 'err'); }
  };
  $('#btnSaveAi').onclick = async () => {
    const c = JH.app.cfg;
    c.notice = { ...(c.notice || {}), aiProvider: $('#ntAiProvider').value, aiKey: $('#ntAiKey').value.trim(), aiModel: $('#ntAiModel').value.trim(), aiLocalModel: $('#ntAiLocalModel').value.trim() };
    await JH.app.saveCfg(); JH.ai.reset(); JH.app.toast('AI 설정을 저장했습니다.', 'ok'); showAi(true);
    if (JH.notice && JH.notice.refresh) JH.notice.refresh();
  };
  $('#phKeys').addEventListener('click', async (e) => { const b = e.target.closest('[data-ph]'); if (!b) return; try { await navigator.clipboard.writeText(`{{${b.dataset.ph}}}`); JH.app.toast(`{{${b.dataset.ph}}} 복사했습니다.`, 'ok'); } catch (_) {} });
  $('#btnAddTpl').onclick = () => $('#tplIn').click();
  $('#tplIn').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (/\.hwpx$/i.test(f.name)) {
        const z = root.CFB.read(bytes, { type: 'array' });
        const keys = new Set();
        z.FullPaths.forEach((p, i) => { if (/\/Contents\/section\d+\.xml$/i.test(p)) JH.notice.logic.placeholdersIn(new TextDecoder().decode(new Uint8Array(z.FileIndex[i].content))).forEach((k) => keys.add(k)); });
        JH.app.toast(keys.size ? `양식에서 {{항목}} ${keys.size}개를 찾았습니다: ${[...keys].slice(0, 8).join(', ')}${keys.size > 8 ? ' …' : ''}` : '양식에서 {{항목}} 표시를 찾지 못했습니다. 바뀌는 자리에 {{공고명}}처럼 적어 주세요.', keys.size ? 'ok' : 'err');
      }
      await S.save(JH.notice.TPL_DIR, f.name, bytes); renderTpls();
    } catch (err) { JH.app.toast('양식을 올리지 못했습니다: ' + err.message, 'err'); }
  };
  $('#tplFiles').addEventListener('click', async (e) => {
    const o = e.target.closest('[data-tplopen]'), d = e.target.closest('[data-tpldel]');
    if (o) fetch(`/api/open?${new URLSearchParams({ path: o.dataset.tplopen, launch: '1' })}`, { method: 'POST', headers: { 'X-JH-Token': S.token } });
    if (d && confirm('이 양식을 뺄까요? 파일은 _삭제됨으로 옮겨집니다.')) { await S.remove(d.dataset.tpldel); renderTpls(); }
  });
  $('#btnQuit').onclick = async () => { if (!confirm('프로그램을 종료할까요? 다시 쓰려면 바탕화면의 계약업무 도우미를 누르세요.')) return; try { await S.quit(); } catch (_) {} window.close(); };

  root.JH.settings = {
    open,
    setInfo(i) { info = i || {}; $('#aboutVer').textContent = info.version || '-'; $('#aboutDir').textContent = info.dataDir || '-'; $('#dataDir').textContent = info.dataDir || '-'; },
  };
})(window);
