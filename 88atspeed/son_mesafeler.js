const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    });
    const page = await browser.newPage();
    
    const sonuclar = [];
    
    // Ankara için doğru URL pattern'i
    for (let kosuNo = 1; kosuNo <= 8; kosuNo++) {
        // SADECE Ankara yarışlarını gösterecek URL
        const url = `https://www.tjk.org/TR/YarisSever/Info/Page/GunlukYarisProgrami?QueryParameter_Tarih=07/05/2026&SehirId=5&SehirAdi=Ankara&RaceNo=${kosuNo}&Era=today`;
        
        console.log(`${kosuNo}. koşu taranıyor...`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
        
        // Sayfanın tamamen yüklenmesini bekle
        await page.waitForFunction(
            () => document.body.innerText.includes('Koşu') && document.body.innerText.length > 1000,
            { timeout: 15000 }
        );
        await new Promise(r => setTimeout(r, 2000));
        
        const mesafeBilgisi = await page.evaluate(() => {
            const text = document.body.innerText;
            
            // Koşu başlığını bul (örn: "1. Koşu 17.45")
            const baslikMatch = text.match(/(\d+)\.\s*Koşu\s+\d+\.\d+/);
            const baslik = baslikMatch ? baslikMatch[0] : '';
            
            // Mesafe bilgisini bul (ŞARTLI veya Handikap satırında)
            // Örnek: "ŞARTLI 5/DHÖW , 4 ve Yukarı Araplar, 58 kg, 60 kg, 1600 Kum"
            let mesafe = null;
            let pist = null;
            
            // Satır satır ara
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if ((line.includes('ŞARTLI') || line.includes('Handikap')) && line.match(/(\d{3,4})\s*(Kum|Çim)/)) {
                    const match = line.match(/(\d{3,4})\s*(Kum|Çim)/);
                    if (match) {
                        mesafe = match[1];
                        pist = match[2];
                        break;
                    }
                }
            }
            
            return { kosuNo: parseInt(baslik.split('.')[0]), mesafe, pist, baslik };
        });
        
        if (mesafeBilgisi.mesafe) {
            sonuclar.push(mesafeBilgisi);
            console.log(`   ✅ Koşu ${mesafeBilgisi.kosuNo}: ${mesafeBilgisi.mesafe} ${mesafeBilgisi.pist}`);
        } else {
            console.log(`   ❌ Koşu ${kosuNo}: Mesafe bulunamadı`);
            sonuclar.push({ kosuNo, mesafe: '?', pist: '?', baslik: 'Bulunamadı' });
        }
    }
    
    console.log('\n📊 SONUÇLAR:');
    console.log(JSON.stringify(sonuclar, null, 2));
    
    await browser.close();
})();
