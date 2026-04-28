export function branchTimestamp(now: Date): string {
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
}
