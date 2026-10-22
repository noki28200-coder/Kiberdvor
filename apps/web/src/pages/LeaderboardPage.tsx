import { GAMES, type Game, type LeaderboardRow } from '@kiberdvor/shared';
import { Button, Card } from '@kiberdvor/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { ErrorText, gameTitle, Loading } from '../components/common';

export function LeaderboardPage() {
  const { game = 'dota2' } = useParams();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['leaderboard', game],
    queryFn: () => api.get<LeaderboardRow[]>(`/leaderboard/${game}`),
  });

  return (
    <>
      <h1>Рейтинг</h1>
      <div className="tabs">
        {GAMES.map((g) => (
          <Button
            key={g}
            variant={g === game ? 'primary' : 'secondary'}
            onClick={() => void navigate(`/leaderboard/${g}`)}
          >
            {gameTitle(g)}
          </Button>
        ))}
      </div>
      <Card>
        <p className="muted small">
          Glicko-2 отдельно по каждой игре. Стартовое значение — из ранга в игре, дальше рейтинг
          пересчитывается после каждого турнира. RD — неуверенность оценки: чем больше сыграно, тем
          она меньше.
        </p>
        {query.isPending && <Loading />}
        <ErrorText error={query.error} />
        {query.data && (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Игрок</th>
                <th>Рейтинг</th>
                <th>RD</th>
                <th>Матчей</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((row, i) => (
                <tr key={row.userId}>
                  <td>{i + 1}</td>
                  <td>
                    <Link to={`/users/${row.userId}`}>{row.nickname}</Link>
                  </td>
                  <td>{row.rating}</td>
                  <td>±{row.rd}</td>
                  <td>{row.matches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {query.data?.length === 0 && (
          <p className="muted">В {gameTitle(game as Game)} пока никто не играл.</p>
        )}
      </Card>
    </>
  );
}
