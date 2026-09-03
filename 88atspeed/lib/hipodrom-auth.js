/**
 * Hipodrom.com oturum yönetimi — API proxy (şifre saklanmaz, yalnızca token).
 */
const crypto = require('crypto');

const API_BASE = 'https://api.hipodrom.com/api/web/v1';
const COOKIE_NAME = '88atspeed_hipodrom';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();

function getSecret() {
    return process.env.HIPODROM_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET || '88atspeed-hipodrom-dev-secret';
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

function signSid(sid) {
    const sig = crypto.createHmac('sha256', getSecret()).update(sid).digest('base64url');
    return sid + '.' + sig;
}

function verifySid(token) {
    if (!token || !token.includes('.')) return null;
    const dot = token.indexOf('.');
    const sid = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac('sha256', getSecret()).update(sid).digest('base64url');
    try {
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    } catch (_) {
        return null;
    }
    return sid;
}

function setSessionCookie(req, res, sid) {
    const signed = signSid(sid);
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const parts = [
        COOKIE_NAME + '=' + encodeURIComponent(signed),
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=' + Math.floor(SESSION_MAX_AGE_MS / 1000)
    ];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const parts = [COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}

function getSession(req) {
    const cookies = parseCookies(req);
    const sid = verifySid(cookies[COOKIE_NAME]);
    if (!sid) return null;
    const entry = sessions.get(sid);
    if (!entry || entry.expiresAt < Date.now()) {
        sessions.delete(sid);
        return null;
    }
    return { sid, ...entry };
}

function createSession(tokens, user) {
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || null,
        user: user || null,
        expiresAt: Date.now() + SESSION_MAX_AGE_MS,
        createdAt: Date.now()
    });
    return sid;
}

function destroySession(sid) {
    if (sid) sessions.delete(sid);
}

async function hipodromApi(path, opts = {}) {
    const url = API_BASE + path;
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://www.hipodrom.com',
        Referer: 'https://www.hipodrom.com/',
        ...(opts.headers || {})
    };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), opts.timeoutMs || 25000);
    try {
        const res = await fetch(url, {
            method: opts.method || 'GET',
            headers,
            body: opts.body != null ? JSON.stringify(opts.body) : undefined,
            signal: controller.signal
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    } finally {
        clearTimeout(tid);
    }
}

function extractError(data) {
    const err = data?.error;
    if (!err) return 'İşlem başarısız';
    if (Array.isArray(err)) {
        const first = err[0];
        if (typeof first === 'string') return first;
        if (first?.message) return first.message;
    }
    return 'İşlem başarısız';
}

function needsCaptcha(data) {
    const msg = extractError(data).toLowerCase();
    const code = data?.error?.[0]?.code || '';
    return msg.includes('captcha') || msg.includes('recaptcha') || code.includes('1020');
}

async function login(username, password, recaptchaCode) {
    const headers = {};
    if (recaptchaCode) headers['X-G-Recaptcha'] = recaptchaCode;

    const { data } = await hipodromApi('/auth/login', {
        method: 'POST',
        headers,
        body: { username: String(username || '').trim(), password: String(password || '') }
    });

    if (!data?.success) {
        const err = new Error(extractError(data));
        err.needsCaptcha = needsCaptcha(data);
        err.code = data?.error?.[0]?.code;
        throw err;
    }

    const tokens = {
        accessToken: data.data?.accessToken,
        refreshToken: data.data?.refreshToken || null
    };
    if (!tokens.accessToken) throw new Error('Giriş yanıtında token alınamadı');
    return tokens;
}

async function fetchUserDetails(accessToken) {
    const { data } = await hipodromApi('/user/details', { token: accessToken });
    if (!data?.success) throw new Error(extractError(data));
    return data.data;
}

async function fetchUserBalance(accessToken) {
    const { data } = await hipodromApi('/user/balance', { token: accessToken });
    if (!data?.success) return null;
    return data.data;
}

async function logoutApi(accessToken) {
    if (!accessToken) return;
    try {
        await hipodromApi('/auth/logout', { method: 'DELETE', token: accessToken });
    } catch (_) { /* sessiz */ }
}

function publicUser(session) {
    const u = session.user || {};
    return {
        loggedIn: true,
        displayName: u.name || u.firstName || u.loginName || u.username || 'Üye',
        memberNo: u.memberNo || u.emn || u.id || null,
        amount: u.amount ?? null,
        bonusAmount: u.bonusAmount ?? null,
        totalAmount: u.totalAmount ?? null,
        registrationDate: u.registrationDate || null
    };
}

module.exports = {
    COOKIE_NAME,
    parseCookies,
    setSessionCookie,
    clearSessionCookie,
    getSession,
    createSession,
    destroySession,
    login,
    fetchUserDetails,
    fetchUserBalance,
    logoutApi,
    publicUser
};
