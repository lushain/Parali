import { z } from 'zod';
import { AppError, hash } from './store.js';
import { DemoService } from './service.js';
import { checkAws } from './aws.js';
import {startSonic,syncSonic} from './sonic.js';
export type ApiInput={method:string;path:string;headers:Record<string,string|undefined>;body:string;};
export async function route(api:DemoService,req:ApiInput,setupKey:string){
  try{
    // ANY proxy routes can forward preflight to Lambda. The gateway adds the
    // configured exact-origin CORS headers; browsers still require a 2xx status.
    if(req.method==='OPTIONS')return {status:204,body:{}};
    if(req.body.length>1000000)throw new AppError(413,'Audio upload is too large. Please use a shorter recording.');
    const token=(req.headers.authorization||'').replace(/^Bearer /,'');let body:unknown={};try{body=req.body?JSON.parse(req.body):{};}catch{throw new AppError(400,'Invalid JSON');}
    if(req.path==='/api/health'&&req.method==='GET')return {status:200,body:{ok:true,provider:api.provider}};
    if(req.path==='/api/sessions'&&req.method==='POST'){if(!setupKey||hash(token)!==hash(setupKey))throw new AppError(403,'This maintenance operation is not available from the app.');return {status:201,body:await api.create()};}
    const m=req.path.match(/^\/api\/sessions\/([a-f0-9-]{36})(?:\/(action|turn|turn-status|speech|speech-status|stream|stream-complete|stream-cancel|reply|preflight|sonic-start|sonic-sync))?$/);if(!m)throw new AppError(404,'API route not found');const id=m[1],op=m[2];
    let result:unknown;
    if(req.method==='GET'&&!op)result=await api.read(id,token);
    else if(req.method==='POST'&&op==='sonic-start')result=await startSonic(api,id,token,body);
    else if(req.method==='POST'&&op==='sonic-sync')result=await syncSonic(api,id,token,body);
    else if(req.method==='POST'&&op==='action')result=await api.action(id,token,body);
    else if(req.method==='POST'&&op==='turn')result=await api.turn(id,token,body);
    else if(req.method==='POST'&&op==='turn-status')result=await api.turnStatus(id,token,z.object({jobId:z.string().uuid()}).strict().parse(body).jobId);
    else if(req.method==='POST'&&op==='speech')result=await api.speechStart(id,token,body);
    else if(req.method==='POST'&&op==='stream')result=await api.streamStart(id,token,body);
    else if(req.method==='POST'&&op==='stream-cancel')result=await api.streamCancel(id,token,body);
    else if(req.method==='POST'&&op==='stream-complete')result=await api.streamComplete(id,token,body);
    else if(req.method==='POST'&&op==='speech-status')result=await api.speechStatus(id,token,z.object({jobId:z.string().max(100)}).parse(body).jobId);
    else if(req.method==='POST'&&op==='reply')result=await api.speechReply(id,token);
    else if(req.method==='POST'&&op==='preflight'){await api.read(id,token);result={checks:api.provider==='aws'?await checkAws():[{name:'AWS live services',ok:false,detail:'Local rehearsal mode. No AWS calls.'}]};}
    else throw new AppError(405,'Method not allowed');
    return {status:200,body:result};
  }catch(e){const status=e instanceof AppError?e.status:e instanceof z.ZodError?400:502;return {status,body:{error:e instanceof AppError?e.message:e instanceof z.ZodError?'Invalid request fields. Check dates, area and required values.':'Service unavailable. Draft preserved. Check server configuration and retry.',code:(e as Error).name}};}
}
