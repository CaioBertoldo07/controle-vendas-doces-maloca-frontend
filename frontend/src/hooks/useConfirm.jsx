import { useCallback, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

/**
 * Confirmação em modal, substituindo o confirm() nativo do navegador.
 *
 * Uso:
 *   const [confirmar, dialogoConfirmacao] = useConfirm();
 *   ...
 *   if (!await confirmar({ mensagem: 'Deletar?', perigo: true })) return;
 *   ...
 *   return (<div>... {dialogoConfirmacao}</div>);
 */
export function useConfirm() {
  // { opcoes, resolver } enquanto há uma confirmação aberta; null quando fechada
  const [pendente, setPendente] = useState(null);

  const confirmar = useCallback((opcoes) => {
    const normalizado = typeof opcoes === 'string' ? { mensagem: opcoes } : opcoes;
    return new Promise((resolve) => {
      setPendente({ opcoes: normalizado, resolver: resolve });
    });
  }, []);

  const responder = (resposta) => {
    pendente?.resolver(resposta);
    setPendente(null);
  };

  const dialogo = pendente ? (
    <ConfirmDialog
      {...pendente.opcoes}
      onConfirmar={() => responder(true)}
      onCancelar={() => responder(false)}
    />
  ) : null;

  return [confirmar, dialogo];
}

export default useConfirm;
