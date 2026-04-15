import express from "express";
import { listarEstoque } from "../controllers/estoqueController.js";

const router = express.Router();

router.get("/", listarEstoque);

export default router;
