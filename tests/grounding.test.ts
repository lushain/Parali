import {it,expect} from 'vitest';
import {groundedPatch} from '../server/grounding';
import {emptyDraft,type Message} from '../shared/domain';
const last=(text:string):Message[]=>[{role:'assistant',text,source:'aws',at:''}];
it('rejects unrelated prompt examples and a question misread as a village',()=>{
 expect(groundedPatch({area:3,unit:'acre',crop:'wheat',village:'गाँव में',deadline:'2026-10-20',access:'tractor'},'तीन एकड़ गेहूं दर्ज कर लिया। आपका खेत किस गाँव में है?',[],emptyDraft())).toEqual({area:3,unit:'acre',crop:'wheat'});
});
it('accepts a named village, acreage correction and genuine vehicle access',()=>{
 expect(groundedPatch({village:'सुनाम',area:6,unit:'acre',access:'tractor'},'सुनाम गाँव में है। पाँच नहीं छह एकड़। सिर्फ ट्रैक्टर आता है।',[],emptyDraft())).toEqual({village:'सुनाम',area:6,unit:'acre',access:'tractor'});
});
it('accepts short contextual area answers but does not turn a deadline into area',()=>{
 expect(groundedPatch({area:3},'तीन',last('कितनी ज़मीन की पराली है?'),emptyDraft())).toEqual({area:3});
 expect(groundedPatch({area:10,deadline:'2026-10-20'},'दस दिन में खेत खाली चाहिए',last('खेत किस तारीख तक खाली चाहिए?'),emptyDraft())).toEqual({deadline:'2026-10-20'});
});
it('keeps corrected dates and actual relative availability',()=>{
 expect(groundedPatch({availableDate:'2026-10-10',deadline:'2026-10-20'},'आज से तैयार है दस दिन में खेत खाली चाहिए',[],emptyDraft())).toEqual({availableDate:'2026-10-10',deadline:'2026-10-20'});
});
it('accepts Nova Hindi wheat transcription variants and rejects a contradictory crop',()=>{
 for(const text of ['गेहों','गेहूँ','गेहूं','गेहुं','गेहू','gehu','wheat']){
  expect(groundedPatch({crop:'wheat'},text,last('आपकी फसल धान है या गेहूं?'),emptyDraft())).toEqual({crop:'wheat'});
  expect(groundedPatch({crop:'paddy'},text,[],emptyDraft())).toEqual({});
 }
 expect(groundedPatch({crop:'wheat'},'संगर',[],emptyDraft())).toEqual({});
 expect(groundedPatch({crop:'paddy'},'धान',[],emptyDraft())).toEqual({crop:'paddy'});
});
