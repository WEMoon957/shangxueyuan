#!/usr/bin/env node
/**
 * 把 shared/engine 同步到云函数目录，保证小程序（演示模式）与云函数（飞书模式）跑同一套逻辑。
 * 改完 shared/engine 后执行：node scripts/sync-shared.js
 */
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var src = path.join(root, 'shared/engine');
var targets = [path.join(root, 'cloudfunctions/api/lib/engine')];

function copyDir(from, to) {
    if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach(function (name) {
        var s = path.join(from, name);
        var t = path.join(to, name);
        var stat = fs.statSync(s);
        if (stat.isDirectory()) {
            copyDir(s, t);
        } else if (name.slice(-3) === '.js') {
            fs.copyFileSync(s, t);
            console.log('  -> ' + path.relative(root, t));
        }
    });
}

console.log('同步 shared/engine：');
targets.forEach(function (target) {
    copyDir(src, target);
});
console.log('完成。云函数目录需重新上传部署。');
