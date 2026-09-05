import { validateRecord, graphModel, STATUSES } from '/web/work-record.mjs';
const $ = id => document.getElementById(id);
const text = (tag, value, className) => { const e = document.createElement(tag); e.textContent = value; if (className) e.className = className; return e; };
let record = null, selected = null, lastBytes = null, inflight = false;
const graph = window.TaskMonitorGraph.mount($('graph'), {onSelect:id => { selected = id; showDetail(); }});
function showDetail() {
  const box = $('detail'); box.replaceChildren();
  const task = record?.tasks.find(t => t.id === selected);
  if (!task) { box.append(text('h2','选择一个任务'),text('p','查看它的验收条件、证据和下一步。')); return; }
  box.append(text('span',STATUSES[task.status],'badge ' + task.status),text('h2',task.title),text('p',task.next_action));
  if (task.blocker) box.append(text('p','阻塞：' + task.blocker,'warning'));
  box.append(text('h3','验收条件'));
  for (const item of task.acceptance) {
    const section = text('div','', 'criterion ' + item.result);
    section.append(text('strong',({pending:'待验证',passed:'有通过记录',failed:'验证失败'})[item.result] + ' · ' + item.text));
    for (const ref of item.evidence) section.append(text('code',ref));
    box.append(section);
  }
  if (task.accepted_by) box.append(text('p','验收确认：' + task.accepted_by));
  box.append(text('p','证据路径可供核对；记录通过不等于证据已被独立复核。','hint'));
}
function render(nextRecord) {
  const errors = validateRecord(nextRecord);
  if (errors.length) throw new Error(errors.join('；'));
  const result = graph.render(graphModel(nextRecord));
  if (!result.ok) throw new Error(result.message);
  record = nextRecord;
  if (selected && record.tasks.some(t => t.id === selected)) graph.focusTask(selected);
  else selected = null;
  $('project').textContent = record.project;
  $('goal').textContent = record.goal;
  $('next').textContent = '下一步：' + record.next_action;
  $('summary').replaceChildren(text('span',record.phase,'phase'),text('span',record.tasks.filter(t => t.status === 'done').length + ' / ' + record.tasks.length + ' 已验收'));
  $('task-list').replaceChildren();
  for (const task of record.tasks) {
    const button = text('button',task.title + ' · ' + STATUSES[task.status],'task-row');
    button.addEventListener('click',() => { selected = task.id; graph.focusTask(task.id); showDetail(); });
    $('task-list').append(button);
  }
  if (!record.tasks.length) $('task-list').append(text('p','暂无任务。不会自动补造任务或进度。'));
  $('decisions').replaceChildren();
  for (const d of record.decisions) $('decisions').append(text('p',d.question + '：' + d.answer + '（' + d.by + '）'));
  if (!record.decisions.length) $('decisions').append(text('p','暂无已确认决定。'));
  $('updated').textContent = '记录更新时间：' + record.updated_at;
  showDetail();
}
async function refresh() {
  if (inflight) return;
  inflight = true;
  try {
    const response = await fetch('/api/work',{cache:'no-store',signal:AbortSignal.timeout(5000)});
    const bytes = await response.text();
    const payload = JSON.parse(bytes);
    if (!response.ok) throw new Error(payload.error || '读取失败');
    if (bytes !== lastBytes) { render(payload); lastBytes = bytes; }
    $('connection').textContent = '读取正常';
    $('connection').className = 'connected';
    $('error').hidden = true;
  } catch(error) {
    $('connection').textContent = record ? '更新失败 · 显示上次记录' : '无法读取记录';
    $('connection').className = 'disconnected';
    $('error').hidden = false;
    $('error').textContent = (record ? '上次记录未被覆盖。' : '') + error.message;
  } finally { inflight = false; }
}
$('refresh').addEventListener('click',refresh);
await refresh();
setInterval(refresh,3000);
