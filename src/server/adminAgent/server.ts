import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { runDatabaseAudit } from '../contentAgent/admin/databaseAudit';
import { stageImport, loadStagedPackage, publishStagedImport, cancelStagedImport } from '../contentAgent/importer/completoMflash';
import { normalizeMflashForImport } from '../contentAgent/importer/normalizeMflashForImport';

const PORT = Number(process.env.ADMIN_DASHBOARD_PORT || 8787);
const HOST = process.env.ADMIN_DASHBOARD_HOST || '127.0.0.1';
const TOKEN = process.env.ADMIN_DASHBOARD_TOKEN || '';
const MAX_BODY_BYTES = Number(process.env.CONTENT_IMPORT_MAX_BYTES || 50 * 1024 * 1024) + 1024 * 1024;
const PACKAGE_DIR = path.resolve(process.env.CONTENT_PACKAGES_DIR || path.join(process.cwd(), 'content-packages'));

function authorized(req: http.IncomingMessage): boolean {
  if (!TOKEN) return process.env.NODE_ENV !== 'production';
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') && header.slice(7) === TOKEN;
}
function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
async function readBody(req: http.IncomingMessage): Promise<string> {
  let total = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += b.length; if (total > MAX_BODY_BYTES) throw new Error('Arquivo excede o limite configurado para importação.'); chunks.push(b); }
  return Buffer.concat(chunks).toString('utf8');
}
function safePackagePath(fileName: string): string {
  const clean = path.basename(String(fileName || ''));
  if (!clean || !clean.toLowerCase().endsWith('.mflash') || clean !== fileName || clean.includes('..')) throw new Error('Arquivo de pacote inválido.');
  return path.join(PACKAGE_DIR, clean);
}
function countCards(value: any): number {
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) return value.reduce((n, x) => n + countCards(x), 0);
  let n = Array.isArray(value.cards) ? value.cards.length : 0;
  for (const key of ['levels', 'subjects', 'curricula', 'topics', 'subtopics']) if (Array.isArray(value[key])) n += countCards(value[key]);
  return n;
}
async function listContentPackages() {
  await fs.mkdir(PACKAGE_DIR, { recursive: true });
  const entries = await fs.readdir(PACKAGE_DIR, { withFileTypes: true });
  const files = [];
  for (const entry of entries.filter(x => x.isFile() && x.name.toLowerCase().endsWith('.mflash')).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
    const full = path.join(PACKAGE_DIR, entry.name);
    const stat = await fs.stat(full);
    let manifest: any = null;
    let parseError = '';
    try { const parsed = JSON.parse(await fs.readFile(full, 'utf8')); manifest = normalizeMflashForImport(parsed).manifest; } catch (e: any) { parseError = e?.message || String(e); }
    files.push({
      file: entry.name,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      validJson: !parseError,
      error: parseError || undefined,
      package: manifest?.package || null,
      contentVersion: manifest?.contentVersion || null,
      language: manifest?.language || null,
      levels: manifest?.levels || [],
      cards: manifest?.statistics?.cards ?? null,
    });
  }
  return { directory: PACKAGE_DIR, count: files.length, files };
}

export function startAdminDashboardServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (!authorized(req)) return send(res, 401, { error: 'Não autorizado.' });
    const url = new URL(req.url || '/', 'http://' + HOST + ':' + PORT);
    try {
      if (url.pathname === '/health') return send(res, 200, { ok: true, service: 'memoriaflash-admin-dashboard', at: new Date().toISOString() });
      if (url.pathname === '/api/audit' && req.method === 'GET') return send(res, 200, await runDatabaseAudit());
      if (url.pathname === '/api/packages' && req.method === 'GET') return send(res, 200, await listContentPackages());
      if (url.pathname === '/api/import/stage-package' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const filePath = safePackagePath(body?.file);
        const raw = await fs.readFile(filePath, 'utf8');
        const result = await stageImport(JSON.stringify(normalizeMflashForImport(JSON.parse(raw))));
        return send(res, 201, { ...result, sourceFile: path.basename(filePath) });
      }
      if (url.pathname === '/api/import/stage' && req.method === 'POST') {
        const raw = await readBody(req); if (!raw.trim()) return send(res, 400, { error: 'Arquivo vazio.' });
        const result = await stageImport(raw); return send(res, 201, result);
      }
      const match = url.pathname.match(/^\/api\/import\/([^/]+)(?:\/(publish|cancel))?$/);
      if (match) {
        const jobId = decodeURIComponent(match[1]); const action = match[2];
        if (req.method === 'GET' && !action) { const { job } = await loadStagedPackage(jobId); return send(res, 200, job); }
        if (req.method === 'POST' && action === 'publish') return send(res, 200, await publishStagedImport(jobId));
        if (req.method === 'POST' && action === 'cancel') { await cancelStagedImport(jobId); return send(res, 200, { ok: true, jobId, status: 'cancelled' }); }
      }
      if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, ADMIN_HTML, 'text/html; charset=utf-8');
      return send(res, 404, { error: 'Rota não encontrada.' });
    } catch (err: any) {
      const status = /limite|excede|inválido|bloqueada|não encontrada|cancelar|arquivo/i.test(String(err?.message)) ? 422 : 500;
      return send(res, status, { error: err?.message || String(err) });
    }
  });
  server.listen(PORT, HOST, () => console.log('[AdminDashboard] http://' + HOST + ':' + PORT));
  return server;
}

