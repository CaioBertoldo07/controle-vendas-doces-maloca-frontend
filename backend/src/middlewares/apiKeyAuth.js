export const verificarApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || apiKey !== process.env.N8N_API_KEY) {
    return res.status(401).json({ error: "API Key inválida ou ausente" });
  }

  next();
};
