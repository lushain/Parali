import {showField,confirmField} from './field-location.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DraftSchema, draftIssues, collectionOptions, emptyDraft, type Session, type Role, type SessionView, type Event, type Evidence } from '../shared/domain.js';
import { AppError, authorize, newSession, type Store, type Stored } from './store.js';
import { mockProposal } from './mock.js';
import * as aws from './aws.js';
import * as compute from './compute.js';
import { nextReply } from './conversation.js';
import { streamUrl } from './stream-signing.js';
import {groundedPatch} from './grounding.js';
import {sonicEnabled,sonicModel} from './sonic.js';

const ActionSchema=z.object({action:z.enum(['edit','publish','offer','accept','plan','cancel','recover','complete','reset','restore','ping','map-open','map-confirm','map-cancel']),key:z.string().uuid(),epoch:z.number().int(),version:z.number().int(),previewId:z.string().uuid().optional(),draft:DraftSchema.optional(),optionId:z.enum(['standard','backup']).optional()}).strict();
const TurnSchema=z.object({text:z.string().trim().min(1).max(2000).optional(),jobId:z.string().max(100).optional(),key:z.string().uuid(),epoch:z.number().int(),version:z.number().int()}).strict().refine(x=>Boolean(x.text)!==Boolean(x.jobId),'Supply text or a completed speech job');
const permissions:Record<z.infer<typeof ActionSchema>['action'],Role[]>={'map-cancel':['farmer'],'map-open':['farmer'],'map-confirm':['farmer'],edit:['farmer'],publish:['farmer'],offer:['buyer'],accept:['farmer'],plan:['buyer'],cancel:['buyer'],recover:['buyer'],complete:['buyer'],reset:['farmer'],restore:['farmer'],ping:['farmer','buyer']};
export class DemoService {
  constructor(public store:Store,public provider:'mock'|'aws'='mock'){}
  view(s:Stored,role:Role):SessionView{
    const {grants:_,snapshot:__,jobs:___,processed:____,aiCalls:_____,aiWindow:______,aiTotal:_______,computeJob:________,sonicLease:_________,sonicStarts:__________,fieldPreview:___________,...v}=s;
    // Buyers see only published request details, never the private intake conversation.
    if(role==='buyer'){v.messages=[];v.draft=v.request?.draft??emptyDraft();}
    return {...v,...(role==='farmer'&&s.fieldPreview?{locationPreview:{id:s.fieldPreview.id,expiresAt:s.fieldPreview.expiresAt}}:{}),provider:this.provider,region:aws.config.region,model:sonicEnabled()?sonicModel():compute.usesCompute()?'EC2 · qwen3:8b':aws.config.model,voice:sonicEnabled()?'Kiara · Nova 2.5 Sonic':aws.config.voice,voiceMode:sonicEnabled()?'sonic':'transcribe'};
  }
  async create(){const {session,tokens}=newSession();await this.store.save(session,null);return {session:this.view(session,'farmer'),tokens};}
  async read(id:string,token:string){const {session,role}=await authorize(this.store,id,token,['farmer','buyer']);return this.view(session,role);}
  event(s:Stored,text:string,kind:Event['kind']='user'){s.events.push({id:randomUUID(),at:new Date().toISOString(),text,kind});s.events=s.events.slice(-60);}
  async commit(s:Stored,expected:number){s.version=expected+1;s.evidence=s.evidence.slice(-30);s.processed=s.processed.slice(-120);if(!await this.store.save(s,expected))throw new AppError(409,'Session changed. Refresh the latest state and retry.');}
  async action(id:string,token:string,input:unknown){
    const a=ActionSchema.parse(input);const {session:s,role}=await authorize(this.store,id,token,permissions[a.action]);
    if(s.epoch!==a.epoch)throw new AppError(409,'This request was reset. Refresh before continuing.');
    if(s.processed.includes(a.key))return this.view(s,role);
    if(s.version!==a.version)throw new AppError(409,'A newer session update arrived. Review it and try again.');
    const expected=s.version;const r=s.request;
    const requireStatus=(...allowed:string[])=>{if(!r||!allowed.includes(r.status))throw new AppError(409,'This action is not available in the current state.');};
    switch(a.action){
      case 'map-cancel': delete s.fieldPreview;break;
      case 'map-open': showField(s);break;
      case 'map-confirm': confirmField(s,a.previewId);break;
      case 'edit': if(r)throw new AppError(409,'Published requests are locked. Start a new request to edit the field.');{const next=DraftSchema.parse(a.draft);if(next.village!==s.draft.village&&next.locationId===s.draft.locationId)next.locationId=null;s.draft=next;}break;
      case 'publish': if(r)break;{const errors=draftIssues(s.draft);if(errors.length)throw new AppError(400,errors.join('; '));s.request={id:'PR-'+randomUUID().slice(0,8).toUpperCase(),status:'open',draft:structuredClone(s.draft),createdAt:new Date().toISOString()};this.event(s,`${s.request.id} · Farmer confirmed and published the request`);}break;
      case 'offer': if(r?.status==='offered')break;requireStatus('open');{const option=collectionOptions(r!.draft).find(o=>o.id===a.optionId);if(!option)throw new AppError(400,'Complete the field details before sending a collection offer.');r!.offer={id:'OF-'+randomUUID().slice(0,8),option,revision:1};r!.status='offered';this.event(s,'Buyer sent a collection offer');}break;
      case 'accept': if(r?.status==='accepted'||r?.status==='planned')break;requireStatus('offered');r!.offer!.acceptedAt=new Date().toISOString();r!.status='accepted';this.event(s,'Farmer accepted the displayed date and terms');break;
      case 'plan': if(r?.status==='planned')break;requireStatus('accepted');r!.status='planned';this.event(s,'Buyer confirmed the collection plan');break;
      case 'cancel': if(r?.status==='attention')break;requireStatus('planned','accepted');if(r!.offer!.option.id==='backup')throw new AppError(400,'Recovery option is already active.');r!.status='attention';this.event(s,'Baler B-12 is unavailable. Replacement collection requested.','simulation');break;
      case 'recover': if(r?.status==='planned'&&r.offer?.option.id==='backup')break;requireStatus('attention');{const backup=collectionOptions(r!.draft).find(o=>o.id==='backup');if(!backup)throw new AppError(400,'No seeded recovery meets this deadline. No replacement is promised.');const previous=r!.offer!.option;/* Buyer absorbs extra logistics cost; retain the farmer-approved date and payment. */if(backup.date>previous.date){r!.offer={id:'OF-'+randomUUID().slice(0,8),revision:r!.offer!.revision+1,option:backup};r!.status='offered';this.event(s,'Buyer proposed a replacement date; farmer approval required');}else{r!.offer!.option=backup;r!.offer!.revision++;r!.status='planned';this.event(s,'Buyer confirmed a feasible replacement');}}break;
      case 'complete': if(r?.status==='complete')break;requireStatus('planned');r!.status='complete';this.event(s,'Collection completed. Farmer receipt is ready.','simulation');break;
      case 'reset': {const {grants:_,snapshot:__,jobs:___,...snapshot}=s;s.snapshot=structuredClone(snapshot);s.epoch++;s.draft=emptyDraft();delete s.request;delete s.sonicLease;delete s.fieldPreview;s.messages=[];s.events=[];s.evidence=[];s.processed=[];this.event(s,'Farmer reset this request. Previous details saved.','system');}break;
      case 'restore': if(!s.snapshot)throw new AppError(400,'No saved scene to restore.');{const old=structuredClone(s.snapshot);s.draft=old.draft;s.request=old.request;s.messages=old.messages;s.events=old.events;s.evidence=old.evidence;s.epoch++;delete s.sonicLease;delete s.fieldPreview;s.processed=[];this.event(s,'Farmer restored the previous request','system');}break;
      case 'ping':this.event(s,`Synchronization check received from ${role}`,'system');break;
    }
    s.processed.push(a.key);await this.commit(s,expected);return this.view(s,role);
  }
  async reserveAi(s:Stored){if(Date.now()-s.aiWindow>3600000){s.aiWindow=Date.now();s.aiCalls=0;}if(s.aiCalls>=60||(s.aiTotal||0)>=180)throw new AppError(429,'Voice usage limit reached: 60 operations per hour and 180 per session.');s.aiCalls++;s.aiTotal=(s.aiTotal||0)+1;await this.commit(s,s.version);}
  async turn(id:string,token:string,input:unknown){
    const a=TurnSchema.parse(input);let {session:s}=await authorize(this.store,id,token,['farmer']);
    if(s.epoch!==a.epoch||s.request)throw new AppError(409,'Draft no longer editable.');if(s.processed.includes(a.key))return {session:this.view(s,'farmer')};
    if(s.computeJob?.key===a.key && s.computeJob.epoch===s.epoch && s.computeJob.version===s.version && Date.now()-s.computeJob.createdAt<300000)return {session:this.view(s,'farmer'),jobId:s.computeJob.id};
    if(s.version!==a.version)throw new AppError(409,'Draft changed. Review current fields and retry.');
    const job=a.jobId?s.jobs.find(j=>j.name===a.jobId&&j.epoch===s.epoch):undefined;
    if(a.jobId&&(!job?.transcript||job.used))throw new AppError(400,'Speech job is not ready or was already used.');
    if(this.provider==='aws'&&compute.usesCompute()&&s.computeJob&&s.computeJob.epoch===s.epoch&&s.computeJob.version===s.version&&Date.now()-s.computeJob.createdAt<300000){
      if(s.computeJob.key===a.key)return {session:this.view(s,'farmer'),jobId:s.computeJob.id};
      throw new AppError(409,'A model response is already pending. Wait for it before sending another turn.');
    }
    const text=a.text||job!.transcript!;await this.reserveAi(s);const expected=s.version;
    if(this.provider==='aws'&&compute.usesCompute()){
      if(s.computeJob)await compute.cleanup(s.computeJob);
      const queued=compute.newComputeJob(a.key,s.epoch,s.version+1,text,job?.name);s.computeJob=queued;await this.commit(s,s.version);
      try{await compute.enqueue(queued,s.draft,s.messages);}catch(e){const fresh=await this.store.get(id);if(fresh?.computeJob?.id===queued.id){delete fresh.computeJob;await this.commit(fresh,fresh.version);}throw e;}
      return {session:this.view(s,'farmer'),jobId:queued.id};
    }
    const proposal=this.provider==='aws'?await aws.understand(text,s.draft,s.messages):mockProposal(text,s.draft);
    const before=s.draft;const previousVillage=s.draft.village;
    s.draft=DraftSchema.parse({...s.draft,...(this.provider==='aws'?groundedPatch(proposal.patch,text,s.messages,s.draft):proposal.patch)});
    const reply=this.provider==='aws'?nextReply(before,s.draft,'clarify' in proposal?proposal.clarify:undefined):proposal.reply!;
    if(s.draft.village!==previousVillage)s.draft.locationId=null;
    const now=new Date().toISOString();
    s.messages.push({role:'user',text,source:job?'aws-voice':'typed',at:now},{role:'assistant',text:reply,source:this.provider,at:now});s.messages=s.messages.slice(-30);
    if('evidence' in proposal)s.evidence.push(proposal.evidence as Evidence);if(job)job.used=true;s.processed.push(a.key);
    await this.commit(s,expected);return {session:this.view(s,'farmer'),reply};
  }
  async turnStatus(id:string,token:string,jobId:string){
    const {session:s}=await authorize(this.store,id,token,['farmer']);
    const job=s.computeJob;
    if(!job||job.id!==jobId||job.epoch!==s.epoch)throw new AppError(404,'Model job not found in this scene.');
    if(s.processed.includes(job.key))return {status:'complete',session:this.view(s,'farmer')};
    if(s.request||job.version!==s.version){await compute.cleanup(job);throw new AppError(409,'Draft changed while the model was thinking. Review current fields and retry.');}
    let proposal;
    try{proposal=await compute.poll(job);}catch(e){await compute.cleanup(job);delete s.computeJob;await this.commit(s,s.version);throw e;}
    if(!proposal)return {status:'pending',session:this.view(s,'farmer')};
    const before=s.draft;const previousVillage=s.draft.village;s.draft=DraftSchema.parse({...s.draft,...groundedPatch(proposal.patch,job.text,s.messages,s.draft)});
    const reply=nextReply(before,s.draft,proposal.clarify);
    if(s.draft.village!==previousVillage)s.draft.locationId=null;
    const speech=job.speechId?s.jobs.find(j=>j.name===job.speechId&&j.epoch===s.epoch&&!j.used):undefined;
    if(job.speechId&&!speech)throw new AppError(409,'Speech was already consumed or the scene changed.');
    const now=new Date().toISOString();s.messages.push({role:'user',text:job.text,source:speech?'aws-voice':'typed',at:now},{role:'assistant',text:reply,source:'aws',at:now});s.messages=s.messages.slice(-30);
    if(speech)speech.used=true;s.evidence.push(proposal.evidence);s.processed.push(job.key);
    await this.commit(s,s.version);await compute.cleanup(job);
    return {status:'complete',session:this.view(s,'farmer'),reply};
  }
  async streamStart(id:string,token:string,input:unknown){
    if(this.provider!=='aws')throw new AppError(503,'Live AWS streaming is not configured.');
    const a=z.object({epoch:z.number().int()}).strict().parse(input);
    const {session:s}=await authorize(this.store,id,token,['farmer']);
    if(s.epoch!==a.epoch||s.request)throw new AppError(409,'Draft no longer editable.');
    if(s.jobs.some(j=>j.mode==='stream'&&!j.used&&!j.failed&&!j.transcript&&j.epoch===s.epoch&&Date.now()-j.createdAt<45000))throw new AppError(409,'A microphone stream is already open. Wait a moment before retrying.');
    await this.reserveAi(s);
    const job={name:randomUUID(),key:'',epoch:s.epoch,createdAt:Date.now(),mode:'stream' as const};
    const url=await streamUrl(job.name);s.jobs.push(job);await this.commit(s,s.version);
    return {jobId:job.name,url,expiresIn:60,maxSeconds:20};
  }
  async streamComplete(id:string,token:string,input:unknown){
    const a=z.object({jobId:z.string().uuid(),transcript:z.string().trim().min(1).max(2000),epoch:z.number().int()}).strict().parse(input);
    const {session:s}=await authorize(this.store,id,token,['farmer']);
    const job=s.jobs.find(j=>j.name===a.jobId&&j.mode==='stream'&&j.epoch===s.epoch);
    if(!job||a.epoch!==s.epoch||s.request||job.used||job.failed||Date.now()-job.createdAt>90000)throw new AppError(409,'Microphone stream expired or the scene changed. Please record again.');
    if(job.transcript){if(job.transcript!==a.transcript)throw new AppError(409,'This stream already has a final transcript.');return {jobId:job.name};}
    job.transcript=a.transcript;
    // Direct AWS WebSocket results arrive in the browser; identify that provenance
    // honestly rather than claiming the server independently verified the audio.
    s.evidence.push({service:'Amazon Transcribe streaming',requestId:job.name,detail:'Hindi WebSocket final transcript received from farmer browser · '+aws.region,at:new Date().toISOString()});
    await this.commit(s,s.version);return {jobId:job.name};
  }
  async streamCancel(id:string,token:string,input:unknown){
    const a=z.object({jobId:z.string().uuid(),epoch:z.number().int()}).strict().parse(input);
    const {session:s}=await authorize(this.store,id,token,['farmer']);
    const job=s.jobs.find(j=>j.name===a.jobId&&j.mode==='stream'&&j.epoch===a.epoch&&j.epoch===s.epoch);
    if(job&&!job.transcript&&!job.used&&!job.failed){job.failed=true;await this.commit(s,s.version);}
    return {cancelled:true};
  }
  async speechStart(id:string,token:string,input:unknown){
    if(this.provider!=='aws')throw new AppError(503,'Live AWS voice is not configured. Typed local rehearsal is available.');
    const a=z.object({audio:z.string().max(950000),epoch:z.number().int()}).strict().parse(input);
    const {session:s}=await authorize(this.store,id,token,['farmer']);if(s.epoch!==a.epoch||s.request)throw new AppError(409,'Draft no longer editable.');
    const buffer=Buffer.from(a.audio,'base64');aws.validateWav(buffer);await this.reserveAi(s);
    if(s.jobs.some(j=>j.epoch===s.epoch&&!j.used&&!j.failed&&!j.transcript&&Date.now()-j.createdAt<5*60000))throw new AppError(409,'A transcription is already running. Wait or retry in five minutes.');
    const job={name:'parali-'+randomUUID(),key:`audio/${s.id}/${randomUUID()}.wav`,epoch:s.epoch,createdAt:Date.now()};s.jobs.push(job);await this.commit(s,s.version);
    try{const ev=await aws.startSpeech(job,buffer);const fresh=(await authorize(this.store,id,token,['farmer'])).session;if(fresh.epoch!==job.epoch){await aws.cleanupSpeech(job);throw new AppError(409,'Scene changed while uploading audio. Please record again.');}fresh.evidence.push(ev);await this.commit(fresh,fresh.version);return {jobId:job.name};}catch(e){const fresh=await this.store.get(id);if(fresh){const j=fresh.jobs.find(j=>j.name===job.name);if(j)j.failed=true;await this.commit(fresh,fresh.version);}throw e;}
  }
  async speechStatus(id:string,token:string,name:string){
    const {session:s}=await authorize(this.store,id,token,['farmer']);const job=s.jobs.find(j=>j.name===name&&j.epoch===s.epoch);if(!job)throw new AppError(404,'Speech job not found in this session');if(job.failed)throw new AppError(502,'Speech job failed. Record again.');if(job.transcript)return {status:'complete',transcript:job.transcript};
    let result:Awaited<ReturnType<typeof aws.pollSpeech>>;
    try{result=await aws.pollSpeech(job);}catch(e){job.failed=true;await this.commit(s,s.version);await aws.cleanupSpeech(job);throw e;}
    if(result.status==='complete'){job.transcript=result.transcript;s.evidence.push(result.evidence);await this.commit(s,s.version);await aws.cleanupSpeech(job);}return result;
  }
  async speechReply(id:string,token:string){
    if(this.provider!=='aws')throw new AppError(503,'No simulated speech playback is provided.');
    const {session:s}=await authorize(this.store,id,token,['farmer']);const reply=s.messages.filter(m=>m.role==='assistant').at(-1)?.text;if(!reply)throw new AppError(400,'No assistant reply to speak.');await this.reserveAi(s);const r=await aws.speak(reply);const fresh=(await authorize(this.store,id,token,['farmer'])).session;if(fresh.epoch!==s.epoch||fresh.messages.filter(m=>m.role==='assistant').at(-1)?.text!==reply)throw new AppError(409,'Scene changed while generating speech. Play the current reply instead.');fresh.evidence.push(r.evidence);await this.commit(fresh,fresh.version);return {audio:r.audio};
  }
}
