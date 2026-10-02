// Smoke test MANUAL do provedor de LLM real (Etapa 6). Não faz parte da suíte
// automatizada (que nunca usa rede) e não toca o banco: não importa Prisma nem
// services, não executa agentes nem ações de domínio.
//
//   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... node scripts/agentes/smokeProviderReal.js
//
// Três chamadas mínimas, com os MESMOS prompts e contratos do Atendimento:
//   1. interpretação estruturada de "Como estão as vendas?"   → CONSULTAR_VENDAS
//   2. interpretação estruturada de "Como está o Tradicional?" → sabor Tradicional
//   3. síntese em AFIRMAÇÕES sobre um catálogo FICTÍCIO       → validação factual
//
// Registra só: provedor, modelo, tipo da chamada, sucesso, latência e tokens.
// Nunca imprime a credencial, os prompts nem os textos gerados.
// Saída: 0 = validado; 1 = alguma chamada falhou; 2 = PROVIDER_REAL_NAO_VALIDADO (sem configuração).
import "dotenv/config";
import { ESQUEMA_SINTESE, catalogoParaLLM, lerSintese, montarCatalogo, verificarAfirmacoes } from "../../src/agents/conversa/afirmacoes.js";
import { ESQUEMA_INTERPRETACAO, validarInterpretacao } from "../../src/agents/conversa/intencoes.js";
import { PROMPT_INTERPRETACAO, PROMPT_SINTESE } from "../../src/agents/agentes/atendimento/prompts.js";
import { obterProvedorConfigurado } from "../../src/agents/llm/provedor.js";

const CATALOGO_FICTICIO = montarCatalogo([
  {
    intencao: "CONSULTAR_VENDAS", agente: "vendas", status: "OK",
    fatos: {
      periodo: { dataInicio: "2026-08-30", dataFim: "2026-09-26", semanas: 4 },
      indicadores: { quantidadeVendas: 9, unidades: 135, faturamentoRegistrado: 742.5, vendasPendentes: 2, valorPendente: 192.5 },
      mix: [{ sabor: "Tradicional", unidades: 90, participacao: 66.7 }, { sabor: "Maracujá", unidades: 45, participacao: 33.3 }],
    },
    textos: [], limitacoes: ["Pendente = não marcada como paga no registro atual; não é atraso nem inadimplência."],
  },
]);

const contexto = (m) => `Contexto estruturado da conversa: null\n\nMensagem do gestor: ${m}`;

async function main() {
  if (process.env.APP_ENV === "test") throw new Error("Não rode o smoke do provedor real com APP_ENV=test.");
  const provedor = await obterProvedorConfigurado(process.env);
  if (!provedor || provedor.configuracaoInvalida) {
    console.log(JSON.stringify({ resultado: "PROVIDER_REAL_NAO_VALIDADO", motivo: provedor ? "configuracao_invalida" : "sem_LLM_PROVIDER" }));
    process.exitCode = 2;
    return;
  }

  const casos = [
    { chamada: "INTERPRETACAO", pedido: { sistema: PROMPT_INTERPRETACAO, mensagens: [{ papel: "usuario", conteudo: contexto("Como estão as vendas?") }], formato: ESQUEMA_INTERPRETACAO, maxTokens: 600 },
      conferir: (t) => { const v = validarInterpretacao(t); return v.valida && v.interpretacao.intencoes.some((i) => i.tipo === "CONSULTAR_VENDAS") ? "OK" : `INESPERADO:${v.erro ?? "intencao"}`; } },
    { chamada: "INTERPRETACAO", pedido: { sistema: PROMPT_INTERPRETACAO, mensagens: [{ papel: "usuario", conteudo: contexto("Como está o Tradicional?") }], formato: ESQUEMA_INTERPRETACAO, maxTokens: 600 },
      conferir: (t) => { const v = validarInterpretacao(t); return v.valida && v.interpretacao.intencoes.some((i) => /tradicional/i.test(i.sabor ?? "")) ? "OK" : `INESPERADO:${v.erro ?? "sabor"}`; } },
    { chamada: "SINTESE", pedido: { sistema: PROMPT_SINTESE, mensagens: [{ papel: "usuario", conteudo: `Pergunta do gestor: Como estão as vendas?\n\nCatálogo de fatos dos agentes (id | intenção | entidade | métrica | valor | unidade):\n${catalogoParaLLM(CATALOGO_FICTICIO)}` }], formato: ESQUEMA_SINTESE, maxTokens: 900 },
      conferir: (t) => {
        const l = lerSintese(t);
        if (!l.valida) return `INESPERADO:${l.erro}`;
        const v = verificarAfirmacoes(l.afirmacoes, CATALOGO_FICTICIO, { extras: ["Como estão as vendas?"] });
        return `OK aceitas=${v.aceitas.length} descartadas=${v.descartadas.length}${v.descartadas.length ? ` motivos=${v.descartadas.map((d) => d.motivo).join(",")}` : ""}`;
      } },
  ];

  let falhas = 0;
  for (const c of casos) {
    const t0 = Date.now();
    const linha = { provedor: provedor.nome, modelo: provedor.modelo, chamada: c.chamada };
    try {
      const r = await provedor.gerar(c.pedido);
      const conferencia = r.tipo === "texto" ? c.conferir(r.texto) : "INESPERADO:tool_call";
      if (!conferencia.startsWith("OK")) falhas++;
      Object.assign(linha, { ok: conferencia.startsWith("OK"), conferencia, latenciaMs: Date.now() - t0, tokensEntrada: r.uso?.tokensEntrada ?? null, tokensSaida: r.uso?.tokensSaida ?? null });
    } catch (e) {
      falhas++;
      Object.assign(linha, { ok: false, codigo: e.codigo ?? "ERRO", latenciaMs: Date.now() - t0 }); // a mensagem do erro não é impressa (pode ecoar configuração)
    }
    console.log(JSON.stringify(linha));
  }
  console.log(JSON.stringify({ resultado: falhas ? "PROVIDER_REAL_FALHOU" : "PROVIDER_REAL_VALIDADO", chamadas: casos.length, falhas }));
  process.exitCode = falhas ? 1 : 0;
}

main().catch((e) => {
  console.error(`smoke abortado: ${e.message}`);
  process.exitCode = 1;
});
