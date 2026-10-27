// 课程详情
var api = require('../../utils/api');

Page({
    data: {
        state: 'loading',
        error: '',
        courseId: '',
        user: {},
        course: {},
        wares: [],
        progress: { status: '未开始', percent: 0, minutes: 0 },
        exam: null,
        primaryText: '开始学习',
        primaryAction: 'learn',
        primaryDisabled: false,
        secondaryText: '',
        secondaryAction: ''
    },

    onLoad: function (query) {
        this.setData({ courseId: (query && query.id) || '' });
    },

    onShow: function () {
        this.load();
    },

    onPullDownRefresh: function () {
        this.load(true);
    },

    load: function (force) {
        var that = this;
        if (!this.data.courseId) {
            this.setData({ state: 'error', error: '缺少课程参数' });
            return Promise.resolve();
        }
        return api.login(force).then(function (data) {
            if (!data.bound) {
                wx.redirectTo({ url: '/pages/bind/index' });
                return null;
            }
            return api.call('course.detail', { courseId: that.data.courseId });
        }).then(function (res) {
            if (!res) return;
            var exam = res.exam;
            var progress = res.progress;
            var primary = { text: '开始学习', action: 'learn', disabled: false };
            var secondary = { text: '', action: '' };

            if (progress.status !== '已完成') {
                primary = {
                    text: progress.status === '学习中' ? '继续学习' : '开始学习',
                    action: 'learn',
                    disabled: false
                };
                if (exam && exam.passed) {
                    secondary = { text: '看成绩', action: 'result' };
                }
            } else if (exam) {
                if (exam.passed) {
                    primary = { text: '查看成绩', action: 'result', disabled: false };
                    secondary = { text: '再考一次', action: 'examAgain' };
                    if (exam.attemptsLeft <= 0) secondary = { text: '看错题', action: 'wrongbook' };
                } else if (exam.attemptsLeft > 0) {
                    primary = { text: '开始考试', action: 'exam', disabled: false };
                    secondary = { text: '复习课件', action: 'learn' };
                } else {
                    primary = { text: '考试机会已用完', action: 'none', disabled: true };
                    secondary = { text: '看错题', action: 'wrongbook' };
                }
            } else {
                primary = { text: '已完成学习', action: 'none', disabled: true };
            }

            that.setData({
                state: 'ready',
                user: res.user,
                course: res.course,
                wares: res.wares,
                progress: progress,
                exam: exam,
                primaryText: primary.text,
                primaryAction: primary.action,
                primaryDisabled: primary.disabled,
                secondaryText: secondary.text,
                secondaryAction: secondary.action
            });
        }).catch(function (err) {
            if (err.code === 'NEED_BIND') return;
            that.setData({ state: 'error', error: err.message || '加载失败，请重试' });
        }).then(function () {
            wx.stopPullDownRefresh();
        });
    },

    onPrimary: function () {
        if (this.data.primaryDisabled) return;
        this.handle(this.data.primaryAction);
    },

    onSecondary: function () {
        this.handle(this.data.secondaryAction);
    },

    handle: function (action) {
        var that = this;
        var courseId = this.data.courseId;
        var exam = this.data.exam;
        if (action === 'learn') {
            wx.showLoading({ title: '准备课件', mask: true });
            api.call('learning.open', { courseId: courseId }).then(function () {
                wx.hideLoading();
                wx.navigateTo({ url: '/pages/reader/index?id=' + courseId });
            }).catch(function (err) {
                wx.hideLoading();
                wx.showToast({ title: err.message || '打开失败', icon: 'none' });
            });
            return;
        }
        if (action === 'exam') {
            if (!exam) return;
            wx.navigateTo({ url: '/pages/exam/index?id=' + exam.id });
            return;
        }
        if (action === 'examAgain') {
            if (!exam) return;
            wx.navigateTo({ url: '/pages/exam/index?id=' + exam.id });
            return;
        }
        if (action === 'result') {
            if (!exam || !exam.lastAttemptId) {
                wx.navigateTo({ url: '/pages/my/index' });
                return;
            }
            wx.navigateTo({ url: '/pages/result/index?id=' + exam.lastAttemptId });
            return;
        }
        if (action === 'wrongbook') {
            wx.navigateTo({ url: '/pages/wrongbook/index' });
        }
    },

    reload: function () {
        this.setData({ state: 'loading', error: '' });
        this.load(true);
    }
});
