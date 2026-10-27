/**
 * 业务动作实现。所有动作返回视图模型（页面直接用），不把原始记录丢给前端。
 * 判分、组卷、答题槽位映射、错题本、证书都在这里完成——答案不下发到前端。
 */
var util = require('./util');

var TYPE_JUDGE = '判断';
var JUDGE_TEXT = { A: '对', B: '错' };
var JUDGE_KEY = { '对': 'A', '错': 'B' };
var MAX_SLOTS = 10;

/* ---------------------------------- 公共 ---------------------------------- */

function byCode(a, b) {
    var x = util.text(a['题目编号']);
    var y = util.text(b['题目编号']);
    return x < y ? -1 : (x > y ? 1 : 0);
}

function byTimeDesc(a, b) {
    return util.dateMs(b['提交时间']) - util.dateMs(a['提交时间']);
}

function hash(str) {
    var h = 0;
    for (var i = 0; i < String(str).length; i++) {
        h = (h * 31 + String(str).charCodeAt(i)) % 2147483647;
    }
    return h || 7;
}

function currentStudent(payload, session, ctx) {
    if (!session.openid) return Promise.reject(new util.EngineError('NOT_LOGIN', '登录状态获取失败，请重试'));
    return ctx.store.find('students', { open_id: session.openid }).then(function (list) {
        var active = [];
        for (var i = 0; i < list.length; i++) {
            if (util.sel(list[i]['在职状态']) !== '离职') active.push(list[i]);
        }
        var student = active[0] || list[0];
        if (!student) util.fail('NOT_BOUND', '请先完成学员绑定');
        return student;
    });
}

function ensureStudent(payload, session, ctx) {
    return currentStudent(payload, session, ctx);
}

function userView(student) {
    var name = util.text(student['姓名']) || '未命名';
    return {
        id: student._id,
        name: name,
        initial: name.slice(0, 1),
        phone: util.text(student['手机号']),
        storeName: util.text(student['所属门店']) || '未填写门店',
        position: util.sel(student['岗位角色']) || '员工',
        status: util.sel(student['在职状态']) || '在职',
        level: util.sel(student['当前等级']) || '见习',
        points: util.num(student['累计积分'], 0),
        finishedCourses: util.num(student['已完成课程数'], 0),
        avgScore: util.num(student['考试平均分'], 0)
    };
}

function percentOf(minutes, totalMinutes) {
    var total = util.num(totalMinutes, 0);
    if (total <= 0) return 0;
    return util.clamp(Math.round((minutes / total) * 100), 0, 99);
}

function findProgress(ctx, studentId, courseId) {
    return ctx.store.find('progress', { 学员: studentId }).then(function (list) {
        for (var i = 0; i < list.length; i++) {
            if (util.linkIds(list[i]['课程']).indexOf(courseId) >= 0) return list[i];
        }
        return null;
    });
}

function examOfCourse(ctx, courseId) {
    return ctx.store.find('exams', { 考试状态: '进行中' }).then(function (list) {
        for (var i = 0; i < list.length; i++) {
            if (util.linkIds(list[i]['关联课程']).indexOf(courseId) >= 0) return list[i];
        }
        return null;
    });
}

function submittedOf(ctx, studentId, examId) {
    return ctx.store.find('attempts', { 学员: studentId, 考试: examId }).then(function (list) {
        var done = [];
        for (var i = 0; i < list.length; i++) {
            if (util.dateMs(list[i]['提交时间'])) done.push(list[i]);
        }
        done.sort(byTimeDesc);
        return done;
    });
}

/** 试卷题目：按题目编号稳定排序；随机抽题时用种子保证开始与提交两次推导一致 */
function pickQuestions(ctx, exam, course, seed) {
    var ids = course ? util.linkIds(course['关联题目']) : [];
    return ctx.store.find('questions', { 状态: '启用' }).then(function (list) {
        var pool = [];
        for (var i = 0; i < list.length; i++) {
            if (ids.length && ids.indexOf(list[i]._id) < 0) continue;
            pool.push(list[i]);
        }
        pool.sort(byCode);
        var need = util.num(exam['抽题数量'], 0);
        if (util.sel(exam['试卷类型']) === '随机抽题' && need > 0 && need < pool.length) {
            var picked = util.shuffle(pool, hash(seed)).slice(0, need);
            picked.sort(byCode);
            pool = picked;
        }
        return pool;
    });
}

function optionList(question, shuffled) {
    var out = [];
    var keys = ['A', 'B', 'C', 'D'];
    for (var i = 0; i < keys.length; i++) {
        var text = util.text(question['选项' + keys[i]]);
        if (text) out.push({ key: keys[i], text: text });
    }
    return shuffled ? util.shuffle(out) : out;
}

function answerText(type, keys) {
    var list = util.normalizeKeys(keys);
    if (!list.length) return '未作答';
    if (type === TYPE_JUDGE) return JUDGE_TEXT[list[0]] || list[0];
    return list.join('、');
}

/* ---------------------------------- 身份 ---------------------------------- */

