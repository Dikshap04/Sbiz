const threadEl = document.getElementById('chat-thread');
const formEl = document.getElementById('chat-form');
const inputEl = document.getElementById('chat-input');
const sendBtn = document.getElementById('chat-send');
const chipsEl = document.getElementById('suggestion-chips');

function addBubble(text, role) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text;
  threadEl.appendChild(bubble);
  threadEl.scrollTop = threadEl.scrollHeight;
  return bubble;
}

function setChatEnabled(enabled) {
  inputEl.disabled = !enabled;
  sendBtn.disabled = !enabled;
}

async function uploadResume(slot, file) {
  const tabEmpty = document.getElementById(`tab-${slot}-empty`);
  const tabFilled = document.getElementById(`tab-${slot}-filled`);
  const uploadLabel = tabEmpty.querySelector('.upload-btn');
  const originalLabel = uploadLabel.childNodes[0].textContent;

  const formData = new FormData();
  formData.append('slot', slot);
  formData.append('resume', file);

  uploadLabel.childNodes[0].textContent = 'Uploading… ';

  try {
    const res = await fetch('/api/hr/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (!data.ok) {
      addBubble(data.error || "Couldn't read that file.", 'assistant error');
      uploadLabel.childNodes[0].textContent = originalLabel;
      return;
    }

    tabFilled.querySelector('.filename').textContent = data.filename;
    tabFilled.querySelector('.meta').textContent =
      `${data.word_count.toLocaleString()} words` + (data.truncated ? ' · trimmed to fit' : '');

    tabEmpty.hidden = true;
    tabFilled.hidden = false;
    setChatEnabled(true);

    if (slot === 'a') {
      addBubble(`Got it — ${data.filename} is loaded. Ask me anything about it.`, 'assistant');
    } else {
      addBubble(`${data.filename} added as Candidate B. Try "Compare these two candidates."`, 'assistant');
    }
  } catch (err) {
    addBubble('Upload failed — check your connection and try again.', 'assistant error');
    uploadLabel.childNodes[0].textContent = originalLabel;
  }
}

document.querySelectorAll('.resume-input').forEach((input) => {
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) uploadResume(input.dataset.slot, file);
  });
});

document.querySelectorAll('.remove-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const slot = btn.dataset.slot;

    await fetch('/api/hr/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot }),
    });

    document.getElementById(`tab-${slot}-filled`).hidden = true;
    document.getElementById(`tab-${slot}-empty`).hidden = false;
    document.querySelector(`.resume-input[data-slot="${slot}"]`).value = '';

    if (slot === 'a') {
      setChatEnabled(false);
      threadEl.innerHTML = '';
      addBubble('Upload a resume above, then ask me things like "what\'s their most recent role" or "do they have any cloud certifications."', 'assistant');
    }
  });
});

chipsEl.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    if (inputEl.disabled) return;
    inputEl.value = chip.dataset.prompt;
    formEl.requestSubmit();
  });
});

const exportBar = document.getElementById('export-bar');
const exportBtn = document.getElementById('export-btn');

function showExportBar() {
  if (exportBar) exportBar.hidden = false;
}

exportBtn && exportBtn.addEventListener('click', () => {
  exportBtn.disabled = true;
  exportBtn.textContent = 'Preparing…';
  const link = document.createElement('a');
  link.href = '/api/hr/export';
  link.download = '';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    exportBtn.disabled = false;
    exportBtn.textContent = '↓ Export conversation to Excel';
  }, 2000);
});

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = inputEl.value.trim();
  if (!message) return;

  addBubble(message, 'user');
  inputEl.value = '';
  setChatEnabled(false);

  const thinkingBubble = addBubble('Thinking…', 'assistant thinking');

  try {
    const res = await fetch('/api/hr/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    thinkingBubble.remove();

    if (!data.ok) {
      addBubble(data.error || 'Something went wrong.', 'assistant error');
    } else {
      addBubble(data.reply, 'assistant');
      showExportBar();
    }
  } catch (err) {
    thinkingBubble.remove();
    addBubble('Lost connection to the server — try again.', 'assistant error');
  } finally {
    setChatEnabled(true);
    inputEl.focus();
  }
});
