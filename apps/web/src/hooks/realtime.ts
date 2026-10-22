import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** Одно соединение на вкладку. Личная комната user:<id> назначается сервером по куке сессии. */
export function getSocket(): Socket {
  socket ??= io({ path: '/socket.io', withCredentials: true });
  return socket;
}

/** Переподключение после входа, чтобы сервер увидел новую сессию. */
export function resetSocket() {
  socket?.disconnect();
  socket = null;
}

/** Подписка на комнату: при событии перезапрашиваем нужные данные. */
export function useLiveRoom(room: string | null, queryKey: unknown[]) {
  const client = useQueryClient();
  const key = JSON.stringify(queryKey);
  useEffect(() => {
    if (!room) return;
    const s = getSocket();
    const subscribe = () => s.emit('subscribe', room);
    subscribe();
    s.on('connect', subscribe);
    const refresh = () => void client.invalidateQueries({ queryKey: JSON.parse(key) as unknown[] });
    s.on('tournament:update', refresh);
    s.on('match:update', refresh);
    return () => {
      s.emit('unsubscribe', room);
      s.off('connect', subscribe);
      s.off('tournament:update', refresh);
      s.off('match:update', refresh);
    };
  }, [room, key, client]);
}

export interface LiveNotification {
  id: number;
  text: string;
  link?: string;
}

export function useNotifications() {
  const [items, setItems] = useState<LiveNotification[]>([]);
  useEffect(() => {
    const s = getSocket();
    let counter = 0;
    const onNotification = (n: { text: string; link?: string }) => {
      counter += 1;
      const item = { id: counter, ...n };
      setItems((prev) => [...prev.slice(-3), item]);
      setTimeout(() => setItems((prev) => prev.filter((p) => p.id !== item.id)), 10000);
    };
    s.on('notification', onNotification);
    return () => {
      s.off('notification', onNotification);
    };
  }, []);
  return { items, dismiss: (id: number) => setItems((prev) => prev.filter((p) => p.id !== id)) };
}

/** Секунды до дедлайна, обновляются каждую секунду. */
export function useCountdown(deadline: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000)) : null;
}
