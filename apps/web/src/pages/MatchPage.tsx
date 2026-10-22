import { MATCH_STATUS_LABELS, type MatchView, type TeamView } from '@kiberdvor/shared';
import { Badge, Button, Card } from '@kiberdvor/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, useMe } from '../api';
import { ErrorText, formatDate, gameTitle, Loading } from '../components/common';
import { useLiveRoom } from '../hooks/realtime';

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

const teamName = (team: TeamView | null) => team?.name ?? '—';

function ReadyCheck({ m }: { m: MatchView }) {
  const { data: me } = useMe();
  const { run, error, busy } = useAction();
  if (!m.isParticipant || m.status === 'finished') return null;
  const total = (m.team1?.members.length ?? 0) + (m.team2?.members.length ?? 0);
  const iAmReady = me ? m.readyUserIds.includes(me.id) : false;
  return (
    <Card title="Готовность">
      <div className="row">
        <span>
          Готовы {m.readyUserIds.length} из {total}
        </span>
        {!iAmReady && (
          <Button
            disabled={busy}
            onClick={() => void run(() => api.post(`/matches/${m.id}/ready`))}
          >
            Готов
          </Button>
        )}
        {iAmReady && <Badge tone="success">вы готовы</Badge>}
      </div>
      <ErrorText error={error} />
    </Card>
  );
}

function Dota({ m }: { m: MatchView }) {
  const { run, error, busy } = useAction();
  const [externalId, setExternalId] = useState('');
  return (
    <Card title="Матч Dota 2">
      {m.lobby ? (
        <p>
          Капитан создаёт приватное лобби: название <code>{m.lobby.name}</code>, пароль{' '}
          <code>{m.lobby.password}</code>. Игра идёт на серверах Valve.
        </p>
      ) : (
        <p className="muted">Данные лобби видят только участники матча.</p>
      )}
      {m.status !== 'finished' && (m.isCaptain || m.isOrganizer) && (
        <div className="form">
          <label>
            ID матча после игры (из клиента Dota 2 или профиля)
            <input
              value={externalId}
              onChange={(e) => setExternalId(e.target.value.trim())}
              placeholder="7812345678"
            />
          </label>
          <Button
            disabled={busy || externalId.length < 6}
            onClick={() =>
              void run(() =>
                api.post(`/matches/${m.id}/external-match`, { externalMatchId: externalId }),
              )
            }
          >
            Проверить через OpenDota и записать результат
          </Button>
        </div>
      )}
      {m.externalMatchId && (
        <p className="small">
          Матч:{' '}
          <a
            href={`https://www.opendota.com/matches/${m.externalMatchId}`}
            target="_blank"
            rel="noreferrer"
          >
            {m.externalMatchId} на OpenDota
          </a>
        </p>
      )}
      <ErrorText error={error} />
    </Card>
  );
}

