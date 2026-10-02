// Etapa 6 — cenário acadêmico INTEGRADO, de ponta a ponta, com métricas:
// rotina de Estoque (coopera com a Inteligência) → rotina de Vendas →
// recomendações → gestor pergunta do Tradicional no assistente → afirmações
// validadas contra o catálogo de fatos → gestor relata uma venda → proposta
// PENDENTE → aprovação (cliques duplicados) → executada exatamente uma vez.
// Provedor de LLM FAKE (sem rede); dados 100% fictícios.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import * as acoes from "../../src/agents/acoes/servicoAcoes.js";
import { criarProvedorFake } from "../../src/agents/llm/provedorFake.js";
import { executarRotina } from "../../src/agents/rotinas/index.js";
import * as servicoConversa from "../../src/agents/servicoConversa.js";
import { prisma } from "../caracterizacao/helpers/db.js";
import { criarUsuario } from "../caracterizacao/helpers/fixtures.js";
import { REF, cenarioVendas } from "./cenarioVendas.js";
import { runtimeTeste } from "./helpers.js";

const I = (tipo, sabor = null) => ({ tipo, sabor, janelaSemanas: null });
const interp = (intencoes, extra = {}) => ({ json: { intencoes, venda: null, pagamento: null, esclarecimento: null, ...extra } });
const sintese = (montar) => (req) => {
  const linhas = req.mensagens[0].conteudo.split("\n").filter((l) => /^F\d+ \| /.test(l)).map((l) => l.split(" | "));
  const f = (entidade, metrica) => linhas.find(([, , e, m]) => e === (entidade ?? "geral") && m.endsWith(metrica))[0];
  return { json: { afirmacoes: montar(f) } };
};

