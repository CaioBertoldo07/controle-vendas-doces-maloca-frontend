// Etapa 6 — concorrência com garantia NO BANCO: recomendações e propostas
// deduplicadas por índice único; um turno por vez em cada conversa (lease).
import { describe, expect, it } from "vitest";
import * as acoes from "../../src/agents/acoes/servicoAcoes.js";
import { criarProvedorFake } from "../../src/agents/llm/provedorFake.js";
import { registrarRecomendacao } from "../../src/agents/runtime/recomendacoes.js";
import * as servicoConversa from "../../src/agents/servicoConversa.js";
import { prisma } from "../caracterizacao/helpers/db.js";
import { criarCliente, criarSabor, criarUsuario } from "../caracterizacao/helpers/fixtures.js";
import { REF, cenarioVendas } from "./cenarioVendas.js";
import { capturar, runtimeTeste } from "./helpers.js";

const interp = (tipo) => ({ json: { intencoes: [{ tipo, sabor: null, janelaSemanas: null }], venda: null, pagamento: null, esclarecimento: null } });

describe("recomendações: N análises concorrentes → 1 ABERTA por chave", () => {
  it("10 registros simultâneos da mesma chave → 1 linha, 10 ocorrências (nenhum incremento perdido)", async () => {
    const entrada = { tipo: "CONTAGEM_FISICA", chave: "estoque-acabado", titulo: "Contar o estoque", descricao: "Contagem física", prioridade: "ALTA" };
    const r = await Promise.all(Array.from({ length: 10 }, () => registrarRecomendacao({ agente: "estoque", execucaoId: null, entrada })));
    expect(r.filter((x) => x.operacao === "CRIADA")).toHaveLength(1);
    expect(r.filter((x) => x.operacao === "ATUALIZADA")).toHaveLength(9);
    const linhas = await prisma.recomendacao.findMany();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ status: "ABERTA", chaveAtiva: "estoque|CONTAGEM_FISICA|estoque-acabado" });
    expect(linhas[0].dados.controle.ocorrencias).toBe(10);
  });

  it("5 análises de estoque simultâneas (com cooperação) → 1 ABERTA por chave; resolver libera a chave", async () => {
    await cenarioVendas();
    const rt = runtimeTeste();
    const r = await Promise.all(Array.from({ length: 5 }, () => rt.executarAgente("estoque", { tipo: "ANALISAR_ESTOQUE", dados: { dataReferencia: REF } })));
    expect(r.every((x) => x.status === "SUCESSO")).toBe(true);
    const abertas = await prisma.recomendacao.findMany({ where: { status: "ABERTA" }, orderBy: { tipo: "asc" } });
    expect(abertas.map((a) => [a.tipo, a.dados.controle.ocorrencias])).toEqual([["CADASTRAR_RECEITAS", 5], ["CONTAGEM_FISICA", 5]]);
    // gestor resolve → chave liberada; a próxima análise cria uma nova ABERTA (o problema continua)
    const { alterarStatus } = await import("../../src/agents/runtime/recomendacoes.js");
    const contagem = abertas.find((a) => a.tipo === "CONTAGEM_FISICA");
    expect(await alterarStatus(contagem.id, "RESOLVIDA")).toMatchObject({ status: "RESOLVIDA", chaveAtiva: null });
    await rt.executarAgente("estoque", { tipo: "ANALISAR_ESTOQUE", dados: { dataReferencia: REF } });
    expect(await prisma.recomendacao.count({ where: { tipo: "CONTAGEM_FISICA" } })).toBe(2);
    expect(await prisma.recomendacao.count({ where: { tipo: "CONTAGEM_FISICA", status: "ABERTA" } })).toBe(1);
  });
});

