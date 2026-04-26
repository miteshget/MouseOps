'use strict';

// ── State ──────────────────────────────────────────────────────────────────────
const streams       = {};   // ciId → { es, mod, stage, resolve }
const runHistory    = {};   // ciId → { [module]: { solve, validate } }
const seqFlags      = {};   // ciId → true means user requested stop
const skipResolvers = {};   // ciId → resolve fn waiting for skip/stop decision
const SEQ_PROG_KEY  = 'seq-progress';  // localStorage prefix for sequential run progress
let editingId   = null;
let openLogCiId = null;

// ── API helpers ────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  try {
    const res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body:    body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(msg);
    }
    return res.json();
  } catch (err) {
    showToast(err.message || 'API request failed');
    throw err;
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────
async function boot() {
  const cis = await api('GET', '/cis');
  renderAll(cis);
  loadHistory(cis);
  await reconnectActiveRuns();
}

async function reconnectActiveRuns() {
  let active;
  try {
    const res = await fetch('/api/active-runs');
    if (!res.ok) return;
    active = await res.json();
  } catch { return; }

  for (const run of active) {
    const card = document.getElementById('card-' + run.ci_id);
    if (!card || streams[run.ci_id]) continue;

    // Check if this was part of a sequential run
    const seqState = JSON.parse(localStorage.getItem(`${SEQ_PROG_KEY}-${run.ci_id}`) || 'null');

    if (seqState) {
      // Lock card UI exactly as _runSeqLoop would have done
      card.querySelectorAll('.seq-btn').forEach(b => b.disabled = true);
      card.querySelector('.btn-solve').disabled    = true;
      card.querySelector('.btn-validate').disabled = true;
      const _fe = card.querySelector('.seq-from');
      const _te = card.querySelector('.seq-to');
      if (_fe) _fe.disabled = true;
      if (_te) _te.disabled = true;
      showToast(`Reconnecting sequential ${seqState.mode} at ${run.module}…`, 'info');
    }

    // Reconnect — backend replays buffer then continues live
    const p = startStream(run.ci_id, run.stage, run.module);

    // Prepend persisted log after a short delay so the user sees history
    setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/logs/${run.ci_id}/${run.stage}/${encodeURIComponent(run.module)}`
        );
        if (!res.ok) return;
        const hist = await res.text();
        const logEl = card.querySelector('.log-content');
        if (logEl && hist.trim()) {
          logEl.textContent = hist + '\n─── reconnected ───\n' + logEl.textContent;
        }
      } catch { /* ignore */ }
    }, 300);

    if (seqState) {
      // When current module finishes, resume sequential run from the next module
      p.then(outcome => {
        const nextIdx = seqState.currentIdx + 1;
        if (outcome === 'ok' && nextIdx < seqState.mods.length && !seqFlags[run.ci_id]) {
          showToast(`Resuming sequential ${seqState.mode} from ${seqState.mods[nextIdx]}`, 'info');
          _runSeqLoop(run.ci_id, seqState.mode, seqState.mods, nextIdx);
        } else {
          // Stopped, failed, or finished — clear saved progress and unlock
          localStorage.removeItem(`${SEQ_PROG_KEY}-${run.ci_id}`);
          const c = document.getElementById('card-' + run.ci_id);
          if (c) {
            c.querySelectorAll('.seq-btn').forEach(b => b.disabled = false);
            c.querySelector('.btn-solve').disabled    = false;
            c.querySelector('.btn-validate').disabled = false;
            const fe = c.querySelector('.seq-from');
            const te = c.querySelector('.seq-to');
            if (fe) fe.disabled = false;
            if (te) te.disabled = false;
            c.querySelector('.stop-btn').style.display = 'none';
          }
        }
      });
    }
  }
}

// ── Render ─────────────────────────────────────────────────────────────────────
function renderAll(cis) {
  const grid  = document.getElementById('ci-grid');
  const empty = document.getElementById('empty-state');
  if (!cis.length) {
    grid.style.display  = 'none';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  grid.style.display  = '';

  const newIds = new Set(cis.map(c => c.id));
  grid.querySelectorAll('.ci-card').forEach(card => {
    if (!newIds.has(card.dataset.ciId)) card.remove();
  });
  cis.forEach(ci => {
    const existing = document.getElementById('card-' + ci.id);
    const isActive = streams[ci.id] || (ci.id in seqFlags);
    if (!existing) {
      grid.appendChild(buildCard(ci));
    } else if (!isActive) {
      existing.replaceWith(buildCard(ci));
    }
  });
}

function buildCard(ci) {
  const card = document.createElement('div');
  card.className    = 'ci-card';
  card.id           = 'card-' + ci.id;
  card.dataset.ciId = ci.id;

  const mods = ci.modules || [];
  card.dataset.modules = mods.join(',');   // used by renderModuleSummary for stale detection

  const modWidget = mods.length
    ? `<select class="module-select">${mods.map(m => `<option value="${x(m)}">${x(m)}</option>`).join('')}</select>`
    : `<input class="module-text" type="text" placeholder="module-01" value="module-01">`;

  const seqFromWidget = mods.length > 1
    ? `<span class="seq-from-label">from</span>` +
      `<select class="seq-from">${mods.map(m => `<option value="${x(m)}">${x(m)}</option>`).join('')}</select>` +
      `<span class="seq-from-label">to</span>` +
      `<select class="seq-to">${mods.map((m, i) => `<option value="${x(m)}"${i === mods.length - 1 ? ' selected' : ''}>${x(m)}</option>`).join('')}</select>`
    : `<span class="seq-from-label">from</span>` +
      `<input class="seq-from" type="number" min="0" max="99" value="0" style="width:54px">` +
      `<span class="seq-from-label">to</span>` +
      `<input class="seq-to" type="number" min="0" max="99" value="21" style="width:54px">`;

  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">${x(ci.name)}</div>
        <div class="card-url">${x(ci.url)}</div>
      </div>
      <div class="card-header-btns">
        <button class="btn-icon" title="Load last log" onclick="loadLastLog('${ci.id}')">📄</button>
        <button class="btn-icon" title="Clear results" onclick="clearResults('${ci.id}')">🗑</button>
        <button class="btn-icon" title="Edit" onclick="openEditModal('${ci.id}')">✎</button>
        <button class="btn-icon btn-danger" title="Remove" onclick="removeCI('${ci.id}')">✕</button>
      </div>
    </div>
    <div class="card-body">
      <div class="section-label section-label-individual">Individual Execution</div>
      <div class="individual-box">
        <div class="module-row">
          <span class="module-label">Module:</span>
          ${modWidget}
        </div>
        <div class="action-row">
          <button class="btn btn-solve btn-sm"    onclick="startStream('${ci.id}','solve')">🚀 Solve</button>
          <button class="btn btn-validate btn-sm" onclick="startStream('${ci.id}','validate')">✓ Validate</button>
        </div>
      </div>
      <div class="section-label section-label-sequential" style="margin-top:0.7rem">Sequential Execution</div>
      <div class="seq-row">
        <div class="seq-range-row"><span class="module-label">Range:</span>${seqFromWidget}</div>
        <div class="seq-action-row">
          <button class="btn btn-solve   btn-sm seq-btn" onclick="runSequential('${ci.id}','solve')"   >▶ Solve</button>
          <button class="btn btn-validate btn-sm seq-btn" onclick="runSequential('${ci.id}','validate')">▶ Validate</button>
          <button class="btn btn-seq     btn-sm seq-btn" onclick="runSequential('${ci.id}','both')"    >▶▶ Both</button>
          <button class="btn btn-ghost   btn-sm stop-btn" style="display:none" onclick="userStop('${ci.id}')">■ Stop</button>
        </div>
      </div>
      <div class="module-history" style="display:none"></div>
      <div class="ci-status">⏸ Idle</div>
      <div class="skip-section" style="display:none">
        <span class="skip-msg"></span>
        <button class="btn btn-sm btn-ghost"   onclick="resolveSkip('${ci.id}','rerun')">🔄 Rerun</button>
        <button class="btn btn-sm btn-seq"     onclick="resolveSkip('${ci.id}','skip')">⏭ Skip &amp; Continue</button>
        <button class="btn btn-sm btn-danger"  onclick="resolveSkip('${ci.id}','stop')">■ Stop</button>
      </div>
      <ul class="step-list"></ul>
      <details class="log-wrap" style="display:none">
        <summary class="log-summary">Show logs
          <button class="btn-expand-log" title="Expand" onclick="openLogModal('${ci.id}');event.preventDefault()">⤢</button>
        </summary>
        <pre class="log-content"></pre>
      </details>
    </div>`;
  return card;
}

function x(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Stream ─────────────────────────────────────────────────────────────────────
function getModule(ciId) {
  const card = document.getElementById('card-' + ciId);
  const sel  = card.querySelector('.module-select');
  const inp  = card.querySelector('.module-text');
  return (sel ? sel.value : inp ? inp.value : '').trim() || 'module-01';
}

function startStream(ciId, stage, modOverride = null) {
  const mod  = modOverride !== null ? modOverride : getModule(ciId);
  const card = document.getElementById('card-' + ciId);
  if (!card) return Promise.resolve('fail');

  stopStream(ciId);

  const stepList = card.querySelector('.step-list');
  const logWrap  = card.querySelector('.log-wrap');
  const logEl    = card.querySelector('.log-content');
  const statusEl = card.querySelector('.ci-status');
  const stopBtn  = card.querySelector('.stop-btn');
  const solveBtn = card.querySelector('.btn-solve');
  const validBtn = card.querySelector('.btn-validate');

  stepList.innerHTML    = '';
  logEl.textContent     = '';
  logWrap.style.display = '';
  logWrap.open          = false;

  statusEl.className    = 'ci-status running';
  statusEl.innerHTML    = `<span class="spinner"></span> Running ${stage} on ${mod}…`;
  solveBtn.disabled     = true;
  validBtn.disabled     = true;
  stopBtn.style.display = '';
  card.className        = 'ci-card is-running';

  const stepOffsetCount = stepList.querySelectorAll('.sp-step').length;
  setModuleState(ciId, mod, stage, 'running');

  let resolve;
  const promise = new Promise(r => { resolve = r; });
  const es = new EventSource(`/api/stream/${ciId}/${stage}/${encodeURIComponent(mod)}`);
  streams[ciId] = { es, mod, stage, resolve };

  let stepState = { currentTask: null, pendingLi: null };

  es.onmessage = (evt) => {
    if (evt.data === '__DONE__' || evt.data === '__DONE_FAIL__') {
      es.close();
      delete streams[ciId];
      const forceFail = evt.data === '__DONE_FAIL__' ? 'fail' : null;
      if (forceFail) logWrap.open = true;
      const outcome = finalize(ciId, mod, stage, stepOffsetCount, stepList, statusEl, solveBtn, validBtn, stopBtn, card, forceFail);
      resolve(outcome);
      return;
    }
    let line;
    try { line = JSON.parse(evt.data); } catch { line = evt.data; }
    line = String(line);

    logEl.textContent += line + '\n';
    logEl.scrollTop    = logEl.scrollHeight;
    if (openLogCiId === ciId) {
      const mp = document.getElementById('log-modal-pre');
      mp.textContent += line + '\n';
      mp.scrollTop    = mp.scrollHeight;
    }
    stepState = parseSolveLine(line, stepList, stepState);
    parseValidationMsg(line, stepList);
  };

  es.onerror = () => {
    es.close();
    delete streams[ciId];
    logEl.textContent += '\n❌ Stream connection lost\n';
    finalize(ciId, mod, stage, stepOffsetCount, stepList, statusEl, solveBtn, validBtn, stopBtn, card, 'fail');
    resolve('fail');
  };

  return promise;
}

function stopStream(ciId) {
  const entry = streams[ciId];
  if (!entry) return;
  entry.es.close();
  if (entry.resolve) entry.resolve('stopped');
  delete streams[ciId];
  setModuleState(ciId, entry.mod, entry.stage, null);
  const card = document.getElementById('card-' + ciId);
  if (!card) return;
  card.querySelector('.btn-solve').disabled    = false;
  card.querySelector('.btn-validate').disabled = false;
  card.querySelector('.stop-btn').style.display = 'none';
  const statusEl = card.querySelector('.ci-status');
  statusEl.className   = 'ci-status';
  statusEl.textContent = '⏸ Stopped';
  card.className = 'ci-card';
}

function finalize(ciId, mod, stage, stepOffsetCount, stepList, statusEl, solveBtn, validBtn, stopBtn, card, forceOutcome = null) {
  solveBtn.disabled     = false;
  validBtn.disabled     = false;
  stopBtn.style.display = 'none';

  const allSteps = Array.from(stepList.querySelectorAll('.sp-step'));
  const thisRun  = allSteps.slice(stepOffsetCount);
  const failed   = thisRun.filter(li => li.classList.contains('sp-step-fail')).length;
  const ok       = thisRun.filter(li => li.classList.contains('sp-step-ok') || li.classList.contains('sp-step-changed')).length;
  const total    = thisRun.length;

  const outcome = forceOutcome || (failed > 0 ? 'fail' : 'ok');
  setModuleState(ciId, mod, stage, outcome);

  if (failed > 0 || forceOutcome === 'fail') {
    statusEl.className   = 'ci-status failed';
    statusEl.textContent = `❌ ${stage} failed — ${failed} task(s) failed`;
    card.className = 'ci-card is-failed';
  } else if (total > 0) {
    statusEl.className   = 'ci-status success';
    statusEl.textContent = `✅ ${stage} completed — ${ok} task(s) OK`;
    card.className = 'ci-card is-success';
  } else {
    statusEl.className   = 'ci-status';
    statusEl.textContent = `⏸ ${stage} completed`;
    card.className = 'ci-card';
  }
  return outcome;
}

// ── Ansible output parsing ─────────────────────────────────────────────────────
const ANSI_RE   = /\x1b\[[0-9;]*m/g;
const SKIP_TASK = /^Gathering Facts$|^Build task results|^set_fact|^Validate all tasks$/i;

function stripAnsi(s) { return s.replace(ANSI_RE, ''); }

function parseSolveLine(line, stepList, state) {
  const clean = stripAnsi(line);
  const tm    = clean.match(/TASK \[([^\]]+)\]/);
  if (tm) {
    const name = tm[1].trim();
    if (SKIP_TASK.test(name)) return { currentTask: null, pendingLi: null };
    const li = document.createElement('li');
    li.className   = 'sp-step sp-step-pending';
    li.textContent = name;
    stepList.appendChild(li);
    return { currentTask: name, pendingLi: li };
  }
  const { pendingLi } = state;
  if (!pendingLi) return state;
  if      (/^ok:\s*\[/i.test(clean))           pendingLi.className = 'sp-step sp-step-ok';
  else if (/^changed:\s*\[/i.test(clean))       pendingLi.className = 'sp-step sp-step-changed';
  else if (/^(fatal|failed):/i.test(clean))     pendingLi.className = 'sp-step sp-step-fail';
  else if (/^skipping:\s*\[/i.test(clean))      pendingLi.remove();
  return state;
}

function parseValidationMsg(line, stepList) {
  const clean = stripAnsi(line).trim();
  const m     = clean.match(/"msg":\s*"(.+)"$/);
  if (!m) return;
  const msg = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  msg.split('\n').forEach(part => {
    const t = part.trim();
    if (!t) return;
    const li = document.createElement('li');
    li.className   = /^✅/.test(t) ? 'sp-step sp-step-ok'
                   : /^❌/.test(t) ? 'sp-step sp-step-fail'
                   : 'sp-step sp-step-pending';
    li.textContent = t;
    stepList.appendChild(li);
  });
}

// ── Sequential run ─────────────────────────────────────────────────────────────
function userStop(ciId) {
  seqFlags[ciId] = true;
  stopStream(ciId);
  resolveSkip(ciId, 'stop');
}

function awaitSkipDecision(ciId, msg) {
  const card = document.getElementById('card-' + ciId);
  if (!card) return Promise.resolve('stop');
  const section = card.querySelector('.skip-section');
  section.querySelector('.skip-msg').textContent = msg;
  section.style.display = '';
  return new Promise(resolve => { skipResolvers[ciId] = resolve; });
}

function resolveSkip(ciId, decision) {
  const resolve = skipResolvers[ciId];
  if (!resolve) return;
  delete skipResolvers[ciId];
  const card = document.getElementById('card-' + ciId);
  if (card) card.querySelector('.skip-section').style.display = 'none';
  resolve(decision);
}

// Runs a single stage (solve or validate) for one module, handling rerun/skip/stop.
// Returns: 'ok' | 'skip' | 'stop'
async function runStage(ciId, stage, mod, idx, total, statusEl) {
  while (true) {
    const p = startStream(ciId, stage, mod);
    const label = stage === 'solve' ? 'Solving' : 'Validating';
    statusEl.innerHTML = `<span class="spinner"></span> [${idx + 1}/${total}] ${label} ${mod}…`;
    const result = await p;

    if (seqFlags[ciId] || result === 'stopped') return 'stop';
    if (result === 'ok') return 'ok';

    const d = await awaitSkipDecision(ciId, `${stage} failed on ${mod}`);
    if (d === 'stop')  return 'stop';
    if (d === 'skip')  return 'skip';
    // 'rerun' — loop back and retry this stage
  }
}

function setCardModule(ciId, mod) {
  const card = document.getElementById('card-' + ciId);
  if (!card) return;
  const sel = card.querySelector('.module-select');
  const inp = card.querySelector('.module-text');
  if (sel) sel.value = mod;
  else if (inp) inp.value = mod;
}

async function runSequential(ciId, mode = 'both') {
  const cis  = await api('GET', '/cis');
  const ci   = cis.find(c => c.id === ciId);
  const card = document.getElementById('card-' + ciId);
  if (!card) return;

  const fromEl = card.querySelector('.seq-from');
  const toEl   = card.querySelector('.seq-to');
  const ciMods = ci && ci.modules && ci.modules.length > 1 ? ci.modules : null;

  let mods;
  if (ciMods) {
    const startMod = fromEl ? fromEl.value : ciMods[0];
    const endMod   = toEl   ? toEl.value   : ciMods[ciMods.length - 1];
    const si = Math.max(0, ciMods.indexOf(startMod));
    const ei = Math.min(ciMods.length - 1, Math.max(si, ciMods.indexOf(endMod)));
    mods = ciMods.slice(si, ei + 1);
  } else {
    const fromNum = parseInt(fromEl?.value) || 0;
    const toNum   = Math.max(fromNum, parseInt(toEl?.value) || fromNum);
    mods = Array.from({length: toNum - fromNum + 1}, (_, i) => 'module-' + String(fromNum + i).padStart(2, '0'));
  }

  await _runSeqLoop(ciId, mode, mods, 0);
}

// Core sequential loop — resumable from any index (used by runSequential and reconnect)
async function _runSeqLoop(ciId, mode, mods, startIdx) {
  const card = document.getElementById('card-' + ciId);
  if (!card) return;

  const seqBtns  = card.querySelectorAll('.seq-btn');
  const solveBtn = card.querySelector('.btn-solve');
  const validBtn = card.querySelector('.btn-validate');
  const statusEl = card.querySelector('.ci-status');
  const fromEl   = card.querySelector('.seq-from');
  const toEl     = card.querySelector('.seq-to');

  seqFlags[ciId] = false;
  seqBtns.forEach(b => b.disabled = true);
  solveBtn.disabled = true;
  validBtn.disabled = true;
  if (fromEl) fromEl.disabled = true;
  if (toEl)   toEl.disabled   = true;

  let stoppedAt = null;

  for (let i = startIdx; i < mods.length; i++) {
    if (seqFlags[ciId]) { stoppedAt = mods[i]; break; }

    const mod = mods[i];
    setCardModule(ciId, mod);

    // Persist progress so a page refresh can resume from here
    localStorage.setItem(`${SEQ_PROG_KEY}-${ciId}`, JSON.stringify({ mode, mods, currentIdx: i }));

    if (mode !== 'validate') {
      const r = await runStage(ciId, 'solve', mod, i, mods.length, statusEl);
      if (r === 'stop') { stoppedAt = mod; break; }
      if (r === 'skip') continue;
    }

    if (mode !== 'solve') {
      const r = await runStage(ciId, 'validate', mod, i, mods.length, statusEl);
      if (r === 'stop') { stoppedAt = mod; break; }
      if (r === 'skip') continue;
    }
  }

  // Clear progress — run finished or stopped
  localStorage.removeItem(`${SEQ_PROG_KEY}-${ciId}`);
  delete seqFlags[ciId];
  seqBtns.forEach(b => b.disabled = false);
  solveBtn.disabled = false;
  validBtn.disabled = false;
  if (fromEl) fromEl.disabled = false;
  if (toEl)   toEl.disabled   = false;
  card.querySelector('.stop-btn').style.display = 'none';

  const modeLabel = mode === 'solve' ? 'solve' : mode === 'validate' ? 'validate' : 'solve + validate';
  if (stoppedAt) {
    statusEl.className   = 'ci-status failed';
    statusEl.textContent = `❌ Sequential ${modeLabel} stopped at ${stoppedAt}`;
    card.className = 'ci-card is-failed';
  } else {
    statusEl.className   = 'ci-status success';
    statusEl.textContent = `✅ Sequential ${modeLabel} complete — all ${mods.length} module(s) passed`;
    card.className = 'ci-card is-success';
  }
}

// ── Module summary ─────────────────────────────────────────────────────────────
const LS_KEY = 'showroom-run-history';

function saveHistory() {
  const clean = {};
  Object.entries(runHistory).forEach(([ciId, mods]) => {
    clean[ciId] = {};
    Object.entries(mods).forEach(([mod, s]) => {
      clean[ciId][mod] = {
        solve:    s.solve    === 'running' ? null : s.solve,
        validate: s.validate === 'running' ? null : s.validate,
      };
    });
  });
  localStorage.setItem(LS_KEY, JSON.stringify(clean));
}

function loadHistory(cis) {
  const stored = localStorage.getItem(LS_KEY);
  if (!stored) return;
  try {
    const data     = JSON.parse(stored);
    const validIds = new Set(cis.map(c => c.id));
    Object.entries(data).forEach(([ciId, mods]) => {
      if (!validIds.has(ciId)) return;
      runHistory[ciId] = mods;
      renderModuleSummary(ciId);
    });
  } catch { /* corrupt localStorage — ignore */ }
}

function setModuleState(ciId, mod, stage, state) {
  if (!runHistory[ciId])      runHistory[ciId] = {};
  if (!runHistory[ciId][mod]) runHistory[ciId][mod] = { solve: null, validate: null };
  runHistory[ciId][mod][stage] = state;
  saveHistory();
  if (state === 'ok' || state === 'fail') saveLastRun(ciId, mod, stage);
  renderModuleSummary(ciId);
}

function renderModuleSummary(ciId) {
  const card = document.getElementById('card-' + ciId);
  if (!card) return;
  const el      = card.querySelector('.module-history');
  const history = runHistory[ciId] || {};
  const mods    = Object.keys(history);
  if (!mods.length) { el.style.display = 'none'; return; }

  // Detect stale rows — modules no longer in the CI's configured list
  const configuredMods = new Set((card.dataset.modules || '').split(',').filter(Boolean));

  el.style.display = '';
  el.innerHTML =
    `<div class="mh-row mh-header"><span>Module</span><span>Solve</span><span>Validate</span></div>` +
    mods.map(m => {
      const stale = configuredMods.size > 0 && !configuredMods.has(m);
      return `<div class="mh-row${stale ? ' mh-stale-row' : ''}">` +
        `<span class="mh-name">${x(m)}${stale ? ` <span class="mh-stale-badge" title="Module no longer in CI config">⚠</span>` : ''}</span>` +
        `<span>${badgeHtml(history[m].solve,    ciId, m, 'solve')}</span>` +
        `<span>${badgeHtml(history[m].validate, ciId, m, 'validate')}</span>` +
        `</div>`;
    }).join('');
}

function badgeHtml(state, ciId, mod, stage) {
  if (state === 'running') return `<span class="mh-badge mh-running"><span class="spinner" style="width:9px;height:9px;border-width:1.5px"></span> running</span>`;
  const logBtn = (state === 'ok' || state === 'fail') && ciId
    ? `<button class="mh-log-btn" title="View log" onclick="loadLogForModule('${ciId}','${x(mod)}','${stage}')">📄</button>`
    : '';
  if (state === 'ok')   return `<span class="mh-badge mh-ok">✅ Pass</span>${logBtn}`;
  if (state === 'fail') return `<span class="mh-badge mh-fail">❌ Fail</span>${logBtn}`;
  return `<span class="mh-none">—</span>`;
}

async function loadLogForModule(ciId, mod, stage) {
  try {
    const res = await fetch(`/api/logs/${ciId}/${stage}/${encodeURIComponent(mod)}`);
    if (!res.ok) { showToast('No log found for this module.', 'info'); return; }
    const text  = await res.text();
    const card  = document.getElementById('card-' + ciId);
    const title = card?.querySelector('.card-title')?.textContent || ciId;
    document.getElementById('log-modal-title').textContent = `${title} — ${stage} ${mod}`;
    const pre = document.getElementById('log-modal-pre');
    pre.textContent = text;
    pre.scrollTop   = pre.scrollHeight;
    openLogCiId = null;
    document.getElementById('log-modal').style.display = 'flex';
  } catch (err) {
    showToast('Failed to load log: ' + err.message);
  }
}

// ── Actions dropdown ───────────────────────────────────────────────────────────
function toggleActionsMenu(e) {
  e.stopPropagation();
  document.getElementById('actions-menu').classList.toggle('open');
}
function closeActionsMenu() {
  document.getElementById('actions-menu').classList.remove('open');
}
document.addEventListener('click', closeActionsMenu);

// ── Bulk actions ───────────────────────────────────────────────────────────────
function bulkAction(stage) {
  document.querySelectorAll('.ci-card').forEach(card => startStream(card.dataset.ciId, stage));
}

async function bulkRunAll(mode = 'both') {
  for (const card of document.querySelectorAll('.ci-card')) {
    await runSequential(card.dataset.ciId, mode);
  }
}

// ── Export / Import ────────────────────────────────────────────────────────────
async function exportConfig() {
  const cis = await api('GET', '/cis');
  // Export without auto-generated IDs; they are re-assigned on import
  const data = cis.map(({ id, ...rest }) => rest);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `mouseops-config-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importConfig(file) {
  if (!file) return;
  let configs;
  try { configs = JSON.parse(await file.text()); } catch { alert('Invalid JSON file.'); return; }
  if (!Array.isArray(configs)) { alert('Expected a JSON array of CI configs.'); return; }

  let added = 0;
  for (const cfg of configs) {
    if (!cfg.name || !cfg.url) continue;
    await api('POST', '/cis', {
      name:    cfg.name,
      url:     cfg.url,
      token:   cfg.token   || '',
      modules: cfg.modules || [],
    });
    added++;
  }
  alert(`Imported ${added} CI(s).`);
  closeActionsMenu();
  boot();
}

// ── Clear results ──────────────────────────────────────────────────────────────
function clearResults(ciId) {
  const card = document.getElementById('card-' + ciId);
  const name = card?.querySelector('.card-title')?.textContent?.trim() || ciId;
  if (!confirm(`Clear test results for:\n"${name}"\n\nOther CI results are not affected.`)) return;
  delete runHistory[ciId];
  saveHistory();
  renderModuleSummary(ciId);
}

function clearAllResults() {
  const count = Object.keys(runHistory).length;
  if (!count) { alert('No results to clear.'); return; }
  if (!confirm(`Clear test results for all ${count} CI(s)?\n\nThis cannot be undone.`)) return;
  Object.keys(runHistory).forEach(id => delete runHistory[id]);
  saveHistory();
  document.querySelectorAll('.ci-card').forEach(card => renderModuleSummary(card.dataset.ciId));
}

// ── CRUD ───────────────────────────────────────────────────────────────────────
async function removeCI(ciId) {
  const card = document.getElementById('card-' + ciId);
  const name = card?.querySelector('.card-title')?.textContent?.trim() || ciId;
  if (!confirm(`Remove this CI?\n"${name}"\n\nThis will also delete its test results.`)) return;
  await api('DELETE', '/cis/' + ciId);
  delete runHistory[ciId];
  saveHistory();
  boot();
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function openModal(ci) {
  editingId = ci ? ci.id : null;
  document.getElementById('modal-title').textContent  = ci ? 'Edit CI Instance' : 'Add CI Instance';
  document.getElementById('submit-btn').textContent   = ci ? 'Save Changes'     : 'Add CI';
  document.getElementById('f-name').value    = ci ? ci.name                      : '';
  document.getElementById('f-url').value     = ci ? ci.url                       : '';
  document.getElementById('f-token').value   = '';
  document.getElementById('f-modules').value = ci ? (ci.modules || []).join(',') : '';
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('f-name').focus();
}

async function openEditModal(ciId) {
  const cis = await api('GET', '/cis');
  const ci  = cis.find(c => c.id === ciId);
  if (ci) openModal(ci);
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  editingId = null;
}

function handleOverlayClick(e) {
  if (e.target.id === 'modal-overlay') closeModal();
}

function autoFill() {
  const from = parseInt(document.getElementById('f-mod-from').value) || 0;
  const to   = parseInt(document.getElementById('f-mod-to').value)   || 5;
  if (to < from) return;
  const mods = [];
  for (let i = from; i <= to; i++) mods.push('module-' + String(i).padStart(2, '0'));
  document.getElementById('f-modules').value = mods.join(',');
}

async function handleSubmit(e) {
  e.preventDefault();
  const name    = document.getElementById('f-name').value.trim();
  const url     = document.getElementById('f-url').value.trim();
  const token   = document.getElementById('f-token').value.trim();
  const rawMods = document.getElementById('f-modules').value.trim();
  const modules = rawMods ? rawMods.split(',').map(m => m.trim()).filter(Boolean) : [];

  if (editingId) {
    await api('PUT', '/cis/' + editingId, { name, url, token, modules });
  } else {
    await api('POST', '/cis', { name, url, token, modules });
  }
  closeModal();
  boot();
}

// ── Log expand modal ───────────────────────────────────────────────────────────
function openLogModal(ciId) {
  const card = document.getElementById('card-' + ciId);
  if (!card) return;
  const title   = card.querySelector('.card-title')?.textContent || ciId;
  const content = card.querySelector('.log-content')?.textContent || '';
  document.getElementById('log-modal-title').textContent = title;
  const pre = document.getElementById('log-modal-pre');
  pre.textContent = content;
  pre.scrollTop   = pre.scrollHeight;
  openLogCiId = ciId;
  document.getElementById('log-modal').style.display = 'flex';
}

function closeLogModal() {
  document.getElementById('log-modal').style.display = 'none';
  openLogCiId = null;
}

function handleLogModalClick(e) {
  if (e.target.id === 'log-modal') closeLogModal();
}

// ── Keyboard ───────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeLogModal(); }
});

// ── Toast notifications ────────────────────────────────────────────────────────
function showToast(msg, type = 'error') {
  const el = document.createElement('div');
  el.className   = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ── Health check / offline banner ──────────────────────────────────────────────
let _backendOnline = true;

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      if (!_backendOnline) {
        _backendOnline = true;
        document.getElementById('offline-banner').style.display = 'none';
        showToast('Backend is back online.', 'ok');
        boot();
      }
      return;
    }
  } catch { /* fall through */ }
  _backendOnline = false;
  document.getElementById('offline-banner').style.display = '';
}

// ── Last-run tracking (for log retrieval) ──────────────────────────────────────
const LAST_RUN_KEY = 'showroom-last-run';

function saveLastRun(ciId, mod, stage) {
  const data = JSON.parse(localStorage.getItem(LAST_RUN_KEY) || '{}');
  data[ciId] = { module: mod, stage };
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify(data));
}

async function loadLastLog(ciId) {
  const data = JSON.parse(localStorage.getItem(LAST_RUN_KEY) || '{}');
  const last = data[ciId];
  if (!last) { showToast('No recorded run for this CI yet.', 'info'); return; }

  try {
    const res = await fetch(`/api/logs/${ciId}/${last.stage}/${encodeURIComponent(last.module)}`);
    if (!res.ok) { showToast('No persisted log found on server.', 'info'); return; }
    const text  = await res.text();
    const card  = document.getElementById('card-' + ciId);
    const title = card?.querySelector('.card-title')?.textContent || ciId;
    document.getElementById('log-modal-title').textContent =
      `${title} — ${last.stage} ${last.module} (persisted)`;
    const pre = document.getElementById('log-modal-pre');
    pre.textContent = text;
    pre.scrollTop   = pre.scrollHeight;
    openLogCiId = null;   // not a live stream
    document.getElementById('log-modal').style.display = 'flex';
  } catch (err) {
    showToast('Failed to load log: ' + err.message);
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────
setInterval(checkHealth, 30000);
boot().catch(err => {
  console.error('Boot failed:', err);
  showToast('Could not reach the backend — is MouseOps running?');
  document.getElementById('offline-banner').style.display = '';
});
