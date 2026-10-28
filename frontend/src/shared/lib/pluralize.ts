/** Returns `${count} ${singular|plural}` using a naive English plural rule. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
