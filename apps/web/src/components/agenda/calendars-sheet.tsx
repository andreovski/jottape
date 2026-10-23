import { Link } from '@tanstack/react-router';

import { CheckCircle } from '@/components/ios/controls';
import { Row, Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import {
  alsoInLabel,
  calendarsBody,
  linkSourceName,
  useGoogleStatus,
  useUpdateGoogleCalendars,
} from '@/features/google';

import { LOCAL_COLOR } from './calendars';

/**
 * Folha "Calendários" da Agenda, como a do Calendário do iPhone: liga e desliga o que aparece, de
 * todas as contas Google. Desligar também para de sincronizar aquele calendário (os eventos ficam
 * guardados e voltam ao ligar).
 */
export function CalendarsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const status = useGoogleStatus().data;
  const update = useUpdateGoogleCalendars();
  // Uma seção por conta; as agendas por link ficam juntas numa só.
  const accounts = status?.accounts ?? [];
  const links = accounts.filter((a) => a.provider === 'ICS').map((a) => a.id);
  const groups = [
    ...accounts
      .filter((a) => a.provider !== 'ICS')
      .map((a) => ({ key: a.id, header: a.email, accountIds: [a.id] })),
    ...(links.length ? [{ key: 'ics', header: 'Agendas por link', accountIds: links }] : []),
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title='Calendários' cancelLabel='OK'>
      <Section footer='Os eventos criados só no Jottape aparecem sempre.'>
        <Row
          leading={<CheckCircle checked color={LOCAL_COLOR} label='Jottape' onChange={() => {}} />}
          title='Jottape'
        />
      </Section>

      {groups.map((group) => (
        <Section key={group.key} header={group.header}>
          {status!.calendars
            .filter((calendar) => group.accountIds.includes(calendar.accountId))
            .map((calendar) => {
              const toggle = () =>
                update.mutate(
                  calendarsBody(status!, { selected: { id: calendar.id, on: !calendar.selected } })
                );
              return (
                <Row
                  key={calendar.id}
                  leading={
                    <CheckCircle
                      checked={calendar.selected}
                      color={calendar.color ?? 'var(--blue)'}
                      label={calendar.name}
                      onChange={toggle}
                    />
                  }
                  title={calendar.name}
                  subtitle={
                    calendar.readOnly
                      ? linkSourceName(
                          status!.accounts.find((a) => a.id === calendar.accountId)?.email ?? ''
                        )
                      : alsoInLabel(status!, calendar)
                  }
                />
              );
            })}
        </Section>
      ))}

      <Section>
        <Link to='/ajustes/google' className='block' onClick={() => onOpenChange(false)}>
          <Row
            action
            chevron
            title={status?.connected ? 'Contas e agendas' : 'Conectar uma agenda'}
          />
        </Link>
      </Section>
    </Sheet>
  );
}
