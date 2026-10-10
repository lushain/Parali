import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { ProposalSchema, indiaToday, type Draft, type Message } from '../shared/domain.js';
import { AppError } from './store.js';

// Private S3 mailbox: the EC2 worker needs no inbound port or public model endpoint.
const s3 = new S3Client({region:process.env.AWS_REGION||'ap-south-1',maxAttempts:2});
const bucket = () => process.env.AUDIO_BUCKET||'';
export const usesCompute = () => process.env.LLM_BACKEND==='ec2';
export type ComputeJob = {id:string;key:string;epoch:number;version:number;createdAt:number;text:string;speechId?:string};
export function newComputeJob(key:string,epoch:number,version:number,text:string,speechId?:string):ComputeJob {
  return {id:randomUUID(),key,epoch,version,createdAt:Date.now(),text,...(speechId?{speechId}:{})};
}
export async function enqueue(job:ComputeJob,draft:Draft,messages:Message[]) {
  if(!bucket())throw new AppError(503,'Private inference storage is not configured.');
  const payload={id:job.id,expiresAt:job.createdAt+300000,today:indiaToday(),draft,history:messages.slice(-6).map(({role,text})=>({role,text})),text:job.text};
  await s3.send(new PutObjectCommand({Bucket:bucket(),Key:`llm/requests/${job.id}.json`,Body:JSON.stringify(payload),ContentType:'application/json',ServerSideEncryption:'AES256'}));
}
export async function poll(job:ComputeJob) {
  if(Date.now()-job.createdAt>300000)throw new AppError(408,'AWS model timed out. Your draft is unchanged; please retry.');
  let response;
  try { response=await s3.send(new GetObjectCommand({Bucket:bucket(),Key:`llm/results/${job.id}.json`})); }
  catch(e) {if((e as {name:string}).name==='NoSuchKey')return null;throw e;}
  if((response.ContentLength||0)>20000)throw new AppError(502,'AWS model response exceeded the allowed size.');
  const result=JSON.parse(await response.Body!.transformToString());
  if(result.id!==job.id||result.model!=='qwen3:8b'||result.error)throw new AppError(502,'AWS compute inference failed. Your draft is safe; please retry.');
  const parsed=ProposalSchema.safeParse(result.proposal);
  if(!parsed.success)throw new AppError(502,'AI proposal failed validation. Your draft is safe; please retry.');
  return {...parsed.data,evidence:{service:'Amazon EC2 · Qwen3',requestId:job.id,detail:`qwen3:8b · ${process.env.AWS_REGION||'ap-south-1'} · private job; ${result.seconds}s`,at:new Date().toISOString()}};
}
export async function cleanup(job:ComputeJob) {
  await Promise.allSettled(['requests','results'].map(prefix=>s3.send(new DeleteObjectCommand({Bucket:bucket(),Key:`llm/${prefix}/${job.id}.json`}))));
}
export async function readiness() {
  try {
    const r=await s3.send(new GetObjectCommand({Bucket:bucket(),Key:'llm/status/worker.json'}));
    const status=JSON.parse(await r.Body!.transformToString());
    const ok=status.ready!==false&&status.model==='qwen3:8b'&&Date.now()-status.at<60000&&status.at<=Date.now()+10000;
    return {name:'EC2 Qwen worker',ok,detail:ok?'Recent worker heartbeat (not a conversation test)':'Worker heartbeat expired; start the bounded demo worker'};
  }catch{return {name:'EC2 Qwen worker',ok:false,detail:'Worker not ready or private mailbox inaccessible'};}
}
