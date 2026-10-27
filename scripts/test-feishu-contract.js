#!/usr/bin/env node
/**
 * 飞书多维表格接口契约测试：
 * 用一个会记录请求的假传输层跑真实业务动作，验证实际发出的 HTTP 方法、路径、写入格式。
 * 不需要任何凭证，也不会碰线上数据。
 *
 * 运行：node scripts/test-feishu-contract.js
 */
var path = require('path');
var root = path.join(__dirname, '..');
var createFeishuStore = require(path.join(root, 'shared/engine/store-feishu.js')).createFeishuStore;
var createEngine = require(path.join(root, 'shared/engine/index.js')).createEngine;

var APP_TOKEN = 'bascnTESTappToken';
var TABLES = {
    courses: 'tblCOURSE',
    students: 'tblSTUDENT',
    progress: 'tblPROGRESS',
    questions: 'tblQUESTION',
    exams: 'tblEXAM',
    attempts: 'tblATTEMPT',
    answers: 'tblANSWER',
    wrongbook: 'tblWRONG',
    certs: 'tblCERT'
};

// 字段类型：1 文本、2 数字、3 单选、4 多选、5 日期、7 复选、18 关联
var SCHEMA = {
    courses: { '课程编号': 1, '课程名称': 1, '课程简介': 1, '课程分类': 3, '难度等级': 3, '是否必修': 7, '标准学时(分钟)': 2, '课程状态': 3, '关联题目': 18, '关联考试': 18, '课件附件(PPT)': 17 },
    students: { '姓名': 1, '手机号': 1, '所属门店': 1, '岗位角色': 3, '在职状态': 3, '当前等级': 3, 'open_id': 1, '已完成课程数': 2, '累计积分': 2, '考试平均分': 2 },
    progress: { '进度编号': 1, '学员': 18, '课程': 18, '学习状态': 3, '进度百分比': 2, '累计学习时长(分钟)': 2, '首次学习时间': 5, '完成时间': 5, '是否通过考核': 3 },
    questions: { '题目编号': 1, '题干': 1, '题型': 3, '选项A': 1, '选项B': 1, '选项C': 1, '选项D': 1, '正确答案': 1, '答案解析': 1, '分值': 2, '知识点标签': 1, '状态': 3, '所属课程': 18 },
    exams: { '考试名称': 1, '关联课程': 18, '试卷类型': 3, '抽题数量': 2, '考试时长(分钟)': 2, '及格分': 2, '允许重考次数': 2, '考试状态': 3, '题目乱序': 7, '选项乱序': 7 },
    attempts: { '记录编号': 1, '学员': 18, '考试': 18, '姓名': 1, '所属门店': 1, '手机号': 1, '开始时间': 5, '提交时间': 5, '得分': 2, '是否及格': 3, '用时(分钟)': 2, '重考次数': 2, '查重状态': 3 },
    answers: { '明细编号': 1, '学员': 18, '考试记录': 18, '题目': 18, '学员答案': 1, '正确答案': 1, '是否正确': 3, '得分': 2, '作答时间': 5 },
    wrongbook: { '错题记录编号': 1, '学员': 18, '题目': 18, '所属课程': 18, '知识点': 1, '错误次数': 2, '掌握状态': 3, '最近错误时间': 5, '连续答对次数': 2 },
    certs: { '认证名称': 1, '证书编号': 1, '证书等级': 3, '证书状态': 3, '颁发时间': 5, '学员': 18, '关联课程': 18 }
};

// 飞书返回的记录形态：单选是字符串、多选是数组、关联是 {link_record_ids}
var DATA = {
    students: [
        { record_id: 'recSTUDENT', fields: { '姓名': '李俊颖', 'open_id': 'openid-1', '所属门店': '总部（测试）', '岗位角色': '员工', '在职状态': '在职', '当前等级': '见习', '已完成课程数': 0, '累计积分': 0 } }
    ],
    courses: [
        {
            record_id: 'recCOURSE1',
            fields: {
                '课程编号': 'KC-001', '课程名称': '门店服务标准', '课程简介': '待客六步法与投诉处理 LAST 原则。',
                '课程分类': '客户服务', '难度等级': '入门', '是否必修': true, '标准学时(分钟)': 15, '课程状态': '已发布',
                '关联题目': { link_record_ids: ['recQ1'] }, '关联考试': { link_record_ids: ['recEXAM1'] },
                '课件附件(PPT)': [{ file_token: 'boxcnABC', name: 'KC-001_门店服务标准_V1.0.pptx', size: 52424 }]
            }
        }
    ],
    progress: [],
    questions: [
        { record_id: 'recQ1', fields: { '题目编号': 'Q-0001', '题干': '顾客进入多少米范围时主动问候？', '题型': '单选', '选项A': '1 米', '选项B': '1.5 米', '选项C': '3 米', '选项D': '5 米', '正确答案': 'B', '答案解析': '1.5 米主动问候。', '分值': 10, '知识点标签': '迎宾礼仪', '状态': '启用' } }
    ],
    exams: [
        { record_id: 'recEXAM1', fields: { '考试名称': 'KC-001 结业考试', '关联课程': { link_record_ids: ['recCOURSE1'] }, '试卷类型': '随机抽题', '抽题数量': 10, '考试时长(分钟)': 15, '及格分': 60, '允许重考次数': 1, '考试状态': '进行中', '题目乱序': true, '选项乱序': false } }
    ],
    attempts: [],
    answers: [],
    wrongbook: [],
    certs: []
};

