const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const puppeteer=require(path.join(process.env.LOCALAPPDATA,'DesktopCommander','node_modules','puppeteer'));
(async()=>{
  const browser=await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,args:['--no-sandbox','--disable-gpu','--no-first-run']});
  try{
    const page=await browser.newPage();
    page.setDefaultTimeout(25000);
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
    const response=await page.goto('http://127.0.0.1:17891/',{waitUntil:'domcontentloaded'});
    assert.equal(response.status(),200);
    await page.waitForFunction(()=>document.querySelectorAll('#tasks tbody tr').length>0);
    await page.waitForFunction(()=>document.querySelector('#tasks thead')?.textContent.includes('加权日均'));
    assert((await page.$eval('#scope',el=>el.textContent)).includes('更新'),'refresh time absent');
    assert((await page.$eval('#metric',el=>el.textContent)).includes('工具返回 Tokens'),'token label absent');
    await page.select('#taskSort','total');
    await page.waitForFunction(()=>!document.querySelector('#tasks thead')?.textContent.includes('加权日均'));
    await page.select('#taskSort','today');
    await page.waitForFunction(()=>document.querySelector('#tasks thead')?.textContent.includes('今日值'));
    await page.select('#taskSort','week');
    await page.waitForFunction(()=>document.querySelector('#tasks thead')?.textContent.includes('7日日均'));
    await page.select('#taskSort','weighted');
    await page.waitForFunction(()=>document.querySelector('#tasks thead')?.textContent.includes('加权日均'));
    const taskText=await page.$eval('#tasks tbody',el=>el.textContent);
    assert(taskText.includes('今日') && taskText.includes('7天'),'task activity absent');
    const rows=await page.$$eval('#recent tr',trs=>trs.filter(x=>x.cells.length>1).map(x=>Date.parse(x.cells[0].textContent)));
    assert(rows.every((x,i)=>i===0||x<=rows[i-1]),'recent rows not time-sorted');
    await page.screenshot({path:'C:\\Code\\desktop-commander-claude-style\\scripts\\_17891_dashboard_20261010.png',fullPage:true});
    if(errors.length)throw new Error('page errors: '+errors.join(' | '));
    console.log(JSON.stringify({ok:true,taskRows:await page.$$eval('#tasks tbody tr',xs=>xs.length),recentRows:rows.length,scope:await page.$eval('#scope',el=>el.textContent),sortOptions:await page.$$eval('#taskSort option',xs=>xs.map(x=>x.textContent))},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
