import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { HomePage } from './pages/HomePage';

const queryClient = new QueryClient();

const router = createBrowserRouter([{ path: '/', element: <HomePage /> }]);

const root = document.getElementById('root');
if (!root) throw new Error('Нет элемента #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
