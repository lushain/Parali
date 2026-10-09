import { defineConfig, devices } from '@playwright/test';
const live=process.env.PARALI_LIVE_URL;
export default defineConfig({testDir:'tests/e2e',timeout:live?300000:60000,fullyParallel:false,use:{baseURL:live||'http://localhost:5173',trace:'retain-on-failure',screenshot:'only-on-failure'},projects:[{name:'chromium',use:{...devices['Desktop Chrome'],channel:'chrome'}}],webServer:live?undefined:{command:'npm run dev',url:'http://localhost:5173',reuseExistingServer:true,timeout:60000},reporter:[['list'],['html',{open:'never'}]]});
