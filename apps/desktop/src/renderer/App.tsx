import { Badge, Card } from '@kiberdvor/ui';
import { useEffect, useState } from 'react';
import type { AppInfo } from '../ipc';

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void window.kiberdvor.getAppInfo().then(setInfo);
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1>Кибердвор</h1>
      <Card title="Клиент">
        {info ? (
          <p>
            Версия {info.version}, {info.platform}.{' '}
            {info.antiCheatProvider === 'noop' ? (
              <Badge tone="warning">Публичная сборка без античита</Badge>
            ) : (
              <Badge tone="success">Античит: {info.antiCheatProvider}</Badge>
            )}
          </p>
        ) : (
          <p>Загрузка…</p>
        )}
      </Card>
      <Card title="Матчи">
        <p>Уведомления о матчах, выбор хоста и запуск сервера CS2 появятся здесь.</p>
      </Card>
    </main>
  );
}
