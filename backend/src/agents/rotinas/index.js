// Rotinas analíticas (Etapa 6): autonomia CONTROLADA.
//
// Uma rotina só ANALISA, RECOMENDA e AUDITA, pelo runtime normal (ExecucaoAgente
// com gatilho AGENDADO ou EVENTO; a cooperação entre agentes é a de sempre).
// Nenhuma rotina registra venda ou produção, marca pagamento, aprova ou executa
// ação: essas continuam exigindo o gestor (AcaoProposta → aprovação).
//
// Não há setInterval no processo: quem dispara é um agendador EXTERNO (cron do
// provedor de hospedagem, por exemplo) chamando o endpoint interno protegido
// (routes/interno.js), que só existe com AGENT_SCHEDULER_ENABLED=true.
//
// Idempotência: ExecucaoRotina é única por (rotina, janela). A janela padrão é
// o dia civil de Manaus ("dia:2026-10-02"): dois disparos no mesmo dia → uma
// análise. A linha também é um LEASE (bloqueadoAte): uma rotina EXECUTANDO com
// lease vencido (o processo caiu) ou em FALHA pode ser retomada na mesma
// janela; SUCESSO não se repete.
//
// Eventos: VENDA_REGISTRADA / PRODUCAO_REGISTRADA (SMA_EVENTOS_ENABLED=true) só
// MARCAM que uma análise é necessária (SinalAnalise). A rotina "eventos" processa
// os sinais depois de um intervalo sem eventos novos (debounce), uma análise por
// rajada, também disparada de fora.
import { prisma } from "../../lib/prisma.js";
import { diaCivilISO, paraCivil } from "../../lib/periodos.js";
import { erro } from "../../lib/erros.js";
import { flags } from "../../lib/flags.js";
import { mensagemSegura } from "../runtime/util.js";

export const ROTINAS = Object.freeze({
  estoque: { agente: "estoque", tipo: "ANALISAR_ESTOQUE", descricao: "Análise diária do estoque (coopera com a Inteligência para a demanda)" },
  vendas: { agente: "vendas", tipo: "ANALISAR_VENDAS", descricao: "Análise diária das vendas, recebíveis e recorrência" },
});
/** Allowlist do endpoint interno: as rotinas analíticas e o processamento dos sinais de evento. */
export const NOMES_PERMITIDOS = Object.freeze([...Object.keys(ROTINAS), "eventos"]);

export const LEASE_ROTINA_MS = 10 * 60 * 1000; // bem acima do limite de execução de um agente
export const DEBOUNCE_EVENTOS_MS = 5 * 60 * 1000;

/** Quais análises cada evento de domínio torna necessárias. */
export const EVENTOS = Object.freeze({
  VENDA_REGISTRADA: ["estoque", "vendas"],
  PRODUCAO_REGISTRADA: ["estoque"],
});

const janelaDoDia = (agora) => `dia:${diaCivilISO(paraCivil(agora))}`;

/**
 * Executa uma rotina analítica no máximo uma vez por janela.
 * Devolve { executada, rotina, janela, status?, motivo?, execucaoId?, tentativas, duracaoMs? }.
 */
export async function executarRotina(nome, { runtime, gatilho = "AGENDADO", agora = new Date(), janela = janelaDoDia(agora), dataReferencia } = {}) {
  const def = ROTINAS[nome];
  if (!def) throw erro(404, `Rotina desconhecida: "${nome}"`);
  const bloqueadoAte = new Date(agora.getTime() + LEASE_ROTINA_MS);
  const chave = { rotina_janela: { rotina: nome, janela } };

  let registro;
  try {
    registro = await prisma.execucaoRotina.create({ data: { rotina: nome, janela, gatilho, status: "EXECUTANDO", bloqueadoAte, iniciadaEm: agora } });
  } catch (e) {
    if (e?.code !== "P2002") throw e;
    // a janela já tem registro: só retoma se falhou ou se o lease venceu (UPDATE condicional = um vencedor)
    const { count } = await prisma.execucaoRotina.updateMany({
      where: { rotina: nome, janela, OR: [{ status: "FALHA" }, { status: "EXECUTANDO", bloqueadoAte: { lt: agora } }] },
      data: { status: "EXECUTANDO", gatilho, bloqueadoAte, iniciadaEm: agora, finalizadaEm: null, erro: null, execucaoId: null, tentativas: { increment: 1 } },
    });
    registro = await prisma.execucaoRotina.findUnique({ where: chave });
    if (count !== 1) {
      return { executada: false, rotina: nome, janela, status: registro.status, motivo: registro.status === "SUCESSO" ? "JA_EXECUTADA_NA_JANELA" : "EM_EXECUCAO", execucaoId: registro.execucaoId, tentativas: registro.tentativas };
    }
  }

  const inicio = Date.now();
  try {
    const r = await runtime.executarAgente(def.agente, { tipo: def.tipo, dados: { ...(dataReferencia && { dataReferencia }) } }, { gatilho });
    const fim = await prisma.execucaoRotina.update({ where: { id: registro.id }, data: { status: "SUCESSO", execucaoId: r.execucaoId, finalizadaEm: new Date() } });
    return { executada: true, rotina: nome, janela, status: "SUCESSO", execucaoId: r.execucaoId, tentativas: fim.tentativas, duracaoMs: Date.now() - inicio };
  } catch (e) {
    const fim = await prisma.execucaoRotina.update({ where: { id: registro.id }, data: { status: "FALHA", execucaoId: e?.execucaoId ?? null, erro: mensagemSegura(e), finalizadaEm: new Date() } });
    return { executada: true, rotina: nome, janela, status: "FALHA", motivo: fim.erro, execucaoId: fim.execucaoId, tentativas: fim.tentativas, duracaoMs: Date.now() - inicio };
  }
}

