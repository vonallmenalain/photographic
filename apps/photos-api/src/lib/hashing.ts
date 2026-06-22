import crypto from "node:crypto";
import { env } from "../config/env";

export function hashWithPepper(value: string) {
  return crypto
    .createHmac("sha256", env.ACCESS_CODE_PEPPER || "photographic-dev-placeholder")
    .update(value)
    .digest("hex");
}
