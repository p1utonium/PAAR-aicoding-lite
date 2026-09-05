import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rename } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeServer, ROOT } from '../scripts/paar.mjs';
async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'paar-server-'));
 const record=JSON.parse(await readFile(join(ROOT,'work/example.json'),'utf8'));
 const file=join(root,'current.json');await writeFile(file,JSON.stringify(record));
 const server=makeServer(file,root);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return {root,record,file,url:'http://127.0.0.1:'+server.address().port};
}
test('dashboard assets and work API are readable without a publisher',async t=>{
 const f=await fixture(t);
 for(const path of ['/','/web/app.mjs','/web/graph.js','/web/work-record.mjs','/web/style.css','/health','/api/work']) {
  const r=await fetch(f.url+path);assert.equal(r.status,200,path);assert.equal(r.headers.get('cache-control'),'no-store');await r.text();
 }
 assert.deepEqual(await readdir(f.root),['current.json']);
});
test('next request sees current file edits; no second snapshot file',async t=>{
 const f=await fixture(t);f.record.goal='刚修改的业务目标';await writeFile(f.file,JSON.stringify(f.record));
 const r=await fetch(f.url+'/api/work');assert.equal((await r.json()).goal,'刚修改的业务目标');assert.deepEqual(await readdir(f.root),['current.json']);
});
test('broken record and missing file never return a success record',async t=>{
 const f=await fixture(t);await writeFile(f.file,'{broken');const r=await fetch(f.url+'/api/work');assert.equal(r.status,422);assert.match((await r.json()).error,/有效 JSON/);
 await rename(f.file,f.file+'.saved');assert.equal((await fetch(f.url+'/api/work')).status,422);
});
test('completion without evidence is rejected at the HTTP boundary',async t=>{
 const f=await fixture(t);f.record.tasks[0].status='done';await writeFile(f.file,JSON.stringify(f.record));assert.equal((await fetch(f.url+'/api/work')).status,422);
});
test('readonly server rejects writes',async t=>{const f=await fixture(t);assert.equal((await fetch(f.url+'/api/work',{method:'POST',body:'{}'})).status,405);});
test('only explicit assets are served',async t=>{const f=await fixture(t);for(const path of ['/.git/config','/README.md','/work/current.json','/%2e%2e/LICENSE','/web/%2e%2e/LICENSE']) assert.equal((await fetch(f.url+path)).status,404,path);});
test('unexpected host or cross-site origin is rejected',async t=>{
 const f=await fixture(t);
 const status=await new Promise((resolve,reject)=>{const req=request(f.url+'/api/work',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
 assert.equal(status,403);
 assert.equal((await fetch(f.url+'/api/work',{headers:{Origin:'https://example.com'}})).status,403);
});
test('oversized record is rejected',async t=>{const f=await fixture(t);await writeFile(f.file,' '.repeat(262145));assert.equal((await fetch(f.url+'/api/work')).status,422);});
test('HEAD sends no body',async t=>{const f=await fixture(t);const r=await fetch(f.url+'/api/work',{method:'HEAD'});assert.equal(r.status,200);assert.equal(await r.text(),'');});

test('API allows authorized continuation, preserves unaccepted status and checks actual evidence',async t=>{
 const f=await fixture(t),first=f.record.tasks[0];
 first.status='awaiting_acceptance';first.acceptance=[{text:'内部验证通过',result:'passed',evidence:['proof.md']}];
 f.record.decisions=[{question:'内部验证后继续',answer:'人工验收后移，继续后续工程。',by:'试验用户'}];
 f.record.tasks.push({id:'next',title:'后续工程',status:'in_progress',depends_on:[first.id],next_action:'实施',blocker:'',
  allow_unaccepted_dependencies:'内部验证后继续',acceptance:[{text:'关联功能可用',result:'pending',evidence:[]}]});
 await writeFile(f.file,JSON.stringify(f.record));
 assert.equal((await fetch(f.url+'/api/work')).status,422,'missing actual evidence must block');
 await writeFile(join(f.root,'proof.md'),'Internal test observation, not user acceptance.');
 const response=await fetch(f.url+'/api/work');assert.equal(response.status,200);
 const actual=await response.json();assert.equal(actual.tasks[0].status,'awaiting_acceptance');
 assert.equal(actual.tasks[0].accepted_by,undefined);assert.equal(actual.tasks.filter(t=>t.status==='done').length,0);
 delete f.record.tasks[1].allow_unaccepted_dependencies;await writeFile(f.file,JSON.stringify(f.record));
 assert.equal((await fetch(f.url+'/api/work')).status,422,'authorization applies only when explicitly referenced');
});
