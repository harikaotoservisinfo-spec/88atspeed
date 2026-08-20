const puppeteer = require("puppeteer");

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        defaultViewport: { width: 1280, height: 800 }
    });
    const page = await browser.newPage();
    
    console.log("\n🔍 Test: İlk atın koşu bilgileri sayfası inceleniyor...\n");
    
    const testAtId = "105707";
    const kosuUrl = `https://www.tjk.org/TR/YarisSever/Query/ConnectedPage/AtKosuBilgileri?QueryParameter_AtId=${testAtId}`;
    
    console.log(`📄 Sayfaya gidiliyor: ${kosuUrl}`);
    await page.goto(kosuUrl, { waitUntil: "networkidle2", timeout: 30000 });
    
    await new Promise(r => setTimeout(r, 3000));
    
    const tabloBilgisi = await page.evaluate(() => {
        const result = {
            tabloSayisi: 0,
            tumVeriler: []
        };
        
        const tables = document.querySelectorAll("table");
        result.tabloSayisi = tables.length;
        
        for (let i = 0; i < tables.length; i++) {
            const table = tables[i];
            const rows = table.querySelectorAll("tbody tr");
            
            const tabloVerisi = {
                index: i,
                satirSayisi: rows.length,
                satirlar: []
            };
            
            // Tablo başlıklarını al
            const basliklar = [];
            const thElements = table.querySelectorAll("thead th");
            thElements.forEach(th => basliklar.push(th.innerText.trim()));
            tabloVerisi.basliklar = basliklar;
            
            // Her satırdaki verileri al
            for (let j = 0; j < rows.length; j++) {
                const row = rows[j];
                const hücreler = row.querySelectorAll("td");
                const satirVerisi = {
                    satirNo: j,
                    hücreler: []
                };
                
                for (let k = 0; k < hücreler.length; k++) {
                    const hucre = hücreler[k];
                    const metin = hucre.innerText.trim();
                    const link = hucre.querySelector("a");
                    
                    satirVerisi.hücreler.push({
                        index: k,
                        metin: metin.substring(0, 100),
                        linkVar: !!link,
                        linkHref: link ? link.href.substring(0, 150) : null
                    });
                }
                
                tabloVerisi.satirlar.push(satirVerisi);
            }
            
            result.tumVeriler.push(tabloVerisi);
        }
        
        return result;
    });
    
    console.log(`\n📊 Toplam ${tabloBilgisi.tabloSayisi} tablo bulundu.\n`);
    
    for (const tablo of tabloBilgisi.tumVeriler) {
        console.log(`\n📋 TABLO ${tablo.index}:`);
        console.log(`   Başlıklar: ${tablo.basliklar.join(" | ")}`);
        console.log(`   Satır sayısı: ${tablo.satirSayisi}`);
        
        if (tablo.satirlar.length > 0) {
            console.log(`\n   İlk 3 satır:`);
            for (let s = 0; s < Math.min(tablo.satirlar.length, 3); s++) {
                const satir = tablo.satirlar[s];
                console.log(`\n   Satır ${satir.satirNo + 1}:`);
                for (const hucre of satir.hücreler) {
                    if (hucre.metin) {
                        console.log(`     Sütun ${hucre.index}: "${hucre.metin}"`);
                        if (hucre.linkVar) {
                            console.log(`        Link: ${hucre.linkHref}`);
                        }
                    }
                }
            }
        }
    }
    
    // Özellikle "16.04.2026" veya "2026" içeren metinleri ara
    const tarihArama = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const lines = bodyText.split('\n');
        const bulunanlar = [];
        
        for (let line of lines) {
            if (line.includes("2026") || line.includes("16.04") || line.includes("16/04")) {
                bulunanlar.push(line.trim().substring(0, 150));
            }
        }
        
        return bulunanlar;
    });
    
    console.log(`\n🔍 Sayfada "2026" veya "16.04" içeren metinler:`);
    if (tarihArama.length > 0) {
        tarihArama.forEach(t => console.log(`   ${t}`));
    } else {
        console.log(`   ❌ Hiç 2026 tarihi bulunamadı!`);
        console.log(`   Bu atın 2026 yılında koşusu olmayabilir.`);
    }
    
    console.log("\n✅ Analiz tamamlandı!");
    console.log("⏳ Tarayıcı 15 saniye sonra kapanacak, sayfayı manuel inceleyebilirsiniz...");
    await new Promise(r => setTimeout(r, 15000));
    
    await browser.close();
})();
