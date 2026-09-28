import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { pool } from "./db.js";
import { errorHandler, HttpError, logError } from "./errors.js";
import { router } from "./routes.js";
import { releaseExpiredReservations } from "./commerce.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new HttpError(403, "Origin is not allowed by CORS"));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Paystack-Signature", "X-Analytics-Session"]
}));
app.use("/api/v1/webhooks/paystack", express.raw({ type: "application/json", limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/v1", rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => req.path === "/webhooks/paystack"
}));
app.use("/api/v1", router);
app.use("/api/v1", (_req, res) => res.status(404).json({ error: "API route not found" }));
app.use(errorHandler);

const server = app.listen(config.PORT, () => {
  console.info(`Store API listening on port ${config.PORT}`);
});

const reservationCleanup = setInterval(() => {
  void releaseExpiredReservations().catch((error: unknown) => {
    logError("Failed to release expired stock reservations", error);
  });
}, 60_000);
reservationCleanup.unref();

async function shutdown() {
  clearInterval(reservationCleanup);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
}

function handleShutdownSignal() {
  if (shuttingDown) return;
  shuttingDown = true;
  void shutdown().catch((error: unknown) => {
    logError("Failed to shut down cleanly", error);
    process.exitCode = 1;
  });
}

let shuttingDown = false;
process.on("SIGTERM", handleShutdownSignal);
process.on("SIGINT", handleShutdownSignal);
