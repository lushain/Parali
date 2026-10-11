import type {Draft,Message} from '../shared/domain.js';

// Schema validation alone cannot detect copied prompt examples. Require an
// utterance/context cue before accepting each model-proposed fact category.
export function groundedPatch(patch:Partial<Omit<Draft,'locationId'>>,text:string,history:Message[],draft:Draft){
 const p={...patch},n=text.normalize('NFKC').toLowerCase(),last=history.filter(m=>m.role==='assistant').at(-1)?.text||'';
 const numeric=/[0-9०-९]|एक|दो|तीन|चार|पांच|पाँच|छह|छः|सात|आठ|नौ|दस|ग्यारह|बारह|पंद्रह|बीस|तीस|चालीस|पचास|सौ|आधा|डेढ़|ढाई|one|two|three|four|five|six|seven|eight|nine|ten/i.test(n);
 const unit=/एकड़|एकड़|एकर|हेक्टेयर|बीघा|acre|hectare|bigha/i.test(n);
 const dateCue=/तारीख|दिन|आज|कल|परसों|हफ्त|सप्ताह|महीन|खाली|तैयार|उपलब्ध|अक्टूबर|नवंबर|दिसंबर|जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|today|tomorrow|day|week|month|ready|available|clear|deadline|\d{4}-\d{2}-\d{2}/i.test(n);
 // Hindi ASR can render गेहूँ as गेहों/गेहुं. Accept those phonetic forms
 // while still requiring the farmer's words to support the proposed crop.
 if(p.crop==='wheat'&&!/गेह[ूुोौ][ंँ]?|\bwheat\b|\bgeh(?:u|oo|o)(?:n|m)?\b/i.test(n))delete p.crop;
 if(p.crop==='paddy'&&!/धान|\bpaddy\b|\brice\b|\bdhaa?n\b/i.test(n))delete p.crop;
 if(p.area!==undefined&&!(numeric&&(unit||/रकबा|ज़मीन|जमीन|क्षेत्र|area|land|कितन.*ज़मीन|कितन.*एकड़/i.test(n+' '+last)||Boolean(draft.area&&!dateCue&&/नहीं|गलत|बदल|instead|not|correction/i.test(n)))))delete p.area;
 if(p.unit!==undefined&&!unit)delete p.unit;
 if(!dateCue&&!(numeric&&/तारीख|किस.*दिन|date|when/i.test(last))){delete p.availableDate;delete p.deadline;}
 if(p.access!==undefined&&!/ट्रक|ट्रैक्टर|ट्रेक्टर|गाड़ी|गाड़ी|रास्त|सड़क|सड़क|truck|tractor|road|access/i.test(n)&&!(/ट्रक|ट्रैक्टर/i.test(last)&&/हाँ|हां|नहीं|सिर्फ|yes|no|only/i.test(n)))delete p.access;
 if(p.village!==undefined){
  const village=p.village?.normalize('NFKC').toLowerCase().trim();
  // Keep names as spoken; generic question words are not a village name.
  const content=village?.replace(/गाँव|गांव|में|है|मेरा|आपका|कौन|किस|खेत|का|की|कहाँ|village|farm|where|what|\s|[।?,.]/gi,'');
  if(!village||!n.includes(village)||!content||content.length<2||/किस|कौन|कहाँ|where|what/i.test(village))delete p.village;
 }
 return p;
}
