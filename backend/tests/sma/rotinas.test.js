// Etapa 6 — autonomia CONTROLADA: rotinas analíticas idempotentes por janela,
// sinais de evento com debounce, flags e o segredo das rotinas internas.
// As rotinas só analisam/recomendam/auditam: nenhuma escrita de domínio.
import { afterEach, describe, expect, it } from "vitest";
import * as acoes from "../../src/agents/acoes/servicoAcoes.js";
import { criarProvedorFake } from "../../src/agents/llm/provedorFake.js";
import { DEBOUNCE_EVENTOS_MS, executarRotina, processarSinais, sinalizarEvento, sinalizarSeHabilitado } from "../../src/agents/rotinas/index.js";
import * as servicoConversa from "../../src/agents/servicoConversa.js";
import { exigirFlag, flags } from "../../src/lib/flags.js";
import { exigirSegredoRotinas } from "../../src/routes/interno.js";
import { prisma } from "../caracterizacao/helpers/db.js";
import { criarCliente, criarSabor, criarUsuario } from "../caracterizacao/helpers/fixtures.js";
import { REF, cenarioVendas } from "./cenarioVendas.js";
import { agenteTeste, runtimeTeste } from "./helpers.js";

const AGORA = new Date("2026-10-02T12:00:00Z"); // 08:00 em Manaus
const dominio = async () => ({
  vendas: await prisma.venda.count(),
  pagas: await prisma.venda.count({ where: { pago: true } }),
  producoes: await prisma.producao.count(),
  movimentacoes: await prisma.movimentacaoMateriaPrima.count(),
  acoes: await prisma.acaoProposta.count(),
});