function login(payload, session, ctx) {
    if (!session.openid) return Promise.reject(new util.EngineError('NOT_LOGIN', '登录状态获取失败，请重试'));
    return ctx.store.find('students', { open_id: session.openid }).then(function (list) {
        if (!list.length) {
            return { bound: false, demo: !!session.demo };
        }
        return { bound: true, user: userView(list[0]), demo: !!session.demo };
    });
}

function bind(payload, session, ctx) {
    var name = util.text(payload.name).trim();
    var phone = util.text(payload.phone).trim();
    var storeName = util.text(payload.storeName).trim();
    var position = util.text(payload.position).trim() || '员工';

    if (!name) util.fail('INVALID_NAME', '请填写真实姓名');
    if (name.length > 12) util.fail('INVALID_NAME', '姓名不超过 12 个字');
    if (!/^1\d{10}$/.test(phone)) util.fail('INVALID_PHONE', '请填写 11 位手机号');
    if (!storeName) util.fail('INVALID_STORE', '请填写所属门店');
    if (['员工', '储备店长', '店长', '区域经理'].indexOf(position) < 0) position = '员工';
    if (!session.openid) util.fail('NOT_LOGIN', '登录状态获取失败，请重试');

    return ctx.store.find('students', { open_id: session.openid }).then(function (list) {
        if (list.length) {
            return { user: userView(list[0]), existed: true };
        }
        var fields = {
            '姓名': name,
            '手机号': phone,
            '所属门店': storeName,
            '岗位角色': position,
            '在职状态': '在职',
            '当前等级': '见习',
            'open_id': session.openid,
            '已完成课程数': 0,
            '累计积分': 0,
            '考试平均分': null
        };
        return ctx.store.create('students', fields).then(function (id) {
            fields._id = id;
            return { user: userView(fields), existed: false };
        });
    });
}

function profile(payload, session, ctx) {
    return ensureStudent(payload, session, ctx).then(function (student) {
        return { user: userView(student) };
    });
}

/* ---------------------------------- 课程 ---------------------------------- */

function listCourses(payload, session, ctx) {
    return ensureStudent(payload, session, ctx).then(function (student) {
        return Promise.all([
            ctx.store.find('courses', { 课程状态: '已发布' }),
            ctx.store.find('progress', { 学员: student._id }),
            ctx.store.find('exams', { 考试状态: '进行中' }),
            ctx.store.find('attempts', { 学员: student._id })
        ]).then(function (res) {
            var courses = res[0];
            var progressRows = res[1];
            var exams = res[2];
            var attempts = res[3];

            function progressOf(courseId) {
                for (var i = 0; i < progressRows.length; i++) {
                    if (util.linkIds(progressRows[i]['课程']).indexOf(courseId) >= 0) return progressRows[i];
                }
                return null;
            }

            function examOf(courseId) {
                for (var i = 0; i < exams.length; i++) {
                    if (util.linkIds(exams[i]['关联课程']).indexOf(courseId) >= 0) return exams[i];
                }
                return null;
            }

            function attemptsOf(examId) {
                var out = [];
                for (var i = 0; i < attempts.length; i++) {
                    if (util.linkIds(attempts[i]['考试']).indexOf(examId) >= 0 && util.dateMs(attempts[i]['提交时间'])) {
                        out.push(attempts[i]);
                    }
                }
                return out;
            }

            var cards = [];
            var totals = { courses: courses.length, finished: 0, learning: 0, minutes: 0 };
            var scoreSum = 0;
            var scoreCount = 0;

            for (var i = 0; i < courses.length; i++) {
                var course = courses[i];
                var prog = progressOf(course._id);
                var exam = examOf(course._id);
                var mine = exam ? attemptsOf(exam._id) : [];
                var best = 0;
                for (var j = 0; j < mine.length; j++) {
                    best = Math.max(best, util.num(mine[j]['得分'], 0));
                }
                var learnStatus = prog ? util.sel(prog['学习状态']) : '未开始';
                var percent = prog ? util.num(prog['进度百分比'], 0) : 0;
                if (learnStatus === '已完成') percent = 100;
                if (learnStatus === '已完成') totals.finished += 1;
                if (learnStatus === '学习中') totals.learning += 1;
                totals.minutes += prog ? util.num(prog['累计学习时长(分钟)'], 0) : 0;
                if (best) {
                    scoreSum += best;
                    scoreCount += 1;
                }
                var maxAttempts = 1 + util.num(exam ? exam['允许重考次数'] : 0, 0);
                var passed = false;
                for (var k = 0; k < mine.length; k++) {
                    if (util.sel(mine[k]['是否及格']) === '及格') passed = true;
                }
                cards.push({
                    id: course._id,
                    code: util.text(course['课程编号']),
                    name: util.text(course['课程名称']),
                    intro: util.text(course['课程简介']),
                    category: util.sel(course['课程分类']) || '未分类',
                    level: util.sel(course['难度等级']) || '入门',
                    minutes: util.num(course['标准学时(分钟)'], 0),
                    mustLearn: util.bool(course['是否必修']),
                    learnStatus: learnStatus,
                    percent: percent,
                    minutesLearned: prog ? util.num(prog['累计学习时长(分钟)'], 0) : 0,
                    exam: exam ? {
                        id: exam._id,
                        name: util.text(exam['考试名称']),
                        passScore: util.num(exam['及格分'], 60),
                        duration: util.num(exam['考试时长(分钟)'], 15),
                        questionCount: Math.min(util.num(exam['抽题数量'], 10), util.num(course['关联题目'] ? course['关联题目'].length : 10, 10)),
                        bestScore: best,
                        passed: passed,
                        attemptsLeft: Math.max(0, maxAttempts - mine.length)
                    } : null
                });
            }

            cards.sort(function (a, b) {
                var order = { '学习中': 0, '未开始': 1, '已完成': 2 };
                var av = order[a.learnStatus] === undefined ? 1 : order[a.learnStatus];
                var bv = order[b.learnStatus] === undefined ? 1 : order[b.learnStatus];
                if (av !== bv) return av - bv;
                if (a.mustLearn !== b.mustLearn) return a.mustLearn ? -1 : 1;
                return a.code < b.code ? -1 : 1;
            });

            return {
                user: userView(student),
                stats: {
                    courses: totals.courses,
                    finished: totals.finished,
                    learning: totals.learning,
                    minutes: Math.round(totals.minutes),
                    avgScore: scoreCount ? Math.round(scoreSum / scoreCount) : 0
                },
                courses: cards
            };
        });
    });
}

