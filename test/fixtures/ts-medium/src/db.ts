import { DatabaseConfig } from "./config.js";

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
  duration: number;
}

export interface Transaction {
  query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export class Database {
  private config: DatabaseConfig;
  private connected = false;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    if (!this.connected) throw new Error("not connected");
    return { rows: [], rowCount: 0, duration: 0 };
  }

  async transaction(): Promise<Transaction> {
    const self = this;
    return {
      async query<T>(sql: string, params?: unknown[]) {
        return self.query<T>(sql, params);
      },
      async commit() {},
      async rollback() {},
    };
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export async function withTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  const tx = await db.transaction();
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}
