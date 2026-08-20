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
    
    // Tüm koşuların mesafelerini çek
    const mesafeler = await page.evaluate(() => {
        const sonuclar = [];
        const text = document.body.innerText;
        
        // Koşu bloklarını bul (her koşu "X. Koşu YY:YY" ile başlıyor)
        const kosuBloklari = text.split(/\n(?=\d+\.\s*Koşu\s+\d+\.\d+)/);
        
        for (let blok of kosuBloklari) {
            // Koşu numarasını al
            const kosuMatch = blok.match(/^(\d+)\.\s*Koşu\s+\d+\.\d+/);
            if (!kosuMatch) continue;
            
            const kosuNo = parseInt(kosuMatch[1]);
            
            // Mesafe bilgisini bul (ŞARTLI, Handikap, Maiden, vs.)
            // Pattern: "..., 1000 Çim" veya "..., 1600 Kum"
            let mesafe = null;
            let pist = null;
            
            // Farklı formatları dene
            const mesafePatterns = [
                /(\d{3,4})\s*(Çim|Kum)/,           // "1000 Çim"
                /(\d{3,4})\s*metre/i,               // "1000 metre"
                /MESAFE\s*:\s*(\d{3,4})/i           // "MESAFE: 1000"
            ];
            
            for (let pattern of mesafePatterns) {
                const match = blok.match(pattern);
                if (match) {
                    mesafe = match[1];
                    pist = match[2] || (blok.includes('Çim') ? 'Çim' : (blok.includes('Kum') ? 'Kum' : '?'));
                    break;
                }
            }
            
            if (mesafe) {
                sonuclar.push({ kosuNo, mesafe, pist });
            }
        }
        
        return sonuclar;
    });
    
    // Koşu numarasına göre sırala
    mesafeler.sort((a, b) => a.kosuNo - b.kosuNo);
    
    console.log('\n📊 ANKARA 07/05/2026 KOŞU MESAFELERİ:');
    console.log(JSON.stringify(mesafeler, null, 2));
    
    await browser.close();
})();
