import { GAME_INFO, GAMES, healthResponseSchema } from '@kiberdvor/shared';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api';

function ApiStatus() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet('/health', healthResponseSchema),
  });

  if (health.isPending) return <p>Проверяем сервер…</p>;
  if (health.isError) return <p>Сервер недоступен: {health.error.message}</p>;
  return (
    <p>Сервер работает, база данных: {health.data.db === 'ok' ? 'подключена' : 'недоступна'}</p>
  );
}

export function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16, fontFamily: 'system-ui' }}>
      <h1>Любительские киберспорт-турниры</h1>
      <p>Организатор запускает турнир за 5 минут, одиночки находят команду через драфт.</p>
      <ul>
        {GAMES.map((game) => (
          <li key={game}>{GAME_INFO[game].title}</li>
        ))}
      </ul>
      <ApiStatus />
    </main>
  );
}
