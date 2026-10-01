// Etapa 1 — mensagens entre agentes (cooperação), síncronas e persistidas.
import { describe, expect, it } from "vitest";
import { prisma } from "../caracterizacao/helpers/db.js";
import { agenteTeste, capturar, runtimeTeste } from "./helpers.js";

const origem = (para, tipo = "SOLICITAR_DEMANDA_MEDIA", dados = { saborId: 3 }) =>
  agenteTeste("origem", async (ctx) => ({ resposta: await ctx.enviarMensagem({ para, tipo, dados }) }));
const destino = agenteTeste("destino", async (ctx) => ({ atendi: ctx.entrada.tipo, de: ctx.entrada.de, dados: ctx.entrada.dados }));

describe("mensagens entre agentes", () => {
  it("persiste origem, destino, tipo, conteúdo, resposta e o vínculo entre as execuções", async () => {
    const rt = runtimeTeste({ extras: [origem("destino"), destino] });
    const r = await rt.executarAgente("origem", { tipo: "TESTE" });
    expect(r.saida.resposta).toEqual({ atendi: "SOLICITAR_DEMANDA_MEDIA", de: "origem", dados: { saborId: 3 } });

    const [msg] = await prisma.mensagemAgente.findMany();
    expect(msg).toMatchObject({
      execucaoId: r.execucaoId,
      agenteOrigem: "origem",
      agenteDestino: "destino",
      tipo: "SOLICITAR_DEMANDA_MEDIA",
      conteudo: { saborId: 3 },
      status: "RESPONDIDA",
      resposta: r.saida.resposta,
    });
    const filha = await prisma.execucaoAgente.findUnique({ where: { id: msg.execucaoDestinoId } });
    expect(filha).toMatchObject({ agente: "destino", gatilho: "MENSAGEM", execucaoPaiId: r.execucaoId, status: "SUCESSO" });
    expect(filha.entrada).toMatchObject({ tipo: "SOLICITAR_DEMANDA_MEDIA", de: "origem", mensagemId: msg.id });
  });

  it("destino inexistente: a execução de origem falha e nenhuma mensagem é gravada", async () => {
    const rt = runtimeTeste({ extras: [origem("fantasma")] });
    const e = await capturar(rt.executarAgente("origem", { tipo: "TESTE" }));
    const ex = await prisma.execucaoAgente.findUnique({ where: { id: e.execucaoId } });
    expect(ex).toMatchObject({ status: "FALHA", erro: 'Agente destino inexistente: "fantasma"' });
    expect(await prisma.mensagemAgente.count()).toBe(0);
  });

  it("destino que falha: mensagem FALHA ligada à execução que falhou; origem recebe o erro", async () => {
    const quebra = agenteTeste("destino", async () => { throw new Error("sem dados"); });
    const rt = runtimeTeste({ extras: [origem("destino"), quebra] });
    const e = await capturar(rt.executarAgente("origem", { tipo: "TESTE" }));
    const msg = await prisma.mensagemAgente.findFirst();
    expect(msg.status).toBe("FALHA");
    expect(msg.resposta).toEqual({ erro: 'Falha na execução do agente "destino"' });
    expect((await prisma.execucaoAgente.findUnique({ where: { id: msg.execucaoDestinoId } })).status).toBe("FALHA");
    expect((await prisma.execucaoAgente.findUnique({ where: { id: e.execucaoId } })).status).toBe("FALHA");
  });

  it("limite de profundidade impede delegação infinita (agente que chama a si mesmo)", async () => {
    const eco = agenteTeste("eco", async (ctx) => ctx.enviarMensagem({ para: "eco", tipo: "DE_NOVO" }));
    const rt = runtimeTeste({ extras: [eco], profundidadeMaxima: 3 });
    await capturar(rt.executarAgente("eco", { tipo: "TESTE" }));
    expect(await prisma.execucaoAgente.count()).toBe(4); // profundidades 0..3
    expect(await prisma.execucaoAgente.count({ where: { status: "SUCESSO" } })).toBe(0);
    const ultima = await prisma.execucaoAgente.findFirst({ orderBy: { id: "desc" } });
    expect(ultima.erro).toBe("Profundidade máxima de delegação (3) excedida");
  });
});
