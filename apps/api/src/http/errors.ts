import type { FastifyError, FastifyInstance } from 'fastify';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = 'Войдите через Яндекс ID') => new HttpError(401, message);
export const forbidden = (message = 'Недостаточно прав') => new HttpError(403, message);
export const notFound = (message = 'Не найдено') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

/** Нарушение уникального индекса PostgreSQL. */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown; cause?: { code?: unknown } }).code;
  const causeCode = (error as { cause?: { code?: unknown } }).cause?.code;
  return code === '23505' || causeCode === '23505';
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.status).send({ message: error.message });
    }
    if ('validation' in error && error.validation) {
      return reply
        .status(400)
        .send({ message: 'Проверьте введённые данные', issues: error.validation });
    }
    if (isUniqueViolation(error)) {
      return reply.status(409).send({ message: 'Такая запись уже существует' });
    }
    if ('statusCode' in error && error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ message: error.message });
    }
    request.log.error(error);
    return reply.status(500).send({ message: 'Внутренняя ошибка сервера' });
  });
}
