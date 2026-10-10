import 'dotenv/config';
import { checkAws,config } from '../server/aws.js';
console.log(`Read-only preflight · ${config.region} · ${config.model||'model not configured'} · ${config.voice}`);
const checks=await checkAws();for(const c of checks)console.log(`${c.ok?'PASS':'FAIL'} ${c.name}: ${c.detail}`);
console.log('These read checks do not verify inference. Use a fresh microphone turn in the app to verify Transcribe → Bedrock → Polly.');
if(checks.some(c=>!c.ok))process.exitCode=1;
