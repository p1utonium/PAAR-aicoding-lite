export const STATUSES = {
  planned: '待开始', in_progress: '进行中', blocked: '已阻塞',
  verifying: '验证中', awaiting_acceptance: '待业务验收', done: '已验收'
};
const phases = ['Plan', 'Ask', 'Act', 'Review'];
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const list = value => Array.isArray(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateRecord(record) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!object(record)) return ['工作记录必须是 JSON 对象'];
  if (record.schema_version !== 1) fail('schema_version 必须为 1');
  for (const key of ['project', 'goal', 'next_action']) if (!nonempty(record[key])) fail(key + ' 不能为空');
  if (!phases.includes(record.phase)) fail('phase 必须为 Plan / Ask / Act / Review');
  if (!nonempty(record.updated_at) || !/^\d{4}-\d{2}-\d{2}T/.test(record.updated_at) || !Number.isFinite(Date.parse(record.updated_at))) fail('updated_at 必须是带时间的 ISO 日期');
  if (!object(record.scope) || !list(record.scope.allowed) || !list(record.scope.excluded) ||
      !record.scope.allowed.length || [...record.scope.allowed, ...record.scope.excluded].some(x => !nonempty(x))) fail('scope 必须列出非空 allowed 和 excluded 字符串数组');
  if (!list(record.decisions) || record.decisions.some(x => !object(x) || !nonempty(x.question) || !nonempty(x.answer) || !nonempty(x.by))) fail('decisions 必须包含 question / answer / by');
  if (!list(record.tasks) || record.tasks.length > 100) return [...errors, 'tasks 必须为最多 100 项的数组'];
  const ids = new Set();
  for (const [index, task] of record.tasks.entries()) {
    const at = '任务 ' + (index + 1) + ': ';
    if (!object(task)) { fail(at + '必须是对象'); continue; }
    if (!nonempty(task.id) || !/^[a-z][a-z0-9-]{0,63}$/.test(task.id) || ids.has(task.id)) fail(at + 'id 无效或重复');
    ids.add(task.id);
    for (const key of ['title', 'next_action']) if (!nonempty(task[key])) fail(at + key + ' 不能为空');
    if (!Object.hasOwn(STATUSES, task.status)) fail(at + 'status 无效');
    if (!list(task.depends_on) || task.depends_on.some(x => !nonempty(x)) || new Set(task.depends_on).size !== task.depends_on.length) fail(at + 'depends_on 无效或重复');
    if (task.status === 'blocked' && !nonempty(task.blocker)) fail(at + '阻塞时必须说明 blocker');
    if (!list(task.acceptance) || !task.acceptance.length) { fail(at + '至少提供一个验收条件'); continue; }
    for (const item of task.acceptance) {
      if (!object(item) || !nonempty(item.text) || !['pending', 'passed', 'failed'].includes(item.result) ||
          !list(item.evidence) || item.evidence.some(x => !nonempty(x))) {
        fail(at + '验收条件需要 text / result / evidence'); continue;
      }
      if (item.result === 'passed' && !item.evidence.length) fail(at + '通过的验收条件必须引用证据');
    }
    if (['done', 'awaiting_acceptance'].includes(task.status) && task.acceptance.some(x => x?.result !== 'passed')) fail(at + '未全部验证通过，不能声明等待验收或已验收');
    if (task.status === 'done' && !nonempty(task.accepted_by)) fail(at + '已验收必须记录真实 accepted_by');
  }
  if (errors.length) return errors;
  const tasks = new Map(record.tasks.filter(object).map(t => [t.id, t]));
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    if (visiting.has(id)) { fail('依赖不能形成环'); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of tasks.get(id)?.depends_on || []) {
      if (!tasks.has(dependency)) fail('依赖不存在: ' + dependency);
      else visit(dependency);
    }
    visiting.delete(id); visited.add(id);
  };
  for (const task of tasks.values()) if (list(task.depends_on)) visit(task.id);
  const active = record.tasks.filter(t => ['in_progress', 'verifying'].includes(t?.status));
  if (active.length > 1) fail('首版只允许一个正在实施或验证的任务');
  for (const task of active) {
    if (list(task.depends_on) && task.depends_on.some(id => tasks.get(id)?.status !== 'done')) fail(task.id + ': 前置任务未验收，不能开始实施');
  }
  return [...new Set(errors)];
}

export function brief(record) {
  const active = record.tasks.filter(t => t.status !== 'done');
  return [
    '# ' + record.project, '', '业务目标：' + record.goal,
    '当前步骤：' + record.phase, '允许范围：' + record.scope.allowed.join('；'),
    '排除范围：' + (record.scope.excluded.join('；') || '无'),
    '', ...active.flatMap(t => [
      '## ' + t.title + ' · ' + STATUSES[t.status],
      '记录标识：' + t.id + '；前置任务：' + (t.depends_on.join('、') || '无'),
      '下一步：' + t.next_action,
      ...(t.blocker ? ['阻塞：' + t.blocker] : []),
      ...t.acceptance.flatMap(a => ['- ' + a.text + ' [' + a.result + ']', ...a.evidence.map(ref => '  证据：' + ref)])
    ]),
    '', '已确认决定：', ...record.decisions.map(d => '- ' + d.question + ' → ' + d.answer + '（' + d.by + '）'),
    '', '整体下一步：' + record.next_action,
    '', '继续前检查实际文件及证据；本说明由同一工作记录即时生成，不另外维护。'
  ].join('\n') + '\n';
}

export function graphModel(record) {
  const classes = {planned:'queued',in_progress:'developing',blocked:'review_failed',verifying:'reviewing',awaiting_acceptance:'completed',done:'closed'};
  return {
    snapshot_schema_version: 1,
    tasks: record.tasks.map((t, i) => ({
      task_id:t.id,title:t.title,summary:t.next_action,business_status:classes[t.status],
      operational_status:STATUSES[t.status],membership:'confirmed',relation_confirmed:true,
      lane:'业务闭环',display_order:i,next_action:t.next_action,blocker:t.blocker || ''
    })),
    relations: record.tasks.flatMap(t => t.depends_on.map(id => ({kind:'depends_on',source_task_id:id,target_task_id:t.id})))
  };
}
