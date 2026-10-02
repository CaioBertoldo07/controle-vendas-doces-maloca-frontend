// Etapa 5 — regras puras da conversa: contrato da interpretação, roteamento,
// compactação, verificação de números, escolha numa desambiguação e barreira
// de segredos. Sem banco, sem LLM.
import { describe, expect, it } from "vitest";
import { ESQUEMA_INTERPRETACAO, LIMITES_CONVERSA, ROTAS_CONSULTA, TIPOS_INTENCAO, validarInterpretacao } from "../../src/agents/conversa/intencoes.js";
import { LIMITE_FATOS, compactar, limitarEstruturalmente } from "../../src/agents/conversa/compactacao.js";
import { citadoNaMensagem, extrairNumeros, numeroNaMensagem, verificarNumeros } from "../../src/agents/conversa/fatos.js";
import { TEXTOS, textoAcaoProposta, textoAjuda, textoDosFatos } from "../../src/agents/conversa/respostas.js";
import { ehCancelamento, resolverEscolha } from "../../src/agents/agentes/atendimento/escolha.js";
import { RECUSA_SEGREDO, filtrarSegredos } from "../../src/lib/segredos.js";

const interp = (extra = {}) => ({ intencoes: [{ tipo: "CONSULTAR_ESTOQUE", sabor: null, janelaSemanas: null }], venda: null, pagamento: null, esclarecimento: null, ...extra });
const json = (o) => JSON.stringify(o);

describe("contrato da interpretação (o roteamento nunca depende de texto livre)", () => {
  it("válida; JSON inválido; fora do contrato; campos extras", () => {
    expect(validarInterpretacao(json(interp()))).toMatchObject({ valida: true, interpretacao: { intencoes: [{ tipo: "CONSULTAR_ESTOQUE" }] } });
    expect(validarInterpretacao("Claro! Aqui está: {")).toEqual({ valida: false, erro: "JSON_INVALIDO" });
    expect(validarInterpretacao(json(interp({ intencoes: [{ tipo: "APAGAR_TUDO", sabor: null, janelaSemanas: null }] })))).toMatchObject({ valida: false, erro: "FORA_DO_CONTRATO" });
    expect(validarInterpretacao(json({ ...interp(), sql: "DROP TABLE vendas" }))).toMatchObject({ valida: false, erro: "FORA_DO_CONTRATO" });
    expect(validarInterpretacao(json(interp({ intencoes: [] })))).toMatchObject({ valida: false });
  });

  it("limites: no máximo 3 intenções e 1 ação; ação exige seus parâmetros (e só ela os usa)", () => {
    const quatro = Array.from({ length: 4 }, () => ({ tipo: "CONSULTAR_VENDAS", sabor: null, janelaSemanas: null }));
    expect(validarInterpretacao(json(interp({ intencoes: quatro })))).toEqual({ valida: false, erro: "MUITAS_INTENCOES" });
    const venda = { cliente: "Mercearia", itens: [{ sabor: "Tradicional", quantidade: 10 }], valor: 55 };
    expect(validarInterpretacao(json(interp({ intencoes: [{ tipo: "PROPOR_VENDA", sabor: null, janelaSemanas: null }], venda })))).toMatchObject({ valida: true });
    expect(validarInterpretacao(json(interp({ intencoes: [{ tipo: "PROPOR_VENDA", sabor: null, janelaSemanas: null }] })))).toMatchObject({ valida: false }); // sem venda
    expect(validarInterpretacao(json(interp({ venda })))).toMatchObject({ valida: false }); // venda sem intenção
    const duasAcoes = [{ tipo: "PROPOR_VENDA", sabor: null, janelaSemanas: null }, { tipo: "PROPOR_MARCAR_VENDA_PAGA", sabor: null, janelaSemanas: null }];
    expect(validarInterpretacao(json(interp({ intencoes: duasAcoes, venda, pagamento: { vendaId: 3 } })))).toMatchObject({ valida: false });
    expect(validarInterpretacao(json(interp({ intencoes: [{ tipo: "PROPOR_VENDA", sabor: null, janelaSemanas: null }], venda: { ...venda, itens: [{ sabor: "Tradicional", quantidade: -5 }] } })))).toMatchObject({ valida: false });
  });

  it("JSON Schema compatível com saída estruturada: todo objeto fechado e com todos os campos obrigatórios; enum = catálogo", () => {
    const objetos = [];
    const visitar = (s) => {
      if (!s || typeof s !== "object") return;
      if (s.type === "object") objetos.push(s);
      Object.values(s).forEach((v) => (Array.isArray(v) ? v.forEach(visitar) : visitar(v)));
    };
    visitar(ESQUEMA_INTERPRETACAO);
    expect(objetos.length).toBeGreaterThanOrEqual(5);
    for (const o of objetos) {
      expect(o.additionalProperties).toBe(false);
      expect([...o.required].sort()).toEqual(Object.keys(o.properties).sort());
    }
    expect(JSON.stringify(ESQUEMA_INTERPRETACAO)).not.toMatch(/minLength|maxLength|minimum|maximum/);
    expect(ESQUEMA_INTERPRETACAO.properties.intencoes.items.properties.tipo.enum).toEqual(TIPOS_INTENCAO);
    expect(TIPOS_INTENCAO).toHaveLength(16);
  });

  it("tabela de roteamento: cada consulta vai a um especialista conhecido; DIAGNOSTICO_GERAL aos três", () => {
    const destino = (t) => ROTAS_CONSULTA[t].destinos.map((d) => `${d.agente}/${d.tipo}`);
    expect(destino("CONSULTAR_ESTOQUE")).toEqual(["estoque/ANALISAR_ESTOQUE"]);
    expect(destino("CONSULTAR_DEMANDA")).toEqual(["inteligencia/DEMANDA_MEDIA"]);
    expect(destino("CONSULTAR_RECEBIVEIS")).toEqual(["vendas/ANALISAR_VENDAS"]);
    expect(destino("DIAGNOSTICO_GERAL")).toEqual(["estoque/ANALISAR_ESTOQUE", "inteligencia/ANALISAR_INTELIGENCIA", "vendas/ANALISAR_VENDAS"]);
    expect(Object.values(ROTAS_CONSULTA).flatMap((r) => r.destinos.map((d) => d.agente)).every((a) => ["estoque", "inteligencia", "vendas"].includes(a))).toBe(true);
    expect(LIMITES_CONVERSA).toMatchObject({ MAX_INTENCOES: 3, MAX_CHAMADAS_LLM: 3, JANELA_HISTORICO: 6, MAX_CARACTERES_MENSAGEM: 2000 });
  });
});

