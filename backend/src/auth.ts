import { createClient } from "@supabase/supabase-js";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { pool } from "./db.js";
import { HttpError } from "./errors.js";

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

declare global {
  namespace Express {
    interface Request {
      adminUserId?: string;
    }
  }
}

export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const authorization = req.header("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) throw new HttpError(401, "Authentication required");

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, "Invalid or expired session");

    const result = await pool.query(
      "select 1 from public.admin_users where user_id = $1 limit 1",
      [data.user.id]
    );
    if (result.rowCount === 0) throw new HttpError(403, "Administrator access required");

    req.adminUserId = data.user.id;
    next();
  } catch (error) {
    next(error);
  }
}
