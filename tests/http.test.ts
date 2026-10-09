import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { route } from '../server/http';
import { DemoService } from '../server/service';
import { FileStore } from '../server/store';
import {emptyDraft} from '../shared/domain';
it('protects setup, validates input and limits payload size',async()=>{const api=new DemoService(new FileStore(await mkdtemp(join(tmpdir(),'parali-api-'))));const req={method:'POST',path:'/api/sessions',headers:{authorization:'Bearer wrong'},body:'{}'};expect((await route(api,req,'setup-key')).status).toBe(403);const c=await api.create();expect((await route(api,{...req,path:`/api/sessions/${c.session.id}/action`,headers:{authorization:'Bearer '+c.tokens.farmer},body:JSON.stringify({action:'edit',key:randomUUID(),epoch:1,version:1,draft:{area:-20}})},'setup-key')).status).toBe(400);expect((await route(api,{...req,body:'x'.repeat(1000001)},'setup-key')).status).toBe(413);});
it('keeps farmer and buyer access available after the former midnight cutoff',async()=>{
 const api=new DemoService(new FileStore(await mkdtemp(join(tmpdir(),'parali-cutoff-'))));const c=await api.create();
 process.env.DEMO_ENDS_AT='2020-01-01T00:00:00Z';
 try{
  const req={method:'GET',path:'/api/health',headers:{},body:''};expect((await route(api,req,'')).status).toBe(200);
  const edited=await route(api,{...req,method:'POST',path:`/api/sessions/${c.session.id}/action`,headers:{authorization:'Bearer '+c.tokens.farmer},body:JSON.stringify({action:'edit',key:randomUUID(),epoch:1,version:1,draft:{...emptyDraft(),area:3}})},'');expect(edited.status).toBe(200);
  for(const role of ['farmer','buyer'] as const)expect((await route(api,{...req,path:`/api/sessions/${c.session.id}`,headers:{authorization:'Bearer '+c.tokens[role]}},'')).status).toBe(200);
 }finally{delete process.env.DEMO_ENDS_AT;}
});
