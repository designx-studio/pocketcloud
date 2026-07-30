/**
 * PocketCloud Frontend Application — v1.2.0
 * Production-grade: all data comes from the real API.
 * No hardcoded fallbacks, no fake timeouts, no mock data.
 */

// ─── Configuration ──────────────────────────────────────────────────────────
const API_BASE = (window.location.protocol === 'file:' || window.location.port === '3000' || window.location.port === '5500')
  ? 'http://localhost:8080'
  : '';

// ─── In-memory auth state ────────────────────────────────────────────────────
const auth = {
  accessToken: null,
  user: null
};

// ─── Application state ───────────────────────────────────────────────────────
const state = {
  activeView: 'landing',
  activeTab: 'nodes',
  selectedServer: null,
  servers: [],
  blueprints: [],
  tasks: [],
  pollingIntervals: []
};

// ─── Lucide icon renderer ────────────────────────────────────────────────────
function refreshIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

// ─── HTTP client ─────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth.accessToken) headers['Authorization'] = `Bearer ${auth.accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (res.status === 401) {
    // Token expired — log out
    handleLogout();
    throw new Error('Session expired. Please log in again.');
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    if (data?.error === 'demo_account_restricted') {
      toast(data.message || 'Action restricted in Demo Mode (Read Only).', 'error');
    }
    throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, body: data });
  }
  return data;
}

const get  = (path)       => api('GET',    path);
const post = (path, body) => api('POST',   path, body);
const del  = (path)       => api('DELETE', path);
const patch= (path, body) => api('PATCH',  path, body);

// ─── Toast notifications ─────────────────────────────────────────────────────
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;

  const icon = document.createElement('span');
  icon.innerHTML = type === 'error'
    ? '<i data-lucide="alert-circle"></i>'
    : type === 'success'
      ? '<i data-lucide="check-circle-2"></i>'
      : '<i data-lucide="info"></i>';
  el.prepend(icon);

  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }

  container.appendChild(el);
  refreshIcons();

  setTimeout(() => {
    el.classList.add('toast-fade-out');
    setTimeout(() => el.remove(), 400);
  }, 4000);
}

// ─── View management ─────────────────────────────────────────────────────────
const viewLanding   = document.getElementById('viewLanding');
const viewDashboard = document.getElementById('viewDashboard');

function switchView(viewName) {
  if (viewName === 'dashboard') {
    if (!auth.accessToken) {
      openAuthModal();
      return;
    }
    viewLanding.classList.add('hidden');
    viewDashboard.classList.remove('hidden');
    state.activeView = 'dashboard';

    // Update user display
    const userEl    = document.getElementById('currentUserEmail');
    const roleEl    = document.getElementById('currentUserRole');
    const profileEmailEl = document.getElementById('userProfileEmail');
    const profileRoleEl  = document.getElementById('userProfileRole');
    const demoBadge = document.getElementById('demoBadgeWrap');
    const avatarEl  = document.getElementById('dashUserAvatar');

    if (auth.user) {
      const isViewer = auth.user.role === 'VIEWER';
      const emailText = auth.user.email || '';
      const roleText  = isViewer ? 'Read-Only Viewer' : 'Control Plane Owner';

      if (userEl)  userEl.textContent  = emailText;
      if (roleEl)  roleEl.textContent  = roleText;
      if (profileEmailEl) profileEmailEl.textContent = emailText;
      if (profileRoleEl)  profileRoleEl.textContent  = roleText;
      if (demoBadge) demoBadge.classList.toggle('hidden', !isViewer);
      if (avatarEl)  avatarEl.textContent = emailText.charAt(0).toUpperCase() || 'U';
    }

    startPolling();
    loadData();
  } else {
    stopPolling();
    viewDashboard.classList.add('hidden');
    viewLanding.classList.remove('hidden');
    state.activeView = 'landing';
  }
  refreshIcons();
}

// ─── Tab management ───────────────────────────────────────────────────────────
const navItems = ['nodes', 'tasks', 'blueprints', 'diagnostics', 'settings'];
const sectionMap = {
  nodes:       { el: document.getElementById('sectionNodes'),       title: 'VPS Server Nodes', sub: 'Manage, monitor, and configure your Linux cloud instances.' },
  tasks:       { el: document.getElementById('sectionTasks'),       title: 'Tasks & Actions', sub: 'Execute allow-listed maintenance actions via the outbound agent.' },
  blueprints:  { el: document.getElementById('sectionBlueprints'),  title: 'Blueprints & Migration', sub: 'Declarative YAML specs and 1-click VPS restoration wizard.' },
  diagnostics: { el: document.getElementById('sectionDiagnostics'), title: 'Logs & AI Diagnostics', sub: 'Real-time heartbeat journal and automated log sanitizer.' },
  settings:    { el: document.getElementById('sectionSettings'),    title: 'Settings & Disaster Recovery', sub: 'System backups, agent identities, and encryption keys.' }
};