/** Marca que um evento de domínio pede nova análise. Barato e idempotente por rotina (um upsert). */
export async function sinalizarEvento(evento, { agora = new Date() } = {}) {
  const rotinas = EVENTOS[evento];
  if (!rotinas) throw erro(400, `Evento desconhecido: "${evento}"`);
  for (const rotina of rotinas) {
    const dados = { pendente: true, ultimoEvento: evento, ultimoEventoEm: agora };
    try {
      await prisma.sinalAnalise.upsert({ where: { rotina }, create: { rotina, eventos: 1, ...dados }, update: { ...dados, eventos: { increment: 1 } } });
    } catch (e) {
      if (e?.code !== "P2002") throw e; // dois primeiros eventos simultâneos: o outro criou a linha
      await prisma.sinalAnalise.update({ where: { rotina }, data: { ...dados, eventos: { increment: 1 } } });
    }
  }
  return rotinas;
}

/**
 * Ponto de chamada dos controllers e do executor de ações, DEPOIS do commit do domínio:
 * só com SMA_EVENTOS_ENABLED=true, e uma falha aqui nunca derruba o registro da venda/produção.
 */
export async function sinalizarSeHabilitado(evento) {
  if (!flags().eventosHabilitados) return;
  try {
    await sinalizarEvento(evento);
  } catch (e) {
    console.warn(`Sinal de análise não registrado (${evento}): ${mensagemSegura(e)}`);
  }
}

/**
 * Processa os sinais pendentes que estão quietos há `debounceMs` (rajada de vendas → uma análise).
 * Cada sinal é "baixado" com UPDATE condicional antes de rodar: dois disparos simultâneos não analisam duas vezes.
 */
export async function processarSinais({ runtime, agora = new Date(), debounceMs = DEBOUNCE_EVENTOS_MS, dataReferencia } = {}) {
  const limite = new Date(agora.getTime() - debounceMs);
  const pendentes = await prisma.sinalAnalise.findMany({ where: { pendente: true }, orderBy: { rotina: "asc" } });
  const resultados = [];
  const aguardando = [];
  for (const s of pendentes) {
    if (s.ultimoEventoEm > limite) {
      aguardando.push(s.rotina);
      continue;
    }
    const { count } = await prisma.sinalAnalise.updateMany({ where: { rotina: s.rotina, pendente: true, ultimoEventoEm: s.ultimoEventoEm }, data: { pendente: false } });
    if (count !== 1) continue; // outro disparo baixou (ou chegou evento novo: fica para a próxima)
    const r = await executarRotina(s.rotina, { runtime, gatilho: "EVENTO", agora, janela: `evento:${s.ultimoEventoEm.toISOString()}`, dataReferencia });
    if (r.status === "FALHA") {
      // não perde o sinal: a próxima chamada tenta de novo (a janela em FALHA pode ser retomada)
      await prisma.sinalAnalise.updateMany({ where: { rotina: s.rotina, pendente: false }, data: { pendente: true } });
    }
    resultados.push(r);
  }
  return { processados: resultados.length, resultados, aguardandoDebounce: aguardando };
}

/** Situação das rotinas para o health check (sem dados de negócio). */
export async function situacaoRotinas() {
  const [ultimas, sinais] = await Promise.all([
    prisma.execucaoRotina.findMany({ orderBy: { id: "desc" }, take: 10, select: { rotina: true, janela: true, status: true, finalizadaEm: true } }),
    prisma.sinalAnalise.findMany({ where: { pendente: true }, select: { rotina: true } }),
  ]);
  const ultimaPorRotina = {};
  for (const u of ultimas) ultimaPorRotina[u.rotina] ??= { janela: u.janela, status: u.status, finalizadaEm: u.finalizadaEm };
  return { ultimas: ultimaPorRotina, sinaisPendentes: sinais.map((s) => s.rotina) };
}
