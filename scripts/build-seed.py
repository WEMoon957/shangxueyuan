#!/usr/bin/env python3
"""把从飞书多维表格导出的 NDJSON 快照整理成演示模式种子数据。

用法：
  python3 scripts/build-seed.py <ndjson_dir> <output_json>
NDJSON 文件需按表 id 命名，如 tbl0mrlQosowWWqX.ndjson。
"""
import json
import os
import sys

TABLES = {
    'courses': ('tbl0mrlQosowWWqX', [
        '课程编号', '课程名称', '课程简介', '课程分类', '适用角色', '是否必修',
        '难度等级', '标准学时(分钟)', '课程状态', '课件附件(PPT)', '关联题目',
        '关联考试', '视频/图文链接',
    ]),
    'students': ('tblMBM5ygK87fPi6', [
        '姓名', '手机号', '所属门店', '岗位角色', '在职状态', '当前等级', 'open_id',
        '已完成课程数', '考试平均分', '累计积分', '工号',
    ]),
    'progress': ('tblfIpxEAkN5u0Qz', [
        '进度编号', '学员', '课程', '学习状态', '进度百分比',
        '累计学习时长(分钟)', '首次学习时间', '完成时间', '是否通过考核',
    ]),
    'questions': ('tbl7tdWb2e7okTaF', [
        '题目编号', '题干', '题型', '选项A', '选项B', '选项C', '选项D',
        '正确答案', '答案解析', '分值', '知识点标签', '难度', '状态', '所属课程',
    ]),
    'exams': ('tblkBS6poUqfhprI', [
        '考试名称', '关联课程', '试卷类型', '抽题数量', '考试时长(分钟)',
        '及格分', '允许重考次数', '考试状态', '题目乱序', '选项乱序', '目标人群',
    ]),
    'attempts': ('tblgFV9Jz4A3qXYd', [
        '记录编号', '学员', '考试', '姓名', '所属门店', '手机号', '开始时间',
        '提交时间', '得分', '是否及格', '用时(分钟)', '重考次数', '查重状态',
    ]),
    'answers': ('tblojifWD7cEEz9f', [
        '明细编号', '学员', '考试记录', '题目', '学员答案', '正确答案',
        '是否正确', '得分', '作答时间',
    ]),
    'wrongbook': ('tblCq4vlOUcQebpa', [
        '错题记录编号', '学员', '题目', '所属课程', '知识点', '错误次数',
        '掌握状态', '最近错误时间', '连续答对次数',
    ]),
    'certs': ('tbl00tNpsd6P4bkp', [
        '认证名称', '证书编号', '证书等级', '证书状态', '颁发时间', '学员', '关联课程',
    ]),
}

DEMO_OPENID = 'demo_openid_store_001'


def link_ids(value):
    if not value:
        return []
    out = []
    for item in value:
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict):
            if item.get('id'):
                out.append(item['id'])
            elif item.get('record_ids'):
                out.extend(item['record_ids'])
    return out


def clean(field, value):
    if field in ('学员', '课程', '题目', '考试', '考试记录', '关联题目', '关联考试', '关联课程', '所属课程'):
        return link_ids(value)
    if field == '课件附件(PPT)':
        return [
            {'file_token': a.get('file_token'), 'name': a.get('name'), 'size': a.get('size')}
            for a in (value or [])
        ]
    if field in ('是否必修',):
        return bool(value)
    if field in ('适用角色', '题型', '状态', '目标人群', '是否及格', '查重状态'):
        return [v for v in (value or []) if v] if isinstance(value, list) else ([value] if value else [])
    if field in ('课程分类', '难度等级', '课程状态', '岗位角色', '在职状态', '当前等级',
                 '学习状态', '是否通过考核', '难度', '试卷类型', '考试状态', '掌握状态',
                 '证书等级', '证书状态'):
        if isinstance(value, list):
            return value[0] if value else ''
        return value or ''
    if field in ('标准学时(分钟)', '进度百分比', '累计学习时长(分钟)', '分值', '抽题数量',
                 '考试时长(分钟)', '及格分', '允许重考次数', '已完成课程数', '考试平均分',
                 '累计积分', '得分', '用时(分钟)', '重考次数', '错误次数', '连续答对次数'):
        if value is None:
            return None
        try:
            return float(value) if '.' in str(value) else int(value)
        except (TypeError, ValueError):
            return None
    if field in ('首次学习时间', '完成时间', '开始时间', '提交时间', '作答时间',
                 '最近错误时间', '颁发时间'):
        if not value:
            return 0
        from datetime import datetime
        try:
            return int(datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp() * 1000)
        except ValueError:
            return 0
    return value


def main():
    src, dst = sys.argv[1], sys.argv[2]
    data = {}
    for key, (table_id, fields) in TABLES.items():
        path = os.path.join(src, table_id + '.ndjson')
        records = []
        if os.path.exists(path):
            with open(path, encoding='utf-8') as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    raw = json.loads(line)
                    rec = {'_id': raw['record_id']}
                    for field in fields:
                        rec[field] = clean(field, raw.get(field))
                    records.append(rec)
        data[key] = records

    # 演示模式：把数据挂到一个固定的演示学员上，保留真实内容
    student = data['students'][0] if data['students'] else {}
    student_id = student.get('_id') or 'demo-student'
    for key in ('attempts', 'answers', 'wrongbook', 'certs'):
        data[key] = []
    demo_student = {
        '_id': student_id,
        '姓名': student.get('姓名') or '演示学员',
        '手机号': student.get('手机号') or '13800000000',
        '所属门店': student.get('所属门店') or '总部（测试）',
        '岗位角色': student.get('岗位角色') or '员工',
        '在职状态': '在职',
        '当前等级': student.get('当前等级') or '见习',
        'open_id': DEMO_OPENID,
        '已完成课程数': 0,
        '考试平均分': None,
        '累计积分': 0,
    }
    data['students'] = [demo_student]

    progress = []
    for rec in data['progress']:
        if not rec.get('学员'):
            rec['学员'] = [student_id]
        rec['学习状态'] = '未开始'
        rec['进度百分比'] = 0
        rec['累计学习时长(分钟)'] = None
        rec['首次学习时间'] = 0
        rec['完成时间'] = 0
        rec['是否通过考核'] = '未考核'
        progress.append(rec)
    data['progress'] = progress

    # 去掉仅用于内部测试的课程
    data['courses'] = [c for c in data['courses'] if str(c.get('课程编号', '')).startswith('KC')]
    allowed = set(c['_id'] for c in data['courses'])
    data['progress'] = [p for p in data['progress'] if set(p.get('课程') or []) & allowed]
    data['questions'] = [q for q in data['questions'] if not q.get('所属课程') or set(q['所属课程']) & allowed]

    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    # 小程序侧以 JS 模块引入，避免依赖 JSON require
    js_path = os.path.splitext(dst)[0] + '.js'
    with open(js_path, 'w', encoding='utf-8') as fh:
        fh.write('/** 由 scripts/build-seed.py 生成：飞书数据底座快照，仅用于演示模式。 */\n')
        fh.write('module.exports = ')
        json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write(';\n')
    counts = ', '.join('%s=%d' % (k, len(v)) for k, v in data.items())
    print('seed written:', dst)
    print(counts)


if __name__ == '__main__':
    main()
