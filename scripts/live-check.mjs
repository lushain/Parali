// Opt-in checks against our deployed demo API; no AWS credentials are used here.
// Private capability links and generated audio stay under ignored .local/.
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const mode=process.argv[2]||'check';
const file=process.env.PARALI_SESSION_FILE||'.local/live-demo.json';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(base,path,token,body){
  const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(29000)});
  const data=await r.json();if(!r.ok)throw new Error(`${r.status}: ${data.error||'Request failed'} (${data.code||''})`);return data;
}
if(mode==='prepare'){
  const base=process.env.PARALI_API_URL,origin=process.env.PARALI_FRONTEND_ORIGIN;
  if(!base||!origin)throw new Error('Set PARALI_API_URL and PARALI_FRONTEND_ORIGIN');
  const key=(await readFile('.local/setup-key','utf8')).trim();
  const c=await call(base,'/sessions',key,{});
  const links=Object.fromEntries(Object.entries(c.tokens).map(([role,token])=>[role,`${origin}/${role}#session=${c.session.id}&token=${token}&role=${role}`]));
  await writeFile(file,JSON.stringify({base,origin,...c,links},null,2));
  await writeFile('.local/live-demo-links.md',`# Private AWS demo links\n\n${c.session.label}\n\n`+Object.entries(links).map(([role,url])=>`- [${role}](${url})`).join('\n')+'\n');
  console.log(`Created AWS session ${c.session.label}; private links saved to .local/live-demo-links.md`);
}else{
  const d=JSON.parse(await readFile(file,'utf8')),path='/sessions/'+d.session.id;
  const api=(suffix='',body,role='farmer')=>call(d.base,path+suffix,d.tokens[role],body);
  if(mode==='check'){const result=await api('/preflight',{});console.log(JSON.stringify(result,null,2));if(result.checks.some(c=>!c.ok))process.exitCode=1;}
  if(mode==='read'){const s=await api();console.log(JSON.stringify({label:s.label,version:s.version,draft:s.draft,messages:s.messages,evidence:s.evidence},null,2));}
  if(mode==='turn'||mode==='speech'){
    let input;
    if(mode==='speech'){
      const s=await api();const audio=(await readFile(process.argv[3])).toString('base64');
      const {jobId}=await api('/speech',{audio,epoch:s.epoch});console.log('Fresh Transcribe job started');
      let result;
      for(let n=0;n<65;n++){await pause(4000);result=await api('/speech-status',{jobId});if(result.status==='complete')break;if(n%5===0)console.log('Transcription pending');}
      if(result?.status!=='complete')throw new Error('Transcription did not complete');
      console.log('Transcribed:',result.transcript);input={jobId};
    }else input={text:process.argv[3]};
    const s=await api();let result=await api('/turn',{...input,key:randomUUID(),epoch:s.epoch,version:s.version});
    if(result.jobId){const jobId=result.jobId;console.log('Fresh EC2 inference queued');for(let n=0;n<75;n++){await pause(4000);result=await api('/turn-status',{jobId});if(result.status==='complete')break;if(n%5===0)console.log('EC2 inference pending');}if(result.status!=='complete')throw new Error('Inference did not complete');}
    console.log(JSON.stringify({draft:result.session.draft,reply:result.reply,evidence:result.session.evidence.at(-1)},null,2));
  }
  if(mode==='reply'){const r=await api('/reply',{});await writeFile('.local/live-polly-reply.mp3',Buffer.from(r.audio,'base64'));console.log('Fresh Polly audio saved; '+Buffer.from(r.audio,'base64').length+' bytes');}
}
