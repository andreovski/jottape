import { useNavigate } from '@tanstack/react-router';
import { Bell, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ios/controls';
import { Sheet } from '@/components/ios/sheet';
import {
  dismissInviteForever,
  shouldInvite,
  snoozeInvite,
  useInstallPrompt,
} from '@/features/install';

/**
 * Convite da tela Hoje para quem usa o Jottape no navegador do celular: o app instalado abre em tela
 * cheia e é o único jeito de receber notificações. O navegador não instala sozinho, então o botão
 * leva ao passo a passo (no Android com suporte, abre direto o diálogo de instalação).
 */
export function InstallInvite() {
  const navigate = useNavigate();
  const native = useInstallPrompt();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!shouldInvite()) return;
    // Deixa a tela Hoje aparecer antes: o convite sobe logo depois, não junto com o carregamento.
    const timer = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  function close(open: boolean) {
    setOpen(open);
    if (!open) snoozeInvite();
  }

  async function accept() {
    if (native.available) {
      setOpen(false);
      if (await native.install()) return;
      snoozeInvite();
      return;
    }
    setOpen(false);
    snoozeInvite();
    navigate({ to: '/ajustes/instalar' });
  }

  return (
    <Sheet open={open} onOpenChange={close} title='Instalar o app' cancelLabel='Fechar'>
      <div className='flex flex-col items-center pt-2 text-center'>
        <div className='bg-tint/15 text-tint mb-4 flex size-16 items-center justify-center rounded-[18px]'>
          <Smartphone className='size-8' />
        </div>
        <h2 className='text-title3 font-semibold'>Leve o Jottape na Tela de Início</h2>
        <p className='text-subhead text-label-2 mt-2 max-w-xs'>
          Instalado, o app abre em tela cheia, sem a barra do navegador, e passa a avisar de
          compromissos e tarefas.
        </p>
        <div className='text-footnote text-label-2 mt-4 flex items-center gap-1.5'>
          <Bell className='size-4' />
          Notificações só funcionam no app instalado
        </div>
        <Button className='mt-6 w-full' onClick={accept}>
          {native.available ? 'Instalar agora' : 'Ver como instalar'}
        </Button>
        <Button
          variant='plain'
          size='md'
          className='mt-1 w-full'
          onClick={() => {
            dismissInviteForever();
            setOpen(false);
          }}
        >
          Não mostrar mais
        </Button>
      </div>
    </Sheet>
  );
}
