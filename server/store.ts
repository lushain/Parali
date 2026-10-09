import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { emptyDraft, type Role, type Session } from '../shared/domain.js';
import type { ComputeJob } from './compute.js';

export class AppError extends Error { constructor(public status:number,message:string){super(message);} }
export type SpeechJob = { name:string; key:string; epoch:number; createdAt:number; mode?:'stream'; transcript?:string; used?:boolean; failed?:boolean };
export type Stored = Session & { grants:Record<Role,string>; snapshot?:Session; jobs:SpeechJob[]; computeJob?:ComputeJob; sonicLease?:{id:string;epoch:number;expiresAt:number;version:number;userTurn?:string};sonicStarts?:number[];fieldPreview?:{id:string;epoch:number;draft:string;expiresAt:number;afterUserKey?:string} };
export const hash = (s:string) => createHash('sha256').update(s).digest('hex');
export interface Store { get(id:string):Promise<Stored|undefined>; save(value:Stored, expected:number|null):Promise<boolean>; }
export class FileStore implements Store {
  private queue:Promise<unknown> = Promise.resolve();
  constructor(private dir='.local/sessions'){}
  async get(id:string) { if(!/^[a-f0-9-]{36}$/.test(id)) return undefined; try{return JSON.parse(await readFile(`${this.dir}/${id}.json`,'utf8')) as Stored;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;} }
  async save(value:Stored,expected:number|null) {
    const task=this.queue.then(async()=>{const current=await this.get(value.id);if((current?.version??null)!==expected)return false;await mkdir(this.dir,{recursive:true});const dest=`${this.dir}/${value.id}.json`;const temp=dest+'.tmp';await writeFile(temp,JSON.stringify(value),'utf8');await rename(temp,dest);return true;});
    this.queue=task.catch(()=>{}); return task;
  }
}
export class DynamoStore implements Store {
  private db=DynamoDBDocumentClient.from(new DynamoDBClient({region:process.env.AWS_REGION||'ap-south-1'}),{marshallOptions:{removeUndefinedValues:true}});
  constructor(private table:string){}
  async get(id:string){return (await this.db.send(new GetCommand({TableName:this.table,Key:{id},ConsistentRead:true}))).Item as Stored|undefined;}
  async listForCleanup(){const r=await this.db.send(new ScanCommand({TableName:this.table,Limit:100}));return (r.Items||[]) as Stored[];}
  async save(value:Stored,expected:number|null){try{await this.db.send(new PutCommand({TableName:this.table,Item:value,ConditionExpression:expected===null?'attribute_not_exists(id)':'#v = :v',...(expected===null?{}:{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':expected}})}));return true;}catch(e){if((e as Error).name==='ConditionalCheckFailedException')return false;throw e;}}
}
export function newSession(){
  const tokens={farmer:randomBytes(32).toString('base64url'),buyer:randomBytes(32).toString('base64url')};
  const now=Date.now(); const session:Stored={id:randomUUID(),label:'FIELD-'+randomBytes(2).toString('hex').toUpperCase(),version:1,epoch:1,expiresAt:Math.floor(now/1000)+7*86400,draft:emptyDraft(),messages:[],events:[],evidence:[],processed:[],aiCalls:0,aiWindow:now,aiTotal:0,jobs:[],grants:{farmer:hash(tokens.farmer),buyer:hash(tokens.buyer)}};
  return {session,tokens};
}
export async function authorize(store:Store,id:string,token:string,allowed:Role[]){const session=await store.get(id);if(!session||session.expiresAt<Date.now()/1000)throw new AppError(404,'Session not found or expired');const role=allowed.find(r=>session.grants[r]===hash(token));if(!role)throw new AppError(403,'This access does not allow this action');return {session,role};}
