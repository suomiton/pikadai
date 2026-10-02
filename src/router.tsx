import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import { CreatePage } from './pages/CreatePage';
import { EventPage } from './pages/EventPage';
import { NotFoundPage } from './pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <CreatePage /> },
      { path: 'e/:id', element: <EventPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
