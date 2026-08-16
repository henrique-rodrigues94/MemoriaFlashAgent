import http from 'http';
import { runDatabaseAudit } from '../contentAgent/admin/databaseAudit';

const PORT = Number(process.env.ADMIN_DASHBOARD_PORT || 8787);
const HOST = process.env.ADMIN_DASHBOARD_HOST || '127.0.0.1';
const TOKEN = process.env.ADMIN_DASHBOARD_TOKEN || '';

function authorized(req: http.IncomingMessage): boolean {
  if (!TOKEN) return process.env.NODE_ENV !== 'production';
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') && header.slice(7) === TOKEN;
}

function send(res: http.ServerResponse, status: number, body: string, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

export function startAdminDashboardServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (!authorized(req)) return send(res, 401, JSON.stringify({ error: 'Não autorizado.' }));
    const url = new URL(req.url || '/', 'http://' + HOST + ':' + PORT);
    if (url.pathname === '/health') return send(res, 200, JSON.stringify({ ok: true, service: 'memoriaflash-admin-dashboard', at: new Date().toISOString() }));
    if (url.pathname === '/api/audit' && req.method === 'GET') {
      try { return send(res, 200, JSON.stringify(await runDatabaseAudit())); }
      catch (err: any) { return send(res, 500, JSON.stringify({ error: err?.message || String(err) })); }
    }
    if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, ADMIN_HTML, 'text/html; charset=utf-8');
    return send(res, 404, JSON.stringify({ error: 'Rota não encontrada.' }));
  });
  server.listen(PORT, HOST, () => console.log('[AdminDashboard] http://' + HOST + ':' + PORT + ' — ' + (TOKEN ? 'token protegido' : 'modo local sem token')));
  return server;
}

