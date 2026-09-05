#!/usr/bin/env node
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { validateRecord, brief } from './work-record.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 256 * 1024;
async function limitedRead(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_BYTES) throw new Error('工作记录须为不超过 256 KiB 的普通文件');
  const bytes = await readFile(path);
  if (bytes.length > MAX_BYTES) throw new Error('工作记录超过大小限制');
  return bytes.toString('utf8');
}
export async function loadRecord(path, projectRoot = ROOT) {
  const record = JSON.parse(await limitedRead(path));
  const errors = validateRecord(record);
  if (errors.length) throw new Error(errors.join('\n'));
  const root = await realpath(projectRoot);
  for (const task of record.tasks) for (const item of task.acceptance) for (const evidence of item.evidence) {
    if (isAbsolute(evidence) || evidence.includes('\\') || /^[a-z]+:/i.test(evidence)) throw new Error('证据只能使用项目内相对路径');
    let actual;
    try { actual = await realpath(resolve(root, evidence)); }
    catch { throw new Error('证据文件不存在: ' + evidence); }
    const rel = relative(root, actual);
    if (!rel || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) throw new Error('证据不能指向项目外');
    if (!(await stat(actual)).isFile()) throw new Error('证据须为普通文件');
  }
  return record;
}

const assetFiles = {
  '/': ['tools/task-monitor/index.html','text/html; charset=utf-8'],
  '/web/app.mjs': ['tools/task-monitor/web/app.mjs','text/javascript; charset=utf-8'],
  '/web/style.css': ['tools/task-monitor/web/style.css','text/css; charset=utf-8'],
  '/web/graph.js': ['tools/task-monitor/web/graph.js','text/javascript; charset=utf-8'],
  '/web/graph.css': ['tools/task-monitor/web/graph.css','text/css; charset=utf-8'],
  '/web/work-record.mjs': ['scripts/work-record.mjs','text/javascript; charset=utf-8']
};
export function makeServer(recordPath, projectRoot = ROOT) {
  const server = createServer(async (request, response) => {
    const port = server.address().port;
    const validHosts = ['127.0.0.1:' + port, 'localhost:' + port];
    const send = (status, type, body) => {
      response.writeHead(status, {
        'Content-Type':type, 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
        'Referrer-Policy':'no-referrer'
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!validHosts.includes(request.headers.host) ||
        (request.headers.origin && request.headers.origin !== 'http://' + request.headers.host)) {
      send(403,'text/plain; charset=utf-8','禁止跨站访问'); return;
    }
    if (!['GET','HEAD'].includes(request.method)) { send(405,'text/plain; charset=utf-8','只读服务'); return; }
    let path;
    try { path = new URL(request.url,'http://127.0.0.1').pathname; } catch { send(400,'text/plain','Bad request'); return; }
    if (path === '/health') { send(200,'application/json','{"ok":true,"mode":"read-only"}'); return; }
    if (path === '/api/work') {
      try { send(200,'application/json; charset=utf-8',JSON.stringify(await loadRecord(recordPath, projectRoot))); }
      catch (error) { send(422,'application/json; charset=utf-8',JSON.stringify({error: error instanceof SyntaxError ? '工作记录不是有效 JSON；未更新显示' : error.message})); }
      return;
    }
    const asset = assetFiles[path];
    if (!asset) { send(404,'text/plain','Not found'); return; }
    try { send(200,asset[1],await readFile(resolve(ROOT,asset[0]))); }
    catch { send(500,'text/plain','Asset unavailable'); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxConnections = 16;
  return server;
}
async function main() {
  const [command = 'check', ...args] = process.argv.slice(2);
  if (!['check','brief','serve'].includes(command)) throw new Error('用法: node scripts/paar.mjs check|brief|serve [record.json] [--port=8765] [--open]');
  const positional = args.filter(a => !a.startsWith('--'));
  const unknown = args.filter(a => a.startsWith('--') && a !== '--open' && !a.startsWith('--port='));
  if (unknown.length || positional.length > 1) throw new Error('不支持的参数');
  const recordPath = resolve(ROOT,positional[0] || 'work/current.json');
  if (command === 'check' || command === 'brief') {
    const record = await loadRecord(recordPath);
    process.stdout.write(command === 'brief' ? brief(record) : '工作记录有效；这不代表业务已经验收。\n');
    return;
  }
  const portArg = args.find(a => a.startsWith('--port='));
  const port = portArg ? Number(portArg.slice(7)) : 8765;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口须在 1024—65535 之间');
  const server = makeServer(recordPath);
  server.on('error',error => { process.stderr.write(error.code === 'EADDRINUSE' ? '端口已占用，请用 --port=8766 指定其他端口。\n' : '服务启动失败: ' + error.message + '\n'); process.exitCode = 1; });
  server.listen(port,'127.0.0.1',() => {
    const url = 'http://127.0.0.1:' + port;
    process.stdout.write('任务地图：' + url + '\n只读显示；关闭此终端或按 Ctrl+C 停止服务。\n');
    if (args.includes('--open')) {
      const child = process.platform === 'win32' ? spawn('explorer.exe',[url],{stdio:'ignore'})
        : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open',[url],{stdio:'ignore'});
      child.on('error',() => process.stdout.write('请手动在浏览器打开上面的地址。\n'));
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
