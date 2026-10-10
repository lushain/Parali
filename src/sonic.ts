import {BedrockRuntimeClient,InvokeModelWithBidirectionalStreamCommand} from '@aws-sdk/client-bedrock-runtime';
import {request,type Join} from './api';
import type {SessionView} from '../shared/domain';
import {fieldTool,mapTools,sonicPrompt,farmerVoiceInstruction} from '../shared/sonic';
import {pcm16} from './streaming';
import {voiceLevel} from './voice-level';

type Ticket={leaseId:string;credentials:{accessKeyId:string;secretAccessKey:string;sessionToken:string;expiration:string};region:string;modelId:string;voice:string;maxSeconds:number;today:string;session:SessionView};
type Callbacks={onState:(s:string)=>void;onLevel:(n:number)=>void;onText:(s:string)=>void;onSession:(s:SessionView)=>void;onError:(e:Error)=>void;onMap?:()=>Promise<void>;onSending?:()=>Promise<void>;onSendFailure?:()=>void;onEnd:()=>void};
export async function startSonicConversation(j:Join,epoch:number,cb:Callbacks,microphone=true){
 const media=microphone?await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}}):undefined;
 let client:BedrockRuntimeClient|undefined;
 let ticket:Ticket|undefined,context:AudioContext|undefined,processor:ScriptProcessorNode|undefined,source:MediaStreamAudioSourceNode|undefined,silent:GainNode|undefined;
 let ended=false,playAt=0,muted=false,lastUser='',lastTyped='',timeout:ReturnType<typeof setTimeout>|undefined,silenceTimer:ReturnType<typeof setInterval>|undefined;
 const abort=new AbortController(),sources=new Set<AudioBufferSourceNode>();
 const events:{chunk:{bytes:Uint8Array}}[]=[],encoder=new TextEncoder();let wake:(()=>void)|undefined;
 let writes:Promise<unknown>=Promise.resolve();let previewId:string|undefined,published=false,finishTimer:ReturnType<typeof setTimeout>|undefined;
 const emit=(event:Record<string,unknown>)=>{if(ended)return;if(events.length>220)throw new Error('Voice connection is too slow. Please reconnect.');events.push({chunk:{bytes:encoder.encode(JSON.stringify({event}))}});wake?.();wake=undefined;};
 const body={async *[Symbol.asyncIterator](){while(!ended){if(!events.length)await new Promise<void>(resolve=>{wake=resolve;});while(events.length)yield events.shift()!;}}};
 const promptName=crypto.randomUUID(),audioName=crypto.randomUUID();
 const textEvent=(text:string,role:string,interactive=false)=>{const contentName=crypto.randomUUID();emit({contentStart:{promptName,contentName,type:'TEXT',interactive,role,textInputConfiguration:{mediaType:'text/plain'}}});emit({textInput:{promptName,contentName,content:text}});emit({contentEnd:{promptName,contentName}});};
 const clearAudio=()=>{for(const s of sources){s.onended=null;try{s.stop();}catch{}}sources.clear();playAt=0;};
 const sync=(kind:string,key:string,extra:Record<string,unknown>={})=>{
  const task=writes.then(()=>request<{session:SessionView;draft:unknown;estimate:unknown;instruction?:string}>(`/sessions/${j.id}/sonic-sync`,j.token,{leaseId:ticket!.leaseId,epoch,key,kind,...extra})).then(r=>{previewId=r.session.locationPreview?.id;published=!!r.session.request;cb.onSession(r.session);return r;});
  writes=task.catch(()=>{});return task;
 };
 const close=()=>{
  if(ended)return writes.then(()=>{});
  try{emit({contentEnd:{promptName,contentName:audioName}});emit({promptEnd:{promptName}});emit({sessionEnd:{}});}catch{}
  ended=true;wake?.();if(timeout)clearTimeout(timeout);if(silenceTimer)clearInterval(silenceTimer);clearTimeout(finishTimer);
  if(processor)processor.onaudioprocess=null;processor?.disconnect();source?.disconnect();silent?.disconnect();media?.getTracks().forEach(t=>t.stop());clearAudio();cb.onLevel(0);
  if(context&&context.state!=='closed')void context.close();abort.abort();client?.destroy();
  const settled=ticket?sync('end',crypto.randomUUID()).then(()=>{},()=>{}):Promise.resolve();cb.onEnd();return settled;
 };
 const fail=(e:unknown)=>{if(ended)return;close();cb.onError(e instanceof Error?e:new Error('Voice connection lost. Please reconnect.'));};
 try{
  context=new AudioContext({sampleRate:16000});await context.resume();
  ticket=await request<Ticket>(`/sessions/${j.id}/sonic-start`,j.token,{epoch});previewId=ticket.session.locationPreview?.id;cb.onSession(ticket.session);
  client=new BedrockRuntimeClient({region:ticket.region,credentials:{...ticket.credentials,expiration:new Date(ticket.credentials.expiration)},maxAttempts:1});
  timeout=setTimeout(close,ticket.maxSeconds*1000);
  emit({sessionStart:{inferenceConfiguration:{maxTokens:1024,topP:.9,temperature:.5},turnDetectionConfiguration:{endpointingSensitivity:'HIGH'}}});
  emit({promptStart:{promptName,textOutputConfiguration:{mediaType:'text/plain'},audioOutputConfiguration:{mediaType:'audio/lpcm',sampleRateHertz:24000,sampleSizeBits:16,channelCount:1,voiceId:ticket.voice,encoding:'base64',audioType:'SPEECH'},toolUseOutputConfiguration:{mediaType:'application/json'},toolConfiguration:{tools:[fieldTool,...mapTools]}}});
  textEvent(sonicPrompt(ticket.session.draft,ticket.today,!!previewId),'SYSTEM');
  emit({contentStart:{promptName,contentName:audioName,type:'AUDIO',interactive:true,role:'USER',audioInputConfiguration:{mediaType:'audio/lpcm',sampleRateHertz:16000,sampleSizeBits:16,channelCount:1,audioType:'SPEECH',encoding:'base64'}}});
  const response=await client.send(new InvokeModelWithBidirectionalStreamCommand({modelId:ticket.modelId,body}),{abortSignal:abort.signal});
  if(ended)throw new Error('Voice session ended while connecting.');
  const sendAudio=(samples:Float32Array)=>{const pcm=pcm16(samples,context!.sampleRate);let binary='';for(const v of pcm)binary+=String.fromCharCode(v);emit({audioInput:{promptName,contentName:audioName,content:btoa(binary)}});};
  if(media){source=context.createMediaStreamSource(media);processor=context.createScriptProcessor(512,1,1);silent=context.createGain();silent.gain.value=0;
   processor.onaudioprocess=e=>{if(ended)return;try{const samples=e.inputBuffer.getChannelData(0);cb.onLevel(muted?0:voiceLevel(samples));sendAudio(muted?new Float32Array(samples.length):samples);}catch(e){fail(e);}};
   source.connect(processor);processor.connect(silent);silent.connect(context.destination);
  }else{silenceTimer=setInterval(()=>{try{sendAudio(new Float32Array(512));}catch(e){fail(e);}},32);}
  cb.onState(microphone?'listening':'ready');
  const contents=new Map<string,{role:string;type:string;stage:string;text:string;prefix:string;tool?:{toolName:string;toolUseId:string;content:string}}>();
  void (async()=>{
   for await(const packet of response.body||[]){
    if(ended)break;if(!packet.chunk?.bytes){const name=Object.keys(packet).find(k=>k.endsWith('Exception'));if(name)throw new Error(`Nova Sonic: ${name}. Please reconnect.`);continue;}
    const ev=JSON.parse(new TextDecoder().decode(packet.chunk.bytes)).event||{};
    if(ev.userSpeechStart){lastUser='';lastTyped='';clearAudio();}
    if(ev.contentStart){const c=ev.contentStart;let stage='';try{stage=JSON.parse(c.additionalModelFields||'{}').generationStage||'';}catch{}contents.set(c.contentId,{role:c.role,type:c.type,stage,text:'',prefix:c.role==='USER'?lastUser+' ':''});}
    if(ev.textOutput){const t=ev.textOutput,c=contents.get(t.contentId);if(c){c.text+=t.content;if(c.role==='USER'){lastUser=(c.prefix+c.text).trim();cb.onText(lastUser);cb.onState('thinking');}else if(t.content.includes('"interrupted"')){clearAudio();cb.onState(microphone?'listening':'ready');}}}
    if(ev.audioOutput){const binary=atob(ev.audioOutput.content);const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));const view=new DataView(bytes.buffer);const buffer=context!.createBuffer(1,bytes.length/2,24000),channel=buffer.getChannelData(0);for(let i=0;i<channel.length;i++)channel[i]=view.getInt16(i*2,true)/32768;
     const node=context!.createBufferSource();node.buffer=buffer;node.connect(context!.destination);playAt=Math.max(context!.currentTime+.025,playAt);node.start(playAt);playAt+=buffer.duration;sources.add(node);cb.onState('speaking');node.onended=()=>{sources.delete(node);node.disconnect();if(!sources.size&&!ended)cb.onState(microphone?'listening':'ready');};
    }
    if(ev.toolUse){const t=ev.toolUse;const c=contents.get(t.contentId);if(c)c.tool=t;}
    if(ev.contentEnd){const e=ev.contentEnd,c=contents.get(e.contentId);
     if(e.stopReason==='INTERRUPTED'){clearAudio();cb.onState(microphone?'listening':'ready');}
     if(c?.tool){const tool=c.tool;let result:unknown;
      try{let r;
       if(tool.toolName==='open_demo_field'){if(!cb.onMap)throw new Error('Map screen unavailable');await cb.onMap();r=await sync('map-open',tool.toolUseId);}
       else if(tool.toolName==='confirm_demo_field'){clearAudio();await cb.onSending?.();r=await sync('map-confirm',tool.toolUseId,{text:lastUser,previewId});}
       else if(tool.toolName==='update_field')r=await sync('tool',tool.toolUseId,{text:lastUser,patch:JSON.parse(tool.content)});
       else throw new Error('Unknown tool');
       result={draft:r.draft,estimate:r.estimate,instruction:farmerVoiceInstruction(r.instruction)};}

      catch(e){if(tool.toolName==='confirm_demo_field')cb.onSendFailure?.();result={error:(e as Error).message,instruction:'Do not claim fields were saved or the request was sent. Explain the failure and ask the farmer to retry or correct the details on screen.'};}
      const name=crypto.randomUUID();emit({contentStart:{promptName,contentName:name,type:'TOOL',interactive:false,role:'TOOL',toolResultInputConfiguration:{toolUseId:tool.toolUseId,type:'TEXT',textInputConfiguration:{mediaType:'text/plain'}}}});emit({toolResult:{promptName,contentName:name,content:JSON.stringify(result)}});emit({contentEnd:{promptName,contentName:name}});
     }else if(c?.text.trim()&&!(c.role==='ASSISTANT'&&c.text.includes('"interrupted"'))&&c.stage==='FINAL'&&['USER','ASSISTANT'].includes(c.role)){
      if(c.role!=='USER'||c.text.trim()!==lastTyped.trim())await sync(c.role==='USER'?'user':'assistant',e.contentId,{text:c.text});if(c.role==='ASSISTANT')cb.onText('');
     }
     if(published&&c?.role==='ASSISTANT'&&c.type==='AUDIO'){clearTimeout(finishTimer);finishTimer=setTimeout(close,Math.max(250,(playAt-context!.currentTime)*1000+150));}
     contents.delete(e.contentId);
    }
   }
   if(!ended)close();
  })().catch(fail);
  if(microphone){lastTyped='Application opening instruction: introduce yourself briefly in Hindi, then ask the next question using the saved details.';textEvent(lastTyped,'USER',true);cb.onState('thinking');}
  return {close,sendText:async(text:string)=>{if(ended)throw new Error('Voice connection ended');clearAudio();lastUser=text;lastTyped=text;await sync('user',crypto.randomUUID(),{text});textEvent(text,'USER',true);cb.onState('thinking');},setMuted:(value:boolean)=>{muted=value;if(muted)cb.onLevel(0);},interrupt:()=>{clearAudio();cb.onState(microphone?'listening':'ready');}};
 }catch(e){fail(e);throw e;}
}
