/**
 * Yönetici oturumu — imzalı HttpOnly çerez (BFF-lite).
 * Üretimde ADMIN_PASSWORD ve ADMIN_SESSION_SECRET ortam değişkenlerini ayarlayın.
 */
const crypto = require('crypto');

const COOKIE_NAME = '88atspeed_admin';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const ADMIN_PAGES = new Set([
    'panel.html',
    'gosterim_full.html',
    'gosterim.html',
    'istatistikler.html',
    'istatistik-puanlama-test.html',
    'tahminim.html',
    'yonetim.html',
    'karsilastirma.html'
]);

function getSecret() {
    return process.env.ADMIN_SESSION_SECRET || '88atspeed-dev-secret-change-me';
}

function getAdminPassword() {
    return process.env.ADMIN_PASSWORD || 'yonetim2026';
}

function parseCookies(req) {
    const out = {};
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key) out[key] = decodeURIComponent(val);
    }
    return out;
}

function signSession(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
    return data + '.' + sig;
}

function verifySessionToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const dot = token.indexOf('.');
    const data = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
    try {
        const sigBuf = Buffer.from(sig);
        const expBuf = Buffer.from(expected);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    } catch (_) {
        return null;
    }
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
        if (!payload?.exp || payload.exp < Date.now()) return null;
        return payload;
    } catch (_) {
        return null;
    }
}

function isAuthenticated(req) {
    const cookies = parseCookies(req);
    return !!verifySessionToken(cookies[COOKIE_NAME]);
}

/** HTTPS veya proxy arkasında https ise Secure çerez kullan (HTTP IP erişiminde çerez kaybolmasın). */
function isSecureRequest(req) {
    if (!req) return false;
    if (req.secure) return true;
    const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    return proto === 'https';
}

function cookieSecureSuffix(req) {
    return isSecureRequest(req) ? '; Secure' : '';
}

function setSessionCookie(req, res) {
    const token = signSession({
        role: 'admin',
        iat: Date.now(),
        exp: Date.now() + MAX_AGE_MS
    });
    res.setHeader('Set-Cookie', COOKIE_NAME + '=' + encodeURIComponent(token)
        + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(MAX_AGE_MS / 1000)
        + cookieSecureSuffix(req));
}

function clearSessionCookie(req, res) {
    res.setHeader('Set-Cookie', COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
        + cookieSecureSuffix(req));
}

function requireAdmin(req, res, next) {
    if (isAuthenticated(req)) return next();
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ success: false, error: 'Yönetici oturumu gerekli' });
    }
    return res.redirect('/yonetim');
}

function guardAdminPage(req, res, next) {
    const base = (req.path || '').split('/').pop().split('?')[0];
    if (!ADMIN_PAGES.has(base)) return next();
    if (isAuthenticated(req)) return next();
    return res.redirect('/yonetim');
}

function guardAdminApi(req, res, next) {
    const open = req.path === '/admin/login' || req.path === '/admin/session' || req.path === '/admin/logout'
        || req.path === '/calibration-bundle' || req.path === '/calibration-flat-build';
    if (open) return next();
    if (req.path.startsWith('/public/')) return next();
    if (!isAuthenticated(req)) {
        return res.status(401).json({ success: false, error: 'Yönetici oturumu gerekli' });
    }
    next();
}

module.exports = {
    COOKIE_NAME,
    ADMIN_PAGES,
    getAdminPassword,
    isAuthenticated,
    setSessionCookie,
    clearSessionCookie,
    requireAdmin,
    guardAdminPage,
    guardAdminApi
};
