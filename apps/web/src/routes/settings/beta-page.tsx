import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, Landmark, Sparkles } from 'lucide-react';

import { IconChip, Row, Section } from '@/components/ios/list';
import { Page } from '@/components/ios/page';

// Ajustes › Beta (só o dono): os dois betas, cada um com o próprio painel.

export function BetaPage() {
  const navigate = useNavigate();
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
    <Page title='Beta' leading={back}>
      <Section footer='Em cada um você convida quem testa, acompanha os números e lê os relatos.'>
        <Link to='/ajustes/assistente' className='block'>
          <Row
            chevron
            leading={
              <IconChip color='var(--indigo)'>
                <Sparkles />
              </IconChip>
            }
            title='Jotta'
            subtitle='Pedidos, custo e relatos'
          />
        </Link>
        <Link to='/ajustes/beta/bancos' className='block'>
          <Row
            chevron
            leading={
              <IconChip color='var(--green)'>
                <Landmark />
              </IconChip>
            }
            title='Bancos'
            subtitle='Configuração, conciliação e relatos'
          />
        </Link>
      </Section>
    </Page>
  );
}
