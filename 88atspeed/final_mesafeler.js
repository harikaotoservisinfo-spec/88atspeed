const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    });
    const page = await browser.newPage();
    
    // Ana sayfaya git (tüm koşuların listelendiği sayfa)
    const url = 'https://www.tjk.org/TR/YarisSever/Info/Page/GunlukYarisProgrami?QueryParameter_Tarih=07/05/2026&Era=today';
    
    console.log('📄 Ana sayfa yükleniyor...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // AJAX ile yüklenen içeriği bekle
    await page.waitForSelector('.gunluk-tabs', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 3000));
    
    // Ankara hipodromuna tıkla
    await page.evaluate(() => {
        const tabs = document.querySelectorAll('.gunluk-tabs a');
        for (let tab of tabs) {
            if (tab.textContent.includes('Ankara')) {
                tab.click();
                break;
            }
        }
    });
    
    // İçeriğin yüklenmesini bekle
    await new Promise(r => setTimeout(r, 5000));
    
    // Şimdi tüm koşuların mesafelerini çek
    const mesafeler = await page.evaluate(() => {
        const sonuclar = [];
        const text = document.body.innerText;
        const lines = text.split('\n');
        
        let currentRace = null;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Koşu başlığını bul (örn: "1. Koşu 17.45")
            const raceMatch = line.match(/^(\d+)\.\s*Koşu\s+(\d+\.\d+)/);
            if (raceMatch) {
                currentRace = parseInt(raceMatch[1]);
            }
            
            // Mesafe bilgisini içeren satır (ŞARTLI veya Handikap ile başlayan)
            if (currentRace && (line.includes('ŞARTLI') || line.includes('Handikap'))) {
                // 3 veya 4 haneli sayı + boşluk + Kum/Çim
                const mesafeMatch = line.match(/(\d{3,4})\s*(Kum|Çim)/);
                if (mesafeMatch) {
                    sonuclar.push({
                        kosuNo: currentRace,
                        mesafe: mesafeMatch[1],
                        pist: mesafeMatch[2],
                        kosuDetay: line.substring(0, 80)
                    });
                    currentRace = null; // Bu koşuyu işaretledik
                }
            }
        }
        
        return sonuclar;
    });
    
    console.log('\n📊 ANKARA 07/05/2026 KOŞU MESAFELERİ:');
    console.log(JSON.stringify(mesafeler, null, 2));
    
    await browser.close();
})();
