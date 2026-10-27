#!/usr/bin/env node
/**
 * 工程静态自检：JSON 合法性、页面文件完整性、tabBar、组件引用、WXML 基础语法、JS 语法。
 * 运行：node scripts/check-project.js
 */
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var root = path.join(__dirname, '..');
var problems = [];
var checked = 0;

function fail(msg) {
    problems.push(msg);
}

function readJSON(file) {
    var raw = fs.readFileSync(file, 'utf8');
    try {
        return JSON.parse(raw);
    } catch (e) {
        fail('JSON 解析失败：' + rel(file) + ' -> ' + e.message);
        return null;
    }
}

function rel(file) {
    return path.relative(root, file);
}

function walk(dir, ext, out) {
    var list = fs.readdirSync(dir);
    list.forEach(function (name) {
        if (name === 'node_modules' || name === '.git' || name === '.workbuddy') return;
        var full = path.join(dir, name);
        var stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full, ext, out);
        else if (full.slice(-ext.length) === ext) out.push(full);
    });
    return out;
}

// 1. JSON
var jsonFiles = walk(root, '.json', []).filter(function (f) {
    return f.indexOf('/cloudfunctions/') < 0 || f.indexOf('package') >= 0;
});
jsonFiles.forEach(function (f) {
    readJSON(f);
    checked += 1;
});

var app = readJSON(path.join(root, 'app.json'));

// 2. 页面文件
if (app) {
    (app.pages || []).forEach(function (p) {
        ['.js', '.wxml'].forEach(function (ext) {
            var file = path.join(root, p + ext);
            if (!fs.existsSync(file)) fail('缺少页面文件：' + p + ext);
            checked += 1;
        });
        var jsonFile = path.join(root, p + '.json');
        if (fs.existsSync(jsonFile)) {
            var cfg = readJSON(jsonFile);
            if (cfg && cfg.usingComponents) {
                Object.keys(cfg.usingComponents).forEach(function (name) {
                    var p2 = cfg.usingComponents[name];
                    var target = p2.charAt(0) === '/' ? path.join(root, p2) : path.join(path.dirname(jsonFile), p2);
                    if (!fs.existsSync(target + '.js') && !fs.existsSync(target + '.wxml')) {
                        fail('页面 ' + p + ' 引用了不存在的组件：' + name + ' -> ' + p2);
                    }
                });
            }
        }
    });

    // 3. tabBar
    if (app.tabBar && app.tabBar.list) {
        app.tabBar.list.forEach(function (item) {
            if ((app.pages || []).indexOf(item.pagePath) < 0) {
                fail('tabBar 页面未在 pages 中声明：' + item.pagePath);
            }
            if (item.iconPath && !fs.existsSync(path.join(root, item.iconPath))) {
                fail('tabBar 图标不存在：' + item.iconPath);
            }
        });
    }

    if (!app.lazyCodeLoading) fail('app.json 缺少 lazyCodeLoading');
    if (!app.pages || !app.pages.length) fail('app.json pages 为空');
}

// 4. WXML 基础语法
var wxmlFiles = walk(root, '.wxml', []);
var SELF_CLOSING = ['image', 'input', 'icon', 'progress', 'switch', 'slider', 'checkbox', 'radio', 'textarea', 'import', 'include', 'wxs'];
wxmlFiles.forEach(function (file) {
    var src = fs.readFileSync(file, 'utf8');
    checked += 1;
    if (src.indexOf('?.') >= 0) fail(rel(file) + ' 含有可选链 ?.（WXML 不支持）');
    if (src.indexOf('??') >= 0) fail(rel(file) + ' 含有空值合并 ??（WXML 不支持）');
    var bindings = src.match(/\{\{[\s\S]*?\}\}/g) || [];
    bindings.forEach(function (b) {
        if (/=>/.test(b)) fail(rel(file) + ' 绑定表达式里有箭头函数：' + b.slice(0, 40));
        if (/\b(function|return|new)\b/.test(b)) fail(rel(file) + ' 绑定表达式里有语句：' + b.slice(0, 40));
    });
    // 标签配对（忽略自闭合与注释）
    var stack = [];
    var tagRe = /<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
    var match;
    var clean = src.replace(/<!--[\s\S]*?-->/g, '');
    while ((match = tagRe.exec(clean)) !== null) {
        var full = match[0];
        var tag = match[1];
        if (full.charAt(1) === '/') {
            var last = stack.pop();
            if (last !== tag) fail(rel(file) + ' 标签未正确闭合：</' + tag + '>，期望 </' + (last || '?') + '>');
        } else if (full.slice(-2) !== '/>' && SELF_CLOSING.indexOf(tag) < 0) {
            stack.push(tag);
        }
    }
    if (stack.length) fail(rel(file) + ' 存在未闭合标签：' + stack.join(','));
});

// 5. JS 语法（页面与工具脚本）
var jsFiles = walk(path.join(root, 'pages'), '.js', [])
    .concat(walk(path.join(root, 'utils'), '.js', []))
    .concat(walk(path.join(root, 'shared'), '.js', []))
    .concat(walk(path.join(root, 'config'), '.js', []))
    .concat([path.join(root, 'app.js')]);
jsFiles.forEach(function (file) {
    checked += 1;
    try {
        cp.execFileSync('node', ['--check', file], { stdio: 'pipe' });
    } catch (e) {
        fail('JS 语法错误：' + rel(file) + '\n' + String(e.stderr || e.message).split('\n').slice(0, 4).join('\n'));
    }
});

// 6. WXSS 引用
walk(root, '.wxss', []).forEach(function (file) {
    var src = fs.readFileSync(file, 'utf8');
    checked += 1;
    var re = /@import\s+["']([^"']+)["']/g;
    var m;
    while ((m = re.exec(src)) !== null) {
        var target = path.join(path.dirname(file), m[1]);
        if (!fs.existsSync(target)) fail(rel(file) + ' 的 @import 目标不存在：' + m[1]);
    }
});

console.log('检查项：' + checked);
if (problems.length === 0) {
    console.log('全部通过 ✅');
    process.exit(0);
}
console.log('发现 ' + problems.length + ' 个问题：');
problems.forEach(function (p) { console.log('  - ' + p); });
process.exit(1);
