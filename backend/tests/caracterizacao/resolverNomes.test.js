// Caracterização (nível A — função real, sem HTTP): src/services/resolverNomes.js
// Regra atual: normaliza (minúsculas, sem acentos, só [a-z0-9]); tenta match
// exato; senão devolve o PRIMEIRO registro cujo nome contém o texto ou está
// contido nele. A ordem é a do findMany sem orderBy (na prática, por id).
// O import acontece depois do setup, então usa o banco de teste.
import { describe, expect, it } from "vitest";
import { resolverCliente, resolverSabores } from "../../src/services/resolverNomes.js";
import { criarCliente, criarSabor } from "./helpers/fixtures.js";

describe("resolverCliente", () => {
  it("match exato ignorando maiúsculas, acentos, espaços e pontuação", async () => {
    const c = await criarCliente("Quitanda São João Fictícia");
    for (const texto of ["quitanda são joão fictícia", "QUITANDA SAO JOAO FICTICIA", "Quitanda-São João, Fictícia!"]) {
      expect((await resolverCliente(texto))?.id).toBe(c.id);
    }
  });

  it("match parcial: texto contido no nome", async () => {
    const c = await criarCliente("Mercearia Fictícia Aurora");
    expect((await resolverCliente("aurora"))?.id).toBe(c.id);
  });

  it("match parcial reverso: nome contido no texto", async () => {
    const c = await criarCliente("Mercearia Aurora");
    expect((await resolverCliente("Mercearia Aurora filial centro"))?.id).toBe(c.id);
  });

  it("exato tem prioridade sobre parcial, mesmo que o parcial venha antes", async () => {
    await criarCliente("Restaurante Fictício Verde Filial");
    const exato = await criarCliente("Restaurante Fictício Verde");
    expect((await resolverCliente("restaurante ficticio verde"))?.id).toBe(exato.id);
  });

  it("sem correspondência → null", async () => {
    await criarCliente("Mercearia Fictícia Aurora");
    expect(await resolverCliente("Padaria Inexistente")).toBeNull();
  });

  it("KNOWN_BEHAVIOR: resolução ambígua escolhe silenciosamente o PRIMEIRO candidato (menor id)", async () => {
    const norte = await criarCliente("Quitanda Fictícia Norte");
    await criarCliente("Quitanda Fictícia Sul");
    await criarCliente("Quitanda Fictícia Leste");
    expect((await resolverCliente("quitanda"))?.id).toBe(norte.id);
  });

  it("KNOWN_BEHAVIOR: texto que normaliza para vazio casa com o primeiro cliente", async () => {
    const primeiro = await criarCliente("Cliente Fictício Alfa");
    await criarCliente("Cliente Fictício Beta");
    expect((await resolverCliente("!!!"))?.id).toBe(primeiro.id);
    expect((await resolverCliente(""))?.id).toBe(primeiro.id);
  });

  it("sem nenhum cliente cadastrado → null (não lança)", async () => {
    expect(await resolverCliente("qualquer")).toBeNull();
  });
});

describe("resolverSabores", () => {
  it("resolve vários nomes, preserva quantidades e lista os não encontrados", async () => {
    const maracuja = await criarSabor({ nome: "Maracujá Fictício" });
    const coco = await criarSabor({ nome: "Coco Fictício" });
    const r = await resolverSabores([
      { nome: "maracuja ficticio", quantidade: 4 },
      { nome: "COCO", quantidade: 6 },
      { nome: "Pistache", quantidade: 1 },
    ]);
    expect(r).toEqual({
      sabores: [
        { saborId: maracuja.id, quantidade: 4 },
        { saborId: coco.id, quantidade: 6 },
      ],
      naoEncontrados: ["Pistache"],
    });
  });

  it("sabor inativo não é resolvido", async () => {
    await criarSabor({ nome: "Cupuaçu Fictício", ativo: false });
    expect(await resolverSabores([{ nome: "Cupuaçu Fictício", quantidade: 1 }])).toEqual({
      sabores: [],
      naoEncontrados: ["Cupuaçu Fictício"],
    });
  });

  it("KNOWN_BEHAVIOR: parcial ambíguo escolhe o primeiro ativo ('leite' → 'Doce de Leite')", async () => {
    const doce = await criarSabor({ nome: "Doce de Leite Fictício" });
    await criarSabor({ nome: "Leite Ninho Fictício" });
    const r = await resolverSabores([{ nome: "leite", quantidade: 2 }]);
    expect(r.sabores).toEqual([{ saborId: doce.id, quantidade: 2 }]);
  });

  it("KNOWN_BEHAVIOR: o mesmo sabor pode ser resolvido duas vezes (itens duplicados)", async () => {
    const coco = await criarSabor({ nome: "Coco Fictício" });
    const r = await resolverSabores([
      { nome: "coco", quantidade: 1 },
      { nome: "Coco Fictício", quantidade: 2 },
    ]);
    expect(r.sabores).toEqual([
      { saborId: coco.id, quantidade: 1 },
      { saborId: coco.id, quantidade: 2 },
    ]);
  });
});
