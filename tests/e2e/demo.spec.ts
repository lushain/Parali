import { test,expect } from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {addDays,indiaToday,emptyDraft} from '../../shared/domain';

test('direct pages share one farmer request, offer, approval, replacement and receipt without setup',async({browser,request})=>{
 const api='http://localhost:8787/api';
 const platform=await(await request.get(api+'/platform')).json();
 const state=async()=> (await request.get(`${api}/sessions/${platform.id}`,{headers:{Authorization:`Bearer ${platform.farmer}`}})).json();
 const initial=await state();await request.post(`${api}/sessions/${platform.id}/action`,{headers:{Authorization:`Bearer ${platform.farmer}`},data:{action:'reset',key:randomUUID(),epoch:initial.epoch,version:initial.version}});
 const fc=await browser.newContext({viewport:{width:390,height:844},permissions:['geolocation'],geolocation:{latitude:30.193,longitude:75.875}}),bc=await browser.newContext({viewport:{width:1440,height:1000}});
 const farmer=await fc.newPage(),buyer=await bc.newPage(),errors:string[]=[];
 for(const p of [farmer,buyer])p.on('pageerror',e=>errors.push(e.message));
 await farmer.goto('/farmer');await buyer.goto('/buyer');
 await expect(farmer.getByRole('button',{name:'फिर से शुरू करें · Reset',exact:true})).toBeVisible();
 await expect(buyer.getByRole('heading',{name:'No farmer request yet.',exact:true})).toBeVisible();
 await expect(buyer.getByRole('listitem')).toHaveCount(3);
 await expect(buyer.locator('.village-map>img')).toHaveAttribute('src','/maps/kheri-village.jpg');await expect(buyer.locator('.village-parcel')).toHaveCount(3);await expect(buyer.locator('.user-parcel,.village-user-dot')).toHaveCount(0);
 await buyer.getByRole('button',{name:'Open request from Harpreet Singh',exact:true}).click();await expect(buyer.getByRole('dialog').getByRole('heading',{name:'Harpreet Singh'})).toBeVisible();await buyer.getByRole('button',{name:'Close request',exact:true}).click();
 for(const p of [farmer,buyer]){await expect(p.getByText(/organizer|setup key|create session|\bdemo\b/i)).toHaveCount(0);}
 await farmer.getByLabel(/Typed local rehearsal/).fill('Mere paas paanch acre dhaan ki parali hai. Das din mein khet khaali chahiye.');await farmer.getByRole('button',{name:'Send typed message'}).click();await expect(farmer.getByText('5 acre',{exact:true})).toBeVisible();
 await farmer.getByLabel(/Typed local rehearsal/).fill('Paanch nahi, chhe acre');await farmer.getByRole('button',{name:'Send typed message'}).click();await expect(farmer.getByText('6 acre',{exact:true})).toBeVisible();
 await farmer.getByRole('button',{name:/Edit details/}).click();await farmer.getByLabel('Village',{exact:true}).fill('Kheri');await farmer.getByLabel('Available date',{exact:true}).fill(indiaToday());await farmer.getByLabel('Clearing deadline',{exact:true}).fill(addDays(indiaToday(),10));await farmer.getByLabel('Vehicle access',{exact:true}).selectOption('truck');await farmer.getByRole('button',{name:'Save corrections'}).click();
 await farmer.getByRole('button',{name:'हाँ, लोकेशन की अनुमति दें',exact:true}).click();await expect(farmer.getByRole('button',{name:'हाँ, यही खेत है · Send request',exact:true})).toBeEnabled({timeout:10000});await farmer.getByRole('button',{name:'हाँ, यही खेत है · Send request',exact:true}).click();
 await expect(farmer.getByRole('heading',{name:'Vyom Bhatnagar',exact:true})).toBeVisible();await expect(buyer.getByRole('button',{name:'Open latest request from Vyom Bhatnagar',exact:true})).toBeVisible({timeout:10000});
 await expect(buyer.getByRole('listitem')).toHaveCount(4);await expect(buyer.getByRole('listitem').first()).toContainText('Vyom Bhatnagar');
 const parcels=await buyer.locator('.village-parcel').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {live:el.getAttribute('data-live')==='true',x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
 expect(parcels).toHaveLength(4);for(let i=0;i<parcels.length;i++)for(let j=i+1;j<parcels.length;j++){const a=parcels[i],b=parcels[j];expect(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y).toBe(true);}
 await expect(buyer.locator('.user-parcel')).toHaveCount(1);await expect(buyer.locator('.village-user-dot')).toHaveCount(1);
 await expect(buyer.locator('.village-metrics')).toContainText('15.5');await buyer.screenshot({path:'test-results/buyer-village-overview.png',fullPage:true});
 await buyer.getByRole('button',{name:'Open latest request from Vyom Bhatnagar',exact:true}).click();await expect(buyer.getByRole('button',{name:'Send offer to farmer',exact:true})).toBeVisible();
 await expect(buyer.getByRole('heading',{name:'Vyom Bhatnagar',exact:true})).toBeVisible();await expect(buyer.getByText('6 acre',{exact:true})).toBeVisible();await buyer.reload();await expect(buyer.getByRole('button',{name:'Send offer to farmer',exact:true})).toBeVisible();
 await buyer.screenshot({path:'test-results/shared-buyer-offer.png',fullPage:true});
 await buyer.getByRole('button',{name:'Send offer to farmer',exact:true}).dblclick();await expect(farmer.getByRole('button',{name:/Accept/})).toBeVisible({timeout:10000});await farmer.reload();await farmer.getByRole('button',{name:/Accept/}).click();await expect(buyer.getByRole('button',{name:'Confirm collection plan',exact:true})).toBeVisible({timeout:10000});await buyer.getByRole('button',{name:'Confirm collection plan',exact:true}).click();await expect(buyer.getByRole('button',{name:'Arrange a replacement baler'})).toBeVisible();
 await buyer.getByRole('button',{name:'Arrange a replacement baler'}).click();await expect(buyer.getByRole('button',{name:'Send replacement plan'})).toBeVisible();await buyer.getByRole('button',{name:'Send replacement plan'}).click();await expect(farmer.getByRole('button',{name:/Accept/})).toBeVisible({timeout:10000});await farmer.getByRole('button',{name:/Accept/}).click();await expect(buyer.getByRole('button',{name:'Confirm collection plan'})).toBeVisible({timeout:10000});await buyer.getByRole('button',{name:'Confirm collection plan'}).click();await buyer.getByRole('button',{name:'Mark collection complete'}).click();await expect(farmer.getByText('खेत अगली फसल के लिए तैयार है')).toBeVisible({timeout:10000});await expect(buyer.locator('.collection-receipt')).toBeVisible();await buyer.reload();await expect(buyer.locator('.collection-receipt')).toBeVisible();await buyer.screenshot({path:'test-results/shared-buyer-receipt.png',fullPage:true});
 await buyer.getByRole('button',{name:'Activity',exact:true}).click();await expect(buyer.getByText('Collection completed. Farmer receipt is ready.',{exact:true})).toBeVisible();
 await buyer.setViewportSize({width:390,height:844});await buyer.getByRole('button',{name:'Farmer requests',exact:true}).click();expect(await buyer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await buyer.screenshot({path:'test-results/shared-buyer-mobile.png',fullPage:true});
 await farmer.getByRole('button',{name:'फिर से शुरू करें · Reset',exact:true}).click();await expect(farmer.getByRole('dialog').getByText(/organizer|join link|setup key/i)).toHaveCount(0);await farmer.getByRole('button',{name:'रीसेट करें · Start fresh',exact:true}).click();await expect(farmer.locator('.draft-progress strong')).toHaveText('0/7');await expect(buyer.getByRole('heading',{name:'No farmer request yet.',exact:true})).toBeVisible({timeout:10000});
 await expect(buyer.locator('.village-parcel')).toHaveCount(3);await expect(buyer.locator('.user-parcel,.village-user-dot')).toHaveCount(0);
 expect(errors).toEqual([]);await fc.close();await bc.close();
});