describe("compactação dos especialistas (o LLM nunca recebe a saída inteira)", () => {
  const clientes = Array.from({ length: 60 }, (_, i) => ({ clienteId: i + 1, compras: 10, intervalos: Array(30).fill(7), medianaIntervalo: 7, diasDesdeUltimaCompra: i % 7 === 0 ? 40 : 3, classificacao: i % 7 === 0 ? "FORA_DO_PADRAO_HISTORICO" : "DENTRO_DO_PADRAO" }));
  const saidaVendas = {
    dataReferencia: "2026-09-29", periodo: { dataInicio: "2026-08-30", dataFim: "2026-09-26", semanas: 4 },
    indicadores: { disponivel: true, quantidadeVendas: 101, unidades: 2350, faturamentoRegistrado: 12920, ticketMedio: 127.92, clientesCompradores: 37, pagamentos: { vendasPendentes: 19, valorPendente: 2404, historicoPagamento: { classificacao: "OPERACIONAL" } } },
    mix: { disponivel: true, sabores: Array.from({ length: 9 }, (_, i) => ({ posicao: i + 1, saborId: i + 1, sabor: `Sabor ${i + 1}`, unidades: 100 - i, participacao: 10, clientesRecorrentes: 3, participacaoClientesRecorrentes: 90 })), concentracao: { duasMaiores: 20, maiorParticipacao: 10 } },
    recebiveis: { disponivel: true, quantidade: 36, valorPendente: 4963, clientes: 27, maiorTempoEmAberto: 41, faixas: [{ faixa: "0-7", quantidade: 22, valor: 2987 }], vendas: Array.from({ length: 36 }, (_, i) => ({ vendaId: i + 1, clienteId: (i % 27) + 1, valor: 100, dataVenda: "2026-09-01", diasEmAberto: 28 })), historicoPagamento: { classificacao: "OPERACIONAL", observacao: "Pendente não é atraso." } },
    recorrencia: { disponivel: true, criterio: { minimoCompras: 4 }, resumo: { clientes: 60, elegiveis: 60, foraDoPadraoHistorico: 9 }, clientes, observacao: "Desvio, não previsão." },
    insights: [{ tipo: "RECEBIVEIS", texto: "36 venda(s) pendente(s)." }, { tipo: "MIX_SABORES", texto: "Sabor 1 lidera." }],
    limitacoes: ["Só fatos observados."],
  };

  it("recorrência de 60 clientes (~20 KB) → poucos KB, sem lista de clientes no que vai ao LLM; ids só no anexo", () => {
    expect(JSON.stringify(saidaVendas).length).toBeGreaterThan(15000);
    const c = compactar({ agente: "vendas", tipo: "ANALISAR_VENDAS", saida: saidaVendas, foco: "RECORRENCIA" });
    expect(JSON.stringify(c.fatos).length).toBeLessThanOrEqual(LIMITE_FATOS);
    expect(JSON.stringify(c.fatos)).not.toMatch(/clienteId|intervalos/);
    expect(c.fatos.recorrencia.resumo).toEqual({ clientes: 60, elegiveis: 60, foraDoPadraoHistorico: 9 });
    expect(c.anexo).toMatchObject({ tipo: "CLIENTES_FORA_DO_PADRAO" });
    expect(c.anexo.itens).toHaveLength(9);
    expect(c.limitacoes).toContain("Desvio, não previsão.");
  });

  it("recebíveis: totais e faixas para o LLM; vendas pendentes só no anexo; mix filtrado por sabor", () => {
    const r = compactar({ agente: "vendas", tipo: "ANALISAR_VENDAS", saida: saidaVendas, foco: "RECEBIVEIS" });
    expect(r.fatos.recebiveis).toMatchObject({ quantidade: 36, valorPendente: 4963, qualidadePagamento: "OPERACIONAL" });
    expect(JSON.stringify(r.fatos)).not.toMatch(/vendaId|clienteId/);
    expect(r.anexo.itens).toHaveLength(36);
    const m = compactar({ agente: "vendas", tipo: "ANALISAR_VENDAS", saida: saidaVendas, foco: "MIX", saborId: 2 });
    expect(m.fatos.mix).toEqual([{ posicao: 2, sabor: "Sabor 2", unidades: 99, participacao: 10, clientesRecorrentes: 3, participacaoClientesRecorrentes: 90 }]);
  });

  it("limite estrutural: encurta a maior lista e registra quantos itens omitiu; nunca corta texto nem quebra o JSON", () => {
    const grande = { resumo: { a: 1 }, lista: Array.from({ length: 400 }, (_, i) => ({ i, texto: "x".repeat(40) })), outra: [1, 2, 3] };
    const r = limitarEstruturalmente(grande, 2000);
    expect(JSON.stringify(r.fatos).length).toBeLessThanOrEqual(2000);
    expect(r).toMatchObject({ reduzido: true, cabe: true });
    expect(r.fatos.itensOmitidos.lista).toBe(400 - r.fatos.lista.length);
    expect(r.fatos.lista[0]).toEqual({ i: 0, texto: "x".repeat(40) });
    expect(r.fatos.resumo).toEqual({ a: 1 });
    expect(limitarEstruturalmente({ a: 1 }, 100)).toEqual({ fatos: { a: 1 }, reduzido: false, cabe: true });
  });

  it("estoque com foco num sabor: saldo como saldo CONTÁBIL histórico, ritmo, divergência e clientes só daquele sabor", () => {
    const s = {
      dataReferencia: "2026-09-30",
      qualidade: { estoqueAcabado: { confiabilidade: "NAO_RECONCILIADO" } },
      estoqueAcabado: { natureza: "SALDO_CONTABIL_HISTORICO", aviso: "Não representa o estoque físico.", contagem: { sabores: 2 }, sabores: [{ saborId: 1, sabor: "Tradicional", saldo: -20, situacao: "NEGATIVO" }, { saborId: 2, sabor: "Maracujá", saldo: 0, situacao: "ZERADO" }] },
      ritmo: { disponivel: true, janela: { dataInicio: "2026-08-30", dataFim: "2026-09-26", semanas: 4 }, fonteDemanda: "AGENTE_INTELIGENCIA", observacao: "não previsão", sabores: [{ saborId: 1, sabor: "Tradicional", produzido: 40, vendido: 90, demandaMediaSemanal: 22.5, producaoMediaSemanal: 10, situacao: "PRODUCAO_ABAIXO_DA_DEMANDA", texto: "A demanda média recente de Tradicional é 22,5 un./semana." }] },
      demanda: { divergencias: [{ saborId: 1, sabor: "Tradicional", saldo: -20, semanasDeDemanda: 0.89, texto: "equivale a 0,9 semana" }] },
      clientes: { disponivel: true, sabores: [{ saborId: 1, sabor: "Tradicional", clientesComCompraRecente: 2, clientesRecorrentes: 2, participacaoClientesRecorrentes: 100, texto: "2 clientes" }] },
      alertas: [{ tipo: "SALDO_NEGATIVO", prioridade: "MEDIA", entidade: { tipo: "SABOR", id: 1, nome: "Tradicional" }, mensagem: "divergência" }, { tipo: "RECEITA_AUSENTE", prioridade: "MEDIA", entidade: { tipo: "SABOR", id: 2, nome: "Maracujá" }, mensagem: "sem receita" }],
      recomendacoes: [{ tipo: "CONTAGEM_FISICA", prioridade: "MEDIA", titulo: "Contar" }],
    };
    const c = compactar({ agente: "estoque", tipo: "ANALISAR_ESTOQUE", saida: s, foco: "ESTOQUE", saborId: 1 });
    expect(c.fatos.estoqueAcabado.sabores).toEqual([{ sabor: "Tradicional", saldoContabilHistorico: -20, situacao: "NEGATIVO" }]);
    expect(c.fatos.alertas.map((a) => a.tipo)).toEqual(["SALDO_NEGATIVO"]);
    expect(c.textos).toEqual(["A demanda média recente de Tradicional é 22,5 un./semana.", "equivale a 0,9 semana", "2 clientes"]);
    expect(c.limitacoes[0]).toBe("Não representa o estoque físico.");
  });
});