const ENV_ORIGINAL = { ...process.env };
afterEach(() => {
  for (const k of ["SMA_ENABLED", "ASSISTENTE_ENABLED", "AGENT_SCHEDULER_ENABLED", "SMA_EVENTOS_ENABLED", "SMA_ROTINAS_TOKEN"]) {
    if (ENV_ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ENV_ORIGINAL[k];
  }
});

describe("rotinas analíticas: uma execução por janela", () => {
  it("rotina de estoque: roda pelo runtime (AGENDADO), coopera com a Inteligência, recomenda — e não escreve nada no domínio", async () => {
    await cenarioVendas();
    const antes = await dominio();
    const rt = runtimeTeste();
    const r = await executarRotina("estoque", { runtime: rt, agora: AGORA, dataReferencia: REF });
    expect(r).toMatchObject({ executada: true, rotina: "estoque", janela: "dia:2026-10-02", status: "SUCESSO", tentativas: 1 });
    const exec = await prisma.execucaoAgente.findUnique({ where: { id: r.execucaoId } });
    expect(exec).toMatchObject({ agente: "estoque", tipoExecucao: "ANALISAR_ESTOQUE", gatilho: "AGENDADO", status: "SUCESSO" });
    expect(await prisma.execucaoAgente.count({ where: { execucaoPaiId: r.execucaoId, agente: "inteligencia", gatilho: "MENSAGEM" } })).toBeGreaterThan(0);
    expect(await prisma.recomendacao.count({ where: { agente: "estoque", status: "ABERTA" } })).toBe(2);
    expect(await dominio()).toEqual(antes); // autonomia só analítica

    // mesma janela → não repete; outro dia → nova análise
    expect(await executarRotina("estoque", { runtime: rt, agora: AGORA, dataReferencia: REF })).toMatchObject({ executada: false, motivo: "JA_EXECUTADA_NA_JANELA", status: "SUCESSO" });
    expect(await executarRotina("estoque", { runtime: rt, agora: new Date("2026-10-03T12:00:00Z"), dataReferencia: REF })).toMatchObject({ executada: true, janela: "dia:2026-10-03" });
    expect(await prisma.execucaoAgente.count({ where: { agente: "estoque", gatilho: "AGENDADO" } })).toBe(2);
    expect(await prisma.recomendacao.count({ where: { agente: "estoque", status: "ABERTA" } })).toBe(2); // deduplicadas
  });

  it("2 disparos simultâneos da mesma rotina → 1 análise (o outro: EM_EXECUCAO ou JA_EXECUTADA)", async () => {
    await cenarioVendas();
    const rt = runtimeTeste();
    const r = await Promise.all([1, 2].map(() => executarRotina("vendas", { runtime: rt, agora: AGORA, dataReferencia: REF })));
    expect(r.filter((x) => x.executada)).toHaveLength(1);
    expect(["EM_EXECUCAO", "JA_EXECUTADA_NA_JANELA"]).toContain(r.find((x) => !x.executada).motivo);
    expect(await prisma.execucaoAgente.count({ where: { agente: "vendas", tipoExecucao: "ANALISAR_VENDAS" } })).toBe(1);
    expect(await prisma.execucaoRotina.count()).toBe(1);
  });

  it("FALHA na janela pode ser retomada; EXECUTANDO com lease vencido (processo caiu) também; lease vigente não", async () => {
    let falhar = true;
    const instavel = agenteTeste("vendas", async () => {
      if (falhar) throw new Error("fora do ar");
      return { ok: true };
    });
    const rt = runtimeTeste({ substituir: [instavel] });
    const falha = await executarRotina("vendas", { runtime: rt, agora: AGORA });
    expect(falha).toMatchObject({ executada: true, status: "FALHA", motivo: 'Falha na execução do agente "vendas"', tentativas: 1 });
    expect((await prisma.execucaoAgente.findUnique({ where: { id: falha.execucaoId } })).erro).toBe("fora do ar"); // detalhe só na auditoria
    falhar = false;
    expect(await executarRotina("vendas", { runtime: rt, agora: AGORA })).toMatchObject({ executada: true, status: "SUCESSO", tentativas: 2 });

    const janela = "dia:2026-10-05";
    await prisma.execucaoRotina.create({ data: { rotina: "estoque", janela, gatilho: "AGENDADO", status: "EXECUTANDO", bloqueadoAte: new Date(AGORA.getTime() + 60000) } });
    const rtEstoque = runtimeTeste({ substituir: [agenteTeste("estoque", async () => ({ ok: true }))] });
    expect(await executarRotina("estoque", { runtime: rtEstoque, agora: AGORA, janela })).toMatchObject({ executada: false, motivo: "EM_EXECUCAO" });
    await prisma.execucaoRotina.updateMany({ where: { janela }, data: { bloqueadoAte: new Date(AGORA.getTime() - 1000) } });
    expect(await executarRotina("estoque", { runtime: rtEstoque, agora: AGORA, janela })).toMatchObject({ executada: true, status: "SUCESSO", tentativas: 2 });
  });

  it("rotina fora da allowlist → 404", async () => {
    await expect(executarRotina("registrarVendas", { runtime: runtimeTeste() })).rejects.toMatchObject({ status: 404 });
  });
});

describe("eventos: marcam a análise; debounce; uma análise por rajada", () => {
  it("3 vendas seguidas → sinais de estoque e vendas; processa só depois do debounce; dois disparos simultâneos → uma análise de cada", async () => {
    await cenarioVendas();
    const rt = runtimeTeste();
    for (let i = 0; i < 3; i++) await sinalizarEvento("VENDA_REGISTRADA", { agora: new Date(AGORA.getTime() + i * 1000) });
    await sinalizarEvento("PRODUCAO_REGISTRADA", { agora: new Date(AGORA.getTime() + 3000) });
    expect(await prisma.sinalAnalise.findMany({ orderBy: { rotina: "asc" } })).toEqual([
      expect.objectContaining({ rotina: "estoque", pendente: true, eventos: 4, ultimoEvento: "PRODUCAO_REGISTRADA" }),
      expect.objectContaining({ rotina: "vendas", pendente: true, eventos: 3, ultimoEvento: "VENDA_REGISTRADA" }),
    ]);

    const cedo = await processarSinais({ runtime: rt, agora: new Date(AGORA.getTime() + 60000), dataReferencia: REF });
    expect(cedo).toEqual({ processados: 0, resultados: [], aguardandoDebounce: ["estoque", "vendas"] });

    const depois = new Date(AGORA.getTime() + DEBOUNCE_EVENTOS_MS + 5000);
    const [a, b] = await Promise.all([1, 2].map(() => processarSinais({ runtime: rt, agora: depois, dataReferencia: REF })));
    expect(a.processados + b.processados).toBe(2);
    expect(await prisma.execucaoAgente.count({ where: { gatilho: "EVENTO" } })).toBe(2);
    expect((await prisma.execucaoAgente.findMany({ where: { gatilho: "EVENTO" }, orderBy: { agente: "asc" } })).map((e) => e.agente)).toEqual(["estoque", "vendas"]);
    expect(await prisma.sinalAnalise.count({ where: { pendente: true } })).toBe(0);
    expect((await processarSinais({ runtime: rt, agora: depois })).processados).toBe(0);
  });

  it("sinal só com SMA_EVENTOS_ENABLED=true; executar uma ação aprovada de venda sinaliza depois do commit", async () => {
    delete process.env.SMA_EVENTOS_ENABLED;
    await sinalizarSeHabilitado("VENDA_REGISTRADA");
    expect(await prisma.sinalAnalise.count()).toBe(0);

    process.env.SMA_EVENTOS_ENABLED = "true";
    const cliente = await criarCliente();
    const sabor = await criarSabor();
    const a = await acoes.proporAcao({ tipo: "REGISTRAR_VENDA", descricao: "Venda relatada", criadaPorAgente: "vendas", payload: { clienteId: cliente.id, sabores: [{ saborId: sabor.id, quantidade: 2 }], valor: 11 } });
    expect(await prisma.sinalAnalise.count()).toBe(0); // propor não é evento de domínio
    await acoes.aprovarEExecutar(a.id);
    expect((await prisma.sinalAnalise.findMany()).map((s) => s.rotina).sort()).toEqual(["estoque", "vendas"]);
  });
});

describe("flags e segredo das rotinas internas", () => {
  const resposta = () => {
    const r = { statusCode: 200, corpo: null };
    r.status = (s) => { r.statusCode = s; return r; };
    r.json = (c) => { r.corpo = c; return r; };
    return r;
  };
  const req = (token) => ({ get: (h) => (h.toLowerCase() === "x-rotinas-token" ? token : undefined) });
  const SEGREDO = "segredo-ficticio-de-teste-unitario-0123456789";

  it("fail-closed: variável ausente ou diferente de \"true\" → desligada; só \"true\" liga", () => {
    const desligadas = { smaHabilitado: false, assistenteHabilitado: false, rotinasHabilitadas: false, eventosHabilitados: false };
    expect(flags({})).toEqual(desligadas);
    expect(flags({ SMA_ENABLED: "1", ASSISTENTE_ENABLED: "yes", AGENT_SCHEDULER_ENABLED: "", SMA_EVENTOS_ENABLED: "ture" })).toEqual(desligadas);
    expect(flags({ SMA_ENABLED: "false", ASSISTENTE_ENABLED: "FALSE" })).toEqual(desligadas);
    expect(flags({ SMA_ENABLED: " TRUE ", ASSISTENTE_ENABLED: "true", AGENT_SCHEDULER_ENABLED: "True", SMA_EVENTOS_ENABLED: "true" })).toEqual({ smaHabilitado: true, assistenteHabilitado: true, rotinasHabilitadas: true, eventosHabilitados: true });
  });

  it("SMA_ENABLED esquecida → /api/agentes responde 503 (nada exposto por omissão)", () => {
    delete process.env.SMA_ENABLED;
    const r = resposta();
    let seguiu = false;
    exigirFlag("smaHabilitado", "A camada de agentes está desabilitada neste ambiente.")({}, r, () => { seguiu = true; });
    expect([seguiu, r.statusCode]).toEqual([false, 503]);
  });

  it("flag desligada → 503 amigável; ligada → segue", () => {
    process.env.ASSISTENTE_ENABLED = "false";
    const r = resposta();
    let seguiu = false;
    exigirFlag("assistenteHabilitado", "Assistente desabilitado.")({}, r, () => { seguiu = true; });
    expect([seguiu, r.statusCode, r.corpo]).toEqual([false, 503, { error: "Assistente desabilitado." }]);
    process.env.ASSISTENTE_ENABLED = "true";
    exigirFlag("assistenteHabilitado", "x")({}, resposta(), () => { seguiu = true; });
    expect(seguiu).toBe(true);
  });

  it("rotinas: desligadas → 404; sem segredo forte → 503 (falha fechada); segredo errado/ausente → 401; certo → segue", () => {
    const chamar = (token) => {
      const r = resposta();
      let seguiu = false;
      exigirSegredoRotinas(req(token), r, () => { seguiu = true; });
      return seguiu ? "SEGUIU" : r.statusCode;
    };
    delete process.env.AGENT_SCHEDULER_ENABLED;
    process.env.SMA_ROTINAS_TOKEN = SEGREDO;
    expect(chamar(SEGREDO)).toBe(404);
    process.env.AGENT_SCHEDULER_ENABLED = "true";
    process.env.SMA_ROTINAS_TOKEN = "curto";
    expect(chamar("curto")).toBe(503);
    process.env.SMA_ROTINAS_TOKEN = SEGREDO;
    expect([chamar(undefined), chamar(""), chamar(`${SEGREDO}x`), chamar(SEGREDO.slice(0, -1))]).toEqual([401, 401, 401, 401]);
    expect(chamar(SEGREDO)).toBe("SEGUIU");
  });
});

describe("privacidade e auditoria de saídas grandes", () => {
  it("diagnóstico geral pelo chat: nenhum nome de cliente chega ao LLM; respostas grandes entre agentes ficam inteiras (JSON válido)", async () => {
    await cenarioVendas();
    const { usuario } = await criarUsuario();
    const nomes = (await prisma.cliente.findMany({ select: { nome: true } })).map((c) => c.nome);
    expect(nomes.length).toBeGreaterThan(0);
    const llm = criarProvedorFake([
      { json: { intencoes: [{ tipo: "DIAGNOSTICO_GERAL", sabor: null, janelaSemanas: null }], venda: null, pagamento: null, esclarecimento: null } },
      { json: { afirmacoes: [{ texto: "Resumo do diagnóstico.", factIds: ["F1"] }] } },
    ]);
    const r = await servicoConversa.enviarMensagem({ usuarioId: usuario.id, mensagem: "Faça um diagnóstico geral.", dataReferencia: REF }, runtimeTeste({ provedorLLM: llm }));
    expect(r.mensagem.origemTexto).toBe("LLM");
    const enviado = JSON.stringify(llm.requisicoes);
    for (const n of nomes) expect(enviado).not.toContain(n);
    expect(enviado).not.toMatch(/clienteId|telefone|@/);

    const respostas = await prisma.mensagemAgente.findMany({ where: { status: "RESPONDIDA" } });
    expect(respostas.length).toBeGreaterThan(0);
    for (const m of respostas) expect(m.resposta?._truncado).toBeUndefined(); // antes da Etapa 6, a do Vendas (~22 KB) virava prévia
  });

  it("resposta de ~20 KB entre agentes (porte da saída real do Vendas) fica inteira na MensagemAgente; acima de 32 KB vira prévia em JSON válido", async () => {
    const grande = { itens: Array.from({ length: 400 }, (_, i) => ({ i, texto: "x".repeat(40) })) }; // ~20 KB
    const enorme = { itens: Array.from({ length: 900 }, (_, i) => ({ i, texto: "x".repeat(40) })) }; // ~45 KB
    const rt = runtimeTeste({
      extras: [
        agenteTeste("grande", async (ctx) => (ctx.entrada.tipo === "ENORME" ? enorme : grande)),
        agenteTeste("pede", async (ctx) => { await ctx.enviarMensagem({ para: "grande", tipo: "NORMAL" }); await ctx.enviarMensagem({ para: "grande", tipo: "ENORME" }); return { ok: true }; }),
      ],
    });
    await rt.executarAgente("pede", { tipo: "X" });
    const [normal, excesso] = await prisma.mensagemAgente.findMany({ where: { agenteDestino: "grande" }, orderBy: { id: "asc" } });
    expect(JSON.stringify(grande).length).toBeGreaterThan(8000);
    expect(normal.resposta).toEqual(grande);
    expect(excesso.resposta).toMatchObject({ _truncado: true, tamanho: JSON.stringify(enorme).length, previa: expect.any(String) });
  });
});
