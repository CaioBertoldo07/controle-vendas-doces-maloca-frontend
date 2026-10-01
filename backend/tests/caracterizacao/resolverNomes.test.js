// Resolução de nomes (nível A, função real, sem HTTP): src/services/resolverNomes.js
// Normalização: minúsculas, sem acentos, só [a-z0-9].
// Etapa 0.6: a resolução deixou de devolver "entidade ou null" e passou a
// CLASSIFICAR o resultado: EXATO | PARCIAL_UNICO | AMBIGUO | NAO_ENCONTRADO |
// INVALIDO. Ambiguidade e entrada vazia nunca escolhem um registro (eram os
// KNOWN_BEHAVIOR K4 e K5). Ver docs/tcc/etapa-0-6-invariantes-criticas.md.
// O import acontece depois do setup, então usa o banco de teste.
import { describe, expect, it } from "vitest";
import { RESOLUCAO, resolverCliente, resolverSabores } from "../../src/services/resolverNomes.js";
import { criarCliente, criarSabor } from "./helpers/fixtures.js";

const { EXATO, PARCIAL_UNICO, AMBIGUO, NAO_ENCONTRADO, INVALIDO } = RESOLUCAO;
const candidato = (r) => ({ id: r.id, nome: r.nome });

describe("resolverCliente", () => {
  it("match exato ignorando maiúsculas, acentos, espaços e pontuação", async () => {
    const c = await criarCliente("Quitanda São João Fictícia");
    for (const texto of ["quitanda são joão fictícia", "QUITANDA SAO JOAO FICTICIA", "Quitanda-São João, Fictícia!"]) {
      expect(await resolverCliente(texto)).toEqual({ tipo: EXATO, cliente: expect.objectContaining({ id: c.id }) });
    }
  });

  it("parcial único: texto contido no nome", async () => {
    const c = await criarCliente("Mercearia Fictícia Aurora");
    expect(await resolverCliente("aurora")).toEqual({ tipo: PARCIAL_UNICO, cliente: expect.objectContaining({ id: c.id }) });
  });

  it("parcial único reverso: nome contido no texto", async () => {
    const c = await criarCliente("Mercearia Aurora");
    const r = await resolverCliente("Mercearia Aurora filial centro");
    expect(r).toEqual({ tipo: PARCIAL_UNICO, cliente: expect.objectContaining({ id: c.id }) });
  });

  it("exato tem prioridade sobre parcial, mesmo que o parcial venha antes", async () => {
    await criarCliente("Restaurante Fictício Verde Filial");
    const exato = await criarCliente("Restaurante Fictício Verde");
    const r = await resolverCliente("restaurante ficticio verde");
    expect(r).toEqual({ tipo: EXATO, cliente: expect.objectContaining({ id: exato.id }) });
  });

  it("inexistente → NAO_ENCONTRADO", async () => {
    await criarCliente("Mercearia Fictícia Aurora");
    expect(await resolverCliente("Padaria Inexistente")).toEqual({ tipo: NAO_ENCONTRADO });
  });

  // Etapa 0.6: era KNOWN_BEHAVIOR K4 (escolhia em silêncio o PRIMEIRO candidato).
  it("parcial múltiplo → AMBIGUO com os candidatos (id e nome), sem escolher nenhum", async () => {
    const norte = await criarCliente("Quitanda Fictícia Norte");
    const sul = await criarCliente("Quitanda Fictícia Sul");
    const leste = await criarCliente("Quitanda Fictícia Leste");
    await criarCliente("Mercearia Fictícia Aurora");
    expect(await resolverCliente("quitanda")).toEqual({
      tipo: AMBIGUO,
      candidatos: [candidato(norte), candidato(sul), candidato(leste)],
    });
  });

  it("dois clientes com o mesmo nome normalizado → AMBIGUO mesmo no match exato", async () => {
    const a = await criarCliente("Quitanda São João");
    const b = await criarCliente("Quitanda Sao Joao"); // o cadastro aceita: a duplicidade não normaliza acentos (K20)
    expect(await resolverCliente("quitanda sao joao")).toEqual({ tipo: AMBIGUO, candidatos: [candidato(a), candidato(b)] });
  });

  // Etapa 0.6: era KNOWN_BEHAVIOR K5 (texto que normaliza para vazio casava com o primeiro cliente).
  it.each(["", "   ", "!!!", "...", "—", null, undefined, 123])("entrada sem texto significativo (%o) → INVALIDO", async (texto) => {
    await criarCliente("Cliente Fictício Alfa");
    expect(await resolverCliente(texto)).toEqual({ tipo: INVALIDO });
  });

  it("sem nenhum cliente cadastrado → NAO_ENCONTRADO (não lança)", async () => {
    expect(await resolverCliente("qualquer")).toEqual({ tipo: NAO_ENCONTRADO });
  });
});

describe("resolverSabores", () => {
  it("exato, maiúsculas/acentos e parcial único; preserva quantidades e lista os não encontrados", async () => {
    const maracuja = await criarSabor({ nome: "Maracujá Fictício" });
    const coco = await criarSabor({ nome: "Coco Fictício" });
    const r = await resolverSabores([
      { nome: "MARACUJA FICTICIO", quantidade: 4 },
      { nome: "COCO", quantidade: 6 },
      { nome: "Pistache", quantidade: 1 },
    ]);
    expect(r).toEqual({
      sabores: [
        { saborId: maracuja.id, quantidade: 4 },
        { saborId: coco.id, quantidade: 6 },
      ],
      naoEncontrados: ["Pistache"],
      ambiguos: [],
      invalidos: [],
    });
  });

  it("sabor inativo não é resolvido (nem como candidato)", async () => {
    await criarSabor({ nome: "Cupuaçu Fictício", ativo: false });
    expect(await resolverSabores([{ nome: "Cupuaçu Fictício", quantidade: 1 }])).toEqual({
      sabores: [],
      naoEncontrados: ["Cupuaçu Fictício"],
      ambiguos: [],
      invalidos: [],
    });
  });

  // Etapa 0.6: era KNOWN_BEHAVIOR K4 ("leite" escolhia o primeiro: "Doce de Leite").
  it("parcial múltiplo → ambíguo com candidatos; inativo não entra na lista", async () => {
    const doce = await criarSabor({ nome: "Doce de Leite Fictício" });
    const ninho = await criarSabor({ nome: "Leite Ninho Fictício" });
    await criarSabor({ nome: "Leite Condensado Inativo", ativo: false });
    const r = await resolverSabores([{ nome: "leite", quantidade: 2 }]);
    expect(r).toEqual({
      sabores: [],
      naoEncontrados: [],
      ambiguos: [{ nome: "leite", candidatos: [candidato(doce), candidato(ninho)] }],
      invalidos: [],
    });
  });

  it("exato tem prioridade sobre parcial ('Coco' com 'Coco' e 'Coco Queimado')", async () => {
    const coco = await criarSabor({ nome: "Coco" });
    await criarSabor({ nome: "Coco Queimado" });
    expect((await resolverSabores([{ nome: "coco", quantidade: 1 }])).sabores).toEqual([{ saborId: coco.id, quantidade: 1 }]);
  });

  it("nome vazio, só pontuação ou ausente → inválido (não resolve e não lança)", async () => {
    await criarSabor({ nome: "Coco Fictício" });
    const r = await resolverSabores([{ nome: "!!!", quantidade: 1 }, { nome: "", quantidade: 1 }, { quantidade: 1 }]);
    expect(r).toEqual({ sabores: [], naoEncontrados: [], ambiguos: [], invalidos: ["!!!", "", null] });
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