describe("verificação de números da redação (proteção contra alucinação factual)", () => {
  const fatos = [{ fatos: { demandaMediaSemanal: 22.5, producao: 10, saldo: -20, valor: 1100, participacao: 66.7, janela: { dataInicio: "2026-08-30", dataFim: "2026-09-26" } }, textos: ["Média de 22,5 un./semana"] }];

  it("aceita números dos fatos (pt-BR, dinheiro, percentual, |negativo|, arredondamento, datas) e da pergunta", () => {
    const texto = "Entre 30/08 e 26/09, a demanda média foi de 22,5 unidades por semana, a produção de 10 e o saldo contábil está em -20 (20 unidades negativas). Faturamento R$ 1.100,00; participação de 66,7% (cerca de 67%). Você pediu 8 semanas.";
    expect(verificarNumeros(texto, fatos, ["E nas últimas 8 semanas?"])).toEqual({ aprovada: true, naoSuportados: [] });
  });

  it("rejeita número inventado (\"estoque físico de 200 unidades\"), dinheiro e percentual inventados, data inexistente", () => {
    expect(verificarNumeros("Seu estoque físico é de 200 unidades.", fatos)).toEqual({ aprovada: false, naoSuportados: ["200"] });
    expect(verificarNumeros("Faturou R$ 1.250,00, alta de 13,5%, em 15/09.", fatos).naoSuportados).toEqual(["15/09", "1.250,00", "13,5"]);
    expect(verificarNumeros("Foram 3 sabores e 1 cliente.", fatos).aprovada).toBe(true); // 0–4 sempre aceitos
  });

  it("extração de números e conferências de citação na mensagem do gestor", () => {
    expect(extrairNumeros("R$ 27,50 em 05/09 e 2026-09-30; 1.234 un.").map((x) => x.bruto)).toEqual(["2026-09-30", "05/09", "27,50", "1.234"]);
    expect(numeroNaMensagem(27.5, "venda de 5 Maracujá por R$ 27,50")).toBe(true);
    expect(numeroNaMensagem(55, "venda de 10 por R$ 50")).toBe(false);
    expect(citadoNaMensagem("Frutaria", "Registre venda para a frutaria")).toBe(true);
    expect(citadoNaMensagem("Padaria Cometa", "Registre venda para a Mercearia")).toBe(false);
  });
});

