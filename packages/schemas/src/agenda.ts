import { z } from 'zod';

import type { EventOccurrence } from './events';
import type { TaskResponse } from './tasks';
import type { TransactionResponse } from './transactions';

export interface InvoiceDue {
  invoiceId: string;
  accountId: string;
  accountName: string;
  dueDate: string;
  totalCents: number;
}

/** Tudo o que cai num intervalo: o que a tela Hoje e a Agenda desenham. */
export interface AgendaResponse {
  events: EventOccurrence[];
  /** Tarefas abertas com prazo no intervalo (e as atrasadas, se o intervalo inclui hoje). */
  tasks: TaskResponse[];
  /** Lançamentos previstos com data no intervalo (contas a pagar e a receber). */
  bills: TransactionResponse[];
  /** Faturas de cartão em aberto que vencem no intervalo. */
  invoices: InvoiceDue[];
}

export const agendaQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});
