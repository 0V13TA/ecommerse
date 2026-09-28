import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().default("product-images"),
  PAYSTACK_SECRET_KEY: z.string().min(1),
  PAYSTACK_CALLBACK_URL: z.string().url(),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:5174,http://localhost:5175"),
  LOW_STOCK_DEFAULT: z.coerce.number().int().nonnegative().default(5)
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid API environment: ${z.prettifyError(parsed.error)}`);
}

export const config = {
  ...parsed.data,
  corsOrigins: [
    ...new Set([
      ...parsed.data.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
      ...(parsed.data.NODE_ENV === "development" ? ["http://localhost:5175"] : [])
    ])
  ]
};