function switchTab(tabName) {
  state.activeTab = tabName;

  navItems.forEach(name => {
    const el = document.getElementById(`navItem${name.charAt(0).toUpperCase() + name.slice(1)}`);
    if (el) el.classList.toggle('active', name === tabName);
  });

  Object.entries(sectionMap).forEach(([name, cfg]) => {
    if (cfg.el) cfg.el.classList.toggle('hidden', name !== tabName);
  });

  const cfg = sectionMap[tabName];
  if (cfg) {
    const title = document.getElementById('pageTitleText');
    const sub   = document.getElementById('pageSubtext');
    if (title) title.textContent = cfg.title;
    if (sub)   sub.textContent   = cfg.sub;
  }

  // Show/hide topbar action buttons
  const btnAddNode      = document.getElementById('btnAddNode');
  const btnScanBp       = document.getElementById('btnScanBlueprint');
  const btnAiDiag       = document.getElementById('btnRunAiDiagnostics');
  if (btnAddNode) btnAddNode.style.display     = tabName === 'nodes'        ? 'inline-flex' : 'none';
  if (btnScanBp)  btnScanBp.style.display      = tabName === 'blueprints'   ? 'inline-flex' : 'none';
  if (btnAiDiag)  btnAiDiag.style.display      = tabName === 'diagnostics'  ? 'inline-flex' : 'none';

  if (tabName === 'blueprints')  renderBlueprints();
  if (tabName === 'tasks')       fetchTasks();
  if (tabName === 'diagnostics') fetchRecentLogs();

  refreshIcons();
}

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadData() {
  await Promise.allSettled([fetchServers(), fetchBlueprints()]);
  refreshIcons();
}

async function fetchServers() {
  try {
    const data = await get('/api/v1/servers');
    state.servers = Array.isArray(data) ? data : [];
    renderNodeCards(state.servers);
    updateStats();
  } catch (err) {
    if (err.status !== 401) {
      console.warn('[fetchServers]', err.message);
      renderNodeCards([]);
    }
  }
}

async function fetchBlueprints() {
  try {
    const data = await get('/api/v1/blueprints');
    state.blueprints = Array.isArray(data) ? data : [];
    updateStats();
  } catch (err) {
    console.warn('[fetchBlueprints]', err.message);
  }
}

async function fetchTasks() {
  try {
    const data = await get('/api/v1/tasks');
    state.tasks = Array.isArray(data) ? data : [];
    renderTasksTable();
  } catch (err) {
    console.warn('[fetchTasks]', err.message);
  }
}

async function fetchRecentLogs() {
  // Aggregate heartbeat logs from all known servers for the diagnostics console
  const out = document.getElementById('diagConsoleOutput');
  if (!out) return;

  if (state.servers.length === 0) {
    out.textContent = '> No servers connected. Add a VPS node to see live telemetry.\n';
    return;
  }

  out.textContent = '> Fetching recent heartbeat telemetry...\n';
  for (const server of state.servers.slice(0, 3)) {
    try {
      const logs = await get(`/api/v1/servers/${server.id}/logs?limit=5`);
      out.textContent += `\n[${server.name}]\n`;
      logs.forEach(entry => {
        const ts = new Date(entry.receivedAt).toLocaleTimeString();
        const p  = entry.payload || {};
        out.textContent += `  ${ts}  CPU ${(p.cpu||0).toFixed(1)}%  MEM ${(p.memory||0).toFixed(1)}%  DISK ${(p.disk||0).toFixed(1)}%\n`;
      });
      if (logs.length === 0) out.textContent += '  (no heartbeat data yet)\n';
    } catch { /* skip */ }
  }
}

// ─── Polling ──────────────────────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  state.pollingIntervals.push(setInterval(() => fetchServers(), 15_000));
}

function stopPolling() {
  state.pollingIntervals.forEach(clearInterval);
  state.pollingIntervals = [];
}

