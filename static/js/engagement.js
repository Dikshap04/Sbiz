// ── State ─────────────────────────────────────────────────────────────────────
const dataEl = document.getElementById('candidates-data');
let candidates = dataEl ? JSON.parse(dataEl.textContent) : [];
let activeType = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const engGrid       = document.getElementById('eng-grid');
const engCount      = document.getElementById('eng-count');
const engCandSelect = document.getElementById('eng-cand-select');
const typeChips     = document.getElementById('eng-type-chips');
const notesEl       = document.getElementById('eng-notes');
const generateBtn   = document.getElementById('eng-generate-btn');
const draftStatus   = document.getElementById('eng-draft-status');
const draftBox      = document.getElementById('draft-box');
const draftSubject  = document.getElementById('draft-subject');
const draftBody     = document.getElementById('draft-body');
const regenBtn      = document.getElementById('draft-regenerate-btn');
const sendBtn       = document.getElementById('draft-send-btn');
const sendStatus    = document.getElementById('eng-send-status');
const timelineEl    = document.getElementById('eng-timeline');
const exportBtn     = document.getElementById('eng-export-btn');
const checkRepliesBtn = document.getElementById('eng-check-replies-btn');
const repliesStatus   = document.getElementById('eng-replies-status');

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

function findCand(id) { return candidates.find(c => c.id === id); }

// ── Render candidate cards ───────────────────────────────────────────────────
function renderGrid() {
  if (!engGrid) return;
  engGrid.innerHTML = candidates.map(c => `
    <div class="eng-card ${c.engaged ? 'engaged' : ''}" data-id="${c.id}">
      <div class="eng-card-top">
        <label class="eng-toggle">
          <input type="checkbox" class="eng-engaged" data-id="${c.id}" ${c.engaged ? 'checked' : ''}>
          <span class="cand-name">${esc(c.name)}</span>
        </label>
      </div>
      <div class="eng-card-fields">
        <input type="email" class="eng-email" data-id="${c.id}" placeholder="candidate@email.com" value="${esc(c.email)}">
        <input type="date" class="eng-join-date" data-id="${c.id}" value="${esc(c.joining_date)}">
      </div>
      <div class="eng-card-meta">${(c.engagement_log || []).length} update(s) sent</div>
    </div>`).join('');
  updateCount();
  attachGridEvents();
}

function updateCount() {
  if (!engCount) return;
  const n = candidates.filter(c => c.engaged).length;
  engCount.textContent = `${n} engaged`;
}

function attachGridEvents() {
  engGrid.querySelectorAll('.eng-engaged').forEach(cb => {
    cb.addEventListener('change', async () => {
      const cand = findCand(cb.dataset.id);
      cand.engaged = cb.checked;
      cb.closest('.eng-card').classList.toggle('engaged', cb.checked);
      await saveField(cand.id, { engaged: cb.checked });
      updateCount();
      refreshCandSelect();
    });
  });
  engGrid.querySelectorAll('.eng-email').forEach(inp => {
    inp.addEventListener('change', async () => {
      const cand = findCand(inp.dataset.id);
      cand.email = inp.value.trim();
      await saveField(cand.id, { email: cand.email });
    });
  });
  engGrid.querySelectorAll('.eng-join-date').forEach(inp => {
    inp.addEventListener('change', async () => {
      const cand = findCand(inp.dataset.id);
      cand.joining_date = inp.value;
      await saveField(cand.id, { joining_date: cand.joining_date });
    });
  });
}

async function saveField(id, patch) {
  try {
    await fetch('/api/engagement/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    });
  } catch { /* best-effort — field stays in local state either way */ }
}

// ── Candidate selector for composing ─────────────────────────────────────────
function refreshCandSelect() {
  if (!engCandSelect) return;
  const engaged = candidates.filter(c => c.engaged);
  const prev = engCandSelect.value;
  engCandSelect.innerHTML = engaged.length
    ? engaged.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
    : '<option value="">— Engage a candidate above first —</option>';
  if (prev && engaged.find(c => c.id === prev)) engCandSelect.value = prev;
  refreshComposeState();
  renderTimeline();
}

function refreshComposeState() {
  if (!generateBtn) return;
  const enabled = !!(engCandSelect && engCandSelect.value);
  generateBtn.disabled = !(enabled && activeType);
}

if (engCandSelect) {
  engCandSelect.addEventListener('change', () => {
    draftBox.hidden = true;
    draftStatus.textContent = '';
    sendStatus.textContent = '';
    refreshComposeState();
    renderTimeline();
  });
}

// ── Type chips ────────────────────────────────────────────────────────────────
if (typeChips) {
  typeChips.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeType = chip.dataset.type;
      typeChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      refreshComposeState();
    });
  });
}

