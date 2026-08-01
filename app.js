const API_BASE=(window.location.protocol==='file:'||['3000','5500'].includes(window.location.port))?'http://localhost:8080':'';const auth={accessToken:null,user:null};const state={activeView:'landing',activeTab:'nodes',selectedServer:null,servers:[],blueprints:[],tasks:[],polling:null};const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const iconRefresh=()=>window.lucide?.createIcons?.();
let refreshing = null;
async function api(method,path,body){
  const headers={'Content-Type':'application/json'};
  if(auth.accessToken)headers.Authorization=`Bearer ${auth.accessToken}`;
  let r=await fetch(`${API_BASE}${path}`,{method,headers,credentials:'include',body:body===undefined?undefined:JSON.stringify(body)});
  
  if (r.status === 401 && path !== '/api/v1/auth/refresh' && path !== '/api/v1/auth/login' && path !== '/api/v1/auth/register') {
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          });
          if (res.ok) {
            const data = await res.json();
            auth.accessToken = data.accessToken;
            auth.user = data.user;
            return true;
          }
        } catch (e) {}
        return false;
      })();
    }
    const refreshed = await refreshing;
    refreshing = null;
    if (refreshed) {
      headers.Authorization = `Bearer ${auth.accessToken}`;
      r = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    }
  }

  const t=await r.text();
  let d;
  try{d=t?JSON.parse(t):null}catch{d=t}
  if(r.status===401){
    auth.accessToken=null;
    auth.user=null;
    switchView('landing');
  }
  if(!r.ok)throw Object.assign(new Error(d?.message||d?.error||`HTTP ${r.status}`),{status:r.status,body:d});
  return d;
}
const get=p=>api('GET',p),post=(p,b)=>api('POST',p,b),put=(p,b)=>api('PUT',p,b),del=p=>api('DELETE',p);
function toast(m,type='info'){const c=$('toastContainer')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'toastContainer'}));const i=document.createElement('div');i.className=`toast toast-${type}`;i.textContent=m;c.appendChild(i);setTimeout(()=>i.remove(),4500)}
function switchView(v){const l=$('viewLanding'),d=$('viewDashboard');if(v==='dashboard'&&!auth.accessToken)return $('modalAuth')?.classList.remove('hidden');l?.classList.toggle('hidden',v==='dashboard');d?.classList.toggle('hidden',v!=='dashboard');state.activeView=v;if(v==='dashboard'){startPolling();loadDashboard()}iconRefresh()}function startPolling(){if(!state.polling)state.polling=setInterval(()=>loadServers().catch(()=>{}),15000)}function stopPolling(){if(state.polling)clearInterval(state.polling);state.polling=null}
async function loadDashboard(){await Promise.allSettled([loadServers(),loadBlueprints()]);updateUser()}async function loadServers(){state.servers=await get('/api/v1/servers');renderServers(state.servers);updateStats();if(state.selectedServer)selectServer(state.selectedServer.id,false)}async function loadBlueprints(){state.blueprints=await get('/api/v1/blueprints');updateStats();if(state.activeTab==='blueprints')renderBlueprints()}function updateUser(){const e=auth.user?.email||'—',r=auth.user?.role==='VIEWER'?'Read-Only Viewer':'Control Plane Owner';['currentUserEmail','userProfileEmail'].forEach(id=>{if($(id))$(id).textContent=e});['currentUserRole','userProfileRole'].forEach(id=>{if($(id))$(id).textContent=r});if($('dashUserAvatar'))$('dashUserAvatar').textContent=e[0]?.toUpperCase()||'U';$('demoBadgeWrap')?.classList.toggle('hidden',auth.user?.role!=='VIEWER')}function updateStats(){const v={valTotalNodes:state.servers.length,valAgents:state.servers.filter(s=>s.status==='ONLINE').length,valBlueprints:state.blueprints.length,badgeNodesCount:state.servers.length,badgeNodesCountInner:state.servers.length,badgeBlueprintsCount:state.blueprints.length};Object.entries(v).forEach(([id,x])=>{if($(id))$(id).textContent=x})}
function renderServers(ss){const l=$('nodesCardList');if(!l)return;if(!ss.length){l.innerHTML='<div class="detail-empty"><strong>No nodes yet</strong><span>Register a VPS node to start receiving telemetry.</span></div>';return}l.innerHTML=ss.map(s=>`<button class="vps-btn${state.selectedServer?.id===s.id?' active':''}" data-server-id="${esc(s.id)}"><span class="vps-btn-dot vps-btn-dot-${s.status==='ONLINE'?'online':s.status==='OFFLINE'?'offline':'pending'}"></span><span class="vps-btn-info"><span class="vps-btn-name">${esc(s.name)}</span><span class="vps-btn-provider">${esc(s.provider)}</span><span class="vps-btn-ip">${esc(s.ipAddress)}</span></span><span class="vps-btn-delete" data-delete-id="${esc(s.id)}" aria-label="Remove ${esc(s.name)}">×</span></button>`).join('');l.querySelectorAll('[data-server-id]').forEach(b=>b.addEventListener('click',e=>{if(e.target.dataset.deleteId)return;selectServer(b.dataset.serverId)}));l.querySelectorAll('[data-delete-id]').forEach(b=>b.addEventListener('click',async e=>{e.stopPropagation();const s=state.servers.find(x=>x.id===b.dataset.deleteId);if(s&&confirm(`Remove server "${s.name}"?`)){await del(`/api/v1/servers/${s.id}`);state.selectedServer=null;await loadServers();toast('Server removed','success')}}));iconRefresh()}
async function selectServer(id){const s=state.servers.find(x=>x.id===id);if(!s)return;state.selectedServer=s;$('boxReinstallAgentCmd')?.classList.add('hidden');if($('drawerNodeName'))$('drawerNodeName').textContent=s.name;if($('drawerNodeMeta'))$('drawerNodeMeta').textContent=`${s.provider} • ${s.ipAddress} • ${s.os}`;$('detailEmptyState')?.classList.add('hidden');$('nodeDetailDrawer')?.classList.remove('hidden');renderServers(state.servers);try{const m=(await get(`/api/v1/servers/${id}/metrics?limit=1`)).at(-1);[['Cpu','cpu'],['Ram','memory'],['Disk','disk']].forEach(([n,k])=>{const x=m?.[k]??0;if($(`gauge${n}Val`))$(`gauge${n}Val`).textContent=m?`${Number(x).toFixed(1)}%`:'Awaiting data';if($(`gauge${n}Fill`))$(`gauge${n}Fill`).style.width=`${Math.max(0,Math.min(100,Number(x)))}%`})}catch{resetGauges()}}function resetGauges(){['Cpu','Ram','Disk'].forEach(k=>{if($(`gauge${k}Val`))$(`gauge${k}Val`).textContent='Awaiting data';if($(`gauge${k}Fill`))$(`gauge${k}Fill`).style.width='0%'})}
function switchTab(t){state.activeTab=t;const s={nodes:'sectionNodes',tasks:'sectionTasks',blueprints:'sectionBlueprints',diagnostics:'sectionDiagnostics',settings:'sectionSettings'};Object.entries(s).forEach(([n,id])=>$(id)?.classList.toggle('hidden',n!==t));const titles={nodes:['VPS Server Nodes','Manage, monitor, and configure your Linux cloud instances.'],tasks:['Tasks & Actions','Execute allow-listed maintenance actions via the outbound agent.'],blueprints:['Blueprints & Migration','Declarative environment specifications and restoration.'],diagnostics:['Logs & AI Diagnostics','Inspect telemetry and sanitize operational logs.'],settings:['Settings & Configuration','Manage safe runtime configuration without SSH.']};if($('pageTitleText'))$('pageTitleText').textContent=titles[t][0];if($('pageSubtext'))$('pageSubtext').textContent=titles[t][1];$('btnAddNode')?.classList.toggle('hidden',t!=='nodes');$('btnScanBlueprint')?.classList.toggle('hidden',t!=='blueprints');$('btnRunAiDiagnostics')?.classList.toggle('hidden',t!=='diagnostics');if(t==='tasks')loadTasks();if(t==='blueprints')renderBlueprints();if(t==='diagnostics')loadLogs();if(t==='settings')loadSettings();iconRefresh()}
async function loadTasks(){state.tasks=await get('/api/v1/tasks');const b=$('tasksTableBody');if(!b)return;b.innerHTML=state.tasks.length?state.tasks.slice(0,100).map(t=>`<tr><td><code>${esc(t.id.slice(0,8))}…</code></td><td>${esc(t.type)}</td><td>${esc(t.server?.name||t.serverId)}</td><td><span class="status-chip ${esc(t.status.toLowerCase())}">${esc(t.status)}</span></td><td>${esc(new Date(t.createdAt).toLocaleString())}</td></tr>`).join(''):'<tr><td colspan="5"><div class="empty-state">No tasks dispatched yet.</div></td></tr>'}
function renderBlueprints(){const c=$('blueprintsContainer');if(!c)return;c.innerHTML=state.blueprints.length?state.blueprints.map(b=>{const v=b.versions?.[0];return`<div class="bp-simple-card"><div><div class="bp-simple-title">${esc(b.name)}</div><div class="bp-simple-desc">Version ${v?.version||1} • ${esc(b.server?.name||'Unknown source')}</div></div><button class="btn btn-primary" data-restore-id="${esc(v?.id||'')}" data-restore-name="${esc(b.name)}">Restore</button></div>`}).join(''):'<div class="empty-state"><strong>No blueprints yet</strong><span>Capture one from a connected node.</span></div>';c.querySelectorAll('[data-restore-id]').forEach(b=>b.addEventListener('click',()=>openRestore(b.dataset.restoreId,b.dataset.restoreName)));iconRefresh()}
function openRestore(v,n){$('restoreWizardBox')?.classList.remove('hidden');if($('lblRestoreBpName'))$('lblRestoreBpName').textContent=n;const s=$('selectTargetVps');if(s){const online=state.servers.filter(x=>x.status==='ONLINE');s.innerHTML=online.length?online.map(x=>`<option value="${esc(x.id)}" data-version-id="${esc(v)}">${esc(x.name)} (${esc(x.ipAddress)})</option>`).join(''):'<option disabled>No ONLINE servers</option>'}}
async function dispatchTask(type,payload={}){if(!state.selectedServer)return toast('Select a server first','error');try{const t=await post('/api/v1/tasks',{serverId:state.selectedServer.id,type,payload});if($('taskPipelineStatus'))$('taskPipelineStatus').textContent='QUEUED';if($('taskConsoleOutput'))$('taskConsoleOutput').textContent=`Task ${t.id} queued. Waiting for agent…`;toast(`${type} queued`,'success')}catch(e){toast(e.message,'error')}}
async function captureBlueprint(){if(!state.selectedServer)return toast('Select a server first','error');const n=`${state.selectedServer.name}-blueprint-${Date.now()}`,m={version:'1.1',blueprint:{name:n,os:state.selectedServer.os,architecture:state.selectedServer.architecture,captured_from:state.selectedServer.name,captured_at:new Date().toISOString()},system:{packages:[],services:[]},containers:{services:[],active_containers:[]},ports:[]};try{await post('/api/v1/blueprints',{serverId:state.selectedServer.id,name:n,manifest:m});await loadBlueprints();switchTab('blueprints');toast('Blueprint captured','success')}catch(e){toast(e.message,'error')}}
async function executeRestore(){const s=$('selectTargetVps'),o=s?.options[s.selectedIndex];if(!s?.value||!o?.dataset.versionId)return toast('Select an online target','error');try{const r=await post('/api/v1/blueprints/restore',{blueprintVersionId:o.dataset.versionId,targetServerId:s.value});if($('restoreTerminalOutput'))$('restoreTerminalOutput').textContent=`Task ${r.taskId} queued.\n${r.warnings?.join('\n')||'No compatibility warnings.'}`;$('restoreProgressBox')?.classList.remove('hidden')}catch(e){toast(e.message,'error')}}
async function loadLogs(){const o=$('diagConsoleOutput');if(!o)return;o.textContent='';for(const s of state.servers.slice(0,5)){try{const logs=await get(`/api/v1/servers/${s.id}/logs?limit=10`);o.textContent+=`\n[${s.name}]\n${logs.map(l=>JSON.stringify(l.payload)).join('\n')||'(no telemetry)'}\n`}catch{o.textContent+=`\n[${s.name}] unavailable\n`}}}
async function runDiagnostics(){try{const r=await post('/api/v1/diagnostics/ai',{rawLogs:$('diagConsoleOutput')?.textContent||''});if($('aiDiagOutput'))$('aiDiagOutput').textContent=`${r.diagnosticResults.join('\n')}\n\n${r.sanitizedLogs}`}catch(e){toast(e.message,'error')}}async function createBackup(){try{const r=await fetch(`${API_BASE}/api/v1/backups/export`,{headers:auth.accessToken?{Authorization:`Bearer ${auth.accessToken}`}:{}});if(!r.ok)throw Error(`Backup failed: HTTP ${r.status}`);const b=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`pocketcloud-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();toast('Backup exported','success')}catch(e){toast(e.message,'error')}}
async function loadSettings(){let c=$('configurationPanel');if(!c){c=document.createElement('div');c.id='configurationPanel';c.className='panel';$('sectionSettings')?.prepend(c)}c.innerHTML='<div class="panel-head"><strong class="panel-title">Configuration</strong><span class="panel-head-spacer"></span><span>Runtime values only</span></div><div id="settingsGrid" class="settings-grid" style="padding:14px"></div>';try{const rows=await get('/api/v1/settings'),g=$('settingsGrid');g.innerHTML=rows.map(s=>`<form class="panel setting-card" data-setting-key="${esc(s.key)}" style="padding:14px;margin:0"><strong>${esc(s.key)}</strong><small style="display:block;color:var(--muted);margin:5px 0 10px">${esc(s.description)}</small><input class="form-input" name="value" value="${esc(s.value)}" ${s.isSecret?'placeholder="••••••••"':''} aria-label="${esc(s.key)}"><button class="btn btn-amber btn-sm" style="margin-top:10px">Save</button><small class="setting-status" style="display:block;margin-top:6px;color:var(--muted)">${s.isSecret?'Secret masked':''} • Updated ${esc(new Date(s.updatedAt).toLocaleString())}</small></form>`).join('');g.querySelectorAll('form').forEach(f=>f.addEventListener('submit',async e=>{e.preventDefault();const input=f.querySelector('input');try{const r=await put(`/api/v1/settings/${encodeURIComponent(f.dataset.settingKey)}`,{value:input.value});input.value=r.value;f.querySelector('.setting-status').textContent='Saved successfully';toast('Configuration saved','success')}catch(x){f.querySelector('.setting-status').textContent=x.message;toast(x.message,'error')}}))}catch(e){c.innerHTML+=`<div class="empty-state">Unable to load configuration: ${esc(e.message)}</div>`}}
async function submitAuth(e){e.preventDefault();try{const r=await post($('authModalTitle')?.textContent==='Create Account'?'/api/v1/auth/register':'/api/v1/auth/login',{email:$('inputAuthEmail')?.value.trim(),password:$('inputAuthPassword')?.value});auth.accessToken=r.accessToken;auth.user=r.user;$('modalAuth')?.classList.add('hidden');switchView('dashboard')}catch(x){if($('authErrorMsg'))$('authErrorMsg').textContent=x.message}}async function demoLogin(){try{const r=await post('/api/v1/auth/demo',{});auth.accessToken=r.accessToken;auth.user=r.user;$('modalAuth')?.classList.add('hidden');switchView('dashboard')}catch(e){toast(e.message,'error')}}function logout(){stopPolling();auth.accessToken=null;auth.user=null;post('/api/v1/auth/logout',{}).catch(()=>{});switchView('landing')}
async function checkSession() {
  try {
    const r = await post('/api/v1/auth/refresh', {});
    auth.accessToken = r.accessToken;
    auth.user = r.user;
    switchView('dashboard');
  } catch (e) {
    // Session is invalid or expired
  }
}
function bindEvents(){
  ['btnLandingLogin','btnLandingGetStarted','btnHeroDeploy','btnHeroGetStarted','btnStartBuilding'].forEach(id=>$(id)?.addEventListener('click',()=>auth.accessToken?switchView('dashboard'):$('modalAuth')?.classList.remove('hidden')));
  ['btnHeroDemo','btnDemoLogin'].forEach(id=>$(id)?.addEventListener('click',demoLogin));
  ['btnLogout','navItemLogout','settingsLogoutBtn'].forEach(id=>$(id)?.addEventListener('click',logout));
  $('btnCloseAuthModal')?.addEventListener('click',()=>$('modalAuth')?.classList.add('hidden'));
  $('formAuth')?.addEventListener('submit',submitAuth);
  $('btnSwitchAuthMode')?.addEventListener('click',()=>{if($('authModalTitle'))$('authModalTitle').textContent=$('authModalTitle').textContent==='Sign In'?'Create Account':'Sign In'});
  ['nodes','tasks','blueprints','diagnostics','settings'].forEach(t=>$(`navItem${t[0].toUpperCase()}${t.slice(1)}`)?.addEventListener('click',()=>switchTab(t)));
  $('btnAddNode')?.addEventListener('click',()=>$('modalAddServer')?.classList.remove('hidden'));
  $('btnCloseNodeModal')?.addEventListener('click',()=>$('modalAddServer')?.classList.add('hidden'));
  $('btnCloseNodeModal2')?.addEventListener('click',()=>$('modalAddServer')?.classList.add('hidden'));
  $('btnScanBlueprint')?.addEventListener('click',captureBlueprint);
  $('btnExecuteRestore')?.addEventListener('click',executeRestore);
  $('btnRunAiDiagnostics')?.addEventListener('click',runDiagnostics);
  $('btnCreateBackup')?.addEventListener('click',createBackup);
  document.querySelectorAll('.btn-drawer-action').forEach(b=>b.addEventListener('click',()=>b.dataset.task==='capture_blueprint'?captureBlueprint():dispatchTask(b.dataset.task==='restart_services'?'restart_service':b.dataset.task==='manage_ssh_keys'?'collect_logs':b.dataset.task)));
  document.querySelectorAll('.btn-quick-dispatch').forEach(b=>b.addEventListener('click',()=>dispatchTask(b.dataset.action==='restart_services'?'restart_service':b.dataset.action)));
  
  $('formAddServer')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('formAddServer').querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const res = await post('/api/v1/servers', {
        name: $('inputNodeName').value.trim(),
        provider: $('inputNodeProvider').value.trim(),
        ipAddress: $('inputNodeIP').value.trim(),
        os: $('inputNodeOS').value.trim()
      });
      $('formAddServer').classList.add('hidden');
      if ($('txtAgentInstallCmd')) $('txtAgentInstallCmd').textContent = res.installCommand;
      $('boxAgentInstallCmd')?.classList.remove('hidden');
      toast('Server node registered!', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('btnFinishNodeAdd')?.addEventListener('click', () => {
    $('modalAddServer')?.classList.add('hidden');
    $('formAddServer')?.reset();
    $('formAddServer')?.classList.remove('hidden');
    $('boxAgentInstallCmd')?.classList.add('hidden');
    loadServers();
  });

  $('btnCopyInstallSection')?.addEventListener('click', () => {
    const text = $('txtAgentInstallSectionCmd')?.textContent;
    if (text) {
      navigator.clipboard.writeText(text);
      toast('Copied agent installation command!', 'success');
    }
  });

  $('btnCopyControlPlaneInstall')?.addEventListener('click', () => {
    const text = $('txtControlPlaneInstallCmd')?.textContent;
    if (text) {
      navigator.clipboard.writeText(text);
      toast('Copied deploy command!', 'success');
    }
  });

  $('btnGenerateAgentInstall')?.addEventListener('click', async () => {
    if (!state.selectedServer) return toast('No server selected', 'error');
    try {
      const res = await post(`/api/v1/servers/${state.selectedServer.id}/bootstrap-token`, {});
      if ($('txtReinstallAgentCmd')) $('txtReinstallAgentCmd').textContent = res.installCommand;
      $('boxReinstallAgentCmd')?.classList.remove('hidden');
      toast('Reinstallation command generated!', 'success');
      iconRefresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('btnCopyReinstallAgentCmd')?.addEventListener('click', () => {
    const text = $('txtReinstallAgentCmd')?.textContent;
    if (text) {
      navigator.clipboard.writeText(text);
      toast('Copied reinstallation command!', 'success');
    }
  });
}
document.addEventListener('DOMContentLoaded',()=>{
  bindEvents();
  iconRefresh();
  checkSession();
});