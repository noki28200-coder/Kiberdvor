import {
  FORMAT_LABELS,
  GAMES,
  TIER_INFO,
  TOURNAMENT_FORMATS,
  type Game,
  type TournamentFormat,
} from '@kiberdvor/shared';
import { Button, Card } from '@kiberdvor/ui';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { api, useMe } from '../api';
import { ErrorText, gameTitle, Loading } from '../components/common';

/** Значение для input type=datetime-local через `hours` часов от текущего момента. */
function localInputValue(hours: number) {
  const d = new Date(Date.now() + hours * 3600 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

export function CreateTournamentPage() {
  const { data: me, isPending } = useMe();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [game, setGame] = useState<Game>('dota2');
  const [format, setFormat] = useState<TournamentFormat>('single_elimination');
  const [teamLimit, setTeamLimit] = useState(8);
  const [closesAt, setClosesAt] = useState(localInputValue(24));
  const [startsAt, setStartsAt] = useState(localInputValue(26));
  const [error, setError] = useState<unknown>(null);

  if (isPending) return <Loading />;
  if (!me) return <Navigate to="/login" />;
  const maxTeams = TIER_INFO[me.tier].maxTeams;

  const submit = async () => {
    setError(null);
    try {
      const { id } = await api.post<{ id: string }>('/tournaments', {
        title,
        game,
        format,
        teamLimit,
        registrationClosesAt: new Date(closesAt).toISOString(),
        startsAt: new Date(startsAt).toISOString(),
      });
      void navigate(`/tournaments/${id}`);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Card title="Новый турнир">
      <div className="form">
        <label>
          Название
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Кубок первокурсников"
          />
        </label>
        <label>
          Игра
          <select value={game} onChange={(e) => setGame(e.target.value as Game)}>
            {GAMES.map((g) => (
              <option key={g} value={g}>
                {gameTitle(g)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Формат
          <select value={format} onChange={(e) => setFormat(e.target.value as TournamentFormat)}>
            {TOURNAMENT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Число команд (до {maxTeams} на вашем тарифе, <Link to="/pricing">больше</Link>)
          <input
            type="number"
            min={2}
            max={128}
            value={teamLimit}
            onChange={(e) => setTeamLimit(Number(e.target.value))}
          />
        </label>
        <label>
          Регистрация закрывается
          <input
            type="datetime-local"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
          />
        </label>
        <label>
          Начало турнира
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </label>
        <p className="muted small">
          Участие бесплатное: взносы и призовой фонд из денег участников на платформе запрещены.
        </p>
        <Button disabled={title.trim().length < 3} onClick={() => void submit()}>
          Создать и получить ссылку на регистрацию
        </Button>
        <ErrorText error={error} />
      </div>
    </Card>
  );
}
