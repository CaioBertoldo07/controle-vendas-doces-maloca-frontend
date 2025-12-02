import express from "express";
import * as authController from "../controllers/authController.js";
import { verificarAuth } from "../middlewares/auth.js";

const router = express.Router();

// POST /api/auth/registro - Criar nova conta
router.post("/registro", authController.registro);

// POST /api/auth/login - Fazer login
router.post("/login", authController.login);

// GET /api/auth/verificar - Verificar token
router.get("/verificar", verificarAuth, authController.verificarToken);

export default router;