function courseDetail(payload, session, ctx) {
    var courseId = util.text(payload.courseId);
    if (!courseId) util.fail('INVALID_PARAM', '缺少课程参数');
    return ensureStudent(payload, session, ctx).then(function (student) {
        return Promise.all([
            ctx.store.get('courses', courseId),
            findProgress(ctx, student._id, courseId),
            examOfCourse(ctx, courseId).then(function (exam) {
                if (!exam) return null;
                return submittedOf(ctx, student._id, exam._id).then(function (done) {
                    exam.__submitted = done;
                    return exam;
                });
            })
        ]).then(function (res) {
            var course = res[0];
            if (!course) util.fail('NOT_FOUND', '课程不存在或已下架');
            var prog = res[1];
            var exam = res[2];
            var wares = [];
            var files = course['课件附件(PPT)'] || [];
            for (var i = 0; i < files.length; i++) {
                var f = files[i] || {};
                var name = util.text(f.name || f.file_name || '课件');
                var dot = name.lastIndexOf('.');
                wares.push({
                    token: util.text(f.file_token || f.token),
                    name: name,
                    ext: dot >= 0 ? name.slice(dot + 1).toUpperCase() : 'FILE',
                    sizeText: util.num(f.size, 0) ? Math.max(1, Math.round(util.num(f.size, 0) / 1024)) + ' KB' : ''
                });
            }
            var maxAttempts = 1 + util.num(exam ? exam['允许重考次数'] : 0, 0);
            var done = exam ? exam.__submitted : [];
            var best = 0;
            var passed = false;
            var lastId = '';
            for (var j = 0; j < done.length; j++) {
                best = Math.max(best, util.num(done[j]['得分'], 0));
                if (util.sel(done[j]['是否及格']) === '及格') passed = true;
                if (j === 0) lastId = done[j]._id;
            }
            var totalQuestions = 0;
            for (var q = 0; q < util.linkIds(course['关联题目']).length; q++) totalQuestions += 1;

            return {
                user: userView(student),
                course: {
                    id: course._id,
                    code: util.text(course['课程编号']),
                    name: util.text(course['课程名称']),
                    intro: util.text(course['课程简介']),
                    category: util.sel(course['课程分类']) || '未分类',
                    level: util.sel(course['难度等级']) || '入门',
                    minutes: util.num(course['标准学时(分钟)'], 0),
                    mustLearn: util.bool(course['是否必修']),
                    link: util.text(course['视频/图文链接'])
                },
                wares: wares,
                progress: {
                    status: prog ? util.sel(prog['学习状态']) : '未开始',
                    percent: prog ? (util.sel(prog['学习状态']) === '已完成' ? 100 : util.num(prog['进度百分比'], 0)) : 0,
                    minutes: prog ? util.num(prog['累计学习时长(分钟)'], 0) : 0,
                    passStatus: prog ? util.sel(prog['是否通过考核']) : '未考核'
                },
                exam: exam ? {
                    id: exam._id,
                    name: util.text(exam['考试名称']),
                    passScore: util.num(exam['及格分'], 60),
                    duration: util.num(exam['考试时长(分钟)'], 15),
                    questionCount: Math.min(util.num(exam['抽题数量'], 10), totalQuestions || 10),
                    totalScore: 100,
                    bestScore: best,
                    passed: passed,
                    lastAttemptId: lastId,
                    attemptsLeft: Math.max(0, maxAttempts - done.length),
                    maxAttempts: maxAttempts
                } : null
            };
        });
    });
}

/* ---------------------------------- 学习 ---------------------------------- */

