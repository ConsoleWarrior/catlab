/**
 * Реестр готовых фонов комнат (ИИ-арт «комната-коробка» в нашей перспективе).
 * Если для комнаты есть фон — `roomShell` рисует его на всю комнату вместо
 * процедурной коробки; коты «живого пола» по той же геометрии встают сверху.
 * Нет фона — фолбэк на процедурную коробку (как было).
 */
import type { Texture } from 'pixi.js';

const bgs = new Map<string, Texture>();

export function setRoomBg(id: string, tex: Texture): void {
  bgs.set(id, tex);
}

export function roomBg(id: string): Texture | undefined {
  return bgs.get(id);
}
