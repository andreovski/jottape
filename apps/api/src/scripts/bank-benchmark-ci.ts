import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import { getAnthropicConfig, getJevConfig } from '@/lib/env';
import {
  BANK_BENCH_CASES,
  type BankBenchRun,
  caseKey,
  runBankBenchmark,
} from '@/services/bank/benchmark';

// Teste de acerto da categoria do banco (job "Teste de acerto da categoria do banco"):
//
//   run <saída> [<base.json>]   roda os casos pelo Haiku e pelo Jev; com a base, compara
//
// Como no teste do Jotta: caso que passava na base e falhou aqui roda de novo uma vez (a IA
// varia); se falhar de novo, é regressão e o comando sai com 1.

interface Output extends BankBenchRun {
  regressions: string[];
}

const usd = (micros: number) => `US$ ${(micros / 1_000_000).toFixed(4).replace('.', ',')}`;

function line(name: string, run: BankBenchRun) {
  const total = run.cases.length;
  const passed = run.cases.filter((c) => c.passed).length;
  const wrong = run.cases.filter((c) => c.wrong).length;
  const blank = run.cases.filter((c) => !c.passed && !c.wrong).length;
  return `| ${name} | ${passed} de ${total} (${Math.round((passed / total) * 100)}%) | ${wrong} | ${blank} |`;
}

function summary(output: Output, base: Output | null) {
  const lines = [
    '## Teste de acerto da categoria do banco',
    '',
    '| | Acertos | Sugeriu errado | Em branco |',
    '|---|---|---|---|',
    ...(base ? [line('Base', base)] : []),
    line('Este PR', output),
    '',
    `Haiku: ${output.usage.modelInput.toLocaleString('pt-BR')} tokens de entrada e ${output.usage.modelOutput.toLocaleString('pt-BR')} de saída. Jev: ${output.usage.jevInput.toLocaleString('pt-BR')} tokens. Custo desta rodada: ${usd(output.usage.costMicros)}.`,
  ];
  const misses = output.cases.filter((c) => !c.passed);
  if (misses.length) {
    lines.push('', `### Erros (${misses.length})`, '');
    for (const c of misses) {
      const regression = output.regressions.includes(c.key) ? ' **(quebrou)**' : '';
      lines.push(
        `- “${c.text}”: esperado ${c.expected ?? 'em branco'}; veio ${c.got ?? 'em branco'}${regression}`
      );
    }
  }
  return lines.join('\n');
}

async function run(out: string, basePath?: string) {
  if (!getAnthropicConfig() || !getJevConfig())
    throw new Error('Sem ANTHROPIC_API_KEY ou JEV_API_KEY.');
  const first = await runBankBenchmark(BANK_BENCH_CASES);
  let cases = first.cases;
  const usage = { ...first.usage };
  let ms = first.ms;

  const base: Output | null = basePath ? JSON.parse(readFileSync(basePath, 'utf8')) : null;
  const regressions: string[] = [];
  if (base) {
    const passedBefore = new Set(base.cases.filter((c) => c.passed).map((c) => c.key));
    const suspects = BANK_BENCH_CASES.filter(
      (c, i) => !cases[i]!.passed && passedBefore.has(caseKey(c))
    );
    if (suspects.length) {
      const again = await runBankBenchmark(suspects);
      usage.modelInput += again.usage.modelInput;
      usage.modelOutput += again.usage.modelOutput;
      usage.jevInput += again.usage.jevInput;
      usage.costMicros += again.usage.costMicros;
      ms += again.ms;
      const retried = new Map(again.cases.map((c) => [c.key, c]));
      cases = cases.map((c) => retried.get(c.key) ?? c);
      for (const c of again.cases) if (!c.passed) regressions.push(c.key);
    }
  }

  const output: Output = { cases, usage, ms, regressions };
  writeFileSync(out, JSON.stringify(output, null, 2));
  const text = summary(output, base);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  if (regressions.length) process.exitCode = 1;
}

const [command, ...args] = process.argv.slice(2);
(async () => {
  if (command === 'run' && args[0]) return run(args[0], args[1]);
  throw new Error('Uso: run <saída> [<base.json>]');
})()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(2);
  });
