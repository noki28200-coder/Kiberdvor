import {
  GAME_ROLES,
  GAMES,
  LANGUAGES,
  PITCH_MAX_LENGTH,
  TIER_INFO,
  type Game,
  type PublicProfile,
} from '@kiberdvor/shared';
import { Badge, Button, Card } from '@kiberdvor/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api, useMe } from '../api';
import { ErrorText, gameTitle, Loading, roleLabel } from '../components/common';

function ProfileForm({ game, profile }: { game: Game; profile: PublicProfile | undefined }) {
  const client = useQueryClient();
  const [roles, setRoles] = useState<string[]>(profile?.roles ?? []);
  const [availability, setAvailability] = useState(profile?.availability ?? '');
  const [hasMic, setHasMic] = useState(profile?.hasMic ?? true);
  const [languages, setLanguages] = useState<string[]>(profile?.languages ?? ['ru']);
  const [pitch, setPitch] = useState(profile?.pitch ?? '');
  const [clips, setClips] = useState((profile?.clips ?? []).join('\n'));
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await api.put('/profiles', {
        game,
        roles,
        availability,
        hasMic,
        languages,
        pitch,
        clips: clips
          .split('\n')
          .map((c) => c.trim())
          .filter(Boolean),
      });
      setSaved(true);
      await client.invalidateQueries({ queryKey: ['profiles'] });
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="form">
      <div>
        Роли:{' '}
        {GAME_ROLES[game].map((role) => (
          <label
            key={role}
            className="checkbox"
            style={{ display: 'inline-flex', marginRight: 12 }}
          >
            <input
              type="checkbox"
              checked={roles.includes(role)}
              onChange={() => setRoles(toggle(roles, role))}
            />
            {roleLabel(role)}
          </label>
        ))}
      </div>
      <label>
        Когда можете играть
        <input
          value={availability}
          onChange={(e) => setAvailability(e.target.value)}
          placeholder="будни после 19:00 (МСК+4)"
        />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={hasMic} onChange={(e) => setHasMic(e.target.checked)} />
        Есть микрофон
      </label>
      <div>
        Языки:{' '}
        {LANGUAGES.map((lang) => (
          <label
            key={lang}
            className="checkbox"
            style={{ display: 'inline-flex', marginRight: 12 }}
          >
            <input
              type="checkbox"
              checked={languages.includes(lang)}
              onChange={() => setLanguages(toggle(languages, lang))}
            />
            {lang === 'ru' ? 'русский' : 'английский'}
          </label>
        ))}
      </div>
      <label>
        Почему меня стоит пикнуть ({pitch.length}/{PITCH_MAX_LENGTH})
        <textarea
          rows={3}
          maxLength={PITCH_MAX_LENGTH}
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
        />
      </label>
      <label>
        Ссылки на клипы (https, по одной в строке; без подписки — одна)
        <textarea rows={2} value={clips} onChange={(e) => setClips(e.target.value)} />
      </label>
      {profile && (
        <p className="muted small">
          Ранг в игре: {profile.rankInGame ?? 'нет данных'} · часов:{' '}
          {profile.hoursPlayed ?? 'профиль Steam закрыт или нет ключа API'}. Эти поля сайт берёт
          сам, вручную они не редактируются.
        </p>
      )}
      <Button disabled={roles.length === 0 || languages.length === 0} onClick={() => void save()}>
        Сохранить анкету
      </Button>
      {saved && <Badge tone="success">Сохранено</Badge>}
      <ErrorText error={error} />
    </div>
  );
}

export function ProfilePage() {
  const { data: me, isPending } = useMe();
  const [game, setGame] = useState<Game>('dota2');
  const profiles = useQuery({
    queryKey: ['profiles'],
    queryFn: () => api.get<PublicProfile[]>('/profiles'),
    enabled: Boolean(me),
  });
  const [telegramCode, setTelegramCode] = useState<string | null>(null);
  const [telegramError, setTelegramError] = useState<unknown>(null);

  if (isPending) return <Loading />;
  if (!me) return <Navigate to="/login" />;

  const linkTelegram = async () => {
    try {
      setTelegramCode((await api.post<{ code: string }>('/me/telegram-link')).code);
    } catch (e) {
      setTelegramError(e);
    }
  };

  return (
    <>
      <h1>{me.nickname}</h1>
      <p className="muted">
        <Link to={`/users/${me.id}`}>Публичный профиль</Link> · тариф «{TIER_INFO[me.tier].title}»
        {me.tierActiveUntil && ` до ${new Date(me.tierActiveUntil).toLocaleDateString('ru-RU')}`} ·{' '}
        <Link to="/pricing">сменить</Link>
      </p>
      {(!me.consentGiven || !me.steam) && (
        <p>
          Сначала <Link to="/onboarding">завершите регистрацию</Link>.
        </p>
      )}

      <Card title="Анкета">
        <div className="tabs">
          {GAMES.map((g) => (
            <Button
              key={g}
              variant={g === game ? 'primary' : 'secondary'}
              onClick={() => setGame(g)}
            >
              {gameTitle(g)}
            </Button>
          ))}
        </div>
        {profiles.isPending ? (
          <Loading />
        ) : (
          <ProfileForm
            key={game}
            game={game}
            profile={profiles.data?.find((p) => p.game === game)}
          />
        )}
      </Card>

      <Card title="Уведомления в Telegram">
        {telegramCode ? (
          <p>
            Отправьте боту команду <code>/start {telegramCode}</code>.
          </p>
        ) : (
          <Button variant="secondary" onClick={() => void linkTelegram()}>
            Получить код привязки
          </Button>
        )}
        <ErrorText error={telegramError} />
      </Card>
    </>
  );
}
