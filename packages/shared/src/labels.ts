import type { MatchStatus, TournamentFormat, TournamentStatus } from './tournament';

export const FORMAT_LABELS: Record<TournamentFormat, string> = {
  single_elimination: 'Single elimination',
  double_elimination: 'Double elimination',
  swiss: 'Швейцарская система',
};

export const TOURNAMENT_STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Черновик',
  registration_open: 'Регистрация открыта',
  registration_closed: 'Регистрация закрыта',
  drafting: 'Идёт драфт',
  in_progress: 'Идёт турнир',
  finished: 'Завершён',
  cancelled: 'Отменён',
};

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled: 'Ожидает',
  host_selection: 'Выбор хоста',
  ready_check: 'Проверка готовности',
  live: 'Идёт',
  awaiting_result: 'Ждём результат',
  disputed: 'Спор',
  finished: 'Завершён',
};
