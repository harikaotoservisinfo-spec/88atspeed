/**
 * Kişisel Bi'Talih otomasyon ayarları — data/bitalih-auto-config.json (gitignore) veya env.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'bitalih-auto-config.json');

const DEFAULT_BET = {
    city: 'Bursa',
    raceNo: 1,
    horseName: 'LA BOMBONERA',
    betType: 'ilk2',
    stake: 20
};

function loadJsonFile(file) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (_) { /* */ }
    return null;
}

function getAutoConfig() {
    const fileCfg = loadJsonFile(CONFIG_FILE) || {};
    const bet = Object.assign({}, DEFAULT_BET, fileCfg.bet || {});

    const username = String(
        fileCfg.username || fileCfg.ssn || fileCfg.tc
        || process.env.BITALIH_USER || process.env.BITALIH_SSN || ''
    ).trim();

    const password = String(
        fileCfg.password || fileCfg.pass
        || process.env.BITALIH_PASS || process.env.BITALIH_PASSWORD || ''
    ).trim();

    const autoPlayOnLoad = fileCfg.autoPlayOnLoad !== false
        && process.env.BITALIH_AUTO_PLAY !== '0'
        && process.env.BITALIH_AUTO_PLAY !== 'false';

    return {
        enabled: fileCfg.enabled !== false,
        username,
        password,
        hasCredentials: !!(username && password),
        autoLoginOnLoad: fileCfg.autoLoginOnLoad !== false,
        autoPlayOnLoad,
        autoPlayDryRun: fileCfg.autoPlayDryRun === true
            || process.env.BITALIH_AUTO_DRY_RUN === '1',
        bet
    };
}

function getPublicAutoSetup() {
    const cfg = getAutoConfig();
    return {
        success: true,
        enabled: cfg.enabled,
        hasCredentials: cfg.hasCredentials,
        autoLoginOnLoad: cfg.autoLoginOnLoad,
        autoPlayOnLoad: cfg.autoPlayOnLoad,
        autoPlayDryRun: cfg.autoPlayDryRun,
        username: cfg.username,
        password: cfg.password,
        bet: cfg.bet
    };
}

module.exports = {
    CONFIG_FILE,
    DEFAULT_BET,
    getAutoConfig,
    getPublicAutoSetup
};
