// Convert generated Polly audio to the microphone upload format for integration QA.
// This is synthetic audio and is not evidence of a human microphone exchange.
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const mp3=await readFile('.local/live-polly-reply.mp3');
const browser=await chromium.launch({channel:'chrome'});
try{
  const page=await browser.newPage();
  const samples=await page.evaluate(async encoded=>{
    const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    const decoder=new AudioContext();
    const decoded=await decoder.decodeAudioData(bytes.buffer);
    const renderer=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000);
    const source=renderer.createBufferSource();source.buffer=decoded;source.connect(renderer.destination);source.start();
    const rendered=await renderer.startRendering();await decoder.close();
    return Array.from(rendered.getChannelData(0));
  },mp3.toString('base64'));
  const wav=Buffer.alloc(44+samples.length*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples.length*2,40);
  samples.forEach((sample,i)=>wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,sample))*(sample<0?32768:32767)),44+i*2));
  await writeFile('.local/synthetic-polly.wav',wav);
  console.log(`Synthetic Polly WAV: ${(samples.length/16000).toFixed(2)} seconds, 16 kHz mono PCM`);
}finally{await browser.close();}
