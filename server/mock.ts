import { addDays, indiaToday, type Draft } from '../shared/domain.js';
// Explicit rehearsal parser: no generated speech, no fabricated AI/cloud evidence.
export function mockProposal(text:string,draft:Draft){
  const t=text.toLowerCase();const patch:Partial<Omit<Draft,'locationId'>>={};
  if(/paddy|dhaan|dhan|धान|parali|पराली/.test(t))patch.crop='paddy';if(/wheat|गेहूं|गेहूँ/.test(t))patch.crop='wheat';
  let normalized=t;for(const [word,num] of Object.entries({paanch:5,panch:5,five:5,'पांच':5,'पाँच':5,chhe:6,che:6,six:6,'छह':6,'छः':6,ten:10,das:10,'दस':10}))normalized=normalized.replace(new RegExp(word,'g'),String(num));
  const areas=[...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(acre|acres|एकड़|hectare|hectares|हेक्टेयर)/g)];
  if(areas.length){const a=areas.at(-1)!;patch.area=+a[1];patch.unit=/hectare|हेक्टेयर/.test(a[2])?'hectare':'acre';}
  const relative=normalized.match(/(\d+)\s*(days|day|din|दिन)/);if(relative)patch.deadline=addDays(indiaToday(),+relative[1]);
  if(/today|आज|aaj/.test(t))patch.availableDate=indiaToday();
  if(/truck|ट्रक/.test(t))patch.access='truck';else if(/tractor|ट्रैक्टर/.test(t))patch.access='tractor';
  for(const name of ['Sangrur','Bhawanigarh','Sunam'])if(t.includes(name.toLowerCase()))patch.village=name;
  const d={...draft,...patch};
  const reply=!d.crop?'कौन सी फसल की पराली है?':!d.area||!d.unit?'खेत का रकबा कितना है, एकड़ या हेक्टेयर में?':!d.village?'आपका गाँव कौन सा है?':!d.availableDate?'पराली किस तारीख से उठाई जा सकती है?':!d.deadline?'खेत किस तारीख तक खाली चाहिए?':!d.access?'क्या खेत तक ट्रक पहुँच सकता है?':!d.locationId?'नीचे एक डेमो स्थान चुनें, फिर तारीख और विवरण जाँच लें।':'विवरण अपडेट हो गया है। नीचे जाँच कर अनुरोध की पुष्टि करें।';
  return {patch,reply:'[स्थानीय अभ्यास / Local rehearsal] '+reply};
}
