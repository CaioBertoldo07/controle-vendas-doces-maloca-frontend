// Caracterização: estoque de produto acabado (estoqueController.listarEstoque).
// Regra de software: saldo = Σ produção − Σ vendas, por sabor, desde sempre.
// (A Etapa 0.2 mostrou que, com os dados reais, esse número não é confiável sem
// reconciliação; aqui só se congela a fórmula.)
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "./helpers/http.js";
import { autenticar, criarCliente, criarProducao, criarSabor, criarVenda } from "./helpers/fixtures.js";

let token, cliente;
beforeEach(async () => {
  token = await autenticar();
  cliente = await criarCliente();
});

const estoque = async () => (await api(token).get("/api/estoque")).body;
const vender = (saborId, quantidade, data) =>
  criarVenda({ clienteId: cliente.id, itens: [{ saborId, quantidade }], ...(data && { data: new Date(data) }) });
const produzir = (saborId, quantidade, data) =>
  criarProducao({ itens: [{ saborId, quantidade }], ...(data && { data: new Date(data) }) });

describe("GET /api/estoque", () => {
  it("vários sabores: positivo, zero e negativo; totais; ordem alfabética", async () => {
    const coco = await criarSabor({ nome: "Coco Fictício" });
    const amendoim = await criarSabor({ nome: "Amendoim Fictício" });
    const limao = await criarSabor({ nome: "Limão Fictício" });

    await produzir(coco.id, 50);
    await produzir(coco.id, 20);
    await vender(coco.id, 60); // +10
    await produzir(amendoim.id, 15);
    await vender(amendoim.id, 15); // 0
    await produzir(limao.id, 5);
    await vender(limao.id, 12); // −7

    expect(await estoque()).toEqual({
      itens: [
        { id: amendoim.id, nome: "Amendoim Fictício", produzido: 15, vendido: 15, saldo: 0 },
        { id: coco.id, nome: "Coco Fictício", produzido: 70, vendido: 60, saldo: 10 },
        { id: limao.id, nome: "Limão Fictício", produzido: 5, vendido: 12, saldo: -7 },
      ],
      totalProduzido: 90,
      totalVendido: 87,
      totalSaldo: 3,
    });
  });

  it("sabor só com vendas (nunca produzido) → saldo negativo", async () => {
    const s = await criarSabor();
    await vender(s.id, 8);
    expect((await estoque()).itens).toEqual([{ id: s.id, nome: s.nome, produzido: 0, vendido: 8, saldo: -8 }]);
  });

  it("sabor só com produção (sem vendas) → saldo = produzido", async () => {
    const s = await criarSabor();
    await produzir(s.id, 30);
    expect((await estoque()).itens).toEqual([{ id: s.id, nome: s.nome, produzido: 30, vendido: 0, saldo: 30 }]);
  });

  it("sabor sem nenhum movimento não aparece", async () => {
    await criarSabor({ nome: "Parado Fictício" });
    expect(await estoque()).toEqual({ itens: [], totalProduzido: 0, totalVendido: 0, totalSaldo: 0 });
  });

  it("KNOWN_BEHAVIOR: sabor inativo continua no estoque", async () => {
    const s = await criarSabor({ ativo: false });
    await produzir(s.id, 3);
    expect((await estoque()).itens).toHaveLength(1);
  });

  it("KNOWN_BEHAVIOR: não há data de corte — vendas anteriores a qualquer produção contam", async () => {
    const s = await criarSabor();
    await vender(s.id, 40, "2026-02-01T12:00:00.000Z"); // antes de existir controle de produção
    await produzir(s.id, 100, "2026-03-03T12:00:00.000Z");
    await vender(s.id, 70, "2026-03-10T12:00:00.000Z");
    expect((await estoque()).itens[0]).toMatchObject({ produzido: 100, vendido: 110, saldo: -10 });
  });

  it("KNOWN_BEHAVIOR: produção e venda com datas futuras também contam (sem filtro de data)", async () => {
    const s = await criarSabor();
    await produzir(s.id, 10, "2099-01-01T00:00:00.000Z");
    expect((await estoque()).itens[0].saldo).toBe(10);
  });
});
