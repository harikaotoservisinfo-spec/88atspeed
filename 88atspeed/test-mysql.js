const mysql = require('mysql2');

async function testConnection() {
    console.log('🔍 MAMP MySQL bağlantı testi...\n');
    
    // MAMP için doğru ayarlar
    const config = {
        host: 'localhost',
        user: 'root',
        password: 'root',
        database: 'wp_deneme',
        port: 8889,
        connectTimeout: 10000
    };
    
    console.log('📡 Bağlanılıyor:', config.host + ':' + config.port);
    console.log('👤 Kullanıcı:', config.user);
    console.log('🗄️  Veritabanı:', config.database);
    
    try {
        const connection = await mysql.createConnection(config);
        const [rows] = await connection.execute('SELECT 1 as test, NOW() as time, DATABASE() as db');
        console.log('\n✅ BAĞLANTI BAŞARILI!');
        console.log('📊 Sonuç:', rows[0]);
        console.log('\n🎉 MySQL çalışıyor! Aşağıdaki ayarları kullanın:');
        console.log('----------------------------------------');
        console.log(`host: '${config.host}'`);
        console.log(`user: '${config.user}'`);
        console.log(`password: '${config.password}'`);
        console.log(`database: '${config.database}'`);
        console.log(`port: ${config.port}`);
        console.log('----------------------------------------');
        await connection.end();
        return true;
    } catch (error) {
        console.error('\n❌ BAĞLANTI HATASI:', error.message);
        console.log('\n⚠️ Alternatif ayarları deneyin:');
        console.log('1. MAMP\'i açın -> MySQL -> "Allow network access" işaretli mi?');
        console.log('2. MAMP\'te MySQL\'in çalıştığından emin olun (yeşil ışık)');
        console.log('3. Şifre "root" değilse boş deneyin: password: ""');
        return false;
    }
}

testConnection();
