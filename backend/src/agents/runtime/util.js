// Utilitários do runtime SMA (Etapa 1): JSON seguro para auditoria, limite de
// tempo e mensagens de erro sem detalhes internos.
import { ErroDominio } from "../../lib/erros.js";

const LIMITE_JSON = 8000; // caracteres guardados por campo Json de auditoria

/**
 * Converte um valor em JSON puro para colunas Json de auditoria: Date → ISO,
 * Decimal do Prisma → número, BigInt → string. Acima do limite guarda só uma
 * prévia, marcada como truncada.
 */
export function paraRegistro(valor, limite = LIMITE_JSON) {
  if (valor === undefined) return null;
  const texto = JSON.stringify(valor, (_chave, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v && typeof v === "object" && typeof v.toNumber === "function" && typeof v.toFixed === "function") return v.toNumber();
    return v;
  });
  if (texto === undefined) return null;
  if (texto.length <= limite) return JSON.parse(texto);
  return { _truncado: true, tamanho: texto.length, previa: texto.slice(0, Math.min(2000, limite)) };
}

export class TempoEsgotado extends Error {
  constructor(rotulo, ms) {
    super(`Tempo esgotado: ${rotulo} passou de ${ms} ms`);
    this.name = "TempoEsgotado";
  }
}

/** Promise.race com limite de tempo (a operação original não é cancelada). */
export function comLimite(promessa, ms, rotulo) {
  let timer;
  const limite = new Promise((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new TempoEsgotado(rotulo, ms)), ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer));
}

/**
 * Mensagem de erro para auditoria e respostas: a do ErroDominio, ou só a
 * primeira linha de um erro interno (sem stack, sem detalhes de query).
 */
export function mensagemSegura(erro) {
  if (erro instanceof ErroDominio) return String(erro.corpo?.error ?? erro.message).slice(0, 500);
  const primeira = String(erro?.message ?? erro ?? "Erro desconhecido").split("\n")[0].trim();
  return primeira.slice(0, 500) || "Erro desconhecido";
}

/** Falha de execução de agente, propagada de forma controlada (HTTP 500). */
export class ErroExecucaoAgente extends ErroDominio {
  constructor(agente, execucaoId, mensagem) {
    super(500, { error: `Falha na execução do agente "${agente}"`, execucaoId });
    this.name = "ErroExecucaoAgente";
    this.agente = agente;
    this.execucaoId = execucaoId;
    this.mensagemInterna = mensagem;
  }
}
