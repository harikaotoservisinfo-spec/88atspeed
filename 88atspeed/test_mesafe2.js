const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://www.tjk.org/TR/YarisSever/Info/Page/GunlukYarisProgrami?QueryParameter_Tarih=07/05/2026&SehirId=5&SehirAdi=Ankara&RaceNo=1&Era=today', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    const mesafe = await page.evaluate(() => {
        const imgs = document.querySelectorAll('img');
        for (let img of imgs) {
            if (img.src && img.src.includes('pistSemalari')) {
                const match = img.src.match(/\d+_(\d+)_\d+\.png/);
                if (match) return match[1];
            }
        }
        return 'Bulunamadı';
    });

    console.log('1. Koşu Mesafesi:', mesafe, 'metre');
    await browser.close();
})();
