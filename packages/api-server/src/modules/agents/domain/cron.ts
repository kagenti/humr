import { CronExpressionParser } from "cron-parser";

export function validateCron(expr: string): void {
  CronExpressionParser.parse(expr);
}
