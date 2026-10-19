import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';

import { AppShell } from '@/components/app-shell';
import { AuthGate } from '@/components/auth-gate';
import { AgendaPage } from '@/routes/agenda/agenda-page';
import { AccountPage } from '@/routes/finance/account-page';
import { FinancePage } from '@/routes/finance/finance-page';
import { CategoriesPage } from '@/routes/settings/categories-page';
import { GooglePage } from '@/routes/settings/google-page';
import { SettingsPage } from '@/routes/settings/settings-page';
import { TaskListPage } from '@/routes/tasks/task-list-page';
import { TasksPage } from '@/routes/tasks/tasks-page';
import { TodayPage } from '@/routes/today-page';

// Rotas em código (são poucas). As URLs ficam em português: é o que aparece na barra do navegador.
const rootRoute = createRootRoute({
  component: () => (
    <AuthGate>
      <AppShell />
    </AuthGate>
  ),
});

const route = <P extends string>(path: P, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const routeTree = rootRoute.addChildren([
  route('/', TodayPage),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/entrar',
    beforeLoad: () => {
      throw redirect({ to: '/' });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/cadastro',
    beforeLoad: () => {
      throw redirect({ to: '/' });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
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
  route('/tarefas', TasksPage),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/tarefas/$listId',
    component: TaskListPage,
    validateSearch: (search: Record<string, unknown>): { tag?: string; novo?: string } => ({
      tag: typeof search.tag === 'string' ? search.tag : undefined,
      novo: typeof search.novo === 'string' ? search.novo : undefined,
    }),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/financas',
    component: FinancePage,
    validateSearch: (search: Record<string, unknown>): { tab?: string; month?: string } => ({
      tab: typeof search.tab === 'string' ? search.tab : undefined,
      month: typeof search.month === 'string' ? search.month : undefined,
    }),
  }),
  route('/financas/contas/$accountId', AccountPage),
  route('/ajustes', SettingsPage),
  route('/ajustes/categorias', CategoriesPage),
  route('/ajustes/google', GooglePage),
]);

export function createAppRouter() {
  return createRouter({ routeTree, scrollRestoration: true, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
