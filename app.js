const API_BASE = (window.location.protocol === 'file:' || ['3000', '5500'].includes(window.location.port)) ? 'http://localhost:8080' : '';
const auth = { accessToken: null, user: null };
const state = { activeView: 'landing', activeTab: 'nodes', selectedServer: null, servers: [], blueprints: [], tasks: [], polling: null };

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const iconRefresh = () => window.lucide?.createIcons?.();

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;
  const response = await fetch(`${API_BASE}${path}`, { method, headers, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (response.status === 401) { auth.accessToken = null; auth.user = null; switchView('landing'); }
  if (!response.ok) throw Object.assign(new Error(data?.message || data?.error || `HTTP ${response.status}`), { status: response.status, body: data });
  return data;
}
const get = (path) => api('GET', path);
const post = (path, body) => api('POST', path, body);
const del = (path) => api('DELETE', path);

function toast(message, type = 'info') {
  const container = $('toastContainer') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'toastContainer' }));
  const item = document.createElement('div'); item.className = `toast toast-${type}`; item.textContent = message; container.appendChild(item);
  setTimeout(() => item.remove(), 4500);
}

function switchView(view) {
  const landing = $('viewLanding'); const dashboard = $('viewDashboard');
  if (view === 'dashboard' && !auth.accessToken) return $('modalAuth')?.classList.remove('hidden');
  landing?.classList.toggle('hidden', view === 'dashboard'); dashboard?.classList.toggle('hidden', view !== 'dashboard');
  state.activeView = view;
  if (view === 'dashboard') { startPolling(); loadDashboard(); }
  iconRefresh();
}

function startPolling() { if (!state.polling) state.polling = setInterval(() => loadServers().catch(() => {}), 15000); }
function stopPolling() { if (state.polling) clearInterval(state.polling); state.polling = null; }

async function loadDashboard() {
  await Promise.allSettled([loadServers(), loadBlueprints()]);
  updateUser();
}
async function loadServers() {
  state.servers = await get('/api/v1/servers');
  renderServers(state.servers);
  updateStats();
  if (state.selectedServer) selectServer(state.selectedServer.id, false);
}
async function loadBlueprints() { state.blueprints = await get('/api/v1/blueprints'); updateStats(); if (state.activeTab === 'blueprints') renderBlueprints(); }
function updateUser() {
  const email = auth.user?.email || '—'; const role = auth.user?.role === 'VIEWER' ? 'Read-Only Viewer' : 'Control Plane Owner';
  ['currentUserEmail','userProfileEmail'].forEach((id) => { if ($(id)) $(id).textContent = email; });
  ['currentUserRole','userProfileRole'].forEach((id) => { if ($(id)) $(id).textContent = role; });
  if ($('dashUserAvatar')) $('dashUserAvatar').textContent = email[0]?.toUpperCase() || 'U';
  $('demoBadgeWrap')?.classList.toggle('hidden', auth.user?.role !== 'VIEWER');
}
function updateStats() {
  const values = { valTotalNodes: state.servers.length, valAgents: state.servers.filter((s) => s.status === 'ONLINE').length, valBlueprints: state.blueprints.length, badgeNodesCount: state.servers.length, badgeNodesCountInner: state.servers.length, badgeBlueprintsCount: state.blueprints.length };
  Object.entries(values).forEach(([id, value]) => { if ($(id)) $(id).textContent = value; });
}

function renderServers(servers) {
  const list = $('nodesCardList'); if (!list) return;
  if (!servers.length) { list.innerHTML = '<div class="detail-empty"><strong>No nodes yet</strong><span>Register a VPS node to start receiving telemetry.</span></div>'; return; }
  list.innerHTML = servers.map((server) => `<button class="vps-btn${state.selectedServer?.id === server.id ? ' active' : ''}" data-server-id="${esc(server.id)}"><span class="vps-btn-dot vps-btn-dot-${server.status === 'ONLINE' ? 'online' : server.status === 'OFFLINE' ? 'offline' : 'pending'}"></span><span class="vps-btn-info"><span class="vps-btn-name">${esc(server.name)}</span><span class="vps-btn-provider">${esc(server.provider)}</span><span class="vps-btn-ip">${esc(server.ipAddress)}</span></span><span class="vps-btn-delete" data-delete-id="${esc(server.id)}" aria-label="Remove ${esc(server.name)}">×</span></button>`).join('');
  list.querySelectorAll('[data-server-id]').forEach((button) => button.addEventListener('click', (event) => { if (event.target.dataset.deleteId) return; selectServer(button.dataset.serverId); }));
  list.querySelectorAll('[data-delete-id]').forEach((button) => button.addEventListener('click', async (event) => { event.stopPropagation(); const server = state.servers.find((s) => s.id === button.dataset.deleteId); if (server && confirm(`Remove server "${server.name}"?`)) { await del(`/api/v1/servers/${server.id}`); state.selectedServer = null; await loadServers(); toast('Server removed', 'success'); } }));
  iconRefresh();
}

