import './styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { CreateTournamentPage } from './pages/CreateTournamentPage';
import { HomePage } from './pages/HomePage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { LegalPage } from './pages/LegalPage';
import { LoginPage } from './pages/LoginPage';
import { MatchPage } from './pages/MatchPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { PricingPage } from './pages/PricingPage';
import { ProfilePage } from './pages/ProfilePage';
import { TournamentPage } from './pages/TournamentPage';
import { UserPage } from './pages/UserPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/tournaments/new', element: <CreateTournamentPage /> },
      { path: '/tournaments/:id', element: <TournamentPage /> },
      { path: '/matches/:id', element: <MatchPage /> },
      { path: '/leaderboard/:game', element: <LeaderboardPage /> },
      { path: '/users/:id', element: <UserPage /> },
      { path: '/pricing', element: <PricingPage /> },
      { path: '/legal/:doc', element: <LegalPage /> },
    ],
  },
]);

const root = document.getElementById('root');
if (!root) throw new Error('Нет элемента #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
