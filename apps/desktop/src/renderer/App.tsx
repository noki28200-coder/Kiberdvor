import { MATCH_STATUS_LABELS } from '@kiberdvor/shared';
import { Badge, Button, Card } from '@kiberdvor/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountState, ActiveMatch, AppInfo, ClientSettings } from '../ipc';

const bridge = window.kiberdvor;

function useAction(onDone?: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
      onDone?.();
    } catch (e) {
      // Ошибки из main приходят как «Error invoking remote method …: Error: текст».
      setError(e instanceof Error ? e.message.replace(/^.*Error: /, '') : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy };
}

function Account({
  account,
  onChange,
}: {
  account: AccountState;
  onChange: (a: AccountState) => void;
}) {
  const { run, error, busy } = useAction();
  if (!account.loggedIn) {
    return (
      <Card title="Аккаунт">
        <p>Войдите через сайт Кибердвора (Яндекс ID), чтобы получать матчи.</p>
        <Button
          disabled={busy}
          onClick={() => void run(async () => onChange(await bridge.login()))}
        >
          Войти
        </Button>
        {error && <p className="error">{error}</p>}
      </Card>
    );
  }
  return (
    <Card title="Аккаунт">
      <p>
        {account.nickname}{' '}
        <Button
          variant="secondary"
          onClick={() =>
            void run(async () => {
              await bridge.logout();
              onChange(await bridge.getAccount());
            })
          }
        >
          Выйти
        </Button>
      </p>
      {account.steamMatches === true && (
        <Badge tone="success">Запущенный Steam совпадает с привязанным</Badge>
      )}
      {account.steamMatches === false && (
        <p className="error">
          В Steam на этом ПК выполнен вход в другой аккаунт ({account.localSteamId}), а к профилю
          привязан {account.linkedSteamId}. Играть нужно с привязанного аккаунта.
        </p>
      )}
      {account.steamMatches === null && (
        <p className="muted">
          {account.linkedSteamId ? 'Steam на этом ПК не найден.' : 'Привяжите Steam на сайте.'}
        </p>
      )}
    </Card>
  );
}