const ADMIN_HTML = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MemoriaFlash — Admin Agent</title><style>' +
':root{font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#e5e7eb;background:#07111f}*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#07111f,#0b1728 55%,#101b2f);min-height:100vh}.wrap{max-width:1500px;margin:auto;padding:24px}.top{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:22px}.brand h1{margin:0;font-size:24px}.brand p{margin:5px 0 0;color:#94a3b8;font-size:13px}.actions{display:flex;gap:8px;flex-wrap:wrap}button,input{border:1px solid #26364d;background:#0d1b2d;color:#e5e7eb;border-radius:10px;padding:10px 12px}button{cursor:pointer;font-weight:800}button.primary{background:#2563eb;border-color:#3b82f6}.token{width:280px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{background:rgba(13,27,45,.82);border:1px solid #20324a;border-radius:16px;padding:16px;box-shadow:0 12px 40px #0003}.metric{font-size:26px;font-weight:900}.label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8fa3ba}.sub{font-size:12px;color:#94a3b8;margin-top:5px}.section{margin-top:18px}.section h2{font-size:16px;margin:0 0 10px}.bar{height:9px;background:#17253a;border-radius:999px;overflow:hidden}.fill{height:100%;background:#3b82f6}.tablewrap{overflow:auto}.tree{width:100%;border-collapse:collapse;font-size:12px}.tree th,.tree td{padding:9px;border-bottom:1px solid #1c2b40;text-align:left;vertical-align:top}.tree th{color:#93a4b8}.ok{color:#4ade80}.warn{color:#fbbf24}.bad{color:#fb7185}.pill{display:inline-block;border:1px solid #2a3d58;border-radius:999px;padding:3px 7px;margin:2px;color:#cbd5e1}.two{display:grid;grid-template-columns:1.2fr .8fr;gap:12px}.feedback{max-height:430px;overflow:auto}.fb{padding:10px 0;border-bottom:1px solid #1c2b40}.muted{color:#94a3b8}.small{font-size:11px}.err{color:#fb7185;padding:12px}@media(max-width:1000px){.grid{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}}@media(max-width:600px){.wrap{padding:14px}.grid{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}.token{width:100%}}' +
'</style></head><body><div class="wrap"><div class="top"><div class="brand"><h1>🧠 MemoriaFlash Admin Agent</h1><p>Auditoria do Firestore • conteúdo • feedback • operação</p></div><div class="actions"><input id="token" class="token" type="password" placeholder="ADMIN_DASHBOARD_TOKEN"><button class="primary" id="scanBtn">🔎 Fazer varredura completa</button></div></div><div id="app"><div class="card">Informe o token administrativo e faça a primeira varredura.</div></div></div><script>' +
'const app=document.getElementById("app"), tokenInput=document.getElementById("token"), scanBtn=document.getElementById("scanBtn");' +
'const fmt=n=>new Intl.NumberFormat("pt-BR").format(n||0);' +
'const pct=n=>n==null?"—":Number(n).toFixed(1)+"%";' +
'const esc=v=>String(v==null?"":v).replace(/[&<>"\x27]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\x22":"&quot;","\x27":"&#39;"}[m]));' +
'function auth(){const t=tokenInput.value.trim();if(t)sessionStorage.setItem("mf_admin_token",t);return t||sessionStorage.getItem("mf_admin_token")||"";}' +
'function renderGaps(subjects){let out="";subjects.forEach(s=>{let gaps=[];(s.levels||[]).forEach(l=>{if((l.missingTopics||[]).length)gaps.push("<b>"+esc(l.level)+":</b> "+l.missingTopics.slice(0,25).map(esc).join(", "));(l.topics||[]).forEach(t=>{if((t.missingSubtopics||[]).length)gaps.push("<b>"+esc(l.level)+" / "+esc(t.topic)+":</b> "+t.missingSubtopics.slice(0,20).map(esc).join(", "));});});if(gaps.length)out+="<div class=\"fb\"><b>"+esc(s.subject)+"</b><div class=\"small\">"+gaps.join("<br>")+"</div></div>";});return out||"<span class=\"ok\">Nenhuma lacuna detectável nos currículos armazenados.</span>";}' +
'function render(d){const s=d.storage||{},c=d.content||{},f=d.feedback||{},r=d.requests||{},db=d.database||{};const subjects=c.subjects||[];app.innerHTML="<div class=\"grid\">"+'<div class="card"><div class="label">Matérias</div><div class="metric">'+fmt(c.subjectCount)+'</div><div class="sub">encontradas no banco</div></div>'+'<div class="card"><div class="label">Cards</div><div class="metric">'+fmt(c.totalCards)+'</div><div class="sub">em '+fmt(c.cardBuckets)+' buckets</div></div>'+'<div class="card"><div class="label">Feedback pendente</div><div class="metric '+(f.pending?'warn':'ok')+'">'+fmt(f.pending)+'</div><div class="sub">de '+fmt(f.total)+' registros</div></div>'+'<div class="card"><div class="label">Firestore estimado</div><div class="metric">'+esc(s.usedPercent)+'%</div><div class="sub">'+esc(s.estimatedLogicalMb)+' MB / '+esc(s.freeReferenceGb)+' GB referência</div><div class="bar"><div class="fill" style="width:'+Math.min(100,Number(s.usedPercent)||0)+'%"></div></div></div>'+'</div>'+'<div class="section two"><div class="card"><h2>📚 Cobertura por matéria</h2><div class="tablewrap"><table class="tree"><thead><tr><th>Matéria</th><th>Níveis</th><th>Tópicos</th><th>Cards</th><th>Cobertura</th></tr></thead><tbody>'+subjects.map(x=>'<tr><td><b>'+esc(x.subject)+'</b></td><td>'+((x.levels||[]).filter(l=>l.curriculumFound).map(l=>'<span class="pill">'+esc(l.level)+'</span>').join('')||'<span class="muted">não encontrado</span>')+'</td><td>'+fmt(x.totalCoveredTopics)+' / '+fmt(x.totalExpectedTopics)+'</td><td>'+fmt(x.totalCards)+'</td><td><b class="'+((x.coveragePercent||0)>=80?'ok':(x.coveragePercent||0)>=50?'warn':'bad')+'">'+pct(x.coveragePercent)+'</b></td></tr>').join('')+'</tbody></table></div></div>'+'<div class="card"><h2>📊 Operação</h2><p><b>Solicitações:</b> '+fmt(r.total)+'</p><p>Fila: <span class="warn">'+fmt(r.pending)+'</span> • Processando: '+fmt(r.processing)+'</p><p>Concluídas: <span class="ok">'+fmt(r.completed)+'</span> • Falhas: <span class="bad">'+fmt(r.failed)+'</span></p><h2>🗄️ Coleções</h2><div class="small">'+(db.collections||[]).map(x=>'<div>'+esc(x.name)+' — '+fmt(x.documents)+' docs — '+(Number(x.estimatedBytes||0)/1024/1024).toFixed(2)+' MB</div>').join('')+'</div></div></div>'+'<div class="section two"><div class="card"><h2>🔍 Lacunas detectadas</h2>'+renderGaps(subjects)+'</div><div class="card"><h2>⚠️ Feedback por motivo</h2><div class="small">'+Object.entries(f.byReason||{}).sort((a,b)=>b[1]-a[1]).map(x=>'<div class="fb"><b>'+esc(x[0])+'</b> <span class="muted">— '+fmt(x[1])+'</span></div>').join('')+'</div></div></div>'+'<div class="section card"><h2>📝 Feedback recente</h2><div class="feedback">'+(f.recent||[]).map(x=>'<div class="fb"><b>'+esc(x.subject||'Matéria desconhecida')+'</b> · '+esc(x.topic||'')+' · <span class="pill">'+esc(x.reason||'sem motivo')+'</span><div>'+esc(x.comment||'Sem comentário')+'</div><div class="muted small">'+esc(x.createdAt||'')+' · status: '+esc(x.status||'')+'</div></div>').join('')||'<span class="muted">Nenhum registro.</span>'+'</div></div>'+'<div class="section card"><div class="muted small">Última varredura: '+esc(d.generatedAt)+'<br>'+esc(s.note||'')+'</div></div>';}' +
'async function scan(){app.innerHTML="<div class=\"card\">🔄 Lendo o Firestore...</div>";try{const r=await fetch("/api/audit",{headers:{Authorization:"Bearer "+auth()}}),d=await r.json();if(!r.ok)throw new Error(d.error||"Falha na auditoria");render(d);}catch(e){app.innerHTML="<div class=\"card err\">"+esc(e.message)+"</div>";}}' +
'scanBtn.addEventListener("click",scan);tokenInput.value=sessionStorage.getItem("mf_admin_token")||"";' +
'</script></body></html>';

if (require.main === module) startAdminDashboardServer();
