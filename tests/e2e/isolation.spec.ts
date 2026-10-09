import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('independent sessions cannot see each other and provider mode is explicit',async({browser,request})=>{
  const key=await readFile('.local/setup-key','utf8');
  const live=Boolean(process.env.PARALI_LIVE_URL),api=process.env.PARALI_API_URL||'http://localhost:8787';
  const create=async()=>{const r=await request.post(api+'/api/sessions',{headers:{Authorization:`Bearer ${key}`},data:{}});expect(r.status()).toBe(201);return r.json();};
  const a=await create(),b=await create();
  const ctx=await browser.newContext({viewport:{width:390,height:844}}),farmer=await ctx.newPage();await farmer.goto(`/farmer#session=${a.session.id}&token=${a.tokens.farmer}&role=farmer`);if(live){await expect(farmer.getByRole('button',{name:'Start recording'})).toBeEnabled();await expect(farmer.getByText(/AWS connected configuration/)).toBeVisible();}else{await expect(farmer.getByRole('button',{name:'Start recording'})).toBeDisabled();await expect(farmer.getByLabel(/Typed local rehearsal/)).toBeVisible();}
  const leaked=await request.get(`${api}/api/sessions/${a.session.id}`,{headers:{Authorization:`Bearer ${b.tokens.farmer}`}});expect(leaked.status()).toBe(403);
  const buyer=await browser.newContext();const buyerPage=await buyer.newPage();await buyerPage.goto(`/buyer#session=${b.session.id}&token=${b.tokens.buyer}&role=buyer`);await expect(buyerPage.getByRole('heading',{name:'No farmer request yet.'})).toBeVisible();await expect(buyerPage.getByText(a.session.label,{exact:true})).toHaveCount(0);
  await farmer.screenshot({path:'test-results/farmer-intake.png',fullPage:true});await ctx.close();await buyer.close();
});