async function selectServer(id, refresh = true) {
  const server = state.servers.find((item) => item.id === id); if (!server) return;
  state.selectedServer = server;
  if ($('drawerNodeName')) $('drawerNodeName').textContent = server.name;
  if ($('drawerNodeMeta')) $('drawerNodeMeta').textContent = `${server.provider} • ${server.ipAddress} • ${server.os}`;
  $('detailEmptyState')?.classList.add('hidden'); $('nodeDetailDrawer')?.classList.remove('hidden');
  renderServers(state.servers);
  try {
    const metrics = await get(`/api/v1/servers/${id}/metrics?limit=1`); const metric = metrics.at(-1);
    [['Cpu','cpu'],['Ram','memory'],['Disk','disk']].forEach(([label, key]) => { const value = metric?.[key] ?? 0; if ($(`gauge${label}Val`)) $(`gauge${label}Val`).textContent = metric ? `${Number(value).toFixed(1)}%` : 'Awaiting data'; if ($(`gauge${label}Fill`)) $(`gauge${label}Fill`).style.width = `${Math.max(0, Math.min(100, Number(value)))}%`; });
  } catch { resetGauges(); }
  if (refresh) iconRefresh();
}
function resetGauges() { ['Cpu','Ram','Disk'].forEach((key) => { if ($(`gauge${key}Val`)) $(`gauge${key}Val`).textContent = 'Awaiting data'; if ($(`gauge${key}Fill`)) $(`gauge${key}Fill`).style.width = '0%'; }); }

function switchTab(tab) {
  state.activeTab = tab;
  const sections = { nodes: 'sectionNodes', tasks: 'sectionTasks', blueprints: 'sectionBlueprints', diagnostics: 'sectionDiagnostics', settings: 'sectionSettings' };
  Object.entries(sections).forEach(([name, id]) => $(id)?.classList.toggle('hidden', name !== tab));
  const titles = { nodes: ['VPS Server Nodes','Manage, monitor, and configure your Linux cloud instances.'], tasks: ['Tasks & Actions','Execute allow-listed maintenance actions via the outbound agent.'], blueprints: ['Blueprints & Migration','Declarative environment specifications and restoration.'], diagnostics: ['Logs & AI Diagnostics','Inspect telemetry and sanitize operational logs.'], settings: ['Settings & Disaster Recovery','Export and restore control plane state.'] };
  if ($('pageTitleText')) $('pageTitleText').textContent = titles[tab][0]; if ($('pageSubtext')) $('pageSubtext').textContent = titles[tab][1];
  $('btnAddNode')?.classList.toggle('hidden', tab !== 'nodes'); $('btnScanBlueprint')?.classList.toggle('hidden', tab !== 'blueprints'); $('btnRunAiDiagnostics')?.classList.toggle('hidden', tab !== 'diagnostics');
  if (tab === 'tasks') loadTasks(); if (tab === 'blueprints') renderBlueprints(); if (tab === 'diagnostics') loadLogs();
  iconRefresh();
}

async function loadTasks() { state.tasks = await get('/api/v1/tasks'); const body = $('tasksTableBody'); if (!body) return; body.innerHTML = state.tasks.length ? state.tasks.slice(0, 100).map((task) => `<tr><td><code>${esc(task.id.slice(0, 8))}…</code></td><td>${esc(task.type)}</td><td>${esc(task.server?.name || task.serverId)}</td><td><span class="status-chip ${esc(task.status.toLowerCase())}">${esc(task.status)}</span></td><td>${esc(new Date(task.createdAt).toLocaleString())}</td></tr>`).join('') : '<tr><td colspan="5"><div class="empty-state">No tasks dispatched yet.</div></td></tr>'; }