describe("propostas: 5 idênticas simultâneas → 1 PENDENTE; distintas continuam distintas", () => {
  it("mesma ação lógica → uma PENDENTE (as outras reaproveitam); outra quantidade é outra ação", async () => {
    const cliente = await criarCliente();
    const sabor = await criarSabor();
    const proposta = (quantidade = 6) => acoes.proporAcao({ tipo: "REGISTRAR_VENDA", descricao: "Venda relatada", criadaPorAgente: "vendas", payload: { clienteId: cliente.id, sabores: [{ saborId: sabor.id, quantidade }], valor: 33 } });
    const r = await Promise.all(Array.from({ length: 5 }, () => proposta()));
    expect(new Set(r.map((x) => x.id)).size).toBe(1);
    expect(r.filter((x) => !x.reaproveitada)).toHaveLength(1);
    expect(await prisma.acaoProposta.count({ where: { status: "PENDENTE" } })).toBe(1);
    await proposta(7);
    expect(await prisma.acaoProposta.count({ where: { status: "PENDENTE" } })).toBe(2);
    // depois de rejeitada, a mesma intenção é uma ação nova legítima
    await acoes.rejeitarAcao(r[0].id, "duplicada");
    expect(await prisma.acaoProposta.findUnique({ where: { id: r[0].id } })).toMatchObject({ status: "REJEITADA", chaveAtiva: null });
    expect((await proposta()).reaproveitada).toBe(false);
  });

  it("a chave não depende da ordem dos campos do payload", () => {
    expect(acoes.chaveDaAcao("REGISTRAR_VENDA", { valor: 33, clienteId: 1, sabores: [{ quantidade: 6, saborId: 2 }] }))
      .toBe(acoes.chaveDaAcao("REGISTRAR_VENDA", { clienteId: 1, sabores: [{ saborId: 2, quantidade: 6 }], valor: 33 }));
    expect(acoes.chaveDaAcao("REGISTRAR_VENDA", { valor: 33 })).not.toBe(acoes.chaveDaAcao("MARCAR_VENDA_PAGA", { valor: 33 }));
  });
});

