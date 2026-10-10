export const demoField={id:'sangrur-east' as const,name:'खेड़ी · संगरूर, पंजाब',englishName:'Kheri · Sangrur, Punjab',latitude:30.192787,longitude:75.873365,image:'/maps/kheri-field-parcel.jpg',position:{left:'23.9%',top:'56.9%'},presentationMs:4500};
// Accept ordinary Hindi confirmations, including a polite जी prefix.
// Full-sentence matching keeps questions, negatives and corrections from sending.
export function confirmsField(text:string){
 const reply=text.normalize('NFKC').replace(/[,،，।.!]/g,' ').replace(/\s+/g,' ').trim().replace(/^जी\s+/u,'');
 return /^(हाँ|हां|हा|हाँ जी|हां जी|हाँ यही है|हां यही है|हाँ बिल्कुल|हां बिल्कुल|जी|हाँ हाँ|हां हां|हाँ भेज दो|हां भेज दो|हाँ भेज दीजिए|हां भेज दीजिए|yes|yes this is my field|yes send it|haa|haan|ha|han|ji haan)$/iu.test(reply)
  || /^(?:(?:हाँ|हां|हा) )?(?:(?:यही|यहीं) (?:(?:मेरा|हमारा) )?खेत है|(?:मेरा|हमारा) खेत (?:यही|यहीं) है)(?: (?:अनुरोध )?भेज (?:दो|दीजिए|दें))?$/u.test(reply);
}
