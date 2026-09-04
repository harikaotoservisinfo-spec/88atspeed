/**
 * Sunucuda Chrome/Chromium yolu — Puppeteer için.
 */
const fs = require('fs');

const CANDIDATES = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/local/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium'
];

function resolveChromePath() {
    for (const p of CANDIDATES) {
        if (!p) continue;
        try {
            if (fs.existsSync(p)) return p;
        } catch (_) { /* */ }
    }
    return null;
}

module.exports = { resolveChromePath, CANDIDATES };
