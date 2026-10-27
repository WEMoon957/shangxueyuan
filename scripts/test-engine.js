/**
 * 引擎自测：用内存仓库跑通「登录 → 看课 → 学习 → 考试 → 判分 → 成绩 → 错题本 → 证书」。
 * 运行：node scripts/test-engine.js
 */
var path = require('path');
var fs = require('fs');

var root = path.join(__dirname, '..');
var lib = require(path.join(root, 'shared/engine/index.js'));
var memory = require(path.join(root, 'shared/engine/store-memory.js'));

var seed = JSON.parse(fs.readFileSync(path.join(root, 'shared/seed/data.json'), 'utf8'));
var openid = seed.students[0].open_id;
var store = memory.createMemoryStore({ seed: seed });
var clock = { t: Date.now() };
var engine = lib.createEngine({
    store: store,
    openid: openid,
    demo: true,
    now: function () { return clock.t; }
});
function advance(ms) { clock.t += ms; }

var passed = 0;
var failed = 0;

function check(name, condition, detail) {
    if (condition) {
        passed += 1;
        console.log('  ok  ' + name);
    } else {
        failed += 1;
        console.log('  FAIL ' + name + (detail ? '  -> ' + detail : ''));
    }
}

function call(action, payload) {
    return engine.handle(action, payload || {});
}

function close(a, b) {
    return Math.abs(a - b) < 0.001;
}