// ── Generate draft ────────────────────────────────────────────────────────────
async function generateDraft() {
  const cid = engCandSelect.value;
  if (!cid || !activeType) return;
  generateBtn.disabled = true;
  draftStatus.textContent = 'Drafting a personalised update…';
  sendStatus.textContent = '';

  try {
    const res = await fetch('/api/engagement/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cid, update_type: activeType, custom_notes: notesEl.value.trim() }),
    });
    const data = await res.json();
    if (data.ok) {
      draftSubject.value = data.subject;
      draftBody.value = data.body;
      draftBox.hidden = false;
      draftStatus.textContent = '✓ Draft ready — review, tweak the wording if needed, then send.';
    } else {
      draftStatus.textContent = data.error || 'Something went wrong.';
    }
  } catch {
    draftStatus.textContent = 'Lost connection — try again.';
  } finally {
    generateBtn.disabled = false;
  }
}

if (generateBtn) generateBtn.addEventListener('click', generateDraft);
if (regenBtn) regenBtn.addEventListener('click', generateDraft);

// ── Send ──────────────────────────────────────────────────────────────────────
if (sendBtn) {
  sendBtn.addEventListener('click', async () => {
    const cid = engCandSelect.value;
    const cand = findCand(cid);
    if (!cand) return;
    if (!cand.email) {
      sendStatus.textContent = 'Add an email address for this candidate first.';
      return;
    }
    sendBtn.disabled = true;
    sendStatus.textContent = 'Sending…';

    try {
      const res = await fetch('/api/engagement/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cid, update_type: activeType,
          subject: draftSubject.value.trim(), body: draftBody.value.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        cand.engagement_log = cand.engagement_log || [];
        cand.engagement_log.push(data.entry);
        sendStatus.textContent = data.simulated
          ? '✓ Saved to the timeline (SMTP not configured — no real email was sent).'
          : `✓ Sent to ${cand.email}.`;
        renderGrid();
        renderTimeline();
      } else {
        sendStatus.textContent = data.error || 'Something went wrong.';
      }
    } catch {
      sendStatus.textContent = 'Lost connection — try again.';
    } finally {
      sendBtn.disabled = false;
    }
  });
}

// ── Timeline ──────────────────────────────────────────────────────────────────
function renderTimeline() {
  if (!timelineEl) return;
  const cid = engCandSelect ? engCandSelect.value : null;
  const cand = cid ? findCand(cid) : null;
  if (!cand) {
    timelineEl.innerHTML = '<p class="u-hint">Select a candidate above to see the updates sent to them.</p>';
    return;
  }
  const log = cand.engagement_log || [];
  if (!log.length) {
    timelineEl.innerHTML = `<p class="u-hint">No updates sent to ${esc(cand.name)} yet.</p>`;
    return;
  }
  timelineEl.innerHTML = log.slice().reverse().map(e => `
    <div class="tl-entry ${e.direction === 'inbound' ? 'inbound' : ''}">
      <div class="tl-head">
        <span class="tl-label">${e.direction === 'inbound' ? '↩ ' : ''}${esc(e.label || e.type)}</span>
        <span class="tl-date">${esc(e.sent_at)}${e.simulated ? ' · simulated' : ''}</span>
      </div>
      <div class="tl-subject">${esc(e.subject)}</div>
      <div class="tl-body">${esc(e.body).replace(/\n/g, '<br>')}</div>
    </div>`).join('');
}

// ── Check for replies ─────────────────────────────────────────────────────────
if (checkRepliesBtn) {
  checkRepliesBtn.addEventListener('click', async () => {
    checkRepliesBtn.disabled = true;
    repliesStatus.textContent = 'Checking the inbox…';

    try {
      const res = await fetch('/api/engagement/check_replies', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        (data.new_replies || []).forEach(({ candidate_id, entry }) => {
          const cand = findCand(candidate_id);
          if (cand) {
            cand.engagement_log = cand.engagement_log || [];
            cand.engagement_log.push(entry);
          }
        });
        repliesStatus.textContent = data.checked
          ? `✓ Found ${data.checked} new repl${data.checked === 1 ? 'y' : 'ies'}.`
          : '✓ No new replies since last check.';
        renderGrid();
        renderTimeline();
      } else {
        repliesStatus.textContent = data.error || 'Something went wrong.';
      }
    } catch {
      repliesStatus.textContent = 'Lost connection — try again.';
    } finally {
      checkRepliesBtn.disabled = false;
    }
  });
}

// ── Export ────────────────────────────────────────────────────────────────────
if (exportBtn) {
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
}

// ── Init ──────────────────────────────────────────────────────────────────────
renderGrid();
refreshCandSelect();
