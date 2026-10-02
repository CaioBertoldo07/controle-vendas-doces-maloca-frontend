// Etapa 5 — endpoint conversacional pela API (servidor real, banco de teste).
// O servidor de teste nunca tem provedor de LLM: a conversa responde que está
// indisponível, e o resto do sistema segue funcionando.
import { describe, expect, it } from "vitest";
import { prisma } from "../caracterizacao/helpers/db.js";
import { api } from "../caracterizacao/helpers/http.js";
import { criarUsuario, tokenPara } from "../caracterizacao/helpers/fixtures.js";

const INDISPONIVEL = "O assistente conversacional está temporariamente indisponível. Os agentes especializados continuam operacionais.";
const entrar = async (email = "gestora@exemplo.test") => tokenPara((await criarUsuario({ email })).usuario);

describe("POST /api/agentes/chat e GET /api/agentes/chat/:id", () => {
  it("sem token → 401", async () => {
    expect((await api().post("/api/agentes/chat").send({ mensagem: "oi" })).status).toBe(401);
    expect((await api().get("/api/agentes/chat/1")).status).toBe(401);
  });

  it.each([
    [{}, "Escreva uma mensagem"],
    [{ mensagem: "   " }, "Escreva uma mensagem"],
    [{ mensagem: "x".repeat(2001) }, "Mensagem longa demais (máximo de 2000 caracteres)"],
  ])("mensagem inválida %#  → 400 sem criar conversa", async (corpo, erro) => {
    const res = await api(await entrar()).post("/api/agentes/chat").send(corpo);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: erro });
    expect(await prisma.conversaAgente.count()).toBe(0);
  });

  it("sem provedor: conversa nova e continuação gravadas; resposta indisponível; execução auditada; nada interno exposto", async () => {
    const token = await entrar();
    const r1 = await api(token).post("/api/agentes/chat").send({ mensagem: "Como está o estoque?" });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({
      conversaId: expect.any(Number),
      mensagem: { papel: "ASSISTENTE", conteudo: INDISPONIVEL, origemTexto: "SISTEMA" },
      acoesPropostas: [], anexos: [], limitacoes: [], pendencia: null,
      execucoes: [expect.objectContaining({ agente: "atendimento", tipoExecucao: "CONVERSAR", status: "SUCESSO" })],
    });
    const r2 = await api(token).post("/api/agentes/chat").send({ conversaId: r1.body.conversaId, mensagem: "E as vendas?" });
    expect(r2.body.conversaId).toBe(r1.body.conversaId);

    const hist = await api(token).get(`/api/agentes/chat/${r1.body.conversaId}`);
    expect(hist.status).toBe(200);
    expect(hist.body.mensagens.map((m) => [m.papel, m.conteudo])).toEqual([
      ["USUARIO", "Como está o estoque?"], ["ASSISTENTE", INDISPONIVEL], ["USUARIO", "E as vendas?"], ["ASSISTENTE", INDISPONIVEL],
    ]);
    const tudo = JSON.stringify([r1.body, r2.body, hist.body]);
    expect(tudo).not.toMatch(/Você classifica|Você é o assistente|PROMPT|stack|DATABASE_URL|ANTHROPIC/);
    // a conversa NÃO usa MensagemAgente (que continua sendo só agente ↔ agente)
    expect(await prisma.mensagemAgente.count()).toBe(0);
  });

  it("conversa de outro usuário ou inexistente → 404 (sem revelar que existe)", async () => {
    const dona = await entrar("dona@exemplo.test");
    const outra = await entrar("outra@exemplo.test");
    const { body } = await api(dona).post("/api/agentes/chat").send({ mensagem: "oi" });
    for (const [token, id] of [[outra, body.conversaId], [dona, 999999], [dona, "abc"]]) {
      expect((await api(token).get(`/api/agentes/chat/${id}`)).status).toBe(404);
    }
    const intrusa = await api(outra).post("/api/agentes/chat").send({ conversaId: body.conversaId, mensagem: "continua" });
    expect(intrusa.status).toBe(404);
    expect(await prisma.mensagemConversa.count({ where: { conversaId: body.conversaId } })).toBe(2);
  });

  it("os especialistas continuam funcionando sem LLM pela mesma API", async () => {
    const token = await entrar();
    const res = await api(token).post("/api/agentes/estoque/executar").send({ tipo: "ANALISAR_ESTOQUE" });
    expect(res.body).toMatchObject({ agente: "estoque", status: "SUCESSO" });
  });
});