describe("conversa: um turno por vez (lease), sem contexto sobrescrito", () => {
  it("2 turnos simultâneos na mesma conversa → um responde, o outro recebe 409 e não grava nada; outra conversa segue", async () => {
    await cenarioVendas();
    const { usuario } = await criarUsuario();
    const lento = criarProvedorFake([{ atrasoMs: 300, ...interp("AJUDA") }, { atrasoMs: 300, ...interp("AJUDA") }]);
    const rt = runtimeTeste({ provedorLLM: lento });
    const primeira = await servicoConversa.enviarMensagem({ usuarioId: usuario.id, mensagem: "oi" }, runtimeTeste({ provedorLLM: criarProvedorFake([interp("AJUDA")]) }));
    const conversaId = primeira.conversaId;

    const [a, b, outra] = await Promise.allSettled([
      servicoConversa.enviarMensagem({ usuarioId: usuario.id, conversaId, mensagem: "o que você faz?" }, rt),
      new Promise((r) => setTimeout(r, 50)).then(() => servicoConversa.enviarMensagem({ usuarioId: usuario.id, conversaId, mensagem: "e agora?" }, rt)),
      servicoConversa.enviarMensagem({ usuarioId: usuario.id, mensagem: "outra conversa" }, rt),
    ]);
    expect(a.status).toBe("fulfilled");
    expect(b).toMatchObject({ status: "rejected", reason: { status: 409 } });
    expect(b.reason.corpo.error).toBe(servicoConversa.OCUPADA);
    expect(outra.status).toBe("fulfilled"); // conversas diferentes não se bloqueiam
    const msgs = await prisma.mensagemConversa.findMany({ where: { conversaId }, orderBy: { id: "asc" } });
    expect(msgs.map((m) => m.conteudo).filter((c) => c === "e agora?")).toEqual([]); // o turno recusado não gravou nada
    expect(msgs).toHaveLength(4);
    expect(await prisma.conversaAgente.findUnique({ where: { id: conversaId } })).toMatchObject({ processandoAte: null, tokenProcessamento: null });
  });

  it("lease vencido (processo caiu no meio de um turno) → a conversa volta a aceitar mensagens", async () => {
    const { usuario } = await criarUsuario();
    const c = await prisma.conversaAgente.create({ data: { usuarioId: usuario.id, processandoAte: new Date(Date.now() + 60000), tokenProcessamento: "turno-que-caiu" } });
    const rt = runtimeTeste({ provedorLLM: criarProvedorFake([interp("AJUDA")]) });
    expect((await capturar(servicoConversa.enviarMensagem({ usuarioId: usuario.id, conversaId: c.id, mensagem: "oi" }, rt))).status).toBe(409);
    await prisma.conversaAgente.update({ where: { id: c.id }, data: { processandoAte: new Date(Date.now() - 1000) } }); // venceu
    const r = await servicoConversa.enviarMensagem({ usuarioId: usuario.id, conversaId: c.id, mensagem: "oi" }, rt);
    expect(r.mensagem.conteudo).toMatch(/^Posso consultar/);
  });

  it("turno que perdeu o lease (venceu e outro assumiu) não sobrescreve o estado: resposta marcada contextoNaoGravado", async () => {
    const { usuario } = await criarUsuario();
    const c = await prisma.conversaAgente.create({ data: { usuarioId: usuario.id, estado: { ultimoAssunto: { intencoes: [{ tipo: "CONSULTAR_VENDAS" }] } } } });
    const fake = criarProvedorFake([interp("AJUDA")]);
    const assumeNoMeio = {
      nome: "fake", modelo: null,
      async gerar(req) {
        // outro turno assume a conversa (o lease deste teria vencido) enquanto este espera o LLM
        await prisma.conversaAgente.update({ where: { id: c.id }, data: { tokenProcessamento: "outro-turno", estado: { ultimoAssunto: { intencoes: [{ tipo: "CONSULTAR_ESTOQUE" }] } } } });
        return fake.gerar(req);
      },
    };
    const r = await servicoConversa.enviarMensagem({ usuarioId: usuario.id, conversaId: c.id, mensagem: "ajuda" }, runtimeTeste({ provedorLLM: assumeNoMeio }));
    expect(r.mensagem.contextoNaoGravado).toBe(true);
    expect((await prisma.conversaAgente.findUnique({ where: { id: c.id } })).estado.ultimoAssunto.intencoes[0].tipo).toBe("CONSULTAR_ESTOQUE");
  });

  it("conversa longa (> 6 mensagens): o LLM recebe só a janela de 6 + a atual, cada uma limitada a 500 caracteres", async () => {
    const { usuario } = await criarUsuario();
    const c = await prisma.conversaAgente.create({ data: { usuarioId: usuario.id } });
    for (let i = 1; i <= 10; i++) {
      await prisma.mensagemConversa.create({ data: { conversaId: c.id, papel: i % 2 ? "USUARIO" : "ASSISTENTE", conteudo: `m${i} ${"x".repeat(900)}` } });
    }
    const llm = criarProvedorFake([interp("AJUDA")]);
    await servicoConversa.enviarMensagem({ usuarioId: usuario.id, conversaId: c.id, mensagem: "ajuda" }, runtimeTeste({ provedorLLM: llm }));
    const enviadas = llm.requisicoes[0].mensagens;
    expect(enviadas).toHaveLength(7); // as 6 últimas (m5..m10, começando num turno do gestor) + a atual
    expect(enviadas.map((m) => m.conteudo.slice(0, 3))).toEqual(["m5 ", "m6 ", "m7 ", "m8 ", "m9 ", "m10", "Con"]);
    expect(enviadas.slice(0, -1).every((m) => m.conteudo.length <= 501)).toBe(true);
    expect(JSON.stringify(llm.requisicoes)).not.toMatch(/m1 |m2 |m3 |m4 /);
  });
});
