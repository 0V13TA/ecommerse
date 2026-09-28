import pg from "pg";
import { config } from "./config.js";
import { logError } from "./errors.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.NODE_ENV === "production",
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on("error", (error) => {
  logError("Unexpected PostgreSQL pool error", error);
});
