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
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
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
  server.listen(PORT, HOST, () => console.log('[AdminDashboard] http://' + HOST + ':' + PORT));
  return server;
}

const ADMIN_HTML = Buffer.from('PCFkb2N0eXBlIGh0bWw+PGh0bWwgbGFuZz0icHQtQlIiPjxtZXRhIGNoYXJzZXQ9InV0Zi04Ij48bWV0YSBuYW1lPSJ2aWV3cG9ydCIgY29udGVudD0id2lkdGg9ZGV2aWNlLXdpZHRoIj48dGl0bGU+TWVtb3JpYUZsYXNoIEFkbWluPC90aXRsZT48c3R5bGU+Ym9keXtmb250OjE0cHggc3lzdGVtLXVpO2JhY2tncm91bmQ6IzA3MTExZjtjb2xvcjojZWVlO21hcmdpbjowO3BhZGRpbmc6MjBweH1tYWlue21heC13aWR0aDoxMjAwcHg7bWFyZ2luOmF1dG99Lmd7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoNCwxZnIpO2dhcDoxMHB4fS5je2JhY2tncm91bmQ6IzBkMWIyZDtib3JkZXI6MXB4IHNvbGlkICMyMzQ7cGFkZGluZzoxNHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXJnaW4tdG9wOjEwcHh9Lm17Zm9udC1zaXplOjI2cHg7Zm9udC13ZWlnaHQ6ODAwfS5tdXRlZHtjb2xvcjojOWFifS5va3tjb2xvcjojNGQ4fS53YXJue2NvbG9yOiNmYjR9LmJhZHtjb2xvcjojZjc3fWJ1dHRvbixpbnB1dHtwYWRkaW5nOjEwcHg7Ym9yZGVyLXJhZGl1czo4cHg7Ym9yZGVyOjFweCBzb2xpZCAjMzQ1O2JhY2tncm91bmQ6IzEwMjIzODtjb2xvcjp3aGl0ZX1idXR0b257Y3Vyc29yOnBvaW50ZXI7YmFja2dyb3VuZDojMjU2M2VifS53e292ZXJmbG93OmF1dG99dGFibGV7d2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2V9dGQsdGh7cGFkZGluZzo3cHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgIzIzNDt0ZXh0LWFsaWduOmxlZnR9QG1lZGlhKG1heC13aWR0aDo4MDBweCl7Lmd7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdCgyLDFmcil9fUBtZWRpYShtYXgtd2lkdGg6NTAwcHgpey5ne2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnJ9fTwvc3R5bGU+PG1haW4+PGgxPvCfp6AgTWVtb3JpYUZsYXNoIEFkbWluIEFnZW50PC9oMT48cCBjbGFzcz0ibXV0ZWQiPkF1ZGl0b3JpYSBkbyBGaXJlc3RvcmUsIGNvbnRlIMO6ZG8sIGZlZWRiYWNrIGUgb3BlcmHDp8Ojby48L3A+PGlucHV0IGlkPSJ0IiB0eXBlPSJwYXNzd29yZCIgcGxhY2Vob2xkZXI9IkFETUlOX0RBU0hCT0FSRF9UT0tFTiI+PGJ1dHRvbiBpZD0iYiI+8J+UjiBBdWRpdGFyIGJhbmNvPC9idXR0b24+PGRpdiBpZD0iYSIgY2xhc3M9ImMiPkluZm9ybWUgb3Rva2VuIGUgY2xpcXVlIGVtIEF1ZGl0YXIgYmFuY28uPC9kaXY+PC9tYWluPjxzY3JpcHQ+Y29uc3QgYT1kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYScpLHQ9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3QnKTtjb25zdCBlPXY9PlN0cmluZyh2Pz8nJykucmVwbGFjZSgvWyY8PiJdL2cseD0+KHsnJic6JyZhbXA7JywnPCc6JyZsdDsnLCc+JzonJmd0OycsJyInOicmcXVvdDsnfVt4XSkpO2NvbnN0IG49dj0+bmV3IEludGwuTnVtYmVyRm9ybWF0KCdwdC1CUicpLmZvcm1hdCh2fHwwKTtmdW5jdGlvbiByZW5kZXIoZCl7bGV0IGM9ZC5jb250ZW50fHx7fSxmPWQuZmVlZGJhY2t8fHt9LHI9ZC5yZXF1ZXN0c3x8e30scz1kLnN0b3JhZ2V8fHt9O2xldCByb3dzPShjLnN1YmplY3RzfHxbXSkubWFwKHg9Pic8dHI+PHRkPicrZSh4LnN1YmplY3QpKyc8L3RkPjx0ZD4nK24oeC50b3RhbENhcmRzKSsnPC90ZD48dGQ+JytuKHgudG90YWxDb3ZlcmVkVG9waWNzKSsnIC8gJytuKHgudG90YWxFeHBlY3RlZFRvcGljcykrJzwvdGQ+PHRkPicrKCh4LmNvdmVyYWdlUGVyY2VudD09bnVsbCk/J+KAlCc6TnVtYmVyKHguY292ZXJhZ2VQZXJjZW50KS50b0ZpeGVkKDEpKyclJykrJzwvdGQ+PC90cj4nKS5qb2luKCcnKTtsZXQgcmVhc29ucz1PYmplY3QuZW50cmllcyhmLmJ5UmVhc29ufHx7fSkubWFwKHg9Pic8ZGl2PicrZSh4WzBdKSsnOiAnK24oeFsxXSkrJzwvZGl2PicpLmpvaW4oJycpO2EuaW5uZXJIVE1MPSc8ZGl2IGNsYXNzPSJnIj48ZGl2IGNsYXNzPSJjIj48ZGl2IGNsYXNzPSJtdXRlZCI+TWF0w6lyaWFzPC9kaXY+PGRpdiBjbGFzcz0ibSI+JytuKGMuc3ViamVjdENvdW50KSsnPC9kaXY+PC9kaXY+PGRpdiBjbGFzcz0iYyI+PGRpdiBjbGFzcz0ibXV0ZWQiPkNhcmRzPC9kaXY+PGRpdiBjbGFzcz0ibSI+JytuKGMudG90YWxDYXJkcykrJzwvZGl2PjwvZGl2PjxkaXYgY2xhc3M9ImMiPjxkaXYgY2xhc3M9Im11dGVkIj5GZWVkYmFjayBwZW5kZW50ZTwvZGl2PjxkaXYgY2xhc3M9Im0gd2FybiI+JytuKGYucGVuZGluZykrJzwvZGl2PjwvZGl2PjxkaXYgY2xhc3M9ImMiPjxkaXYgY2xhc3M9Im11dGVkIj5GaXJlc3RvcmUgZXN0aW1hZG88L2Rpdj48ZGl2IGNsYXNzPSJtIj4nK2Uocy51c2VkUGVyY2VudCkrJyU8L2Rpdj48ZGl2IGNsYXNzPSJtdXRlZCI+JytlKHMuZXN0aW1hdGVkTG9naWNhbE1iKSsnIE1CIC8gJytlKHMuZnJlZVJlZmVyZW5jZUdiKSsnIEdCPC9kaXY+PC9kaXY+PC9kaXY+PGRpdiBjbGFzcz0iYyB3Ij48aDI+8J+TmiBDb2JlcnR1cmE8L2gyPjx0YWJsZT48dHI+PHRoPk1hdMOpcmlhPC90aD48dGg+Q2FyZHM8L3RoPjx0aD5Uw7NwaWNvczwvdGg+PHRoPkNvYmVydHVyYTwvdGg+PC90cj4nK3Jvd3MrJzwvdGFibGU+PC9kaXY+PGRpdiBjbGFzcz0iYyI+PGgyPvCfk4ogT3BlcmHDp8OjbzwvaDI+PHA+U29saWNpdGHDp8O1ZXM6ICcrbihyLnRvdGFsKSsnPC9wPjxwPlBlbmRlbnRlczogJytuKHIucGVuZGluZykrJzwvcD48cD5Db25jbHXDrWRhczogJytuKHIuY29tcGxldGVkKSsnPC9wPjxwPkZhbGhhczogJytuKHIuZmFpbGVkKSsnPC9wPjxoMj7imqDvuI8gRmVlZGJhY2s8L2gyPicrcmVhc29ucysnPC9kaXY+PGRpdiBjbGFzcz0iYyI+PGgyPvCflI0gRGV0YWxoZXMgZGUgbWF0w6lyaWFzLCBuw612ZWlzLCB0w7NwaWNvcyBlIHN1YnTDs3BpY29zPC9oMj48cHJlIHN0eWxlPSJ3aGl0ZS1zcGFjZTpwcmUtd3JhcDttYXgtaGVpZ2h0OjUwMHB4O292ZXJmbG93OmF1dG8iPicrZShKU09OLnN0cmluZ2lmeShjLnN1YmplY3RzfHxbXSxudWxsLDIpKSsnPC9wcmU+PC9kaXY+Jzt9YXN5bmMgZnVuY3Rpb24gYXVkaXQoKXthLnRleHRDb250ZW50PSfwn5SEIExlbmRvIEZpcmVzdG9yZS4uLic7bGV0IHg9dC52YWx1ZS50cmltKCl8fHNlc3Npb25TdG9yYWdlLmdldEl0ZW0oJ21mX2FkbWluX3Rva2VuJyl8fCcnO2lmKHQudmFsdWUpc2Vzc2lvblN0b3JhZ2Uuc2V0SXRlbSgnbWZfYWRtaW5fdG9rZW4nLHgpO3RyeXtsZXQgcj1hd2FpdCBmZXRjaCgnL2FwaS9hdWRpdCcse2hlYWRlcnM6e0F1dGhvcml6YXRpb246J0JlYXJlciAnK3h9fSksZD1hd2FpdCByLmpzb24oKTtpZighci5vayl0aHJvdyBFcnJvcihkLmVycm9yfHwnRmFsaGEnKTtyZW5kZXIoZCl9Y2F0Y2goZXJyKXthLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9ImJhZCI+JytlKGVyci5tZXNzYWdlKSsnPC9zcGFuPid9fXQudmFsdWU9c2Vzc2lvblN0b3JhZ2UuZ2V0SXRlbSgnbWZfYWRtaW5fdG9rZW4nKXx8Jyc7ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2InKS5vbmNsaWNrPWF1ZGl0Ozwvc2NyaXB0PjwvaHRtbD4=', 'base64').toString('utf8');

if (require.main === module) startAdminDashboardServer();
