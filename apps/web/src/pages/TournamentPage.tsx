import {
  DRAFT_PICK_SECONDS,
  FORMAT_LABELS,
  GAME_INFO,
  GAME_ROLES,
  MATCH_STATUS_LABELS,
  TOURNAMENT_STATUS_LABELS,
  type FreeAgentView,
  type TeamView,
  type TournamentView,
} from '@kiberdvor/shared';
import { Badge, Button, Card } from '@kiberdvor/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, useMe } from '../api';
import {
  ErrorText,
  formatDate,
  gameTitle,
  Loading,
  PlayerInfo,
  roleLabel,
} from '../components/common';
import { useCountdown, useLiveRoom } from '../hooks/realtime';

function useAction() {
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
      await client.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy };
}

function Registration({ t }: { t: TournamentView }) {
  const { data: me } = useMe();
  const { run, error, busy } = useAction();
  const [teamName, setTeamName] = useState('');
  const [missingRoles, setMissingRoles] = useState<string[]>([]);
  const [inviteCode, setInviteCode] = useState('');

  if (t.status !== 'registration_open') return null;
  if (!me) {
    return (
      <Card title="Регистрация">
        <Link to="/login">Войдите</Link>, чтобы заявиться.
      </Card>
    );
  }
  if (t.myTeamId || t.myFreeAgentStatus) {
    return (
      <Card title="Вы заявлены">
        <p>
          {t.myTeamId
            ? 'Вы в команде этого турнира.'
            : 'Вы в пуле свободных агентов: вас выберут в драфте.'}
        </p>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void run(() => api.delete(`/tournaments/${t.id}/registration`))}
        >
          Отозвать заявку
        </Button>
        <ErrorText error={error} />
      </Card>
    );
  }

  return (
    <Card title="Регистрация">
      <div className="grid">
        <div className="form">
          <strong>Своя команда</strong>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Название команды"
          />
          <div className="small">
            Каких ролей не хватает:{' '}
            {GAME_ROLES[t.game].map((r) => (
              <label
                key={r}
                className="checkbox"
                style={{ display: 'inline-flex', marginRight: 8 }}
              >
                <input
                  type="checkbox"
                  checked={missingRoles.includes(r)}
                  onChange={() =>
                    setMissingRoles(
                      missingRoles.includes(r)
                        ? missingRoles.filter((x) => x !== r)
                        : [...missingRoles, r],
                    )
                  }
                />
                {roleLabel(r)}
              </label>
            ))}
          </div>
          <Button
            disabled={busy || teamName.trim().length < 2}
            onClick={() =>
              void run(() =>
                api.post(`/tournaments/${t.id}/teams`, { name: teamName, missingRoles }),
              )
            }
          >
            Создать команду (я капитан)
          </Button>
        </div>
        <div className="form">
          <strong>Вступить по коду</strong>
          <input
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="Код от капитана"
          />
          <Button
            variant="secondary"
            disabled={busy || inviteCode.length < 6}
            onClick={() => void run(() => api.post('/teams/join', { inviteCode }))}
          >
            Вступить
          </Button>
        </div>
        <div className="form">
          <strong>Нет команды</strong>
          <p className="muted small">
            Попадёте в пул свободных агентов. Капитаны выберут вас по анкете.
          </p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run(() => api.post(`/tournaments/${t.id}/free-agents`))}
          >
            Заявиться свободным агентом
          </Button>
        </div>
      </div>
      <ErrorText error={error} />
    </Card>
  );
}

