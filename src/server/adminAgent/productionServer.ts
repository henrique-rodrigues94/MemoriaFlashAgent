import http from 'http';
import { runDatabaseAudit } from '../contentAgent/admin/databaseAudit';
import { stageImport, loadStagedPackage, cancelStagedImport } from '../contentAgent/importer/completoMflash';
import { publishStagedImportProduction, rollbackImportJob } from '../contentAgent/importer/productionImporter';

const PORT = Number(process.env.ADMIN_DASHBOARD_PORT || 8787);
const HOST = process.env.ADMIN_DASHBOARD_HOST || '127.0.0.1';
const TOKEN = process.env.ADMIN_DASHBOARD_TOKEN || '';
const MAX_BODY_BYTES = Number(process.env.CONTENT_IMPORT_MAX_BYTES || 50 * 1024 * 1024) + 1024 * 1024;

function authorized(req: http.IncomingMessage): boolean {
  if (!TOKEN) return process.env.NODE_ENV !== 'production';
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') && h.slice(7) === TOKEN;
}
function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []; let total = 0;
  for await (const chunk of req) { const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += b.length; if (total > MAX_BODY_BYTES) throw new Error('Arquivo excede o limite configurado.'); chunks.push(b); }
  return Buffer.concat(chunks).toString('utf8');
}

export function startProductionAdminDashboard(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (!authorized(req)) return send(res, 401, { error: 'Não autorizado.' });
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    try {
      if (url.pathname === '/health') return send(res, 200, { ok: true, service: 'memoriaflash-admin-production', at: new Date().toISOString() });
      if (url.pathname === '/api/audit' && req.method === 'GET') return send(res, 200, await runDatabaseAudit());
      if (url.pathname === '/api/import/stage' && req.method === 'POST') { const raw = await readBody(req); if (!raw.trim()) return send(res, 400, { error: 'Arquivo vazio.' }); return send(res, 201, await stageImport(raw)); }
      const m = url.pathname.match(/^\/api\/import\/([^/]+)(?:\/(publish|cancel|rollback))?$/);
      if (m) {
        const jobId = decodeURIComponent(m[1]); const action = m[2];
        if (req.method === 'GET' && !action) { const { job } = await loadStagedPackage(jobId); return send(res, 200, job); }
        if (req.method === 'POST' && action === 'publish') return send(res, 200, await publishStagedImportProduction(jobId));
        if (req.method === 'POST' && action === 'cancel') { await cancelStagedImport(jobId); return send(res, 200, { ok: true, jobId, status: 'cancelled' }); }
        if (req.method === 'POST' && action === 'rollback') { await rollbackImportJob(jobId); return send(res, 200, { ok: true, jobId, status: 'rolled_back' }); }
      }
      if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, HTML, 'text/html; charset=utf-8');
      return send(res, 404, { error: 'Rota não encontrada.' });
    } catch (err: any) {
      return send(res, 422, { error: err?.message || String(err) });
    }
  });
  server.listen(PORT, HOST, () => console.log(`[AdminDashboard] http://${HOST}:${PORT}`));
  return server;
}

const HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MemoriaFlash Admin</title><style>body{font:14px system-ui;background:#0b1220;color:#eef2ff;margin:0;padding:24px}main{max-width:1100px;margin:auto}.card{background:#121b2d;border:1px solid #263452;border-radius:12px;padding:16px;margin:12px 0}.muted{color:#9aa8c2}.ok{color:#52d273}.bad{color:#ff6b7a}button,input{padding:10px;border-radius:8px;border:1px solid #344361;background:#18243a;color:#fff}button{cursor:pointer;background:#2563eb;border:0}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}pre{white-space:pre-wrap;max-height:500px;overflow:auto}</style></head><body><main><h1>📦 MemoriaFlash Agent — Produção</h1><p class="muted">Alimentador completo.mflash: validação → staging → dry-run → publicação → pós-validação → rollback.</p><div class="card"><h2>1. Staging / Dry-run</h2><div class="row"><input id="file" type="file" accept=".mflash,.json"><input id="token" type="password" placeholder="ADMIN_DASHBOARD_TOKEN"><button id="stage">Validar e criar staging</button></div><p id="msg" class="muted"></p></div><div id="result"></div><div class="card"><h2>2. Auditoria</h2><button id="audit">Atualizar auditoria</button><pre id="auditOut" class="muted"></pre></div></main><script>const $=x=>document.getElementById(x);function hdr(){const t=$('token').value.trim()||sessionStorage.getItem('mf_admin_token')||'';if(t)sessionStorage.setItem('mf_admin_token',t);return t?{Authorization:'Bearer '+t}:{};}function esc(v){return String(v??'').replace(/[&<>\"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[x]));}async function api(u,o={}){o.headers={...hdr(),...(o.headers||{})};const r=await fetch(u,o);const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'HTTP '+r.status);return d;}$('stage').onclick=async()=>{try{const f=$('file').files[0];if(!f)throw Error('Selecione completo.mflash.');$('msg').textContent='Validando...';const d=await api('/api/import/stage',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:await f.text()});const id=d.jobId;$('msg').innerHTML='<span class="ok">Staging criado: '+esc(id)+'</span>';$('result').innerHTML='<div class="card"><h2>Dry-run</h2><pre>'+esc(JSON.stringify({manifest:d.plan.manifest,stats:d.plan.stats,storage:d.storage,issues:d.plan.issues},null,2))+'</pre><div class="row"><button id="pub">Aprovar e publicar</button><button id="cancel">Cancelar</button><button id="roll">Rollback</button></div></div>';$('pub').onclick=async()=>{try{$('msg').textContent='Publicando em lotes...';const p=await api('/api/import/'+encodeURIComponent(id)+'/publish',{method:'POST'});$('msg').innerHTML='<span class="ok">Publicado e pós-validado.</span>';$('result').innerHTML+='<div class="card"><pre>'+esc(JSON.stringify(p,null,2))+'</pre></div>';}catch(e){$('msg').innerHTML='<span class="bad">'+esc(e.message)+'</span>';}};$('cancel').onclick=async()=>{await api('/api/import/'+encodeURIComponent(id)+'/cancel',{method:'POST'});$('msg').textContent='Staging cancelado.';};$('roll').onclick=async()=>{if(!confirm('Rollback é uma operação administrativa. Continuar?'))return;try{await api('/api/import/'+encodeURIComponent(id)+'/rollback',{method:'POST'});$('msg').textContent='Rollback concluído.';}catch(e){$('msg').innerHTML='<span class="bad">'+esc(e.message)+'</span>';}};}catch(e){$('msg').innerHTML='<span class="bad">'+esc(e.message)+'</span>';}};$('audit').onclick=async()=>{try{$('auditOut').textContent=JSON.stringify(await api('/api/audit'),null,2);}catch(e){$('auditOut').textContent=e.message;}};</script></body></html>`;

if (require.main === module) startProductionAdminDashboard();
