// Ajuste de estoque de produto acabado (sabor) por contagem física.
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  api,
  encerrarAmbiente,
  iniciarAmbiente,
  limparBanco,
  prisma,
  tokenComSegredoErrado,
  tokenPara,
} from "./ambiente.js";
import {
  registrarAjusteNaTransacao,
  validarEntradaAjuste,
} from "../../src/services/ajusteEstoque.js";

let usuario, token, cliente, saborA, saborB;

// Cenário base: sabor A com 10 produzidos e 3 vendidos (saldo 7).
async function semear() {
  usuario = await prisma.usuario.create({
    data: { nome: "Operador Teste", email: "operador@teste.local", senha: "x" },
  });
  token = tokenPara(usuario);
  cliente = await prisma.cliente.create({ data: { nome: "Cliente Teste" } });
  saborA = await prisma.sabor.create({ data: { nome: "Coco", precoUnitario: 5 } });
  saborB = await prisma.sabor.create({ data: { nome: "Maracujá", precoUnitario: 5 } });
  await produzir(saborA.id, 10);
  await vender(saborA.id, 3);
}

async function produzir(saborId, quantidade) {
  const r = await api("POST", "/producao", {
    token,
    body: { sabores: [{ saborId, quantidade }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  return r;
}

async function vender(saborId, quantidade) {
  const r = await api("POST", "/vendas", {
    token,
    body: {
      clienteId: cliente.id,
      quantidade,
      valor: quantidade * 5,
      sabores: [{ saborId, quantidade }],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  return r;
}

const ajuste = (campos = {}) => ({
  saborId: saborA.id,
  quantidadeContada: 7,
  saldoEsperado: 7,
  motivo: "DIVERGENCIA_CONTAGEM",
  idempotencyKey: randomUUID(),
  ...campos,
});

const ajustar = (body, tk = token) => api("POST", "/estoque/ajustes", { token: tk, body });

async function itemEstoque(saborId) {
  const r = await api("GET", "/estoque", { token });
  assert.equal(r.status, 200);
  return r.dados.itens.find((i) => i.id === saborId);
}

const totalAjustes = () => prisma.ajusteEstoque.count();

// Resolve quando a promessa termina ou após `ms`, indicando qual aconteceu.
const terminouEm = (promessa, ms) =>
  Promise.race([
    promessa.then(() => true),
    new Promise((r) => setTimeout(() => r(false), ms)),
  ]);

before(iniciarAmbiente);
after(encerrarAmbiente);
beforeEach(async () => {
  await limparBanco();
  await semear();
});

describe("permissões", () => {
  it("recusa ajuste e histórico sem token", async () => {
    assert.equal((await ajustar(ajuste({ quantidadeContada: 9 }), null)).status, 401);
    assert.equal((await api("GET", "/estoque/ajustes")).status, 401);
    assert.equal(await totalAjustes(), 0);
  });

  it("recusa token assinado com outro segredo", async () => {
    const r = await ajustar(ajuste({ quantidadeContada: 9 }), tokenComSegredoErrado(usuario));
    assert.equal(r.status, 401);
    assert.equal(await totalAjustes(), 0);
  });

  it("recusa token de usuário inexistente", async () => {
    const fantasma = { id: usuario.id + 999, email: "x@x" };
    const r = await ajustar(ajuste({ quantidadeContada: 9 }), tokenPara(fantasma));
    assert.equal(r.status, 401);
    assert.equal(await totalAjustes(), 0);
  });

  it("não expõe rotas de edição ou exclusão de ajustes", async () => {
    const { dados } = await ajustar(ajuste({ quantidadeContada: 9 }));
    const id = dados.ajuste.id;
    assert.equal((await api("PUT", `/estoque/ajustes/${id}`, { token, body: {} })).status, 404);
    assert.equal((await api("DELETE", `/estoque/ajustes/${id}`, { token })).status, 404);
    assert.equal(await totalAjustes(), 1);
  });
});

describe("cálculo e registro do ajuste", () => {
  it("ajuste positivo aumenta o saldo e registra o histórico completo", async () => {
    const antes = new Date();
    const r = await ajustar(ajuste({ quantidadeContada: 10 }));
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    const a = r.dados.ajuste;
    assert.equal(a.saborId, saborA.id);
    assert.equal(a.sabor.nome, "Coco");
    assert.equal(a.saldoAnterior, 7);
    assert.equal(a.saldoNovo, 10);
    assert.equal(a.diferenca, 3);
    assert.equal(a.motivo, "DIVERGENCIA_CONTAGEM");
    assert.equal(a.usuarioId, usuario.id);
    assert.deepEqual(a.usuario, { id: usuario.id, nome: "Operador Teste" });
    assert.ok(new Date(a.data) >= new Date(antes.getTime() - 1000));

    const item = await itemEstoque(saborA.id);
    assert.deepEqual(
      { produzido: item.produzido, vendido: item.vendido, ajustado: item.ajustado, saldo: item.saldo },
      { produzido: 10, vendido: 3, ajustado: 3, saldo: 10 },
    );
  });

  it("ajuste negativo reduz o saldo", async () => {
    const r = await ajustar(ajuste({ quantidadeContada: 4, motivo: "PERDA_AVARIA" }));
    assert.equal(r.status, 201);
    assert.equal(r.dados.ajuste.diferenca, -3);
    assert.equal((await itemEstoque(saborA.id)).saldo, 4);
  });

  it("contagem zero zera o saldo", async () => {
    const r = await ajustar(ajuste({ quantidadeContada: 0, motivo: "ERRO_LANCAMENTO" }));
    assert.equal(r.status, 201);
    assert.equal(r.dados.ajuste.diferenca, -7);
    assert.equal(r.dados.ajuste.saldoNovo, 0);
    assert.equal((await itemEstoque(saborA.id)).saldo, 0);
  });

  it("contagem igual ao saldo não gera movimentação", async () => {
    const r = await ajustar(ajuste({ quantidadeContada: 7 }));
    assert.equal(r.status, 200);
    assert.equal(r.dados.semAlteracao, true);
    assert.equal(r.dados.saldoAtual, 7);
    assert.equal(await totalAjustes(), 0);
    assert.equal((await itemEstoque(saborA.id)).saldo, 7);
  });

  it("corrige saldo negativo com contagem física, sem mudar a política de vendas", async () => {
    // Venda acima do saldo continua permitida (política atual).
    await vender(saborA.id, 10);
    assert.equal((await itemEstoque(saborA.id)).saldo, -3);

    const r = await ajustar(ajuste({ quantidadeContada: 2, saldoEsperado: -3 }));
    assert.equal(r.status, 201);
    assert.equal(r.dados.ajuste.saldoAnterior, -3);
    assert.equal(r.dados.ajuste.diferenca, 5);
    assert.equal((await itemEstoque(saborA.id)).saldo, 2);

    const zerar = await ajustar(ajuste({ quantidadeContada: 0, saldoEsperado: 2 }));
    assert.equal(zerar.status, 201);
    assert.equal((await itemEstoque(saborA.id)).saldo, 0);
  });

  it("ajusta sabor sem produção nem venda (saldo inicial zero)", async () => {
    const r = await ajustar(ajuste({ saborId: saborB.id, quantidadeContada: 4, saldoEsperado: 0 }));
    assert.equal(r.status, 201);
    assert.equal(r.dados.ajuste.diferenca, 4);
    assert.equal((await itemEstoque(saborB.id)).saldo, 4);
  });

  it("aceita motivo Outro com justificativa e a registra", async () => {
    const r = await ajustar(
      ajuste({ quantidadeContada: 6, motivo: "OUTRO", justificativa: "  Doação para evento  " }),
    );
    assert.equal(r.status, 201);
    assert.equal(r.dados.ajuste.justificativa, "Doação para evento");
  });

  it("preserva produções e vendas anteriores", async () => {
    const antes = {
      producoes: await prisma.producaoSabor.findMany({ orderBy: { id: "asc" } }),
      vendas: await prisma.vendaSabor.findMany({ orderBy: { id: "asc" } }),
    };
    await ajustar(ajuste({ quantidadeContada: 1 }));
    await ajustar(ajuste({ quantidadeContada: 9, saldoEsperado: 1 }));
    assert.deepEqual(await prisma.producaoSabor.findMany({ orderBy: { id: "asc" } }), antes.producoes);
    assert.deepEqual(await prisma.vendaSabor.findMany({ orderBy: { id: "asc" } }), antes.vendas);
    assert.equal(await totalAjustes(), 2);
  });

  it("o resumo de produção considera os ajustes no saldo cumulativo", async () => {
    await ajustar(ajuste({ quantidadeContada: 5 }));
    const r = await api("GET", "/producao/resumo", { token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.dados.saldoPorSaborCumulativo.Coco, {
      produzido: 10,
      vendido: 3,
      ajustado: -2,
      saldo: 5,
    });
    assert.equal(r.dados.saldoEstoqueCumulativo, 5);
  });
});

describe("validações", () => {
  const casos = [
    ["contagem negativa", { quantidadeContada: -1 }, 400],
    ["contagem fracionária", { quantidadeContada: 2.5 }, 400],
    ["contagem não numérica", { quantidadeContada: "abc" }, 400],
    ["contagem ausente", { quantidadeContada: undefined }, 400],
    ["saldo de referência ausente", { saldoEsperado: undefined }, 400],
    ["motivo inválido", { motivo: "QUALQUER" }, 400],
    ["motivo Outro sem justificativa", { motivo: "OUTRO", justificativa: "   " }, 400],
    ["justificativa longa demais", { motivo: "OUTRO", justificativa: "x".repeat(256) }, 400],
    ["chave de idempotência ausente", { idempotencyKey: undefined }, 400],
    ["sabor inexistente", { saborId: 999999 }, 404],
  ];
  for (const [nome, campos, status] of casos) {
    it(`recusa ${nome}`, async () => {
      const r = await ajustar(ajuste({ quantidadeContada: 9, ...campos }));
      assert.equal(r.status, status, JSON.stringify(r.dados));
      assert.equal(await totalAjustes(), 0);
    });
  }
});

describe("idempotência", () => {
  it("repetição com a mesma chave devolve o ajuste já registrado, sem duplicar", async () => {
    const body = ajuste({ quantidadeContada: 10 });
    const primeira = await ajustar(body);
    assert.equal(primeira.status, 201);
    // Ex.: a resposta se perdeu na rede e o cliente reenviou a mesma operação.
    const repeticao = await ajustar(body);
    assert.equal(repeticao.status, 200);
    assert.equal(repeticao.dados.repetido, true);
    assert.equal(repeticao.dados.ajuste.id, primeira.dados.ajuste.id);
    assert.equal(await totalAjustes(), 1);
    assert.equal((await itemEstoque(saborA.id)).saldo, 10);
  });

  it("repetições simultâneas da mesma operação geram um único ajuste", async () => {
    const body = ajuste({ quantidadeContada: 2 });
    const respostas = await Promise.all([ajustar(body), ajustar(body), ajustar(body)]);
    const status = respostas.map((r) => r.status).sort();
    assert.deepEqual(status, [200, 200, 201]);
    assert.equal(new Set(respostas.map((r) => r.dados.ajuste.id)).size, 1);
    assert.equal(await totalAjustes(), 1);
    assert.equal((await itemEstoque(saborA.id)).saldo, 2);
  });

  it("recusa reutilizar a chave com dados diferentes", async () => {
    const body = ajuste({ quantidadeContada: 10 });
    assert.equal((await ajustar(body)).status, 201);
    const r = await ajustar({ ...body, quantidadeContada: 11, saldoEsperado: 10 });
    assert.equal(r.status, 409);
    assert.equal(r.dados.codigo, "CHAVE_REUTILIZADA");
    assert.equal(await totalAjustes(), 1);
  });
});

describe("concorrência", () => {
  it("recusa ajuste com saldo de referência desatualizado", async () => {
    const r = await ajustar(ajuste({ quantidadeContada: 5, saldoEsperado: 8 }));
    assert.equal(r.status, 409);
    assert.equal(r.dados.codigo, "SALDO_ALTERADO");
    assert.equal(r.dados.saldoAtual, 7);
    assert.equal(await totalAjustes(), 0);
  });

  it("dois ajustes simultâneos do mesmo sabor: só um é aceito", async () => {
    const [r1, r2] = await Promise.all([
      ajustar(ajuste({ quantidadeContada: 5 })),
      ajustar(ajuste({ quantidadeContada: 12 })),
    ]);
    const status = [r1.status, r2.status].sort();
    assert.deepEqual(status, [201, 409]);
    const aceito = [r1, r2].find((r) => r.status === 201).dados.ajuste;
    assert.equal(await totalAjustes(), 1);
    assert.equal((await itemEstoque(saborA.id)).saldo, aceito.saldoNovo);
  });

  it("venda em andamento: o ajuste espera e então detecta a mudança de saldo", async () => {
    let liberar;
    const portao = new Promise((r) => (liberar = r));
    const vendaEmAndamento = prisma.$transaction(
      async (tx) => {
        await tx.venda.create({
          data: {
            clienteId: cliente.id,
            quantidade: 2,
            valor: 10,
            sabores: { create: [{ saborId: saborA.id, quantidade: 2 }] },
          },
        });
        await portao;
      },
      { timeout: 20000 },
    );
    await new Promise((r) => setTimeout(r, 200));

    const pedido = ajustar(ajuste({ quantidadeContada: 6 }));
    assert.equal(await terminouEm(pedido, 700), false, "o ajuste deveria esperar a venda");
    liberar();
    await vendaEmAndamento;

    const r = await pedido;
    assert.equal(r.status, 409);
    assert.equal(r.dados.codigo, "SALDO_ALTERADO");
    assert.equal(r.dados.saldoAtual, 5);
    assert.equal(await totalAjustes(), 0);
    assert.equal((await itemEstoque(saborA.id)).saldo, 5);
  });

  it("produção em andamento: o ajuste espera e então detecta a mudança de saldo", async () => {
    let liberar;
    const portao = new Promise((r) => (liberar = r));
    const producaoEmAndamento = prisma.$transaction(
      async (tx) => {
        await tx.producao.create({
          data: { sabores: { create: [{ saborId: saborA.id, quantidade: 4 }] } },
        });
        await portao;
      },
      { timeout: 20000 },
    );
    await new Promise((r) => setTimeout(r, 200));

    const pedido = ajustar(ajuste({ quantidadeContada: 6 }));
    assert.equal(await terminouEm(pedido, 700), false, "o ajuste deveria esperar a produção");
    liberar();
    await producaoEmAndamento;

    const r = await pedido;
    assert.equal(r.status, 409);
    assert.equal(r.dados.saldoAtual, 11);
    assert.equal(await totalAjustes(), 0);
  });

  for (const [nome, registrar, efeito] of [
    ["venda", () => vender(saborA.id, 2), -2],
    ["produção", () => produzir(saborA.id, 4), 4],
  ]) {
    it(`ajuste em andamento: a ${nome} espera o ajuste terminar e é aplicada depois`, async () => {
      let liberar;
      const portao = new Promise((r) => (liberar = r));
      let ajusteFeito;
      const ajusteEmAndamento = prisma.$transaction(
        async (tx) => {
          const dados = validarEntradaAjuste(ajuste({ quantidadeContada: 5 }));
          ajusteFeito = await registrarAjusteNaTransacao(tx, dados, usuario.id);
          await portao;
        },
        { timeout: 20000 },
      );
      await new Promise((r) => setTimeout(r, 200));

      const pedido = registrar();
      assert.equal(await terminouEm(pedido, 700), false, `a ${nome} deveria esperar o ajuste`);
      liberar();
      await ajusteEmAndamento;
      await pedido;

      assert.equal(ajusteFeito.ajuste.saldoAnterior, 7);
      assert.equal(ajusteFeito.ajuste.saldoNovo, 5);
      assert.equal((await itemEstoque(saborA.id)).saldo, 5 + efeito);
    });
  }
});

describe("histórico", () => {
  it("lista ajustes do mais recente ao mais antigo, com responsável e sem dados sensíveis", async () => {
    await ajustar(ajuste({ quantidadeContada: 9 }));
    await ajustar(ajuste({ saborId: saborB.id, quantidadeContada: 3, saldoEsperado: 0 }));
    await ajustar(ajuste({ quantidadeContada: 8, saldoEsperado: 9, motivo: "PERDA_AVARIA" }));

    const r = await api("GET", "/estoque/ajustes", { token });
    assert.equal(r.status, 200);
    assert.equal(r.dados.length, 3);
    assert.deepEqual(
      r.dados.map((a) => [a.sabor.nome, a.saldoAnterior, a.saldoNovo, a.diferenca, a.motivo]),
      [
        ["Coco", 9, 8, -1, "PERDA_AVARIA"],
        ["Maracujá", 0, 3, 3, "DIVERGENCIA_CONTAGEM"],
        ["Coco", 7, 9, 2, "DIVERGENCIA_CONTAGEM"],
      ],
    );
    for (const a of r.dados) {
      assert.deepEqual(a.usuario, { id: usuario.id, nome: "Operador Teste" });
      assert.ok(a.data);
    }

    const filtrado = await api("GET", `/estoque/ajustes?saborId=${saborB.id}`, { token });
    assert.deepEqual(filtrado.dados.map((a) => a.saborId), [saborB.id]);
  });
});

describe("exclusão de sabor (regressão)", () => {
  it("sabor com ajustes é desativado, preservando ajustes e histórico", async () => {
    await ajustar(ajuste({ saborId: saborB.id, quantidadeContada: 4, saldoEsperado: 0 }));

    const r = await api("DELETE", `/sabores/${saborB.id}`, { token });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.desativado, true);

    const sabor = await prisma.sabor.findUnique({ where: { id: saborB.id } });
    assert.equal(sabor.ativo, false);
    assert.equal(await prisma.ajusteEstoque.count({ where: { saborId: saborB.id } }), 1);

    const historico = await api("GET", "/estoque/ajustes", { token });
    assert.equal(historico.dados[0].sabor.nome, "Maracujá");
    assert.equal((await itemEstoque(saborB.id)).saldo, 4);
  });

  it("sabor com vendas continua sendo desativado (comportamento anterior)", async () => {
    const r = await api("DELETE", `/sabores/${saborA.id}`, { token });
    assert.equal(r.status, 200);
    assert.equal(r.dados.desativado, true);
    assert.equal(r.dados.message, "Sabor desativado pois possui vendas vinculadas");
  });

  it("sabor sem vínculos continua sendo excluído (comportamento anterior)", async () => {
    const r = await api("DELETE", `/sabores/${saborB.id}`, { token });
    assert.equal(r.status, 200);
    assert.equal(r.dados.desativado, undefined);
    assert.equal(await prisma.sabor.findUnique({ where: { id: saborB.id } }), null);
  });
});
