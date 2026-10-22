import type { AuthConfig } from '@kiberdvor/shared';
import { Badge, Button, Card } from '@kiberdvor/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { api, useMe } from '../api';
import { ErrorText, Loading } from '../components/common';

const STEAM_ERRORS: Record<string, string> = {
  steam: 'Steam не подтвердил вход. Попробуйте ещё раз.',
  steam_taken:
    'Этот Steam-аккаунт уже привязан к другому пользователю. Один человек — один аккаунт.',
};

export function OnboardingPage() {
  const { data: me, isPending } = useMe();
  const config = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api.get<AuthConfig>('/auth/config'),
  });
  const [params] = useSearchParams();
  const client = useQueryClient();
  const [nickname, setNickname] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [acceptPd, setAcceptPd] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [steamId, setSteamId] = useState('');
  const [error, setError] = useState<unknown>(null);

  if (isPending) return <Loading />;
  if (!me) return <Navigate to="/login" />;

  const submitConsent = async () => {
    setError(null);
    try {
      await api.post('/me/consent', {
        acceptPd,
        acceptTerms,
        nickname: nickname || me.nickname,
        ...(me.birthDate ? {} : { birthDate }),
      });
      await client.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      setError(e);
    }
  };

  const devSteam = async () => {
    setError(null);
    try {
      await api.post('/auth/dev-steam', { steamId });
      await client.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      setError(e);
    }
  };

  const steamError = params.get('error');

  return (
    <>
      <h1>Регистрация</h1>
      <Card
        title={
          <>
            1. Согласие на обработку данных{' '}
            {me.consentGiven && <Badge tone="success">готово</Badge>}
          </>
        }
      >
        {me.consentGiven ? (
          <p>Согласие получено. Ник: {me.nickname}.</p>
        ) : (
          <div className="form">
            <p className="muted">
              Из Яндекс ID мы берём только логин, email и дату рождения. Публично видны лишь ник,
              аватар и рейтинг.
            </p>
            <label>
              Ник на платформе
              <input
                value={nickname}
                placeholder={me.nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </label>
            {!me.birthDate && (
              <label>
                Дата рождения (Яндекс ID её не передал)
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                />
              </label>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={acceptPd}
                onChange={(e) => setAcceptPd(e.target.checked)}
              />
              <span>
                Даю <Link to="/legal/consent">согласие на обработку персональных данных</Link> в
                соответствии с <Link to="/legal/privacy">политикой конфиденциальности</Link>
              </span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
              />
              <span>
                Принимаю <Link to="/legal/terms">пользовательское соглашение</Link>
              </span>
            </label>
            <Button disabled={!acceptPd || !acceptTerms} onClick={() => void submitConsent()}>
              Сохранить
            </Button>
          </div>
        )}
      </Card>

      <Card title={<>2. Привязка Steam {me.steam && <Badge tone="success">готово</Badge>}</>}>
        {steamError && (
          <p className="error">{STEAM_ERRORS[steamError] ?? 'Не удалось привязать Steam'}</p>
        )}
        {me.steam ? (
          <p>
            Steam привязан: {me.steam.personaName ?? me.steam.steamId}. Отвязать или сменить аккаунт
            нельзя — так платформа защищается от смурфов.
          </p>
        ) : (
          <>
            <p>
              Без привязки Steam нельзя заявиться на турнир. Один Steam — один аккаунт на платформе.
            </p>
            <Button
              disabled={!me.consentGiven}
              onClick={() => (window.location.href = '/api/auth/steam')}
            >
              Привязать через Steam
            </Button>
            {config.data?.dev && (
              <div className="form" style={{ marginTop: 16 }}>
                <p className="stub-note">Тестовая привязка без входа в Steam (DEV_AUTH).</p>
                <label>
                  SteamID64
                  <input
                    value={steamId}
                    onChange={(e) => setSteamId(e.target.value)}
                    placeholder="76561198000000001"
                  />
                </label>
                <Button
                  variant="secondary"
                  disabled={!me.consentGiven}
                  onClick={() => void devSteam()}
                >
                  Привязать тестовый Steam
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      <ErrorText error={error} />

      {me.consentGiven && me.steam && (
        <Card title="3. Анкета">
          <p>
            Заполните <Link to="/profile">анкету по игре</Link>: по ней капитаны выбирают игроков в
            драфте.
          </p>
        </Card>
      )}
    </>
  );
}