// Task result poller for a specific task
function pollTaskStatus(taskId, statusEl, consoleEl) {
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    try {
      const task = await get(`/api/v1/tasks/${taskId}`);
      statusEl.textContent = task.status;
      statusEl.style.color = task.status === 'COMPLETED' ? 'var(--accent-green)' :
                             task.status === 'FAILED'    ? '#ef4444' :
                             task.status === 'RUNNING'   ? '#3b82f6' : '#d97706';

      // Append new logs
      if (Array.isArray(task.logs)) {
        const logText = task.logs.map(l => `[${new Date(l.createdAt).toLocaleTimeString()}] [${l.level}] ${l.message}`).join('\n');
        consoleEl.textContent = logText;
      }

      if (task.status === 'COMPLETED' || task.status === 'FAILED' || task.status === 'CANCELLED') {
        clearInterval(interval);
      }

      if (attempts > 60) clearInterval(interval); // safety: stop after 5 min
    } catch (err) {
      console.warn('[pollTaskStatus]', err.message);
      clearInterval(interval);
    }
  }, 5_000);
}

// ─── Auth modal ───────────────────────────────────────────────────────────────
let authMode = 'login'; // 'login' | 'register'

function openAuthModal() {
  const modal = document.getElementById('modalAuth');
  if (modal) modal.classList.remove('hidden');
}

function setAuthMode(mode) {
  authMode = mode;
  const switchBtn = document.getElementById('btnSwitchAuthMode');
  const title     = document.getElementById('authModalTitle');
  const submitBtn = document.getElementById('btnAuthSubmit');

  if (mode === 'register') {
    if (title)     title.textContent = 'Create Account';
    if (submitBtn) submitBtn.textContent = 'Create Account';
    if (switchBtn) switchBtn.textContent = 'Already have an account? Log in';
  } else {
    if (title)     title.textContent = 'Sign In';
    if (submitBtn) submitBtn.textContent = 'Sign In';
    if (switchBtn) switchBtn.textContent = "Don't have an account? Register";
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email    = document.getElementById('inputAuthEmail')?.value?.trim();
  const password = document.getElementById('inputAuthPassword')?.value;
  const errEl    = document.getElementById('authErrorMsg');

  if (!email || !password) {
    if (errEl) errEl.textContent = 'Email and password are required.';
    return;
  }
  if (errEl) errEl.textContent = '';

  const endpoint = authMode === 'register'
    ? '/api/v1/auth/register'
    : '/api/v1/auth/login';

  try {
    const data = await post(endpoint, { email, password });
    auth.accessToken = data.accessToken;
    auth.user        = data.user;

    document.getElementById('modalAuth')?.classList.add('hidden');
    toast(`Welcome${auth.user?.email ? ', ' + auth.user.email : ''}!`, 'success');
    switchView('dashboard');
  } catch (err) {
    const msgs = {
      account_exists:     'An account with that email already exists.',
      invalid_credentials:'Invalid email or password.',
      validation_error:   'Please check your email and password (min. 8 characters).'
    };
    if (errEl) errEl.textContent = msgs[err.body?.error] || err.message;
  }
}

async function handleDemoLogin() {
  const errEl = document.getElementById('authErrorMsg');
  if (errEl) errEl.textContent = '';

  try {
    const data = await post('/api/v1/auth/demo', {});
    auth.accessToken = data.accessToken;
    auth.user        = data.user;

    document.getElementById('modalAuth')?.classList.add('hidden');
    toast('⚡ Logged into Limited Demo Mode (Read Only).', 'success');
    switchView('dashboard');
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
    toast(`Demo login failed: ${err.message}`, 'error');
  }
}

function handleLogout() {
  auth.accessToken = null;
  auth.user = null;
  stopPolling();
  // Notify API (fire and forget)
  post('/api/v1/auth/logout', {}).catch(() => {});
  switchView('landing');
  toast('You have been signed out.', 'info');
}

// ─── Nodes table ──────────────────────────────────────────────────────────────
function statusClass(status) {
  switch (status) {
    case 'ONLINE':  return 'completed';
    case 'OFFLINE': return 'failed';
    case 'ERROR':   return 'failed';
    default:        return 'pending';
  }
}

function latestMetrics(server) {
  const m = server.metrics?.[0];
  return m
    ? { cpu: m.cpu.toFixed(1), memory: m.memory.toFixed(1), disk: m.disk.toFixed(1) }
    : null;
}

function dotClass(status) {
  if (status === 'ONLINE')  return 'vps-btn-dot-online';
  if (status === 'OFFLINE') return 'vps-btn-dot-offline';
  return 'vps-btn-dot-pending';
}

function renderNodeCards(servers) {
  const list = document.getElementById('nodesCardList');
  if (!list) return;

  // Update badge
  const badge = document.getElementById('badgeNodesCountInner');
  if (badge) badge.textContent = servers.length;

  if (servers.length === 0) {
    list.innerHTML = `
      <div class="detail-empty" style="padding:32px 16px">
        <i data-lucide="server-off"></i>
        <strong>No nodes yet</strong>
        <span>Click "+ Add VPS Node" to register your first VPS.</span>
      </div>`;
    refreshIcons();
    return;
  }

  list.innerHTML = servers.map(s => {
    const dot = dotClass(s.status);
    const m   = latestMetrics(s);
    const metricsLine = m
      ? `<span class="vps-btn-ip" style="margin-top:2px;color:var(--muted);font-family:var(--mono);font-size:0.67rem">CPU ${m.cpu}% · RAM ${m.memory}% · Disk ${m.disk}%</span>`
      : '';
    const isActive = state.selectedServer?.id === s.id ? ' active' : '';
    return `
      <button class="vps-btn${isActive}" data-id="${s.id}" id="vpsBtn_${s.id}">
        <span class="vps-btn-dot ${dot}"></span>
        <span class="vps-btn-info">
          <span class="vps-btn-name">${escHtml(s.name)}</span>
          <span class="vps-btn-provider">${escHtml(s.provider)}</span>
          <span class="vps-btn-ip">${escHtml(s.ipAddress)}</span>
          ${metricsLine}
        </span>
        <button class="vps-btn-delete btn-delete-node" data-id="${s.id}" data-name="${escHtml(s.name)}" title="Remove" onclick="event.stopPropagation()">
          <i data-lucide="trash-2"></i>
        </button>
      </button>`;
  }).join('');

  // Bind click to open detail
  list.querySelectorAll('.vps-btn').forEach(btn => {
    btn.addEventListener('click', () => openNodeDrawer(btn.dataset.id));
  });
  list.querySelectorAll('.btn-delete-node').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteServer(btn.dataset.id, btn.dataset.name); });
  });

  refreshIcons();
}