function learningOpen(payload, session, ctx) {
    var courseId = util.text(payload.courseId);
    if (!courseId) util.fail('INVALID_PARAM', '缺少课程参数');
    return ensureStudent(payload, session, ctx).then(function (student) {
        var totalMinutes = 15;
        return Promise.all([ctx.store.get('courses', courseId), findProgress(ctx, student._id, courseId)])
            .then(function (res) {
                var course = res[0];
                if (!course) util.fail('NOT_FOUND', '课程不存在或已下架');
                var prog = res[1];
                var total = util.num(course['标准学时(分钟)'], 15);
                totalMinutes = total;
                if (!prog) {
                    var fields = {
                        '进度编号': util.text(student['姓名']) + '-' + util.text(course['课程编号']),
                        '学员': [student._id],
                        '课程': [courseId],
                        '学习状态': '学习中',
                        '进度百分比': 1,
                        '累计学习时长(分钟)': 0,
                        '首次学习时间': ctx.now(),
                        '是否通过考核': '未考核'
                    };
                    return ctx.store.create('progress', fields).then(function (id) {
                        fields._id = id;
                        return { progressId: id, percent: 1, minutes: 0, total: total, status: '学习中' };
                    });
                }
                var patch = {};
                if (util.sel(prog['学习状态']) === '未开始') {
                    patch['学习状态'] = '学习中';
                    patch['首次学习时间'] = ctx.now();
                }
                patch['进度百分比'] = Math.max(util.num(prog['进度百分比'], 0), 1);
                if (Object.keys(patch).length) return ctx.store.update('progress', prog._id, patch);
                return true;
            })
            .then(function () {
                return findProgress(ctx, student._id, courseId);
            })
            .then(function (prog) {
                return {
                    progressId: prog._id,
                    percent: util.num(prog['进度百分比'], 0),
                    minutes: util.num(prog['累计学习时长(分钟)'], 0),
                    total: totalMinutes,
                    status: util.sel(prog['学习状态']) || '学习中'
                };
            });
    });
}

function learningTick(payload, session, ctx) {
    var courseId = util.text(payload.courseId);
    var delta = util.clamp(util.num(payload.minutes, 0), 0, 10);
    if (!courseId || delta <= 0) return Promise.resolve({ ok: true });
    return ensureStudent(payload, session, ctx).then(function (student) {
        return Promise.all([ctx.store.get('courses', courseId), findProgress(ctx, student._id, courseId)])
            .then(function (res) {
                var course = res[0];
                var prog = res[1];
                if (!course || !prog) return { ok: false };
                if (util.sel(prog['学习状态']) === '已完成') {
                    return { percent: 100, minutes: util.num(prog['累计学习时长(分钟)'], 0), done: true };
                }
                var minutes = util.num(prog['累计学习时长(分钟)'], 0) + delta;
                var percent = percentOf(minutes, util.num(course['标准学时(分钟)'], 15));
                return ctx.store.update('progress', prog._id, {
                    '累计学习时长(分钟)': minutes,
                    '进度百分比': percent,
                    '学习状态': '学习中'
                }).then(function () {
                    return { percent: percent, minutes: minutes, done: false };
                });
            });
    });
}

function learningFinish(payload, session, ctx) {
    var courseId = util.text(payload.courseId);
    if (!courseId) util.fail('INVALID_PARAM', '缺少课程参数');
    return ensureStudent(payload, session, ctx).then(function (student) {
        return findProgress(ctx, student._id, courseId).then(function (prog) {
            if (!prog) util.fail('NOT_FOUND', '请先打开课程再完成学习');
            // 服务端也拦一次秒点：从首次打开算起至少 30 秒
            var firstAt = util.dateMs(prog['首次学习时间']);
            if (util.sel(prog['学习状态']) !== '已完成' && firstAt && ctx.now() - firstAt < 30000) {
                util.fail('TOO_FAST', '学习时长不够，认真看完再标记完成');
            }
            var patch = {
                '学习状态': '已完成',
                '进度百分比': 100,
                '完成时间': ctx.now()
            };
            if (util.num(payload.minutes, 0) > 0) {
                patch['累计学习时长(分钟)'] = util.num(prog['累计学习时长(分钟)'], 0) + util.num(payload.minutes, 0);
            }
            return ctx.store.update('progress', prog._id, patch)
                .then(function () {
                    return ctx.store.find('progress', { 学员: student._id });
                })
                .then(function (rows) {
                    var count = 0;
                    for (var i = 0; i < rows.length; i++) {
                        if (util.sel(rows[i]['学习状态']) === '已完成') count += 1;
                    }
                    return ctx.store.update('students', student._id, { '已完成课程数': count });
                })
                .then(function () {
                    return { status: '已完成', percent: 100, minutes: util.num(patch['累计学习时长(分钟)'], util.num(prog['累计学习时长(分钟)'], 0)) };
                });
        });
    });
}

/* ---------------------------------- 考试 ---------------------------------- */

