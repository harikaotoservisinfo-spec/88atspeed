const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('atlar.db');

// YÖNETİM çalışmaları tablosunu güncelle (dinamik sütunlar için)
db.run(`CREATE TABLE IF NOT EXISTS yonetim_calismalari_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad TEXT,
    aciklama TEXT,
    karsilastirma_kayit_id INTEGER,
    hesaplama_kayit_id INTEGER,
    tablo_veri TEXT,
    sutun_yapisi TEXT,
    hesaplamalar TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

console.log('✅ yonetim_calismalari_v2 tablosu oluşturuldu!');
db.close();