const ADMIN_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MemoriaFlash Admin</title><style>body{font:14px system-ui;background:#0b1220;color:#eef2ff;margin:0;padding:24px}main{max-width:1100px;margin:auto}.card{background:#121b2d;border:1px solid #263452;border-radius:12px;padding:16px;margin:12px 0}.muted{color:#9aa8c2}.ok{color:#52d273}.bad{color:#ff6b7a}.pkg{border:1px solid #344361;border-radius:10px;padding:12px;margin:8px 0;background:#101a2c}.pkg.selected{border-color:#3b82f6;box-shadow:0 0 0 1px #3b82f6}.pkg button{margin-top:8px}button,input,select{padding:10px;border-radius:8px;border:1px solid #344361;background:#18243a;color:#fff}button{cursor:pointer;background:#2563eb;border:0}.secondary{background:#334155}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}pre{white-space:pre-wrap;max-height:420px;overflow:auto}.badge{display:inline-block;padding:3px 7px;border-radius:999px;background:#263452;margin:2px;font-size:12px}</style></head><body><main><h1>📦 MemoriaFlash Agent</h1><p class="muted">Escolha um pacote da pasta <b>content-packages</b>, faça o dry-run e só depois aprove a publicação.</p><div class="card"><h2>1. Pacotes disponíveis</h2><div class="row"><button id="refresh">🔄 Atualizar lista</button><span id="dir" class="muted"></span></div><div id="packages"><p class="muted">Carregando...</p></div><p id="selected" class="muted"></p></div><div class="card"><h2>2. Importação</h2><div class="row"><input id="token" type="password" placeholder="ADMIN_DASHBOARD_TOKEN"><button id="stage">Validar pacote selecionado e criar staging</button></div><p id="msg" class="muted"></p></div><div id="result"></div><div class="card"><h2>Auditoria do banco</h2><button id="audit">Atualizar auditoria</button><pre id="auditOut" class="muted"></pre></div></main><script>const $=id=>document.getElementById(id);let selectedFile='';function headers(){const t=$('token').value.trim()||sessionStorage.getItem('mf_admin_token')||'';if(t)sessionStorage.setItem('mf_admin_token',t);return t?{Authorization:'Bearer '+t}:{};}function esc(v){return String(v??'').replace(/[&<>\"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[x]));}async function api(url,opt={}){opt.headers={...headers(),...(opt.headers||{})};const r=await fetch(url,opt);const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Falha HTTP '+r.status);return d;}function selectPackage(file){selectedFile=file;$('selected').innerHTML='<b>Selecionado:</b> '+esc(file);document.querySelectorAll('.pkg').forEach(x=>x.classList.toggle('selected',x.dataset.file===file));}async function loadPackages(){try{$('packages').textContent='Lendo content-packages...';const d=await api('/api/packages');$('dir').textContent=d.directory;$('packages').innerHTML=d.files.length?d.files.map(p=>'<div class="pkg" data-file="'+esc(p.file)+'"><b>'+esc(p.file)+'</b><br><span class="badge">'+(p.validJson?'JSON OK':'INVÁLIDO')+'</span><span class="badge">'+esc(p.package||'formato desconhecido')+'</span><span class="badge">'+esc((p.levels||[]).join(', ')||'nível não identificado')+'</span><span class="badge">'+esc(p.cards??'cards não informados')+' cards</span><br><span class="muted">'+Math.round(p.sizeBytes/1024)+' KB · '+esc(p.contentVersion||'sem versão')+'</span>'+(p.error?'<pre class="bad">'+esc(p.error)+'</pre>':'')+'<br><button onclick="selectPackage(\''+String(p.file).replace(/'/g,"\\'")+'\')">Selecionar</button></div>').join(''):'<p class="muted">Nenhum arquivo .mflash encontrado.</p>';}catch(e){$('packages').innerHTML='<span class="bad">'+esc(e.message)+'</span>';}}$('refresh').onclick=loadPackages;$('stage').onclick=async()=>{try{if(!selectedFile)throw Error('Selecione um pacote da pasta content-packages.');$('msg').textContent='Normalizando, validando e criando staging...';const d=await api('/api/import/stage-package',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:selectedFile})});const id=d.jobId;$('msg').innerHTML='<span class="ok">Staging criado para '+esc(d.sourceFile)+' — Job: '+esc(id)+'</span>';$('result').innerHTML='<div class="card"><h2>Dry-run: '+esc(d.sourceFile)+'</h2><pre>'+esc(JSON.stringify({manifest:d.plan.manifest,stats:d.plan.stats,storage:d.storage,issues:d.plan.issues},null,2))+'</pre><div class="row"><button id="publish">Aprovar e publicar</button><button id="cancel" class="secondary">Cancelar</button></div></div>';$('publish').onclick=async()=>{try{$('msg').textContent='Publicando em lotes...';const p=await api('/api/import/'+encodeURIComponent(id)+'/publish',{method:'POST'});$('msg').innerHTML='<span class="ok">Importação concluída.</span>';$('result').innerHTML+='<div class="card"><pre>'+esc(JSON.stringify(p.stats,null,2))+'</pre></div>';}catch(e){$('msg').innerHTML='<span class="bad">'+esc(e.message)+'</span>';}};$('cancel').onclick=async()=>{await api('/api/import/'+encodeURIComponent(id)+'/cancel',{method:'POST'});$('msg').textContent='Importação cancelada.';};}catch(e){$('msg').innerHTML='<span class="bad">'+esc(e.message)+'</span>';}};$('audit').onclick=async()=>{try{$('auditOut').textContent='Consultando...';$('auditOut').textContent=JSON.stringify(await api('/api/audit'),null,2);}catch(e){$('auditOut').textContent=e.message;}};loadPackages();</script></body></html>`;

if (require.main === module) startAdminDashboardServer();
