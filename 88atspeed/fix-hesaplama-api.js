const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('atlar.db');

// Mevcut tabloları kontrol et
db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
    console.log('📋 Mevcut tablolar:', tables);
});

// at_verileri tablosundaki kayıtları hesaplama_kayitlari'na kopyala
db.run(`INSERT OR IGNORE INTO hesaplama_kayitlari (hipodrom, hipodrom_id, tarih, race_count, total_horses, veri, kayit_tarihi)
        SELECT hipodrom, hipodrom_id, tarih, race_count, total_horses, veri, kayit_tarihi FROM at_verileri`, (err) => {
    if (err) {
        console.log('❌ Kopyalama hatası:', err.message);
    } else {
        console.log('✅ at_verileri -> hesaplama_kayitlari kopyalandı!');
    }
    db.close();
});
