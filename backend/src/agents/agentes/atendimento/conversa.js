// Agente de Atendimento — fluxo de um turno da conversa (Etapa 5).
//
//   mensagem do gestor
//     → (desambiguação pendente? resolve a escolha sem LLM)
//     → LLM: interpretação ESTRUTURADA (JSON Schema + Zod; inválida → nova tentativa → erro controlado)
//     → código: limites, nomes/números citados, resolução segura de entidades
//     → Coordenador (mensagem SMA): CONSULTA aos especialistas | ACAO (proposta PENDENTE no Vendas)
//     → LLM: AFIRMAÇÕES estruturadas citando o catálogo de fatos → validação de cada uma
//       (Etapa 6: número×entidade×unidade×natureza, datas, guardas semânticas) → inválidas descartadas
//       → nenhuma válida? template → ressalvas determinísticas dos fatos críticos
//     → resposta + novo estado da conversa
//
// O LLM interpreta e redige; os especialistas calculam; o código decide. Nada
// é executado: ações viram AcaoProposta PENDENTE e só o gestor aprova. A
// conversa (tabelas) é gravada pelo serviço de conversa, fora do agente.
import { ErroLLM } from "../../llm/erros.js";
import { ESQUEMA_SINTESE, catalogoParaLLM, lerSintese, montarCatalogo, ressalvasPendentes, verificarAfirmacoes } from "../../conversa/afirmacoes.js";
import { citadoNaMensagem, numeroNaMensagem, verificarNumeros } from "../../conversa/fatos.js";
import { ACOES, ESQUEMA_INTERPRETACAO, LIMITES_CONVERSA, ROTAS_CONSULTA, validarInterpretacao } from "../../conversa/intencoes.js";
import { TEXTOS, textoAcaoProposta, textoAjuda, textoDosFatos, textoEscolha, textoNaoEncontrado } from "../../conversa/respostas.js";
import { ehCancelamento, resolverEscolha } from "./escolha.js";
import { PROMPT_INTERPRETACAO, PROMPT_SINTESE } from "./prompts.js";

const RESOLVIDO = new Set(["EXATO", "PARCIAL_UNICO"]);
const truncar = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);

