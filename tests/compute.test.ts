import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DemoService } from '../server/service';
import type { Stored, Store } from '../server/store';
import * as compute from '../server/compute';
import { emptyDraft } from '../shared/domain';

class Memory implements Store {
  rows=new Map<string,Stored>();
  async get(id:string){return structuredClone(this.rows.get(id));}
  async save(row:Stored,version:number|null){if((this.rows.get(row.id)?.version??null)!==version)return false;this.rows.set(row.id,structuredClone(row));return true;}
}
let api:DemoService;
beforeEach(()=>{api=new DemoService(new Memory(),'aws');vi.spyOn(compute,'usesCompute').mockReturnValue(true);vi.spyOn(compute,'enqueue').mockResolvedValue();vi.spyOn(compute,'cleanup').mockResolvedValue();vi.spyOn(compute,'poll').mockResolvedValue(null);});
afterEach(()=>vi.restoreAllMocks());
async function start(){const c=await api.create();const input={text:'मेरे पास पाँच एकड़ धान है',key:randomUUID(),epoch:1,version:1};const queued=await api.turn(c.session.id,c.tokens.farmer,input);return {c,input,queued,jobId:queued.jobId!};}
const proposal=()=>({patch:{crop:'paddy' as const,area:5,unit:'acre' as const},reply:'आपका गाँव कौन सा है?',evidence:{service:'Amazon EC2 · Qwen3',requestId:'synthetic-test-job',detail:'Test fixture, not live inference',at:new Date().toISOString()}});
describe('private compute jobs',()=>{
  it('deduplicates retry, keeps pending input private and commits once',async()=>{
    const {c,input,queued,jobId}=await start();expect(jobId).toBeTruthy();expect(queued.session.messages).toEqual([]);
    expect((await api.turn(c.session.id,c.tokens.farmer,input)).jobId).toBe(jobId);expect(compute.enqueue).toHaveBeenCalledTimes(1);
    const buyer=await api.read(c.session.id,c.tokens.buyer);expect('computeJob' in buyer).toBe(false);expect(JSON.stringify(buyer)).not.toContain(input.text);
    expect((await api.turnStatus(c.session.id,c.tokens.farmer,jobId)).status).toBe('pending');
    vi.mocked(compute.poll).mockResolvedValue(proposal());const done=await api.turnStatus(c.session.id,c.tokens.farmer,jobId);
    expect(done.session.draft.area).toBe(5);expect(done.session.messages).toHaveLength(2);
    const retry=await api.turnStatus(c.session.id,c.tokens.farmer,jobId);expect(retry.session.version).toBe(done.session.version);expect(retry.session.messages).toHaveLength(2);
  });
  it('rejects buyer access and another session token',async()=>{
    const {c,jobId}=await start();const other=await api.create();
    await expect(api.turnStatus(c.session.id,c.tokens.buyer,jobId)).rejects.toMatchObject({status:403});
    await expect(api.turnStatus(c.session.id,other.tokens.farmer,jobId)).rejects.toMatchObject({status:403});
  });
  it('never overwrites a manual correction with a late result',async()=>{
    const {c,queued,jobId}=await start();await api.action(c.session.id,c.tokens.farmer,{action:'edit',key:randomUUID(),epoch:1,version:queued.session.version,draft:{...emptyDraft(),area:9}});
    vi.mocked(compute.poll).mockResolvedValue(proposal());await expect(api.turnStatus(c.session.id,c.tokens.farmer,jobId)).rejects.toMatchObject({status:409});
    expect((await api.read(c.session.id,c.tokens.farmer)).draft.area).toBe(9);expect(compute.poll).not.toHaveBeenCalled();
  });
  it('rejects old-scene results after reset',async()=>{
    const {c,queued,jobId}=await start();await api.action(c.session.id,c.tokens.farmer,{action:'reset',key:randomUUID(),epoch:1,version:queued.session.version});
    await expect(api.turnStatus(c.session.id,c.tokens.farmer,jobId)).rejects.toMatchObject({status:404});
    expect((await api.read(c.session.id,c.tokens.farmer)).draft).toEqual(emptyDraft());
  });
  it('keeps facts unchanged and releases failed jobs',async()=>{
    const {c,jobId}=await start();vi.mocked(compute.poll).mockRejectedValue(new Error('Invalid model output'));
    await expect(api.turnStatus(c.session.id,c.tokens.farmer,jobId)).rejects.toThrow('Invalid model output');
    expect((await api.read(c.session.id,c.tokens.farmer)).draft).toEqual(emptyDraft());expect((await api.store.get(c.session.id))?.computeJob).toBeUndefined();
  });
  it('allows only one winner when two completion polls race',async()=>{
    const {c,jobId}=await start();vi.mocked(compute.poll).mockResolvedValue(proposal());
    await Promise.allSettled([api.turnStatus(c.session.id,c.tokens.farmer,jobId),api.turnStatus(c.session.id,c.tokens.farmer,jobId)]);
    expect((await api.read(c.session.id,c.tokens.farmer)).messages).toHaveLength(2);
  });
});