function examStart(payload, session, ctx) {
    var examId = util.text(payload.examId);
    if (!examId) util.fail('INVALID_PARAM', '缺少考试参数');
    return ensureStudent(payload, session, ctx).then(function (student) {
        return ctx.store.get('exams', examId).then(function (exam) {
            if (!exam) util.fail('NOT_FOUND', '考试不存在或已停用');
            if (util.sel(exam['考试状态']) !== '进行中') util.fail('EXAM_CLOSED', '考试未开放，请联系店长');
            var courseId = util.linkIds(exam['关联课程'])[0];
            return Promise.all([
                courseId ? ctx.store.get('courses', courseId) : null,
                submittedOf(ctx, student._id, examId)
            ]).then(function (res) {
                var course = res[0];
                var done = res[1];
                var maxAttempts = 1 + util.num(exam['允许重考次数'], 0);
                if (done.length >= maxAttempts) {
                    util.fail('NO_ATTEMPTS', '本次考试的 ' + maxAttempts + ' 次机会已用完');
                }
                return ctx.store.find('attempts', { 学员: student._id, 考试: examId }).then(function (all) {
                    var opened = null;
                    for (var i = 0; i < all.length; i++) {
                        if (!util.dateMs(all[i]['提交时间'])) opened = all[i];
                    }
                    var durationMs = util.num(exam['考试时长(分钟)'], 15) * 60000;
                    var proceed;
                    if (opened) {
                        var startedAt = util.dateMs(opened['开始时间']) || ctx.now();
                        if (ctx.now() - startedAt < durationMs) {
                            proceed = Promise.resolve(opened);
                        } else {
                            // 超时未交卷：按已作答为空处理，写 0 分记录，再开新的一次
                            proceed = autoSubmitExpired(ctx, student, exam, opened, durationMs).then(function () {
                                return createAttempt(ctx, student, exam, course, done.length);
                            });
                        }
                    } else {
                        proceed = createAttempt(ctx, student, exam, course, done.length);
                    }
                    return proceed.then(function (attempt) {
                        return pickQuestions(ctx, exam, course, attempt._id).then(function (questions) {
                            if (!questions.length) util.fail('NO_QUESTIONS', '该考试还没有配置题目');
                            var shuffled = util.bool(exam['选项乱序']);
                            var payloadQuestions = [];
                            for (var q = 0; q < questions.length; q++) {
                                payloadQuestions.push({
                                    id: questions[q]._id,
                                    no: q + 1,
                                    slot: q + 1,
                                    type: util.sel(questions[q]['题型']) || '单选',
                                    stem: util.text(questions[q]['题干']),
                                    points: util.num(questions[q]['分值'], 10),
                                    options: optionList(questions[q], shuffled)
                                });
                            }
                            var order = util.bool(exam['题目乱序'])
                                ? util.shuffle(payloadQuestions, hash(attempt._id + '-q'))
                                : payloadQuestions;
                            for (var n = 0; n < order.length; n++) order[n].no = n + 1;
                            var startedAt = util.dateMs(attempt['开始时间']) || ctx.now();
                            var deadline = startedAt + durationMs;
                            return {
                                attemptId: attempt._id,
                                exam: {
                                    id: exam._id,
                                    name: util.text(exam['考试名称']),
                                    duration: util.num(exam['考试时长(分钟)'], 15),
                                    passScore: util.num(exam['及格分'], 60),
                                    questionCount: order.length,
                                    attemptNo: util.num(attempt['重考次数'], 0) + 1,
                                    maxAttempts: maxAttempts
                                },
                                deadline: deadline,
                                remainingSeconds: Math.max(0, Math.floor((deadline - ctx.now()) / 1000)),
                                questions: order
                            };
                        });
                    });
                });
            });
        });
    });
}

function createAttempt(ctx, student, exam, course, used) {
    var fields = {
        '记录编号': util.text(student['姓名']) + '-' + (course ? util.text(course['课程编号']) : 'EXAM') + '-' + (used + 1),
        '学员': [student._id],
        '考试': [exam._id],
        '姓名': util.text(student['姓名']),
        '所属门店': util.text(student['所属门店']),
        '手机号': util.text(student['手机号']),
        '开始时间': ctx.now(),
        '重考次数': used,
        '查重状态': '正常'
    };
    return ctx.store.create('attempts', fields).then(function (id) {
        fields._id = id;
        return fields;
    });
}

function autoSubmitExpired(ctx, student, exam, attempt, durationMs) {
    var startedAt = util.dateMs(attempt['开始时间']) || ctx.now();
    return ctx.store.update('attempts', attempt._id, {
        '提交时间': startedAt + durationMs,
        '得分': 0,
        '是否及格': '不及格',
        '用时(分钟)': util.num(exam['考试时长(分钟)'], 15)
    }).then(function () {
        return true;
    });
}

