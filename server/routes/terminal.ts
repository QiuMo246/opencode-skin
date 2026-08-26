import { Router } from "express";
import { detectWt, setWtBackground, restoreWt } from "../lib/terminal.js";

const router = Router();

router.get("/detect", (_req, res) => {
  res.json(detectWt());
});

router.post("/background", (req, res) => {
  try {
    res.json(setWtBackground(req.body ?? {}));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/restore", (_req, res) => {
  try {
    res.json(restoreWt());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
