import {
  FORMAT_LABELS,
  TOURNAMENT_STATUS_LABELS,
  type TournamentListItem,
} from '@kiberdvor/shared';
import { Badge, Button, Card } from '@kiberdvor/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { api, useMe } from '../api';
import { ErrorText, formatDate, gameTitle, Loading } from '../components/common';

export function HomePage() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: ['tournaments'],
    queryFn: () => api.get<TournamentListItem[]>('/tournaments'),
  });

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Любительские турниры</h1>
          <p className="muted">
            Dota 2, CS2 и FPV Kamikaze Drone. Нет команды — заявитесь свободным агентом, капитаны
            выберут вас в драфте.
          </p>
        </div>
        {me && <Button onClick={() => void navigate('/tournaments/new')}>Создать турнир</Button>}
      </div>

      <Card>
        {list.isPending && <Loading />}
        <ErrorText error={list.error} />
        {list.data?.length === 0 && <p className="muted">Турниров пока нет.</p>}
        {list.data?.map((t) => (
          <div key={t.id} className="list-item">
            <div>
              <Link to={`/tournaments/${t.id}`}>
                <strong>{t.title}</strong>
              </Link>
              <div className="muted small">
                {gameTitle(t.game)} · {FORMAT_LABELS[t.format]} · старт {formatDate(t.startsAt)} ·
                организатор {t.organizerNickname}
              </div>
            </div>
            <div className="row">
              <Badge>
                команд {t.teamCount}/{t.teamLimit}
              </Badge>
              <Badge>свободных агентов {t.freeAgentCount}</Badge>
              <Badge tone={t.status === 'registration_open' ? 'success' : 'neutral'}>
                {TOURNAMENT_STATUS_LABELS[t.status]}
              </Badge>
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}
