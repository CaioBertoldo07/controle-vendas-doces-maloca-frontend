// Etapa 6 — execução ATÔMICA das ações: claim + efeito de domínio + EXECUTADA
// numa só transação. Concorrência, falha no meio, recusa do domínio e queda real
// do processo: nunca escrita parcial, nunca EXECUTANDO confirmado.
import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as acoes from "../../src/agents/acoes/servicoAcoes.js";
import * as vendasService from "../../src/services/vendasService.js";
import { prisma } from "../caracterizacao/helpers/db.js";
import { cenarioReceitaBasica, criarCliente, criarSabor, criarVenda } from "../caracterizacao/helpers/fixtures.js";
import { capturar } from "./helpers.js";

async function vendaAprovada() {
  const cliente = await criarCliente("Mercearia Fictícia Aurora");
  const sabor = await criarSabor({ nome: "Coco Fictício" });
  const a = await acoes.proporAcao({ tipo: "REGISTRAR_VENDA", descricao: "Venda relatada", criadaPorAgente: "vendas", payload: { clienteId: cliente.id, sabores: [{ saborId: sabor.id, quantidade: 6 }], valor: 33 } });
  await acoes.aprovarAcao(a.id);
  return a.id;
}

describe("execução atômica de ações", () => {
  it("3 execuções simultâneas → exatamente 1 venda e 1 EXECUTADA; as outras recebem 409", async () => {
    const id = await vendaAprovada();
    const r = await Promise.allSettled([1, 2, 3].map(() => acoes.executarAcaoAprovada(id)));
    expect(r.filter((x) => x.status === "fulfilled").map((x) => x.value.status)).toEqual(["EXECUTADA"]);
    expect(r.filter((x) => x.status === "rejected").map((x) => x.reason.status)).toEqual([409, 409]);
    expect(await prisma.venda.count()).toBe(1);
    expect(await prisma.acaoProposta.findUnique({ where: { id } })).toMatchObject({ status: "EXECUTADA", erro: null });
  });

  it("falha inesperada DEPOIS de gravar o domínio → rollback total; continua APROVADA (recuperável) e reexecuta uma vez", async () => {
    const id = await vendaAprovada();
    const quebrado = {
      REGISTRAR_VENDA: {
        async executar(p, tx) {
          await vendasService.criarVenda({ ...p, quantidade: 6 }, tx);
          throw new Error("conexão perdida no meio");
        },
      },
    };
    const depois = await acoes.executarAcaoAprovada(id, { contratos: quebrado });
    expect(depois).toMatchObject({ status: "APROVADA", executadaEm: null, erro: "Execução não concluída; nenhuma alteração foi aplicada: conexão perdida no meio" });
    expect(await prisma.venda.count()).toBe(0); // nenhuma escrita parcial
    const ok = await acoes.aprovarEExecutar(id); // o gestor reexecuta pelo mesmo fluxo
    expect(ok).toMatchObject({ status: "EXECUTADA", erro: null });
    expect(await prisma.venda.count()).toBe(1);
  });

  it("recusa do domínio no meio (insumo insuficiente) → FALHA sem nenhuma produção nem saída de insumo", async () => {
    const { sabor } = await cenarioReceitaBasica({ estoqueAcucar: 10 });
    const a = await acoes.proporAcao({ tipo: "REGISTRAR_PRODUCAO", descricao: "Lote grande", criadaPorAgente: "estoque", payload: { sabores: [{ saborId: sabor.id, quantidade: 500 }] } });
    const movimentacoes = await prisma.movimentacaoMateriaPrima.count();
    const r = await acoes.aprovarEExecutar(a.id);
    expect(r).toMatchObject({ status: "FALHA", erro: "Estoque insuficiente de matéria-prima" });
    expect(await prisma.producao.count()).toBe(0);
    expect(await prisma.movimentacaoMateriaPrima.count()).toBe(movimentacoes);
    expect((await capturar(acoes.aprovarEExecutar(a.id))).status).toBe(409); // FALHA é final
  });

  it("marcar paga: efeito e EXECUTADA juntos; venda que ficou paga antes da execução não é tocada de novo", async () => {
    const cliente = await criarCliente();
    const sabor = await criarSabor();
    const v = await criarVenda({ clienteId: cliente.id, itens: [{ saborId: sabor.id, quantidade: 2 }] });
    const a = await acoes.proporAcao({ tipo: "MARCAR_VENDA_PAGA", descricao: "Recebido em dinheiro", criadaPorAgente: "vendas", payload: { vendaId: v.id, dataPagamento: "2026-10-01T09:30:00" } });
    expect(await acoes.aprovarEExecutar(a.id)).toMatchObject({ status: "EXECUTADA", resultado: { vendaId: v.id, jaEstavaPaga: false } });
    expect(await prisma.venda.findUnique({ where: { id: v.id } })).toMatchObject({ pago: true });
  });

  it("QUEDA REAL do processo no meio da transação → MySQL desfaz: nenhuma venda, ação APROVADA (nunca EXECUTANDO)", async () => {
    const id = await vendaAprovada();
    const script = path.resolve("tests/sma/apoio/quedaNoExecutor.js");
    const filho = spawn(process.execPath, [script, String(id)], { env: { ...process.env, DATABASE_URL: process.env.MALOCA_SUITE_URL_TESTE }, stdio: ["ignore", "pipe", "pipe"] });
    let saida = "";
    filho.stdout.on("data", (d) => { saida += d; });
    filho.stderr.on("data", (d) => { saida += d; });
    const codigo = await new Promise((r) => filho.on("close", r));
    expect(codigo, saida).toBe(17);
    expect(saida).toContain("VENDA_GRAVADA_SEM_COMMIT");
    // o servidor MySQL desfaz a transação ao perder a conexão; espera a liberação da linha
    let acao;
    for (let i = 0; i < 40; i++) {
      acao = await prisma.acaoProposta.findUnique({ where: { id } });
      if (acao.status === "APROVADA") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(acao).toMatchObject({ status: "APROVADA", executadaEm: null });
    expect(await prisma.venda.count()).toBe(0);
    expect(await acoes.contarAcoesEmExecucao()).toBe(0);
    expect(await acoes.aprovarEExecutar(id)).toMatchObject({ status: "EXECUTADA" }); // recuperável
    expect(await prisma.venda.count()).toBe(1);
  });
});
