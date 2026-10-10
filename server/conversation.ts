import { indiaToday, type Draft } from '../shared/domain.js';

// The LLM interprets speech. Conversation control uses the *merged* validated
// facts so a fluent but contradictory model reply cannot re-ask a known field.
export function nextReply(before:Draft, after:Draft, clarify?:string) {
  const crop=after.crop==='paddy'?'धान':after.crop==='wheat'?'गेहूँ':'';
  const unit=after.unit==='acre'?'एकड़':'हेक्टेयर';
  let acknowledgement='';
  if(after.area&&after.unit&&(before.area!==after.area||before.unit!==after.unit)) acknowledgement=`ठीक है, ${after.area} ${unit}${crop?' '+crop:''} दर्ज कर लिया। `;
  else if(after.crop&&before.crop!==after.crop) acknowledgement=`ठीक है, ${crop} की पराली। `;
  else if(after.village&&before.village!==after.village) acknowledgement=`${after.village} दर्ज कर लिया। `;
  const questions:Record<string,string>={
    crop:'पराली धान की है या गेहूँ की?',area:'कितनी ज़मीन की पराली है?',unit:'यह रकबा एकड़ में है या हेक्टेयर में?',
    village:'आपका खेत किस गाँव में है?',availableDate:'पराली उठाने के लिए किस तारीख से तैयार होगी?',
    deadline:'खेत किस तारीख तक खाली चाहिए?',access:'खेत तक ट्रक पहुँच सकता है या सिर्फ़ ट्रैक्टर?'
  };
  if(clarify&&clarify!=='none'&&questions[clarify]&&after[clarify as keyof Draft]===null){
    const specific=clarify==='unit'?'बीघा का माप जगह के हिसाब से बदलता है। कृपया रकबा एकड़ या हेक्टेयर में बताइए।':questions[clarify];
    return acknowledgement+specific;
  }
  if(after.availableDate&&after.availableDate<indiaToday()) return acknowledgement+'पराली आज से किस तारीख को उठाई जा सकती है?';
  if(after.availableDate&&after.deadline&&after.deadline<after.availableDate) return acknowledgement+'खाली करने की तारीख, पराली तैयार होने से पहले है। खेत किस तारीख तक खाली चाहिए?';
  for(const key of ['crop','area','unit','village','availableDate','deadline','access'] as const) if(after[key]===null) return acknowledgement+questions[key];
  if(!after.locationId) return acknowledgement+'जानकारी पूरी है। नीचे अपना डेमो खेत चुनकर विवरण की पुष्टि कर दीजिए।';
  return acknowledgement+'सारी जानकारी दर्ज है। नीचे विवरण जाँचकर अनुरोध की पुष्टि कर दीजिए।';
}
