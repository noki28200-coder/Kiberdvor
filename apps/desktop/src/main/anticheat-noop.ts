// Реализация по умолчанию для публичной сборки. Приватная живёт в packages/private/src/client.ts
// и подставляется вместо этого файла при сборке (см. build.mjs).
export { noopClientAntiCheat as clientAntiCheat } from '@kiberdvor/shared';
