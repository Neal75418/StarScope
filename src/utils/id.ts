/**
 * 唯一 ID 生成工具。
 */

export function generateId(prefix?: string): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return prefix ? `${prefix}-${id}` : id;
}