function renderBlueprints() { const container = $('blueprintsContainer'); if (!container) return; container.innerHTML = state.blueprints.length ? state.blueprints.map((blueprint) => { const version = blueprint.versions?.[0]; return `<div class="bp-simple-card"><div><div class="bp-simple-title">${esc(blueprint.name)}</div><div class="bp-simple-desc">Version ${version?.version || 1} • ${esc(blueprint.server?.name || 'Unknown source')}</div></div><button class="btn btn-primary" data-restore-id="${esc(version?.id || '')}" data-restore-name="${esc(blueprint.name)}">Restore</button></div>`; }).join('') : '<div class="empty-state"><strong>No blueprints yet</strong><span>Capture one from a connected node.</span></div>'; container.querySelectorAll('[data-restore-id]').forEach((button) => button.addEventListener('click', () => openRestore(button.dataset.restoreId, button.dataset.restoreName))); iconRefresh(); }
function openRestore(versionId, name) { $('restoreWizardBox')?.classList.remove('hidden'); if ($('lblRestoreBpName')) $('lblRestoreBpName').textContent = name; const select = $('selectTargetVps'); if (select) { const online = state.servers.filter((s) => s.status === 'ONLINE'); select.innerHTML = online.length ? online.map((s) => `<option value="${esc(s.id)}" data-version-id="${esc(versionId)}">${esc(s.name)} (${esc(s.ipAddress)})</option>`).join('') : '<option disabled>No ONLINE servers</option>'; } }

async function dispatchTask(type, payload = {}) { if (!state.selectedServer) return toast('Select a server first', 'error'); const status = $('taskPipelineStatus'); const output = $('taskConsoleOutput'); try { if (status) status.textContent = 'QUEUED'; const task = await post('/api/v1/tasks', { serverId: state.selectedServer.id, type, payload }); if (output) output.textContent = `Task ${task.id} queued. Waiting for agent acknowledgement…`; pollTask(task.id); toast(`${type} queued`, 'success'); } catch (error) { if (output) output.textContent = `[ERROR] ${error.message}`; toast(error.message, 'error'); } }
async function pollTask(id) { for (let attempt = 0; attempt < 60; attempt++) { await new Promise((resolve) => setTimeout(resolve, 5000)); try { const task = await get(`/api/v1/tasks/${id}`); if ($('taskPipelineStatus')) $('taskPipelineStatus').textContent = task.status; if ($('taskConsoleOutput')) $('taskConsoleOutput').textContent = task.logs?.map((log) => `[${new Date(log.createdAt).toLocaleTimeString()}] ${log.level}: ${log.message}`).join('\n') || task.status; if (['COMPLETED','FAILED','CANCELLED'].includes(task.status)) return; } catch { return; } } }

async function captureBlueprint() { if (!state.selectedServer) return toast('Select a server first', 'error'); const name = `${state.selectedServer.name}-blueprint-${Date.now()}`; const manifest = { version: '1.1', blueprint: { name, os: state.selectedServer.os, architecture: state.selectedServer.architecture, captured_from: state.selectedServer.name, captured_at: new Date().toISOString() }, system: { packages: [], services: [] }, containers: { services: [], active_containers: [] }, ports: [] }; try { await post('/api/v1/blueprints', { serverId: state.selectedServer.id, name, manifest }); await loadBlueprints(); switchTab('blueprints'); toast('Blueprint captured', 'success'); } catch (error) { toast(error.message, 'error'); } }
async function executeRestore() { const select = $('selectTargetVps'); const option = select?.options[select.selectedIndex]; if (!select?.value || !option?.dataset.versionId) return toast('Select an online target', 'error'); try { const result = await post('/api/v1/blueprints/restore', { blueprintVersionId: option.dataset.versionId, targetServerId: select.value }); if ($('restoreTerminalOutput')) $('restoreTerminalOutput').textContent = `Task ${result.taskId} queued.\n${result.warnings?.join('\n') || 'No compatibility warnings.'}`; $('restoreProgressBox')?.classList.remove('hidden'); } catch (error) { toast(error.message, 'error'); } }
async function loadLogs() { const output = $('diagConsoleOutput'); if (!output) return; output.textContent = ''; for (const server of state.servers.slice(0, 5)) { try { const logs = await get(`/api/v1/servers/${server.id}/logs?limit=10`); output.textContent += `\n[${server.name}]\n${logs.map((log) => JSON.stringify(log.payload)).join('\n') || '(no telemetry)'}\n`; } catch { output.textContent += `\n[${server.name}] unavailable\n`; } } }
async function runDiagnostics() { const output = $('aiDiagOutput'); try { const result = await post('/api/v1/diagnostics/ai', { rawLogs: $('diagConsoleOutput')?.textContent || '' }); if (output) output.textContent = `${result.diagnosticResults.join('\n')}\n\n${result.sanitizedLogs}`; } catch (error) { toast(error.message, 'error'); } }
async function createBackup() { try { const response = await fetch(`${API_BASE}/api/v1/backups/export`, { headers: auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {} }); if (!response.ok) throw new Error(`Backup failed: HTTP ${response.status}`); const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `pocketcloud-backup-${new Date().toISOString().slice(0,10)}.json`; link.click(); URL.revokeObjectURL(link.href); toast('Backup exported', 'success'); } catch (error) { toast(error.message, 'error'); } }

