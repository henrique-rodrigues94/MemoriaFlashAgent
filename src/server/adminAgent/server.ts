import http from 'http';
import { runDatabaseAudit } from '../contentAgent/admin/databaseAudit';
import { stageImport, loadStagedPackage, publishStagedImport, cancelStagedImport } from '../contentAgent/importer/completoMflash';

const PORT = Number(process.env.ADMIN_DASHBOARD_PORT || 8787);
const HOST = process.env.ADMIN_DASHBOARD_HOST || '127.0.0.1';
const TOKEN = process.env.ADMIN_DASHBOARD_TOKEN || '';
const MAX_BODY_BYTES = Number(process.env.CONTENT_IMPORT_MAX_BYTES || 50 * 1024 * 1024) + 1024 * 1024;

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

export function startAdminDashboardServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (!authorized(req)) return send(res, 401, { error: 'Não autorizado.' });
    const url = new URL(req.url || '/', 'http://' + HOST + ':' + PORT);
    try {
      if (url.pathname === '/health') return send(res, 200, { ok: true, service: 'memoriaflash-admin-dashboard', at: new Date().toISOString() });
      if (url.pathname === '/api/audit' && req.method === 'GET') return send(res, 200, await runDatabaseAudit());
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
      const status = /limite|excede|inválido|bloqueada|não encontrada|cancelar/i.test(String(err?.message)) ? 422 : 500;
      return send(res, status, { error: err?.message || String(err) });
    }
  });
  server.listen(PORT, HOST, () => console.log('[AdminDashboard] http://' + HOST + ':' + PORT));
  return server;
}

const ADMIN_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MemoriaFlash Admin</title><style>body{font:14px system-ui;background:#0b1220;color:#eef2ff;margin:0;padding:24px}main{max-width:1100px;margin:auto}.card{background:#121b2d;border:1px solid #263452;border-radius:12px;padding:16px;margin:12px 0}.muted{color:#9aa8c2}.ok{color:#52d273}.bad{color:#ff6b7a}button,input{padding:10px;border-radius:8px;border:1px solid #344361;background:#18243a;color:#fff}button{cursor:pointer;background:#2563eb;border:0}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}pre{white-space:pre-wrap;max-height:420px;overflow:auto}</style></head><body><main><h1>📦 MemoriaFlash Agent</h1><p class="muted">Alimentador oficial completo.mflash — validação, staging, simulação e publicação sem IA.</p><div class="card"><h2>Importar completo.mflash</h2><div class="row"><input id="file" type="file" accept=".mflash,.json,application/json"><input id="token" type="password" placeholder="ADMIN_DASHBOARD_TOKEN"><button id="validate">Validar e colocar em staging</button></div><p id="msg" class="muted"></p></div><div id="result"></div><div class="card"><h2>Auditoria do banco</h2><button id="audit">Atualizar auditoria</button><pre id="auditOut" class="muted"></pre></div></main><script>const $=id=>document.getElementById(id);let jobId='';function headers(){const t=$('token').value.trim()||sessionStorage.getItem('mf_admin_token')||'';if(t)sessionStorage.setItem('mf_admin_token',t);return t?{Authorization:'Bearer '+t}:{};}function esc(v){return String(v??'').replace(/[&<>\"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[x]));}async function api(url,opt={}){opt.headers={...headers(),...(opt.headers||{})};const r=await fetch(url,opt);const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Falha HTTP '+r.status);return d;}$('validate').onclick=async()=>{try{const f=$('file').files[0];if(!f)throw Error('Selecione o arquivo completo.mflash.');$('msg').textContent='Validando e criando staging...';const d=await api('/api/import/stage',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:await f.text()});jobId=d.jobId;$('msg').innerHTML='<span class="ok">Staging criado: '+esc(jobId)+'</span>';$('result').innerHTML='<div class="card"><h2>Dry-run</h2><pre>'+esc(JSON.stringify({manifest:d.plan.manifest,stats:d.plan.stats,storage:d.storage,issues:d.plan.issues},null,2))+'</pre><div class="row"><button id="publish">Aprovar e publicar</button><button id="cancel">Cancelar</button></div></div>';$('publish').onclick=async()=>{try{$('msg').textContent='Publicando em lotes...';const p=await api('/api/import/'+encodeURIComponent(jobId)+'/publish',{method:'POST'});$('msg').innerHTML='<span class="ok">Importação concluída.</span>';$('result').innerHTML+='<div class="card"><pre>'+esc(JSON.stringify(p.stats,null,2))+'</pre></div>';}catch(e){$('msg').innerHTML='<span class="bad">'+esc(e.message)+'</span>';}};$('cancel').onclick=async()=>{await api('/api/import/'+encodeURIComponent(jobId)+'/cancel',{method:'POST'});$('msg').textContent='Importação cancelada.';};}catch(e){$('msg').innerHTML='<span class="bad">'+esc(e.message)+'</span>';}};$('audit').onclick=async()=>{try{$('auditOut').textContent='Consultando...';$('auditOut').textContent=JSON.stringify(await api('/api/audit'),null,2);}catch(e){$('auditOut').textContent=e.message;}};</script></body></html>`;

if (require.main === module) startAdminDashboardServer();
