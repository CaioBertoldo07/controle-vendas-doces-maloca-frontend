export const validateVenda = (req, res, next) => {
  const { clienteId, quantidade } = req.body;

  if (!clienteId || !quantidade) {
    return res.status(400).json({
      error: "Cliente e quantidade são obrigatórios",
    });
  }

  if (isNaN(clienteId) || isNaN(quantidade)) {
    return res.status(400).json({
      error: "Cliente e quantidade devem ser números",
    });
  }

  if (quantidade <= 0) {
    return res.status(400).json({
      error: "Quantidade deve ser maior que zero",
    });
  }

  next();
};

export const validateCliente = (req, res, next) => {
  const { nome } = req.body;

  if (!nome || nome.trim() === "") {
    return res.status(400).json({
      error: "Nome do cliente é obrigatório",
    });
  }

  if (nome.trim().length < 3) {
    return res.status(400).json({
      error: "Nome deve ter pelo menos 3 caracteres",
    });
  }

  if (nome.trim().length > 100) {
    return res.status(400).json({
      error: "Nome não pode ter mais de 100 caracteres",
    });
  }

  next();
};
