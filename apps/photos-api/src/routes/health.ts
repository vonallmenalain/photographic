import { Router } from "express";
import { sendOk } from "../lib/response";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  sendOk(res, {
    service: "photographic-photos-api",
    timestamp: new Date().toISOString()
  });
});
