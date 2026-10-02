// Runtime SMA (Etapa 1): executa agentes registrados e audita tudo.
//
//   executarAgente(nome, entrada, opcoes)
//     → agente existe? (senão 404, sem registro)
//     → cria ExecucaoAgente EM_ANDAMENTO
//     → agente.executar(contexto)            (com limite de tempo)
//     → SUCESSO (saída, duração)  |  FALHA (erro, duração) + ErroExecucaoAgente
//
// O agente só recebe o `contexto`: tools permitidas (cada chamada vira uma
// ChamadaTool), mensagens a outros agentes (MensagemAgente + execução filha),
// recomendações e o LLM (se houver provedor). Nenhum acesso ao Prisma.
import { erro } from "../../lib/erros.js";
import { prisma } from "../../lib/prisma.js";
import { executarCicloLLM } from "../llm/cicloTools.js";
import { CODIGOS_LLM, ErroLLM } from "../llm/erros.js";
import { semProvedor } from "../llm/provedor.js";
import { executarTool, falha, paraLLM } from "../tools/definirTool.js";
import { validarResposta } from "../llm/provedor.js";
import { encerrarAusentes, registrarRecomendacao as registrarRec } from "./recomendacoes.js";
import { ErroExecucaoAgente, TempoEsgotado, comLimite, mensagemSegura, paraRegistro } from "./util.js";

// A saída de uma análise (ex.: Agente de Estoque) cabe inteira na auditoria;
// tools e entradas continuam no limite padrão de paraRegistro.
const LIMITE_SAIDA = 32000;

