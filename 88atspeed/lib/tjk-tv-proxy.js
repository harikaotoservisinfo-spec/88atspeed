/**
 * TJK TV HLS proxy — tarayıcıda aynı origin üzerinden oynatma
 * Kaynak: https://tjktv-live.tjk.org/tjktv/tjktv.m3u8 (TJK resmi sayfa)
 */
const https = require('https');

const TJK_TV_ORIGIN = 'https://tjktv-live.tjk.org/tjktv/';

function fetchRemote(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; 88atspeed/1.0)',
                Accept: '*/*'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const next = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).href;
                res.resume();
                return fetchRemote(next).then(resolve).catch(reject);
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                resolve({
                    status: res.statusCode || 0,
                    headers: res.headers,
                    body: Buffer.concat(chunks)
                });
            });
        }).on('error', reject);
    });
}

function safeFileName(file) {
    const name = String(file || 'tjktv.m3u8').split('?')[0];
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
        return 'tjktv.m3u8';
    }
    return name;
}

function rewritePlaylist(text, proxyPrefix) {
    return text.split('\n').map((line) => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return line;
        let file = t;
        if (t.startsWith('http')) {
            const idx = t.indexOf('/tjktv/');
            file = idx >= 0 ? t.slice(idx + '/tjktv/'.length) : t.split('/').pop();
        }
        return proxyPrefix + encodeURIComponent(file);
    }).join('\n');
}

async function serve(res, fileName) {
    const file = safeFileName(fileName);
    const remoteUrl = TJK_TV_ORIGIN + file;
    const result = await fetchRemote(remoteUrl);
    if (result.status < 200 || result.status >= 300) {
        res.status(result.status || 502);
        return res.end('TJK TV yayını alınamadı');
    }

    if (file.endsWith('.m3u8')) {
        const proxyPrefix = '/api/public/tjk-tv?f=';
        const body = rewritePlaylist(result.body.toString('utf8'), proxyPrefix);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.send(body);
    }

    const ct = result.headers['content-type'] || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=3');
    return res.send(result.body);
}

module.exports = { serve, TJK_TV_ORIGIN };
