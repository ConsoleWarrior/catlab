"""
Раскрой кошачьего комплекса (Приют) на статичную часть и подвижные игрушки.

Спрайт `decor/tower3_seed1002.webp` нарисован ИИ целиком: помпон на верёвке и
шарик на нитке впечатаны в текстуру и висят намертво. Чтобы они закачались
(см. `src/ui/hangingToy.ts`), обе игрушки ВЫРЕЗАЮТСЯ в свои маленькие текстуры
с точкой подвеса вверху, а из комплекса стираются (остаётся только «сучок»
крепления под площадкой — он прикрывает шов).

    python scripts/cut_toy.py            # dry-run: только отчёт и превью
    python scripts/cut_toy.py --apply    # переписать tower3 + создать toy_*.webp

Скрипт идемпотентен только в одну сторону: он режет ОРИГИНАЛЬНЫЙ спрайт.
Повторный прогон по уже обрезанному даст пустые игрушки — если нужно
переразметить, сначала верните оригинал: git checkout src/assets/decor/tower3_seed1002.webp

Координаты — пиксели текстуры комплекса (613×896), размечены по альфа-скану.
Они же продублированы в src/ui/rooms/shelter.ts (SHELTER_TOYS) — там из них
считается точка подвеса в координатах комнаты.
"""

import argparse
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECOR = os.path.join(ROOT, 'src', 'assets', 'decor')
TOWER = os.path.join(DECOR, 'tower3_seed1002.webp')

# Помпон на витой верёвке (длинная, до уровня головы кота) и шарик на нитке.
# rope/thread — прямоугольник «подвеса», ball — круг мячика (x, y, r).
TOYS = [
    {
        'name': 'toy_pom',
        'rope': (459, 352, 481, 632),      # x0, y0, x1, y1 — витая верёвка
        'ball': (472, 650, 30),            # помпон (радиус с запасом на пушистый край)
        'pivot': (467, 352),               # точка подвеса (под «сучком» площадки)
        'crop': (442, 350, 503, 682),
    },
    {
        'name': 'toy_bead',
        'rope': (482, 340, 490, 430),      # тонкая нитка
        'ball': (491, 445, 20),            # гладкий шарик
        'pivot': (485, 340),
        'crop': (471, 338, 513, 468),
    },
]


def mask_of(size, toy, grow=0):
    """Маска игрушки: прямоугольник верёвки + круг мячика (grow — расширить)."""
    m = Image.new('L', size, 0)
    d = ImageDraw.Draw(m)
    x0, y0, x1, y1 = toy['rope']
    d.rectangle((x0 - grow, y0 - grow, x1 + grow, y1 + grow), fill=255)
    cx, cy, r = toy['ball']
    d.ellipse((cx - r - grow, cy - r - grow, cx + r + grow, cy + r + grow), fill=255)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    tower = Image.open(TOWER).convert('RGBA')
    size = tower.size
    keep = [mask_of(size, t) for t in TOYS]
    # шарик на нитке висит вплотную к витой верёвке: из маски помпона вычитаем
    # круг шарика, иначе его левый бок уехал бы в текстуру верёвки
    ball_b = Image.new('L', size, 0)
    cx, cy, r = TOYS[1]['ball']
    ImageDraw.Draw(ball_b).ellipse((cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3), fill=255)
    # ...но только правее самого шарика (x>=473): круг задан с запасом и левым
    # краем цепляет витую верёвку — вычитание выгрызло бы в ней зарубку
    ImageDraw.Draw(ball_b).rectangle((0, 0, 472, size[1]), fill=0)
    keep[0] = Image.composite(Image.new('L', size, 0), keep[0], ball_b)

    for toy, m in zip(TOYS, keep):
        cut = Image.new('RGBA', size, (0, 0, 0, 0))
        cut.paste(tower, (0, 0), m)
        cut = cut.crop(toy['crop'])
        px, py = toy['pivot']
        cx, cy, _ = toy['ball']
        out = os.path.join(DECOR, toy['name'] + '.webp')
        print(f"{toy['name']}: {cut.size} pivot=({px - toy['crop'][0]},{py - toy['crop'][1]}) "
              f"ball=({cx - toy['crop'][0]},{cy - toy['crop'][1]}) len={cy - py}")
        if args.apply:
            cut.save(out, 'WEBP', quality=92, method=6)

    # стираем обе игрушки из комплекса — с запасом в 2px, чтобы не осталось
    # полупрозрачной каймы от сглаживания
    erase = Image.new('L', size, 0)
    for toy in TOYS:
        erase = ImageChops.lighter(erase, mask_of(size, toy, grow=2))
    erase = erase.filter(ImageFilter.GaussianBlur(0.6))  # мягкий край реза
    clean = tower.copy()
    clean.putalpha(Image.composite(Image.new('L', size, 0), tower.split()[3], erase))
    if args.apply:
        clean.save(TOWER, 'WEBP', quality=88, method=6)
        print('tower3_seed1002.webp: игрушки стёрты')
    else:
        print('dry-run: ничего не записано (--apply)')


if __name__ == '__main__':
    main()
