import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateRecord, brief, graphModel } from '../scripts/work-record.mjs';
import { loadRecord, ROOT } from '../scripts/paar.mjs';
const base = () => ({
 schema_version:1,project:'样例',goal:'保存后可以读取',phase:'Act',updated_at:'2026-09-06T12:00:00+08:00',
 scope:{allowed:['example.txt'],excluded:[]},decisions:[],next_action:'检查结果',
 tasks:[{id:'save',title:'保存记录',status:'in_progress',depends_on:[],next_action:'运行测试',blocker:'',
 acceptance:[{text:'关闭再开仍能读取',result:'pending',evidence:[]}]}]
});
test('small PAAR task needs no routing, card, dispatch or locks',() => assert.deepEqual(validateRecord(base()),[]));
test('empty task list is a truthful empty state',() => {const r=base();r.tasks=[];assert.deepEqual(validateRecord(r),[]);assert.equal(graphModel(r).tasks.length,0);});
for (const [name,mutate,pattern] of [
 ['duplicate task identity',r=>r.tasks.push(structuredClone(r.tasks[0])),/id 无效或重复/],
 ['missing dependency',r=>r.tasks[0].depends_on=['unknown'],/依赖不存在/],
 ['cyclic dependency',r=>r.tasks[0].depends_on=['save'],/依赖不能形成环/],
 ['done with unverified acceptance',r=>{r.tasks[0].status='done';r.tasks[0].accepted_by='测试用户';},/未全部验证通过/],
 ['awaiting acceptance with failed test',r=>{r.tasks[0].status='awaiting_acceptance';r.tasks[0].acceptance[0].result='failed';},/未全部验证通过/],
 ['passed without evidence',r=>r.tasks[0].acceptance[0].result='passed',/必须引用证据/],
 ['done without user confirmation',r=>{r.tasks[0].status='done';r.tasks[0].acceptance[0]={text:'通过',result:'passed',evidence:['test.md']};},/accepted_by/],
 ['blocked without explanation',r=>r.tasks[0].status='blocked',/blocker/],
 ['multiple simultaneous writers',r=>{r.tasks.push({...structuredClone(r.tasks[0]),id:'load'});},/一个正在/],
 ['unfinished prerequisite',r=>{r.tasks.push({...structuredClone(r.tasks[0]),id:'first',status:'planned'});r.tasks[0].depends_on=['first'];},/前置任务未验收/],
 ['malformed dependency is an error, not an exception',r=>r.tasks[0].depends_on={},/depends_on/],
 ['invalid task object',r=>r.tasks=[null],/必须是对象/],
 ['invalid acceptance object',r=>r.tasks[0].acceptance=[null],/验收条件/],
 ['invalid timestamp',r=>r.updated_at='yesterday',/updated_at/]
]) test(name,()=>{const r=base();mutate(r);assert.match(validateRecord(r).join('\n'),pattern);});
test('done requires both recorded evidence and confirmation',()=>{const r=base();r.tasks[0].status='done';r.tasks[0].accepted_by='试用者';r.tasks[0].acceptance[0].result='passed';r.tasks[0].acceptance[0].evidence=['evidence.md'];assert.deepEqual(validateRecord(r),[]);});
test('graph and handoff derive state from the same record',()=>{const r=base();assert.equal(graphModel(r).tasks[0].operational_status,'进行中');r.tasks[0].status='blocked';r.tasks[0].blocker='输入样例缺失';assert.equal(graphModel(r).tasks[0].operational_status,'已阻塞');assert.match(brief(r),/输入样例缺失/);});
test('new CLI process resumes from current files',()=>{const output=execFileSync(process.execPath,['scripts/paar.mjs','brief','work/example.json'],{cwd:ROOT,encoding:'utf8'});assert.match(output,/我的业务项目/);assert.match(output,/整体下一步/);assert.doesNotMatch(output,/dispatch_id|Candidate/);});
test('evidence must exist inside the selected project',async()=>{const outer=await mkdtemp(join(tmpdir(),'paar-evidence-'));const root=join(outer,'project');await mkdir(root);const r=base();r.tasks[0].acceptance[0].evidence=['proof.md'];const path=join(root,'work.json');await writeFile(path,JSON.stringify(r));await assert.rejects(loadRecord(path,root),/不存在/);await writeFile(join(root,'proof.md'),'Observed result');assert.equal((await loadRecord(path,root)).project,'样例');r.tasks[0].acceptance[0].evidence=['../outside.md'];await writeFile(join(root,'..','outside.md'),'outside');await writeFile(path,JSON.stringify(r));await assert.rejects(loadRecord(path,root),/项目外/);});
test('directory cannot be evidence',async()=>{const root=await mkdtemp(join(tmpdir(),'paar-dir-'));await mkdir(join(root,'proof'));const r=base();r.tasks[0].acceptance[0].evidence=['proof'];const path=join(root,'work.json');await writeFile(path,JSON.stringify(r));await assert.rejects(loadRecord(path,root),/普通文件/);});