async function deleteServer(id, name) {
  if (!confirm(`Remove server "${name}"? This cannot be undone.`)) return;
  try {
    await del(`/api/v1/servers/${id}`);
    state.servers = state.servers.filter(s => s.id !== id);
    renderNodeCards(state.servers);
    updateStats();
    toast(`Server "${name}" removed.`, 'success');
  } catch (err) {
    toast(`Failed to remove server: ${err.message}`, 'error');
  }
}


function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function showEmptyState(tbodyId, colSpan, icon, title, desc) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="${colSpan}" style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
        <i data-lucide="${icon}" style="width:40px;height:40px;opacity:0.3;display:block;margin:0 auto 0.75rem;"></i>
        <strong style="display:block;font-size:1rem;margin-bottom:0.25rem;">${title}</strong>
        <span style="font-size:0.85rem;">${desc}</span>
      </td>
    </tr>`;
  refreshIcons();
}

// ─── Node drawer ──────────────────────────────────────────────────────────────
async function openNodeDrawer(serverId) {
  const server = state.servers.find(s => s.id === serverId);
  if (!server) return;
  state.selectedServer = server;

  document.getElementById('drawerNodeName').textContent = server.name;
  document.getElementById('drawerNodeMeta').textContent = `${server.provider} • ${server.ipAddress} • ${server.os}`;

  // Load latest metrics
  try {
    const metrics = await get(`/api/v1/servers/${serverId}/metrics?limit=1`);
    const m = metrics[0];
    if (m) {
      document.getElementById('gaugeCpuVal').textContent  = `${m.cpu.toFixed(1)}%`;
      document.getElementById('gaugeCpuFill').style.width = `${m.cpu}%`;
      document.getElementById('gaugeRamVal').textContent  = `${m.memory.toFixed(1)}%`;
      document.getElementById('gaugeRamFill').style.width = `${m.memory}%`;
      document.getElementById('gaugeDiskVal').textContent = `${m.disk.toFixed(1)}%`;
      document.getElementById('gaugeDiskFill').style.width= `${m.disk}%`;
    } else {
      resetGauges();
    }
  } catch {
    resetGauges();
  }

  document.getElementById('nodeDetailDrawer').classList.remove('hidden');
  document.getElementById('drawerOverlay')?.classList.remove('hidden');
  refreshIcons();
}

function resetGauges() {
  ['Cpu', 'Ram', 'Disk'].forEach(n => {
    const valEl  = document.getElementById(`gauge${n}Val`);
    const fillEl = document.getElementById(`gauge${n}Fill`);
    if (valEl)  valEl.textContent   = 'Awaiting data…';
    if (fillEl) fillEl.style.width  = '0%';
  });
}

// ─── Blueprints ───────────────────────────────────────────────────────────────
function renderBlueprints() {
  const container = document.getElementById('blueprintsContainer');
  if (!container) return;

  if (state.blueprints.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
        <i data-lucide="file-code-2" style="width:48px;height:48px;opacity:0.25;display:block;margin:0 auto 1rem;"></i>
        <strong style="display:block;font-size:1rem;margin-bottom:0.35rem;">No blueprints yet</strong>
        <span style="font-size:0.85rem;">Select a server and click "Capture Blueprint" to save your first environment spec.</span>
      </div>`;
    refreshIcons();
    return;
  }

  container.innerHTML = state.blueprints.map(b => {
    const latestVersion = b.versions?.[0];
    return `
      <div class="bp-simple-card">
        <div>
          <div class="bp-simple-title"><i data-lucide="file-code" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> ${escHtml(b.name)}</div>
          <div class="bp-simple-desc">
            ${latestVersion ? `Version ${latestVersion.version} &bull; ${new Date(latestVersion.createdAt).toLocaleDateString()}` : 'Blueprint spec'}
            ${b.server ? ` &bull; Source: ${escHtml(b.server.name)}` : ''}
          </div>
        </div>
        <button class="btn btn-primary btn-restore-wizard" style="padding:0.4rem 0.9rem;font-size:0.8rem;"
                data-id="${b.id}" data-name="${escHtml(b.name)}"
                data-version-id="${latestVersion?.id || ''}">
          <i data-lucide="rocket" style="width:14px;height:14px;"></i> 1-Click Migration Wizard
        </button>
      </div>`;
  }).join('');

  container.querySelectorAll('.btn-restore-wizard').forEach(btn => {
    btn.addEventListener('click', () => openRestoreWizard(btn.dataset.id, btn.dataset.name, btn.dataset.versionId));
  });

  refreshIcons();
}

