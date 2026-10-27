#!/usr/bin/env node
/**
 * 飞书数据底座连通性自检：验证应用凭证、表结构、读写字段格式。
 *
 * 用法：
 *   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx node scripts/feishu-smoke.js
 *   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx node scripts/feishu-smoke.js --write
 *
 * 不带 --write 只读；带 --write 会在「错题本」写入一条测试记录并删除，用来验证写入格式。
 */
var https = require('https');
var path = require('path');

var root = path.join(__dirname, '..');
var createFeishuStore = require(path.join(root, 'shared/engine/store-feishu.js')).createFeishuStore;
var config = require(path.join(root, 'cloudfunctions/api/config.js'));

var APP_ID = process.env.FEISHU_APP_ID || '';
var APP_SECRET = process.env.FEISHU_APP_SECRET || '';
var DO_WRITE = process.argv.indexOf('--write') >= 0;

if (!APP_ID || !APP_SECRET) {
    console.error('缺少凭证：请先设置 FEISHU_APP_ID / FEISHU_APP_SECRET 环境变量');
    console.error('获取方式：飞书开放平台 → 开发者后台 → 你的自建应用 → 凭证与基础信息');
    process.exit(1);
}

function request(options) {
    var body = options.body ? JSON.stringify(options.body) : null;
    return new Promise(function (resolve, reject) {
        var headers = { 'Content-Type': 'application/json; charset=utf-8' };
        if (options.token) headers.Authorization = 'Bearer ' + options.token;
        if (body) headers['Content-Length'] = Buffer.byteLength(body);
        var req = https.request({
            hostname: 'open.feishu.cn',
            path: options.path,
            method: options.method || 'GET',
            headers: headers,
            timeout: 15000
        }, function (res) {
            var chunks = '';
            res.on('data', function (c) { chunks += c; });
            res.on('end', function () {
                try {
                    resolve(JSON.parse(chunks));
                } catch (e) {
                    reject(new Error('返回非 JSON（HTTP ' + res.statusCode + '）：' + chunks.slice(0, 200)));
                }
            });
        });
        req.on('timeout', function () { req.destroy(new Error('请求超时')); });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

var cached = '';

function token() {
    if (cached) return Promise.resolve(cached);
    return request({
        method: 'POST',
        path: '/open-apis/auth/v3/tenant_access_token/internal',
        body: { app_id: APP_ID, app_secret: APP_SECRET }
    }).then(function (res) {
        if (res.code !== 0) {
            throw new Error('获取 tenant_access_token 失败：' + res.msg + '（code ' + res.code + '）');
        }
        cached = res.tenant_access_token;
        return cached;
    });
}

(async function () {
    console.log('1) 应用凭证');
    await token();
    console.log('   ok 拿到 tenant_access_token');

    var store = createFeishuStore({
        request: request,
        token: token,
        appToken: config.appToken,
        tables: config.tables
    });

    console.log('2) 读取数据表');
    var checks = [
        ['courses', '课程库'],
        ['questions', '题库'],
        ['exams', '考试配置'],
        ['students', '学员档案'],
        ['progress', '学习进度'],
        ['attempts', '考试记录'],
        ['answers', '答题明细'],
        ['wrongbook', '错题本'],
        ['certs', '证书颁发']
    ];
    for (var i = 0; i < checks.length; i++) {
        try {
            var rows = await store.find(checks[i][0], {});
            console.log('   ok ' + checks[i][1] + '：' + rows.length + ' 条');
        } catch (err) {
            console.log('   FAIL ' + checks[i][1] + '：' + (err.message || err.code));
            if (String(err.code).indexOf('1254302') >= 0 || String(err.code).indexOf('1254303') >= 0) {
                console.log('        多维表格没有把这个应用加成协作者：在表格右上角「…」→ 添加文档应用 → 选应用 → 可管理');
            }
            process.exitCode = 1;
        }
    }

    var courses = await store.find('courses', { 课程状态: '已发布' });
    if (courses.length) {
        var c = courses[0];
        console.log('3) 课程解析：' + (c['课程名称'] || '(无名称)') + ' · 课件 ' + ((c['课件附件(PPT)'] || []).length) + ' 个');
    } else {
        console.log('3) 课程解析：没有「已发布」的课程');
    }

    if (!DO_WRITE) {
        console.log('\n只读检查完成。要验证写入格式，加 --write 再跑一次。');
        return;
    }

    console.log('4) 写入回环（错题本一条测试记录）');
    var id = await store.create('wrongbook', {
        '错题记录编号': 'SMOKE-' + Date.now(),
        '知识点': '连通性测试',
        '错误次数': 1,
        '掌握状态': '未掌握',
        '最近错误时间': Date.now(),
        '连续答对次数': 0
    });
    console.log('   ok 创建记录 ' + id);

    await store.update('wrongbook', id, { '掌握状态': '复习中', '错误次数': 2 });
    console.log('   ok 更新记录');

    await store.remove('wrongbook', id);
    console.log('   ok 删除记录（已清理测试数据）');
    console.log('\n全部通过：飞书这一侧可以读写，云函数可以直接部署。');
})().catch(function (err) {
    console.error('\n失败：' + (err.message || err));
    process.exit(1);
});