function Teams({ t }: { t: TournamentView }) {
  const size = GAME_INFO[t.game].teamSize;
  return (
    <Card title={`Команды (${t.teams.length}/${t.teamLimit})`}>
      {t.teams.length === 0 && <p className="muted">Пока никто не заявился.</p>}
      <div className="grid">
        {t.teams.map((team) => (
          <div key={team.id}>
            <div className="row">
              <strong>{team.name}</strong>
              {team.seed && <Badge>посев {team.seed}</Badge>}
              <Badge>
                {team.members.length}/{size}
              </Badge>
              <Badge>рейтинг {team.avgRating}</Badge>
              {t.winnerTeamId === team.id && <Badge tone="success">Победитель</Badge>}
            </div>
            {team.inviteCode && (
              <p className="small">
                Код приглашения: <code>{team.inviteCode}</code>
              </p>
            )}
            {team.missingRoles.length > 0 && (
              <p className="muted small">Ищут: {team.missingRoles.map(roleLabel).join(', ')}</p>
            )}
            {team.members.map((m) => (
              <PlayerInfo
                key={m.userId}
                player={m}
                actions={
                  <>
                    {m.userId === team.captainId && <Badge tone="warning">капитан</Badge>}
                    {m.viaDraft && <Badge>из драфта</Badge>}
                  </>
                }
              />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Draft({ t }: { t: TournamentView }) {
  const { data: me } = useMe();
  const { run, error, busy } = useAction();
  const [role, setRole] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [onlyMic, setOnlyMic] = useState(false);
  const draft = t.draft;
  const seconds = useCountdown(draft?.status === 'in_progress' ? draft.deadline : null);

  const pool = useMemo(
    () =>
      t.freeAgents
        .filter((a) => a.status === 'pool')
        .filter((a) => !role || a.profile?.roles.includes(role))
        .filter((a) => a.rating >= minRating)
        .filter((a) => !onlyMic || a.profile?.hasMic),
    [t.freeAgents, role, minRating, onlyMic],
  );

  if (!draft && t.freeAgents.length === 0) return null;
  const teamName = (id: string) => t.teams.find((x) => x.id === id)?.name ?? '—';
  const currentTeam: TeamView | undefined = draft
    ? t.teams.find((x) => x.id === draft.order[draft.currentPick])
    : undefined;
  const myTurn = draft?.status === 'in_progress' && currentTeam?.captainId === me?.id;
  const nick = (userId: string) =>
    t.freeAgents.find((a) => a.userId === userId)?.nickname ??
    t.teams.flatMap((x) => x.members).find((m) => m.userId === userId)?.nickname ??
    '—';

  return (
    <Card title={draft ? 'Драфт' : `Свободные агенты (${t.freeAgents.length})`}>
      {draft?.status === 'in_progress' && (
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="draft-timer">{seconds ?? DRAFT_PICK_SECONDS} с</span>
          <span>
            Пик {draft.currentPick + 1} из {draft.order.length}: выбирает{' '}
            <strong>{currentTeam?.name}</strong>
            {myTurn && <Badge tone="warning">ваш ход</Badge>}
          </span>
        </div>
      )}
      {draft?.status === 'finished' && (
        <p className="muted">
          Драфт завершён. Невыбранные игроки получили приоритет в следующем драфте.
        </p>
      )}
      {!draft && (
        <p className="muted">
          После закрытия регистрации капитаны команд с недобором выберут игроков змейкой: первой
          пикает самая слабая по рейтингу команда.
        </p>
      )}

      {draft && (
        <p className="small">
          Очередь:{' '}
          {draft.order.map((teamId, i) => (
            <span
              key={i}
              style={{
                fontWeight: i === draft.currentPick && draft.status === 'in_progress' ? 700 : 400,
              }}
            >
              {teamName(teamId)}
              {i < draft.order.length - 1 ? ' → ' : ''}
            </span>
          ))}
        </p>
      )}

      {draft && draft.picks.length > 0 && (
        <p className="small">
          Пики:{' '}
          {draft.picks
            .map(
              (p) =>
                `${p.pickNo}. ${teamName(p.teamId)} — ${nick(p.userId)}${p.auto ? ' (авто)' : ''}`,
            )
            .join('; ')}
        </p>
      )}

      <div className="row small" style={{ marginBottom: 8 }}>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Все роли</option>
          {GAME_ROLES[t.game].map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
        <label>
          рейтинг от{' '}
          <input
            type="number"
            style={{ width: 90 }}
            value={minRating}
            onChange={(e) => setMinRating(Number(e.target.value))}
          />
        </label>
        <label className="checkbox" style={{ display: 'inline-flex', gap: 4 }}>
          <input type="checkbox" checked={onlyMic} onChange={(e) => setOnlyMic(e.target.checked)} />
          с микрофоном
        </label>
      </div>

      {pool.map((agent: FreeAgentView) => (
        <PlayerInfo
          key={agent.userId}
          player={agent}
          actions={
            <>
              {agent.reservePriority && <Badge tone="warning">резерв: приоритет</Badge>}
              {myTurn && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api.post(`/tournaments/${t.id}/draft/pick`, { userId: agent.userId }),
                    )
                  }
                >
                  Пикнуть
                </Button>
              )}
            </>
          }
        />
      ))}
      {t.freeAgents
        .filter((a) => a.status === 'reserve')
        .map((a) => (
          <p key={a.userId} className="muted small">
            {a.nickname} — в резерве
          </p>
        ))}
      <ErrorText error={error} />
    </Card>
  );
}

function Bracket({ t }: { t: TournamentView }) {
  if (t.bracket.length === 0) return null;
  const teamName = (id: string | null) =>
    id ? (t.teams.find((x) => x.id === id)?.name ?? '—') : 'ожидается';
  return (
    <Card title="Сетка">
      <div className="bracket">
        {t.bracket.map((column) => (
          <div key={column.title} className="bracket__column">
            <strong>{column.title}</strong>
            {column.matches.map((m) => {
              const body = (
                <>
                  {[
                    [m.team1Id, m.score1],
                    [m.team2Id, m.score2],
                  ].map(([teamId, score], i) => (
                    <div
                      key={i}
                      className={`bracket__team ${m.winnerTeamId && m.winnerTeamId === teamId ? 'winner' : ''}`}
                    >
                      <span>{teamName(teamId as string | null)}</span>
                      <span>{score ?? ''}</span>
                    </div>
                  ))}
                  <div className="muted small" style={{ padding: '0 10px 6px' }}>
                    {m.label} · {m.id ? MATCH_STATUS_LABELS[m.status] : 'ждёт соперников'}
                  </div>
                </>
              );
              return m.id ? (
                <Link key={m.bracketKey} to={`/matches/${m.id}`} className="bracket__match">
                  {body}
                </Link>
              ) : (
                <div key={m.bracketKey} className="bracket__match">
                  {body}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {t.format === 'swiss' && t.standings.length > 0 && (
        <table style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Команда</th>
              <th>Победы</th>
              <th>Поражения</th>
            </tr>
          </thead>
          <tbody>
            {t.standings.map((row) => (
              <tr key={row.teamId}>
                <td>{teamName(row.teamId)}</td>
                <td>{row.wins}</td>
                <td>{row.losses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function OrganizerPanel({ t }: { t: TournamentView }) {
  const { run, error, busy } = useAction();
  if (!t.isOrganizer || t.status === 'finished' || t.status === 'cancelled') return null;
  return (
    <Card title="Управление">
      <div className="row">
        {t.status === 'registration_open' && (
          <Button
            disabled={busy}
            onClick={() => void run(() => api.post(`/tournaments/${t.id}/close-registration`))}
          >
            Закрыть регистрацию и начать {t.freeAgents.length > 0 ? 'драфт' : 'турнир'}
          </Button>
        )}
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Отменить турнир? Это нельзя вернуть.'))
              void run(() => api.post(`/tournaments/${t.id}/cancel`));
          }}
        >
          Отменить турнир
        </Button>
      </div>
      <p className="muted small">
        Ссылка на регистрацию: <code>{window.location.href}</code>
      </p>
      <ErrorText error={error} />
    </Card>
  );
}

export function TournamentPage() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['tournament', id],
    queryFn: () => api.get<TournamentView>(`/tournaments/${id}`),
  });
  useLiveRoom(`tournament:${id}`, ['tournament', id]);

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorText error={query.error} />;
  const t = query.data;

  return (
    <>
      <h1>{t.title}</h1>
      <p className="row">
        <Badge>{gameTitle(t.game)}</Badge>
        <Badge>{FORMAT_LABELS[t.format]}</Badge>
        <Badge tone={t.status === 'registration_open' ? 'success' : 'neutral'}>
          {TOURNAMENT_STATUS_LABELS[t.status]}
        </Badge>
        <span className="muted small">
          регистрация до {formatDate(t.registrationClosesAt)} · старт {formatDate(t.startsAt)} ·
          организатор <Link to={`/users/${t.organizer.id}`}>{t.organizer.nickname}</Link>
        </span>
      </p>
      <OrganizerPanel t={t} />
      <Registration t={t} />
      <Draft t={t} />
      <Bracket t={t} />
      <Teams t={t} />
    </>
  );
}
