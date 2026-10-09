import { describe,it,expect,beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore,hash, type Stored, type Store } from '../server/store';
import { DemoService } from '../server/service';
import { addDays, emptyDraft, indiaToday, type Draft, type SessionView } from '../shared/domain';
const fullDraft=():Draft=>({...emptyDraft(),crop:'paddy',area:6,unit:'acre',village:'Sangrur',locationId:'sangrur-east',availableDate:indiaToday(),deadline:addDays(indiaToday(),10),access:'truck'});
class Memory implements Store{rows=new Map<string,Stored>();async get(id:string){return structuredClone(this.rows.get(id));}async save(v:Stored,e:number|null){if((this.rows.get(v.id)?.version??null)!==e)return false;this.rows.set(v.id,structuredClone(v));return true;}}
let api:DemoService;beforeEach(()=>{api=new DemoService(new Memory());});
async function fixture(){const c=await api.create();let s=c.session;const act=async(action:string,role:'farmer'|'buyer',extra:Record<string,unknown>={})=>{s=await api.action(s.id,c.tokens[role],{action,key:randomUUID(),version:s.version,epoch:s.epoch,...extra});return s;};return {c,act,get:()=>s};}
describe('shared-state workflow',()=>{
  it('has only farmer and buyer roles and rejects retired administration grants',async()=>{
    const c=await api.create();expect(Object.keys(c.tokens).sort()).toEqual(['buyer','farmer']);
    const row=(await api.store.get(c.session.id))!;Object.assign(row.grants,{organizer:hash('retired-role-token')});await api.store.save(row,row.version);
    await expect(api.read(c.session.id,'retired-role-token')).rejects.toMatchObject({status:403});
    await expect(api.action(c.session.id,'retired-role-token',{action:'reset',key:randomUUID(),version:1,epoch:1})).rejects.toMatchObject({status:403});
  });
  it('publishes exact draft, creates one offer, accepts and recovers with renewed farmer approval',async()=>{const {c,act,get}=await fixture();await act('edit','farmer',{draft:fullDraft()});await act('publish','farmer');const buyer=await api.read(c.session.id,c.tokens.buyer);expect(buyer.request?.draft).toEqual(fullDraft());expect(buyer.request?.id).toBe(get().request?.id);await act('offer','buyer',{optionId:'standard'});const id=get().request!.offer!.id;await act('offer','buyer',{optionId:'standard'});expect(get().request!.offer!.id).toBe(id);await act('accept','farmer');await act('plan','buyer');await act('cancel','buyer');expect(get().request?.status).toBe('attention');await act('recover','buyer');expect(get().request?.status).toBe('offered');expect(get().request?.offer?.acceptedAt).toBeUndefined();await act('accept','farmer');await act('plan','buyer');await act('complete','buyer');expect((await api.read(c.session.id,c.tokens.farmer)).request).toEqual((await api.read(c.session.id,c.tokens.buyer)).request);});
  it('isolates sessions and enforces roles at the backend',async()=>{const a=await api.create(),b=await api.create();await expect(api.read(a.session.id,b.tokens.farmer)).rejects.toMatchObject({status:403});await expect(api.action(a.session.id,a.tokens.buyer,{action:'publish',key:randomUUID(),version:1,epoch:1})).rejects.toMatchObject({status:403});expect(JSON.stringify(a.session)).not.toContain(a.tokens.buyer);expect('grants' in a.session).toBe(false);});
  it('does not expose private intake to the buyer',async()=>{const c=await api.create();await api.turn(c.session.id,c.tokens.farmer,{text:'Five acre paddy',key:randomUUID(),version:1,epoch:1});const buyer=await api.read(c.session.id,c.tokens.buyer);expect(buyer.messages).toEqual([]);expect(buyer.draft.area).toBeNull();});
  it('deduplicates exact action retries and rejects stale concurrent edits',async()=>{const c=await api.create();const action={action:'edit',key:randomUUID(),version:1,epoch:1,draft:fullDraft()};const one=await api.action(c.session.id,c.tokens.farmer,action);const two=await api.action(c.session.id,c.tokens.farmer,action);expect(two.version).toBe(one.version);await expect(api.action(c.session.id,c.tokens.farmer,{...action,key:randomUUID()})).rejects.toMatchObject({status:409});});
  it('resets only the selected session and restores its previous scene',async()=>{const {c,act,get}=await fixture();const second=await api.create();await act('edit','farmer',{draft:fullDraft()});await act('publish','farmer');const before=get().request;const old=get();await act('reset','farmer');expect(get().request).toBeUndefined();await expect(api.action(c.session.id,c.tokens.farmer,{action:'publish',key:randomUUID(),version:old.version,epoch:old.epoch})).rejects.toMatchObject({status:409});await act('restore','farmer');expect(get().request).toEqual(before);expect((await api.read(second.session.id,second.tokens.farmer)).version).toBe(1);});
  it('lets a farmer start over without resetting budgets or other sessions',async()=>{
    const {c,act,get}=await fixture();const other=await api.create();
    await act('edit','farmer',{draft:fullDraft()});await act('publish','farmer');const published=get().request;
    const stored=(await api.store.get(c.session.id))!;stored.sonicLease={id:randomUUID(),epoch:stored.epoch,version:stored.version,expiresAt:Date.now()+180000};stored.sonicStarts=[Date.now()];stored.aiTotal=12;
    stored.messages=[{role:'user',text:'तीन एकड़ गेहूँ',source:'aws-voice',at:new Date().toISOString()},{role:'assistant',text:'किस गाँव में?',source:'aws',at:new Date().toISOString()}];
    await api.store.save(stored,stored.version);
    await expect(act('reset','buyer')).rejects.toMatchObject({status:403});
    await expect(api.action(c.session.id,other.tokens.farmer,{action:'reset',key:randomUUID(),epoch:get().epoch,version:get().version})).rejects.toMatchObject({status:403});
    const old=get();await act('reset','farmer');expect(get().draft).toEqual(emptyDraft());expect(get().request).toBeUndefined();expect(get().messages).toEqual([]);expect(get().epoch).toBe(old.epoch+1);
    const reset=(await api.store.get(c.session.id))!;expect(reset.sonicLease).toBeUndefined();expect(reset.sonicStarts).toEqual(stored.sonicStarts);expect(reset.aiTotal).toBe(12);expect(reset.grants).toEqual(stored.grants);
    expect((await api.read(c.session.id,c.tokens.buyer)).request).toBeUndefined();
    await expect(api.action(c.session.id,c.tokens.farmer,{action:'edit',draft:fullDraft(),key:randomUUID(),epoch:old.epoch,version:old.version})).rejects.toMatchObject({status:409});
    await act('restore','farmer');expect(get().request).toEqual(published);expect((await api.store.get(c.session.id))!.sonicLease).toBeUndefined();
    expect((await api.read(other.session.id,other.tokens.farmer)).version).toBe(1);
  });
  it('preserves corrections and recalculates before confirmation',async()=>{const c=await api.create();let s:SessionView=c.session;for(const text of ['Mere paas paanch acre dhaan ki parali hai. Das din mein khet khaali chahiye.','Paanch nahi, chhe acre']){const r=await api.turn(s.id,c.tokens.farmer,{text,key:randomUUID(),epoch:s.epoch,version:s.version});s=r.session;}expect(s.draft.area).toBe(6);expect(s.draft.deadline).toBe(addDays(indiaToday(),10));expect(s.evidence).toEqual([]);});
  it('persists through server recreation and handles concurrent file writes',async()=>{const dir=await mkdtemp(join(tmpdir(),'parali-test-'));const first=new DemoService(new FileStore(dir));const c=await first.create();await first.action(c.session.id,c.tokens.farmer,{action:'edit',draft:fullDraft(),version:1,epoch:1,key:randomUUID()});const restarted=new DemoService(new FileStore(dir));expect((await restarted.read(c.session.id,c.tokens.farmer)).draft).toEqual(fullDraft());const store=restarted.store;const v=(await store.get(c.session.id))!;const results=await Promise.all([store.save({...v,version:3},2),store.save({...v,version:3},2)]);expect(results.filter(Boolean)).toHaveLength(1);});
  it('does not manufacture AWS voice in mock mode',async()=>{const c=await api.create();await expect(api.speechStart(c.session.id,c.tokens.farmer,{audio:'x',epoch:1})).rejects.toMatchObject({status:503});await expect(api.speechReply(c.session.id,c.tokens.farmer)).rejects.toMatchObject({status:503});});
  it('keeps the saved scene immutable across repeated restores',async()=>{const {c,act}=await fixture();await act('edit','farmer',{draft:fullDraft()});await act('publish','farmer');await act('reset','farmer');const snapshot=structuredClone((await api.store.get(c.session.id))!.snapshot);await act('restore','farmer');await act('restore','farmer');expect((await api.store.get(c.session.id))!.snapshot).toEqual(snapshot);});
});
