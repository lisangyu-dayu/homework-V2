// mistakes DAO（M1 完成实现）
export interface MistakeFilter {
  childId: string;
  tagIds?: string[];
  from?: number;
  to?: number;
  resolved?: boolean;
  limit?: number;
  cursor?: number;
}

export function addMistake(_input: {
  childId: string; subQuestionId: string; source: 'auto' | 'manual';
}): { mistakeId: string } {
  // TODO[M1]
  return { mistakeId: 'TODO' };
}

export function list(_filter: MistakeFilter): unknown[] {
  // TODO[M1]
  return [];
}

export function setResolved(_mistakeId: string, _resolved: boolean): void {
  // TODO[M1]
}

export function weakPoints(_childId: string, _opts: { days: number; limit: number }): unknown[] {
  // TODO[M1]: 按 tag 聚合 count、错误率
  return [];
}
