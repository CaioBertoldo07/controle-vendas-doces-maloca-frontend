// Etapa 1 — ações propostas: o agente só propõe (PENDENTE); o gestor aprova ou
// rejeita; o executor determinístico chama o service; nada executa duas vezes.
import { beforeEach, describe, expect, it } from "vitest";
import * as acoes from "../../src/agents/acoes/servicoAcoes.js";
import { n, prisma } from "../caracterizacao/helpers/db.js";
import { cenarioReceitaBasica, criarCliente, criarSabor, criarVenda } from "../caracterizacao/helpers/fixtures.js";
import { agenteTeste, capturar, runtimeTeste } from "./helpers.js";

let cliente, coco, limao;
beforeEach(async () => {
  cliente = await criarCliente("Mercearia Fictícia Aurora");
  coco = await criarSabor({ nome: "Coco Fictício" });
  limao = await criarSabor({ nome: "Limão Fictício" });
});

const propostaVenda = (extra = {}) => ({
  tipo: "REGISTRAR_VENDA",
  descricao: "Venda informada pelo gestor no chat",
  criadaPorAgente: "vendas",
  payload: { clienteId: cliente.id, sabores: [{ saborId: coco.id, quantidade: 2 }, { saborId: limao.id, quantidade: 3 }], valor: 27.5, data: "2026-10-01T10:00:00" },
  ...extra,
});

describe("proporAcao", () => {
  it("cria a ação PENDENTE com payload validado; nenhuma venda é criada", async () => {
    const a = await acoes.proporAcao(propostaVenda());
    expect(a).toMatchObject({ tipo: "REGISTRAR_VENDA", status: "PENDENTE", criadaPorAgente: "vendas", aprovadaEm: null, executadaEm: null });
    expect(a.payload).toEqual(propostaVenda().payload);
    expect(await prisma.venda.count()).toBe(0);
  });

  it("pela tool do agente: registra criadaPorAgente e a execução de origem", async () => {
    const propoe = agenteTeste("vendas-teste", async (ctx) => ctx.usarTool("proporAcao", {
      tipo: "MARCAR_VENDA_PAGA", descricao: "Gestor disse que recebeu", payload: { vendaId: ctx.entrada.dados.vendaId },
    }), ["proporAcao"]);
    const v = await criarVenda({ clienteId: cliente.id, itens: [{ saborId: coco.id, quantidade: 1 }] });
    const r = await runtimeTeste({ extras: [propoe] }).executarAgente("vendas-teste", { tipo: "TESTE", dados: { vendaId: v.id } });
    expect(r.saida).toMatchObject({ ok: true, dados: { tipo: "MARCAR_VENDA_PAGA", status: "PENDENTE" } });
    expect(await prisma.acaoProposta.findUnique({ where: { id: r.saida.dados.acaoId } })).toMatchObject({ criadaPorAgente: "vendas-teste", execucaoId: r.execucaoId });
    expect((await prisma.venda.findUnique({ where: { id: v.id } })).pago).toBe(false); // nada executado
  });

  it("tipo fora da allowlist → 400 com os tipos permitidos (e, pela tool, ENTRADA_INVALIDA)", async () => {
    const e = await capturar(acoes.proporAcao(propostaVenda({ tipo: "EXCLUIR_VENDA" })));
    expect(e.status).toBe(400);
    expect(e.corpo.permitidos).toEqual(["REGISTRAR_VENDA", "REGISTRAR_PRODUCAO", "MARCAR_VENDA_PAGA"]);
    const propoe = agenteTeste("propositor", async (ctx) => ctx.usarTool("proporAcao", { tipo: "EXCLUIR_VENDA", descricao: "apagar tudo", payload: {} }), ["proporAcao"]);
    expect((await runtimeTeste({ extras: [propoe] }).executarAgente("propositor", { tipo: "TESTE" })).saida.erro.codigo).toBe("ENTRADA_INVALIDA");
    expect(await prisma.acaoProposta.count()).toBe(0);
  });

  it.each([
    ["sem itens", { sabores: [] }, "sabores"],
    ["item com quantidade zero", { sabores: [{ saborId: 1, quantidade: 0 }] }, "sabores.0.quantidade"],
    ["campo desconhecido", { quantidadeTotal: 999 }, "(raiz)"],
    ["data com fuso (contrato pede horário civil)", { data: "2026-10-01T10:00:00Z" }, "data"],
  ])("payload inválido (%s) → 400 com o campo", async (_, extra, campo) => {
    const e = await capturar(acoes.proporAcao(propostaVenda({ payload: { ...propostaVenda().payload, ...extra } })));
    expect(e.status).toBe(400);
    expect(e.corpo.detalhes.map((d) => d.campo)).toContain(campo);
  });

  it("referências verificadas: cliente inexistente 404, sabor inativo 409, venda já paga 409", async () => {
    expect((await capturar(acoes.proporAcao(propostaVenda({ payload: { ...propostaVenda().payload, clienteId: 999999 } })))).status).toBe(404);
    const inativo = await criarSabor({ nome: "Inativo Fictício", ativo: false });
    expect((await capturar(acoes.proporAcao(propostaVenda({ payload: { ...propostaVenda().payload, sabores: [{ saborId: inativo.id, quantidade: 1 }] } })))).status).toBe(409);
    const paga = await criarVenda({ clienteId: cliente.id, itens: [{ saborId: coco.id, quantidade: 1 }], pago: true });
    const e = await capturar(acoes.proporAcao({ tipo: "MARCAR_VENDA_PAGA", descricao: "receber de novo", criadaPorAgente: "vendas", payload: { vendaId: paga.id } }));
    expect(e.status).toBe(409);
  });
});

