# Design do Jottape

O app segue a linguagem dos apps da Apple (Calendário, Lembretes, Wallet, Saúde, Ajustes), sem cara
de template: nada de cartões com borda cinza, sombras genéricas ou gradientes de "dashboard de IA".

## Princípios

- **Fundo agrupado**: `bg-background` é o cinza `#F2F2F7` do iOS (preto puro no escuro); o conteúdo
  fica em grupos brancos com cantos de 14 px (`Section`, `bg-surface`), sem borda.
- **Uma cor por seção**: Hoje índigo, Agenda vermelho, Tarefas laranja, Finanças verde, Ajustes azul.
  O `AppShell` põe a cor em `--tint`; use `text-tint`, `bg-tint`, `bg-tint/15` em vez de uma cor
  fixa. As cores do sistema existem como `text-red`, `bg-green`, `var(--blue)` etc., certas nas duas
  aparências.
- **Tipografia do iOS**: fonte do sistema (SF no Apple), tamanhos `text-large-title`, `text-title-1/2/3`,
  `text-headline`, `text-body` (17 px), `text-callout`, `text-subhead`, `text-footnote`,
  `text-caption`. Rótulos secundários em `text-label-2`, terciários em `text-label-3`. Exceção: o
  briefing (cartão e linha do tempo) usa Figtree, pela classe `font-briefing`, e o Jotta (aba do
  Assistente) usa `font-mono` (SF Mono) nos metadados: etiquetas FIN/AGD/TAR/ASK, horas, campos do
  recibo e custos do modo dev. O título "Jotta" usa `font-square` (Chakra Petch 700), passado
  pelo `titleClassName` da `Page`.
- **Números**: valores em `font-rounded numeric` (SF Rounded com algarismos tabulares), como Wallet e
  Saúde. Dinheiro sempre por `money()` de `@/lib/format`.
- **Separadores finos** de 0,5 px (`hairline-b`, `hairline-t`) que começam depois do ícone da linha.
- **Barras translúcidas** (`material`): barra de título que aparece ao rolar, abas embaixo.
- **Toque**: alvos de pelo menos 44 px, `active:opacity-*`/`active:bg-fill` no toque, sem hover
  pesado. Folhas sobem de baixo e fecham arrastando.

## Peças (`src/components/ios`)

| Peça                                                                                                                     | Para quê                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Page`                                                                                                                   | Título grande que vira barra compacta ao rolar; `eyebrow`, `actions` (use `BarButton`), `leading` (voltar), `accessory` (segmentos). |
| `Section`, `SectionTitle`                                                                                                | Grupo de linhas e título grande de grupo ("Minhas listas").                                                                          |
| `Row`, `IconChip`                                                                                                        | Linha com ícone colorido, título, subtítulo, valor cinza, chevron.                                                                   |
| `Segmented`, `Switch`, `CheckCircle`, `Button`, `Pill`, `Spinner`, `EmptyState`, `Skeleton`                              | Controles do iOS.                                                                                                                    |
| `Sheet`, `ActionSheet`                                                                                                   | Folha "Cancelar · Título · OK" e menu de ações com "Cancelar" separado.                                                              |
| `FieldRow`, `TextInput`, `TextArea`, `SelectInput`, `DateInput`, `TimeInput`, `AmountInput`, `MoneyField`, `ColorPicker` | Formulários em grupos, valor grande estilo Apple Cash, cores do sistema.                                                             |

## Dados e formatos

- Hooks do TanStack Query em `src/features/*` (um arquivo por domínio). Erros de mutação já viram
  toast no `query-client`; não repita.
- Datas: dias são `"AAAA-MM-DD"` (`dayKey`, `todayKey`, `startOfDay`, `relativeDay`, `longDay`);
  horários vêm em ISO e são mostrados no fuso do perfil (`time`, `timeRange`).
- Textos em português do Brasil, curtos, no tom dos apps da Apple ("Novo Lembrete", "Adicionar",
  "Nenhum evento").
