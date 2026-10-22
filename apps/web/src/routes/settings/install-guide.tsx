import { useNavigate } from '@tanstack/react-router';
import {
  Check,
  ChevronLeft,
  Download,
  EllipsisVertical,
  Share,
  Smartphone,
  SquarePlus,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ios/controls';
import { IconChip, Row, Section } from '@/components/ios/list';
import { Page } from '@/components/ios/page';
import { detectPlatform, type Platform, useInstallPrompt } from '@/features/install';
import { isStandalone } from '@/features/push';

interface Step {
  icon: ReactNode;
  color: string;
  title: string;
  subtitle?: string;
}

const STEPS: Record<Platform, Step[]> = {
  ios: [
    {
      icon: <Smartphone />,
      color: 'var(--blue)',
      title: 'Abra o Jottape no Safari ou no Chrome',
      subtitle: 'No iOS 16.4 ou mais novo, os dois instalam o app',
    },
    {
      icon: <Share />,
      color: 'var(--blue)',
      title: 'Toque em Compartilhar',
      subtitle: 'O ícone de quadrado com seta: na barra de baixo (Safari) ou ao lado do endereço (Chrome)',
    },
    {
      icon: <SquarePlus />,
      color: 'var(--gray)',
      title: 'Adicionar à Tela de Início',
      subtitle: 'Role a lista de ações até encontrar a opção',
    },
    {
      icon: <Download />,
      color: 'var(--green)',
      title: 'Toque em Adicionar',
      subtitle: 'Abra o Jottape pelo novo ícone na Tela de Início',
    },
  ],
  android: [
    { icon: <Smartphone />, color: 'var(--blue)', title: 'Abra o Jottape no Chrome' },
    {
      icon: <EllipsisVertical />,
      color: 'var(--gray)',
      title: 'Toque no menu ⋮',
      subtitle: 'Os três pontinhos, no canto superior direito',
    },
    {
      icon: <Download />,
      color: 'var(--green)',
      title: 'Instalar app',
      subtitle: 'Em alguns aparelhos aparece como "Adicionar à tela inicial"',
    },
    {
      icon: <SquarePlus />,
      color: 'var(--teal)',
      title: 'Confirme em Instalar',
      subtitle: 'O Jottape passa a aparecer na gaveta de apps',
    },
  ],
};

const PLATFORM_LABEL: Record<Platform, string> = {
  ios: 'iPhone (Safari ou Chrome)',
  android: 'Android (Chrome)',
};

export function InstallPage() {
  const navigate = useNavigate();
  const native = useInstallPrompt();
  const [installed, setInstalled] = useState(isStandalone());
  // Celular detectado: só a instrução dele. Computador/desconhecido: mostra as duas.
  const detected = detectPlatform();
  const platforms: Platform[] = detected ? [detected] : ['ios', 'android'];

  useEffect(() => {
    const onInstalled = () => setInstalled(true);
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);

  const back = (
    <button
      type='button'
      onClick={() => navigate({ to: '/ajustes' })}
      className='text-tint text-body -ml-2 flex items-center active:opacity-40'
    >
      <ChevronLeft className='size-7' strokeWidth={2.2} />
      Ajustes
    </button>
  );

  return (
    <Page title='Instalar o app' leading={back}>
      {installed ? (
        <Section footer='O Jottape já está instalado neste aparelho.'>
          <Row
            leading={
              <IconChip color='var(--green)'>
                <Check />
              </IconChip>
            }
            title='App instalado'
          />
        </Section>
      ) : (
        <>
          <p className='text-subhead text-label-2 -mt-2 mb-5'>
            No app instalado as notificações funcionam e o Jottape abre em tela cheia, como um app
            da loja.
          </p>
          {native.available && (
            <Button className='mb-7 w-full' onClick={() => void native.install()}>
              Instalar agora
            </Button>
          )}
          {platforms.map((platform) => (
            <Section key={platform} header={detected ? 'Passo a passo' : PLATFORM_LABEL[platform]}>
              {STEPS[platform].map((step, index) => (
                <Row
                  key={step.title}
                  leading={<IconChip color={step.color}>{step.icon}</IconChip>}
                  title={`${index + 1}. ${step.title}`}
                  subtitle={step.subtitle}
                  wrapSubtitle
                />
              ))}
            </Section>
          ))}
        </>
      )}
    </Page>
  );
}
