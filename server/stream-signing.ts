import {TranscribeClient} from '@aws-sdk/client-transcribe';
import {SignatureV4} from '@smithy/signature-v4';
import {Sha256} from '@smithy/core/checksum';
import {HttpRequest,escapeUri} from '@smithy/core/protocols';
const region=process.env.AWS_REGION||'ap-south-1';
const client=new TranscribeClient({region});
type Credentials={accessKeyId:string;secretAccessKey:string;sessionToken?:string};
// SDK signing preserves temporary tokens and applies canonical encoding once.
// Only a 60-second stream capability leaves Lambda; the signing secret stays here.
export async function signStream(credentials:Credentials,sessionId:string,now=new Date(),awsRegion=region){
 const host=`transcribestreaming.${awsRegion}.amazonaws.com`,path='/stream-transcription-websocket';
 const signer=new SignatureV4({credentials,region:awsRegion,service:'transcribe',sha256:Sha256});
 const signed=await signer.presign(new HttpRequest({protocol:'https:',hostname:host,port:8443,path,method:'GET',headers:{host:host+':8443'},query:{'language-code':'hi-IN','media-encoding':'pcm','sample-rate':'16000','session-id':sessionId}}),{expiresIn:60,signingDate:now});
 const query=Object.entries(signed.query||{}).sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${escapeUri(k)}=${escapeUri(String(v))}`).join('&');
 return `wss://${host}:8443${path}?${query}`;
}
export async function streamUrl(sessionId:string){return signStream(await client.config.credentials(),sessionId);}
