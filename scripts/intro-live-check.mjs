// Silent microphone probe of the app's automatic greeting. Uses an isolated demo session.
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const origin='https://demo.d1riy18awh1bmx.amplifyapp.com',api='https://z2egyz8hl6.execute-api.ap-south-1.amazonaws.com/api';
async function call(path,token,data){const r=await fetch(api+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d;}
const setup=(await readFile('.local/setup-key','utf8')).trim(),c=await call('/sessions',setup,{}),path='/sessions/'+c.session.id;
const source=await readFile('.local/map-permission.wav'),silence=Buffer.alloc(44+32000*30);source.copy(silence,0,0,44);silence.writeUInt32LE(silence.length-8,4);silence.writeUInt32LE(silence.length-44,40);await writeFile('.local/intro-silence.wav',silence);
const wav=process.cwd().replaceAll('\\','/')+'/.local/intro-silence.wav',b=await chromium.launch({channel:'chrome',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${wav}`]});let ticket;
try{
 const p=await b.newPage({permissions:['microphone'],viewport:{width:1360,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('response',async r=>{if(r.url().endsWith('/sonic-start'))ticket=await r.json();if(r.url().includes('/sonic-sync')&&!r.ok())console.error(JSON.stringify({voiceSyncStatus:r.status(),error:(await r.json()).error}));});
 await p.addInitScript(()=>{window.__introAudio=[];const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer)window.__introAudio.push(Date.now());return start.apply(this,args);};});
 await p.goto(`${origin}/farmer#session=${c.session.id}&token=${c.tokens.farmer}&role=farmer`);const started=Date.now();await p.getByRole('button',{name:'Start recording',exact:true}).click();
 await p.waitForFunction(()=>window.__introAudio.length>0,null,{timeout:12000});
 // Nova may ask the village or introduce itself before asking the crop.
 await p.waitForFunction(()=>Array.from(document.querySelectorAll('.message.assistant p')).some(m=>/[\u0900-\u097f]/.test(m.textContent||'')),null,{timeout:15000});
 const firstAudioSeconds=await p.evaluate(t=>(window.__introAudio[0]-t)/1000,started);
 await p.screenshot({path:'docs/screenshots/voice-quota-live.png'});
 await p.getByRole('button',{name:'End conversation',exact:true}).click();const s=await call(path,c.tokens.farmer);
 if(Object.values(s.draft).some(v=>v!==null)||s.messages.some(m=>m.role==='user')||errors.length)throw Error('Silent greeting changed farmer facts or produced browser errors');
 await p.screenshot({path:'docs/screenshots/automatic-voice-intro.png'});
 console.log(JSON.stringify({label:s.label,silentMicrophone:true,automaticIntro:true,firstAudioSeconds,draftUnchanged:true,messages:s.messages}));
}catch(e){const s=await call(path,c.tokens.farmer);for(const p of b.contexts().flatMap(c=>c.pages())){console.error(JSON.stringify({alerts:await p.getByRole('alert').allTextContents(),voice:await p.locator('.voice-status').innerText(),transcript:await p.locator('.transcript').innerText()}));await p.screenshot({path:'.local/intro-failure.png'});}console.error(JSON.stringify({label:s.label,messages:s.messages,error:String(e)}));throw e;
}finally{if(ticket?.leaseId)await call(path+'/sonic-sync',c.tokens.farmer,{epoch:1,leaseId:ticket.leaseId,key:randomUUID(),kind:'end'}).catch(()=>{});await b.close();}
