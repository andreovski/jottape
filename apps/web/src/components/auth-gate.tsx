import type { ReactNode } from 'react';

import { Spinner } from '@/components/ios/controls';
import { CurrentUserContext, useMe } from '@/features/auth';
import { setAppTimeZone } from '@/lib/format';
import { LoginPage } from '@/routes/login-page';

/** Sem sessão, o app inteiro é a tela de entrada (uso pessoal: não há páginas públicas). */
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useMe();

  if (me.isPending) {
    return (
      <div className='text-label-2 flex min-h-dvh items-center justify-center'>
        <Spinner />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className='flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center'>
        <p className='text-title-3'>Sem conexão</p>
        <p className='text-subhead text-label-2'>Não deu para falar com o servidor.</p>
        <button type='button' className='text-blue text-body' onClick={() => me.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!me.data) return <LoginPage />;

  setAppTimeZone(me.data.timezone);
  return <CurrentUserContext value={me.data}>{children}</CurrentUserContext>;
}
