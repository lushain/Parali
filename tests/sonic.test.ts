import {emptyDraft,indiaToday,addDays} from '../shared/domain';
import {randomUUID} from 'node:crypto';
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {DemoService} from '../server/service';
import {startSonic,syncSonic,sonicConnectionLimit} from '../server/sonic';
import type {Stored,Store} from '../server/store';
const {send}=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('@aws-sdk/client-sts',()=>({STSClient:class{send=send;},AssumeRoleCommand:class{constructor(public input:unknown){}}}));
const credentials=()=>({Credentials:{AccessKeyId:'test-id',SecretAccessKey:'test-secret',SessionToken:'test-token',Expiration:new Date(Date.now()+900000)}});
class Memory implements Store{rows=new Map<string,Stored>();async get(id:string){return structuredClone(this.rows.get(id));}async save(s:Stored,v:number|null){if((this.rows.get(s.id)?.version??null)!==v)return false;this.rows.set(s.id,structuredClone(s));return true;}}
beforeEach(()=>send.mockReset().mockResolvedValue(credentials()));
afterEach(()=>vi.unstubAllEnvs());
async function setup(){vi.stubEnv('VOICE_BACKEND','sonic');const store=new Memory(),api=new DemoService(store,'aws'),c=await api.create();return {store,api,c};}
describe('direct Nova voice grants and validated facts',()=>{
 it('issues a short lease only to the farmer and hides internal grant state',async()=>{
  const {api,c,store}=await setup();await expect(startSonic(api,c.session.id,c.tokens.buyer,{epoch:1})).rejects.toMatchObject({status:403});
  const t=await startSonic(api,c.session.id,c.tokens.farmer,{epoch:1});expect(t.modelId).toBe('amazon.nova-2-5-sonic');expect(t.maxSeconds).toBe(180);expect(t.session).not.toHaveProperty('sonicLease');expect(t.session).not.toHaveProperty('sonicStarts');expect(t.session).not.toHaveProperty('credentials');
  await expect(startSonic(api,c.session.id,c.tokens.farmer,{epoch:1})).rejects.toMatchObject({status:409});
  expect((await store.get(c.session.id))!.sonicStarts).toHaveLength(1);expect(send).toHaveBeenCalledTimes(1);
 });
 it('accepts three acres, then four, without publishing or fabricated village',async()=>{
  const {api,c}=await setup(),id=c.session.id,token=c.tokens.farmer,t=await startSonic(api,id,token,{epoch:1});
  const base={leaseId:t.leaseId,epoch:1,kind:'tool'};
  const first=await syncSonic(api,id,token,{...base,key:'one',text:'तीन एकड़ गेहूँ की पराली है',patch:{crop:'wheat',area:3,unit:'acre',village:'संगरूर'}});
  expect(first.session.draft).toMatchObject({crop:'wheat',area:3,unit:'acre',village:null});expect(first.session.request).toBeUndefined();
  const second=await syncSonic(api,id,token,{...base,key:'two',text:'तीन नहीं चार एकड़',patch:{area:4}});expect(second.session.draft.area).toBe(4);
  const duplicate=await syncSonic(api,id,token,{...base,key:'two',text:'तीन नहीं चार एकड़',patch:{area:4}});expect(duplicate.session.version).toBe(second.session.version);
  await expect(syncSonic(api,id,token,{...base,key:'bad',text:'हाँ',patch:{locationId:'sangrur-east'}})).rejects.toThrow();
 });
 it('saves the first short crop answer even when Nova spells wheat as गेहों',async()=>{
  const {api,c}=await setup(),id=c.session.id,token=c.tokens.farmer,t=await startSonic(api,id,token,{epoch:1});
  const sync=(kind:string,extra:Record<string,unknown>={})=>syncSonic(api,id,token,{leaseId:t.leaseId,epoch:1,key:randomUUID(),kind,...extra});
  await sync('assistant',{text:'आपकी फसल धान है या गेहूं?'});await sync('user',{text:'गेहों'});
  const saved=await sync('tool',{text:'गेहों',patch:{crop:'wheat'}});expect(saved.session.draft.crop).toBe('wheat');
  await sync('assistant',{text:'आपके गाँव का नाम क्या है?'});await sync('user',{text:'संगर'});
  const village=await sync('tool',{text:'संगर',patch:{village:'संगर'}});expect(village.session.draft).toMatchObject({crop:'wheat',village:'संगर'});
 });
 it('rejects other sessions, expired leases and updates after a concurrent edit',async()=>{
  const {api,store,c}=await setup(),id=c.session.id,token=c.tokens.farmer,t=await startSonic(api,id,token,{epoch:1});
  const payload={leaseId:t.leaseId,epoch:1,key:'test',kind:'tool',text:'तीन एकड़',patch:{area:3,unit:'acre'}};
  await expect(syncSonic(api,id,c.tokens.buyer,payload)).rejects.toMatchObject({status:403});
  const other=await api.create();await expect(syncSonic(api,other.session.id,other.tokens.farmer,payload)).rejects.toMatchObject({status:409});
  const row=(await store.get(id))!;await api.commit(row,row.version);await expect(syncSonic(api,id,token,payload)).rejects.toMatchObject({status:409});
  row.sonicLease!.expiresAt=0;row.sonicLease!.version=row.version;await store.save(row,row.version);await expect(syncSonic(api,id,token,payload)).rejects.toMatchObject({status:409});
 });
 it('requires a separate yes after a visible map and publishes the exact draft once',async()=>{
  const {api,c,store}=await setup(),id=c.session.id,token=c.tokens.farmer;
  await api.action(id,token,{action:'edit',key:randomUUID(),epoch:1,version:1,draft:{...emptyDraft(),crop:'wheat',area:3,unit:'acre',village:'Kheri',availableDate:indiaToday(),deadline:addDays(indiaToday(),10),access:'truck'}});
  const t=await startSonic(api,id,token,{epoch:1});
  const sync=(kind:string,extra:Record<string,unknown>={})=>syncSonic(api,id,token,{leaseId:t.leaseId,epoch:1,key:randomUUID(),kind,...extra});
  await sync('user',{text:'हाँ'});const map=await sync('map-open');const previewId=map.session.locationPreview!.id;
  const persisted=store.rows.get(id)!;persisted.draft=Object.fromEntries(Object.entries(persisted.draft).reverse()) as Stored['draft'];
  await expect(sync('map-confirm',{text:'हाँ',previewId})).rejects.toMatchObject({status:400});
  await sync('user',{text:'नहीं'});await expect(sync('map-confirm',{text:'नहीं',previewId})).rejects.toMatchObject({status:400});
  await sync('user',{text:'जी यही मेरा खेत है।'});const done=await sync('map-confirm',{text:'जी यही मेरा खेत है।',previewId});
  expect(done.session.request?.status).toBe('open');expect(done.session.request?.draft).toMatchObject({area:3,locationId:'sangrur-east'});expect(done.session.locationPreview).toBeUndefined();
  await sync('assistant',{text:'आपका अनुरोध भेज दिया है।'});expect((await api.read(id,c.tokens.buyer)).request?.id).toBe(done.session.request?.id);
  await expect(sync('map-confirm',{text:'हाँ',previewId})).rejects.toMatchObject({status:409});
 });
 it('accepts the repeated polite voice confirmation without requiring the button',async()=>{
  const {api,c}=await setup(),id=c.session.id,token=c.tokens.farmer;
  await api.action(id,token,{action:'edit',key:randomUUID(),epoch:1,version:1,draft:{...emptyDraft(),crop:'wheat',area:.5,unit:'acre',village:'संगर',availableDate:indiaToday(),deadline:addDays(indiaToday(),7),access:'truck'}});
  const t=await startSonic(api,id,token,{epoch:1});
  const sync=(kind:string,extra:Record<string,unknown>={})=>syncSonic(api,id,token,{leaseId:t.leaseId,epoch:1,key:randomUUID(),kind,...extra});
  await sync('user',{text:'जी।'});const map=await sync('map-open');
  await expect(sync('map-confirm',{text:'जी।',previewId:map.session.locationPreview!.id})).rejects.toMatchObject({status:400});
  await sync('user',{text:'जी हाँ यही खेत है।'});
  const done=await sync('map-confirm',{text:'जी हाँ यही खेत है।',previewId:map.session.locationPreview!.id});
  expect(done.session.request?.draft).toMatchObject({crop:'wheat',area:.5,locationId:'sangrur-east'});
  expect((await api.read(id,c.tokens.buyer)).request?.id).toBe(done.session.request?.id);
 });
 it('rejects map sending after a correction or reset',async()=>{
  const {api,c}=await setup(),id=c.session.id,token=c.tokens.farmer;let s=await api.action(id,token,{action:'edit',key:randomUUID(),epoch:1,version:1,draft:{...emptyDraft(),crop:'wheat',area:3,unit:'acre',village:'Kheri',availableDate:indiaToday(),deadline:addDays(indiaToday(),10),access:'truck'}});
  const action=(name:string,extra:Record<string,unknown>={})=>api.action(id,token,{action:name,key:randomUUID(),epoch:s.epoch,version:s.version,...extra});
  s=await action('map-open');const previewId=s.locationPreview!.id;s=await action('edit',{draft:{...s.draft,area:4}});
  await expect(action('map-confirm',{previewId})).rejects.toMatchObject({status:409});s=await action('reset');await expect(action('map-confirm',{previewId})).rejects.toMatchObject({status:409});
 });
 it('allows reconnecting after four starts independently of legacy speech quotas',async()=>{
  const {api,c,store}=await setup();expect(sonicConnectionLimit()).toBe(60);
  const row=store.rows.get(c.session.id)!;row.sonicStarts=Array(4).fill(Date.now());row.aiCalls=60;row.aiTotal=180;
  const t=await startSonic(api,c.session.id,c.tokens.farmer,{epoch:1});
  await syncSonic(api,c.session.id,c.tokens.farmer,{leaseId:t.leaseId,epoch:1,key:'end',kind:'end'});
  const saved=(await store.get(c.session.id))!;expect(saved.sonicStarts).toHaveLength(5);expect(saved.sonicLease).toBeUndefined();expect(saved.aiCalls).toBe(60);expect(saved.aiTotal).toBe(180);
 });
 it('enforces 60 starts in a rolling hour and prunes expired entries',async()=>{
  const {api,c,store}=await setup(),row=store.rows.get(c.session.id)!;row.sonicStarts=Array(60).fill(Date.now());
  await expect(startSonic(api,c.session.id,c.tokens.farmer,{epoch:1})).rejects.toMatchObject({status:429});expect(send).not.toHaveBeenCalled();
  row.sonicStarts[0]=Date.now()-3600001;
  await startSonic(api,c.session.id,c.tokens.farmer,{epoch:1});expect((await store.get(c.session.id))!.sonicStarts).toHaveLength(60);
 });
 it('supports a configured allowance without bypassing it on reset',async()=>{
  vi.stubEnv('SONIC_CONNECTIONS_PER_HOUR','2');const {api,c,store}=await setup();
  for(let i=0;i<2;i++){const t=await startSonic(api,c.session.id,c.tokens.farmer,{epoch:1});await syncSonic(api,c.session.id,c.tokens.farmer,{leaseId:t.leaseId,epoch:1,key:'end'+i,kind:'end'});}
  const row=(await store.get(c.session.id))!;await api.action(c.session.id,c.tokens.farmer,{action:'reset',key:randomUUID(),epoch:1,version:row.version});
  await expect(startSonic(api,c.session.id,c.tokens.farmer,{epoch:2})).rejects.toMatchObject({status:429});
 });
 it('does not consume a connection or leave a lease when AWS credentials fail',async()=>{
  const {api,c,store}=await setup();send.mockRejectedValueOnce(new Error('STS unavailable'));
  await expect(startSonic(api,c.session.id,c.tokens.farmer,{epoch:1})).rejects.toThrow('STS unavailable');
  const row=(await store.get(c.session.id))!;expect(row.sonicStarts||[]).toHaveLength(0);expect(row.sonicLease).toBeUndefined();
  await startSonic(api,c.session.id,c.tokens.farmer,{epoch:1});expect((await store.get(c.session.id))!.sonicStarts).toHaveLength(1);
 });
 it('discards credentials issued during an edit without overwriting the new draft',async()=>{
  const {api,c,store}=await setup();send.mockImplementationOnce(async()=>{const row=(await store.get(c.session.id))!;row.draft.area=4;await api.commit(row,row.version);return credentials();});
  await expect(startSonic(api,c.session.id,c.tokens.farmer,{epoch:1})).rejects.toMatchObject({status:409});
  const row=(await store.get(c.session.id))!;expect(row.draft.area).toBe(4);expect(row.sonicLease).toBeUndefined();expect(row.sonicStarts||[]).toHaveLength(0);
 });
});
