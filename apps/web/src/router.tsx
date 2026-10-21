import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';

import { AppShell } from '@/components/app-shell';
import { AuthGate } from '@/components/auth-gate';
import { AgendaPage } from '@/routes/agenda/agenda-page';
import { AssistantPage } from '@/routes/assistant/assistant-page';
import { AccountPage } from '@/routes/finance/account-page';
import { FinancePage } from '@/routes/finance/finance-page';
import { PrivacyPage, TermsPage } from '@/routes/legal/legal-pages';
import { AssistantAdminPage } from '@/routes/settings/assistant-admin-page';
import { BriefingSettingsPage } from '@/routes/settings/briefing-page';
import { CategoriesPage } from '@/routes/settings/categories-page';
import { GooglePage } from '@/routes/settings/google-page';
import { InstallPage } from '@/routes/settings/install-guide';
import { SettingsPage } from '@/routes/settings/settings-page';
import { TasksPage } from '@/routes/tasks/tasks-page';
import { TodayPage } from '@/routes/today-page';

// Rotas em código (são poucas). As URLs ficam em português: é o que aparece na barra do navegador.
const rootRoute = createRootRoute({ component: Outlet });

// Termos e privacidade abrem sem login: o Google exige as duas páginas públicas na tela de
// consentimento do OAuth.
const publicRoutes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/privacidade', component: PrivacyPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/termos', component: TermsPage }),
];

// Todo o resto passa pelo login.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: () => (
    <AuthGate>
      <AppShell />
    </AuthGate>
  ),
});

const route = <P extends string>(path: P, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => appRoute, path, component });

const appRoutes = appRoute.addChildren([
  route('/', TodayPage),
  createRoute({
    getParentRoute: () => appRoute,
    path: '/entrar',
    beforeLoad: () => {
      throw redirect({ to: '/' });
    },
  }),
  createRoute({
    getParentRoute: () => appRoute,
    path: '/cadastro',
    beforeLoad: () => {
      throw redirect({ to: '/' });
    },
  }),
  createRoute({
    getParentRoute: () => appRoute,
    path: '/agenda',
    component: AgendaPage,
    validateSearch: (
      search: Record<string, unknown>
    ): { view?: string; date?: string; novo?: string } => ({
      view: typeof search.view === 'string' ? search.view : undefined,
      date: typeof search.date === 'string' ? search.date : undefined,
      novo: typeof search.novo === 'string' ? search.novo : undefined,
    }),
  }),
  createRoute({
    getParentRoute: () => appRoute,
    path: '/tarefas',
    component: TasksPage,
    validateSearch: (
      search: Record<string, unknown>
    ): { filtro?: string; tag?: string; novo?: string } => ({
      filtro: typeof search.filtro === 'string' ? search.filtro : undefined,
      tag: typeof search.tag === 'string' ? search.tag : undefined,
      novo: typeof search.novo === 'string' ? search.novo : undefined,
    }),
  }),
  // Endereço antigo de cada lista: hoje as listas são filtros da tela Tarefas.
  createRoute({
    getParentRoute: () => appRoute,
    path: '/tarefas/$listId',
    beforeLoad: ({ params, search }) => {
      const { tag, novo } = search as { tag?: string; novo?: string };
      throw redirect({
        to: '/tarefas',
        search: { filtro: params.listId === 'todas' ? undefined : params.listId, tag, novo },
        replace: true,
      });
    },
  }),
  createRoute({
    getParentRoute: () => appRoute,
    path: '/financas',
    component: FinancePage,
    validateSearch: (search: Record<string, unknown>): { tab?: string; month?: string } => ({
      tab: typeof search.tab === 'string' ? search.tab : undefined,
      month: typeof search.month === 'string' ? search.month : undefined,
    }),
  }),
  route('/financas/contas/$accountId', AccountPage),
  route('/assistente', AssistantPage),
  route('/ajustes', SettingsPage),
  route('/ajustes/categorias', CategoriesPage),
  route('/ajustes/google', GooglePage),
  route('/ajustes/briefing', BriefingSettingsPage),
  route('/ajustes/assistente', AssistantAdminPage),
  route('/ajustes/instalar', InstallPage),
]);

const routeTree = rootRoute.addChildren([...publicRoutes, appRoutes]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, scrollRestoration: true, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