async function submitAuth(event) { event.preventDefault(); const email = $('inputAuthEmail')?.value.trim(); const password = $('inputAuthPassword')?.value; try { const result = await post($('authModalTitle')?.textContent === 'Create Account' ? '/api/v1/auth/register' : '/api/v1/auth/login', { email, password }); auth.accessToken = result.accessToken; auth.user = result.user; $('modalAuth')?.classList.add('hidden'); switchView('dashboard'); } catch (error) { if ($('authErrorMsg')) $('authErrorMsg').textContent = error.message; } }
async function demoLogin() { try { const result = await post('/api/v1/auth/demo', {}); auth.accessToken = result.accessToken; auth.user = result.user; $('modalAuth')?.classList.add('hidden'); switchView('dashboard'); } catch (error) { toast(error.message, 'error'); } }
function logout() { stopPolling(); auth.accessToken = null; auth.user = null; post('/api/v1/auth/logout', {}).catch(() => {}); switchView('landing'); }

function bindEvents() {
  ['btnLandingLogin','btnLandingGetStarted','btnHeroDeploy','btnHeroGetStarted','btnStartBuilding'].forEach((id) => $(id)?.addEventListener('click', () => auth.accessToken ? switchView('dashboard') : $('modalAuth')?.classList.remove('hidden')));
  ['btnHeroDemo','btnDemoLogin'].forEach((id) => $(id)?.addEventListener('click', demoLogin));
  ['btnLogout','navItemLogout','settingsLogoutBtn'].forEach((id) => $(id)?.addEventListener('click', logout));
  $('btnCloseAuthModal')?.addEventListener('click', () => $('modalAuth')?.classList.add('hidden')); $('formAuth')?.addEventListener('submit', submitAuth);
  $('btnSwitchAuthMode')?.addEventListener('click', () => { if ($('authModalTitle')) $('authModalTitle').textContent = $('authModalTitle').textContent === 'Sign In' ? 'Create Account' : 'Sign In'; });
  ['nodes','tasks','blueprints','diagnostics','settings'].forEach((tab) => $(`navItem${tab[0].toUpperCase()}${tab.slice(1)}`)?.addEventListener('click', () => switchTab(tab)));
  $('btnAddNode')?.addEventListener('click', () => { $('modalAddServer')?.classList.remove('hidden'); $('formAddServer')?.classList.remove('hidden'); $('boxAgentInstallCmd')?.classList.add('hidden'); }); $('btnCloseNodeModal')?.addEventListener('click', () => $('modalAddServer')?.classList.add('hidden')); $('btnCloseNodeModal2')?.addEventListener('click', () => $('modalAddServer')?.classList.add('hidden'));
  $('formAddServer')?.addEventListener('submit', async (event) => { event.preventDefault(); try { const result = await post('/api/v1/servers', { name: $('inputNodeName').value.trim(), provider: $('inputNodeProvider').value.trim(), ipAddress: $('inputNodeIP').value.trim(), os: $('inputNodeOS').value.trim() }); $('txtAgentInstallCmd').textContent = result.installCommand; $('formAddServer')?.classList.add('hidden'); $('boxAgentInstallCmd')?.classList.remove('hidden'); await loadServers(); } catch (error) { toast(error.message, 'error'); } }); $('btnFinishNodeAdd')?.addEventListener('click', () => $('modalAddServer')?.classList.add('hidden'));
  $('btnScanBlueprint')?.addEventListener('click', captureBlueprint); $('btnExecuteRestore')?.addEventListener('click', executeRestore); $('btnRunAiDiagnostics')?.addEventListener('click', runDiagnostics); $('btnCreateBackup')?.addEventListener('click', createBackup);
  document.querySelectorAll('.btn-drawer-action').forEach((button) => button.addEventListener('click', () => dispatchTask(button.dataset.task === 'restart_services' ? 'restart_service' : button.dataset.task === 'install_dev_tools' ? 'update_packages' : button.dataset.task === 'manage_ssh_keys' ? 'collect_logs' : button.dataset.task)));
  document.querySelectorAll('.btn-quick-dispatch').forEach((button) => button.addEventListener('click', () => dispatchTask(button.dataset.action === 'restart_services' ? 'restart_service' : button.dataset.action)));
  $('globalSearchInput')?.addEventListener('input', (event) => renderServers(state.servers.filter((server) => `${server.name} ${server.provider} ${server.ipAddress}`.toLowerCase().includes(event.target.value.toLowerCase()))));
}

document.addEventListener('DOMContentLoaded', () => { bindEvents(); iconRefresh(); });