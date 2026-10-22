import { GAME_INFO, ROLE_LABELS, type Game, type PlayerCard } from '@kiberdvor/shared';
import { Badge } from '@kiberdvor/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { errorText } from '../api';

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="error">{errorText(error)}</p>;
}

export function Loading() {
  return <p className="muted">Загрузка…</p>;
}

export function gameTitle(game: Game) {
  return GAME_INFO[game].title;
}

export function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Карточка игрока для драфта и составов: анкета, рейтинг, репутация. */
export function PlayerInfo({ player, actions }: { player: PlayerCard; actions?: ReactNode }) {
  const p = player.profile;
  const rep = player.reputation;
  return (
    <div className="player">
      <div className="player__head">
        {player.avatarUrl && <img className="avatar" src={player.avatarUrl} alt="" />}
        <Link to={`/users/${player.userId}`} className="player__name">
          {player.nickname}
        </Link>
        <Badge>{player.rating}</Badge>
        {actions}
      </div>
      {p && (
        <div className="player__details">
          <div>
            {p.roles.map((r) => (
              <Badge key={r}>{roleLabel(r)}</Badge>
            ))}
            {p.rankInGame && <span className="muted"> · {p.rankInGame}</span>}
            {p.hoursPlayed !== null && <span className="muted"> · {p.hoursPlayed} ч</span>}
          </div>
          <div className="muted">
            {p.availability || 'время не указано'} · {p.hasMic ? 'есть микрофон' : 'без микрофона'}{' '}
            · {p.languages.join(', ')}
          </div>
          {p.pitch && <div className="pitch">«{p.pitch}»</div>}
          {p.clips.length > 0 && (
            <div>
              {p.clips.map((c) => (
                <a key={c} href={c} target="_blank" rel="noreferrer">
                  клип
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="muted small">
        Репутация:{' '}
        {rep.reviewAvg !== null ? `${rep.reviewAvg}/5 (${rep.reviewCount})` : 'нет оценок'} · неявок{' '}
        {rep.noShows} · споров {rep.disputes}
      </div>
    </div>
  );
}
