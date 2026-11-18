/* global fetch, setTimeout, document, innerWidth */
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
const server=spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4189'],{stdio:'ignore'});
const results=[];let browser;
try{
for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:4189');break}catch{await new Promise(r=>setTimeout(r,100))}}
browser=await chromium.launch({headless:true});mkdirSync('evidence',{recursive:true});
for(const brief of ['codebase','prerequisites','process'])for(const condition of ['baseline','guided'])for(const mobile of [false,true]){
const key=`${brief}-${condition}`,name=`${key}-${mobile?'phone':'desktop'}`;
const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},hasTouch:mobile,deviceScaleFactor:2,reducedMotion:'reduce'});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{await page.goto(`http://127.0.0.1:4189/?case=${key}`);const search=page.getByRole('searchbox');await search.fill(brief==='codebase'?'Graph':brief==='process'?'Local gate':'Typed node');await page.waitForTimeout(300);await page.locator('[data-dagr-explorer="search"] button').first().click();await page.getByRole('heading',{level:3}).waitFor();const detail=page.locator('[data-dagr-explorer="details"]');await detail.getByRole('button').filter({hasNotText:'Close'}).last().click();await page.screenshot({path:`evidence/${name}-search.png`});await detail.getByRole('button',{name:'Close',exact:true}).click();await search.fill('zzznomatch');const empty=await page.locator('[data-dagr-explorer="search-count"]').textContent();await search.fill(brief==='codebase'?'Graph':brief==='process'?'Local gate':'Typed node');await search.press('ArrowDown');await search.press('Enter');await page.getByRole('heading',{level:3}).waitFor();await page.keyboard.press('Escape');await page.getByRole('button',{name:'Outline',exact:true}).click();await page.screenshot({path:`evidence/${name}-outline.png`});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);results.push({name,empty,overflow,errors});}
catch(e){results.push({name,error:String(e),errors});}finally{await context.close()}
}
}finally{await browser?.close();server.kill();writeFileSync('evidence/results.json',JSON.stringify(results,null,2))}
