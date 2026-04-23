import type { Db } from "db";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type UnitOfWork = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export function createUnitOfWork(db: Db): UnitOfWork {
  return (fn) => db.transaction(fn);
}
