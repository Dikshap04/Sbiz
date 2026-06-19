// ── Setup save ────────────────────────────────────────────────────────────────
const setupBtn   = document.getElementById('save-setup-btn');
const setupStatus = document.getElementById('setup-status');

setupBtn.addEventListener('click', async () => {
  const body = {
    number:   document.getElementById('pos-number').value.trim(),
    title:    document.getElementById('pos-title').value.trim(),
    location: document.getElementById('pos-location').value.trim(),
  };
  for (let i = 1; i <= 6; i++) {
    body[`pq${i}`] = document.getElementById(`pq${i}`).value.trim();
  }

  const hasPQ = [1,2,3,4,5,6].some(i => body[`pq${i}`]);
  if (!hasPQ) {
    setupStatus.textContent = 'Add at least one Preferred Qualification before continuing.';
    return;
  }

  setupStatus.textContent = 'Saving…';
  const res = await fetch('/api/screening/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  setupStatus.textContent = data.ok ? '✓ Saved — upload your first resume below.' : (data.error || 'Error saving.');
});

// ── Resume upload & auto-screen ───────────────────────────────────────────────
const uploadInput  = document.getElementById('sc-resume-input');
const uploadStatus = document.getElementById('upload-status');
const tableWrap    = document.getElementById('candidates-table-wrap');
const tbody        = document.getElementById('candidates-tbody');

uploadInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  uploadStatus.textContent = `Screening "${file.name}" against your PQs… (this takes a few seconds)`;

  const fd = new FormData();
  fd.append('resume', file);

  const res = await fetch('/api/screening/upload', { method: 'POST', body: fd });
  const data = await res.json();

  uploadInput.value = '';

  if (!data.ok) {
    uploadStatus.textContent = `✕ ${data.error}`;
    return;
  }

  uploadStatus.textContent = `✓ "${data.candidate.filename}" screened and added.`;
  tableWrap.hidden = false;
  appendCandidateRow(data.candidate, tbody.rows.length);
});

function yesNo(val) {
  if (val === 'Yes') return '<span class="yes">Yes</span>';
  if (val === 'No')  return '<span class="no">No</span>';
  return val || '';
}

function appendCandidateRow(cand, idx) {
  const totalYes = (cand.pqs || []).filter(v => v === 'Yes').length;
  const pqCells = Array.from({length: 6}, (_, i) => {
    const val = (cand.pqs || [])[i] || '';
    return `<td>${yesNo(val)}</td>`;
  }).join('');

  const tr = document.createElement('tr');
  tr.dataset.index = idx;
  tr.innerHTML = `
    <td>${cand.name || cand.filename}</td>
    <td>${yesNo(cand.min_quals)}</td>
    ${pqCells}
    <td>${totalYes}</td>
    <td><button class="remove-cand-btn" data-index="${idx}">✕</button></td>
  `;
  tbody.appendChild(tr);
  tr.querySelector('.remove-cand-btn').addEventListener('click', removeCandidate);
}

// ── Remove candidate ──────────────────────────────────────────────────────────
async function removeCandidate(e) {
  const idx = parseInt(e.target.dataset.index);
  await fetch('/api/screening/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index: idx }),
  });
  // Reload to re-index cleanly
  location.reload();
}

document.querySelectorAll('.remove-cand-btn').forEach(btn => {
  btn.addEventListener('click', removeCandidate);
});

// ── Export ────────────────────────────────────────────────────────────────────
document.getElementById('sc-export-btn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = '/api/screening/export';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});
