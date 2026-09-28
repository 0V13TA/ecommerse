import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { HttpError } from "./errors.js";

const baseUrl = "https://api.paystack.co";

async function paystackRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
  const result = (await response.json()) as { status: boolean; message: string; data: T };
  if (!response.ok || !result.status) {
    throw new HttpError(502, `Payment provider error: ${result.message || response.statusText}`);
  }
  return result.data;
}

export interface PaystackTransaction {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  paid_at?: string | null;
  customer?: { email?: string };
}

export async function initializeTransaction(input: {
  email: string;
  amount: number;
  reference: string;
  currency: string;
  metadata: Record<string, string>;
}) {
  return paystackRequest<{ authorization_url: string; access_code: string; reference: string }>(
    "/transaction/initialize",
    { method: "POST", body: JSON.stringify({ ...input, callback_url: config.PAYSTACK_CALLBACK_URL }) }
  );
}

export async function verifyTransaction(reference: string) {
  return paystackRequest<PaystackTransaction>(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );
}

export function isValidWebhookSignature(rawBody: Buffer, signature: string | undefined) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha512", config.PAYSTACK_SECRET_KEY).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
