import {EventStreamCodec} from '@smithy/core/event-streams';
import {fromUtf8,toUtf8} from '@smithy/core/serde';
import {request,type Join} from './api';
import {voiceLevel} from './voice-level';

const codec=new EventStreamCodec(toUtf8,fromUtf8);
export function audioEvent(pcm:Uint8Array){return codec.encode({headers:{':content-type':{type:'string',value:'application/octet-stream'},':event-type':{type:'string',value:'AudioEvent'},':message-type':{type:'string',value:'event'}},body:pcm});}
export class TranscriptSegments {
  private segments=new Map<string,{text:string;final:boolean}>();
  update(results:{ResultId?:string;IsPartial?:boolean;Alternatives?:{Transcript?:string}[]}[]){
    for(const r of results){if(!r.ResultId)continue;const previous=this.segments.get(r.ResultId);if(previous?.final)continue;this.segments.set(r.ResultId,{text:r.Alternatives?.[0]?.Transcript||'',final:r.IsPartial===false});}
    return this.text(false);
  }
  text(finalOnly=true){return [...this.segments.values()].filter(r=>!finalOnly||r.final).map(r=>r.text).filter(Boolean).join(' ').trim();}
}
export function pcm16(input:Float32Array,rate:number){
  const count=Math.floor(input.length*16000/rate),out=new Uint8Array(count*2),view=new DataView(out.buffer);
  for(let i=0;i<count;i++){const from=Math.floor(i*rate/16000),to=Math.min(input.length,Math.max(from+1,Math.floor((i+1)*rate/16000)));let sum=0;for(let n=from;n<to;n++)sum+=input[n];const sample=Math.max(-1,Math.min(1,sum/(to-from)));view.setInt16(i*2,Math.round(sample*(sample<0?32768:32767)),true);}
  return out;
}
export async function startStreamingRecording(j:Join,epoch:number,onText:(s:string)=>void,onError?:(e:Error)=>void,onLevel?:(n:number)=>void){
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone requires HTTPS and browser permission.');
  const media=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
  let socket:WebSocket|undefined,context:AudioContext|undefined,processor:ScriptProcessorNode|undefined,source:MediaStreamAudioSourceNode|undefined,silent:GainNode|undefined;
  let ending=false,failed:Error|undefined,closed=false,finishTimer:ReturnType<typeof setTimeout>|undefined;
  let ticket:{jobId:string;url:string}|undefined;
  const release=()=>{if(ticket)void request(`/sessions/${j.id}/stream-cancel`,j.token,{jobId:ticket.jobId,epoch}).catch(()=>{});};
  const segments=new TranscriptSegments();
  const clean=()=>{if(processor)processor.onaudioprocess=null;processor?.disconnect();source?.disconnect();silent?.disconnect();media.getTracks().forEach(t=>t.stop());onLevel?.(0);if(context&&context.state!=='closed')void context.close();};
  let resolveDone:(s:string)=>void,rejectDone:(e:Error)=>void;
  const done=new Promise<string>((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});void done.catch(()=>{});
  const fail=(e:Error)=>{if(failed)return;failed=e;clean();release();if(finishTimer)clearTimeout(finishTimer);rejectDone(e);socket?.close();if(!ending)onError?.(e);};
  try{
    ticket=await request<{jobId:string;url:string}>(`/sessions/${j.id}/stream`,j.token,{epoch});
    socket=new WebSocket(ticket.url);socket.binaryType='arraybuffer';
    await new Promise<void>((resolve,reject)=>{
      const timeout=setTimeout(()=>{socket?.close();reject(new Error('Could not connect to AWS live transcription. Please retry.'));},8000);
      socket!.onopen=()=>{clearTimeout(timeout);resolve();};socket!.onerror=()=>{clearTimeout(timeout);reject(new Error('AWS live transcription connection failed. Please retry.'));};
    });
    socket.onmessage=event=>{
      try{
        const frame=codec.decode(new Uint8Array(event.data as ArrayBuffer));
        const body=JSON.parse(toUtf8(frame.body));
        if(frame.headers[':message-type']?.value==='exception')throw new Error('AWS live transcription failed. Please retry.');
        if(body.Transcript?.Results)onText(segments.update(body.Transcript.Results));
      }catch(e){fail(e as Error);}
    };
    socket.onerror=()=>fail(new Error('Live transcription connection lost. Please record again.'));
    socket.onclose=()=>{closed=true;clean();if(finishTimer)clearTimeout(finishTimer);if(failed)return;const text=segments.text();if(!ending)fail(new Error('The microphone stream ended early. Please record again.'));else if(!text)fail(new Error('No clear speech was found. Please try again.'));else resolveDone(text);};
    context=new AudioContext({sampleRate:16000});await context.resume();
    if(failed)throw failed;
    source=context.createMediaStreamSource(media);processor=context.createScriptProcessor(2048,1,1);silent=context.createGain();silent.gain.value=0;
    processor.onaudioprocess=e=>{if(ending||failed)return;const samples=e.inputBuffer.getChannelData(0);onLevel?.(voiceLevel(samples));if(socket?.readyState!==WebSocket.OPEN)return;const pcm=pcm16(samples,context!.sampleRate);socket.send(audioEvent(pcm));};
    source.connect(processor);processor.connect(silent);silent.connect(context.destination);
    return {
      cancel:()=>{ending=true;clean();release();if(finishTimer)clearTimeout(finishTimer);socket?.close();},
      stop:async()=>{
        if(ending)throw new Error('Recording already stopped');ending=true;clean();if(failed)throw failed;if(closed)throw new Error('Microphone stream closed.');
        socket!.send(audioEvent(new Uint8Array()));
        finishTimer=setTimeout(()=>fail(new Error('AWS transcription did not finish. Please record again.')),8000);
        const transcript=await done;
        await request(`/sessions/${j.id}/stream-complete`,j.token,{jobId:ticket!.jobId,transcript,epoch});
        return ticket!.jobId;
      }
    };
  }catch(e){clean();release();socket?.close();throw e;}
}
