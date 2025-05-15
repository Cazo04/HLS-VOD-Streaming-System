const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || '192.168.5.4',
    port: process.env.DB_PORT || 30036,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Kubernetes@',
    database: process.env.DB_NAME || 'p2p',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;
