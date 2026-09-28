import { createClient } from "@supabase/supabase-js";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { HttpError } from "./errors.js";

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

declare global {
  namespace Express {
    interface Request {
      customerUserId?: string;
      customerEmail?: string;
      customerEmailConfirmed?: boolean;
    }
  }
}

export async function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  try {
    const authorization = req.header("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) throw new HttpError(401, "Customer authentication required");

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user || !data.user.email) {
      throw new HttpError(401, "Invalid or expired customer session");
    }

    export async function identifyCustomerIfPresent(req: Request, _res: Response, next: NextFunction) {
      const authorization = req.header("authorization");
      if (!authorization) {
        next();
        return;
      }

      try {
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        if (!token) throw new HttpError(401, "Invalid customer authorization");
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user) throw new HttpError(401, "Invalid or expired customer session");
        req.customerUserId = data.user.id;
        next();
      } catch (error) {
        next(error);
      }
    }

    req.customerUserId = data.user.id;
    req.customerEmail = data.user.email.trim().toLowerCase();
    req.customerEmailConfirmed = Boolean(data.user.email_confirmed_at);
    next();
  } catch (error) {
    next(error);
  }
}
