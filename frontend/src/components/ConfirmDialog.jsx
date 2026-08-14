import { useEffect, useRef } from 'react';

/**
 * Modal de confirmação usado no lugar do confirm() nativo.
 * Na prática é acionado pelo hook useConfirm (src/hooks/useConfirm.jsx).
 */
function ConfirmDialog({
  titulo,
  mensagem,
  detalhe,
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  perigo = false,
  onConfirmar,
  onCancelar
}) {
  const botaoConfirmar = useRef(null);

  useEffect(() => {
    botaoConfirmar.current?.focus();
    const aoTeclar = (e) => {
      if (e.key === 'Escape') onCancelar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onCancelar]);

  const cor = perigo ? 'var(--vermelho-texto)' : 'var(--laranja-maloca)';

  return (
    <div className="modal-overlay" onClick={onCancelar}>
      <div
        className="modal-content"
        role="alertdialog"
        aria-modal="true"
        style={{ maxWidth: 440, border: `2px solid ${cor}`, padding: '2rem' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ color: cor, fontSize: '1.4rem', marginBottom: '1rem' }}>
          {titulo || (perigo ? '⚠️ Confirmar exclusão' : 'Confirmar ação')}
        </h3>

        <p style={{
          textAlign: 'center', color: 'var(--text-primary)',
          fontSize: '1rem', lineHeight: 1.5, marginBottom: detalhe ? '0.6rem' : '1.8rem'
        }}>
          {mensagem}
        </p>

        {detalhe && (
          <p style={{
            textAlign: 'center', color: 'var(--text-secondary)',
            fontSize: '0.85rem', lineHeight: 1.5, marginBottom: '1.8rem'
          }}>
            {detalhe}
          </p>
        )}

        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            ref={botaoConfirmar}
            type="button"
            onClick={onConfirmar}
            className={perigo ? undefined : 'btn-primary'}
            style={perigo ? {
              flex: 1, background: 'var(--vermelho-erro)', color: 'var(--vermelho-texto)',
              border: '1px solid var(--vermelho-texto)', padding: '0.8rem 1rem',
              borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '1rem'
            } : { flex: 1 }}
          >
            {textoConfirmar}
          </button>
          <button
            type="button"
            onClick={onCancelar}
            className="btn-secondary"
            style={{ flex: 1 }}
          >
            {textoCancelar}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
