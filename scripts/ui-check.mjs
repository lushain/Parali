import {chromium} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
const base=process.env.UI_URL||'http://localhost:5173';
const browser=await chromium.launch({channel:'chrome'});
await mkdir('docs/screenshots',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 if(process.env.LOCAL_API)await page.route('https://*.execute-api.ap-south-1.amazonaws.com/api/**',async route=>{
  const r=await route.fetch({url:'http://127.0.0.1:8787'+new URL(route.request().url()).pathname});await route.fulfill({response:r,headers:{...r.headers(),'access-control-allow-origin':base}});
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let farmer,buyer;
 if(process.env.READ_ONLY_QA){const c=JSON.parse(await readFile(process.env.QA_FILE||'.local/voice-upgrade-check.json','utf8'));farmer=`${base}/farmer#session=${c.session.id}&token=${c.tokens.farmer}&role=farmer`;buyer=`${base}/buyer#session=${c.session.id}&token=${c.tokens.buyer}&role=buyer`;}
 else{await page.goto(base+'/#setup='+(await readFile('.local/setup-key','utf8')).trim());await page.getByRole('button',{name:'Create session'}).click();farmer=await page.getByTestId('farmer-link').getAttribute('href');buyer=await page.getByTestId('buyer-link').getAttribute('href');}
 await page.goto(farmer);
 await page.locator('.request-panel').waitFor();
 await page.screenshot({path:'docs/screenshots/fresh-farmer-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'docs/screenshots/fresh-farmer-mobile.png',fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile horizontal overflow');
 await page.setViewportSize({width:1440,height:1050});await page.goto(buyer);await page.locator('.metrics').waitFor();
 await page.screenshot({path:'docs/screenshots/fresh-buyer-desktop.png',fullPage:true});
 if(errors.length)throw Error(errors.join('; '));
 console.log('Desktop and 390px mobile captured; no overflow or page errors.');
}finally{await browser.close();}