function examSubmit(payload, session, ctx) {
    var attemptId = util.text(payload.attemptId);
    if (!attemptId) util.fail('INVALID_PARAM', '缺少作答参数');
    var answers = payload.answers || {};
    var switchCount = util.clamp(util.num(payload.switchCount, 0), 0, 99);

    return ensureStudent(payload, session, ctx).then(function (student) {
        return ctx.store.get('attempts', attemptId).then(function (attempt) {
            if (!attempt) util.fail('NOT_FOUND', '答卷不存在');
            if (util.linkIds(attempt['学员']).indexOf(student._id) < 0) util.fail('FORBIDDEN', '这不是你的答卷');
            if (util.dateMs(attempt['提交时间'])) util.fail('ALREADY_SUBMITTED', '这份答卷已经交过了');
            var examId = util.linkIds(attempt['考试'])[0];
            if (!examId) util.fail('NOT_FOUND', '考试信息缺失');
            return ctx.store.get('exams', examId).then(function (exam) {
                if (!exam) util.fail('NOT_FOUND', '考试信息缺失');
                var courseId = util.linkIds(exam['关联课程'])[0];
                var coursePromise = courseId ? ctx.store.get('courses', courseId) : Promise.resolve(null);
                return coursePromise.then(function (course) {
                    return pickQuestions(ctx, exam, course, attempt._id).then(function (questions) {
                        var total = 0;
                        var score = 0;
                        var right = 0;
                        var answerRows = [];
                        var slotPatch = {};
                        var wrongIds = [];
                        var rightIds = [];

                        for (var i = 0; i < questions.length; i++) {
                            var q = questions[i];
                            var type = util.sel(q['题型']) || '单选';
                            var mine = util.normalizeKeys(answers[q._id]);
                            var correct = util.normalizeKeys(q['正确答案']);
                            var isRight = mine.length > 0 && util.sameKeys(mine, correct);
                            var points = util.num(q['分值'], 10);
                            total += points;
                            if (isRight) {
                                score += points;
                                right += 1;
                                rightIds.push(q._id);
                            } else {
                                wrongIds.push(q._id);
                            }
                            if (i < MAX_SLOTS) {
                                slotPatch['答题' + (i + 1)] = type === TYPE_JUDGE
                                    ? (mine.length ? [JUDGE_TEXT[mine[0]] || mine[0]] : [])
                                    : mine;
                            }
                            answerRows.push({
                                '明细编号': util.text(attempt['记录编号']) + '-' + (i + 1),
                                '学员': [student._id],
                                '考试记录': [attempt._id],
                                '题目': [q._id],
                                '学员答案': answerText(type, mine),
                                '正确答案': answerText(type, correct),
                                '是否正确': isRight ? '正确' : '错误',
                                '得分': isRight ? points : 0,
                                '作答时间': ctx.now()
                            });
                        }

                        var passScore = util.num(exam['及格分'], 60);
                        var passed = score >= passScore;
                        var startedAt = util.dateMs(attempt['开始时间']) || ctx.now();
                        var duration = util.num(exam['考试时长(分钟)'], 15);
                        var usedMinutes = util.clamp(Math.round((ctx.now() - startedAt) / 60000), 1, duration);

                        var patch = {
                            '提交时间': ctx.now(),
                            '得分': score,
                            '是否及格': passed ? '及格' : '不及格',
                            '用时(分钟)': usedMinutes,
                            '查重状态': switchCount >= 3 ? '疑似重复' : '正常'
                        };
                        for (var key in slotPatch) patch[key] = slotPatch[key];

                        return ctx.store.update('attempts', attempt._id, patch)
                            .then(function () {
                                return writeAnswers(ctx, answerRows);
                            })
                            .then(function () {
                                return updateWrongBook(ctx, student, questions, wrongIds, rightIds, courseId);
                            })
                            .then(function () {
                                return updateStudentStats(ctx, student);
                            })
                            .then(function () {
                                return updateProgressPass(ctx, student, courseId, passed);
                            })
                            .then(function () {
                                if (!passed || !course) return null;
                                return issueCertificate(ctx, student, course);
                            })
                            .then(function () {
                                return {
                                    attemptId: attempt._id,
                                    score: score,
                                    total: total,
                                    passed: passed,
                                    right: right,
                                    count: questions.length
                                };
                            });
                    });
                });
            });
        });
    });
}

function writeAnswers(ctx, rows) {
    if (!rows.length) return Promise.resolve(true);
    if (typeof ctx.store.createMany === 'function') {
        return ctx.store.createMany('answers', rows).then(function () {
            return true;
        });
    }
    var chain = Promise.resolve();
    for (var i = 0; i < rows.length; i++) {
        (function (row) {
            chain = chain.then(function () {
                return ctx.store.create('answers', row);
            });
        })(rows[i]);
    }
    return chain;
}

function updateWrongBook(ctx, student, questions, wrongIds, rightIds, courseId) {
    return ctx.store.find('wrongbook', { 学员: student._id }).then(function (rows) {
        var byQuestion = {};
        for (var i = 0; i < rows.length; i++) {
            var qid = util.linkIds(rows[i]['题目'])[0];
            if (qid) byQuestion[qid] = rows[i];
        }
        var chain = Promise.resolve();
        for (var w = 0; w < wrongIds.length; w++) {
            (function (qid) {
                var question = null;
                for (var k = 0; k < questions.length; k++) {
                    if (questions[k]._id === qid) question = questions[k];
                }
                if (!question) return;
                var exist = byQuestion[qid];
                if (exist) {
                    chain = chain.then(function () {
                        return ctx.store.update('wrongbook', exist._id, {
                            '错误次数': util.num(exist['错误次数'], 0) + 1,
                            '掌握状态': '未掌握',
                            '最近错误时间': ctx.now(),
                            '连续答对次数': 0
                        });
                    });
                } else {
                    chain = chain.then(function () {
                        return ctx.store.create('wrongbook', {
                            '错题记录编号': util.text(student['姓名']) + '-' + util.text(question['题目编号']),
                            '学员': [student._id],
                            '题目': [qid],
                            '所属课程': courseId ? [courseId] : [],
                            '知识点': util.text(question['知识点标签']),
                            '错误次数': 1,
                            '掌握状态': '未掌握',
                            '最近错误时间': ctx.now(),
                            '连续答对次数': 0
                        });
                    });
                }
            })(wrongIds[w]);
        }
        for (var r = 0; r < rightIds.length; r++) {
            (function (qid) {
                var exist = byQuestion[qid];
                if (!exist) return;
                chain = chain.then(function () {
                    var streak = util.num(exist['连续答对次数'], 0) + 1;
                    return ctx.store.update('wrongbook', exist._id, {
                        '连续答对次数': streak,
                        '掌握状态': streak >= 2 ? '已掌握' : '复习中'
                    });
                });
            })(rightIds[r]);
        }
        return chain;
    });
}

