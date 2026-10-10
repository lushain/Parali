import {describe,it,expect,vi,afterEach} from 'vitest';
import {nextReply} from '../server/conversation';
import {emptyDraft,indiaToday,addDays} from '../shared/domain';
import {TranscriptSegments,pcm16,audioEvent} from '../src/streaming';
import {EventStreamCodec} from '@smithy/core/event-streams';
import {fromUtf8,toUtf8} from '@smithy/core/serde';
import {signStream} from '../server/stream-signing';
import * as signing from '../server/stream-signing';
import {DemoService} from '../server/service';
import type {Stored,Store} from '../server/store';
class Memory implements Store {
 rows=new Map<string,Stored>();
 async get(id:string){return structuredClone(this.rows.get(id));}
 async save(row:Stored,version:number|null){if((this.rows.get(row.id)?.version??null)!==version)return false;this.rows.set(row.id,structuredClone(row));return true;}
}
afterEach(()=>vi.restoreAllMocks());
describe('Hindi conversation grounded in saved facts',()=>{
 it('acknowledges three acres and asks village even if model asks area again',()=>{
  const before={...emptyDraft(),crop:'wheat' as const};
  const reply=nextReply(before,{...before,area:3,unit:'acre'},'area');
  expect(reply).toContain('3 एकड़ गेहूँ');expect(reply).toContain('गाँव');expect(reply).not.toContain('कितनी');
 });
 it('acknowledges corrections without losing crop or repeating known fields',()=>{
  const before={...emptyDraft(),crop:'paddy' as const,area:5,unit:'acre' as const,village:'संगरूर'};
  expect(nextReply(before,{...before,area:6})).toBe('ठीक है, 6 एकड़ धान दर्ज कर लिया। पराली उठाने के लिए किस तारीख से तैयार होगी?');
 });
 it('clarifies unsupported units and inconsistent dates',()=>{
  expect(nextReply(emptyDraft(),{...emptyDraft(),area:3},'unit')).toContain('बीघा');
  const d={...emptyDraft(),availableDate:addDays(indiaToday(),3),deadline:indiaToday()};
  expect(nextReply(d,d)).toContain('पहले');
 });
});
describe('live speech encoding',()=>{
 it('replaces partials, accepts each final segment once and excludes unfinished text',()=>{
  const s=new TranscriptSegments();
  const r=(text:string,partial:boolean,id='one')=>({ResultId:id,IsPartial:partial,Alternatives:[{Transcript:text}]});
  s.update([r('तीन',true)]);expect(s.text()).toBe('');
  expect(s.update([r('तीन एकड़',false)])).toBe('तीन एकड़');
  s.update([r('wrong revision',true),r('गेहूँ',true,'two')]);expect(s.text()).toBe('तीन एकड़');
  s.update([r('गेहूँ',false,'two')]);expect(s.text()).toBe('तीन एकड़ गेहूँ');
 });
 it('encodes signed PCM and an AWS event-stream end marker with valid checksums',()=>{
  const samples=pcm16(new Float32Array([-1,0,1]),16000),v=new DataView(samples.buffer);
  expect([v.getInt16(0,true),v.getInt16(2,true),v.getInt16(4,true)]).toEqual([-32768,0,32767]);
  const codec=new EventStreamCodec(toUtf8,fromUtf8);expect(codec.decode(audioEvent(samples)).body).toEqual(samples);
  expect(codec.decode(audioEvent(new Uint8Array())).headers[':event-type'].value).toBe('AudioEvent');
 });
 it('signs a short-lived Hindi Mumbai capability without revealing the secret',async()=>{
  const url=await signStream({accessKeyId:'TESTKEY',secretAccessKey:'never-expose-this',sessionToken:'a=b'},'11111111-1111-4111-8111-111111111111',new Date('2026-10-10T10:00:00Z'),'ap-south-1');
  expect(url).not.toContain('never-expose-this');expect(url).toContain('X-Amz-Expires=60');expect(url).toContain('language-code=hi-IN');expect(url).toContain('X-Amz-Security-Token=a%3Db');expect(new URL(url).host).toBe('transcribestreaming.ap-south-1.amazonaws.com:8443');
 });
});
describe('stream session authorization',()=>{
 it('isolates farmer streams, deduplicates completion and rejects changed transcripts',async()=>{
  vi.spyOn(signing,'streamUrl').mockResolvedValue('wss://test.invalid');
  const api=new DemoService(new Memory(),'aws'),c=await api.create(),other=await api.create();
  await expect(api.streamStart(c.session.id,c.tokens.buyer,{epoch:1})).rejects.toMatchObject({status:403});
  const job=await api.streamStart(c.session.id,c.tokens.farmer,{epoch:1});
  await expect(api.streamStart(c.session.id,c.tokens.farmer,{epoch:1})).rejects.toMatchObject({status:409});
  const data={jobId:job.jobId,epoch:1,transcript:'तीन एकड़'};
  await expect(api.streamComplete(c.session.id,other.tokens.farmer,data)).rejects.toMatchObject({status:403});
  await api.streamComplete(c.session.id,c.tokens.farmer,data);await api.streamComplete(c.session.id,c.tokens.farmer,data);
  expect((await api.read(c.session.id,c.tokens.farmer)).evidence).toHaveLength(1);
  await expect(api.streamComplete(c.session.id,c.tokens.farmer,{...data,transcript:'छह एकड़'})).rejects.toMatchObject({status:409});
 });
 it('releases a cancelled stream for immediate retry without widening role access',async()=>{
  vi.spyOn(signing,'streamUrl').mockResolvedValue('wss://test.invalid');
  const api=new DemoService(new Memory(),'aws'),c=await api.create();
  const job=await api.streamStart(c.session.id,c.tokens.farmer,{epoch:1});
  await expect(api.streamCancel(c.session.id,c.tokens.buyer,{jobId:job.jobId,epoch:1})).rejects.toMatchObject({status:403});
  await api.streamCancel(c.session.id,c.tokens.farmer,{jobId:job.jobId,epoch:1});
  await expect(api.streamComplete(c.session.id,c.tokens.farmer,{jobId:job.jobId,epoch:1,transcript:'तीन'})).rejects.toMatchObject({status:409});
  expect((await api.streamStart(c.session.id,c.tokens.farmer,{epoch:1})).jobId).not.toBe(job.jobId);
 });
 it('rejects expired streams and old epochs',async()=>{
  vi.spyOn(signing,'streamUrl').mockResolvedValue('wss://test.invalid');
  const store=new Memory(),api=new DemoService(store,'aws'),c=await api.create();
  const job=await api.streamStart(c.session.id,c.tokens.farmer,{epoch:1});
  const data={jobId:job.jobId,epoch:1,transcript:'तीन एकड़'};
  await expect(api.streamComplete(c.session.id,c.tokens.farmer,{...data,epoch:2})).rejects.toMatchObject({status:409});
  store.rows.get(c.session.id)!.jobs[0].createdAt-=91000;
  await expect(api.streamComplete(c.session.id,c.tokens.farmer,data)).rejects.toMatchObject({status:409});
 });
});

