const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    });
    const page = await browser.newPage();
    
    const url = 'https://www.tjk.org/TR/YarisSever/Info/Page/GunlukYarisProgrami?QueryParameter_Tarih=07/05/2026&Era=today';
    
    console.log('📄 Sayfa yükleniyor...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('.gunluk-tabs', { timeout: 10000 });
    
    // Ankara'ya tıkla
    await page.evaluate(() => {
        const tabs = document.querySelectorAll('.gunluk-tabs a');
        for (let tab of tabs) {
            if (tab.textContent.includes('Ankara')) {
                tab.click();
                break;
            }
        }
    });
    
    await new Promise(r => setTimeout(r, 5000));
    
    // Sayfanın HTML'ini kaydet
    const html = await page.content();
    fs.writeFileSync('ankara_sayfa.html', html);
    
    // Ayrıca tüm metni al ve göster
    const text = await page.evaluate(() => document.body.innerText);
    console.log('\n📄 SAYFA METNİ (ilk 3000 karakter):');
    console.log(text.substring(0, 3000));
    
    console.log('\n✅ HTML dosyası kaydedildi: ankara_sayfa.html');
    await browser.close();
})();
