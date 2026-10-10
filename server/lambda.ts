import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoStore } from './store.js';
import { DemoService } from './service.js';
import { route } from './http.js';
import { cleanupSpeech } from './aws.js';
import { cleanup as cleanupCompute } from './compute.js';
const api=new DemoService(new DynamoStore(process.env.SESSION_TABLE!),process.env.AI_PROVIDER==='aws'?'aws':'mock');
export const handler:APIGatewayProxyHandlerV2=async event=>{
  if((event as unknown as {operation?:string}).operation==='cleanup'){
    for(const s of await (api.store as DynamoStore).listForCleanup()){
      const expired=s.jobs.filter(j=>Date.now()-j.createdAt>5*60000);
      for(const job of expired)await cleanupSpeech(job);
      if(s.computeJob&&Date.now()-s.computeJob.createdAt>5*60000)await cleanupCompute(s.computeJob);
      if(expired.length){s.jobs=s.jobs.filter(j=>!expired.includes(j));await api.store.save({...s,version:s.version+1},s.version);}
    }
    return {statusCode:200,body:'cleanup complete'};
  }
  const r=await route(api,{method:event.requestContext.http.method,path:event.rawPath,headers:event.headers,body:event.isBase64Encoded?Buffer.from(event.body||'','base64').toString():event.body||''},process.env.PLATFORM_SETUP_KEY||process.env.ORGANIZER_KEY||'');return {statusCode:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(r.body)};
};
