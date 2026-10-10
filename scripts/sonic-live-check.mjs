// Opt-in QA for our own app. Never reads browser credentials or logs signed URLs.
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const origin='https://demo.d1riy18awh1bmx.amplifyapp.com',api='https://z2egyz8hl6.execute-api.ap-south-1.amazonaws.com/api';
const mode=process.argv[2]||'text';
const setup=(await readFile('.local/setup-key','utf8')).trim();
const c=await fetch(api+'/sessions',{method:'POST',headers:{Authorization:'Bearer '+setup,'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());
if(!c.session)throw Error('Could not create isolated QA session');
await writeFile('.local/sonic-qa.json',JSON.stringify(c));
const wav=process.cwd().replaceAll('\\','/')+'/.local/sonic-input.wav';
if(mode==='microphone'){
 const input=await readFile('.local/synthetic-polly.wav'),data=input.subarray(44),out=Buffer.alloc(44+16000*2*40);input.copy(out,0,0,44);out.writeUInt32LE(out.length-8,4);out.writeUInt32LE(out.length-44,40);data.copy(out,44+16000*2*5);if(process.env.VOICE_CORRECTION)(await readFile('.local/correction.wav')).subarray(44).copy(out,44+16000*2*22);await writeFile(wav,out);
}
const browser=await chromium.launch({channel:'chrome',args:mode==='microphone'?['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${wav}`]:[]});
try{
 const page=await browser.newPage({permissions:mode==='microphone'?['microphone']:[],viewport:{width:1280,height:1000}});
 if(process.env.LOCAL_BUNDLE){await page.route(origin+'/**',async route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/assets/'))await route.fulfill({path:'dist'+u.pathname});else if(u.pathname==='/farmer')await route.fulfill({path:'dist/index.html',contentType:'text/html'});else await route.continue();});}
 await page.addInitScript(()=>{window.__voiceQA={starts:[],audio:[]};const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer){window.__voiceQA.starts.push(Date.now()+Math.max(0,(args[0]||this.context.currentTime)-this.context.currentTime)*1000);window.__voiceQA.audio.push({rate:this.buffer.sampleRate,samples:Array.from(this.buffer.getChannelData(0))});}return start.apply(this,args);};});
 let issuedToken='';page.on('response',async r=>{if(r.url().endsWith('/sonic-start')){const t=await r.json().catch(()=>({}));issuedToken=t.credentials?.sessionToken||'';}});
 page.on('websocket',ws=>{const u=new URL(ws.url());console.log('AWS socket authentication metadata:',{host:u.hostname,path:u.pathname,queryKeys:[...u.searchParams.keys()],tokenMatchesIssued:u.searchParams.get('X-Amz-Security-Token')===issuedToken,tokenLength:u.searchParams.get('X-Amz-Security-Token')?.length,date:u.searchParams.get('X-Amz-Date')});});
 const errors=[];page.on('pageerror',e=>errors.push(e.message.replace(/wss:\/\/\S+/g,'[signed URL omitted]')));
 await page.goto(`${origin}/farmer#session=${c.session.id}&token=${c.tokens.farmer}&role=farmer`);await page.locator('.request-panel').waitFor();
 const started=Date.now();
 if(mode==='text'){
  await page.locator('#typed').fill('मेरे पास तीन एकड़ गेहूँ की पराली है।');await page.getByRole('button',{name:'Send typed message'}).click();
  await page.waitForFunction(()=>window.__voiceQA.starts.length>0||document.querySelector('[role=alert]'),null,{timeout:30000});if(await page.getByRole('alert').count())throw Error(await page.getByRole('alert').innerText());
  await page.getByText('3 acre',{exact:true}).waitFor({timeout:30000});
  console.log('Typed prompt to first audio (includes cold connection):',((await page.evaluate(()=>window.__voiceQA.starts[0]))-started)/1000);
  await page.waitForTimeout(5500);const count=await page.evaluate(()=>window.__voiceQA.starts.length),correction=Date.now();
  await page.locator('#typed').fill('तीन नहीं, चार एकड़।');await page.getByRole('button',{name:'Send typed message'}).click();
  await page.waitForFunction(n=>window.__voiceQA.starts.length>n,count,{timeout:30000});await page.getByText('4 acre',{exact:true}).waitFor({timeout:30000});
  console.log('Warm typed correction to first audio:',((await page.evaluate(n=>window.__voiceQA.starts[n],count))-correction)/1000);
  await page.waitForTimeout(5500);
 }else{
  await page.getByRole('button',{name:'Start recording',exact:true}).click();
  let max=0,lastVoice=0,firstAudio=0;
  for(let n=0;n<450;n++){
   if(await page.getByRole('alert').count())throw Error(await page.getByRole('alert').innerText());
   const sample=await page.evaluate(()=>({level:Number(document.querySelector('.voice-orbit')?.style.getPropertyValue('--voice-level')||0),audio:window.__voiceQA.starts[0]||0,now:Date.now()}));
   max=Math.max(max,sample.level);if(sample.level>.03)lastVoice=sample.now;if(sample.audio){firstAudio=sample.audio;break;}await page.waitForTimeout(100);
  }
  if(!firstAudio)throw Error('No direct speech audio response');if(max<=.03)throw Error('Microphone did not react to synthetic speech');
  console.log(JSON.stringify({synthetic:true,maxVoiceLevel:max,endOfMeasuredSpeechToFirstAudioSeconds:lastVoice?(firstAudio-lastVoice)/1000:null}));
  await page.getByText('3 acre',{exact:true}).waitFor({timeout:12000});
  if(process.env.VOICE_CORRECTION){
   await page.waitForTimeout(Math.max(0,started+20000-Date.now()));const before=await page.evaluate(()=>window.__voiceQA.starts.length);let lastCorrection=0,answer=0;
   for(let n=0;n<200;n++){if(await page.getByRole('alert').count())throw Error(await page.getByRole('alert').innerText());const v=await page.evaluate(n=>({level:Number(document.querySelector('.voice-orbit')?.style.getPropertyValue('--voice-level')||0),audio:window.__voiceQA.starts[n]||0,now:Date.now()}),before);if(v.level>.03)lastCorrection=v.now;if(v.audio){answer=v.audio;break;}await page.waitForTimeout(100);}
   await page.getByText('4 acre',{exact:true}).waitFor({timeout:12000});console.log(JSON.stringify({syntheticSpokenCorrection:true,endOfMeasuredSpeechToFirstAudioSeconds:lastCorrection&&answer?(answer-lastCorrection)/1000:null}));
  }
  await page.waitForTimeout(6000);
 }
 await page.screenshot({path:'docs/screenshots/nova-sonic-live.png',fullPage:true});
 await page.getByRole('button',{name:'End conversation',exact:true}).click();await page.waitForTimeout(1000);
 const state=await fetch(api+'/sessions/'+c.session.id,{headers:{Authorization:'Bearer '+c.tokens.farmer}}).then(r=>r.json());
 console.log(JSON.stringify({label:state.label,model:state.model,voice:state.voice,draft:state.draft,messages:state.messages,errors},null,2));
 const chunks=await page.evaluate(()=>window.__voiceQA.audio);const count=chunks.reduce((n,c)=>n+c.samples.length,0);if(count){const out=Buffer.alloc(44+count*2);out.write('RIFF');out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(chunks[0].rate,24);out.writeUInt32LE(chunks[0].rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(count*2,40);let pos=44;for(const c of chunks)for(const v of c.samples){out.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),pos);pos+=2;}await writeFile('.local/nova-hindi-qa.wav',out);}
}catch(e){console.error(String(e));for(const p of browser.contexts().flatMap(c=>c.pages())){console.log('Visible app error:',await p.getByRole('alert').allTextContents());console.log('Voice status:',await p.locator('.voice-status').innerText().catch(()=>''));await p.screenshot({path:'.local/nova-failure.png',fullPage:true});}process.exitCode=1;}finally{await browser.close();}
