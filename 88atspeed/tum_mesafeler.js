const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    });
    const page = await browser.newPage();
    
    // Ana yarış programı sayfasına git (tüm koşular burada)
    const url = 'https://www.tjk.org/TR/YarisSever/Info/Page/GunlukYarisProgrami?QueryParameter_Tarih=07/05/2026&Era=today';
    
    console.log('📄 Ana sayfaya gidiliyor...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // AJAX yüklenmesini bekle
    await page.waitForSelector('.race-info', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 5000));
    
    // Ankara hipodromuna tıkla
    await page.evaluate(() => {
        const ankaraLink = Array.from(document.querySelectorAll('.gunluk-tabs a')).find(a => a.textContent.includes('Ankara'));
        if (ankaraLink) ankaraLink.click();
    });
    
    await new Promise(r => setTimeout(r, 3000));
    
    // Tüm koşuların mesafelerini çek
    const mesafeler = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const lines = bodyText.split('\n');
        const sonuclar = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Koşu başlığını bul (örn: "1. Koşu 17.45")
            if (line.match(/^\d+\.\s*Koşu\s+\d+\.\d+/)) {
                const kosuNo = line.match(/(\d+)\./)[1];
                let mesafe = '?';
                
                // Bir sonraki satırda mesafe var
                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1];
                    const match = nextLine.match(/(\d{3,4})\s*(Kum|Çim)/);
                    if (match) {
                        mesafe = match[1];
                    }
                }
                
                sonuclar.push({ kosuNo: parseInt(kosuNo), mesafe: mesafe });
            }
        }
        
        return sonuclar;
    });
    
    console.log('\n📊 TÜM KOŞU MESAFELERİ:');
    console.log(JSON.stringify(mesafeler, null, 2));
    
    await browser.close();
})();
