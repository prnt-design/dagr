export function reportLink(date: string, repository: string, node?: string): string {
  return `#${new URLSearchParams({ date, repository, ...(node ? { node } : {}) })}`;
}