function Settings({ info }: { info: AppInfo }) {
  const [settings, setSettings] = useState<ClientSettings | null>(null);
  const [gslt, setGslt] = useState('');
  const { run, error } = useAction();
  useEffect(() => {
    void bridge.getSettings().then(setSettings);
  }, []);
  if (!settings) return null;
  return (
    <Card title="Настройки">
      <div className="form">
        <label>
          Адрес сайта
          <input
            defaultValue={settings.serverUrl}
            onBlur={(e) =>
              void run(async () =>
                setSettings(await bridge.updateSettings({ serverUrl: e.target.value })),
              )
            }
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.neutralHost}
            onChange={(e) =>
              void run(async () =>
                setSettings(await bridge.updateSettings({ neutralHost: e.target.checked })),
              )
            }
          />
          Нейтральный ПК (организатор, компьютерный клуб)
        </label>
        {info.hostSupported ? (
          <label>
            GSLT — токен игрового сервера с вашего Steam-аккаунта{' '}
            {settings.hasGslt && <Badge tone="success">сохранён</Badge>}
            <div className="row">
              <input
                value={gslt}
                onChange={(e) => setGslt(e.target.value)}
                placeholder="получить: steamcommunity.com/dev/managegameservers"
              />
              <Button
                variant="secondary"
                onClick={() =>
                  void run(async () => {
                    setSettings(await bridge.updateSettings({ gslt }));
                    setGslt('');
                  })
                }
              >
                Сохранить
              </Button>
            </div>
          </label>
        ) : (
          <p className="muted small">Хостить сервер CS2 можно только с Windows.</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </Card>
  );
}

function FpvTools({ match }: { match: ActiveMatch }) {
  const [score, setScore] = useState(0);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [recordingHash, setRecordingHash] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const { run, error, busy } = useAction();

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream, { mimeType: 'video/webm' });
    r.ondataavailable = (e) => chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void new Blob(chunks, { type: 'video/webm' })
        .arrayBuffer()
        .then((buffer) =>
          bridge.saveRecording({ matchId: match.id, bytes: new Uint8Array(buffer) }),
        )
        .then(setRecordingHash);
    };
    r.start(1000);
    recorder.current = r;
    setRecording(true);
  };

  const stopRecording = () => {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  };

  return (
    <div className="form">
      <div className="row">
        {!recording ? (
          <Button variant="secondary" onClick={() => void run(startRecording)}>
            Начать запись залёта
          </Button>
        ) : (
          <Button variant="danger" onClick={stopRecording}>
            Остановить запись
          </Button>
        )}
        {recordingHash && <Badge tone="success">запись сохранена</Badge>}
        <Button
          variant="secondary"
          onClick={() => void run(async () => setScreenshot(await bridge.captureScreen()))}
        >
          Скриншот итога
        </Button>
        {screenshot && <Badge tone="success">скриншот готов</Badge>}
      </div>
      {screenshot && (
        <img
          src={`data:image/png;base64,${screenshot}`}
          alt="Скриншот итога"
          style={{ maxWidth: 320 }}
        />
      )}
      <label>
        Очки
        <input
          type="number"
          min={0}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
        />
      </label>
      <Button
        disabled={busy || !screenshot || recording}
        onClick={() =>
          void run(() =>
            bridge.submitFpv({
              matchId: match.id,
              score,
              screenshotBase64: screenshot ?? '',
              ...(recordingHash ? { recordingSha256: recordingHash } : {}),
            }),
          )
        }
      >
        Отправить результат
      </Button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function MatchCard({ match, info }: { match: ActiveMatch; info: AppInfo }) {
  const { run, error, busy } = useAction();
  const [message, setMessage] = useState<string | null>(null);
  // Выбор хоста нужен только матчам на выделенном сервере (CS2).
  const needsHost = match.game === 'cs2';
  return (
    <Card
      title={
        <>
          {match.tournamentTitle}: {match.label} <Badge>{MATCH_STATUS_LABELS[match.status]}</Badge>
          {match.isHost && <Badge tone="warning">вы хост</Badge>}
        </>
      }
    >
      <div className="row">
        <Button disabled={busy} onClick={() => void run(() => bridge.ready(match.id))}>
          Готов
        </Button>
        <Button
          variant="secondary"
          onClick={() => void bridge.openInBrowser(`/matches/${match.id}`)}
        >
          Открыть на сайте
        </Button>
        {needsHost && match.status === 'host_selection' && (
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await bridge.offerHost(match.id);
                  setMessage(r.reachable ? 'ПК предложен хостом' : 'ПК недоступен из интернета');
                })
              }
            >
              Предложить мой ПК хостом
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await bridge.measurePings(match.id);
                  setMessage(`Пинг измерен до ${r.measured} кандидатов`);
                })
              }
            >
              Измерить пинг до кандидатов
            </Button>
          </>
        )}
        {needsHost && match.isHost && match.status === 'ready_check' && (
          <Button
            disabled={busy || !info.hostSupported}
            onClick={() => void run(() => bridge.launchServer(match.id))}
          >
            Запустить сервер CS2
          </Button>
        )}
      </div>
      {match.game === 'fpv' && <FpvTools match={match} />}
      {message && <p className="muted">{message}</p>}
      {error && <p className="error">{error}</p>}
    </Card>
  );
}

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [matches, setMatches] = useState<ActiveMatch[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);

  const refreshMatches = useCallback(() => void bridge.listMatches().then(setMatches), []);

  useEffect(() => {
    void bridge.getAppInfo().then(setInfo);
    void bridge.getAccount().then(setAccount);
    const offLog = bridge.onLog((line) => setLogLines((prev) => [...prev.slice(-199), line]));
    const offMatches = bridge.onMatchesChanged(refreshMatches);
    return () => {
      offLog();
      offMatches();
    };
  }, [refreshMatches]);

  if (!info || !account) return <p style={{ padding: 16 }}>Загрузка…</p>;

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: 16 }}>
      <h1>Кибердвор</h1>
      <p className="muted">
        Версия {info.version} ·{' '}
        {info.antiCheatProvider === 'noop' ? (
          <Badge tone="warning">публичная сборка без античита</Badge>
        ) : (
          <Badge tone="success">античит: {info.antiCheatProvider}</Badge>
        )}
      </p>
      <Account account={account} onChange={setAccount} />
      {account.loggedIn && (
        <>
          <h2>Мои матчи</h2>
          {matches.length === 0 && (
            <p className="muted">Активных матчей нет. Клиент проверяет каждые 10 секунд.</p>
          )}
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} info={info} />
          ))}
        </>
      )}
      <Settings info={info} />
      {logLines.length > 0 && (
        <Card title="Журнал">
          <pre className="log">{logLines.join('\n')}</pre>
        </Card>
      )}
    </main>
  );
}