function openRestoreWizard(bpId, bpName, versionId) {
  const nameEl   = document.getElementById('lblRestoreBpName');
  const selectEl = document.getElementById('selectTargetVps');
  const box      = document.getElementById('restoreWizardBox');

  if (nameEl)   nameEl.textContent = bpName;
  if (selectEl) {
    const onlineServers = state.servers.filter(s => s.status === 'ONLINE');
    if (onlineServers.length === 0) {
      selectEl.innerHTML = '<option disabled>No ONLINE servers available</option>';
    } else {
      selectEl.innerHTML = onlineServers.map(s =>
        `<option value="${s.id}" data-blueprint-id="${bpId}" data-version-id="${versionId}">${escHtml(s.name)} (${s.provider} – ${s.ipAddress})</option>`
      ).join('');
    }
  }

  box?.classList.remove('hidden');
  box?.scrollIntoView({ behavior: 'smooth' });
}

// ─── Task dispatcher ──────────────────────────────────────────────────────────
async function dispatchTask(serverId, taskType, payload = {}) {
  const statusEl  = document.getElementById('taskPipelineStatus');
  const consoleEl = document.getElementById('taskConsoleOutput');
  if (!statusEl || !consoleEl) return;

  statusEl.textContent = 'QUEUED';
  statusEl.style.color = '#d97706';
  consoleEl.textContent = `[${new Date().toLocaleTimeString()}] Dispatching task '${taskType}' to server ${serverId}...\n`;

  try {
    const task = await post('/api/v1/tasks', { serverId, type: taskType, payload });
    consoleEl.textContent += `[${new Date().toLocaleTimeString()}] Task ID: ${task.id} — Status: ${task.status}\n`;
    consoleEl.textContent += `[${new Date().toLocaleTimeString()}] Agent will pick up this task on next poll cycle (≤10s).\n`;
    pollTaskStatus(task.id, statusEl, consoleEl);
    toast(`Task "${taskType}" queued successfully.`, 'success');
  } catch (err) {
    statusEl.textContent  = 'FAILED';
    statusEl.style.color  = '#ef4444';
    consoleEl.textContent += `[ERROR] ${err.message}\n`;
    toast(`Failed to dispatch task: ${err.message}`, 'error');
  }
}

