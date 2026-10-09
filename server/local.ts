import 'dotenv/config';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { FileStore,DynamoStore } from './store.js';
import { DemoService } from './service.js';
import { route } from './http.js';
await mkdir('.local',{recursive:true});
let setupKey=process.env.PLATFORM_SETUP_KEY||process.env.ORGANIZER_KEY;
if(!setupKey){try{setupKey=await readFile('.local/setup-key','utf8');}catch{setupKey=randomBytes(32).toString('base64url');await writeFile('.local/setup-key',setupKey);}}
const api=new DemoService(process.env.SESSION_TABLE?new DynamoStore(process.env.SESSION_TABLE):new FileStore(),process.env.AI_PROVIDER==='aws'?'aws':'mock');
let platform:{id:string;farmer:string;buyer:string};
try {platform=JSON.parse(await readFile('.local/platform.json','utf8'));await api.read(platform.id,platform.farmer);}catch{
  const created=await api.create();platform={id:created.session.id,farmer:created.tokens.farmer,buyer:created.tokens.buyer};
  await writeFile('.local/platform.json',JSON.stringify(platform));
}
const buckets=new Map<string,{n:number;at:number}>();
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const address=req.socket.remoteAddress||'local';const now=Date.now();let bucket=buckets.get(address);if(!bucket||now-bucket.at>60000){bucket={n:0,at:now};buckets.set(address,bucket);}if(++bucket.n>300){res.writeHead(429);res.end('{"error":"Too many requests"}');return;}
  let body='';try{for await(const chunk of req){body+=chunk.toString();if(body.length>1000000){res.writeHead(413);res.end('{"error":"Audio too large"}');return;}}if(req.method==='GET'&&req.url==='/api/platform'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(platform));return;}const result=await route(api,{method:req.method||'GET',path:(req.url||'').split('?')[0],headers:{authorization:req.headers.authorization},body},setupKey!);res.writeHead(result.status,{'Content-Type':'application/json'});res.end(JSON.stringify(result.body));}catch{res.writeHead(500);res.end('{"error":"Unexpected server error"}');}
});
server.listen(8787,process.env.API_HOST||'127.0.0.1',()=>console.log(`Parali API on http://127.0.0.1:8787 · ${api.provider.toUpperCase()} provider. Open /farmer or /buyer.`));