function Cs2({ m }: { m: MatchView }) {
  const { run, error, busy } = useAction();
  const { data: me } = useMe();
  return (
    <Card title="Матч CS2: сервер на ПК игрока">
      <p className="muted small">
        Кандидатов в хосты регистрирует и пинг меряет десктоп-клиент Кибердвора. Нейтральный ПК
        (организатор, компьютерный клуб) в приоритете; иначе рекомендуем ПК, у которого худший пинг
        среди 10 игроков минимален. Оба капитана подтверждают выбор.
      </p>
      {m.host.candidates.length === 0 && <p>Кандидатов пока нет: запустите десктоп-клиент.</p>}
      {m.host.candidates.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>ПК</th>
              <th>Доступен</th>
              <th>Худший пинг</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {m.host.candidates.map((c) => (
              <tr key={c.userId}>
                <td>
                  {c.nickname} {c.neutral && <Badge>нейтральный</Badge>}{' '}
                  {m.host.recommendedUserId === c.userId && (
                    <Badge tone="success">рекомендуем</Badge>
                  )}
                  {m.host.userId === c.userId && <Badge tone="warning">выбран</Badge>}
                </td>
                <td>{c.reachable ? 'да' : 'нет (серый IP)'}</td>
                <td>
                  {c.worstPingMs !== null
                    ? `${Math.round(c.worstPingMs)} мс (${c.pingCount} замеров)`
                    : '—'}
                </td>
                <td>
                  {m.status === 'host_selection' &&
                    (m.isCaptain || m.isOrganizer) &&
                    c.reachable && (
                      <Button
                        variant="secondary"
                        disabled={
                          busy ||
                          (m.host.userId === c.userId && !!me && m.host.confirmedBy.includes(me.id))
                        }
                        onClick={() =>
                          void run(() =>
                            api.post(`/matches/${m.id}/host/confirm`, {
                              candidateUserId: c.userId,
                            }),
                          )
                        }
                      >
                        Подтвердить
                      </Button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {m.status === 'ready_check' && (
        <p>Хост выбран, клиент хоста разворачивает сервер CS2 с MatchZy…</p>
      )}
      {m.host.connect && (
        <p>
          Подключение: <code>connect {m.host.connect}</code>
        </p>
      )}
      {m.demoHash && <p className="muted small">Хеш демо (для споров): {m.demoHash}</p>}
      <ErrorText error={error} />
    </Card>
  );
}

function Fpv({ m }: { m: MatchView }) {
  const { run, error, busy } = useAction();
  const { data: me } = useMe();
  const [score, setScore] = useState(0);
  const [file, setFile] = useState<File | null>(null);

  const submit = async () => {
    if (!file) return;
    const buffer = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of buffer) binary += String.fromCharCode(byte);
    await api.post(`/matches/${m.id}/fpv`, { score, screenshotBase64: btoa(binary) });
  };

  const sum = (team: TeamView | null) =>
    m.fpv.filter((f) => f.teamId === team?.id).reduce((s, f) => s + f.score, 0);
  const canSeeScreens = m.isParticipant || m.isOrganizer;

  return (
    <Card title="FPV: залёт на своём ПК">
      <p className="muted small">
        Все проходят одну карту в одно окно времени. Результат команды — сумма очков. Десктоп-клиент
        делает скриншот итога и пишет запись залёта (запись остаётся у вас, на сайт уходит её хеш).
        Можно прислать скриншот и вручную.
      </p>
      <p>
        {teamName(m.team1)}: {sum(m.team1)} · {teamName(m.team2)}: {sum(m.team2)}
      </p>
      {m.fpv.map((f) => {
        const member = [...(m.team1?.members ?? []), ...(m.team2?.members ?? [])].find(
          (x) => x.userId === f.userId,
        );
        return (
          <p key={f.userId} className="small">
            {member?.nickname ?? '—'}: {f.score}{' '}
            {canSeeScreens && f.hasScreenshot && (
              <a
                href={`/api/matches/${m.id}/fpv/${f.userId}/screenshot`}
                target="_blank"
                rel="noreferrer"
              >
                скриншот
              </a>
            )}
          </p>
        );
      })}
      {m.isParticipant && m.status !== 'finished' && (
        <div className="form">
          <label>
            Мои очки
            <input
              type="number"
              min={0}
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
            />
          </label>
          <label>
            Скриншот итога (PNG)
            <input
              type="file"
              accept="image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <Button disabled={busy || !file} onClick={() => void run(submit)}>
            {me && m.fpv.some((f) => f.userId === me.id)
              ? 'Обновить результат'
              : 'Отправить результат'}
          </Button>
        </div>
      )}
      <ErrorText error={error} />
    </Card>
  );
}

function OrganizerResult({ m }: { m: MatchView }) {
  const { run, error, busy } = useAction();
  const [winner, setWinner] = useState(m.team1Id ?? '');
  const [score1, setScore1] = useState(m.score1 ?? 1);
  const [score2, setScore2] = useState(m.score2 ?? 0);
  const [noShows, setNoShows] = useState<string[]>([]);
  if (!m.isOrganizer || !m.team1 || !m.team2) return null;
  const everyone = [...m.team1.members, ...m.team2.members];
  return (
    <Card title="Результат вручную (организатор)">
      <div className="form">
        <label>
          Победитель
          <select value={winner} onChange={(e) => setWinner(e.target.value)}>
            <option value={m.team1.id}>{m.team1.name}</option>
            <option value={m.team2.id}>{m.team2.name}</option>
          </select>
        </label>
        <div className="row">
          <label>
            {m.team1.name}
            <input
              type="number"
              min={0}
              value={score1}
              onChange={(e) => setScore1(Number(e.target.value))}
            />
          </label>
          <label>
            {m.team2.name}
            <input
              type="number"
              min={0}
              value={score2}
              onChange={(e) => setScore2(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="small">
          Не явились:{' '}
          {everyone.map((p) => (
            <label
              key={p.userId}
              className="checkbox"
              style={{ display: 'inline-flex', marginRight: 8 }}
            >
              <input
                type="checkbox"
                checked={noShows.includes(p.userId)}
                onChange={() =>
                  setNoShows(
                    noShows.includes(p.userId)
                      ? noShows.filter((x) => x !== p.userId)
                      : [...noShows, p.userId],
                  )
                }
              />
              {p.nickname}
            </label>
          ))}
        </div>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void run(() =>
              api.post(`/matches/${m.id}/result`, {
                winnerTeamId: winner,
                score1,
                score2,
                noShowUserIds: noShows,
              }),
            )
          }
        >
          Записать результат
        </Button>
      </div>
      <ErrorText error={error} />
    </Card>
  );
}

function Disputes({ m }: { m: MatchView }) {
  const { run, error, busy } = useAction();
  const [reason, setReason] = useState('');
  const [resolution, setResolution] = useState('');
  const hasOpen = m.disputes.some((d) => d.status === 'open');
  if (!m.isParticipant && !m.isOrganizer && m.disputes.length === 0) return null;
  return (
    <Card title="Споры">
      {m.disputes.map((d) => (
        <div key={d.id} className="list-item">
          <div>
            <div>{d.reason}</div>
            <div className="muted small">
              {formatDate(d.createdAt)} ·{' '}
              {d.status === 'open' ? 'открыт' : `решён: ${d.resolution ?? ''}`}
            </div>
          </div>
          {d.status === 'open' && m.isOrganizer && (
            <div className="row">
              <input
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Решение"
              />
              <Button
                variant="secondary"
                disabled={busy || resolution.length < 2}
                onClick={() =>
                  void run(() => api.post(`/disputes/${d.id}/resolve`, { resolution }))
                }
              >
                Оставить результат
              </Button>
            </div>
          )}
        </div>
      ))}
      {m.isOrganizer && hasOpen && (
        <p className="muted small">
          Чтобы изменить результат по спору, запишите новый в форме организатора, затем закройте
          спор.
        </p>
      )}
      {m.isParticipant && !hasOpen && (
        <div className="form">
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Что не так с результатом?"
          />
          <Button
            variant="secondary"
            disabled={busy || reason.length < 5}
            onClick={() => void run(() => api.post(`/matches/${m.id}/disputes`, { reason }))}
          >
            Открыть спор
          </Button>
        </div>
      )}
      <ErrorText error={error} />
    </Card>
  );
}

function Reviews({ m }: { m: MatchView }) {
  const { data: me } = useMe();
  const { run, error, busy } = useAction();
  const [scores, setScores] = useState<Record<string, number>>({});
  if (m.status !== 'finished' || !m.isParticipant || m.reviewedByMe || !me) return null;
  const myTeam = m.myTeamId === m.team1Id ? m.team1 : m.team2;
  const teammates = myTeam?.members.filter((p) => p.userId !== me.id) ?? [];
  if (teammates.length === 0) return null;
  return (
    <Card title="Оцените тиммейтов">
      {teammates.map((p) => (
        <div key={p.userId} className="row">
          <span style={{ minWidth: 140 }}>{p.nickname}</span>
          {[1, 2, 3, 4, 5].map((s) => (
            <Button
              key={s}
              variant={scores[p.userId] === s ? 'primary' : 'secondary'}
              onClick={() => setScores({ ...scores, [p.userId]: s })}
            >
              {s}
            </Button>
          ))}
        </div>
      ))}
      <Button
        disabled={busy || Object.keys(scores).length === 0}
        onClick={() =>
          void run(() =>
            api.post(`/matches/${m.id}/reviews`, {
              reviews: Object.entries(scores).map(([toUserId, score]) => ({ toUserId, score })),
            }),
          )
        }
      >
        Отправить оценки
      </Button>
      <ErrorText error={error} />
    </Card>
  );
}

export function MatchPage() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['match', id],
    queryFn: () => api.get<MatchView>(`/matches/${id}`),
  });
  useLiveRoom(`match:${id}`, ['match', id]);

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorText error={query.error} />;
  const m = query.data;

  return (
    <>
      <p className="muted">
        <Link to={`/tournaments/${m.tournamentId}`}>{m.tournamentTitle}</Link> · {gameTitle(m.game)}{' '}
        · {m.label}
      </p>
      <h1>
        {teamName(m.team1)} {m.score1 ?? ''} : {m.score2 ?? ''} {teamName(m.team2)}
      </h1>
      <p className="row">
        <Badge
          tone={
            m.status === 'finished' ? 'success' : m.status === 'disputed' ? 'danger' : 'neutral'
          }
        >
          {MATCH_STATUS_LABELS[m.status]}
        </Badge>
        {m.resultSource && (
          <span className="muted small">
            результат:{' '}
            {
              { api: 'API игры', client: 'десктоп-клиент / сервер', organizer: 'организатор' }[
                m.resultSource
              ]
            }
          </span>
        )}
      </p>
      <ReadyCheck m={m} />
      {m.game === 'dota2' && <Dota m={m} />}
      {m.game === 'cs2' && <Cs2 m={m} />}
      {m.game === 'fpv' && <Fpv m={m} />}
      <Reviews m={m} />
      <Disputes m={m} />
      <OrganizerResult m={m} />
    </>
  );
}
