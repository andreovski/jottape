import {
  type AssistantBenchmarkCase,
  type AssistantBenchmarkResponse,
  assistantTestCaseSchema,
  type CiBenchmarkRunBody,
} from '@jottape/schemas';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import { getAnthropicConfig } from '@/lib/env';
import { HAIKU_INPUT, HAIKU_OUTPUT, JEV_INPUT } from '@/services/assistant';
import {
  type BenchmarkUsage,
  caseKey,
  costOf,
  plannedFrom,
  runCases,
  summarize,
} from '@/services/assistant/benchmark';

// Teste de acerto na CI (job "Teste de acerto do Jotta"). Dois comandos:
//
//   fetch-cases <saída>                 casos reais da produção (BENCH_API_URL + BENCH_TOKEN)
//   run <casos> <saída> [<base.json>]   roda os 50 exemplos e os casos; com a base, compara
//
// Com a base, caso que passava nela e falhou aqui roda de novo uma vez (o Haiku varia); se falhar
// de novo, é regressão e o comando sai com 1. A rodada do PR vai para o histórico do painel.

const prices = { haikuInput: HAIKU_INPUT, haikuOutput: HAIKU_OUTPUT, jevInput: JEV_INPUT };

interface Output {
  result: AssistantBenchmarkResponse;
  usage: BenchmarkUsage;
  regressions: string[];
}

const api = () => {
  const url = process.env.BENCH_API_URL?.replace(/\/$/, '');
  const token = process.env.BENCH_TOKEN;
  return url && token ? { url, headers: { authorization: `Bearer ${token}` } } : null;
};

const casesFile = z.object({ testCases: z.array(assistantTestCaseSchema) });

async function fetchCases(out: string) {
  const target = api();
  let testCases: unknown[] = [];
  if (!target) {
    console.warn('Sem BENCH_API_URL e BENCH_TOKEN: só os 50 exemplos.');
  } else {
    const response = await fetch(`${target.url}/ci/assistant/cases`, { headers: target.headers });
    if (response.ok) {
      testCases = casesFile.parse(await response.json()).testCases;
    } else {
      console.warn(`Casos reais indisponíveis (${response.status}): só os 50 exemplos.`);
    }
  }
  writeFileSync(out, JSON.stringify({ testCases }, null, 2));
  console.log(`${testCases.length} casos reais.`);
}

const pct = (passed: number, total: number) =>
  total ? `${Math.round((passed / total) * 100)}%` : '—';

function summary(output: Output, base: Output | null) {
  const { result, regressions } = output;
  const lines = [
    '## Teste de acerto do Jotta',
    '',
    `| | Acertos | Salvaria errado |`,
    `|---|---|---|`,
    ...(base
      ? [
          `| Base | ${base.result.passed} de ${base.result.total} (${pct(base.result.passed, base.result.total)}) | ${base.result.autoSavedWrong} |`,
        ]
      : []),
    `| Este PR | ${result.passed} de ${result.total} (${pct(result.passed, result.total)}) | ${result.autoSavedWrong} |`,
    '',
    `Custo desta rodada: US$ ${(result.costMicros / 1_000_000).toFixed(4).replace('.', ',')}.`,
  ];
  const byKey = new Map(result.cases.map((c) => [caseKey(c), c]));
  if (regressions.length) {
    lines.push('', `### Quebraram (${regressions.length})`, '');
    for (const key of regressions) {
      const c = byKey.get(key)!;
      lines.push(`- “${c.text}”: esperado ${c.expected}; veio ${c.got}`);
    }
  }
  if (base) {
    const fixed = result.cases.filter((c) => {
      const before = base.result.cases.find((b) => caseKey(b) === caseKey(c));
      return c.passed && before && !before.passed;
    });
    if (fixed.length) {
      lines.push('', `### Passaram a acertar (${fixed.length})`, '');
      for (const c of fixed) lines.push(`- “${c.text}”`);
    }
  }
  return lines.join('\n');
}

async function run(casesPath: string, out: string, basePath?: string) {
  if (!getAnthropicConfig()) throw new Error('Sem ANTHROPIC_API_KEY.');
  const { testCases } = casesFile.parse(JSON.parse(readFileSync(casesPath, 'utf8')));
  const planned = plannedFrom(testCases);
  const first = await runCases(planned);
  const usage = { ...first.usage };
  let cases: AssistantBenchmarkCase[] = first.cases;
  let ms = first.ms;

  const base: Output | null = basePath ? JSON.parse(readFileSync(basePath, 'utf8')) : null;
  const regressions: string[] = [];
  if (base) {
    const passedBefore = new Set(base.result.cases.filter((c) => c.passed).map(caseKey));
    const suspects = planned.filter((p, i) => !cases[i].passed && passedBefore.has(caseKey(p)));
    if (suspects.length) {
      const again = await runCases(suspects);
      usage.modelInput += again.usage.modelInput;
      usage.modelOutput += again.usage.modelOutput;
      usage.jevInput += again.usage.jevInput;
      ms += again.ms;
      const retried = new Map(again.cases.map((c) => [caseKey(c), c]));
      cases = cases.map((c) => retried.get(caseKey(c)) ?? c);
      for (const c of again.cases) if (!c.passed) regressions.push(caseKey(c));
    }
  }

  const output: Output = {
    result: summarize(cases, ms, costOf(usage, prices)),
    usage,
    regressions,
  };
  writeFileSync(out, JSON.stringify(output, null, 2));
  const text = summary(output, base);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);

  // A rodada do PR (com a base) vai para o histórico do painel; falhar aqui não quebra o job.
  const target = api();
  if (base && target && process.env.BENCH_COMMIT) {
    const body: CiBenchmarkRunBody = {
      commit: process.env.BENCH_COMMIT,
      label: process.env.BENCH_LABEL?.slice(0, 200) || null,
      regressions: regressions.length,
      result: output.result,
      usage,
    };
    const response = await fetch(`${target.url}/ci/assistant/runs`, {
      method: 'POST',
      headers: { ...target.headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((error: unknown) => error);
    if (!(response instanceof Response) || !response.ok) {
      console.warn('Não consegui guardar a rodada no painel.');
    }
  }
  if (regressions.length) process.exitCode = 1;
}

const [command, ...args] = process.argv.slice(2);
(async () => {
  if (command === 'fetch-cases' && args[0]) return fetchCases(args[0]);
  if (command === 'run' && args[0] && args[1]) return run(args[0], args[1], args[2]);
  throw new Error('Uso: fetch-cases <saída> | run <casos> <saída> [<base.json>]');
})()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(2);
  });
