/**
 * Справка по комнатам — кнопка ℹ️ в титульной плашке (см. rooms/shell.ts).
 * Пришла на смену общей стене текста «Как играть»: игрок читает про механику
 * там, где она стоит перед глазами, и текст не разъезжается с игрой незаметно.
 *
 * ВАЖНО: тексты описывают РЕАЛЬНОЕ поведение — правишь механику, правь и здесь
 * (общая инструкция протухла именно так). Единственный источник этих строк.
 */

import { Container, Text } from 'pixi.js';
import type { UiContext } from './context.js';
import { Button, COLORS, FONT, label, panel } from './theme.js';
import { t, tx, type LocStr } from '../i18n.js';

interface RoomHelp {
  title: LocStr;
  lines: LocStr[];
}

const HELP: Record<string, RoomHelp> = {
  incubator: {
    title: ['🧬 Инкубатор — здесь рождаются котята', '🧬 Incubator — where kittens are born'],
    lines: [
      ['Для вязки нужна пара: кошка ♀ и кот ♂. Посади их в слот двумя способами — возьми кота за шкирку и донеси сюда (у края экрана комнаты листаются сами) или тапни кота → «💞 В свободный слот вязки».',
       'Breeding needs a pair: a female ♀ and a male ♂. Put them into a slot in two ways — pick a cat up by the scruff and carry it here (rooms scroll by themselves at the screen edge), or tap the cat → "💞 To a free breeding slot".'],
      ['Кнопка 🔮 анализа покажет шансы, каких котят может дать эта пара.',
       'The 🔮 analysis button shows the chances of which kittens this pair can give.'],
      ['Порода котёнка зависит от родителей — рецепты смотри в 📖 Котодексе. Близкая родня (инбридинг) может дать котёнку меньше сердец ❤ — это его запас вязок.',
       'The kitten breed depends on its parents — look the recipes up in the 📖 Catdex. Close relatives (inbreeding) can leave a kitten fewer hearts ❤ — that is its supply of breedings.'],
      ['Простая вязка занимает секунды. Затянулась — значит, готовится кто-то поинтереснее.',
       'A plain breeding takes seconds. Taking longer? Then someone more interesting is on the way.'],
      ['Готового котёнка забери из слота — в тесноте он растёт вдвое дольше.',
       'Take the ready kitten out of the slot — cramped in there it grows twice as long.'],
      ['Когда изучишь ветеринара, разблокируется шприц 💉 в правом верхнем углу. Перетащи его на кота в слоте, им можно восполнить сердца.',
       'Once you research the vet, the syringe 💉 unlocks in the top right corner. Drag it onto a cat in a slot — it restores hearts.'],
      ['Открыв учёного в улучшениях — разблокируются усилители вязки: заряди за 🧬 или 💎, они сработают на следующей паре.',
       'Unlocking the scientist in Upgrades opens the breeding boosters: charge them with 🧬 or 💎 and they fire on the next pair.'],
    ],
  },
  nursery: {
    title: ['🏆 Питомник — витрина и племфонд', '🏆 Cattery — showcase and breeding stock'],
    lines: [
      ['Перетащи кота на пьедестал — он будет приносить пассивный доход 💰/мин, тем больше, чем он ценнее. Центральное место — самое доходное.',
       'Drag a cat onto a pedestal — it brings passive income 💰/min, the more valuable the cat the more it pays. The central spot pays the most.'],
      ['Кнопка 📋 Заказы клиентов: перетащи в 🧺 корзину под ней кота нужного заказчику — получишь 💰, 💎 и опыт ⭐. Клиенты просят ценных котов, это лучший способ заработать.',
       'The 📋 Client orders button: drag the cat a client asks for into the 🧺 basket below it and get 💰, 💎 and ⭐ XP. Clients ask for valuable cats — this is the best way to earn.'],
      ['Пока есть корм, идёт доход и можно сводить пары. Кончился — всё замирает, но коты не голодают всерьёз и ничего не теряют.',
       'While there is food, income goes on and pairs can be bred. Once it runs out everything freezes, but the cats do not really starve and lose nothing.'],
      ['Правый нижний угол ❄️ криокапсула — перетащи кота, чтобы отправить его в крио-банк и освободить место. Капсулу нужно открыть в Генолабе («Криогенетика»).',
       'The bottom right corner ❄️ cryo capsule — drag a cat there to send it to the cryobank and free up space. The capsule has to be unlocked in the Genolab ("Cryogenetics").'],
    ],
  },
  shelter: {
    title: ['🏠 Приют — вход и выход поголовья', '🏠 Shelter — where cats come and go'],
    lines: [
      ['«🛒 Купить котика» даёт простого дворового со случайной неизвестной родословной. Если котов не осталось совсем — пара бесплатно.',
       '"🛒 Buy a cat" gives a plain moggie with a random, unknown pedigree. If you have no cats left at all, a pair comes free.'],
      ['Правый угол 🤝 «в добрые руки» — перетащи кота, чтобы отдать его за 💰 и опыт ⭐.',
       'The right corner 🤝 "give away" — drag a cat there to hand it over for 💰 and ⭐ XP.'],
      ['Левый угол 🧪 «в биобанк» — передать кота учёным за 🧬 ДНК. Станцию нужно открыть в Генолабе.',
       'The left corner 🧪 "to the biobank" — hand a cat over to the scientists for 🧬 DNA. The station has to be unlocked in the Genolab.'],
      ['Награда всегда считается от ценности кота.',
       'The reward always counts from the value of the cat.'],
    ],
  },
  genolab: {
    title: ['🔬 Генолаб — три вкладки', '🔬 Genolab — three tabs'],
    lines: [
      ['📖 Котодекс — твоя коллекция и рецептурник: тапни выведенную породу и увидишь, из кого её получают и с каким шансом. Чёрный силуэт — рецепт знаешь, породу ещё не вывел.',
       '📖 Catdex — your collection and recipe book: tap a breed you have bred to see which parents make it and with what chance. A black silhouette means you know the recipe but have not bred the cat yet.'],
      ['🔬 Улучшения — дерево постоянных бонусов: слоты вязки, вместимость комнат, скорость, новые станции. Ветка Селекции стоит 🧬, остальные — 💰. Уровни открываются опытом ⭐.',
       '🔬 Upgrades — a tree of permanent bonuses: breeding slots, room capacity, speed, new stations. The Selection branch costs 🧬, the rest cost 💰. Levels open with ⭐ XP.'],
      ['🧪 Исследования — за 💰 + 🧬 и время открывает рецепт новой породы из тех, что тебе уже по силам. Выводишь новые породы — пул исследований растёт.',
       '🧪 Research — for 💰 + 🧬 and some time it unlocks a recipe for a new breed among those already within your reach. Breed new cats and the research pool grows.'],
      ['Готовый результат ждёт на столе запечатанной колбой: какой рецепт достался — видно только после «Вскрыть колбу».',
       'A finished result waits on the bench as a sealed flask: which recipe you got is revealed only when you open it.'],
      ['Родословная кота скрыта туманом «???». Генетический анализ (из меню кота) вскроет предков и скрытые гены — без них часть рецептов не сработает.',
       'A cat pedigree is hidden behind "???" fog. A genetic analysis (from the cat menu) reveals ancestors and hidden genes — without them some recipes will not fire.'],
    ],
  },
  cryobank: {
    title: ['🧫 Крио-банк — хранилище генофонда', '🧫 Cryobank — the gene pool vault'],
    lines: [
      ['Криокапсула стоит в Питомнике (правый нижний угол) — перетащи туда кота, чтобы заморозить за 📺, 💰 или 💎.',
       'The cryo capsule stands in the Cattery (bottom right corner) — drag a cat there to freeze it for 📺, 💰 or 💎.'],
      ['Заморозка освобождает место в комнатах, но обратно кота уже не разморозить — решай осознанно.',
       'Freezing frees up room in your rooms, but a cat can never be thawed back — decide carefully.'],
      ['Из замороженного можно клонировать копию за 🧬 + 💰. Родословная оригинала сохраняется, поэтому клон считается роднёй своей линии.',
       'A frozen cat can be cloned for 🧬 + 💰. The pedigree of the original is kept, so the clone counts as kin of its line.'],
      ['Замороженного кота можно передать в биобанк и освободить ячейку.',
       'A frozen cat can be sent to the biobank to free the cell.'],
    ],
  },
};

