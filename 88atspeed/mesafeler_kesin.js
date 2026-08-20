const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    });
    const page = await browser.newPage();
    
    // Ana sayfaya git
    const url = 'https://www.tjk.org/TR/YarisSever/Info/Page/GunlukYarisProgrami?QueryParameter_Tarih=07/05/2026&Era=today';
    
    console.log('📄 Sayfa yükleniyor...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('.race-info', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 5000));
    
    // Ankara'yı seç
    await page.evaluate(() => {
        const ankaraLink = Array.from(document.querySelectorAll('.gunluk-tabs a')).find(a => a.textContent.includes('Ankara'));
        if (ankaraLink) ankaraLink.click();
    });
    
    await new Promise(r => setTimeout(r, 3000));
    
    // Doğrudan koşu kartlarından mesafeleri çek
    const mesafeler = await page.evaluate(() => {
        const sonuclar = [];
        
        // Tüm koşu bloklarını bul
        const raceBlocks = document.querySelectorAll('.race-block, .program-race, [class*="race"]');
        
        // Sayfa metninden daha hassas çekim
        const bodyText = document.body.innerText;
        
        // "ŞARTLI" ile başlayan satırlarda mesafe var
        const lines = bodyText.split('\n');
        let currentRace = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Koşu numarasını bul
            const raceMatch = line.match(/^(\d+)\.\s*Koşu\s+(\d+\.\d+)/);
            if (raceMatch) {
                currentRace = parseInt(raceMatch[1]);
            }
            
            // Mesafe bilgisi içeren satır (ŞARTLI, Handikap vb.)
            if (currentRace > 0 && (line.includes('ŞARTLI') || line.includes('Handikap')) && line.match(/(\d{3,4})\s*(Kum|Çim)/)) {
                const match = line.match(/(\d{3,4})\s*(Kum|Çim)/);
                if (match) {
                    sonuclar.push({
                        kosuNo: currentRace,
                        mesafe: match[1],
                        pist: match[2],
                        aciklama: line.substring(0, 100)
                    });
                    currentRace = 0; // Bu koşuyu işaretle
                }
            }
        }
        
        return sonuclar;
    });
    
    console.log('\n📊 ANKARA 07/05/2026 KOŞU MESAFELERİ:');
    console.log(JSON.stringify(mesafeler, null, 2));
    
    await browser.close();
})();
