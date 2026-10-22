import type { AuthConfig } from '@kiberdvor/shared';
import { Button, Card } from '@kiberdvor/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { ErrorText } from '../components/common';
import { resetSocket } from '../hooks/realtime';

export function LoginPage() {
  const config = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api.get<AuthConfig>('/auth/config'),
  });
  const [params] = useSearchParams();
  const [login, setLogin] = useState('');
  const [error, setError] = useState<unknown>(null);
  const client = useQueryClient();
  const navigate = useNavigate();

  const devLogin = async () => {
    try {
      await api.post('/auth/dev-login', { login });
      resetSocket();
      await client.invalidateQueries();
      void navigate('/onboarding');
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Card title="Вход">
      <p>
        На платформу входят только через Яндекс ID: за каждым аккаунтом стоит реальный человек, а
        смурфы и фейки не проходят.
      </p>
      {params.get('error') && (
        <p className="error">Яндекс ID не подтвердил вход, попробуйте ещё раз.</p>
      )}
      {config.data?.yandex ? (
        <Button onClick={() => (window.location.href = '/api/auth/yandex')}>
          Войти через Яндекс ID
        </Button>
      ) : (
        <p className="muted">Вход через Яндекс ID ещё не настроен на сервере.</p>
      )}

      {config.data?.dev && (
        <div className="form" style={{ marginTop: 24 }}>
          <p className="stub-note">
            Тестовый вход для разработки и демо (DEV_AUTH). В production его нет.
          </p>
          <label>
            Логин
            <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="player1" />
          </label>
          <Button variant="secondary" disabled={login.length < 2} onClick={() => void devLogin()}>
            Тестовый вход
          </Button>
          <ErrorText error={error} />
        </div>
      )}
    </Card>
  );
}
