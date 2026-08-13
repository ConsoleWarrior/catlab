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
    title: ['🧬 Инкубатор — здесь появляются котята', '🧬 Incubator — where kittens come from'],
    lines: [
      ['Вязке нужна пара: кошка ♀ и кот ♂. Посади их в слот двумя способами — возьми кота за шкирку и донеси сюда (у края экрана комнаты листаются сами) или тапни кота → «💞 В свободный слот вязки».',
       'Breeding needs a pair: a female ♀ and a male ♂. Put them into a slot in two ways — pick a cat up by the scruff and carry it here (rooms scroll by themselves at the screen edge), or tap the cat → "💞 To a free breeding slot".'],
      ['«Свести 🐾» запускает таймер. Кнопка 🔮 рядом покажет, каких котят может дать эта пара.',
       '"Breed 🐾" starts the timer. The 🔮 button next to it shows which kittens this pair can give.'],
      ['Порода котёнка зависит от родителей — рецепты смотри в 📖 Котодексе. Близкая родня даёт котёнку меньше сердец ❤ — это его запас вязок на всю жизнь.',
       'The kitten breed depends on its parents — look the recipes up in the 📖 Catdex. Close relatives leave a kitten fewer hearts ❤ — that is its lifetime supply of breedings.'],
      ['Таймер торопится за 💎 или по 📺. Готового котёнка забери из слота — иначе он растёт медленнее.',
       'The timer can be rushed with 💎 or an ad 📺. Take the ready kitten out of the slot — otherwise it grows more slowly.'],
      ['Шприц 💉 в правом верхнем углу — ветеринар: перетащи его на кота в слоте, и он вернёт потраченные вязки. «Старого» кота тоже можно посадить в слот — ради лечения.',
       'The syringe 💉 in the top right corner is the vet: drag it onto a cat in a slot and it gives spent breedings back. An "Old" cat can be put into a slot too — just for healing.'],
      ['Чипы у названия комнаты — усилители вязки: заряди за 🧬 или 💎, сработают на следующей паре.',
       'The chips by the room title are breeding boosters: charge them with 🧬 or 💎 and they fire on the next pair.'],
    ],
  },
  nursery: {
    title: ['🏆 Питомник — витрина и племфонд', '🏆 Cattery — showcase and breeding stock'],
    lines: [
      ['Здесь живут ценные коты. Из них ты собираешь пары для вязки — именно отсюда носят котов в Инкубатор.',
       'This is where your valuable cats live. You assemble breeding pairs from them — cats are carried to the Incubator from here.'],
      ['Дуга у стены — выставка. Перетащи кота на пьедестал: чемпион приносит пассивный доход 💰/мин, тем больше, чем он ценнее. Центральное место — самое доходное.',
       'The arc by the wall is the show. Drag a cat onto a pedestal: a champion brings passive income 💰/min, the more valuable the cat the more it pays. The central spot pays the most.'],
      ['Кнопка 📋 Заказы слева под названием: перетащи в 🧺 корзину под ней кота под заказ — получишь 💰, 💎 и опыт ⭐. Клиенты просят ценных котов, поэтому доска и стоит здесь.',
       'The 📋 Orders button on the left under the room title: drag a matching cat into the 🧺 basket below it and get 💰, 💎 and ⭐ XP. Clients ask for valuable cats, which is why the board is here.'],
      ['Кормушка справа вверху: пока есть корм, идёт доход и вязки. Кончился — всё замирает, но коты не голодают всерьёз и ничего не теряют.',
       'The feeder is at the top right: while there is food, income and breeding go on. Once it runs out everything freezes, but the cats do not really starve and lose nothing.'],
      ['Тап по коту — меню: имя, признаки, родословная, переезд, отправка в слот вязки.',
       'Tap a cat for its menu: name, traits, pedigree, moving between rooms, sending to a breeding slot.'],
    ],
  },
  shelter: {
    title: ['🏠 Приют — вход и выход поголовья', '🏠 Shelter — where cats come and go'],
    lines: [
      ['Сюда попадают новички и лишние коты. «🛒 Купить котика» даёт простого дворового; если котов не осталось совсем — пара бесплатно.',
       'Newcomers and spare cats end up here. "🛒 Buy a cat" gives a plain moggie; if you have no cats left at all, a pair comes free.'],
      ['Правый угол 🤝 «в добрые руки» — перетащи кота, чтобы отдать его за 💰 и опыт ⭐. Так избавляются от ненужных.',
       'The right corner 🤝 "give away" — drag a cat there to hand it over for 💰 and ⭐ XP. That is how you part with the ones you do not need.'],
      ['Левый угол 🧪 «в биобанк» — передать кота учёным за 🧬 ДНК. Станцию нужно открыть в Генолабе.',
       'The left corner 🧪 "to the biobank" — hand a cat over to the scientists for 🧬 DNA. The station has to be unlocked in the Genolab.'],
      ['Награда всегда считается от ценности кота. Породистого не пристраивай — унеси в Питомник: там и выставка, и 📋 заказы клиентов.',
       'The reward always counts from the value of the cat. Do not give a pedigreed one away — take it to the Cattery: the show and the 📋 client orders are both there.'],
    ],
  },
  genolab: {
    title: ['🔬 Генолаб — три вкладки', '🔬 Genolab — three tabs'],
    lines: [
      ['📖 Котодекс — твоя коллекция и рецептурник: тапни выведенную породу и увидишь, из кого её получают и с каким шансом. Чёрный силуэт — рецепт знаешь, породу ещё не вывел.',
       '📖 Catdex — your collection and recipe book: tap a breed you have bred to see which parents make it and with what chance. A black silhouette means you know the recipe but have not bred the cat yet.'],
      ['🔬 Улучшения — дерево постоянных бонусов: слоты вязки, вместимость комнат, скорость, новые станции. Ветка Селекции стоит 🧬, остальные — 💰. Уровни открываются опытом ⭐.',
       '🔬 Upgrades — a tree of permanent bonuses: breeding slots, room capacity, speed, new stations. The Selection branch costs 🧬, the rest cost 💰. Levels open with ⭐ XP.'],
      ['🧪 Исследования — стол: за 💰 + 🧬 и время открывает рецепт новой породы из тех, что тебе уже по силам. Выводишь новые породы — пул исследований растёт.',
       '🧪 Research — the bench: for 💰 + 🧬 and some time it unlocks a recipe for a new breed among those already within your reach. Breed new cats and the research pool grows.'],
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
