// ── State ─────────────────────────────────────────────────────────────────────
let currentMode = 'single';
let candidates = [];  // [{id, name, filename, pqs, min_quals}]

// ── DOM refs ──────────────────────────────────────────────────────────────────
const setupToggleBtn = document.getElementById('setup-toggle');
const setupBody      = document.getElementById('setup-body');
const saveSetupBtn   = document.getElementById('save-setup-btn');
const setupStatus    = document.getElementById('setup-status');
const bulkInput      = document.getElementById('bulk-input');
const progressWrap   = document.getElementById('progress-wrap');
const progressBar    = document.getElementById('progress-bar');
const uploadStatus   = document.getElementById('upload-status');
const uploadCount    = document.getElementById('upload-count');
const candGrid       = document.getElementById('cand-grid');
const candSelect     = document.getElementById('cand-select');
const threadEl       = document.getElementById('chat-thread');
const formEl         = document.getElementById('chat-form');
const inputEl        = document.getElementById('chat-input');
const sendBtn        = document.getElementById('chat-send');
const chipsEl        = document.getElementById('suggestion-chips');
const exportBtn      = document.getElementById('export-btn');
const modeToggle     = document.getElementById('mode-toggle');

// Initialise candidates from server-rendered data
document.querySelectorAll('.cand-card').forEach(card => {
  candidates.push({ id: card.dataset.id });
});
refreshCandSelect();
refreshChatState();

// ── Setup toggle ──────────────────────────────────────────────────────────────
setupToggleBtn.addEventListener('click', () => {
  const collapsed = setupBody.hidden;
  setupBody.hidden = !collapsed;
  setupToggleBtn.textContent = collapsed ? '▲ Collapse' : '▼ Expand';
});

// ── Save setup ────────────────────────────────────────────────────────────────
saveSetupBtn.addEventListener('click', async () => {
  const body = {
    number:   document.getElementById('pos-number').value.trim(),
    title:    document.getElementById('pos-title').value.trim(),
    location: document.getElementById('pos-location').value.trim(),
  };
  for (let i = 1; i <= 6; i++) body[`pq${i}`] = document.getElementById(`pq${i}`).value.trim();

  setupStatus.textContent = 'Saving…';
  const res = await fetch('/api/hr/setup', {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  const data = await res.json();
  setupStatus.textContent = data.ok ? '✓ Saved. Upload resumes below.' : (data.error || 'Error.');

  // Collapse setup after save
  if (data.ok) {
    setupBody.hidden = true;
    setupToggleBtn.textContent = '▼ Expand';
  }
});

// ── Bulk upload ───────────────────────────────────────────────────────────────
bulkInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  const available = 10 - candidates.length;
  const toProcess = files.slice(0, available);
  if (files.length > available) {
    uploadStatus.textContent = `Only ${available} slot(s) remaining — processing first ${available} file(s).`;
  }

  progressWrap.hidden = false;
  progressBar.style.width = '0%';

  for (let i = 0; i < toProcess.length; i++) {
    const file = toProcess[i];
    uploadStatus.textContent = `Screening "${file.name}" (${i+1}/${toProcess.length})…`;

    const fd = new FormData();
    fd.append('resume', file);

    try {
      const res = await fetch('/api/hr/upload', { method: 'POST', body: fd });
      const data = await res.json();

      if (!data.ok) {
        uploadStatus.textContent = `✕ ${file.name}: ${data.error}`;
      } else {
        candidates.push(data.candidate);
        appendCandCard(data.candidate);
        refreshCandSelect();
        refreshChatState();
      }
    } catch (err) {
      uploadStatus.textContent = `✕ ${file.name}: connection error.`;
    }

    progressBar.style.width = `${((i+1) / toProcess.length) * 100}%`;
    updateCount();
  }

  uploadStatus.textContent = `Done — ${candidates.length} resume(s) loaded.`;
  bulkInput.value = '';
  setTimeout(() => { progressWrap.hidden = true; }, 1500);
});

function updateCount() {
  uploadCount.textContent = `${candidates.length} / 10`;
}