function updateStudentStats(ctx, student) {
    return ctx.store.find('attempts', { 学员: student._id }).then(function (rows) {
        var sum = 0;
        var count = 0;
        for (var i = 0; i < rows.length; i++) {
            if (!util.dateMs(rows[i]['提交时间'])) continue;
            sum += util.num(rows[i]['得分'], 0);
            count += 1;
        }
        if (!count) return true;
        return ctx.store.update('students', student._id, { '考试平均分': Math.round(sum / count) });
    });
}

function updateProgressPass(ctx, student, courseId, passed) {
    if (!courseId) return Promise.resolve(true);
    return findProgress(ctx, student._id, courseId).then(function (prog) {
        if (!prog) return true;
        return ctx.store.update('progress', prog._id, {
            '是否通过考核': passed ? '已通过' : '未通过'
        });
    });
}

function issueCertificate(ctx, student, course) {
    return ctx.store.find('certs', { 学员: student._id }).then(function (rows) {
        for (var i = 0; i < rows.length; i++) {
            if (util.linkIds(rows[i]['关联课程']).indexOf(course._id) >= 0 && util.sel(rows[i]['证书状态']) === '有效') {
                return true;
            }
        }
        return ctx.store.create('certs', {
            '认证名称': util.text(course['课程名称']) + ' 结业认证',
            '证书编号': 'CERT-' + util.text(course['课程编号']) + '-' + String(student._id).slice(-6).toUpperCase(),
            '证书等级': '初级',
            '证书状态': '有效',
            '颁发时间': ctx.now(),
            '学员': [student._id],
            '关联课程': [course._id]
        });
    });
}

function examResult(payload, session, ctx) {
    var attemptId = util.text(payload.attemptId);
    if (!attemptId) util.fail('INVALID_PARAM', '缺少成绩参数');
    return ensureStudent(payload, session, ctx).then(function (student) {
        return ctx.store.get('attempts', attemptId).then(function (attempt) {
            if (!attempt) util.fail('NOT_FOUND', '成绩不存在');
            if (util.linkIds(attempt['学员']).indexOf(student._id) < 0) util.fail('FORBIDDEN', '无权查看该成绩');
            if (!util.dateMs(attempt['提交时间'])) util.fail('NOT_SUBMITTED', '这份答卷还没有交卷');
            var examId = util.linkIds(attempt['考试'])[0];
            return Promise.all([
                examId ? ctx.store.get('exams', examId) : null,
                ctx.store.find('answers', { 考试记录: attemptId })
            ]).then(function (res) {
                var exam = res[0];
                var rows = res[1];
                var ids = [];
                for (var i = 0; i < rows.length; i++) ids.push(util.linkIds(rows[i]['题目'])[0]);
                return ctx.store.find('questions', {}).then(function (questions) {
                    var byId = {};
                    for (var j = 0; j < questions.length; j++) byId[questions[j]._id] = questions[j];
                    rows.sort(function (a, b) {
                        return util.text(a['明细编号']) < util.text(b['明细编号']) ? -1 : 1;
                    });
                    var items = [];
                    var rightCount = 0;
                    for (var k = 0; k < rows.length; k++) {
                        var row = rows[k];
                        var q = byId[util.linkIds(row['题目'])[0]] || {};
                        var type = util.sel(q['题型']) || '单选';
                        var correct = util.normalizeKeys(q['正确答案']);
                        var mine = util.normalizeKeys(String(util.text(row['学员答案'])).replace(/[、,，\s]/g, '').split(''));
                        if (type === TYPE_JUDGE) {
                            mine = [JUDGE_KEY[util.text(row['学员答案'])] || ''];
                        }
                        var isRight = util.sel(row['是否正确']) === '正确';
                        if (isRight) rightCount += 1;
                        var options = optionList(q, false);
                        for (var o = 0; o < options.length; o++) {
                            var inCorrect = correct.indexOf(options[o].key) >= 0;
                            var inMine = mine.indexOf(options[o].key) >= 0;
                            options[o].state = inCorrect ? 'right' : (inMine ? 'wrong' : '');
                        }
                        items.push({
                            no: k + 1,
                            type: type,
                            stem: util.text(q['题干']),
                            knowledge: util.text(q['知识点标签']),
                            options: options,
                            mineText: util.text(row['学员答案']) || '未作答',
                            answerText: util.text(row['正确答案']),
                            correct: isRight,
                            score: util.num(row['得分'], 0),
                            explain: util.text(q['答案解析'])
                        });
                    }
                    return {
                        attempt: {
                            id: attempt._id,
                            score: util.num(attempt['得分'], 0),
                            passed: util.sel(attempt['是否及格']) === '及格',
                            minutes: util.num(attempt['用时(分钟)'], 0),
                            submittedAt: util.fmtDateTime(util.dateMs(attempt['提交时间'])),
                            attemptNo: util.num(attempt['重考次数'], 0) + 1,
                            code: util.text(attempt['记录编号'])
                        },
                        exam: exam ? {
                            id: exam._id,
                            name: util.text(exam['考试名称']),
                            passScore: util.num(exam['及格分'], 60)
                        } : { name: '考试', passScore: 60 },
                        summary: {
                            right: rightCount,
                            wrong: items.length - rightCount,
                            total: items.length
                        },
                        items: items
                    };
                });
            });
        });
    });
}