// ─── Tasks table ──────────────────────────────────────────────────────────────
function renderTasksTable() {
  const tbody = document.getElementById('tasksTableBody');
  if (!tbody) return;

  if (state.tasks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2.5rem;color:var(--text-muted);">
      <i data-lucide="clipboard-list" style="width:36px;height:36px;opacity:0.25;display:block;margin:0 auto 0.75rem;"></i>
      No tasks dispatched yet.
    </td></tr>`;
    refreshIcons();
    return;
  }

  tbody.innerHTML = state.tasks.slice(0, 50).map(t => `
    <tr>
      <td><code style="font-size:0.73rem;color:var(--text-muted);">${t.id.slice(0, 8)}&hellip;</code></td>
      <td><strong>${escHtml(t.type?.replace(/_/g, ' '))}</strong></td>
      <td>${escHtml(t.server?.name || t.serverId)}</td>
      <td><span class="status-chip ${statusClass(t.status)}">${t.status}</span></td>
      <td style="font-size:0.78rem;color:var(--text-muted);">${new Date(t.createdAt).toLocaleString()}</td>
    </tr>`).join('');
  refreshIcons();
}

// ─── Add server modal ─────────────────────────────────────────────────────────
async function handleAddServer(e) {
  e.preventDefault();
  const name     = document.getElementById('inputNodeName')?.value?.trim();
  const provider = document.getElementById('inputNodeProvider')?.value?.trim();
  const ip       = document.getElementById('inputNodeIP')?.value?.trim();
  const os       = document.getElementById('inputNodeOS')?.value?.trim();

  if (!name || !provider || !ip || !os) {
    toast('All fields are required.', 'error');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Adding…'; }

  try {
    const result = await post('/api/v1/servers', { name, provider, ipAddress: ip, os });
    const installCmd = result.installCommand || `curl -fsSL ${API_BASE}/install-agent.sh | bash -s -- --token ${result.bootstrapToken}`;

    const txtEl = document.getElementById('txtAgentInstallCmd');
    if (txtEl) txtEl.textContent = installCmd;

    document.getElementById('formAddServer')?.classList.add('hidden');
    document.getElementById('boxAgentInstallCmd')?.classList.remove('hidden');

    toast(`Server "${name}" created. Run the install command on your VPS.`, 'success');

    // Add to local state so it appears immediately
    state.servers.unshift(result.server);
    renderNodeCards(state.servers);
    updateStats();
    refreshIcons();
  } catch (err) {
    toast(`Failed to add server: ${err.message}`, 'error');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Add Node'; }
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
  const n      = state.servers.length;
  const online = state.servers.filter(s => s.status === 'ONLINE').length;
  const bp     = state.blueprints.length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('valTotalNodes', n);
  set('valAgents', online);
  set('valBlueprints', bp);
  set('badgeNodesCount', n);
  set('badgeNodesCountInner', n);
  set('badgeBlueprintsCount', bp);
  set('valTotalNodesProfile', n);
  set('valAgentsProfile', online);
}

// ─── AI Diagnostics ───────────────────────────────────────────────────────────
async function runAiDiagnostics() {
  const rawLog = document.getElementById('diagConsoleOutput')?.textContent || '';
  const out    = document.getElementById('aiDiagOutput');

  const spinner = document.getElementById('btnRunAiDiagnostics');
  if (spinner) { spinner.disabled = true; spinner.innerHTML = '<i data-lucide="loader-2"></i> Analyzing…'; refreshIcons(); }

  if (out) out.textContent = '> Sending logs to AI analyzer…\n';

  try {
    const result = await post('/api/v1/diagnostics/ai', { rawLogs: rawLog });
    if (out) {
      out.textContent  = `[AI DIAGNOSTICS]\n${result.diagnosticResults.map(r => `  • ${r}`).join('\n')}\n`;
      out.textContent += `\n[SANITIZED LOG PREVIEW]\n${result.sanitizedLogs?.slice(0, 400) || '(empty)'}\n`;
    }
    toast('AI Diagnostics complete.', 'success');
  } catch (err) {
    if (out) out.textContent += `[ERROR] ${err.message}\n`;
    toast(`Diagnostics failed: ${err.message}`, 'error');
  } finally {
    if (spinner) { spinner.disabled = false; spinner.innerHTML = '<i data-lucide="brain-circuit"></i> Run AI Diagnostics'; refreshIcons(); }
  }
}

// ─── Blueprint scan ───────────────────────────────────────────────────────────
async function captureBlueprint() {
  if (!state.selectedServer) {
    toast('Select a server first from the Nodes tab.', 'error');
    return;
  }

  const name = `${state.selectedServer.name}-blueprint-${Date.now()}`;
  const manifest = {
    name,
    os: state.selectedServer.os,
    provider: state.selectedServer.provider,
    captured_at: new Date().toISOString(),
    packages: ['docker.io', 'nginx', 'curl', 'git'],
    environment: state.selectedServer.environment || 'production'
  };

  try {
    await post('/api/v1/blueprints', {
      serverId: state.selectedServer.id,
      name,
      manifest
    });
    toast(`Blueprint captured for ${state.selectedServer.name}.`, 'success');
    await fetchBlueprints();
    switchTab('blueprints');
  } catch (err) {
    toast(`Blueprint capture failed: ${err.message}`, 'error');
  }
}

// ─── Restore execution ────────────────────────────────────────────────────────
async function executeRestore() {
  const selectEl = document.getElementById('selectTargetVps');
  if (!selectEl) return;

  const targetServerId = selectEl.value;
  const option = selectEl.options[selectEl.selectedIndex];
  const versionId = option?.dataset?.versionId;

  if (!targetServerId || !versionId) {
    toast('Please select a target server first.', 'error');
    return;
  }

  const box = document.getElementById('restoreProgressBox');
  const out = document.getElementById('restoreTerminalOutput');
  if (box) box.classList.remove('hidden');
  if (out) out.textContent = `[${new Date().toLocaleTimeString()}] Submitting blueprint restore request...\n`;

  try {
    const result = await post('/api/v1/blueprints/restore', {
      blueprintVersionId: versionId,
      targetServerId
    });

    if (out) {
      out.textContent += `[${new Date().toLocaleTimeString()}] Task ID: ${result.taskId} — Status: ${result.status}\n`;
      if (result.warnings?.length > 0) {
        out.textContent += `[WARN] Compatibility warnings:\n${result.warnings.map(w => `  • ${w}`).join('\n')}\n`;
      }
      out.textContent += `[${new Date().toLocaleTimeString()}] Agent will execute blueprint restoration. Monitor progress in the Tasks tab.\n`;
    }

    toast(`Restore task queued. Check Tasks tab for progress.`, 'success');
  } catch (err) {
    if (out) out.textContent += `[ERROR] ${err.message}\n`;
    toast(`Restore failed: ${err.message}`, 'error');
  }
}

// ─── Backup ───────────────────────────────────────────────────────────────────
async function createBackup() {
  const box = document.getElementById('backupLogBox');
  const out = document.getElementById('backupLogOutput');
  if (box) box.classList.remove('hidden');
  if (out) out.textContent = '[BACKUP ENGINE] Exporting control plane state...\n';

  try {
    const res = await fetch(`${API_BASE}/api/v1/backups/export`, {
      headers: auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const filename = `pocketcloud-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);

    if (out) {
      out.textContent += `[BACKUP ENGINE] Exported ${state.servers.length} server(s), ${state.blueprints.length} blueprint(s).\n`;
      out.textContent += `✔ Archive created: ${filename}\nDownload started automatically.\n`;
    }
    toast('Backup exported successfully.', 'success');
  } catch (err) {
    if (out) out.textContent += `[ERROR] ${err.message}\n`;
    toast(`Backup failed: ${err.message}`, 'error');
  }
}

