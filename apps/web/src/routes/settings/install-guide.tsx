import { Download, EllipsisVertical, Share, Smartphone, SquarePlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { Button, Segmented } from '@/components/ios/controls';
import { IconChip, Row, Section } from '@/components/ios/list';
import { isStandalone } from '@/features/push';

type Platform = 'ios' | 'android';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOs ? 'ios' : /Android/i.test(ua) ? 'android' : 'ios';
}

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
      title: 'Abra o Jottape no Safari',
      subtitle: 'Outros navegadores no iPhone não instalam o app',
    },
    {
      icon: <Share />,
      color: 'var(--blue)',
      title: 'Toque em Compartilhar',
      subtitle: 'O ícone de quadrado com seta, na barra de baixo',
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

export function InstallGuide() {
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }

  return (
    <Section
      header='Instalar o app'
      footer='No app instalado as notificações funcionam e o Jottape abre em tela cheia, como um app da loja.'
    >
      <div className='px-4 py-3'>
        <Segmented<Platform>
          value={platform}
          onChange={setPlatform}
          options={[
            { value: 'ios', label: 'iPhone' },
            { value: 'android', label: 'Android' },
          ]}
        />
      </div>
      {platform === 'android' && prompt && (
        <div className='px-4 pb-3'>
          <Button className='w-full' onClick={install}>
            Instalar agora
          </Button>
        </div>
      )}
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
  );
}
