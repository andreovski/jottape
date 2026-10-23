import {
  addDays,
  addMonthsClamped,
  dateStringInZone,
  diffInDays,
  invoiceCycleForMonth,
  referenceMonthForDue,
} from '@jottape/finance-engine';

import type { PluggyBill, PluggyTransaction } from './client';

// Regras puras da importação: como um lançamento da Pluggy vira movimento, com qual lançamento do
// Jottape ele casa e que categoria sugerir. Sem banco de dados, com teste (movements.spec.ts).

export type MovementKind = 'INCOME' | 'EXPENSE';

export interface ParsedMovement {
  externalId: string;
  kind: MovementKind;
  amountCents: number;
  date: string;
  description: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  /** Pagamento da fatura visto pelo cartão: não é receita, a fatura já é paga pela conta. */
  isCardPayment: boolean;
  /** A fatura do cartão em que o banco pôs o lançamento (só depois que ela fecha). */
  billId: string | null;
  /** Parcela 2 em diante datada pela fatura (não pela compra): a data cai no mês do vencimento. */
  datedByBill: boolean;
}

/** Dias de folga entre a data do banco e a do lançamento feito à mão. */
export const MATCH_WINDOW_DAYS = 4;
/** Parcela 2 em diante: o banco pode datar pela compra ou pela fatura. */
const INSTALLMENT_WINDOW_DAYS = 45;

const CARD_PAYMENT = /\b(pagamento|pagto|pgto)\b/;

/**
 * Lê um lançamento da Pluggy. Na conta, o PENDING é agendamento futuro e fica de fora (volta
 * quando for POSTED); no cartão, PENDING é compra ainda na fatura aberta e entra.
 */
export function parseMovement(
  tx: PluggyTransaction,
  accountType: 'BANK' | 'CREDIT',
  timeZone: string
): ParsedMovement | null {
  if (accountType === 'BANK' && tx.status === 'PENDING') return null;
  const amount = tx.amountInAccountCurrency ?? tx.amount;
  const amountCents = Math.abs(Math.round(amount * 100));
  if (amountCents === 0) return null;

  const kind: MovementKind =
    (tx.type ?? (amount < 0 ? 'DEBIT' : 'CREDIT')) === 'DEBIT' ? 'EXPENSE' : 'INCOME';
  const meta = tx.creditCardMetadata;
  const installmentTotal =
    meta?.totalInstallments && meta.totalInstallments > 1 ? meta.totalInstallments : null;
  const installmentNumber = installmentTotal ? (meta?.installmentNumber ?? null) : null;

  let date = dateStringInZone(new Date(tx.date), timeZone);
  // Alguns bancos datam todas as parcelas pela compra: a parcela N cai N-1 meses depois, senão
  // todas iriam para a mesma fatura. Os outros datam pela fatura, no mês do vencimento.
  let datedByBill = false;
  if (installmentNumber && installmentNumber > 1) {
    const purchase = meta?.purchaseDate
      ? dateStringInZone(new Date(meta.purchaseDate), timeZone)
      : null;
    if (purchase && Math.abs(diffInDays(purchase, date)) <= 20) {
      date = addMonthsClamped(purchase, installmentNumber - 1);
    } else {
      datedByBill = accountType === 'CREDIT';
    }
  }

  const description = (tx.description || tx.descriptionRaw || 'Lançamento do banco')
    .trim()
    .slice(0, 120);
  return {
    externalId: tx.id,
    kind,
    amountCents,
    date,
    description,
    installmentNumber,
    installmentTotal,
    isCardPayment:
      accountType === 'CREDIT' && kind === 'INCOME' && CARD_PAYMENT.test(plain(description)),
    billId: accountType === 'CREDIT' ? (meta?.billId ?? null) : null,
    datedByBill,
  };
}

export interface MatchCandidate {
  id: string;
  kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  amountCents: number;
  date: string;
  accountId: string;
  toAccountId: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
}

/** O lançamento do Jottape movimenta a conta no mesmo sentido do movimento do banco? */
function sameDirection(movement: ParsedMovement, tx: MatchCandidate, accountId: string) {
  if (movement.kind === 'EXPENSE') {
    return tx.accountId === accountId && (tx.kind === 'EXPENSE' || tx.kind === 'TRANSFER');
  }
  if (tx.kind === 'TRANSFER') return tx.toAccountId === accountId;
  return tx.kind === 'INCOME' && tx.accountId === accountId;
}

