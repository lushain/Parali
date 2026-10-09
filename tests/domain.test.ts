import { describe,it,expect } from 'vitest';
import { addDays, collectionOptions, draftIssues, emptyDraft, estimate, indiaToday, ProposalSchema, type Draft } from '../shared/domain';
import { mockProposal } from '../server/mock';
import { validateWav } from '../server/aws';
export const fullDraft=():Draft=>({...emptyDraft(),crop:'paddy',area:6,unit:'acre',village:'Sangrur',locationId:'sangrur-east',availableDate:indiaToday(),deadline:addDays(indiaToday(),10),access:'truck'});
describe('deterministic agronomy and logistics',()=>{
  it('recalculates the range after a spoken area correction',()=>{const first={...fullDraft(),area:5};expect(estimate(first)?.min).toBe(6.1);const correction=mockProposal('Paanch nahi, chhe acre',first);expect(correction.patch.area).toBe(6);expect(estimate({...first,...correction.patch})).toMatchObject({min:7.3,max:10.9});});
  it('keeps original units and does not invent an estimate from missing data',()=>{expect(estimate(emptyDraft())).toBeNull();expect(estimate({...fullDraft(),unit:'hectare'})).toMatchObject({min:18,max:27});});
  it('rejects invented location and economics in AI proposals',()=>{expect(ProposalSchema.safeParse({patch:{locationId:'sangrur-east'},reply:'Hi'}).success).toBe(false);expect(ProposalSchema.safeParse({patch:{price:2000},reply:'Hi'}).success).toBe(false);});
  it('validates dates and requires a separately confirmed location',()=>{expect(draftIssues({...fullDraft(),locationId:null})).toContain('Missing locationId');expect(draftIssues({...fullDraft(),deadline:addDays(indiaToday(),-1)})).toContain('Clearing deadline must be on or after availability');});
  it('builds a presentation plan for short windows, transfer access and larger fields',()=>{expect(collectionOptions(fullDraft())).toHaveLength(2);expect(collectionOptions({...fullDraft(),deadline:indiaToday()})[0].date).toBe(indiaToday());expect(collectionOptions({...fullDraft(),access:'restricted'})[0].truck).toContain('Tractor transfer');const large={...fullDraft(),area:100};expect(collectionOptions(large)[0].capacity).toBeGreaterThanOrEqual(estimate(large)!.max);expect(collectionOptions({...fullDraft(),deadline:addDays(indiaToday(),-1)})).toHaveLength(0);});
  it('makes every rupee traceable',()=>{for(const o of collectionOptions(fullDraft())){expect(o.total).toBe(o.purchase+o.baling+o.loading+o.transport);expect(o.payment).toBe(o.purchase);expect(o.perTonne).toBe(Math.round(o.total/o.tonnes));}});
  it('rejects forged and oversized audio',()=>{expect(()=>validateWav(Buffer.alloc(200))).toThrow();expect(()=>validateWav(Buffer.alloc(900000))).toThrow();});
});
