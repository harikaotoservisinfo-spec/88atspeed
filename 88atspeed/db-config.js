const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'wp_deneme',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ MySQL veritabanına bağlandı!');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ MySQL bağlantı hatası:', error.message);
        return false;
    }
}

module.exports = { pool, testConnection };
