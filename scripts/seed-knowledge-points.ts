// 知识点种子导入（M2 完成实现）
// 输入：data/knowledge-points/math.json
// 输出：insert into knowledge_tags
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const JSON_PATH = path.resolve('data/knowledge-points/math.json');

if (!fs.existsSync(JSON_PATH)) {
  console.error(`missing ${JSON_PATH}`);
  console.error('参考 docs/04-todo-list.md#M2 生成知识点 JSON');
  process.exit(1);
}

// TODO[M2]:
//  1. 读取 JSON（结构见 docs/02-tech-design.md §5）
//  2. 批量 insert into knowledge_tags
//  3. 打印导入统计

console.log('TODO[M2]: implement me');
