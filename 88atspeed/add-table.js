const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('atlar.db');

// YÖNETİM çalışmaları için tablo
db.run(`CREATE TABLE IF NOT EXISTS yonetim_calismalari (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad TEXT,
    aciklama TEXT,
    kaynak_kayit_id INTEGER,
    kaynak_tur TEXT,
    tablo_veri TEXT,
    hesaplamalar TEXT,
    sutunlar TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

console.log('✅ yonetim_calismalari tablosu oluşturuldu!');
db.close();
