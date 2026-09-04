#!/usr/bin/env node
const html = await fetch('https://www.bitalih.com/at-yarisi/tjk-sabit-ihtimalli-bahis').then((r) => r.text());
const re = /"(\/_next\/static\/chunks\/[^"]+\.js)"/g;
const chunks = [...new Set([...html.matchAll(re)].map((m) => m[1]))];
console.log('chunks:', chunks.length);
for (const c of chunks.slice(0, 25)) {
    const js = await fetch('https://www.bitalih.com' + c).then((r) => r.text()).catch(() => '');
    const apis = [...new Set([...js.matchAll(/["'](\/api\/[^"']+)["']/g)].map((m) => m[1]))];
    const bets = apis.filter((a) => /bet|kupon|ticket|play|wager|slip|stake|coupon|fixo/i.test(a));
    if (bets.length) {
        console.log('\n' + c.split('/').pop());
        bets.forEach((b) => console.log(' ', b));
    }
}
