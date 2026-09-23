import 'dotenv/config';
import http from 'node:http';

const port = Number(process.env.PORT || 8787);
const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const configuredModel = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
// DeepSeek 官方 API 当前常用的是 deepseek-chat/deepseek-reasoner；
// 若旧配置写了 deepseek-flash，自动按 chat 兼容，避免直接得到无效模型错误。
const apiModel = configuredModel === 'deepseek-flash' ? 'deepseek-chat' : configuredModel;

function send(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Content-Type'});
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'}); return res.end(); }
  if (req.url === '/health') return send(res, 200, {ok:true, configuredModel, apiModel});
  if (req.method !== 'POST' || req.url !== '/chat') return send(res, 404, {error:'not found'});
  if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY.includes('在这里')) return send(res, 503, {error:'未配置 DEEPSEEK_API_KEY'});
  let body=''; req.on('data', chunk => body += chunk); req.on('end', async () => {
    try {
      const input = JSON.parse(body || '{}');
      const upstream = await fetch(`${baseUrl}/chat/completions`, {method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.DEEPSEEK_API_KEY}`}, body:JSON.stringify({model:apiModel, messages:input.messages || [], temperature:0.1})});
      const data = await upstream.json(); send(res, upstream.status, data);
    } catch (error) { send(res, 500, {error:String(error)}); }
  });
});
server.listen(port, '127.0.0.1', () => console.log(`Pintia local AI service listening on http://127.0.0.1:${port}`));
