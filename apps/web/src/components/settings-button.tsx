import { useNavigate } from '@tanstack/react-router';
import { Settings } from 'lucide-react';

import { BarButton } from '@/components/ios/page';

/** Ajustes no topo das telas principais. No computador, Ajustes já fica na barra lateral. */
export function SettingsButton() {
  const navigate = useNavigate();
  return (
    <BarButton label='Ajustes' className='lg:hidden' onClick={() => navigate({ to: '/ajustes' })}>
      <Settings strokeWidth={2.2} />
    </BarButton>
  );
}
