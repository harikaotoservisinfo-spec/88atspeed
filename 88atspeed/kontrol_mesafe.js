const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    for (let kosuNo = 1; kosuNo <= 3; kosuNo++) {
        const url = `https://www.tjk.org/TR/YarisSever/Info/Page/GunlukYarisProgrami?QueryParameter_Tarih=07/05/2026&SehirId=5&SehirAdi=Ankara&RaceNo=${kosuNo}&Era=today`;
        
        console.log(`\n🔍 ${kosuNo}. Koşu için URL: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));
        
        const bilgi = await page.evaluate((kosuNo) => {
            // Tüm resimleri bul
            const imgs = document.querySelectorAll('img');
            const pistResimleri = [];
            
            for (let img of imgs) {
                if (img.src && img.src.includes('pistSemalari')) {
                    const match = img.src.match(/\d+_(\d+)_\d+\.png/);
                    pistResimleri.push({
                        src: img.src,
                        extractedMesafe: match ? match[1] : '?'
                    });
                }
            }
            
            // Sayfadaki mesafe yazısını da ara
            const bodyText = document.body.innerText;
            const mesafeYazisi = bodyText.match(/(\d+)\s*(?:metre|METRE|Çim|Kum)/i);
            
            return {
                kosuNo: kosuNo,
                pistResimleri: pistResimleri,
                mesafeYazisi: mesafeYazisi ? mesafeYazisi[1] : 'Bulunamadı',
                sayfaBasligi: document.title
            };
        }, kosuNo);
        
        console.log(`   📸 Pist resimleri:`, bilgi.pistResimleri);
        console.log(`   📝 Sayfadaki mesafe yazısı: ${bilgi.mesafeYazisi}`);
        console.log(`   📄 Sayfa başlığı: ${bilgi.sayfaBasligi}`);
    }
    
    console.log('\n✅ Kontrol tamamlandı. Tarayıcıyı kapatmak için Enter tuşuna basın...');
    await new Promise(resolve => process.stdin.once('data', resolve));
    await browser.close();
})();
