/**
 * Gate da suíte de caracterização: compara o relatório JSON do Vitest com a
 * baseline (tests/caracterizacao/baseline.json).
 *
 * Existe porque, na Etapa 0.3, observamos execuções em que resultados sumiam
 * e o Vitest ainda terminava com código 0. Aqui "sucesso" exige o conjunto
 * completo: todos os arquivos, todos os testes, nenhum falho ou pendente.
 */

/** Devolve a lista de divergências (vazia = aprovado). Função pura. */
export function verificarResultado(resultado, baseline) {
  const motivos = [];
  if (!resultado || !Array.isArray(resultado.testResults)) {
    return ["relatório JSON do Vitest ausente ou inválido"];
  }

  const arquivos = resultado.testResults.length;
  if (arquivos !== baseline.arquivos) {
    motivos.push(`arquivos de teste: ${arquivos} (esperado ${baseline.arquivos})`);
  }
  if (resultado.numTotalTests !== baseline.testes) {
    motivos.push(`testes reportados: ${resultado.numTotalTests} (esperado ${baseline.testes})`);
  }
  if (resultado.numPassedTests !== baseline.testes) {
    motivos.push(`testes aprovados: ${resultado.numPassedTests} (esperado ${baseline.testes})`);
  }
  if (resultado.numFailedTests !== 0) {
    motivos.push(`testes com falha: ${resultado.numFailedTests}`);
  }
  const pendentes = (resultado.numPendingTests ?? 0) + (resultado.numTodoTests ?? 0);
  if (pendentes > (baseline.pendentesPermitidos ?? 0)) {
    motivos.push(`testes pendentes/todo: ${pendentes} (permitido ${baseline.pendentesPermitidos ?? 0})`);
  }

  // Conferência por teste, para apontar exatamente o que não passou.
  for (const arquivo of resultado.testResults) {
    const nome = String(arquivo.name).replace(/.*[\\/]tests[\\/]/, "tests/");
    if (arquivo.status !== "passed") motivos.push(`arquivo ${nome}: status ${arquivo.status}`);
    for (const t of arquivo.assertionResults ?? []) {
      if (t.status !== "passed") motivos.push(`${nome} > ${t.title}: ${t.status}`);
    }
  }
  if (resultado.success !== true) motivos.push("Vitest não reportou success=true");

  return motivos;
}
