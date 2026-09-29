/**
 * Validador de SQL somente leitura usado pela coleta da Etapa 0.2.
 *
 * É a primeira de três barreiras (as outras são a sessão MySQL em modo
 * READ ONLY e o uso recomendado de um usuário com permissão só de SELECT).
 * É deliberadamente conservador: na dúvida, rejeita.
 */

const PALAVRAS_PROIBIDAS = [
  "insert", "update", "delete", "replace", "merge", "upsert",
  "drop", "alter", "create", "truncate", "rename",
  "grant", "revoke",
  "call", "do", "handler", "load", "lock", "unlock",
  "set", "commit", "rollback", "savepoint", "start", "begin",
  "analyze", "optimize", "repair", "flush", "kill", "reset", "purge",
  "install", "uninstall", "prepare", "execute", "deallocate",
  "into", "outfile", "dumpfile",
  "sleep", "benchmark", "get_lock", "release_lock",
];

const RE_PROIBIDAS = new RegExp(`\\b(${PALAVRAS_PROIBIDAS.join("|")})\\b`, "i");

/** Remove literais de string ('...') para não confundir conteúdo com comando. */
function semLiterais(sql) {
  return sql.replace(/'(?:[^'\\]|\\.|'')*'/g, "''");
}

/**
 * Retorna { valida: true } ou { valida: false, motivo }.
 * Aceita apenas uma instrução SELECT (ou WITH ... SELECT), sem comentários.
 */
export function validarSomenteLeitura(sql) {
  if (typeof sql !== "string" || sql.trim() === "") {
    return { valida: false, motivo: "consulta vazia" };
  }

  const semStrings = semLiterais(sql);

  if (/--|\/\*|\*\/|#/.test(semStrings)) {
    return { valida: false, motivo: "comentários não são permitidos" };
  }

  const semPontoFinal = semStrings.trim().replace(/;\s*$/, "");
  if (semPontoFinal.includes(";")) {
    return { valida: false, motivo: "mais de uma instrução" };
  }

  if (!/^(select|with)\b/i.test(semPontoFinal)) {
    return { valida: false, motivo: "a consulta deve começar com SELECT ou WITH" };
  }

  const proibida = semPontoFinal.match(RE_PROIBIDAS);
  if (proibida) {
    return {
      valida: false,
      motivo: `palavra-chave não permitida: ${proibida[1].toUpperCase()}`,
    };
  }

  return { valida: true };
}