/** Есть ли справка для комнаты (кнопку ℹ️ рисуем только тогда). */
export function hasRoomHelp(roomId: string): boolean {
  return roomId in HELP;
}

/** Оверлей-справка одной комнаты. */
export function buildRoomHelpPanel(ctx: UiContext, roomId: string, close: () => void): Container {
  const help = HELP[roomId];
  const W = Math.min(ctx.roomW - 40, 620);
  const pad = 22;
  const root = new Container();

  const title = label(help ? tx(help.title) : t('Справка', 'Help'), 19, COLORS.ink, '800');

  let y = 58;
  const texts: Text[] = [];
  for (const line of help?.lines ?? []) {
    const t = new Text({
      text: `• ${tx(line)}`,
      style: {
        fontFamily: FONT, fontSize: 15, fontWeight: '600', fill: COLORS.ink,
        wordWrap: true, wordWrapWidth: W - pad * 2, lineHeight: 21, align: 'left',
      },
    });
    t.anchor.set(0, 0);
    t.position.set(pad, y);
    texts.push(t);
    y += t.height + 12;
  }

  const closeBtn = new Button({ text: t('Понятно!', 'Got it!'), w: 200, h: 46, color: COLORS.primary, fontSize: 16 });
  closeBtn.position.set(W / 2, y + 28);
  closeBtn.onTap = close;

  const H = y + 58;
  root.addChild(panel(W, H, COLORS.hud, 18));
  title.position.set(W / 2, 32);
  root.addChild(title, ...texts, closeBtn);
  return root;
}
