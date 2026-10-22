import type { PublicUser } from '@kiberdvor/shared';
import { Card } from '@kiberdvor/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../api';
import { ErrorText, gameTitle, Loading, PlayerInfo } from '../components/common';

export function UserPage() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['user', id],
    queryFn: () => api.get<PublicUser>(`/users/${id}`),
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorText error={query.error} />;
  const user = query.data;

  return (
    <>
      <h1>{user.nickname}</h1>
      <Card title="Рейтинг">
        {user.ratings.length === 0 && <p className="muted">Ещё не играл.</p>}
        {user.ratings.map((r) => (
          <p key={r.game}>
            {gameTitle(r.game)}: <strong>{r.rating}</strong> ±{r.rd} · матчей {r.matches}
          </p>
        ))}
      </Card>
      {user.profiles.map((profile) => (
        <Card key={profile.game} title={`Анкета: ${gameTitle(profile.game)}`}>
          <PlayerInfo
            player={{
              userId: user.id,
              nickname: user.nickname,
              avatarUrl: user.avatarUrl,
              rating: user.ratings.find((r) => r.game === profile.game)?.rating ?? 1500,
              profile,
              reputation: user.reputation,
            }}
          />
        </Card>
      ))}
    </>
  );
}
