// 学习中心
var api = require('../../utils/api');

function greetingOf() {
    var hour = new Date().getHours();
    if (hour < 6) return '夜深了';
    if (hour < 11) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
}

Page({
    data: {
        state: 'loading',
        error: '',
        demo: false,
        greeting: greetingOf(),
        user: {},
        stats: { courses: 0, finished: 0, learning: 0, minutes: 0 },
        todo: null,
        tab: 'all',
        tabs: [],
        courses: [],
        all: []
    },

    onShow: function () {
        this.load();
    },

    onPullDownRefresh: function () {
        this.load(true);
    },

    load: function (force) {
        var that = this;
        this.setData({ state: this.data.all.length ? this.data.state : 'loading', error: '' });
        return api.login(force).then(function (data) {
            if (!data.bound) {
                wx.redirectTo({ url: '/pages/bind/index' });
                return null;
            }
            getApp().setUser(data.user);
            return api.call('course.list');
        }).then(function (res) {
            if (!res) return;
            var courses = (res.courses || []).map(function (card) {
                var decorated = {};
                for (var k in card) decorated[k] = card[k];
                decorated.stateTone = card.learnStatus === '已完成' ? 'lesson__state--done' : '';
                decorated.actionText = card.learnStatus === '已完成'
                    ? (card.exam && card.exam.passed ? '看成绩' : '去考试')
                    : (card.learnStatus === '学习中' ? '继续学' : '开始学');
                return decorated;
            });
            var counts = {
                todo: 0,
                doing: 0,
                done: 0
            };
            courses.forEach(function (c) {
                if (c.learnStatus === '已完成') counts.done += 1;
                else if (c.learnStatus === '学习中') counts.doing += 1;
                else counts.todo += 1;
            });
            var tabs = [
                { key: 'all', label: '全部', count: courses.length },
                { key: 'todo', label: '待学', count: counts.todo },
                { key: 'doing', label: '进行中', count: counts.doing },
                { key: 'done', label: '已完成', count: counts.done }
            ];
            var todo = null;
            var pending = null;
            for (var i = 0; i < courses.length; i++) {
                var c = courses[i];
                if (c.exam && c.exam.attemptsLeft > 0 && c.learnStatus === '已完成' && !c.exam.passed) {
                    pending = c;
                    break;
                }
            }
            if (!pending) {
                for (var j = 0; j < courses.length; j++) {
                    if (courses[j].learnStatus !== '已完成') {
                        pending = courses[j];
                        break;
                    }
                }
            }
            if (pending) {
                var needExam = pending.exam && pending.exam.attemptsLeft > 0 && pending.learnStatus === '已完成';
                todo = {
                    courseId: pending.id,
                    label: '下一步',
                    title: needExam ? pending.exam.name : pending.name,
                    desc: needExam
                        ? '及格 ' + pending.exam.passScore + ' 分 · 还剩 ' + pending.exam.attemptsLeft + ' 次机会 · ' + pending.exam.duration + ' 分钟'
                        : '标准学时 ' + pending.minutes + ' 分钟 · ' + (pending.learnStatus === '学习中' ? '已学 ' + pending.percent + '%' : '还没开始'),
                    action: needExam ? '去考试' : (pending.learnStatus === '学习中' ? '继续学' : '开始学')
                };
            }

            that.setData({
                state: 'ready',
                demo: api.isDemo,
                user: res.user,
                stats: res.stats,
                tabs: tabs,
                all: courses,
                courses: that.filterCourses(courses, that.data.tab),
                todo: todo
            });
        }).catch(function (err) {
            if (err.code === 'NEED_BIND') return;
            that.setData({ state: 'error', error: err.message || '加载失败，请重试' });
        }).then(function () {
            wx.stopPullDownRefresh();
        });
    },

    filterCourses: function (list, tab) {
        if (tab === 'all') return list;
        if (tab === 'todo') return list.filter(function (c) { return c.learnStatus !== '学习中' && c.learnStatus !== '已完成'; });
        if (tab === 'doing') return list.filter(function (c) { return c.learnStatus === '学习中'; });
        return list.filter(function (c) { return c.learnStatus === '已完成'; });
    },

    changeTab: function (e) {
        var key = e.currentTarget.dataset.key;
        this.setData({ tab: key, courses: this.filterCourses(this.data.all, key) });
    },

    openCourse: function (e) {
        var id = e.currentTarget.dataset.id;
        wx.navigateTo({ url: '/pages/course/index?id=' + id });
    },

    goTodo: function () {
        if (!this.data.todo) return;
        wx.navigateTo({ url: '/pages/course/index?id=' + this.data.todo.courseId });
    },

    reload: function () {
        this.setData({ state: 'loading', error: '' });
        this.load(true);
    }
});
