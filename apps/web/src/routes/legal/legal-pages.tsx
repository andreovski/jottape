import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';

// Páginas públicas exigidas pelo Google na tela de consentimento do OAuth. O texto descreve o que o
// código faz de fato (escopos em apps/api/src/services/google/client.ts e microsoft/client.ts,
// criptografia em apps/api/src/lib/crypto.ts): mudou o uso dos dados, mude aqui também.

const CONTACT = 'andre14luiz21@gmail.com';
const UPDATED_AT = '20 de outubro de 2026';

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Jottape`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  return (
    <div
      className='bg-background text-foreground pt-safe min-h-dvh'
      style={{ '--tint': 'var(--indigo)' } as React.CSSProperties}
    >
      <article className='mx-auto w-full max-w-2xl px-5 pt-10 pb-16'>
        <a href='/' className='mb-8 flex items-center gap-2.5'>
          <img src='/icons/icon-192.png' alt='' className='size-8 rounded-[8px]' />
          <span className='text-title-3'>Jottape</span>
        </a>
        <h1 className='text-large-title'>{title}</h1>
        <p className='text-subhead text-label-2 mt-1'>Atualizado em {UPDATED_AT}</p>
        <div className='text-body [&_a]:text-tint [&_code]:text-[0.9em] [&_code]:break-all [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6'>
          {children}
        </div>
        <nav className='text-subhead text-label-2 hairline-t mt-12 flex flex-wrap gap-x-5 gap-y-2 pt-5'>
          <a href='/'>Abrir o Jottape</a>
          <Link to='/privacidade'>Política de privacidade</Link>
          <Link to='/termos'>Termos de uso</Link>
        </nav>
      </article>
    </div>
  );
}

function H2({ children }: { children: ReactNode }) {
  return <h2 className='text-title-3 mt-9'>{children}</h2>;
}

const Contact = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

export function PrivacyPage() {
  return (
    <LegalLayout title='Política de privacidade'>
      <p>
        O Jottape é um aplicativo web pessoal de agenda, tarefas e finanças, mantido como projeto
        independente, sem fins comerciais. Ele não tem anúncios, não cobra nada e não vende dados.
        Esta política explica quais dados o Jottape usa, por que e como você pode removê-los.
      </p>

      <H2>Dados que você informa</H2>
      <ul>
        <li>Conta: nome, e-mail, senha (guardada só como hash bcrypt) e fuso horário.</li>
        <li>
          Conteúdo que você cria: eventos, tarefas, listas, contas, lançamentos, orçamentos e
          categorias.
        </li>
        <li>
          Notificações: se você ativar, o endereço de inscrição de notificações do seu navegador.
        </li>
      </ul>

      <H2>Dados do Google</H2>
      <p>O Jottape usa o Google de duas formas, sempre por iniciativa sua:</p>
      <ul>
        <li>
          <strong>Entrar com Google</strong> (escopos <code>openid</code>, <code>email</code> e{' '}
          <code>profile</code>): recebemos seu e-mail, nome e o identificador da sua conta Google
          para fazer o login numa conta do Jottape já existente.
        </li>
        <li>
          <strong>Ligar o Google Agenda e o Google Tasks</strong> em Ajustes (escopos{' '}
          <code>https://www.googleapis.com/auth/calendar</code> e{' '}
          <code>https://www.googleapis.com/auth/tasks</code>): o Jottape lê a lista das suas agendas
          e os eventos das agendas que você escolher, para mostrá-los na Agenda; cria, altera e
          apaga eventos no Google quando você faz isso no Jottape; e sincroniza nos dois sentidos
          suas listas e tarefas do Google Tasks com a tela Tarefas.
        </li>
      </ul>
      <p>
        Para isso guardamos: o e-mail da conta Google ligada, um token de atualização (refresh
        token) do OAuth, nome e cor das agendas, e cópias dos eventos (título, descrição, local,
        horários e recorrência) e das tarefas (título, notas, prazo e conclusão) necessárias para a
        sincronização. O token de atualização é guardado criptografado com AES-256-GCM; os tokens de
        acesso ficam só na memória do servidor, por menos de uma hora.
      </p>

      <H2>Uso limitado dos dados do Google</H2>
      <p>
        O uso e a transferência, para qualquer outro aplicativo, de informações recebidas das APIs
        do Google pelo Jottape seguem a{' '}
        <a
          href='https://developers.google.com/terms/api-services-user-data-policy'
          target='_blank'
          rel='noreferrer'
        >
          Política de Dados do Usuário dos Serviços de API do Google
        </a>
        , incluindo os requisitos de Uso Limitado. Na prática:
      </p>
      <ul>
        <li>
          Os dados do Google são usados só para mostrar e sincronizar sua agenda e suas tarefas
          dentro do Jottape, para você.
        </li>
        <li>
          Não são vendidos, não são usados para publicidade e não são repassados a terceiros, exceto
          à infraestrutura que hospeda o app (abaixo) ou se a lei exigir.
        </li>
        <li>Não são usados para treinar modelos de inteligência artificial.</li>
        <li>
          Ninguém lê seus dados, a não ser com seu consentimento, para investigar um problema de
          segurança, ou para cumprir a lei.
        </li>
      </ul>

      <H2>Dados da Microsoft</H2>
      <p>
        Se você ligar uma conta da Microsoft (Outlook, Hotmail ou Microsoft 365) em Ajustes, o
        Jottape usa o Microsoft Graph com as permissões <code>Calendars.ReadWrite</code>,{' '}
        <code>User.Read</code> e <code>offline_access</code>: lê a lista dos seus calendários e os
        eventos dos que você escolher, para mostrá-los na Agenda, e cria, altera e apaga eventos no
        Outlook quando você faz isso no Jottape. Não há login com a Microsoft nem acesso a e-mails,
        contatos ou arquivos.
      </p>
      <p>
        Guardamos o e-mail e o identificador da conta, o token de atualização (criptografado com
        AES-256-GCM, como o do Google), nome e cor dos calendários e cópias dos eventos necessárias
        para a sincronização. Esses dados seguem as mesmas regras de uso limitado acima: só servem
        para mostrar e sincronizar sua agenda, não são vendidos, repassados nem usados para treinar
        modelos de inteligência artificial.
      </p>

      <H2>Onde os dados ficam</H2>
      <p>
        O Jottape roda na Railway (Railway Corp.), que hospeda o servidor e o banco de dados
        PostgreSQL. O tráfego usa HTTPS. Notificações push passam pelo serviço de push do seu
        navegador (Apple, Google ou Mozilla) com conteúdo criptografado de ponta a ponta. Não usamos
        ferramentas de análise, rastreamento ou anúncios.
      </p>
      <p>
        Se você ligar os plugins de fora no briefing da tela Hoje, o servidor do Jottape consulta
        serviços públicos gratuitos: Open-Meteo (clima, maré e busca de cidade, com a cidade
        escolhida), Horoscope App API e MyMemory (horóscopo e tradução, com o signo), Frankfurter e
        CoinGecko (cotações), Yahoo Finance e brapi (ações, com os códigos escolhidos) e BrasilAPI
        (feriados). Só a cidade, o signo e os códigos das ações saem do app, sem nome, e-mail ou
        qualquer dado que identifique você, e as respostas ficam guardadas para todos os usuários.
      </p>

      <p>
        Quando você usa o Assistente, o texto do pedido, os nomes das suas contas e categorias e a
        data de hoje vão para a Anthropic (Claude), que lê o pedido, e para a TypeSafe (Jev), que
        confere a conta e a categoria. Se você ditar, o áudio vai para a OpenAI, que o transforma em
        texto. Esses serviços processam o pedido para responder e não recebem seu nome nem seu
        e-mail. A conversa fica guardada por 30 dias (ou até você começar uma nova) e o áudio não é
        guardado.
      </p>

      <H2>Cookies e armazenamento local</H2>
      <p>
        Usamos um único cookie de sessão, necessário para manter você conectado, e o armazenamento
        local do navegador para lembrar o tema (claro ou escuro), se os valores da tela Hoje estão
        ocultos, e funcionar como app instalado.
      </p>

      <H2>Seus controles</H2>
      <ul>
        <li>
          Desligar o Google: em Ajustes › Google, toque em desconectar. O Jottape revoga o acesso no
          Google, apaga o token, as agendas e os eventos importados; suas tarefas continuam no
          Jottape, sem o vínculo. Você também pode revogar o acesso em{' '}
          <a href='https://myaccount.google.com/permissions' target='_blank' rel='noreferrer'>
            myaccount.google.com/permissions
          </a>
          .
        </li>
        <li>
          Desligar a Microsoft: em Ajustes, toque em desconectar na conta. O Jottape apaga o token,
          os calendários e os eventos importados. Você também pode revogar o acesso em{' '}
          <a href='https://account.live.com/consent/Manage' target='_blank' rel='noreferrer'>
            account.live.com/consent/Manage
          </a>{' '}
          (conta pessoal) ou em myapps.microsoft.com (conta de trabalho ou escola).
        </li>
        <li>Exportar: em Ajustes, baixe todos os seus dados em JSON ou os lançamentos em CSV.</li>
        <li>
          Apagar a conta: peça por e-mail para <Contact />. A conta e todos os dados ligados a ela
          são apagados do banco em até 30 dias.
        </li>
      </ul>

      <H2>Retenção</H2>
      <p>
        Os dados ficam guardados enquanto sua conta existir. Os dados do Google e da Microsoft ficam
        enquanto a conexão estiver ligada e são apagados quando você desconecta ou apaga a conta.
      </p>

      <H2>Alterações e contato</H2>
      <p>
        Se esta política mudar, a data no topo é atualizada. Dúvidas ou pedidos: <Contact />.
      </p>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title='Termos de uso'>
      <p>
        Estes termos valem para o uso do Jottape, um aplicativo web pessoal de agenda, tarefas e
        finanças mantido como projeto independente. Ao criar uma conta ou entrar, você concorda com
        eles e com a <Link to='/privacidade'>política de privacidade</Link>.
      </p>

      <H2>O serviço</H2>
      <ul>
        <li>
          O Jottape é gratuito, sem anúncios, e as contas são criadas só com código de convite.
        </li>
        <li>
          Ele organiza compromissos, tarefas e finanças pessoais e, se você quiser, sincroniza com o
          Google Agenda, o Google Tasks e o calendário do Outlook.
        </li>
        <li>
          Os números de finanças e de previsão de saldo são só organização pessoal, não
          aconselhamento financeiro.
        </li>
      </ul>

      <H2>Sua conta</H2>
      <ul>
        <li>Você é responsável pela sua senha e pelo que é feito com a sua conta.</li>
        <li>
          Não use o Jottape para nada ilegal, nem tente acessar dados de outras pessoas ou
          atrapalhar o funcionamento do serviço.
        </li>
        <li>Contas que violarem estes termos podem ser suspensas.</li>
      </ul>

      <H2>Seus dados</H2>
      <p>
        O que você coloca no Jottape continua seu. Você pode exportar tudo em Ajustes, desligar o
        Google quando quiser e pedir para apagar a conta. Ao ligar o Google, você autoriza o Jottape
        a ler e alterar eventos e tarefas da sua conta Google conforme você usa o app, nos termos da{' '}
        <Link to='/privacidade'>política de privacidade</Link>. O mesmo vale para os eventos do
        Outlook, se você ligar uma conta da Microsoft.
      </p>

      <H2>Disponibilidade</H2>
      <p>
        O Jottape é um projeto pessoal oferecido &quot;como está&quot;. Pode ficar fora do ar, mudar
        ou ser encerrado. Se for encerrado, avisaremos com antecedência para você exportar seus
        dados. Na máxima medida permitida pela lei, não há responsabilidade por perda de dados,
        compromissos perdidos ou decisões tomadas com base no app; mantenha cópias do que for
        importante.
      </p>

      <H2>Alterações e lei aplicável</H2>
      <p>
        Estes termos podem mudar; a data no topo indica a versão atual. Valem as leis do Brasil,
        incluindo a Lei Geral de Proteção de Dados (LGPD). Contato: <Contact />.
      </p>
    </LegalLayout>
  );
}
