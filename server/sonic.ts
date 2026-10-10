import {showField,confirmField,fieldInstruction} from './field-location.js';
import {randomUUID} from 'node:crypto';
import {STSClient,AssumeRoleCommand} from '@aws-sdk/client-sts';
import {z} from 'zod';
import {DraftSchema,estimate,indiaToday} from '../shared/domain.js';
import {AppError,authorize} from './store.js';
import {groundedPatch} from './grounding.js';
import type {DemoService} from './service.js';

export const sonicEnabled=()=>process.env.VOICE_BACKEND==='sonic';
export const sonicRegion=()=>process.env.SONIC_REGION||'ap-northeast-1';
export const sonicModel=()=>process.env.SONIC_MODEL_ID||'amazon.nova-2-5-sonic';
export const sonicConnectionLimit=()=>z.coerce.number().int().min(1).max(600).default(60).parse(process.env.SONIC_CONNECTIONS_PER_HOUR);
const connectionWindowMs=3600000;
export async function sonicCredentials(sessionId:string){
 const r=await new STSClient({region:process.env.AWS_REGION||'ap-south-1'}).send(new AssumeRoleCommand({
  RoleArn:process.env.SONIC_ROLE_ARN,RoleSessionName:'parali-'+sessionId.slice(0,8),DurationSeconds:900,
  Policy:JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Action:'bedrock:InvokeModel',Resource:`arn:aws:bedrock:${sonicRegion()}::foundation-model/${sonicModel()}`}]}),
 }));
 const c=r.Credentials;if(!c?.AccessKeyId||!c.SecretAccessKey||!c.SessionToken||!c.Expiration)throw new Error('Temporary voice credentials unavailable');
 return {accessKeyId:c.AccessKeyId,secretAccessKey:c.SecretAccessKey,sessionToken:c.SessionToken,expiration:c.Expiration.toISOString()};
}
export async function startSonic(api:DemoService,id:string,token:string,input:unknown){
 const a=z.object({epoch:z.number().int()}).strict().parse(input);
 const {session:s}=await authorize(api.store,id,token,['farmer']);
 if(!sonicEnabled()||api.provider!=='aws')throw new AppError(503,'Real-time voice is not configured.');
 if(s.epoch!==a.epoch||s.request)throw new AppError(409,'Draft no longer editable.');
 const now=Date.now();const recent=(s.sonicStarts||[]).filter(t=>now-t<connectionWindowMs);
 if(s.sonicLease?.epoch===s.epoch&&s.sonicLease.expiresAt>now)throw new AppError(409,'A voice conversation is already open. End it before starting another.');
 const limit=sonicConnectionLimit();
 if(recent.length>=limit)throw new AppError(429,`Voice connection limit reached: ${limit} starts per hour. Please try again after an earlier connection leaves the hourly window.`);
 // Reserve the one active conversation, but count only a successfully issued grant.
 // Direct Sonic calls have their own allowance, separate from legacy speech jobs.
 const lease={id:randomUUID(),epoch:s.epoch,expiresAt:now+180000,version:s.version+1};
 s.sonicLease=lease;await api.commit(s,s.version);
 try{
  const credentials=await sonicCredentials(id);
  const fresh=await api.store.get(id);
  if(!fresh||fresh.sonicLease?.id!==lease.id||fresh.epoch!==a.epoch||fresh.request||fresh.version!==lease.version)throw new AppError(409,'Field details changed while connecting. Please start voice again.');
  const grantedAt=Date.now();fresh.sonicStarts=[...(fresh.sonicStarts||[]).filter(t=>grantedAt-t<connectionWindowMs),grantedAt];
  fresh.sonicLease.version=fresh.version+1;await api.commit(fresh,fresh.version);
  return {leaseId:lease.id,credentials,region:sonicRegion(),modelId:sonicModel(),voice:'kiara',maxSeconds:180,today:indiaToday(),session:api.view(fresh,'farmer')};
 }catch(e){const fresh=await api.store.get(id);if(fresh?.sonicLease?.id===lease.id){delete fresh.sonicLease;await api.commit(fresh,fresh.version);}throw e;}
}
const SyncSchema=z.object({leaseId:z.string().uuid(),epoch:z.number().int(),key:z.string().max(150).min(1),kind:z.enum(['user','assistant','tool','end','map-open','map-confirm']),previewId:z.string().uuid().optional(),text:z.string().max(2000).optional(),patch:DraftSchema.omit({locationId:true}).partial().strict().optional()}).strict();
export async function syncSonic(api:DemoService,id:string,token:string,input:unknown){
 const a=SyncSchema.parse(input),{session:s}=await authorize(api.store,id,token,['farmer']);
 const lease=s.sonicLease;
 if(!lease||lease.id!==a.leaseId||lease.epoch!==s.epoch||a.epoch!==s.epoch)throw new AppError(409,'This voice conversation has ended or was reset.');
 if(a.kind==='end'){delete s.sonicLease;await api.commit(s,s.version);return {session:api.view(s,'farmer')};}
 if((s.request&&a.kind!=='assistant')||lease.expiresAt<Date.now())throw new AppError(409,'Voice session expired or draft was published.');
 if(s.processed.includes(a.key))return {session:api.view(s,'farmer'),draft:s.draft,estimate:estimate(s.draft)};
 if(lease.version!==s.version)throw new AppError(409,'Field details changed elsewhere. Reconnect voice to use the latest details.');
 if(a.kind==='map-open'){showField(s);}else if(a.kind==='map-confirm'){if(!a.text)throw new AppError(400,'A spoken confirmation is required.');confirmField(s,a.previewId,a.text);}else if(a.kind==='tool'){
  if(!a.text?.trim()||!a.patch)throw new AppError(400,'A field update needs the farmer transcript and changed fields.');
  const patch=groundedPatch(a.patch,a.text,s.messages,s.draft);const village=s.draft.village;
  s.draft=DraftSchema.parse({...s.draft,...patch});if(village!==s.draft.village)s.draft.locationId=null;
 }else{
  if(!a.text?.trim())throw new AppError(400,'Empty transcript.');if(a.kind==='user')lease.userTurn=a.key;
  s.messages.push({role:a.kind==='user'?'user':'assistant',text:a.text,source:a.kind==='user'?'aws-voice':'aws',at:new Date().toISOString()});s.messages=s.messages.slice(-30);
 }
 if(!s.evidence.some(e=>e.requestId===lease.id))s.evidence.push({service:'Amazon Nova 2.5 Sonic',requestId:lease.id,at:new Date().toISOString(),detail:'Browser-reported direct AWS speech session; application lease ID, not an AWS request ID. Tool facts validated by server; publication requires explicit confirmation of the displayed map.'});
 s.processed.push(a.key);lease.version=s.version+1;await api.commit(s,s.version);
 return {session:api.view(s,'farmer'),draft:s.draft,estimate:estimate(s.draft),instruction:fieldInstruction(s)};
}
