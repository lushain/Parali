import {test,expect} from '@playwright/test';

test('landing explains the mission and actual AWS architecture without opening a farmer conversation',async({page})=>{
 const apiCalls:string[]=[],errors:string[]=[];
 page.on('request',req=>{if(req.url().includes('/api/'))apiCalls.push(req.url());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toContainText('Give parali');
 await expect(page.getByText('TEAM BOARDROOM / AIR POLLUTION TRACK',{exact:true})).toBeVisible();
 await expect(page.locator('.team-people').getByRole('heading',{name:'Vyom',exact:true})).toBeVisible();await expect(page.locator('.team-people').getByRole('heading',{name:'Saqib',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Speak to Parali',exact:true})).toHaveAttribute('href','/farmer');await expect(page.getByRole('link',{name:'Explore the buyer desk',exact:true})).toHaveAttribute('href','/buyer');
 await page.getByRole('button',{name:'Pause animations',exact:true}).click();await expect(page.locator('.home')).toHaveClass(/home-paused/);
 await expect(page.locator('.home-ticker>div')).toHaveCSS('animation-play-state','paused');
 await page.locator('#architecture').scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:/^Explore /})).toHaveCount(11);
 await page.getByRole('button',{name:'Explore Amazon DynamoDB',exact:true}).click();await expect(page.locator('.arch-detail h3')).toHaveText('Amazon DynamoDB');await expect(page.locator('.arch-detail')).toContainText('2.5 seconds');
 await page.getByRole('button',{name:'Live voice',exact:true}).click();await expect(page.getByRole('button',{name:'Live voice',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Explore Amazon Bedrock · Nova 2.5 Sonic',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('.arch-detail')).toContainText('no saved conversation replay');
 await page.locator('.arch-legacy summary').click();await expect(page.locator('.legacy-body')).toBeVisible();await expect(page.locator('.legacy-body')).toContainText('It is now stopped');
 await page.locator('.arch-support summary').click();await expect(page.locator('.arch-support-items')).toContainText('Amazon Transcribe + Amazon Polly');await expect(page.locator('.arch-support-items')).toContainText('AWS CloudFormation + AWS SAM');
 expect(apiCalls).toEqual([]);expect(errors).toEqual([]);
 await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.home-ticker>div')).toHaveCSS('animation-name','none');
 await page.screenshot({path:'test-results/landing-mobile.png',fullPage:true});
});