describe("cenário integrado da Etapa 6", () => {
  it("rotinas → recomendações → conversa verificada → proposta → aprovação → uma execução", async () => {
    const t0 = Date.now();
    const { clientes, tradicional } = await cenarioVendas();
    const { usuario } = await criarUsuario();
    const vendasAntes = await prisma.venda.count();
    const llm = criarProvedorFake([
      interp([I("CONSULTAR_ESTOQUE", "Tradicional"), I("CONSULTAR_DEMANDA", "Tradicional")]),
      sintese((f) => [
        { texto: "Tradicional teve demanda média de 22,5 unidades por semana e produção média de 10 por semana.", factIds: [f("Tradicional", "demandaMediaSemanal"), f("Tradicional", "producaoMediaSemanal")] },
        { texto: "O saldo contábil histórico de Tradicional é de -20 unidades, sem reconciliação por contagem.", factIds: [f("Tradicional", "saldoContabilHistorico"), f(null, "estoqueAcabado.natureza")] },
        { texto: "Tradicional deve vender 22,5 unidades na próxima semana.", factIds: [f("Tradicional", "demandaMediaSemanal")] }, // previsão: descartada
      ]),
      interp([I("PROPOR_VENDA")], { venda: { cliente: "Mercearia Fictícia Aurora", itens: [{ sabor: "Tradicional", quantidade: 10 }], valor: 55 } }),
    ]);
    const rt = runtimeTeste({ provedorLLM: llm });
    const agora = new Date("2026-10-01T11:00:00Z");

    // 1-2. autonomia controlada: rotinas analíticas (gatilho AGENDADO)
    const rEstoque = await executarRotina("estoque", { runtime: rt, agora, dataReferencia: REF });
    const rVendas = await executarRotina("vendas", { runtime: rt, agora, dataReferencia: REF });
    expect([rEstoque.status, rVendas.status]).toEqual(["SUCESSO", "SUCESSO"]);
    const recomendacoes = await prisma.recomendacao.findMany({ where: { status: "ABERTA" } });
    expect(recomendacoes.length).toBeGreaterThan(0);
    expect(await prisma.acaoProposta.count()).toBe(0); // rotina nunca propõe

    // 3. conversa: afirmações validadas; a de previsão nunca chega ao gestor
    const t1 = await servicoConversa.enviarMensagem({ usuarioId: usuario.id, mensagem: "Como está o Tradicional?", dataReferencia: REF }, rt);
    expect(t1.mensagem.origemTexto).toBe("LLM");
    expect(t1.mensagem.conteudo).toBe("Tradicional teve demanda média de 22,5 unidades por semana e produção média de 10 por semana. O saldo contábil histórico de Tradicional é de -20 unidades, sem reconciliação por contagem.");
    const verificacao = (await prisma.execucaoAgente.findUnique({ where: { id: t1.execucaoId } })).saida.verificacaoFatos;
    expect(verificacao.descartadas.map((d) => d.motivo)).toEqual(["SEMANTICA_PREVISAO"]);

    // 4. proposta PENDENTE
    const t2 = await servicoConversa.enviarMensagem({ usuarioId: usuario.id, conversaId: t1.conversaId, mensagem: "Registre uma venda de 10 Tradicional para Mercearia Fictícia Aurora por R$ 55" }, rt);
    const [proposta] = t2.acoesPropostas;
    expect(proposta).toMatchObject({ status: "PENDENTE", tipoAcao: "REGISTRAR_VENDA", resumo: { cliente: { id: clientes.a.id }, itens: [{ saborId: tradicional.id, quantidade: 10 }], valorInformado: 55 } });
    expect(await prisma.venda.count()).toBe(vendasAntes);

    // 5. gestor aprova (com clique duplicado) → executada exatamente uma vez
    const cliques = await Promise.allSettled([acoes.aprovarEExecutar(proposta.acaoId), acoes.aprovarEExecutar(proposta.acaoId), acoes.aprovarEExecutar(proposta.acaoId)]);
    expect(cliques.filter((c) => c.status === "fulfilled" && c.value.status === "EXECUTADA")).toHaveLength(1);
    expect(cliques.filter((c) => c.status === "rejected").every((c) => c.reason.status === 409)).toBe(true);
    expect(await prisma.venda.count()).toBe(vendasAntes + 1);
    expect(await prisma.acaoProposta.findUnique({ where: { id: proposta.acaoId } })).toMatchObject({ status: "EXECUTADA", chaveAtiva: null });

    // métricas do cenário (para o relatório)
    const execucoes = await prisma.execucaoAgente.findMany({ select: { agente: true, status: true } });
    const rotinas = await prisma.execucaoRotina.findMany();
    const metricas = {
      agentesEnvolvidos: [...new Set(execucoes.map((e) => e.agente))].sort(),
      execucoesDeAgente: execucoes.length,
      mensagensEntreAgentes: await prisma.mensagemAgente.count(),
      chamadasDeTool: await prisma.chamadaTool.count(),
      chamadasLLM: llm.requisicoes.length,
      recomendacoesAbertas: await prisma.recomendacao.count({ where: { status: "ABERTA" } }),
      propostas: await prisma.acaoProposta.count(),
      acoesExecutadas: await prisma.acaoProposta.count({ where: { status: "EXECUTADA" } }),
      afirmacoes: { aceitas: verificacao.aceitas.length, descartadas: verificacao.descartadas.length },
      retentativas: rotinas.reduce((s, r) => s + r.tentativas - 1, 0),
      falhas: execucoes.filter((e) => e.status !== "SUCESSO").length,
      cliquesRecusados409: cliques.filter((c) => c.status === "rejected").length,
      tempoTotalMs: Date.now() - t0,
    };
    expect(metricas).toMatchObject({ agentesEnvolvidos: ["atendimento", "coordenador", "estoque", "inteligencia", "vendas"], propostas: 1, acoesExecutadas: 1, retentativas: 0, falhas: 0, cliquesRecusados409: 2 });
    if (process.env.MALOCA_METRICAS_CENARIO) fs.writeFileSync(process.env.MALOCA_METRICAS_CENARIO, JSON.stringify(metricas, null, 2));
  });
});