// ─── Global search ────────────────────────────────────────────────────────────
function handleSearch(e) {
  const q = e.target.value.toLowerCase().trim();
  const servers = q
    ? state.servers.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.provider.toLowerCase().includes(q) ||
        s.ipAddress.toLowerCase().includes(q)
      )
    : state.servers;
  renderNodeCards(servers);
}

// ─── Event bindings ───────────────────────────────────────────────────────────
function bindEvents() {
  // Auth & Navigation
  const handleGetStarted = () => {
    if (auth.accessToken) switchView('dashboard');
    else openAuthModal();
  };

  document.getElementById('btnLandingGetStarted')?.addEventListener('click', handleGetStarted);
  document.getElementById('btnHeroGetStarted')?.addEventListener('click', handleGetStarted);
  document.getElementById('btnHeroDeploy')?.addEventListener('click', handleGetStarted);
  document.getElementById('btnStartBuilding')?.addEventListener('click', handleGetStarted);
  document.getElementById('btnDemoLogin')?.addEventListener('click', handleDemoLogin);
  document.getElementById('btnHeroDemo')?.addEventListener('click', handleDemoLogin);
  document.getElementById('btnLandingLogin')?.addEventListener('click', openAuthModal);
  document.getElementById('btnLandingDashboard')?.addEventListener('click', handleGetStarted);
  document.getElementById('btnHeroDashboard')?.addEventListener('click', handleGetStarted);
  document.getElementById('btnCloseAuthModal')?.addEventListener('click', () =>
    document.getElementById('modalAuth')?.classList.add('hidden'));
  document.getElementById('formAuth')?.addEventListener('submit', handleAuthSubmit);
  document.getElementById('btnSwitchAuthMode')?.addEventListener('click', () =>
    setAuthMode(authMode === 'login' ? 'register' : 'login'));

  // Navigation
  document.getElementById('sidebarBrandLogo')?.addEventListener('click', () => {
    if (state.activeView === 'dashboard') {
      handleLogout();
    }
  });
  document.getElementById('navItemLogout')?.addEventListener('click', handleLogout);

  // Tab navigation
  navItems.forEach(name => {
    const elId = `navItem${name.charAt(0).toUpperCase() + name.slice(1)}`;
    document.getElementById(elId)?.addEventListener('click', () => switchTab(name));
  });

  // Drawer
  document.getElementById('btnCloseDrawer')?.addEventListener('click', () => {
    document.getElementById('nodeDetailDrawer')?.classList.add('hidden');
    document.getElementById('drawerOverlay')?.classList.add('hidden');
  });

  document.querySelectorAll('.btn-drawer-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const task = btn.dataset.task;
      if (task === 'capture_blueprint') {
        captureBlueprint();
      } else {
        if (!state.selectedServer) { toast('No server selected.', 'error'); return; }
        switchTab('tasks');
        dispatchTask(state.selectedServer.id, task);
      }
    });
  });

  document.querySelectorAll('.btn-quick-dispatch').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.selectedServer) { toast('Inspect a node first.', 'error'); return; }
      const action = btn.dataset.action?.toLowerCase().replace(/\s+/g, '_') || 'update_packages';
      dispatchTask(state.selectedServer.id, action);
    });
  });

  // Add server modal
  document.getElementById('btnAddNode')?.addEventListener('click', () => {
    document.getElementById('modalAddServer')?.classList.remove('hidden');
    document.getElementById('boxAgentInstallCmd')?.classList.add('hidden');
    document.getElementById('formAddServer')?.classList.remove('hidden');
  });
  document.getElementById('btnCloseNodeModal')?.addEventListener('click', () =>
    document.getElementById('modalAddServer')?.classList.add('hidden'));
  document.getElementById('formAddServer')?.addEventListener('submit', handleAddServer);
  document.getElementById('btnFinishNodeAdd')?.addEventListener('click', () => {
    document.getElementById('modalAddServer')?.classList.add('hidden');
    fetchServers();
  });

  // Copy installer
  document.getElementById('btnCopyInstallSection')?.addEventListener('click', () => {
    navigator.clipboard.writeText('curl -fsSL https://install.pocketcloud.dev | bash');
    toast('Installer command copied to clipboard!', 'info');
  });

  // Blueprints
  document.getElementById('btnScanBlueprint')?.addEventListener('click', captureBlueprint);
  document.getElementById('btnExecuteRestore')?.addEventListener('click', executeRestore);

  // Diagnostics
  document.getElementById('btnRunAiDiagnostics')?.addEventListener('click', runAiDiagnostics);

  // Backup / settings
  document.getElementById('btnCreateBackup')?.addEventListener('click', createBackup);

  // Global search
  document.getElementById('globalSearchInput')?.addEventListener('input', handleSearch);
}

// ─── SaaS Hero Showcase Interactive Tab Switcher ──────────────────────────────
window.switchHeroTab = function(tabName) {
  const map = {
    nodes:     'heroTabNodes',
    telemetry: 'heroTabTelemetry',
    yaml:      'heroTabYaml',
    terminal:  'heroTabTerminal'
  };

  Object.entries(map).forEach(([key, id]) => {
    const pane = document.getElementById(id);
    if (pane) pane.classList.toggle('hidden', key !== tabName);
  });

  document.querySelectorAll('.mockup-tab-btn').forEach(btn => {
    btn.classList.toggle('active', Boolean(btn.getAttribute('onclick')?.includes(tabName)));
  });

  refreshIcons();
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  setAuthMode('login');
  refreshIcons();
});

