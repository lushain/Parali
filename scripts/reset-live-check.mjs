import {chromium,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const origin='https://demo.d1riy18awh1bmx.amplifyapp.com',base='https://z2egyz8hl6.execute-api.ap-south-1.amazonaws.com/api';
async function api(path,token,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(`${r.status}: ${data.error}`);return data;}
const c=await api('/sessions',(await readFile('.local/setup-key','utf8')).trim(),{});await writeFile('.local/reset-qa.json',JSON.stringify(c));let s=c.session;
async function act(action,extra={}){s=await api(`/sessions/${s.id}/action`,c.tokens.farmer,{action,key:randomUUID(),epoch:s.epoch,version:s.version,...extra});}
await act('edit',{draft:{crop:'wheat',area:3,unit:'acre',village:'Sangrur',locationId:'sangrur-east',availableDate:'2026-10-12',deadline:'2026-10-20',access:'truck'}});await act('publish');
const browser=await chromium.launch({channel:'chrome'});
try{const p=await browser.newPage({viewport:{width:1440,height:1050}}),b=await browser.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto(`${origin}/farmer#session=${s.id}&token=${c.tokens.farmer}&role=farmer`);await b.goto(`${origin}/buyer#session=${s.id}&token=${c.tokens.buyer}&role=buyer`);
await expect(p.getByRole('button',{name:'फिर से शुरू करें · Reset',exact:true})).toBeVisible();await p.screenshot({path:'docs/screenshots/reset-published-desktop.png',fullPage:true});
await p.getByRole('button',{name:'फिर से शुरू करें · Reset',exact:true}).click();await p.getByRole('button',{name:'वापस · Keep current demo',exact:true}).click();await expect(p.locator('.draft-progress strong')).toHaveText('7/7');
await p.getByRole('button',{name:'फिर से शुरू करें · Reset',exact:true}).click();await p.getByRole('button',{name:'रीसेट करें · Start fresh',exact:true}).click();await expect(p.locator('.draft-progress strong')).toHaveText('0/7');await expect(b.getByText('Your shared field is open.')).toBeVisible({timeout:10000});
await p.reload();await expect(p.locator('.draft-progress strong')).toHaveText('0/7');await expect(p.getByRole('button',{name:'Start recording',exact:true})).toBeEnabled();await p.screenshot({path:'docs/screenshots/reset-live-desktop.png',fullPage:true});
await p.setViewportSize({width:390,height:844});await p.screenshot({path:'docs/screenshots/reset-live-mobile.png',fullPage:true});if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');if(errors.length)throw Error(errors.join('; '));
const fresh=await api(`/sessions/${s.id}`,c.tokens.farmer);if(fresh.request||fresh.messages.length||fresh.epoch!==s.epoch+1)throw Error('Reset state mismatch');console.log('Live AWS reset passed: published request, cancel, start fresh, buyer sync, reload, mobile layout, mic ready. '+s.label);
}finally{await browser.close();}
