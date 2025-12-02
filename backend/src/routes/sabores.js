import express from "express";
import * as saboresController from "../controllers/saboresController.js";

const router = express.Router();

router.get("/", saboresController.listarSabores);

export default router;
