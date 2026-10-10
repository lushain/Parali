// Generate a fixed UI announcement with the same AWS Nova voice as the conversation.
import {BedrockRuntimeClient,InvokeModelWithBidirectionalStreamCommand} from '@aws-sdk/client-bedrock-runtime';
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
const api='https://z2egyz8hl6.execute-api.ap-south-1.amazonaws.com/api';
async function call(path,token,data){const r=await fetch(api+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(d.error||'API request failed');return d;}
const setup=(await readFile('.local/setup-key','utf8')).trim(),c=await call('/sessions',setup,{}),path='/sessions/'+c.session.id,t=await call(path+'/sonic-start',c.tokens.farmer,{epoch:1});
const client=new BedrockRuntimeClient({region:t.region,credentials:{...t.credentials,expiration:new Date(t.credentials.expiration)},maxAttempts:1}),abort=new AbortController(),queue=[];let ended=false,wake;
const push=event=>{if(!ended){queue.push({chunk:{bytes:Buffer.from(JSON.stringify({event}))}});wake?.();wake=undefined;}};
const body={async *[Symbol.asyncIterator](){while(!ended){if(!queue.length)await new Promise(r=>wake=r);while(queue.length)yield queue.shift();}}};
const promptName=randomUUID(),audioName=randomUUID();function text(content,role,interactive=false){const contentName=randomUUID();push({contentStart:{promptName,contentName,type:'TEXT',interactive,role,textInputConfiguration:{mediaType:'text/plain'}}});push({textInput:{promptName,contentName,content}});push({contentEnd:{promptName,contentName}});}
let silence;const timer=setTimeout(()=>abort.abort(),45000);
try{
 push({sessionStart:{inferenceConfiguration:{maxTokens:256,temperature:.2,topP:.9}}});push({promptStart:{promptName,textOutputConfiguration:{mediaType:'text/plain'},audioOutputConfiguration:{mediaType:'audio/lpcm',sampleRateHertz:24000,sampleSizeBits:16,channelCount:1,voiceId:t.voice,encoding:'base64',audioType:'SPEECH'}}});
 text('You are a friendly Hindi voice assistant. Speak only the exact Hindi announcement requested, naturally and warmly, without extra words.','SYSTEM');
 push({contentStart:{promptName,contentName:audioName,type:'AUDIO',interactive:true,role:'USER',audioInputConfiguration:{mediaType:'audio/lpcm',sampleRateHertz:16000,sampleSizeBits:16,channelCount:1,audioType:'SPEECH',encoding:'base64'}}});
 const response=await client.send(new InvokeModelWithBidirectionalStreamCommand({modelId:t.modelId,body}),{abortSignal:abort.signal});
 silence=setInterval(()=>push({audioInput:{promptName,contentName:audioName,content:Buffer.alloc(1024).toString('base64')}}),32);
 text('Please say exactly: आपका अनुरोध भेज रही हूँ। बस एक पल।','USER',true);
 const chunks=[],contents=new Map();let spoken='';
 for await(const packet of response.body||[]){if(!packet.chunk?.bytes)throw Error('Nova rejected the announcement');const ev=JSON.parse(Buffer.from(packet.chunk.bytes).toString()).event||{};if(ev.contentStart)contents.set(ev.contentStart.contentId,ev.contentStart);if(ev.textOutput)spoken+=ev.textOutput.content;if(ev.audioOutput)chunks.push(Buffer.from(ev.audioOutput.content,'base64'));if(ev.contentEnd&&contents.get(ev.contentEnd.contentId)?.type==='AUDIO'&&chunks.length)break;}
 if(!chunks.length)throw Error('No announcement audio');const data=Buffer.concat(chunks),wav=Buffer.alloc(44+data.length);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(data.length,40);data.copy(wav,44);await mkdir('public/audio',{recursive:true});await writeFile('public/audio/request-sending.wav',wav);console.log(JSON.stringify({voice:t.voice,seconds:data.length/48000,text:spoken}));
}finally{clearTimeout(timer);clearInterval(silence);ended=true;wake?.();abort.abort();client.destroy();await call(path+'/sonic-sync',c.tokens.farmer,{epoch:1,leaseId:t.leaseId,key:randomUUID(),kind:'end'}).catch(()=>{});}