function appendCandCard(cand) {
  const div = document.createElement('div');
  div.className = 'cand-card';
  div.dataset.id = cand.id;

  const pqBadges = (cand.pqs || []).map((pv, i) => {
    const cls = pv === 'Yes' ? 'yes' : pv === 'No' ? 'no' : 'na';
    return `<span class="pq-badge ${cls}">PQ${i+1}: ${pv}</span>`;
  }).join('');

  const minCls = cand.min_quals === 'Yes' ? 'yes' : cand.min_quals === 'No' ? 'no' : 'na';

  div.innerHTML = `
    <div class="cand-card-top">
      <span class="cand-name">${cand.name}</span>
      <button class="cand-remove" data-id="${cand.id}">✕</button>
    </div>
    <div class="cand-meta">${cand.word_count.toLocaleString()} words · ${cand.filename}</div>
    <div class="cand-pqs">
      <span class="pq-badge ${minCls}">Min: ${cand.min_quals}</span>
      ${pqBadges}
    </div>`;
  candGrid.appendChild(div);
  div.querySelector('.cand-remove').addEventListener('click', removeCandidate);
}

// ── Remove candidate ──────────────────────────────────────────────────────────
candGrid.addEventListener('click', async (e) => {
  if (!e.target.classList.contains('cand-remove')) return;
  const id = e.target.dataset.id;
  await fetch('/api/hr/remove', {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id })
  });
  candidates = candidates.filter(c => c.id !== id);
  document.querySelector(`.cand-card[data-id="${id}"]`)?.remove();
  refreshCandSelect();
  refreshChatState();
  updateCount();
});

function removeCandidate(e) {
  // handled by delegation above
}

// ── Candidate select & mode toggle ───────────────────────────────────────────
function refreshCandSelect() {
  const prev = candSelect.value;
  candSelect.innerHTML = candidates.length
    ? candidates.map(c => `<option value="${c.id}">${c.name || c.filename}</option>`).join('')
    : '<option value="">— Upload a resume first —</option>';
  if (prev && candidates.find(c => c.id === prev)) candSelect.value = prev;
}

function refreshChatState() {
  const enabled = candidates.length > 0;
  inputEl.disabled = !enabled;
  sendBtn.disabled = !enabled;
}

modeToggle.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentMode = btn.dataset.mode;
    modeToggle.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('single-controls').hidden = (currentMode === 'group');
  });
});

// ── Chips ─────────────────────────────────────────────────────────────────────
chipsEl.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (inputEl.disabled) return;
    const chipMode = chip.dataset.mode;
    if (chipMode) {
      currentMode = chipMode;
      modeToggle.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === chipMode);
      });
      document.getElementById('single-controls').hidden = (chipMode === 'group');
    }
    inputEl.value = chip.dataset.prompt;
    formEl.requestSubmit();
  });
});

// ── Chat ──────────────────────────────────────────────────────────────────────
function addBubble(text, role) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text;
  threadEl.appendChild(bubble);
  threadEl.scrollTop = threadEl.scrollHeight;
  return bubble;
}

function setChatEnabled(on) {
  inputEl.disabled = !on;
  sendBtn.disabled = !on;
}

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = inputEl.value.trim();
  if (!message || !candidates.length) return;

  addBubble(message, 'user');
  inputEl.value = '';
  setChatEnabled(false);

  const label = currentMode === 'group'
    ? `Asking about all ${candidates.length} candidates…`
    : `Asking about ${candSelect.options[candSelect.selectedIndex]?.text || 'candidate'}…`;
  const thinking = addBubble(label, 'assistant thinking');

  const body = {
    message,
    mode: currentMode,
    candidate_id: currentMode === 'single' ? candSelect.value : null,
  };

  try {
    const res = await fetch('/api/hr/ask', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
    });
    const data = await res.json();
    thinking.remove();
    addBubble(data.ok ? data.reply : (data.error || 'Something went wrong.'),
              data.ok ? 'assistant' : 'assistant error');
  } catch {
    thinking.remove();
    addBubble('Lost connection — try again.', 'assistant error');
  } finally {
    setChatEnabled(candidates.length > 0);
    inputEl.focus();
  }
});

// ── Export ────────────────────────────────────────────────────────────────────
exportBtn.addEventListener('click', () => {
  exportBtn.disabled = true;
  exportBtn.textContent = 'Preparing…';
  const a = document.createElement('a');
  a.href = '/api/hr/export';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => {
    exportBtn.disabled = false;
    exportBtn.textContent = '↓ Download HR Report (.xlsx)';
  }, 2500);
});
