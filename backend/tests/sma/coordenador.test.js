// Etapa 1 — Coordenador (esqueleto determinístico) e a cadeia
// Atendimento → Coordenador → especializados, provada pelo histórico.
import { describe, expect, it } from "vitest";
import { prisma } from "../caracterizacao/helpers/db.js";
import { agenteTeste, capturar, runtimeTeste } from "./helpers.js";

describe("coordenador", () => {
  it("DIAGNOSTICO_GERAL: delega a estoque, vendas e inteligência, registra as mensagens e agrega", async () => {
    const r = await runtimeTeste().executarAgente("coordenador", { tipo: "DIAGNOSTICO_GERAL" });
    expect(r.saida).toMatchObject({ intencao: "DIAGNOSTICO_GERAL", delegadoPara: ["estoque", "vendas", "inteligencia"], falhas: [], completo: true });
    expect(Object.keys(r.saida.respostas)).toEqual(["estoque", "vendas", "inteligencia"]);
    expect(Object.values(r.saida.respostas).every((x) => x.toolsOk)).toBe(true);

    const msgs = await prisma.mensagemAgente.findMany({ orderBy: { id: "asc" } });
    expect(msgs.map((m) => [m.agenteOrigem, m.agenteDestino, m.tipo, m.status])).toEqual([
      ["coordenador", "estoque", "DIAGNOSTICO", "RESPONDIDA"],
      ["coordenador", "vendas", "DIAGNOSTICO", "RESPONDIDA"],
      ["coordenador", "inteligencia", "DIAGNOSTICO", "RESPONDIDA"],
    ]);
    const filhas = await prisma.execucaoAgente.findMany({ where: { execucaoPaiId: r.execucaoId }, orderBy: { id: "asc" } });
    expect(filhas.map((f) => [f.agente, f.gatilho, f.status])).toEqual([
      ["estoque", "MENSAGEM", "SUCESSO"], ["vendas", "MENSAGEM", "SUCESSO"], ["inteligencia", "MENSAGEM", "SUCESSO"],
    ]);
    expect(await prisma.chamadaTool.count()).toBe(5); // 2 (estoque) + 2 (vendas) + 1 (inteligência)
  });

  it("falha parcial: um especializado falha, o coordenador conclui e informa a falha", async () => {
    const vendasQuebrado = agenteTeste("vendas", async () => { throw new Error("indisponível"); });
    const r = await runtimeTeste({ substituir: [vendasQuebrado] }).executarAgente("coordenador", { tipo: "DIAGNOSTICO_GERAL" });
    expect(r.status).toBe("SUCESSO");
    expect(r.saida.completo).toBe(false);
    expect(r.saida.falhas).toEqual([{ agente: "vendas", execucaoId: expect.any(Number) }]);
    expect(Object.keys(r.saida.respostas)).toEqual(["estoque", "inteligencia"]);
    expect((await prisma.mensagemAgente.findFirst({ where: { agenteDestino: "vendas" } })).status).toBe("FALHA");
  });

  it("intenção desconhecida → execução FALHA, sem delegar", async () => {
    const e = await capturar(runtimeTeste().executarAgente("coordenador", { tipo: "VENDER_TUDO" }));
    expect((await prisma.execucaoAgente.findUnique({ where: { id: e.execucaoId } })).erro).toBe('Intenção não suportada pelo coordenador: "VENDER_TUDO"');
    expect(await prisma.mensagemAgente.count()).toBe(0);
  });
});

describe("atendimento como interface de entrada (stub)", () => {
  it("Atendimento → Coordenador → Estoque/Vendas/Inteligência: árvore de execuções e mensagens", async () => {
    const r = await runtimeTeste().executarAgente("atendimento", { tipo: "SOLICITAR_DIAGNOSTICO" }, { gatilho: "HTTP" });
    expect(r.saida).toMatchObject({ encaminhadoPara: "coordenador", resposta: { completo: true } });

    const execs = await prisma.execucaoAgente.findMany({ orderBy: { id: "asc" } });
    const porId = new Map(execs.map((x) => [x.id, x]));
    const caminho = (x) => (x.execucaoPaiId ? `${caminho(porId.get(x.execucaoPaiId))} → ${x.agente}` : x.agente);
    expect(execs.map(caminho)).toEqual([
      "atendimento",
      "atendimento → coordenador",
      "atendimento → coordenador → estoque",
      "atendimento → coordenador → vendas",
      "atendimento → coordenador → inteligencia",
    ]);
    expect(await prisma.mensagemAgente.count()).toBe(4);
  });
});
