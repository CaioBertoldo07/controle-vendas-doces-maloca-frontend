// Ajuste de estoque de produto acabado (sabor) a partir de contagem física.
//
// O saldo de um sabor não é armazenado: é produzido − vendido + soma das
// diferenças dos ajustes. Por isso a consistência com vendas e produções
// simultâneas vem de bloqueios dentro da transação do ajuste:
//   1. SELECT ... FOR UPDATE na linha do sabor: serializa ajustes do mesmo
//      sabor e faz esperar as inserções em venda_sabores/producao_sabores
//      desse sabor (a checagem de chave estrangeira precisa de um bloqueio
//      compartilhado na mesma linha);
//   2. somas com LOCK IN SHARE MODE: leem a versão mais recente confirmada e
//      bloqueiam o intervalo do índice saborId até o fim da transação.
// Vendas e produções não foram alteradas: apenas esperam o ajuste terminar.

export const MOTIVOS_AJUSTE = Object.freeze({
  DIVERGENCIA_CONTAGEM: "Divergência de contagem",
  PERDA_AVARIA: "Perda/avaria",
  ERRO_LANCAMENTO: "Erro de lançamento",
  OUTRO: "Outro",
});

export class ErroAjuste extends Error {
  constructor(status, mensagem, extra = {}) {
    super(mensagem);
    this.status = status;
    this.extra = extra;
  }
}

const inteiro = (valor) => {
  if (valor === null || valor === undefined || valor === "") return NaN;
  return Number(valor);
};

export function validarEntradaAjuste(body = {}) {
  const saborId = inteiro(body.saborId);
  if (!Number.isInteger(saborId) || saborId <= 0) {
    throw new ErroAjuste(400, "Selecione um sabor válido");
  }

  const quantidadeContada = inteiro(body.quantidadeContada);
  if (!Number.isInteger(quantidadeContada) || quantidadeContada < 0) {
    throw new ErroAjuste(
      400,
      "A quantidade contada deve ser um número inteiro maior ou igual a zero",
    );
  }

  const saldoEsperado = inteiro(body.saldoEsperado);
  if (!Number.isInteger(saldoEsperado)) {
    throw new ErroAjuste(400, "Saldo atual de referência ausente ou inválido");
  }

  const motivo = body.motivo;
  if (!Object.hasOwn(MOTIVOS_AJUSTE, motivo)) {
    throw new ErroAjuste(400, "Motivo do ajuste inválido");
  }

  const justificativa =
    typeof body.justificativa === "string" && body.justificativa.trim()
      ? body.justificativa.trim()
      : null;
  if (motivo === "OUTRO" && !justificativa) {
    throw new ErroAjuste(400, "Informe a justificativa para o motivo \"Outro\"");
  }
  if (justificativa && justificativa.length > 255) {
    throw new ErroAjuste(400, "A justificativa deve ter no máximo 255 caracteres");
  }

  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 100) {
    throw new ErroAjuste(400, "Chave de idempotência ausente ou inválida");
  }

  return {
    saborId,
    quantidadeContada,
    saldoEsperado,
    motivo,
    justificativa,
    idempotencyKey,
  };
}

const INCLUIR_AJUSTE = {
  sabor: { select: { id: true, nome: true } },
  usuario: { select: { id: true, nome: true } },
};

// Saldo atual do sabor com os bloqueios descritos no topo do arquivo.
// Retorna null se o sabor não existir.
async function saldoComBloqueio(tx, saborId) {
  const sabor = await tx.$queryRaw`
    SELECT id FROM sabores WHERE id = ${saborId} FOR UPDATE`;
  if (sabor.length === 0) return null;

  const [produzido] = await tx.$queryRaw`
    SELECT COALESCE(SUM(quantidade), 0) AS total
    FROM producao_sabores WHERE saborId = ${saborId} LOCK IN SHARE MODE`;
  const [vendido] = await tx.$queryRaw`
    SELECT COALESCE(SUM(quantidade), 0) AS total
    FROM venda_sabores WHERE saborId = ${saborId} LOCK IN SHARE MODE`;
  const [ajustado] = await tx.$queryRaw`
    SELECT COALESCE(SUM(diferenca), 0) AS total
    FROM ajustes_estoque WHERE saborId = ${saborId} LOCK IN SHARE MODE`;

  return Number(produzido.total) - Number(vendido.total) + Number(ajustado.total);
}

const mesmaOperacao = (ajuste, dados, usuarioId) =>
  ajuste.saborId === dados.saborId &&
  ajuste.usuarioId === usuarioId &&
  ajuste.saldoAnterior === dados.saldoEsperado &&
  ajuste.saldoNovo === dados.quantidadeContada &&
  ajuste.motivo === dados.motivo &&
  (ajuste.justificativa ?? null) === dados.justificativa;

/**
 * Registra o ajuste dentro de uma transação já aberta (`tx`).
 *
 * Retorna:
 *   { ajuste }                     ajuste criado
 *   { ajuste, repetido: true }     mesma chave e mesmos dados (repetição)
 *   { semAlteracao: true, saldoAtual }  contagem igual ao saldo: nada gravado
 * Lança ErroAjuste para sabor inexistente (404), chave reutilizada com outros
 * dados (409) e saldo alterado desde a contagem (409).
 */
export async function registrarAjusteNaTransacao(tx, dados, usuarioId) {
  const saldoAtual = await saldoComBloqueio(tx, dados.saborId);
  if (saldoAtual === null) {
    throw new ErroAjuste(404, "Sabor não encontrado");
  }

  // Verificada depois do bloqueio do sabor: duas repetições simultâneas da
  // mesma operação ficam em fila e a segunda encontra o ajuste da primeira.
  const existente = await tx.ajusteEstoque.findUnique({
    where: { idempotencyKey: dados.idempotencyKey },
    include: INCLUIR_AJUSTE,
  });
  if (existente) {
    if (mesmaOperacao(existente, dados, usuarioId)) {
      return { ajuste: existente, repetido: true };
    }
    throw new ErroAjuste(
      409,
      "Esta chave de idempotência já foi usada em outro ajuste",
      { codigo: "CHAVE_REUTILIZADA" },
    );
  }

  if (saldoAtual !== dados.saldoEsperado) {
    throw new ErroAjuste(
      409,
      "O saldo deste sabor mudou desde que a contagem foi informada. Confira o saldo atual e refaça o ajuste.",
      { codigo: "SALDO_ALTERADO", saldoAtual },
    );
  }

  const diferenca = dados.quantidadeContada - saldoAtual;
  if (diferenca === 0) {
    return { semAlteracao: true, saldoAtual };
  }

  const ajuste = await tx.ajusteEstoque.create({
    data: {
      saborId: dados.saborId,
      usuarioId,
      saldoAnterior: saldoAtual,
      saldoNovo: dados.quantidadeContada,
      diferenca,
      motivo: dados.motivo,
      justificativa: dados.justificativa,
      idempotencyKey: dados.idempotencyKey,
    },
    include: INCLUIR_AJUSTE,
  });
  return { ajuste };
}

// Deadlock, espera de bloqueio esgotada ou conflito de escrita: a operação
// não foi aplicada e pode ser repetida com a mesma chave.
export function ehConflitoDeConcorrencia(error) {
  if (["P2034", "P2028"].includes(error?.code)) return true;
  const texto = `${error?.message ?? ""} ${error?.meta?.code ?? ""}`;
  return /deadlock|lock wait timeout|\b1213\b|\b1205\b/i.test(texto);
}
