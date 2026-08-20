const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    });
    const page = await browser.newPage();
    
    // 1. Koşu programı sayfasına git (07/05/2026 - Ankara)
    const url = 'https://www.tjk.org/TR/YarisSever/Info/Page/GunlukYarisProgrami?QueryParameter_Tarih=07/05/2026&Era=today';
    console.log('📄 Sayfaya gidiliyor:', url);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Sayfa yüklendikten sonra bekle (setTimeout kullan)
    await new Promise(r => setTimeout(r, 3000));
    
    // Sayfadaki koşu bilgilerini çek
    const kosuBilgileri = await page.evaluate(() => {
        const results = [];
        
        // Sayfanın tam metnini al
        const bodyText = document.body.innerText;
        const lines = bodyText.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Koşu formatı: "1. KOŞU" veya "1.KOŞU"
            if (line.match(/^\s*\d+\.\s*KOŞU/i)) {
                let mesafe = '?';
                let kosuNo = line.match(/(\d+)/)[1];
                let tamSatir = line.trim();
                
                // Sonraki 10 satırda mesafe ara
                for (let j = i; j < Math.min(i + 10, lines.length); j++) {
                    const satir = lines[j];
                    const mesafeMatch = satir.match(/(\d+)\s*[Mm]etre/);
                    const mesafeMatch2 = satir.match(/(\d+)\s*Çim/);
                    const mesafeMatch3 = satir.match(/(\d+)\s*Kum/);
                    const mesafeMatch4 = satir.match(/,\s*(\d+)\s*[Çç]im/);
                    
                    if (mesafeMatch) mesafe = mesafeMatch[1];
                    if (mesafeMatch2) mesafe = mesafeMatch2[1];
                    if (mesafeMatch3) mesafe = mesafeMatch3[1];
                    if (mesafeMatch4) mesafe = mesafeMatch4[1];
                }
                
                results.push({
                    kosuNo: kosuNo,
                    mesafe: mesafe,
                    satir: tamSatir
                });
            }
        }
        
        return results;
    });
    
    console.log('\n✅ Bulunan koşu bilgileri:');
    console.log(JSON.stringify(kosuBilgileri, null, 2));
    
    await browser.close();
})();
