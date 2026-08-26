/**
 * Derinlik genişlet/kapat — tahmin (sticky) ve ana tablo kapsamları birbirinden bağımsız
 */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const DEPTH_EXPAND_SCOPE_TAHMIN = 'tahmin';
const DEPTH_EXPAND_SCOPE_MAIN = 'main';
const metricDepthExpanded = {};

function depthExpandStateKey(metricId, scope) {
    return (scope || DEPTH_EXPAND_SCOPE_MAIN) + ':' + metricId;
}

function isMetricDepthExpanded(metricId, scope) {
    return !!metricDepthExpanded[depthExpandStateKey(metricId, scope)];
}

function getVisibleDepth(metricId, maxDepth, scope) {
    const md = maxDepth || 0;
    if (md <= 1) return md;
    return isMetricDepthExpanded(metricId, scope) ? md : 1;
}

// Bağımsız scope testi
metricDepthExpanded[depthExpandStateKey('son8001', DEPTH_EXPAND_SCOPE_TAHMIN)] = true;
metricDepthExpanded[depthExpandStateKey('son8001', DEPTH_EXPAND_SCOPE_MAIN)] = false;

const tahminVd = getVisibleDepth('son8001', 7, DEPTH_EXPAND_SCOPE_TAHMIN);
const mainVd = getVisibleDepth('son8001', 7, DEPTH_EXPAND_SCOPE_MAIN);

if (tahminVd !== 7 || mainVd !== 1) {
    console.error('FAIL: scope bağımsızlığı', { tahminVd, mainVd });
    process.exit(1);
}

// Farklı metrik grupları da bağımsız
metricDepthExpanded[depthExpandStateKey('son8002', DEPTH_EXPAND_SCOPE_MAIN)] = true;
if (getVisibleDepth('son8001', 7, DEPTH_EXPAND_SCOPE_MAIN) !== 1) {
    console.error('FAIL: son8001 main etkilenmemeli');
    process.exit(1);
}
if (getVisibleDepth('son8002', 7, DEPTH_EXPAND_SCOPE_MAIN) !== 7) {
    console.error('FAIL: son8002 main genişlemeli');
    process.exit(1);
}

console.log('OK depth toggle scopes: tahmin/main/metrics independent');