describe("aprovação, rejeição e executor determinístico", () => {
  it("REGISTRAR_VENDA aprovada → EXECUTADA pelo service (quantidade = soma dos itens)", async () => {
    const a = await acoes.proporAcao(propostaVenda());
    const feita = await acoes.aprovarEExecutar(a.id);
    expect(feita).toMatchObject({ status: "EXECUTADA", erro: null });
    expect(feita.aprovadaEm).not.toBeNull();
    expect(feita.executadaEm).not.toBeNull();
    const venda = await prisma.venda.findUnique({ where: { id: feita.resultado.vendaId } });
    expect(venda).toMatchObject({ clienteId: cliente.id, quantidade: 5, pago: false });
    expect(n(venda.valor)).toBe(27.5);
    expect(venda.data.toISOString()).toBe("2026-10-01T10:00:00.000Z"); // horário civil de Manaus
  });

  it("REGISTRAR_PRODUCAO sem insumo suficiente → FALHA com o motivo; nenhuma produção gravada", async () => {
    const { sabor } = await cenarioReceitaBasica({ estoqueAcucar: 100 });
    const a = await acoes.proporAcao({ tipo: "REGISTRAR_PRODUCAO", descricao: "Lote sugerido", criadaPorAgente: "estoque", payload: { sabores: [{ saborId: sabor.id, quantidade: 50 }] } });
    const r = await acoes.aprovarEExecutar(a.id);
    expect(r).toMatchObject({ status: "FALHA", erro: "Estoque insuficiente de matéria-prima" });
    expect(r.resultado.faltantes).toHaveLength(1);
    expect(await prisma.producao.count()).toBe(0);
  });

  it("MARCAR_VENDA_PAGA aprovada marca a venda", async () => {
    const v = await criarVenda({ clienteId: cliente.id, itens: [{ saborId: coco.id, quantidade: 1 }] });
    const a = await acoes.proporAcao({ tipo: "MARCAR_VENDA_PAGA", descricao: "Recebido em dinheiro", criadaPorAgente: "vendas", payload: { vendaId: v.id, dataPagamento: "2026-10-01T09:30:00" } });
    expect((await acoes.aprovarEExecutar(a.id)).resultado).toEqual({ vendaId: v.id, jaEstavaPaga: false });
    const paga = await prisma.venda.findUnique({ where: { id: v.id } });
    expect(paga.pago).toBe(true);
    expect(paga.dataPagamento.toISOString()).toBe("2026-10-01T09:30:00.000Z");
  });

  it("rejeitada nunca executa; PENDENTE não executa sem aprovação", async () => {
    const a = await acoes.proporAcao(propostaVenda());
    expect((await capturar(acoes.executarAcaoAprovada(a.id))).status).toBe(409); // ainda PENDENTE
    const rej = await acoes.rejeitarAcao(a.id, "Valor errado");
    expect(rej).toMatchObject({ status: "REJEITADA", motivoRejeicao: "Valor errado" });
    expect(rej.rejeitadaEm).not.toBeNull();
    expect((await capturar(acoes.aprovarAcao(a.id))).status).toBe(409);
    expect((await capturar(acoes.executarAcaoAprovada(a.id))).status).toBe(409);
    expect(await prisma.venda.count()).toBe(0);
  });

  it("dupla execução impedida: sequencial e concorrente (uma venda só)", async () => {
    const a = await acoes.proporAcao(propostaVenda());
    await acoes.aprovarEExecutar(a.id);
    expect((await capturar(acoes.aprovarEExecutar(a.id))).status).toBe(409);
    expect((await capturar(acoes.executarAcaoAprovada(a.id))).status).toBe(409);

    const b = await acoes.proporAcao(propostaVenda());
    await acoes.aprovarAcao(b.id);
    const tentativas = await Promise.allSettled([1, 2, 3].map(() => acoes.executarAcaoAprovada(b.id)));
    expect(tentativas.filter((t) => t.status === "fulfilled")).toHaveLength(1);
    expect(tentativas.filter((t) => t.status === "rejected").every((t) => t.reason.status === 409)).toBe(true);
    expect(await prisma.venda.count()).toBe(2); // uma por ação
  });

  it("id inexistente ou inválido → 404", async () => {
    expect((await capturar(acoes.aprovarAcao(999999))).status).toBe(404);
    expect((await capturar(acoes.rejeitarAcao("abc"))).status).toBe(404);
  });
});
