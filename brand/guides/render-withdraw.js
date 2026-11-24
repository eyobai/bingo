const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1760}});
await p.goto('file:///home/user/bingo/brand/guides/withdraw-guide.html');await p.waitForTimeout(800);
const h=await p.evaluate(()=>document.body.scrollHeight);console.log('content height',h);
await p.screenshot({path:'/home/user/bingo/brand/guides/withdraw-guide-1080x1760.png'});await b.close();})();
