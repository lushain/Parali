// Opt-in synthetic QA against our app. Never reads AWS console credentials.
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';
import {EventStreamCodec} from '@smithy/core/event-streams';
import {fromUtf8,toUtf8} from '@smithy/core/serde';
const base='https://z2egyz8hl6.execute-api.ap-south-1.amazonaws.com';
const origin='https://demo.d1riy18awh1bmx.amplifyapp.com';
const file='.local/voice-upgrade-check.json';
const mode=process.argv[2]||'prepare';
async function call(path,token,body){const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(29000)});const data=await r.json();if(!r.ok)throw new Error(`${r.status}: ${data.error}`);return data;}
if(mode==='prepare'){
 const key=(await readFile('.local/setup-key','utf8')).trim();const c=await call('/sessions',key,{});await writeFile(file,JSON.stringify(c));console.log('Synthetic voice QA session created:',c.session.label);
}else{
 const c=JSON.parse(await readFile(file,'utf8')),path='/sessions/'+c.session.id,token=c.tokens.farmer;
 const api=(suffix='',body)=>call(path+suffix,token,body);
 if(mode==='turn'){
  const s=await api(),start=Date.now();let r=await api('/turn',{text:process.argv[3],key:randomUUID(),epoch:s.epoch,version:s.version});
  if(r.jobId){const jobId=r.jobId;for(let n=0;n<100;n++){await new Promise(resolve=>setTimeout(resolve,1500));r=await api('/turn-status',{jobId});if(r.status==='complete')break;}if(r.status!=='complete')throw new Error('Inference timeout');}
  console.log(JSON.stringify({elapsedSeconds:(Date.now()-start)/1000,draft:r.session.draft,reply:r.reply,evidence:r.session.evidence.at(-1)},null,2));
 }
 if(mode==='reply'){const r=await api('/reply',{});await writeFile('.local/live-polly-reply.mp3',Buffer.from(r.audio,'base64'));await writeFile('.local/kajal-neural-reply.mp3',Buffer.from(r.audio,'base64'));console.log('Fresh neural reply saved, bytes:',Buffer.from(r.audio,'base64').length);}
 if(mode==='stream'){
  const wavPath=process.cwd().replaceAll('\\','/')+'/.local/synthetic-polly.wav';
  const browser=await chromium.launch({channel:'chrome',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${wavPath}`]});
  try{
   const context=await browser.newContext({permissions:['microphone'],viewport:{width:1100,height:900}}),page=await context.newPage();
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const codec=new EventStreamCodec(toUtf8,fromUtf8);
   page.on('websocket',ws=>ws.on('framereceived',event=>{try{const f=codec.decode(new Uint8Array(event.payload));if(f.headers[':message-type']?.value==='exception')console.log('AWS stream exception:',toUtf8(f.body));}catch{}}));
   let streamDoneAt=0,turnDoneAt=0;page.on('response',r=>{if(r.url().endsWith('/stream-complete')&&r.ok())streamDoneAt=Date.now();if(r.url().endsWith('/turn-status')&&r.ok())void r.json().then(b=>{if(b.status==='complete')turnDoneAt=Date.now();});});
   await page.goto(`${origin}/farmer#session=${c.session.id}&token=${token}&role=farmer`);
   const start=Date.now();await page.getByRole('button',{name:'Start recording',exact:true}).click();
   await page.getByRole('button',{name:'Stop recording',exact:true}).waitFor({timeout:15000});
   try{await page.locator('.live-transcript p').waitFor({timeout:22000});}catch(e){console.log('Voice status:',await page.locator('.voice-status').innerText());console.log('Visible error:',await page.getByRole('alert').allTextContents());await page.screenshot({path:'.local/stream-failure.png',fullPage:true});throw e;}const partialAt=Date.now(),partial=await page.locator('.live-transcript p').innerText();
   await page.screenshot({path:'docs/screenshots/live-stream-transcript.png',fullPage:true});
   await page.waitForTimeout(5500);const stoppedAt=Date.now();await page.getByRole('button',{name:'Stop recording',exact:true}).press('Enter');
   await page.waitForFunction(()=>document.querySelector('.voice-status h2')?.textContent==='साथी बोल रहा है…'||document.querySelector('.voice-status h2')?.textContent==='बोलने के लिए दबाएँ',null,{timeout:150000});
   const s=await api();console.log(JSON.stringify({synthetic:true,firstTranscriptSeconds:(partialAt-start)/1000,stopToTranscriptSeconds:streamDoneAt?(streamDoneAt-stoppedAt)/1000:null,stopToModelSeconds:turnDoneAt?(turnDoneAt-stoppedAt)/1000:null,partial,draft:s.draft,messages:s.messages.slice(-2),voice:s.voice,evidence:s.evidence.slice(-3),errors},null,2));
   await page.screenshot({path:'docs/screenshots/voice-upgrade-result.png',fullPage:true});
   if(!streamDoneAt||!turnDoneAt||errors.length)throw new Error('Streaming end-to-end did not complete cleanly');
  }finally{await browser.close();}
 }
}
