const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    });
    const page = await browser.newPage();
    
    await page.goto('https://www.tjk.org/TR/YarisSever/Query/Page/YillikYarisProgrami', {
        waitUntil: 'networkidle2',
        timeout: 60000
    });
    
    // Sayfadaki tüm select elementlerini bul
    const selectors = await page.evaluate(() => {
        const selects = document.querySelectorAll('select');
        const result = [];
        for (let i = 0; i < selects.length; i++) {
            result.push({
                id: selects[i].id,
                name: selects[i].name,
                optionsCount: selects[i].options.length
            });
        }
        return result;
    });
    
    console.log('Sayfadaki select elementleri:', selectors);
    
    // Sayfadaki input elementleri
    const inputs = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input');
        const result = [];
        for (let i = 0; i < inputs.length; i++) {
            result.push({
                id: inputs[i].id,
                type: inputs[i].type,
                value: inputs[i].value
            });
        }
        return result;
    });
    
    console.log('Sayfadaki input elementleri:', inputs);
    
    console.log('\n⏳ 15 saniye bekleniyor...');
    await new Promise(r => setTimeout(r, 15000));
    await browser.close();
})();