export async function conversar(contexto, { mensagem, historico = [], estado = {}, dataReferencia }) {
  const inicioTurno = Date.now();
  const registro = { interpretacao: null, consultas: [], verificacaoFatos: null, chamadasLLM: [], metricas: {} };
  let novoEstado = { ...(estado.ultimoAssunto && { ultimoAssunto: estado.ultimoAssunto }) };

  const responder = (texto, origemTexto, extra = {}) => ({
    agente: "atendimento",
    tipo: "RESPOSTA_CONVERSA",
    resposta: { texto, origemTexto, acoesPropostas: [], anexos: [], limitacoes: [], pendencia: null, ...extra },
    ...registro,
    novoEstado,
    metricas: { ...registro.metricas, totalMs: Date.now() - inicioTurno },
  });

  /** Uma chamada ao LLM, registrada (sem prompt nem raciocínio). Respeita o orçamento do turno. */
  const chamarLLM = async (etapa, pedido) => {
    if (registro.chamadasLLM.length >= LIMITES_CONVERSA.MAX_CHAMADAS_LLM) throw new ErroLLM("REQUISICAO", "Orçamento de chamadas ao LLM do turno esgotado");
    const item = { etapa };
    registro.chamadasLLM.push(item);
    try {
      const { resposta, duracaoMs } = await contexto.gerarLLM(pedido);
      Object.assign(item, { ok: true, duracaoMs, ...(resposta.uso && { modelo: resposta.uso.modelo, tokensEntrada: resposta.uso.tokensEntrada, tokensSaida: resposta.uso.tokensSaida }) });
      return resposta;
    } catch (e) {
      Object.assign(item, { ok: false, codigo: e.codigo ?? "ERRO" });
      throw e;
    }
  };

  // ------------------------------------------------ propostas (sempre PENDENTE)
  const proporAcao = async (tipo, payload) => {
    const r = await contexto.enviarMensagem({ para: "coordenador", tipo: "ACAO", dados: { tipo, payload } });
    registro.consultas.push({ intencao: tipo, agente: ACOES[tipo].agente, status: r.ok ? "OK" : "FALHA" });
    return r;
  };

  /** Venda com cliente/itens possivelmente já resolvidos ({ id, nome }) ou ainda em texto. */
  const seguirVenda = async (venda) => {
    if (typeof venda.cliente === "string" || venda.itens.some((i) => typeof i.sabor === "string")) {
      const pendentes = { ...(typeof venda.cliente === "string" && { cliente: venda.cliente }), sabores: venda.itens.filter((i) => typeof i.sabor === "string").map((i) => i.sabor) };
      const r = await contexto.usarTool("resolverEntidades", pendentes);
      if (!r.ok) return responder(TEXTOS.NAO_ENTENDI, "SISTEMA");
      const resolucoes = [...(r.dados.cliente ? [{ campo: "cliente", ...r.dados.cliente }] : []), ...r.dados.sabores.map((s) => ({ campo: "sabor", ...s }))];
      const v = structuredClone(venda);
      for (const res of resolucoes) {
        if (RESOLVIDO.has(res.status)) {
          if (res.campo === "cliente") v.cliente = res.registro;
          else v.itens.filter((i) => i.sabor === res.termo).forEach((i) => { i.sabor = res.registro; });
        }
      }
      const problema = resolucoes.find((res) => !RESOLVIDO.has(res.status));
      if (problema?.status === "AMBIGUO") {
        novoEstado = { ...novoEstado, pendente: { campo: problema.campo, termo: problema.termo, opcoes: problema.candidatos, retomar: { tipo: "VENDA", venda: v } } };
        return responder(textoEscolha(problema.campo, problema.termo, problema.candidatos), "TEMPLATE", { pendencia: { campo: problema.campo, opcoes: problema.candidatos } });
      }
      if (problema) return responder(textoNaoEncontrado(problema.campo, problema.termo), "TEMPLATE");
      return seguirVenda(v);
    }
    const payload = { clienteId: venda.cliente.id, sabores: venda.itens.map((i) => ({ saborId: i.sabor.id, quantidade: i.quantidade })), valor: venda.valor };
    const r = await proporAcao("PROPOR_VENDA", payload);
    if (!r.ok) return responder(`Não consegui preparar a proposta: ${r.motivo}`, "TEMPLATE");
    const card = {
      ...r.acao, titulo: "Registrar venda",
      resumo: { cliente: venda.cliente, itens: venda.itens.map((i) => ({ saborId: i.sabor.id, sabor: i.sabor.nome, quantidade: i.quantidade })), valorInformado: venda.valor },
    };
    return responder(textoAcaoProposta({ ...card, tipo: "REGISTRAR_VENDA" }), "TEMPLATE", { acoesPropostas: [{ ...card, tipoAcao: "REGISTRAR_VENDA" }] });
  };

  // ------------------------------------------------ consultas
  const seguirConsulta = async (intencoes) => {
    const termos = [...new Set(intencoes.filter((i) => typeof i.sabor === "string" && !i.saborId).map((i) => i.sabor))];
    if (termos.length > 0) {
      const r = await contexto.usarTool("resolverEntidades", { sabores: termos });
      if (!r.ok) return responder(TEXTOS.NAO_ENTENDI, "SISTEMA");
      const lista = intencoes.map((i) => ({ ...i }));
      for (const res of r.dados.sabores) {
        if (RESOLVIDO.has(res.status)) lista.filter((i) => i.sabor === res.termo).forEach((i) => Object.assign(i, { saborId: res.registro.id, sabor: res.registro.nome }));
      }
      const problema = r.dados.sabores.find((res) => !RESOLVIDO.has(res.status));
      if (problema?.status === "AMBIGUO") {
        novoEstado = { ...novoEstado, pendente: { campo: "sabor", termo: problema.termo, opcoes: problema.candidatos, retomar: { tipo: "CONSULTA", intencoes: lista } } };
        return responder(textoEscolha("sabor", problema.termo, problema.candidatos), "TEMPLATE", { pendencia: { campo: "sabor", opcoes: problema.candidatos } });
      }
      if (problema) return responder(textoNaoEncontrado("sabor", problema.termo), "TEMPLATE");
      return seguirConsulta(lista);
    }

    const t0 = Date.now();
    const resposta = await contexto.enviarMensagem({
      para: "coordenador", tipo: "CONSULTA",
      dados: { ...(dataReferencia && { dataReferencia }), intencoes: intencoes.map((i) => ({ tipo: i.tipo, saborId: i.saborId ?? null, sabor: i.sabor ?? null, janelaSemanas: i.janelaSemanas ?? null })) },
    });
    registro.metricas.especialistasMs = Date.now() - t0;
    registro.consultas = resposta.resultados.map((r) => ({ intencao: r.intencao, agente: r.agente, status: r.status, ...(r.reduzido && { reduzido: true }) }));
    novoEstado = { ...novoEstado, ultimoAssunto: { intencoes: intencoes.map((i) => ({ tipo: i.tipo, sabor: i.sabor ?? null, saborId: i.saborId ?? null, janelaSemanas: i.janelaSemanas ?? null })) } };

    const limitacoes = [...new Set(resposta.resultados.flatMap((r) => r.limitacoes ?? []))];
    const anexos = await montarAnexos(contexto, resposta.resultados);
    const catalogo = montarCatalogo(resposta.resultados);
    const template = () => textoDosFatos(resposta.resultados);

    const t1 = Date.now();
    let texto;
    let origemTexto = "LLM";
    let aceitas = [];
    try {
      const r = await chamarLLM("SINTESE", {
        sistema: PROMPT_SINTESE,
        mensagens: [{ papel: "usuario", conteudo: `Pergunta do gestor: ${mensagem}\n\nCatálogo de fatos dos agentes (id | intenção | entidade | métrica | valor | unidade):\n${catalogoParaLLM(catalogo)}` }],
        formato: ESQUEMA_SINTESE,
        maxTokens: 900,
      });
      const lida = r.tipo === "texto" ? lerSintese(r.texto) : { valida: false, erro: "TOOL_CALL_NAO_PERMITIDA" };
      if (!lida.valida) {
        registro.verificacaoFatos = { aplicada: true, fatosNoCatalogo: catalogo.fatos.length, motivoTemplate: `SINTESE_${lida.erro}` };
      } else {
        const v = verificarAfirmacoes(lida.afirmacoes, catalogo, { extras: [mensagem] });
        aceitas = v.aceitas;
        registro.verificacaoFatos = {
          aplicada: true,
          fatosNoCatalogo: catalogo.fatos.length,
          afirmacoes: lida.afirmacoes.length + lida.excedentes,
          aceitas: aceitas.map((a) => ({ factIds: a.factIds })),
          descartadas: v.descartadas.map((d) => ({ motivo: d.motivo, ...(d.detalhe && { detalhe: d.detalhe }), factIds: d.factIds, texto: truncar(d.texto, 200) })),
          ...(lida.excedentes && { excedentesIgnoradas: lida.excedentes }),
        };
        if (aceitas.length) texto = aceitas.map((a) => a.texto.trim()).join(" ");
        else registro.verificacaoFatos.motivoTemplate = "NENHUMA_AFIRMACAO_VALIDA";
      }
    } catch (e) {
      if (!(e instanceof ErroLLM)) throw e;
      registro.verificacaoFatos = { aplicada: false, motivoTemplate: `LLM_${e.codigo}` }; // os especialistas já rodaram: não são repetidos
    }
    if (!texto) {
      texto = template();
      origemTexto = "TEMPLATE";
      aceitas = [];
    }
    // fatos críticos não numéricos nunca somem da resposta
    const ressalvas = ressalvasPendentes(catalogo, aceitas);
    if (ressalvas.length) {
      texto = `${texto}\n\n${ressalvas.map((x) => `Ressalva: ${x.texto}`).join("\n")}`;
      registro.verificacaoFatos = { ...registro.verificacaoFatos, ressalvas: ressalvas.map((x) => x.codigo) };
    }
    registro.metricas.sinteseMs = Date.now() - t1;
    return responder(texto, origemTexto, { anexos, limitacoes, degradado: !resposta.completo });
  };

  // ------------------------------------------------ 1. desambiguação pendente (sem LLM)
  if (estado.pendente) {
    if (ehCancelamento(mensagem)) {
      return responder(TEXTOS.CANCELADO, "TEMPLATE");
    }
    const escolhida = resolverEscolha(mensagem, estado.pendente.opcoes);
    if (escolhida) {
      const { campo, termo, retomar } = estado.pendente;
      if (retomar.tipo === "VENDA") {
        const v = structuredClone(retomar.venda);
        if (campo === "cliente") v.cliente = { id: escolhida.id, nome: escolhida.nome };
        else v.itens.filter((i) => i.sabor === termo).forEach((i) => { i.sabor = { id: escolhida.id, nome: escolhida.nome }; });
        return seguirVenda(v);
      }
      const lista = retomar.intencoes.map((i) => (i.sabor === termo && !i.saborId ? { ...i, saborId: escolhida.id, sabor: escolhida.nome } : i));
      return seguirConsulta(lista);
    }
    // não é uma escolha reconhecível: a pendência cai e a mensagem segue como pedido novo
  }

  // ------------------------------------------------ 2. interpretação estruturada (LLM)
  if (!contexto.provedorLLM) return responder(TEXTOS.INDISPONIVEL, "SISTEMA", { indisponivel: true });
  const janela = historico.slice(-LIMITES_CONVERSA.JANELA_HISTORICO).map((m) => ({ papel: m.papel === "USUARIO" ? "usuario" : "assistente", conteudo: truncar(String(m.conteudo ?? ""), LIMITES_CONVERSA.MAX_CARACTERES_HISTORICO) }));
  while (janela.length && janela[0].papel !== "usuario") janela.shift();
  const mensagensLLM = [...janela, { papel: "usuario", conteudo: `Contexto estruturado da conversa: ${JSON.stringify(estado.ultimoAssunto ?? null)}\n\nMensagem do gestor: ${mensagem}` }];

  const t0 = Date.now();
  let interpretacao = null;
  try {
    for (let tentativa = 1; tentativa <= 2 && !interpretacao; tentativa++) {
      const r = await chamarLLM(tentativa === 1 ? "INTERPRETACAO" : "INTERPRETACAO_NOVA_TENTATIVA", { sistema: PROMPT_INTERPRETACAO, mensagens: mensagensLLM, formato: ESQUEMA_INTERPRETACAO, maxTokens: 600 });
      const v = r.tipo === "texto" ? validarInterpretacao(r.texto) : { valida: false, erro: "TOOL_CALL_NAO_PERMITIDA" };
      registro.interpretacao = v.valida ? { valida: true, ...v.interpretacao } : { valida: false, erro: v.erro, ...(v.detalhes && { detalhes: v.detalhes }) };
      if (v.valida) interpretacao = v.interpretacao;
      if (v.erro === "MUITAS_INTENCOES") break; // nova tentativa não resolve: o gestor precisa dividir o pedido
    }
  } catch (e) {
    if (!(e instanceof ErroLLM)) throw e;
    registro.metricas.interpretacaoMs = Date.now() - t0;
    return responder(TEXTOS.INDISPONIVEL, "SISTEMA", { indisponivel: true });
  }
  registro.metricas.interpretacaoMs = Date.now() - t0;
  if (!interpretacao) return responder(registro.interpretacao?.erro === "MUITAS_INTENCOES" ? TEXTOS.MUITAS_INTENCOES : TEXTOS.NAO_ENTENDI, "SISTEMA");

  // ------------------------------------------------ 3. decisão (código)
  const tipos = interpretacao.intencoes.map((i) => i.tipo);
  if (tipos.includes("FORA_DE_ESCOPO")) return responder(TEXTOS.FORA_DE_ESCOPO, "TEMPLATE");
  if (tipos.includes("AJUDA")) return responder(textoAjuda(), "TEMPLATE");

  if (interpretacao.venda) {
    const { venda } = interpretacao;
    if (venda.valor === null) return responder(TEXTOS.SEM_VALOR, "TEMPLATE");
    if (![venda.valor, ...venda.itens.map((i) => i.quantidade)].every((n) => numeroNaMensagem(n, mensagem))) return responder(TEXTOS.VALOR_NAO_CITADO, "TEMPLATE");
    if (![venda.cliente, ...venda.itens.map((i) => i.sabor)].every((n) => citadoNaMensagem(n, mensagem))) return responder(TEXTOS.NOME_NAO_CITADO, "TEMPLATE");
    return seguirVenda({ cliente: venda.cliente, itens: venda.itens.map((i) => ({ ...i })), valor: venda.valor });
  }
  if (interpretacao.pagamento) {
    const { vendaId } = interpretacao.pagamento;
    if (!numeroNaMensagem(vendaId, mensagem)) return responder(TEXTOS.VALOR_NAO_CITADO, "TEMPLATE");
    const r = await proporAcao("PROPOR_MARCAR_VENDA_PAGA", { vendaId });
    if (!r.ok) return responder(`Não consegui preparar a proposta: ${r.motivo}`, "TEMPLATE");
    const card = { ...r.acao, titulo: "Marcar venda como paga", resumo: { vendaId } };
    return responder(textoAcaoProposta({ ...card, tipo: "MARCAR_VENDA_PAGA" }), "TEMPLATE", { acoesPropostas: [{ ...card, tipoAcao: "MARCAR_VENDA_PAGA" }] });
  }

  const consultas = interpretacao.intencoes.filter((i) => ROTAS_CONSULTA[i.tipo]);
  if (consultas.length === 0) return responder(interpretacao.esclarecimento && verificarNumeros(interpretacao.esclarecimento, {}, [mensagem]).aprovada ? interpretacao.esclarecimento : TEXTOS.NAO_ENTENDI, "LLM");
  if (consultas.some((i) => i.janelaSemanas !== null && (i.janelaSemanas < LIMITES_CONVERSA.JANELA_SEMANAS_MIN || i.janelaSemanas > LIMITES_CONVERSA.JANELA_SEMANAS_MAX))) {
    return responder(TEXTOS.JANELA_FORA, "TEMPLATE");
  }
  return seguirConsulta(consultas.map((i) => ({ tipo: i.tipo, sabor: i.sabor, janelaSemanas: i.janelaSemanas })));
}

/** Listas por cliente (só ids nos especialistas) ganham nomes AQUI, para a tela; nunca vão ao LLM. */
async function montarAnexos(contexto, resultados) {
  const anexos = resultados.filter((r) => r.anexo).map((r) => r.anexo);
  const ids = [...new Set(anexos.flatMap((a) => a.itens.map((i) => i.clienteId)).filter(Boolean))];
  if (ids.length === 0) return anexos;
  const r = await contexto.usarTool("consultarNomesClientes", { ids: ids.slice(0, 200) });
  const nomes = new Map((r.ok ? r.dados.clientes : []).map((c) => [c.id, c.nome]));
  return anexos.map((a) => ({ ...a, itens: a.itens.map((i) => (i.clienteId ? { ...i, cliente: nomes.get(i.clienteId) ?? null } : i)) }));
}
