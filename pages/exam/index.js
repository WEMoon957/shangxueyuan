// 考试答题：本地倒计时仅作展示，服务端以开始时间判超时
var api = require('../../utils/api');

function pad(n) {
    return n < 10 ? '0' + n : '' + n;
}

function typeText(type) {
    if (type === '多选') return '多选题';
    if (type === '判断') return '判断题';
    if (type === '简答') return '简答题';
    return '单选题';
}

function hintText(type) {
    if (type === '多选') return '错选、少选都不得分';
    if (type === '判断') return '选择一个答案';
    return '只有一个正确答案';
}

Page({
    data: {
        state: 'loading',
        error: '',
        examId: '',
        exam: {},
        attemptId: '',
        questions: [],
        currentQuestion: { options: [] },
        current: 0,
        answeredCount: 0,
        cardItems: [],
        remaining: 0,
        timeText: '00:00',
        scrollTop: 0,
        switchCount: 0
    },

    onLoad: function (query) {
        this.setData({ examId: (query && query.id) || '' });
    },

    onShow: function () {
        if (this.data.state === 'ready') {
            if (this.hiddenOnce) {
                this.setData({ switchCount: this.data.switchCount + 1 });
                if (this.data.switchCount === 1) {
                    wx.showToast({ title: '已记录一次切屏', icon: 'none' });
                }
            }
            this.hiddenOnce = true;
            return;
        }
        if (this.data.questions.length === 0) {
            this.start();
        }
    },

    onHide: function () {
        if (this.data.state === 'ready') this.hiddenOnce = true;
    },

    onUnload: function () {
        this.stopTimer();
    },

    start: function () {
        var that = this;
        if (!this.data.examId) {
            this.setData({ state: 'error', error: '缺少考试参数' });
            return;
        }
        return api.login().then(function (data) {
            if (!data.bound) {
                wx.redirectTo({ url: '/pages/bind/index' });
                return null;
            }
            return api.call('exam.start', { examId: that.data.examId });
        }).then(function (res) {
            if (!res) return;
            var questions = (res.questions || []).map(function (q) {
                var item = {
                    id: q.id,
                    no: q.no,
                    type: q.type,
                    typeText: typeText(q.type),
                    hintText: hintText(q.type),
                    stem: q.stem,
                    points: q.points,
                    selected: [],
                    options: []
                };
                (q.options || []).forEach(function (o) {
                    item.options.push({ key: o.key, text: o.text, checked: false });
                });
                return item;
            });
            that.setData({
                state: 'ready',
                exam: res.exam,
                attemptId: res.attemptId,
                questions: questions,
                current: 0,
                currentQuestion: questions[0],
                remaining: res.remainingSeconds,
                cardItems: that.buildCard(questions, 0),
                answeredCount: 0
            }, function () {
                that.refreshTimeText();
                that.startTimer();
            });
        }).catch(function (err) {
            if (err.code === 'NEED_BIND') return;
            that.setData({ state: 'error', error: err.message || '发卷失败，请重试' });
        });
    },

    startTimer: function () {
        var that = this;
        this.stopTimer();
        this.timer = setInterval(function () {
            var remaining = that.data.remaining - 1;
            if (remaining <= 0) {
                that.stopTimer();
                that.setData({ remaining: 0 }, function () {
                    that.refreshTimeText();
                    that.submit(true);
                });
                return;
            }
            that.setData({ remaining: remaining });
            that.refreshTimeText();
        }, 1000);
    },

    stopTimer: function () {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    },

    refreshTimeText: function () {
        var s = Math.max(0, this.data.remaining);
        this.setData({ timeText: pad(Math.floor(s / 60)) + ':' + pad(s % 60) });
    },

    buildCard: function (questions, current) {
        return questions.map(function (q, i) {
            return { no: q.no, answered: q.selected.length > 0, current: i === current };
        });
    },

    choose: function (e) {
        var key = e.currentTarget.dataset.key;
        var index = this.data.current;
        var questions = this.data.questions;
        var q = questions[index];
        var isMulti = q.type === '多选';
        var selected;
        if (isMulti) {
            selected = q.selected.slice();
            var pos = selected.indexOf(key);
            if (pos >= 0) selected.splice(pos, 1);
            else selected.push(key);
            selected.sort();
        } else {
            selected = [key];
        }
        q.selected = selected;
        q.options = q.options.map(function (o) {
            o.checked = selected.indexOf(o.key) >= 0;
            return o;
        });
        var answered = 0;
        for (var i = 0; i < questions.length; i++) {
            if (questions[i].selected.length) answered += 1;
        }
        this.setData({
            questions: questions,
            currentQuestion: q,
            answeredCount: answered,
            cardItems: this.buildCard(questions, index)
        });
    },

    goTo: function (index) {
        var questions = this.data.questions;
        if (index < 0 || index >= questions.length) return;
        this.setData({
            current: index,
            currentQuestion: questions[index],
            cardItems: this.buildCard(questions, index),
            scrollTop: this.data.scrollTop === 0 ? 1 : 0
        });
    },

    prev: function () {
        this.goTo(this.data.current - 1);
    },

    next: function () {
        this.goTo(this.data.current + 1);
    },

    jump: function (e) {
        this.goTo(Number(e.currentTarget.dataset.index));
    },

    confirmSubmit: function () {
        var that = this;
        var unanswered = this.data.questions.length - this.data.answeredCount;
        var content = unanswered > 0
            ? '还有 ' + unanswered + ' 题没答，交卷后不能修改。确定交卷吗？'
            : '已全部作答，交卷后立刻出分。确定交卷吗？';
        wx.showModal({
            title: '确认交卷',
            content: content,
            confirmText: '交卷',
            confirmColor: '#2F5BFF',
            success: function (res) {
                if (res.confirm) that.submit(false);
            }
        });
    },

    submit: function (auto) {
        if (this.submitting) return;
        this.submitting = true;
        this.stopTimer();
        var that = this;
        var answers = {};
        this.data.questions.forEach(function (q) {
            answers[q.id] = q.selected;
        });
        wx.showLoading({ title: auto ? '时间到，交卷中' : '判分中', mask: true });
        api.call('exam.submit', {
            attemptId: this.data.attemptId,
            answers: answers,
            switchCount: this.data.switchCount
        }).then(function (res) {
            wx.hideLoading();
            wx.redirectTo({ url: '/pages/result/index?id=' + res.attemptId });
        }).catch(function (err) {
            wx.hideLoading();
            that.submitting = false;
            wx.showModal({
                title: '交卷失败',
                content: err.message || '网络异常，请重试',
                showCancel: false,
                success: function () {
                    that.startTimer();
                }
            });
        });
    },

    back: function () {
        wx.navigateBack();
    }
});
