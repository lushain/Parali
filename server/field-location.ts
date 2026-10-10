import {randomUUID} from 'node:crypto';
import {demoField,confirmsField} from '../shared/field-location.js';
import {draftIssues} from '../shared/domain.js';
import {AppError,type Stored} from './store.js';
// DynamoDB map attributes have no stable key order. Compare values canonically.
const draftSnapshot=(draft:Stored['draft'])=>JSON.stringify(Object.fromEntries(Object.entries(draft).sort(([a],[b])=>a.localeCompare(b))));
export function showField(s:Stored){
 if(s.request)throw new AppError(409,'This request is already published.');
 const issues=draftIssues({...s.draft,locationId:demoField.id});if(issues.length)throw new AppError(400,'Complete field details before confirming the map. '+issues.join('; '));
 s.fieldPreview={id:randomUUID(),epoch:s.epoch,draft:draftSnapshot(s.draft),expiresAt:Date.now()+300000,afterUserKey:s.sonicLease?.userTurn};
}
export function confirmField(s:Stored,previewId:string|undefined,text?:string){
 const p=s.fieldPreview;
 if(s.request||!p||p.id!==previewId||p.epoch!==s.epoch||p.expiresAt<Date.now()||p.draft!==draftSnapshot(s.draft))throw new AppError(409,'Field details or map confirmation changed. Open the map again before sending.');
 const latestUser=s.messages.filter(m=>m.role==='user').at(-1);
 if(text!==undefined&&(!latestUser||s.sonicLease?.userTurn===p.afterUserKey||latestUser.text.trim()!==text.trim()))throw new AppError(400,'A new answer after showing the map is required.');
 if(text!==undefined&&!confirmsField(text))throw new AppError(400,'Please clearly confirm the displayed field. Nothing was sent.');
 const draft={...s.draft,locationId:demoField.id};const issues=draftIssues(draft);if(issues.length)throw new AppError(400,issues.join('; '));
 s.draft=draft;s.request={id:'PR-'+randomUUID().slice(0,8).toUpperCase(),status:'open',draft:structuredClone(draft),createdAt:new Date().toISOString()};delete s.fieldPreview;
 s.events.push({id:randomUUID(),at:new Date().toISOString(),text:`${s.request.id} · Farmer confirmed the highlighted Kheri demo field and sent the request`,kind:'user'});
}
export function fieldInstruction(s:Stored){
 if(s.request)return 'The farmer explicitly confirmed the displayed demo field. The request was sent successfully. Say in Hindi: आपका अनुरोध भेज दिया है। No real pickup is booked. Do not ask more intake questions.';
 if(s.fieldPreview&&s.fieldPreview.draft===draftSnapshot(s.draft)&&s.fieldPreview.expiresAt>Date.now())return 'The satellite map and full request summary are visible. Ask: आपका खेत यह है? हाँ कहेंगे तो ये विवरण भेज दूँगी। This is the highlighted Kheri DEMO field, not GPS detection. After a clear yes call confirm_demo_field. A no or correction must not send anything.';
 if(!draftIssues({...s.draft,locationId:demoField.id}).length)return 'All intake facts are ready. Ask in Hindi: खेत का नक्शा देखने के लिए लोकेशन की अनुमति देंगे? डेमो में खेड़ी गाँव का खेत दिखेगा। Only after the farmer agrees, call open_demo_field. Never confirm or send before the map is visible and the farmer answers the field confirmation question.';
 return 'Only acknowledge saved fields. Ask one missing detail. Collect village, crop, area/unit, available date, deadline and access before offering the location permission step.';
}
