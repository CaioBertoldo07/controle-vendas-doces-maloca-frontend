// Coordenador (Etapa 1: esqueleto; Etapa 5: intenções reais). Recebe uma
// INTENÇÃO estruturada e decide, por TABELA determinística, quais
// especialistas chamar; agrega as respostas. Não usa LLM: a interpretação da
// linguagem natural já aconteceu no Atendimento. Cada delegação vira uma
// MensagemAgente e uma execução filha.
//
//   DIAGNOSTICO_*  → verificação técnica (Etapa 1)
//   CONSULTA       → { intencoes: [{ tipo, saborId?, janelaSemanas? }], dataReferencia? }
//                    chamadas idênticas são deduplicadas (ex.: estoque + matéria-prima = 1 análise);
//                    devolve, por intenção, a visão COMPACTA (conversa/compactacao.js), nunca a saída inteira
//   ACAO           → { tipo: PROPOR_VENDA | PROPOR_MARCAR_VENDA_PAGA, payload } → Agente de Vendas (só proposta PENDENTE)
import { z } from "zod";
import { erro } from "../../lib/erros.js";
import { compactar } from "../conversa/compactacao.js";
import { ACOES, LIMITES_CONVERSA, ROTAS_CONSULTA } from "../conversa/intencoes.js";

export const ROTAS = Object.freeze({
  DIAGNOSTICO_GERAL: ["estoque", "vendas", "inteligencia"],
  DIAGNOSTICO_ESTOQUE: ["estoque"],
  DIAGNOSTICO_VENDAS: ["vendas"],
  DIAGNOSTICO_INTELIGENCIA: ["inteligencia"],
});

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const pedidoConsulta = z
  .object({
    dataReferencia: dia.optional(),
    intencoes: z
      .array(z.object({
        tipo: z.enum(Object.keys(ROTAS_CONSULTA)),
        saborId: z.number().int().positive().nullable().optional(),
        sabor: z.string().max(80).nullable().optional(),
        janelaSemanas: z.number().int().min(LIMITES_CONVERSA.JANELA_SEMANAS_MIN).max(LIMITES_CONVERSA.JANELA_SEMANAS_MAX).nullable().optional(),
      }).strict())
      .min(1)
      .max(LIMITES_CONVERSA.MAX_INTENCOES),
  })
  .strict();
const pedidoAcao = z.object({ tipo: z.enum(Object.keys(ACOES)), payload: z.record(z.string(), z.unknown()) }).strict();

function validar(esquema, dados) {
  const r = esquema.safeParse(dados ?? {});
  if (!r.success) throw erro(400, `Pedido inválido ao coordenador: ${r.error.issues.map((i) => `${i.path.join(".") || "dados"} ${i.message}`).join("; ")}`);
  return r.data;
}

/** Dados da execução de cada destino (a tabela decide; nada aqui vem de texto livre). */
function dadosDoDestino({ agente, tipo }, intencao, foco, dataReferencia) {
  const base = { ...(dataReferencia && { dataReferencia }) };
  const janela = intencao.janelaSemanas ? { janelaSemanas: intencao.janelaSemanas } : {};
  if (agente === "estoque") return base; // janela canônica fixa de 4 semanas
  if (tipo === "DEMANDA_MEDIA") return { ...base, ...janela, ...(intencao.saborId && { saborIds: [intencao.saborId] }) };
  if (agente === "inteligencia") return { ...base, ...janela, ...(foco === "PERFIL" && intencao.saborId && { perfilPorSabor: true }) };
  return { ...base, ...janela };
}

async function consultar(contexto, { intencoes, dataReferencia }) {
  const plano = [];
  const chamadas = new Map(); // chave → { agente, tipo, dados }
  for (const intencao of intencoes) {
    const rota = ROTAS_CONSULTA[intencao.tipo];
    for (const destino of rota.destinos) {
      const dados = dadosDoDestino(destino, intencao, rota.foco, dataReferencia);
      const chave = `${destino.agente}|${destino.tipo}|${JSON.stringify(dados)}`;
      if (!chamadas.has(chave)) chamadas.set(chave, { ...destino, dados });
      plano.push({ intencao, foco: rota.foco, chave });
    }
  }
  const respostas = new Map();
  for (const [chave, c] of chamadas) {
    try {
      respostas.set(chave, { ok: true, saida: await contexto.enviarMensagem({ para: c.agente, tipo: c.tipo, dados: c.dados }) });
    } catch (e) {
      respostas.set(chave, { ok: false, execucaoId: e.execucaoId ?? null });
    }
  }
  const resultados = plano.map(({ intencao, foco, chave }) => {
    const c = chamadas.get(chave);
    const r = respostas.get(chave);
    const base = { intencao: intencao.tipo, foco, agente: c.agente, tipoExecucao: c.tipo, ...(intencao.sabor && { sabor: intencao.sabor }) };
    if (!r.ok) return { ...base, status: "FALHA", execucaoId: r.execucaoId };
    return { ...base, status: "OK", ...compactar({ agente: c.agente, tipo: c.tipo, saida: r.saida, foco, saborId: intencao.saborId ?? null }) };
  });
  const falhas = resultados.filter((r) => r.status === "FALHA").map((r) => ({ intencao: r.intencao, agente: r.agente, execucaoId: r.execucaoId }));
  return { intencao: "CONSULTA", chamadasEspecialistas: chamadas.size, resultados, falhas, completo: falhas.length === 0 };
}

async function acionar(contexto, { tipo, payload }) {
  const rota = ACOES[tipo];
  try {
    const saida = await contexto.enviarMensagem({ para: rota.agente, tipo: rota.tipo, dados: payload });
    return { intencao: "ACAO", tipo, ok: true, acao: saida.acao };
  } catch (e) {
    // Falha controlada do especialista (payload inválido, 404, 409...): o motivo volta ao Atendimento.
    return { intencao: "ACAO", tipo, ok: false, motivo: e.mensagemInterna ?? "Falha ao propor a ação", execucaoId: e.execucaoId ?? null };
  }
}

export const coordenador = {
  nome: "coordenador",
  descricao: "Coordenador: recebe intenções estruturadas, roteia por tabela aos especialistas e agrega as respostas (compactadas).",
  tools: [],
  async executar(contexto) {
    const { tipo: intencao, dados = {} } = contexto.entrada ?? {};
    if (intencao === "PING") return { agente: "coordenador", pong: true };
    if (intencao === "CONSULTA") return consultar(contexto, validar(pedidoConsulta, dados));
    if (intencao === "ACAO") return acionar(contexto, validar(pedidoAcao, dados));
    const destinos = ROTAS[intencao];
    if (!destinos) throw erro(400, `Intenção não suportada pelo coordenador: "${intencao}"`);

    const respostas = {};
    const falhas = [];
    for (const para of destinos) {
      try {
        respostas[para] = await contexto.enviarMensagem({ para, tipo: "DIAGNOSTICO", dados });
      } catch (e) {
        falhas.push({ agente: para, execucaoId: e.execucaoId ?? null });
      }
    }
    return { intencao, delegadoPara: destinos, respostas, falhas, completo: falhas.length === 0 };
  },
};
