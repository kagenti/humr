import { CronExpressionParser } from "cron-parser";

export function validateCron(expr: string): void {
  CronExpressionParser.parse(expr);
}

export function minutesToCron(minutes: number): string {
  if (minutes === 1) return "* * * * *";
  return `*/${minutes} * * * *`;
}
