import { Button } from '@kiberdvor/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { api, useMe } from '../api';
import { resetSocket, useNotifications } from '../hooks/realtime';

export function Layout() {
  const { data: me } = useMe();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { items, dismiss } = useNotifications();

  const logout = async () => {
    await api.post('/auth/logout');
    resetSocket();
    await client.invalidateQueries();
    void navigate('/');
  };

  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="logo">
          Кибердвор
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            Турниры
          </NavLink>
          <NavLink to="/leaderboard/dota2">Рейтинг</NavLink>
          <NavLink to="/pricing">Тарифы</NavLink>
          {me ? (
            <>
              <NavLink to="/profile">{me.nickname}</NavLink>
              <Button variant="secondary" onClick={() => void logout()}>
                Выйти
              </Button>
            </>
          ) : (
            <NavLink to="/login">Войти</NavLink>
          )}
        </nav>
      </header>

      {me && (!me.consentGiven || !me.steam) && (
        <div className="banner">
          Чтобы участвовать в турнирах, завершите регистрацию:{' '}
          <Link to="/onboarding">согласие на обработку данных и привязка Steam</Link>.
        </div>
      )}

      <main className="main">
        <Outlet />
      </main>

      <footer className="footer">
        <Link to="/legal/privacy">Политика конфиденциальности</Link>
        <Link to="/legal/consent">Согласие на обработку ПД</Link>
        <Link to="/legal/terms">Пользовательское соглашение</Link>
        <Link to="/legal/offer">Публичная оферта</Link>
      </footer>

      <div className="toasts" aria-live="polite">
        {items.map((n) => (
          <div key={n.id} className="toast">
            <span>{n.text}</span>
            {n.link && (
              <Link to={n.link} onClick={() => dismiss(n.id)}>
                Открыть
              </Link>
            )}
            <button
              type="button"
              className="toast__close"
              onClick={() => dismiss(n.id)}
              aria-label="Закрыть"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