/**
 * O lançamento do Jottape que já é este movimento: mesmo sentido e valor, data perto (parcela:
 * mesmo número de parcela, com mais folga). `taken` são os já casados com outro movimento desta
 * conta. O mais próximo na data ganha.
 */
export function findMatch(
  movement: ParsedMovement,
  accountId: string,
  candidates: MatchCandidate[],
  taken: Set<string>
): MatchCandidate | null {
  let best: { tx: MatchCandidate; distance: number } | null = null;
  for (const tx of candidates) {
    if (taken.has(tx.id) || !sameDirection(movement, tx, accountId)) continue;
    const distance = Math.abs(diffInDays(movement.date, tx.date));
    let ok: boolean;
    if (movement.installmentTotal && tx.installmentTotal) {
      // Parcelas: o Jottape divide o total com o resto na primeira, então o valor pode diferir
      // em alguns centavos.
      ok =
        tx.installmentNumber === movement.installmentNumber &&
        tx.installmentTotal === movement.installmentTotal &&
        Math.abs(tx.amountCents - movement.amountCents) <= movement.installmentTotal &&
        distance <= INSTALLMENT_WINDOW_DAYS;
    } else {
      ok = tx.amountCents === movement.amountCents && distance <= MATCH_WINDOW_DAYS;
    }
    if (ok && (!best || distance < best.distance)) best = { tx, distance };
  }
  return best?.tx ?? null;
}

/** Datas em que procurar candidatos para um conjunto de movimentos. */
export function candidateRange(movements: ParsedMovement[]): { from: string; to: string } | null {
  if (movements.length === 0) return null;
  const dates = movements.map((m) => m.date).sort();
  const longest = movements.some((m) => m.installmentTotal)
    ? INSTALLMENT_WINDOW_DAYS
    : MATCH_WINDOW_DAYS;
  return { from: addDays(dates[0]!, -longest), to: addDays(dates.at(-1)!, longest) };
}

function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const NAME_PARTICLES = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);

/** "JOSIANE CRISTINA DA SILVA" → "Josiane Cristina da Silva"; documento ou número, null. */
function personName(text: string): string | null {
  if (/[•*]|\d{3}/.test(text)) return null;
  const words = text
    .replace(/[^\p{L}\s'&.]/gu, ' ')
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word));
  const name = words
    .map((word, i) => {
      const lower = word.toLocaleLowerCase('pt-BR');
      if (i > 0 && NAME_PARTICLES.has(plain(lower))) return lower;
      return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
    })
    .join(' ');
  return name.replace(/[\s.]/g, '').length >= 2 ? name : null;
}

/**
 * Título do lançamento do banco. Muitos vêm como "o que foi|para quem|documento|banco"
 * ("Transferência enviada pelo Pix|JOSIANE CRISTINA|•••.123.456-••|NU PAGAMENTOS - IP"): o título
 * é o nome depois do "|" (a pessoa ou o estabelecimento). Sem "|", fica como veio. O texto
 * original vai nas notas do lançamento.
 */
export function shortDescription(raw: string): string {
  const text = raw.trim();
  const [, ...rest] = text.split(/\s*\|\s*/);
  const name = rest.map(personName).find(Boolean);
  return name ? name.slice(0, 120) : text;
}

/** Descrição comparável: sem acento, número e pontuação, só as três primeiras palavras. */
export function normalize(description: string): string {
  return plain(description)
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .slice(0, 3)
    .join(' ');
}

/** Texto inteiro comparável (para as notas, que guardam o texto do banco como veio). */
function noteKey(text: string): string {
  return plain(text).replace(/\s+/g, ' ').trim();
}

/** O que o histórico ensina: a categoria por descrição e por nota, a mais recente de cada. */
export interface CategoryMemory {
  byDescription: Map<string, string>;
  byNote: Map<string, string>;
}