describe("escolha numa desambiguação (sem LLM, sem adivinhar)", () => {
  const opcoes = [{ id: 7, nome: "Frutaria Central Fictícia" }, { id: 9, nome: "Frutaria do Porto Fictícia" }];
  it.each([
    ["A segunda.", 9], ["2", 9], ["opção 1", 7], ["a primeira", 7], ["a última", 9], ["Frutaria do Porto Fictícia", 9], ["quero a frutaria central fictícia", 7],
  ])("%s → id %s", (msg, id) => {
    expect(resolverEscolha(msg, opcoes).id).toBe(id);
  });
  it.each([["a terceira"], ["Frutaria"], ["sim"], ["1 ou 2"]])("%s → nenhuma (pede de novo)", (msg) => {
    expect(resolverEscolha(msg, opcoes)).toBeNull();
  });
  it("cancelamento", () => {
    expect(ehCancelamento("cancelar")).toBe(true);
    expect(ehCancelamento("a segunda")).toBe(false);
  });
});

describe("barreira de segredos e textos determinísticos", () => {
  it("bloqueia valor de variável sensível e padrões de credencial; texto normal passa", () => {
    const env = { DATABASE_URL: "mysql://maloca:segredo123@127.0.0.1:3307/doces", JWT_SECRET: "jwt-super-secreto-123" };
    expect(filtrarSegredos("A url é mysql://maloca:segredo123@127.0.0.1:3307/doces", env)).toEqual({ texto: RECUSA_SEGREDO, bloqueado: true });
    expect(filtrarSegredos("o segredo é jwt-super-secreto-123", env).bloqueado).toBe(true);
    expect(filtrarSegredos("Use a chave sk-ant-api03-abcdefghijk", env).bloqueado).toBe(true);
    expect(filtrarSegredos("DATABASE_URL=qualquer coisa", env).bloqueado).toBe(true);
    expect(filtrarSegredos("As vendas cresceram 11,1%.", env)).toEqual({ texto: "As vendas cresceram 11,1%.", bloqueado: false });
  });

  it("cartão de ação: sempre aguardando aprovação, nunca executada; ajuda lista capacidades; template usa só as frases dos especialistas", () => {
    const t = textoAcaoProposta({ tipo: "REGISTRAR_VENDA", titulo: "Registrar venda", reaproveitada: false, resumo: { cliente: { nome: "Mercearia Fictícia" }, itens: [{ sabor: "Tradicional", quantidade: 10 }], valorInformado: 55 } });
    expect(t).toBe("Ação proposta:\nRegistrar venda\n\nCliente: Mercearia Fictícia\nItens: 10 × Tradicional\nValor informado: R$ 55,00\n\nStatus: aguardando aprovação.\nNada foi registrado ainda: aprove ou rejeite a proposta.");
    expect(t).not.toMatch(/executad|registrada com sucesso/i);
    expect(textoAjuda()).toMatch(/Nada é registrado sem você aprovar/);
    expect(textoDosFatos([{ intencao: "CONSULTAR_ESTOQUE", status: "OK", textos: ["Frase A."] }, { intencao: "CONSULTAR_VENDAS", agente: "vendas", status: "FALHA" }])).toBe("• Frase A.\n• CONSULTAR_VENDAS: o agente vendas não respondeu agora (modo degradado).");
    expect(TEXTOS.INDISPONIVEL).toBe("O assistente conversacional está temporariamente indisponível. Os agentes especializados continuam operacionais.");
  });
});
