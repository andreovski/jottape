import { useState } from 'react';

import { Button } from '@/components/ios/controls';
import { FieldRow, TextInput } from '@/components/ios/fields';
import { useLogin } from '@/features/auth';
import { startGoogle } from '@/features/google';
import { errorMessage } from '@/lib/api';

const GOOGLE_ERRORS: Record<string, string> = {
  google: 'Não deu para entrar com o Google. Tente de novo.',
  conta: 'Esta conta Google não é a do dono do Jottape.',
};

export function LoginPage() {
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(() => {
    const code = new URLSearchParams(window.location.search).get('erro');
    return code ? (GOOGLE_ERRORS[code] ?? GOOGLE_ERRORS.google) : null;
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email, password });
      if (window.location.pathname === '/entrar') window.history.replaceState(null, '', '/');
    } catch (err) {
      setError(await errorMessage(err));
    }
  }

  return (
    <div
      className='bg-background pt-safe flex min-h-dvh flex-col items-center justify-center px-5'
      style={{ '--tint': 'var(--indigo)' } as React.CSSProperties}
    >
      <form onSubmit={submit} className='w-full max-w-sm'>
        <div className='mb-8 flex flex-col items-center text-center'>
          <img
            src='/icons/icon-512.png'
            alt=''
            className='mb-5 size-[88px] rounded-[22px] shadow-[0_10px_30px_rgb(0_0_0/0.18)]'
          />
          <h1 className='text-large-title'>Jottape</h1>
          <p className='text-subhead text-label-2 mt-1'>Sua agenda, suas tarefas e seu dinheiro.</p>
        </div>

        <div className='bg-surface overflow-hidden rounded-[var(--radius)]'>
          <FieldRow>
            <TextInput
              type='email'
              autoComplete='username'
              placeholder='E-mail'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </FieldRow>
          <FieldRow>
            <TextInput
              type='password'
              autoComplete='current-password'
              placeholder='Senha'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </FieldRow>
        </div>

        <p role='alert' className='text-footnote text-red min-h-9 px-4 pt-2'>
          {error}
        </p>

        <Button type='submit' className='w-full' loading={login.isPending}>
          Entrar
        </Button>

        <div className='text-footnote text-label-2 my-5 flex items-center gap-3'>
          <span className='bg-separator h-px flex-1' />
          ou
          <span className='bg-separator h-px flex-1' />
        </div>

        <button
          type='button'
          onClick={() => startGoogle('login')}
          className='bg-surface text-body flex h-[50px] w-full items-center justify-center gap-3 rounded-[14px] font-semibold active:opacity-70'
        >
          <svg viewBox='0 0 24 24' className='size-5' aria-hidden>
            <path
              fill='#4285F4'
              d='M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z'
            />
            <path
              fill='#34A853'
              d='M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z'
            />
            <path
              fill='#FBBC05'
              d='M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z'
            />
            <path
              fill='#EA4335'
              d='M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z'
            />
          </svg>
          Continuar com Google
        </button>
      </form>
    </div>
  );
}