/**
 * Categoria aprendida do histórico: a do lançamento mais recente com o mesmo tipo e a mesma
 * descrição ou a mesma nota (desde a importação com título curto, a nota traz o texto do banco).
 * `history` vem do mais novo para o mais antigo.
 */
export function categoryMemory(
  history: { description: string; notes?: string | null; kind: string; categoryId: string | null }[]
): CategoryMemory {
  const memory: CategoryMemory = { byDescription: new Map(), byNote: new Map() };
  for (const tx of history) {
    if (!tx.categoryId || tx.kind === 'TRANSFER') continue;
    const key = `${tx.kind}:${normalize(tx.description)}`;
    if (!memory.byDescription.has(key)) memory.byDescription.set(key, tx.categoryId);
    const note = tx.notes ? noteKey(tx.notes) : '';
    if (note && !memory.byNote.has(`${tx.kind}:${note}`)) {
      memory.byNote.set(`${tx.kind}:${note}`, tx.categoryId);
    }
  }
  return memory;
}

/**
 * Categoria sugerida para um lançamento do banco (`description` é o texto como veio). Primeiro a
 * descrição igual; depois a nota igual ao texto do banco (o título pode ter sido trocado ao
 * lançar); por fim uma descrição que comece pela outra ("Rendimento" e "Rendimento da conta"), a
 * mais recente. Nome curto demais (como "Pix") não vale para o último caso: casaria com tudo.
 */
export function suggestCategory(
  memory: CategoryMemory,
  movement: Pick<ParsedMovement, 'kind' | 'description'>
): string | null {
  const key = normalize(shortDescription(movement.description));
  const prefix = `${movement.kind}:`;
  const exact = key ? memory.byDescription.get(prefix + key) : undefined;
  if (exact) return exact;
  const byNote = memory.byNote.get(prefix + noteKey(movement.description));
  if (byNote) return byNote;
  if (!key) return null;
  for (const [entry, categoryId] of memory.byDescription) {
    if (!entry.startsWith(prefix)) continue;
    const other = entry.slice(prefix.length);
    const [shorter, longer] = other.length < key.length ? [other, key] : [key, other];
    if (shorter.length >= 5 && longer.startsWith(`${shorter} `)) return categoryId;
  }
  return null;
}

// ---------------------------------------------------------------- categoria fixa e IA

export type TransferKey = 'TRANSFER' | 'TRANSFER_PIX' | 'TRANSFER_DEBIT' | 'TRANSFER_CREDIT';

/** As categorias fixas do usuário, por `${tipo}:${chave}`. */
export type SystemCategoryIds = Map<string, string>;

/**
 * A regra fixa, quando nem o histórico nem a IA decidem: a forma de pagamento. Pix vai para
 * Transferência › Pix; compra no débito, Débito; compra no cartão, Crédito; TED, DOC e outras
 * transferências, a própria Transferência. O resto fica sem categoria.
 */
export function ruleCategory(
  movement: Pick<ParsedMovement, 'kind' | 'description'>,
  accountType: 'BANK' | 'CREDIT',
  ids: SystemCategoryIds
): string | null {
  const text = plain(movement.description);
  let key: TransferKey | null = null;
  if (/\bpix\b/.test(text)) key = 'TRANSFER_PIX';
  else if (/\b(debito|deb)\b/.test(text)) key = 'TRANSFER_DEBIT';
  // No cartão, só a compra: estorno e crédito na fatura não são forma de pagamento.
  else if (accountType === 'CREDIT') key = movement.kind === 'EXPENSE' ? 'TRANSFER_CREDIT' : null;
  else if (/\b(ted|doc|transferencia|transf)\b/.test(text)) key = 'TRANSFER';
  return key ? (ids.get(`${movement.kind}:${key}`) ?? null) : null;
}

/** Abaixo disso o Jev não convence: vale a regra fixa. */
export const AI_MIN_CONFIDENCE = 0.6;

/**
 * A sugestão da IA: o Haiku escolhe pelo nome e o Jev dá a probabilidade de cada categoria. Só
 * vale quando a mais provável do Jev passa do mínimo e é a mesma do Haiku; sem o Jev, discordando
 * ou com pouca confiança, null (fica a regra fixa).
 */