export function criarRuntime({ registro, catalogo, provedorLLM = null, limiteMs = 30000, profundidadeMaxima = 4, limiteChamadaLLMMs = 20000 }) {
  async function executarAgente(nome, entrada = {}, { gatilho = "INTERNO", execucaoPaiId = null, profundidade = 0 } = {}) {
    const agente = registro.obter(nome); // 404 antes de qualquer registro
    const inicio = Date.now();
    const execucao = await prisma.execucaoAgente.create({
      data: {
        agente: nome,
        tipoExecucao: String(entrada?.tipo ?? "PADRAO").slice(0, 50),
        gatilho,
        status: "EM_ANDAMENTO",
        entrada: paraRegistro(entrada),
        execucaoPaiId,
        metadados: paraRegistro({ profundidade, provedorLLM: provedorLLM?.nome ?? null }),
      },
    });

    const contexto = criarContexto({ agente, execucaoId: execucao.id, entrada, profundidade });
    try {
      // Etapa 5: um agente pode declarar o próprio limite (o Atendimento espera LLM + especialistas)
      const saida = await comLimite(Promise.resolve().then(() => agente.executar(contexto)), agente.limiteMs ?? limiteMs, `agente ${nome}`);
      await prisma.execucaoAgente.update({
        where: { id: execucao.id },
        data: { status: "SUCESSO", saida: paraRegistro(saida, LIMITE_SAIDA), finalizadaEm: new Date(), duracaoMs: Date.now() - inicio },
      });
      return { execucaoId: execucao.id, agente: nome, status: "SUCESSO", saida };
    } catch (e) {
      const mensagem = mensagemSegura(e);
      await prisma.execucaoAgente.update({
        where: { id: execucao.id },
        data: { status: "FALHA", erro: mensagem, finalizadaEm: new Date(), duracaoMs: Date.now() - inicio },
      });
      throw new ErroExecucaoAgente(nome, execucao.id, mensagem);
    }
  }

  function criarContexto({ agente, execucaoId, entrada, profundidade }) {
    const permitidas = new Set(agente.tools);

    async function usarTool(nomeTool, entradaTool = {}, { origem = "AGENTE" } = {}) {
      const inicio = Date.now();
      const tool = catalogo.get(nomeTool);
      let resultado;
      let interno;
      if (!tool) resultado = falha("TOOL_INEXISTENTE", `Tool inexistente: "${nomeTool}"`);
      else if (!permitidas.has(nomeTool)) resultado = falha("TOOL_NAO_PERMITIDA", `O agente ${agente.nome} não pode usar a tool "${nomeTool}"`);
      else ({ resultado, interno } = await executarTool(tool, entradaTool, contexto));

      await prisma.chamadaTool.create({
        data: {
          execucaoId,
          tool: String(nomeTool).slice(0, 80),
          origem,
          entrada: paraRegistro(entradaTool),
          ok: resultado.ok,
          saida: resultado.ok ? paraRegistro(tool.resumir ? tool.resumir(resultado.dados) : resultado.dados) : paraRegistro(resultado.erro),
          erro: resultado.ok ? null : (interno ?? resultado.erro.mensagem),
          duracaoMs: Date.now() - inicio,
        },
      });
      return resultado;
    }

    async function enviarMensagem({ para, tipo, dados = {} } = {}) {
      if (!registro.existe(para)) throw erro(404, `Agente destino inexistente: "${para}"`);
      if (typeof tipo !== "string" || !tipo) throw erro(400, "Mensagem sem tipo");
      if (profundidade + 1 > profundidadeMaxima) throw erro(409, `Profundidade máxima de delegação (${profundidadeMaxima}) excedida`);

      const mensagem = await prisma.mensagemAgente.create({
        data: { execucaoId, agenteOrigem: agente.nome, agenteDestino: para, tipo: tipo.slice(0, 50), conteudo: paraRegistro(dados), status: "ENVIADA" },
      });
      try {
        const r = await executarAgente(para, { tipo, dados, de: agente.nome, mensagemId: mensagem.id }, {
          gatilho: "MENSAGEM",
          execucaoPaiId: execucaoId,
          profundidade: profundidade + 1,
        });
        await prisma.mensagemAgente.update({
          where: { id: mensagem.id },
          data: { status: "RESPONDIDA", execucaoDestinoId: r.execucaoId, resposta: paraRegistro(r.saida, LIMITE_SAIDA) }, // Etapa 6: a resposta é a saída do destino (Vendas ~22 KB): mesmo limite da execução
        });
        return r.saida;
      } catch (e) {
        await prisma.mensagemAgente.update({
          where: { id: mensagem.id },
          data: { status: "FALHA", execucaoDestinoId: e.execucaoId ?? null, resposta: paraRegistro({ erro: mensagemSegura(e) }) },
        });
        throw e;
      }
    }

    /** Cria ou atualiza (deduplicação por chave): { operacao, recomendacao }. Ver recomendacoes.js. */
    const registrarRecomendacao = (entrada) => registrarRec({ agente: agente.nome, execucaoId, entrada });

    /** Resolve as ABERTAS dos tipos informados que não foram detectadas nesta execução. */
    const encerrarRecomendacoesAusentes = ({ tipos, chavesAtivas }) =>
      encerrarAusentes({ agente: agente.nome, execucaoId, tipos, chavesAtivas });

    /** Raciocínio com LLM usando só as tools permitidas a este agente (ou um subconjunto delas). */
    async function raciocinar({ sistema, mensagens, tools = agente.tools, maxPassos, limiteMs: limiteLLM } = {}) {
      if (!provedorLLM) throw semProvedor();
      const definicoes = tools.filter((t) => permitidas.has(t) && catalogo.has(t)).map((t) => paraLLM(catalogo.get(t)));
      return executarCicloLLM({ provedor: provedorLLM, sistema, mensagens, definicoes, usarTool, maxPassos, limiteMs: limiteLLM });
    }

    /**
     * Etapa 5: UMA chamada ao LLM, sem tools (interpretação estruturada ou
     * redação). Quem chama registra a chamada na própria saída (auditoria sem
     * prompt nem raciocínio). Sem provedor → ErroLLM CONFIGURACAO.
     */
    async function gerarLLM({ sistema, mensagens, formato, maxTokens, limiteMs: limiteChamada = limiteChamadaLLMMs }) {
      if (!provedorLLM) throw new ErroLLM(CODIGOS_LLM.CONFIGURACAO, "Nenhum provedor de LLM configurado");
      const inicio = Date.now();
      try {
        const resposta = validarResposta(await comLimite(provedorLLM.gerar({ sistema, mensagens, formato, maxTokens }), limiteChamada, `provedor ${provedorLLM.nome}`));
        return { resposta, duracaoMs: Date.now() - inicio };
      } catch (e) {
        if (e instanceof TempoEsgotado) throw new ErroLLM(CODIGOS_LLM.TEMPO_ESGOTADO, "O provedor de LLM não respondeu no tempo limite");
        if (e instanceof ErroLLM) throw e;
        throw new ErroLLM(CODIGOS_LLM.INDISPONIVEL, "Falha ao chamar o provedor de LLM");
      }
    }

    const contexto = Object.freeze({
      agente: agente.nome,
      execucaoId,
      entrada,
      profundidade,
      toolsPermitidas: () => [...permitidas],
      usarTool,
      enviarMensagem,
      registrarRecomendacao,
      encerrarRecomendacoesAusentes,
      raciocinar,
      gerarLLM,
      provedorLLM: provedorLLM ? { nome: provedorLLM.nome, modelo: provedorLLM.modelo ?? null } : null,
    });
    return contexto;
  }

  return { executarAgente, registro, catalogo };
}
