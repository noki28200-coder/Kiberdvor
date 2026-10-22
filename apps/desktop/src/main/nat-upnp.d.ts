// Типы для nat-upnp (пакет без собственных типов). Описаны только используемые методы.
declare module 'nat-upnp' {
  interface PortMappingOptions {
    public: number;
    private: number;
    protocol?: 'TCP' | 'UDP';
    description?: string;
    ttl?: number;
  }

  interface Client {
    portMapping(options: PortMappingOptions, callback: (error: Error | null) => void): void;
    portUnmapping(
      options: { public: number; protocol?: 'TCP' | 'UDP' },
      callback: (error: Error | null) => void,
    ): void;
    externalIp(callback: (error: Error | null, ip?: string) => void): void;
    close(): void;
  }

  export function createClient(): Client;
}