export function decideAiCategory(
  haiku: string | null,
  jev: Map<string, number> | null
): { categoryId: string; confidence: number } | null {
  if (!haiku || !jev) return null;
  let best: { categoryId: string; confidence: number } | null = null;
  for (const [categoryId, confidence] of jev) {
    if (!best || confidence > best.confidence) best = { categoryId, confidence };
  }
  if (!best || best.categoryId !== haiku || best.confidence < AI_MIN_CONFIDENCE) return null;
  return best;
}

/** Descrição do lançamento importado: a parcela vai no fim, como "Loja (2/10)". */
export function importedDescription(movement: {
  description: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
}): string {
  const title = shortDescription(movement.description);
  if (!movement.installmentTotal || !movement.installmentNumber) return title;
  const suffix = ` (${movement.installmentNumber}/${movement.installmentTotal})`;
  return title.slice(0, 120 - suffix.length) + suffix;
}

// ---------------------------------------------------------------- faturas do cartão

export interface BillDates {
  dueDate: string;
  closingDate: string | null;
}

/** As datas de uma fatura da Pluggy no fuso do usuário. */
export function billDates(bill: PluggyBill, timeZone: string): BillDates {
  return {
    dueDate: dateStringInZone(new Date(bill.dueDate), timeZone),
    closingDate: bill.billClosingDate
      ? dateStringInZone(new Date(bill.billClosingDate), timeZone)
      : null,
  };
}

/**
 * Em que fatura o banco pôs o movimento do cartão: a do `billId`, quando ela já fechou; na parcela
 * datada pela fatura, a que vence no mês da data. Sem nenhum dos dois, vale a data (null).
 */
export function movementBill(
  movement: Pick<ParsedMovement, 'billId' | 'datedByBill' | 'date'>,
  bills: Map<string, BillDates>,
  card: { closingDay: number | null; dueDay: number | null }
): BillDates | null {
  const bill = movement.billId ? bills.get(movement.billId) : undefined;
  if (bill) return bill;
  if (!movement.datedByBill || !card.closingDay || !card.dueDay) return null;
  const month = referenceMonthForDue(movement.date, card.closingDay, card.dueDay);
  return {
    dueDate: invoiceCycleForMonth(month, card.closingDay, card.dueDay).dueDate,
    closingDate: null,
  };
}

/** A fatura foi paga inteira, segundo o banco? Devolve quanto e quando (o último pagamento). */
export function billPayment(
  bill: PluggyBill,
  timeZone: string
): { amountCents: number; date: string } | null {
  const totalCents = Math.round(bill.totalAmount * 100);
  const payments = (bill.payments ?? []).filter((p) => p.paymentDate && p.amount > 0);
  const paidCents = payments.reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
  if (totalCents <= 0 || paidCents < totalCents) return null;
  const last = payments
    .map((p) => p.paymentDate!)
    .sort()
    .at(-1)!;
  return { amountCents: paidCents, date: dateStringInZone(new Date(last), timeZone) };
}

const INVOICE_PAYMENT =
  /\b(fatura|fat)\b|\bcart(ao|oes)\b.*\b(pag|pagamento|pagto|pgto)\b|\b(pag|pagamento|pagto|pgto)\b.*\bcart(ao|oes)\b/;

/** Débito na conta com cara de pagamento de fatura ("Pagamento de fatura", "PGTO FAT CARTAO"). */
export function looksLikeInvoicePayment(description: string): boolean {
  return INVOICE_PAYMENT.test(plain(description));
}

/** Boleto pago na conta: a fatura de outro banco costuma ser paga assim. */
export function looksLikeBoleto(description: string): boolean {
  return /\bboleto\b/.test(plain(description));
}

/** A fatura que um pagamento do dia `date` paga: a de vencimento mais perto, de 10 dias antes a 20 depois. */
export function invoiceForPayment<T extends { dueDate: string }>(
  date: string,
  invoices: T[]
): T | null {
  let best: { invoice: T; distance: number } | null = null;
  for (const invoice of invoices) {
    const days = diffInDays(date, invoice.dueDate);
    if (days < -10 || days > 20) continue;
    const distance = Math.abs(days);
    if (!best || distance < best.distance) best = { invoice, distance };
  }
  return best?.invoice ?? null;
}