(async function () {
    console.log('[1] 身份');
    var login = await call('auth.login');
    check('已绑定学员', login.bound === true, JSON.stringify(login));
    check('学员姓名取到', login.user && login.user.name === '李俊颖', login.user && login.user.name);

    var profile = await call('auth.profile');
    check('资料读取', profile.user.storeName.indexOf('总部') >= 0, profile.user.storeName);

    console.log('[2] 学习中心');
    var list = await call('course.list');
    check('课程数为 1', list.courses.length === 1, String(list.courses.length));
    var card = list.courses[0];
    check('课程名称为门店服务标准', card.name === '门店服务标准', card.name);
    check('未开始状态', card.learnStatus === '未开始', card.learnStatus);
    check('带考试信息', !!card.exam && card.exam.passScore === 60, JSON.stringify(card.exam));
    check('考试次数 2 次机会', card.exam && card.exam.attemptsLeft === 2, card.exam && String(card.exam.attemptsLeft));

    console.log('[3] 课程详情与学习');
    var detail = await call('course.detail', { courseId: card.id });
    check('课件解析出 1 个附件', detail.wares.length === 1, JSON.stringify(detail.wares));
    check('附件扩展名为 PPTX', detail.wares[0].ext === 'PPTX', detail.wares[0].ext);

    var opened = await call('learning.open', { courseId: card.id });
    check('打开后进入学习中', opened.status === '学习中', opened.status);
    var tick = await call('learning.tick', { courseId: card.id, minutes: 5 });
    check('5 分钟上报', tick.minutes === 5, String(tick.minutes));
    check('进度约 33%', tick.percent === 33, String(tick.percent));
    advance(40000);
    var fin = await call('learning.finish', { courseId: card.id, minutes: 1 });
    check('完成学习 100%', fin.percent === 100, String(fin.percent));

    var afterLearn = await call('course.list');
    check('已完成课程计数 1', afterLearn.stats.finished === 1, String(afterLearn.stats.finished));
    check('学习时长累计', afterLearn.stats.minutes === 6, String(afterLearn.stats.minutes));

    console.log('[4] 考试（全对）');
    var started = await call('exam.start', { examId: card.exam.id });
    check('下发 10 道题', started.questions.length === 10, String(started.questions.length));
    var leak = JSON.stringify(started.questions).indexOf('正确答案') >= 0 || JSON.stringify(started.questions).indexOf('答案解析') >= 0;
    check('题目不含答案与解析', !leak);
    check('倒计时约 15 分钟', started.remainingSeconds > 800 && started.remainingSeconds <= 900, String(started.remainingSeconds));
    check('每题都有选项', started.questions.every(function (q) { return q.options.length >= 2; }));
    check('题号连续', started.questions.map(function (q) { return q.no; }).join(',') === '1,2,3,4,5,6,7,8,9,10');

    var rightAnswers = {};
    seed.questions.forEach(function (q) {
        rightAnswers[q._id] = String(q['正确答案']).split('');
    });
    var submit = await call('exam.submit', { attemptId: started.attemptId, answers: rightAnswers, switchCount: 0 });
    check('满分 100', close(submit.score, 100), String(submit.score));
    check('判定及格', submit.passed === true);

    var result = await call('exam.result', { attemptId: started.attemptId });
    check('成绩页 10 题', result.items.length === 10, String(result.items.length));
    check('全部答对', result.summary.right === 10, String(result.summary.right));
    check('解析已下发', !!result.items[0].explain);
    check('用时至少 1 分钟', result.attempt.minutes >= 1, String(result.attempt.minutes));

    console.log('[5] 我的');
    var certs = await call('me.certificates');
    check('通过后颁发证书', certs.items.length === 1, String(certs.items.length));
    var attempts = await call('me.attempts');
    check('考试记录 1 条', attempts.items.length === 1, String(attempts.items.length));

    console.log('[6] 第二次考试（错题 + 错题本）');
    var started2 = await call('exam.start', { examId: card.exam.id });
    check('第二次开考成功', !!started2.attemptId);
    var wrongAnswers = {};
    seed.questions.forEach(function (q, i) {
        var correct = String(q['正确答案']).split('');
        if (i < 3) {
            wrongAnswers[q._id] = ['D'];
        } else {
            wrongAnswers[q._id] = correct;
        }
    });
    var submit2 = await call('exam.submit', { attemptId: started2.attemptId, answers: wrongAnswers, switchCount: 4 });
    check('7 题正确得 70', close(submit2.score, 70), String(submit2.score));
    check('仍然及格', submit2.passed === true, String(submit2.score));
    var wrongbook = await call('me.wrongbook');
    check('错题本记录 3 道', wrongbook.total === 3, String(wrongbook.total));
    check('按知识点分组', wrongbook.groups.length >= 1, String(wrongbook.groups.length));

    var third = await call('exam.start', { examId: card.exam.id }).then(function () { return 'opened'; }).catch(function (e) { return e.code; });
    check('第三次开考被拦截', third === 'NO_ATTEMPTS', third);

    console.log('[7] 异常路径');
    var badBind = await call('auth.bind', { name: '', phone: '123', storeName: '' }).then(function () { return 'ok'; }).catch(function (e) { return e.code; });
    check('绑定校验生效', badBind === 'INVALID_NAME', badBind);
    var dup = await call('exam.submit', { attemptId: started.attemptId, answers: {} }).then(function () { return 'ok'; }).catch(function (e) { return e.code; });
    check('重复交卷被拦截', dup === 'ALREADY_SUBMITTED', dup);

    console.log('[8] 防秒点与超时自动交卷');
    var store2 = memory.createMemoryStore({ seed: seed });
    var clock2 = { t: Date.now() };
    var engine2 = lib.createEngine({
        store: store2,
        openid: openid,
        demo: true,
        now: function () { return clock2.t; }
    });
    function call2(action, payload) { return engine2.handle(action, payload || {}); }
    var c2 = (await call2('course.list')).courses[0];
    await call2('learning.open', { courseId: c2.id });
    var tooFast = await call2('learning.finish', { courseId: c2.id }).then(function () { return 'ok'; }).catch(function (e) { return e.code; });
    check('秒点完成被拦截', tooFast === 'TOO_FAST', tooFast);

    clock2.t += 40000;
    await call2('learning.finish', { courseId: c2.id, minutes: 1 });
    var s2 = await call2('exam.start', { examId: c2.exam.id });
    clock2.t += 16 * 60000;
    var s3 = await call2('exam.start', { examId: c2.exam.id });
    check('超时后可重新开考', !!s3.attemptId && s3.attemptId !== s2.attemptId);
    var expired = await call2('exam.result', { attemptId: s2.attemptId });
    check('超时卷自动判 0 分', expired.attempt.score === 0, String(expired.attempt.score));
    check('超时卷标记不及格', expired.attempt.passed === false);

    console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
    process.exit(failed ? 1 : 0);
})().catch(function (err) {
    console.error('测试异常：', err && err.stack || err);
    process.exit(1);
});
