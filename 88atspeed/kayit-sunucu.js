const express = require('express');
const app = express();
const PORT = 3027;

app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

let kayitliVeri = null;

app.post('/api/kaydet', (req, res) => {
    kayitliVeri = req.body;
    console.log('✅ Kaydedildi:', kayitliVeri.hipodrom, kayitliVeri.raceCount, 'koşu');
    res.json({ success: true });
});

app.get('/api/veri', (req, res) => {
    if (kayitliVeri) {
        res.json(kayitliVeri);
    } else {
        res.status(404).json({ success: false, error: 'Veri yok' });
    }
});

app.get('/api/at-kosulari', (req, res) => {
    const atId = req.query.id;
    console.log('At koşuları isteği:', atId);
    res.json({ success: true, kosular: [] });
});

app.listen(PORT, () => {
    console.log(`\n📀 Kayıt Sunucusu çalışıyor: http://localhost:${PORT}`);
    console.log(`✅ POST /api/kaydet - Veri kaydeder`);
    console.log(`✅ GET /api/veri - Kayıtlı veriyi getirir`);
    console.log(`✅ GET /api/at-kosulari?id=XXX - At koşularını getirir\n`);
});
