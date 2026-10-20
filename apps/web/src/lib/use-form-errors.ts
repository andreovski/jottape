import { useState } from 'react';

type ErrorMap = Record<string, string | false | null | undefined>;

/**
 * Validação ao enviar: o botão de salvar fica sempre habilitado e, se faltar algo, cada campo
 * mostra o próprio erro. Os erros só aparecem depois da primeira tentativa e somem sozinhos
 * conforme o campo é corrigido. A tela rola até o primeiro campo com erro, sem focá-lo (no iPhone
 * focar abriria o teclado), e os campos com erro dão um tremidinho.
 */
export function useFormErrors<E extends ErrorMap>(errors: E) {
  const [shown, setShown] = useState(false);
  const visible = {} as Record<keyof E, string | undefined>;
  for (const key of Object.keys(errors) as (keyof E)[]) {
    visible[key] = shown ? ((errors[key] || undefined) as string | undefined) : undefined;
  }

  /** `true` se está tudo certo; senão mostra os erros e devolve `false`. */
  function validate() {
    if (!Object.values(errors).some(Boolean)) return true;
    setShown(true);
    // Espera o React desenhar as mensagens para achar os campos.
    requestAnimationFrame(revealErrors);
    return false;
  }

  /** Esconde os erros de novo (ex.: ao trocar de modo no formulário). */
  const reset = () => setShown(false);

  return { errors: visible, validate, reset };
}

function revealErrors() {
  const fields = [...document.querySelectorAll<HTMLElement>('[data-field-error]')];
  fields[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  for (const field of fields) {
    field.classList.remove('field-shake');
    void field.offsetWidth; // reinicia a animação a cada tentativa
    field.classList.add('field-shake');
  }
}
