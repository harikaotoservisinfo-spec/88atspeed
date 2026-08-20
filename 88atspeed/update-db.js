const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('atlar.db');

// HESAPLAMA tablosu (atların 7 koşuluk verileri)
db.run(`CREATE TABLE IF NOT EXISTS hesaplama_kayitlari (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hipodrom TEXT,
    hipodrom_id TEXT,
    tarih TEXT,
    race_count INTEGER,
    total_horses INTEGER,
    veri TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// KARŞILAŞTIRMA tablosu (sıralama verileri + hesaplamalar)
db.run(`CREATE TABLE IF NOT EXISTS karsilastirma_kayitlari (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hipodrom TEXT,
    hipodrom_id TEXT,
    tarih TEXT,
    race_count INTEGER,
    total_horses INTEGER,
    siralama_veri TEXT,
    hesaplamalar TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

console.log('✅ Tablolar oluşturuldu!');
db.close();
