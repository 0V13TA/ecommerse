import type { ErrorRequestHandler, Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import multer from "multer";

interface ErrorWithCode extends Error {
  code?: string;
  status?: number;
  type?: string;
}

function hasCode(error: unknown, code: string): error is ErrorWithCode {
  return !!error && typeof error === "object" && "code" in error && (error as ErrorWithCode).code === code;
}

function isBodyParseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const errorWithCode = error as ErrorWithCode;
  const matchesSyntax = error instanceof SyntaxError && errorWithCode.status === 400;
  const matchesType = errorWithCode.type === "entity.parse.failed" || errorWithCode.type === "entity.too.large";

  return matchesSyntax || matchesType;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

export function logError(context: string, error: unknown) {
  if (error instanceof Error) {
    const code = "code" in error ? (error as ErrorWithCode).code : undefined;
    console.error(context, {
      name: error.name,
      code,
      stack: error.stack?.split("\n").slice(1).join("\n")
    });
    return;
  }
  console.error(context, { type: typeof error });
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (isBodyParseError(error)) {
    const isTooLarge = (error as ErrorWithCode).type === "entity.too.large";
    res.status(isTooLarge ? 413 : 400).json({
      error: isTooLarge ? "Request body exceeds the 1 MB limit" : "Malformed JSON request body"
    });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: "Invalid request", details: error.issues });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof multer.MulterError) {
    res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error: error.code === "LIMIT_FILE_SIZE" ? "Image exceeds the 5 MB upload limit" : "Invalid image upload"
    });
    return;
  }
  if (hasCode(error, "23505")) {
    res.status(409).json({ error: "A record with those details already exists" });
    return;
  }
  if (hasCode(error, "23503")) {
    res.status(400).json({ error: "A referenced record does not exist" });
    return;
  }
  logError("Unhandled request error", error);
  res.status(500).json({ error: "An unexpected error occurred" });
};
