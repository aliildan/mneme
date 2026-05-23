export interface Config {
  host: string;
  port: number;
  debug: boolean;
  database: DatabaseConfig;
}

export interface DatabaseConfig {
  url: string;
  poolSize: number;
  timeout: number;
}

export type Environment = "development" | "staging" | "production";

const defaults: Config = {
  host: "localhost",
  port: 3000,
  debug: false,
  database: { url: "sqlite::memory:", poolSize: 5, timeout: 30000 },
};

export function loadConfig(env: Environment = "development"): Config {
  const base = { ...defaults };
  if (env === "production") {
    base.debug = false;
    base.port = 8080;
  }
  return base;
}

export function validateConfig(cfg: Config): string[] {
  const errors: string[] = [];
  if (!cfg.host) errors.push("host is required");
  if (cfg.port < 1 || cfg.port > 65535) errors.push("port out of range");
  if (cfg.database.poolSize < 1) errors.push("poolSize must be >= 1");
  return errors;
}
