// Isolated own-app AWS QA with synthetic Hindi speech; never logs credentials.
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const origin='https://demo.d1riy18awh1bmx.amplifyapp.com',api='https://z2egyz8hl6.execute-api.ap-south-1.amazonaws.com/api';
async function call(path,token,data){const r=await fetch(api+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const d=await r.json();if(!r.ok)throw Error(`${r.status}: ${d.error}`);return d;}
const setup=(await readFile('.local/setup-key','utf8')).trim(),c=await call('/sessions',setup,{}),path='/sessions/'+c.session.id;
await writeFile('.local/map-qa.json',JSON.stringify(c));
await call(path+'/action',c.tokens.farmer,{action:'edit',key:randomUUID(),epoch:1,version:1,draft:{crop:'wheat',area:3,unit:'acre',village:'Kheri',availableDate:'2026-10-12',deadline:'2026-10-20',access:'truck',locationId:null}});
const input=await readFile('.local/map-permission.wav'),out=Buffer.alloc(44+32000*55);input.copy(out,0,0,44);out.writeUInt32LE(out.length-8,4);out.writeUInt32LE(out.length-44,40);input.subarray(44).copy(out,44+32000*10);(await readFile('.local/map-confirmation.wav')).subarray(44).copy(out,44+32000*32);
const wav=process.cwd().replaceAll('\\','/')+'/.local/map-voice-input.wav';await writeFile(wav,out);
const browser=await chromium.launch({channel:'chrome',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${wav}`]});
let ticket;const sync=[],errors=[];
try{
 const p=await browser.newPage({viewport:{width:1360,height:1000},permissions:['microphone','geolocation'],geolocation:{latitude:30.193,longitude:75.875}});
 if(process.env.LOCAL_BUNDLE)await p.route(origin+'/**',async r=>{const u=new URL(r.request().url());if(u.pathname.startsWith('/assets/')||u.pathname.startsWith('/maps/')||u.pathname.startsWith('/audio/'))await r.fulfill({path:'dist'+u.pathname});else if(u.pathname.startsWith('/farmer'))await r.fulfill({path:'dist/index.html',contentType:'text/html'});else await r.continue();});
 await p.addInitScript(()=>{window.__flowQA={starts:[],announcements:[]};const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer)window.__flowQA.starts.push(Date.now());return start.apply(this,args);};const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){window.__flowQA.announcements.push(this.src);return play.apply(this);};});
 p.on('pageerror',e=>errors.push(e.message));p.on('response',async r=>{if(r.url().endsWith('/sonic-start')){ticket=await r.json();console.log('Voice ticket status',r.status(),ticket.error||'issued');}if(r.url().endsWith('/sonic-sync')){const b=r.request().postDataJSON(),d=await r.json();sync.push({kind:b.kind,text:b.text,status:r.status(),error:d.error});}});
 await p.goto(`${origin}/farmer#session=${c.session.id}&token=${c.tokens.farmer}&role=farmer`);
 const started=Date.now();await p.getByRole('button',{name:'माइक से जवाब दें · Speak',exact:true}).click();
 await p.waitForFunction(()=>window.__flowQA.starts.length>0,null,{timeout:9500});const introSeconds=await p.evaluate(start=>(window.__flowQA.starts[0]-start)/1000,started);console.log('Automatic spoken intro began in seconds:',introSeconds);
 await p.getByRole('heading',{name:'आपका खेत यह है?',exact:true}).waitFor({timeout:32000});
 await p.getByRole('button',{name:'हाँ, यही खेत है · Send request',exact:true}).waitFor();
 const before=await call(path,c.tokens.farmer);if(before.request)throw Error('Published before separate confirmation');
 await p.screenshot({path:'docs/screenshots/field-map-live.png'});
 await p.getByText('आपका अनुरोध पहुँच गया है',{exact:true}).waitFor({timeout:35000});
 await p.waitForTimeout(5000);
 await p.getByRole('heading',{name:'Vyom Bhatnagar',exact:true}).waitFor();const playback=await p.evaluate(()=>window.__flowQA.announcements);if(!playback.some(u=>u.endsWith('/audio/request-sending.wav')))throw Error('Hindi sending announcement did not play');if(!new URL(p.url()).pathname.startsWith('/farmer/request/'))throw Error('Request details page did not open');
 const state=await call(path,c.tokens.farmer),buyer=await call(path,c.tokens.buyer);
 if(errors.length)throw Error(errors.join(';'));if(state.messages.some(m=>m.role==='assistant'&&/\bdemo\b|डेमो/i.test(m.text)))throw Error('Voice repeated a demo label');if(state.messages.some(m=>m.role==='user'&&m.text.includes('Application opening instruction')))throw Error('Application intro polluted the farmer transcript');
 if(!state.request||state.draft.locationId!=='sangrur-east'||buyer.request?.id!==state.request.id)throw Error('Confirmed field request did not reach buyer');
 await p.screenshot({path:'docs/screenshots/field-map-sent.png'});
 console.log(JSON.stringify({label:state.label,syntheticSpeech:true,separateConfirmationRequired:true,request:state.request.id,location:state.draft.locationId,buyerReceived:true,sync,messages:state.messages},null,2));
}catch(e){console.error(String(e));console.log({sync,errors});for(const p of browser.contexts().flatMap(c=>c.pages())){console.log('App alerts:',await p.locator('.error-banner').allTextContents());await p.screenshot({path:'.local/map-voice-failure.png'});}const state=await call(path,c.tokens.farmer);console.log(JSON.stringify({draft:state.draft,messages:state.messages,preview:!!state.locationPreview,request:state.request?.id},null,2));process.exitCode=1;}
finally{if(ticket?.leaseId)await call(path+'/sonic-sync',c.tokens.farmer,{epoch:1,leaseId:ticket.leaseId,key:randomUUID(),kind:'end'}).catch(()=>{});await browser.close();}
