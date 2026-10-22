import { TIER_INFO, TIERS, type Tier } from '@kiberdvor/shared';
import { Badge, Button, Card } from '@kiberdvor/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, useMe } from '../api';
import { ErrorText } from '../components/common';

export function PricingPage() {
  const { data: me } = useMe();
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<Tier | null>(null);

  const subscribe = async (tier: Tier) => {
    setError(null);
    try {
      await api.post('/billing/subscribe', { tier });
      setDone(tier);
      await client.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      setError(e);
    }
  };

  return (
    <>
      <h1>Тарифы</h1>
      <p className="muted">
        Участие в турнирах бесплатное. Деньги платформе приносит только подписка: взносов, ставок и
        призовых фондов из денег участников нет.
      </p>
      <p className="stub-note">
        Оплата пока работает в тестовом режиме: ЮKassa не подключена, тариф включается на 30 дней
        без списания денег. Подробнее — в <Link to="/legal/offer">публичной оферте</Link>.
      </p>
      <div className="grid">
        {TIERS.map((tier) => {
          const info = TIER_INFO[tier];
          const current = me?.tier === tier;
          return (
            <Card
              key={tier}
              title={
                <>
                  {info.title} {current && <Badge tone="success">ваш тариф</Badge>}
                </>
              }
            >
              <p>
                <strong>
                  {info.priceRub === 0
                    ? 'Бесплатно'
                    : `${tier === 'club' ? 'от ' : ''}${info.priceRub.toLocaleString('ru-RU')} ₽/мес`}
                </strong>
              </p>
              <ul>
                {info.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {me && tier !== 'free' && (
                <Button
                  variant={current ? 'secondary' : 'primary'}
                  onClick={() => void subscribe(tier)}
                >
                  {current ? 'Продлить на 30 дней' : 'Оформить (тест)'}
                </Button>
              )}
              {done === tier && <p className="small">Тариф активен.</p>}
            </Card>
          );
        })}
      </div>
      <ErrorText error={error} />
    </>
  );
}