/* ---------------------------------- 我的 ---------------------------------- */

function myAttempts(payload, session, ctx) {
    return ensureStudent(payload, session, ctx).then(function (student) {
        return Promise.all([
            ctx.store.find('attempts', { 学员: student._id }),
            ctx.store.find('exams', {})
        ]).then(function (res) {
            var rows = [];
            var exams = res[1];
            var byId = {};
            for (var i = 0; i < exams.length; i++) byId[exams[i]._id] = exams[i];
            var all = res[0];
            for (var j = 0; j < all.length; j++) {
                if (!util.dateMs(all[j]['提交时间'])) continue;
                var examId = util.linkIds(all[j]['考试'])[0];
                var exam = byId[examId];
                rows.push({
                    id: all[j]._id,
                    examName: exam ? util.text(exam['考试名称']) : '考试',
                    score: util.num(all[j]['得分'], 0),
                    passed: util.sel(all[j]['是否及格']) === '及格',
                    minutes: util.num(all[j]['用时(分钟)'], 0),
                    dateText: util.fmtDateTime(util.dateMs(all[j]['提交时间'])),
                    attemptNo: util.num(all[j]['重考次数'], 0) + 1
                });
            }
            rows.sort(function (a, b) {
                return a.dateText < b.dateText ? 1 : -1;
            });
            return { items: rows };
        });
    });
}

function myWrongbook(payload, session, ctx) {
    return ensureStudent(payload, session, ctx).then(function (student) {
        return Promise.all([
            ctx.store.find('wrongbook', { 学员: student._id }),
            ctx.store.find('questions', {})
        ]).then(function (res) {
            var rows = res[0];
            var byId = {};
            for (var i = 0; i < res[1].length; i++) byId[res[1][i]._id] = res[1][i];
            var groups = {};
            var order = [];
            var count = 0;
            for (var j = 0; j < rows.length; j++) {
                var row = rows[j];
                var q = byId[util.linkIds(row['题目'])[0]];
                if (!q) continue;
                var knowledge = util.text(row['知识点']) || '未分类';
                if (!groups[knowledge]) {
                    groups[knowledge] = { knowledge: knowledge, items: [] };
                    order.push(knowledge);
                }
                groups[knowledge].items.push({
                    id: q._id,
                    stem: util.text(q['题干']),
                    type: util.sel(q['题型']) || '单选',
                    answerText: util.text(q['正确答案']),
                    explain: util.text(q['答案解析']),
                    times: util.num(row['错误次数'], 0),
                    status: util.sel(row['掌握状态']) || '未掌握',
                    options: optionList(q, false)
                });
                count += 1;
            }
            var list = [];
            for (var k = 0; k < order.length; k++) list.push(groups[order[k]]);
            return { total: count, groups: list };
        });
    });
}

function myCertificates(payload, session, ctx) {
    return ensureStudent(payload, session, ctx).then(function (student) {
        return ctx.store.find('certs', { 学员: student._id }).then(function (rows) {
            var items = [];
            for (var i = 0; i < rows.length; i++) {
                items.push({
                    id: rows[i]._id,
                    name: util.text(rows[i]['认证名称']),
                    no: util.text(rows[i]['证书编号']),
                    level: util.sel(rows[i]['证书等级']) || '初级',
                    status: util.sel(rows[i]['证书状态']) || '有效',
                    dateText: util.fmtDate(util.dateMs(rows[i]['颁发时间']))
                });
            }
            return { items: items };
        });
    });
}

module.exports = {
    'auth.login': login,
    'auth.bind': bind,
    'auth.profile': profile,
    'course.list': listCourses,
    'course.detail': courseDetail,
    'learning.open': learningOpen,
    'learning.tick': learningTick,
    'learning.finish': learningFinish,
    'exam.start': examStart,
    'exam.submit': examSubmit,
    'exam.result': examResult,
    'me.attempts': myAttempts,
    'me.wrongbook': myWrongbook,
    'me.certificates': myCertificates
};
