import { z } from 'zod';

export const RoleSchema = z.enum(['farmer', 'buyer']);
export type Role = z.infer<typeof RoleSchema>;
export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s, 'Use a valid calendar date');
export const DraftSchema = z.object({
  crop: z.enum(['paddy', 'wheat']).nullable(), area: z.number().positive().max(500).nullable(),
  unit: z.enum(['acre', 'hectare']).nullable(), village: z.string().trim().min(2).max(100).nullable(),
  locationId: z.enum(['sangrur-east', 'bhawanigarh', 'sunam']).nullable(),
  availableDate: DateSchema.nullable(), deadline: DateSchema.nullable(),
  access: z.enum(['truck', 'tractor', 'restricted']).nullable(),
}).strict();
export type Draft = z.infer<typeof DraftSchema>;
export const emptyDraft = (): Draft => ({ crop:null, area:null, unit:null, village:null, locationId:null, availableDate:null, deadline:null, access:null });
// LLM can propose facts only. Location is explicitly chosen by the farmer in the UI.
export const ProposalSchema = z.object({ patch: DraftSchema.omit({ locationId:true }).partial(), reply: z.string().min(1).max(450).optional(), clarify:z.enum(['none','crop','area','unit','village','availableDate','deadline','access']).optional() }).strict();
export const locations = [
  { id:'sangrur-east', name:'Kheri', detail:'Farmland · Sangrur district', x:49, y:43, distance:24 },
  { id:'bhawanigarh', name:'Bhawanigarh', detail:'Farmland · Sangrur district', x:76, y:32, distance:32 },
  { id:'sunam', name:'Sunam', detail:'Farmland · Sangrur district', x:43, y:75, distance:18 },
] as const;
// Rehearsal assumptions, not agronomic measurements: collectable dry t / hectare.
export const assumptions = { paddy:{min:3,max:4.5}, wheat:{min:2,max:3}, acreToHectare:0.40468564224, version:'demo-v1' };
export function estimate(d: Draft) {
  if (!d.crop || !d.area || !d.unit) return null;
  const hectares = d.area * (d.unit === 'acre' ? assumptions.acreToHectare : 1);
  return { min: Math.round(hectares*assumptions[d.crop].min*10)/10, max:Math.round(hectares*assumptions[d.crop].max*10)/10, hectares };
}
export function indiaToday() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
export function addDays(date: string, days: number) { return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10); }
export function draftIssues(d: Draft, today=indiaToday()) {
  const issues = Object.entries(d).filter(([,v]) => v===null).map(([k])=>`Missing ${k}`);
  if (d.availableDate && d.availableDate < today) issues.push('Availability must be today or later');
  if (d.deadline && d.availableDate && d.deadline < d.availableDate) issues.push('Clearing deadline must be on or after availability');
  if (d.deadline && d.deadline > addDays(today,90)) issues.push('Choose a clearing deadline within 90 days');
  return issues;
}
export const statusLabels = { draft:'Draft', open:'Open request', offered:'Offer received', accepted:'Accepted', planned:'Collection planned', complete:'Collection complete', attention:'Needs attention' };
export type Status = keyof typeof statusLabels;
export type Option = { id:string; name:string; baler:string; truck:string; date:string; distance:number; tonnes:number; purchase:number; baling:number; loading:number; transport:number; total:number; perTonne:number; payment:number; capacity:number; };
export type Offer = { id:string; option:Option; revision:number; acceptedAt?:string };
export type Event = { id:string; at:string; text:string; kind:'user'|'simulation'|'system'|'aws'; };
export type Message = { role:'user'|'assistant'; text:string; source:'typed'|'aws-voice'|'aws'|'mock'; at:string; };
export type Evidence = { service:string; requestId:string; at:string; detail:string };
export type DemoRequest = { id:string; status:Status; draft:Draft; offer?:Offer; createdAt:string; };
export type Session = { id:string; label:string; version:number; epoch:number; expiresAt:number; draft:Draft; request?:DemoRequest; messages:Message[]; events:Event[]; evidence:Evidence[]; processed:string[]; aiCalls:number; aiWindow:number; aiTotal:number; };
export type SessionView = Omit<Session,'processed'|'aiCalls'|'aiWindow'|'aiTotal'> & { provider:'mock'|'aws'; region:string; model:string; voice:string; voiceMode?:'sonic'|'transcribe';locationPreview?:{id:string;expiresAt:number}; };
export const seeds = [
  {id:'DEMO-101',name:'Bhullar farm',crop:'paddy',tonnes:4.8,x:60,y:48,distance:7},
  {id:'DEMO-102',name:'Kheri farm',crop:'paddy',tonnes:3.2,x:42,y:29,distance:5},
  {id:'DEMO-103',name:'Sunam farm',crop:'wheat',tonnes:5.6,x:32,y:68,distance:19},
] as const;
export function collectionOptions(d:Draft):Option[] {
  const e=estimate(d); if(!e || !d.availableDate || !d.deadline || !d.locationId || d.deadline<d.availableDate) return [];
  const distance=locations.find(l=>l.id===d.locationId)!.distance;
  const tonnes=Math.round((e.min+e.max)/2*10)/10;
  return [{id:'standard',name:'Shared collection',baler:'Baler B-12',truck:'Truck T-04',delay:2,capacity:15,premium:0}, {id:'backup',name:'Priority recovery',baler:'Baler B-27',truck:'Truck T-09',delay:3,capacity:18,premium:350}].flatMap(o=>{
    // The presentation fleet flexes to the farmer's window: short windows use
    // same-day pickup; larger fields use multiple vehicles rather than a dead end.
    const windowDays=Math.floor((Date.parse(d.deadline!)-Date.parse(d.availableDate!))/86400000);
    const date=addDays(d.availableDate!,Math.min(o.delay,windowDays));
    const vehicles=Math.max(1,Math.ceil(e.max/o.capacity));
    const purchase=Math.round(tonnes*1600), baling=Math.round(tonnes*(650+o.premium)), loading=Math.round(tonnes*180), transport=Math.round(distance*45+tonnes*(d.access==='tractor'?350:180));
    const total=purchase+baling+loading+transport;
    return [{...o,capacity:o.capacity*vehicles,truck:vehicles>1?`${vehicles} collection trucks`:d.access==='restricted'?'Tractor transfer + Truck T-04':o.truck,date,distance,tonnes,purchase,baling,loading,transport,total,perTonne:Math.round(total/tonnes),payment:purchase}];
  });
}
export function batchCandidates(d:Draft) { const e=estimate(d); if(!e || !d.locationId) return []; return seeds.filter(s=>s.crop===d.crop && s.distance<=10 && e.max+s.tonnes<=15); }
export const money = (n:number) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n);
export function prettyDate(s?:string|null) { return s ? new Date(s+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}) : 'Not set'; }
