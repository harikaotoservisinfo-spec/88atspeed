const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    });
    const page = await browser.newPage();
    
    const sonuclar = [];
    
    // 8 koşu için döngü
    for (let kosuNo = 1; kosuNo <= 8; kosuNo++) {
        const url = `https://www.tjk.org/TR/YarisSever/Info/Page/GunlukYarisProgrami?QueryParameter_Tarih=07/05/2026&SehirId=5&SehirAdi=Ankara&RaceNo=${kosuNo}&Era=today`;
        
        console.log(`📄 ${kosuNo}. Koşu sayfasına gidiliyor...`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));
        
        const bilgi = await page.evaluate(() => {
            let mesafe = '?';
            
            // YÖNTEM 1: Pist seması resminden mesafeyi çek
            // Örnek: "5_1000_1.png" içinden 1000'i al
            const imgElements = document.querySelectorAll('img');
            for (let img of imgElements) {
                const src = img.src;
                if (src && src.includes('pistSemalari')) {
                    const match = src.match(/\d+_(\d+)_\d+\.png$/);
                    if (match) {
                        mesafe = match[1];
                        break;
                    }
                }
            }
            
            // YÖNTEM 2: Eğer resimde bulamazsa, sayfa metninde ara
            if (mesafe === '?') {
                const bodyText = document.body.innerText;
                // "MESAFE : 1000" formatı
                let match = bodyText.match(/MESAFE\s*:\s*(\d+)/i);
                if (match) mesafe = match[1];
                
                // "1000 Çim" formatı
                if (!match) {
                    match = bodyText.match(/(\d+)\s+Çim/);
                    if (match) mesafe = match[1];
                }
                
                // "1000 Kum" formatı
                if (!match) {
                    match = bodyText.match(/(\d+)\s+Kum/);
                    if (match) mesafe = match[1];
                }
            }
            
            // Koşu başlığını bul
            const baslikMatch = document.body.innerText.match(/(\d+)\.\s*KOŞU[^\n]*/i);
            const baslik = baslikMatch ? baslikMatch[0] : '';
            
            return { 
                kosuNo, 
                mesafe, 
                baslik: baslik.substring(0, 100) 
            };
        });
        
        sonuclar.push(bilgi);
        console.log(`   ✅ Mesafe: ${bilgi.mesafe} metre`);
    }
    
    console.log('\n📊 TÜM KOŞU MESAFELERİ:');
    console.log(JSON.stringify(sonuclar, null, 2));
    
    await browser.close();
})();
