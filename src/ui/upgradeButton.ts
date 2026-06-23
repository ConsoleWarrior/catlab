/**
 * Кнопка апгрейда: подпись + стоимость, покупка через buyUpgrade.
 * Сама определяет доступность (хватает ресурсов / не максимум).
 */

import { Button, COLORS } from './theme.js';
import type { UiContext } from './context.js';
import { UPGRADES, buyUpgrade, upgradeCost, upgradeMaxed } from '../game/index.js';
import type { Currency } from '../game/index.js';

export const CUR_GLYPH: Record<Currency, string> = { coins: '💰', crystals: '💎', dna: '🧬' };

export function upgradeButton(ctx: UiContext, id: string, w = 256): Button {
  const def = UPGRADES[id]!;
  const maxed = upgradeMaxed(ctx.state, id);
  const cost = upgradeCost(ctx.state, id);
  const text = maxed || !cost
    ? `${def.label}\nМАКС`
    : `${def.label}\n${cost.amount} ${CUR_GLYPH[cost.currency]}`;
  const b = new Button({ text, w, h: 52, color: COLORS.secondary, fontSize: 14 });
  b.enabled = !maxed && cost != null && ctx.state[cost.currency] >= cost.amount;
  b.onTap = () => {
    const r = buyUpgrade(ctx.state, id);
    if (r.ok) ctx.commit();
    else ctx.toast(r.reason);
  };
  return b;
}
