# 回归测试夹具

放真实数学作业图（5-10 张），每次发版前手动跑一遍工作流。

命名约定：`<年级>_<题型>_<序号>.jpg`，例：`g7_equation_001.jpg`。

`manifest.json` 记录每张图覆盖的题型；进入自动 E2E 比对时，再为每张图补 `*.expected.json`（人工标注期望的大题/小题结构 + 正确答案）。

静态校验：

```bash
npx tsx scripts/check-fixtures.ts
```
