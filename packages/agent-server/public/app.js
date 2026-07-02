const $ = (id) => document.getElementById(id);

const state = {
  selectedJobId: null,
  eventSource: null,
  urlAutoFilled: false,
  configuredDefaultUrl: '',
  memoryLookupTimer: null,
};

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timeout']);

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const errMsg =
      typeof data?.error === 'string'
        ? data.error
        : data?.message || data?.error || `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  return data;
}

function formatTime(iso) {
  return new Date(iso).toLocaleString();
}

function statusClass(status) {
  return `status status-${status}`;
}

function extractUrlFromGoal(text) {
  const match = String(text).match(/https?:\/\/[^\s<>"']+/i);
  return match?.[0] ?? null;
}

function renderHealth(health) {
  const pill = $('health-pill');
  const queue = health.queue?.queued ?? 0;
  const running = health.queue?.running ?? 0;
  const keyLabel = health.hasApiKey ? 'API key set' : 'No API key';
  const loopLabel = `loop L${health.loopLevel ?? 0}${health.autoVerify ? '+verify' : ''}${health.autoLearn ? '+learn' : ''}${health.testHeaded ? '+headed' : ''}`;
  const memoryLabel =
    health.autoLearn && health.memoryHosts?.length
      ? ` · ${health.memoryHosts.length} host(s) learned`
      : '';
  const targetLabel = health.defaultUrl
    ? health.defaultUrlReachable
      ? 'default URL up'
      : 'default URL down'
    : 'no default URL';

  state.configuredDefaultUrl = health.defaultUrl ?? '';

  const urlInput = $('url');
  if (!urlInput.value.trim() && state.configuredDefaultUrl && state.urlAutoFilled) {
    urlInput.value = state.configuredDefaultUrl;
  }

  pill.className = `pill ${health.hasApiKey ? 'pill-ok' : 'pill-warn'}`;
  pill.textContent = `Daemon OK · ${health.stagehandEnv} · ${loopLabel}${memoryLabel} · queued ${queue} · running ${running} · ${keyLabel} · ${targetLabel}`;
}

async function refreshHealth() {
  try {
    const health = await api('/v1/health');
    renderHealth(health);
    await probeCurrentUrl();
  } catch {
    $('health-pill').className = 'pill pill-warn';
    $('health-pill').textContent = 'Daemon unreachable';
  }
}

async function probeCurrentUrl() {
  const url = $('url').value.trim();
  const hint = $('url-hint');
  if (!url) {
    hint.className = 'hint hint-warn';
    hint.textContent = 'Target URL is required for each job.';
    scheduleMemoryLookup();
    return;
  }

  try {
    const probe = await api(`/v1/probe?url=${encodeURIComponent(url)}`);
    hint.className = probe.ok ? 'hint' : 'hint hint-warn';
    hint.textContent = probe.ok
      ? `Target reachable (${probe.status ?? 'ok'})`
      : `Target may be unreachable (${probe.error ?? 'probe failed'})`;
  } catch (err) {
    hint.className = 'hint hint-warn';
    hint.textContent = err.message;
  }

  scheduleMemoryLookup();
}

function scheduleMemoryLookup() {
  if (state.memoryLookupTimer) clearTimeout(state.memoryLookupTimer);
  state.memoryLookupTimer = setTimeout(() => void lookupMemory(), 400);
}

async function lookupMemory() {
  const goal = $('goal').value.trim();
  const url = $('url').value.trim();
  const hint = $('memory-hint');
  if (!goal || !url) {
    hint.hidden = true;
    return;
  }

  try {
    const result = await api(
      `/v1/memory/lookup?goal=${encodeURIComponent(goal)}&url=${encodeURIComponent(url)}`,
    );
    hint.hidden = false;
    if (result.found && result.flow) {
      hint.className = 'hint';
      hint.textContent = `Learned flow available (${result.flow.template}, ${result.flow.successCount} success${result.flow.successCount === 1 ? '' : 'es'})`;
    } else {
      hint.className = 'hint hint-warn';
      hint.textContent = 'No learned flow for this goal yet';
    }
  } catch {
    hint.hidden = true;
  }
}

function renderJobList(jobs) {
  const list = $('job-list');
  list.innerHTML = '';

  if (!jobs.length) {
    list.innerHTML = '<li class="empty">No jobs yet. Submit a goal above.</li>';
    return;
  }

  for (const job of jobs) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `job-item${state.selectedJobId === job.id ? ' active' : ''}`;
    btn.innerHTML = `
      <div class="job-item-top">
        <span class="job-item-goal">${escapeHtml(job.goal)}</span>
        <span class="${statusClass(job.status)}">${job.status}</span>
      </div>
      <div class="job-item-meta">${formatTime(job.createdAt)} · ${escapeHtml(job.url)}</div>
    `;
    btn.addEventListener('click', () => selectJob(job.id));
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function refreshJobs() {
  const jobs = await api('/v1/jobs');
  renderJobList(jobs);
  if (state.selectedJobId) {
    const current = jobs.find((job) => job.id === state.selectedJobId);
    if (current) renderJobDetail(current);
  }
}

function renderEvents(events) {
  const log = $('event-log');
  log.innerHTML = '';
  for (const event of events) {
    const li = document.createElement('li');
    li.className = `event-item type-${event.type}`;
    li.innerHTML = `
      <div class="event-meta">
        <span>${escapeHtml(event.type)}</span>
        <span>${formatTime(event.ts)}</span>
      </div>
      <div>${escapeHtml(event.message)}</div>
    `;
    log.appendChild(li);
  }
  log.scrollTop = log.scrollHeight;
}

function renderJobDetail(job) {
  $('job-empty').hidden = true;
  $('job-detail').hidden = false;
  $('detail-status').innerHTML = `<span class="${statusClass(job.status)}">${job.status}</span>`;
  $('detail-id').textContent = job.id;
  $('detail-goal').textContent = job.goal;
  $('detail-url').textContent = job.url;
  $('detail-result').textContent =
    job.result?.message || job.error || (TERMINAL.has(job.status) ? 'No message' : 'In progress…');
  $('detail-loop').textContent =
    (job.loopStatus ?? '—') +
    (job.loopVerifyAttempts != null ? ` (${job.loopVerifyAttempts} heals)` : '');
  $('detail-spec').textContent = job.bridgeSpecPath ?? '—';
  $('detail-test').textContent = job.testSpecPath ?? '—';
  const memoryParts = [];
  if (job.memoryFlowHash) memoryParts.push(`flow ${job.memoryFlowHash}`);
  if (job.memoryRecorded) memoryParts.push('recorded');
  $('detail-memory').textContent = memoryParts.length ? memoryParts.join(' · ') : '—';
  renderEvents(job.events || []);

  const canCancel = job.status === 'queued' || job.status === 'running';
  $('cancel-job').disabled = !canCancel;
  $('bridge-job').disabled = job.status !== 'succeeded';
  $('verify-job').disabled = !(job.status === 'succeeded' && job.testSpecPath);
  $('bridge-output').hidden = true;
}

function showLoopOutput(result) {
  const output = $('bridge-output');
  output.hidden = false;
  const lines = [];
  if (result.specPath) lines.push(`Spec: ${result.specPath}`);
  if (result.testPath) lines.push(`Test: ${result.testPath}`);
  if (result.pageObjectPath) lines.push(`Page object: ${result.pageObjectPath}`);
  if (result.template) lines.push(`Template: ${result.template}`);
  if (result.loopStatus) lines.push(`Loop: ${result.loopStatus}`);
  if (result.verifyPassed != null) lines.push(`Verify passed: ${result.verifyPassed}`);
  if (result.healAttempts != null) lines.push(`Heal attempts: ${result.healAttempts}`);
  if (result.memoryRecorded) lines.push(`Memory recorded: ${result.memoryFlowHash ?? 'yes'}`);
  if (result.generatorPrompt) lines.push('', result.generatorPrompt);
  output.textContent = lines.join('\n');
}

function closeEventStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function openEventStream(jobId) {
  closeEventStream();
  const source = new EventSource(`/v1/jobs/${jobId}/events`);
  source.addEventListener('job', (event) => {
    const job = JSON.parse(event.data);
    renderJobDetail(job);
    if (TERMINAL.has(job.status)) {
      closeEventStream();
      void refreshJobs();
    }
  });
  source.onerror = () => closeEventStream();
  state.eventSource = source;
}

async function selectJob(jobId) {
  state.selectedJobId = jobId;
  const job = await api(`/v1/jobs/${jobId}`);
  renderJobDetail(job);
  await refreshJobs();
  if (!TERMINAL.has(job.status)) openEventStream(jobId);
  else closeEventStream();
}

$('submit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('submit-error').hidden = true;

  const goal = $('goal').value.trim();
  const url = $('url').value.trim();
  const maxSteps = Number($('maxSteps').value);

  if (!url) {
    $('submit-error').hidden = false;
    $('submit-error').textContent = 'Target URL is required.';
    return;
  }

  try {
    const result = await api('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({ goal, url, maxSteps }),
    });
    await refreshJobs();
    await selectJob(result.jobId);
  } catch (err) {
    $('submit-error').hidden = false;
    $('submit-error').textContent = err.message;
  }
});

$('example-goal').addEventListener('click', () => {
  $('goal').value =
    'Open the docs page. Expected: page title contains Playwright.';
  $('url').value = 'https://playwright.dev/';
  $('maxSteps').value = '15';
  state.urlAutoFilled = false;
  void probeCurrentUrl();
});

$('goal').addEventListener('input', () => {
  const goalUrl = extractUrlFromGoal($('goal').value);
  if (!goalUrl) {
    scheduleMemoryLookup();
    return;
  }
  const urlInput = $('url');
  if (!urlInput.value.trim() || state.urlAutoFilled) {
    urlInput.value = goalUrl;
    state.urlAutoFilled = true;
    void probeCurrentUrl();
  } else {
    scheduleMemoryLookup();
  }
});

$('url').addEventListener('input', () => {
  state.urlAutoFilled = false;
  void probeCurrentUrl();
});

$('refresh-jobs').addEventListener('click', () => void refreshJobs());
$('cancel-job').addEventListener('click', async () => {
  if (!state.selectedJobId) return;
  await api(`/v1/jobs/${state.selectedJobId}/cancel`, { method: 'POST' });
  await selectJob(state.selectedJobId);
});
$('bridge-job').addEventListener('click', async () => {
  if (!state.selectedJobId) return;
  const result = await api(`/v1/jobs/${state.selectedJobId}/bridge-to-tests`, { method: 'POST' });
  showLoopOutput(result);
  await selectJob(state.selectedJobId);
});
$('verify-job').addEventListener('click', async () => {
  if (!state.selectedJobId) return;
  const result = await api(`/v1/jobs/${state.selectedJobId}/verify-tests`, { method: 'POST' });
  showLoopOutput(result);
  await selectJob(state.selectedJobId);
});

void refreshHealth();
void refreshJobs();
setInterval(() => void refreshHealth(), 10_000);
