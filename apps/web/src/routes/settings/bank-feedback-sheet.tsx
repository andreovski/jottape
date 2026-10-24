import { useState } from 'react';
import { toast } from 'sonner';

import { FieldRow, TextArea } from '@/components/ios/fields';
import { Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import { useSendBankFeedback } from '@/features/bank';

/**
 * "Algo veio errado" do beta de Bancos. Vai com uma foto dos bancos e das contas (e do lançamento,
 * se veio da revisão); as chaves nunca vão.
 */
export function BankFeedbackSheet({
  open,
  movementId,
  nested,
  onClose,
}: {
  open: boolean;
  movementId?: string;
  nested?: boolean;
  onClose: () => void;
}) {
  const send = useSendBankFeedback();
  const [note, setNote] = useState('');

  async function submit() {
    if (!note.trim()) return;
    await send.mutateAsync({ note: note.trim(), ...(movementId ? { movementId } : {}) });
    toast.success('Valeu! O relato chegou.');
    setNote('');
    onClose();
  }

  return (
    <Sheet
      open={open}
      nested={nested}
      onOpenChange={(value) => !value && onClose()}
      title='Algo veio errado'
      confirmLabel='Enviar'
      confirmDisabled={!note.trim() || send.isPending}
      onConfirm={submit}
    >
      <Section
        footer={
          movementId
            ? 'Vai junto este lançamento e o estado dos seus bancos, sem as chaves.'
            : 'Vai junto o estado dos seus bancos e contas, sem as chaves.'
        }
      >
        <FieldRow>
          <TextArea
            rows={5}
            placeholder='Ex.: o mercado de ontem veio duplicado; o cartão do C6 não aparece.'
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
          />
        </FieldRow>
      </Section>
    </Sheet>
  );
}
