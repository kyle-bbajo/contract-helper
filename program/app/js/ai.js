/* AI 연결 — PC 안 AI(Ollama, 설치 때 함께 깔림)가 기본, 키를 넣으면 Gemini(무료)·Claude도 씀
 *  - 서류 내용(업체 주소·대표자 등)은 PC 안 AI로만 보냄(privateData: true)
 *  - 공고문 문장처럼 공개되는 글은 설정에 따라: 자동 = 키가 있으면 Gemini, 없으면 PC AI */
(function (root) {
  'use strict';
  const S = () => root.JH.server;
  const app = () => root.JH.app;
  const LOCAL = 'http://127.0.0.1:11434';
  const DEFAULT_LOCAL = 'gemma3:4b';
  const DEFAULT_CLOUD = { gemini: 'gemini-2.5-flash', claude: 'claude-sonnet-5-5' };
  const STATE_LABEL = { download: 'AI 프로그램 내려받는 중', install: 'AI 프로그램 설치 중', pull: '한국어 AI 모델 내려받는 중', ready: '준비됨', error: '설치 못 함' };

  function cfg() {
    const nt = (app() && app().cfg.notice) || {};
    const mode = ['auto', 'local', 'gemini', 'claude'].includes(nt.aiProvider) ? nt.aiProvider : 'auto';
    return { mode, key: (nt.aiKey || '').trim(), model: (nt.aiModel || '').trim(), localModel: (nt.aiLocalModel || '').trim() || DEFAULT_LOCAL };
  }
  // 클라우드 쪽 종류(자동이면 Gemini)
  const cloudOf = (c) => (c.mode === 'claude' ? 'claude' : 'gemini');

  let cache = null, cacheAt = 0;
  async function status(force) {
    if (!force && cache && Date.now() - cacheAt < 8000) return cache;
    const c = cfg();
    const out = { localModel: c.localModel, installed: false, running: false, ready: false, state: '', pct: -1, msg: '', cloud: !!c.key };
    try {
      if (S().aiStatus) { const s = await S().aiStatus(); out.installed = !!s.installed; if (s.status) { out.state = s.status.state || ''; out.pct = s.status.pct; out.msg = s.status.msg || ''; } }
    } catch (_) { /* 연결 창구가 예전 버전 */ }
    if (!out.installed && !S().localTags && out.state !== 'ready') { cache = out; cacheAt = Date.now(); return out; } // 설치 전이면 127.0.0.1:11434를 두드리지 않음
    try {
      const tags = S().localTags ? await S().localTags() : await (await fetch(LOCAL + '/api/tags', { signal: AbortSignal.timeout(2500) })).json();
      out.running = true; out.installed = true;
      out.ready = (tags.models || []).some((m) => m.name === c.localModel || m.model === c.localModel || m.name === c.localModel + ':latest');
    } catch (_) { /* 꺼져 있거나 설치 전 */ }
    cache = out; cacheAt = Date.now();
    return out;
  }
  const statusText = (s) => (s.ready ? `PC AI 준비됨 (${s.localModel})`
    : s.state && s.state !== 'ready' ? `PC AI: ${STATE_LABEL[s.state] || s.state}${s.pct >= 0 && s.state === 'pull' ? ` ${s.pct}%` : ''}${s.state === 'error' && s.msg ? ` — ${s.msg}` : ''}`
      : s.running ? `PC AI: 모델(${s.localModel})이 아직 없습니다` : 'PC AI: 설치되지 않았거나 꺼져 있습니다');

  // 지금 쓸 AI: 'local' | 'gemini' | 'claude' | null
  async function pick(privateData) {
    const c = cfg(), s = await status();
    if (privateData) return s.ready ? 'local' : null;
    if (c.mode === 'local') return s.ready ? 'local' : null;
    if (c.mode === 'gemini' || c.mode === 'claude') return c.key ? c.mode : s.ready ? 'local' : null;
    return c.key ? cloudOf(c) : s.ready ? 'local' : null; // 자동
  }
  const label = (p) => ({ local: 'PC AI', gemini: 'Gemini', claude: 'Claude' }[p] || 'AI');

  // 답 글자만 돌려줌. json: true면 JSON으로 답하게 함
  async function ask({ system, prompt, json = true, privateData = false }) {
    const p = await pick(privateData);
    if (!p) throw new Error(privateData ? 'PC 안 AI가 아직 준비되지 않았습니다(설정 → AI에서 상태 확인).' : 'AI가 준비되지 않았습니다.');
    const c = cfg();
    if (p === 'local') {
      const body = { model: c.localModel, stream: false, keep_alive: '15m', options: { temperature: 0.2, num_ctx: 16384 },
        messages: [{ role: 'system', content: system || '' }, { role: 'user', content: prompt }] };
      if (json) body.format = 'json';
      const r = S().localChat ? await S().localChat(body) : await (async () => {
        const res = await fetch(LOCAL + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error('PC AI 응답 오류 ' + res.status);
        return res.json();
      })();
      return { text: (r.message && r.message.content) || '', model: c.localModel, by: 'local' };
    }
    const model = c.model || DEFAULT_CLOUD[p];
    const r = await S().ai({ provider: p, key: c.key, model, system, prompt });
    const text = r && r.content ? r.content.filter((x) => x.type === 'text').map((x) => x.text).join('')
      : r && r.candidates && r.candidates[0] && r.candidates[0].content ? (r.candidates[0].content.parts || []).map((x) => x.text || '').join('') : '';
    return { text, model: r.model || r.modelVersion || model, by: p };
  }
  // 답에서 JSON 꺼내기(앞뒤 설명·```json 감싸기 허용)
  function json(text) {
    const t = String(text || '').replace(/```(?:json)?/gi, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('AI 답에서 JSON을 찾지 못했습니다.');
    return JSON.parse(t.slice(a, b + 1));
  }
  async function setup() { const c = cfg(); await S().aiSetup({ model: c.localModel }); cache = null; }

  root.JH = root.JH || {};
  root.JH.ai = { cfg, status, statusText, pick, label, ask, json, setup, DEFAULT_LOCAL, DEFAULT_CLOUD, reset: () => { cache = null; } };
})(window);