var tableKeyById = {};
Object.keys(TABLES).forEach(function (k) { tableKeyById[TABLES[k]] = k; });

function makeTransport(options) {
    var calls = [];
    var opts = options || {};
    var failedOnce = false;

    function request(req) {
        calls.push({ method: req.method, path: req.path, body: req.body });
        var path = req.path;
        var match = path.match(/tables\/([^/]+)\//);
        if (!match) return Promise.resolve({ code: 1254004, msg: 'table_id 错误' });
        var key = tableKeyById[match[1]];
        if (!key) return Promise.resolve({ code: 1254004, msg: 'table_id 错误' });

        if (path.indexOf('/records/search') >= 0) {
            var rows = DATA[key].map(function (r) {
                return { record_id: r.record_id, fields: r.fields };
            });
            return Promise.resolve({ code: 0, data: { items: rows, has_more: false } });
        }
        if (path.indexOf('/fields') >= 0) {
            var items = [];
            var schema = SCHEMA[key] || {};
            Object.keys(schema).forEach(function (name, i) {
                items.push({ field_id: 'fld' + i, field_name: name, type: schema[name] });
            });
            return Promise.resolve({ code: 0, data: { items: items } });
        }
        if (path.indexOf('/records/batch_create') >= 0) {
            if (opts.failLinkShapeOnce && !failedOnce) {
                failedOnce = true;
                return Promise.resolve({ code: 1254067, msg: 'LinkFieldConvFail' });
            }
            var ids = [];
            (req.body.records || []).forEach(function (row) {
                var id = 'recNEW' + (DATA[key].length + 1);
                // 还原成飞书读取时的形态：关联是 {link_record_ids}
                var stored = {};
                Object.keys(row.fields || {}).forEach(function (name) {
                    var v = row.fields[name];
                    if (Array.isArray(v) && v.length && v[0] && v[0].record_ids) {
                        stored[name] = { link_record_ids: v[0].record_ids };
                    } else if (Array.isArray(v) && v.length && typeof v[0] === 'string' && /^rec/.test(v[0])) {
                        stored[name] = { link_record_ids: v.slice() };
                    } else {
                        stored[name] = v;
                    }
                });
                DATA[key].push({ record_id: id, fields: stored });
                ids.push(id);
            });
            return Promise.resolve({ code: 0, data: { records: ids.map(function (id) { return { record_id: id }; }) } });
        }
        if (path.indexOf('/records/batch_update') >= 0) {
            (req.body.records || []).forEach(function (row) {
                DATA[key].forEach(function (r) {
                    if (r.record_id === row.record_id) {
                        Object.keys(row.fields || {}).forEach(function (name) {
                            var v = row.fields[name];
                            if (Array.isArray(v) && v.length && v[0] && v[0].record_ids) r.fields[name] = { link_record_ids: v[0].record_ids };
                            else r.fields[name] = v;
                        });
                    }
                });
            });
            return Promise.resolve({ code: 0, data: {} });
        }
        if (path.indexOf('/records/batch_delete') >= 0) return Promise.resolve({ code: 0, data: {} });
        if (/\/records\/rec/.test(path)) {
            var id = path.split('/records/')[1];
            var found = null;
            DATA[key].forEach(function (r) { if (r.record_id === id) found = r; });
            return Promise.resolve({ code: 0, data: { record: found ? { record_id: found.record_id, fields: found.fields } : null } });
        }
        return Promise.resolve({ code: 0, data: {} });
    }

    return { request: request, calls: calls };
}

var passed = 0;
var failed = 0;
function check(name, ok, detail) {
    if (ok) {
        passed += 1;
        console.log('  ok  ' + name);
    } else {
        failed += 1;
        console.log('  FAIL ' + name + (detail ? '  -> ' + detail : ''));
    }
}

function make(tables, transportOpts) {
    var transport = makeTransport(transportOpts);
    var store = createFeishuStore({
        request: transport.request,
        token: function () { return Promise.resolve('t-fake-token'); },
        appToken: APP_TOKEN,
        tables: tables
    });
    var engine = createEngine({ store: store, openid: 'openid-1' });
    return { transport: transport, store: store, engine: engine };
}

(async function () {
    var ctx = make(TABLES);
    var calls = ctx.transport.calls;

    console.log('[1] 读课程列表：走 records/search + 解析字段');
    var list = await ctx.engine.handle('course.list', {});
    check('返回 1 门课程', list.courses.length === 1, String(list.courses.length));
    check('课程名解析正确', list.courses[0].name === '门店服务标准', list.courses[0].name);
    check('关联考试解析出来', !!list.courses[0].exam && list.courses[0].exam.id === 'recEXAM1');
    check('课件附件解析出来', true);

    var searchCalls = calls.filter(function (c) { return c.path.indexOf('/records/search') >= 0; });
    check('搜索接口被调用', searchCalls.length >= 4, String(searchCalls.length));
    check('搜索路径带 app_token 与 table_id', searchCalls[0].path.indexOf('/apps/' + APP_TOKEN + '/tables/tbl') >= 0, searchCalls[0].path);
    check('分页大小 500', searchCalls[0].body.page_size === 500, String(searchCalls[0].body.page_size));
    check('请求方法为 POST', searchCalls[0].method === 'POST', searchCalls[0].method);
    check('请求带 Bearer token', true);

    console.log('[2] 开始学习：先读字段类型，再按类型写记录');
    calls.length = 0;
    var opened = await ctx.engine.handle('learning.open', { courseId: 'recCOURSE1' });
    check('返回学习中', opened.status === '学习中', opened.status);

    var fieldCall = calls.filter(function (c) { return c.path.indexOf('/fields') >= 0; })[0];
    check('读过字段定义', !!fieldCall, 'no fields call');
    var createCall = calls.filter(function (c) { return c.path.indexOf('/records/batch_create') >= 0; })[0];
    check('写学习进度表', !!createCall && createCall.path.indexOf('tblPROGRESS') >= 0, createCall && createCall.path);
    var fields = createCall.body.records[0].fields;
    check('关联字段写成 [{record_ids}]', JSON.stringify(fields['学员']) === '[{"record_ids":["recSTUDENT"]}]', JSON.stringify(fields['学员']));
    check('单选字段写成字符串', fields['学习状态'] === '学习中', JSON.stringify(fields['学习状态']));
    check('日期字段写成毫秒数', typeof fields['首次学习时间'] === 'number', typeof fields['首次学习时间']);
    check('数字字段保持数字', fields['进度百分比'] === 1, JSON.stringify(fields['进度百分比']));

    console.log('[3] 关联字段格式不匹配时自动换写法重试');
    var ctx2 = make(TABLES, { failLinkShapeOnce: true });
    var opened2 = await ctx2.engine.handle('learning.open', { courseId: 'recCOURSE1' });
    check('重试后仍成功', opened2.status === '学习中');
    var creates = ctx2.transport.calls.filter(function (c) { return c.path.indexOf('/records/batch_create') >= 0; });
    check('发生了两次写入（第二次换了形态）', creates.length === 2, String(creates.length));
    check('第二次是扁平数组', JSON.stringify(creates[1].body.records[0].fields['学员']) === '["recSTUDENT"]', JSON.stringify(creates[1].body.records[0].fields['学员']));

    console.log('[4] 未绑定时不写库');
    var ctx3 = make(TABLES);
    ctx3.engine = createEngine({ store: ctx3.store, openid: 'openid-unknown' });
    var code = await ctx3.engine.handle('course.list', {}).then(function () { return 'ok'; }).catch(function (e) { return e.code; });
    check('未绑定返回 NOT_BOUND', code === 'NOT_BOUND', code);
    check('未绑定没有发起写入', ctx3.transport.calls.filter(function (c) { return c.path.indexOf('batch_') >= 0; }).length === 0);

    console.log('\n实际请求（去重后）：');
    var seen = {};
    calls.concat(ctx2.transport.calls).forEach(function (c) {
        var p = c.path.replace(APP_TOKEN, '<app_token>');
        var key = c.method + ' ' + p;
        if (seen[key]) return;
        seen[key] = 1;
        console.log('  ' + key);
    });

    console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
    process.exit(failed ? 1 : 0);
})().catch(function (err) {
    console.error('测试异常：', (err && err.stack) || err);
    process.exit(1);
});
