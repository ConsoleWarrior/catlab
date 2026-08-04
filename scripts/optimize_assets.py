"""
Ужатие ассетов под лимит размера игры Яндекса (GDD §5).

Что делает: даунскейлит PNG до экранного размера и пересохраняет в WebP
(альфа сохраняется) РЯДОМ с оригиналом. Сами PNG не трогает — после проверки
игры они удаляются вручную (`git rm src/assets/<папка>/*.png`), история в git
остаётся, так что откат всегда возможен.

Профили подобраны под виртуальную сцену 720p при resolution ≤2 (game.ts):
кот на экране максимум ~220 логических px → 512 текстурных с запасом.

    python scripts/optimize_assets.py                   # dry-run: только отчёт
    python scripts/optimize_assets.py --apply           # записать .webp рядом с .png
    python scripts/optimize_assets.py --apply --music   # + перекодировать музыку (нужен ffmpeg)

Новые спрайты пород кладутся в src/assets/breeds как PNG 1024×1024 и
прогоняются этим же скриптом.
"""

import argparse
import glob
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# папка → (макс. сторона или None = не масштабировать, качество WebP, есть ли альфа)
PROFILES = {
    'breeds': (512, 90, True),   # спрайты пород: 1024² → 512², самый крупный показ — слот инкубатора
    'decor':  (896, 88, True),   # интерьерные спрайты: до ~половины высоты комнаты
    'rooms':  (None, 88, False), # фоны комнат: размер как есть (уже 1280×768), альфа не нужна
    'hud':    (None, 90, True),  # плашка топ-бара
}

# Фоновая музыка: исходники были 256 kbps — для зацикленного эмбиента избыточно.
MUSIC_KBPS = 112


def convert(path: str, max_side: int | None, quality: int, alpha: bool, apply: bool) -> tuple[int, int]:
    """PNG → WebP рядом с оригиналом. Возвращает (было байт, стало байт)."""
    before = os.path.getsize(path)
    with Image.open(path) as im:
        im = im.convert('RGBA' if alpha else 'RGB')
        if max_side and max(im.size) > max_side:
            k = max_side / max(im.size)
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        out = os.path.splitext(path)[0] + '.webp'
        if apply:
            im.save(out, 'WEBP', quality=quality, method=6)
            after = os.path.getsize(out)
        else:
            import io
            buf = io.BytesIO()
            im.save(buf, 'WEBP', quality=quality, method=6)
            after = len(buf.getvalue())
    return before, after


def music(apply: bool) -> tuple[int, int]:
    """Фоновая музыка: перекодировать в MUSIC_KBPS (нужен ffmpeg в PATH).

    В отличие от картинок здесь замена идёт НА МЕСТЕ (расширение то же), поэтому
    ffmpeg пишет во временный файл, и только успешный результат встаёт на место
    оригинала. Откат — `git checkout src/assets/sounds`.
    """
    files = sorted(glob.glob(os.path.join(ROOT, 'src', 'assets', 'sounds', 'background', '*.mp3')))
    before = after = 0
    for f in files:
        size = os.path.getsize(f)
        before += size
        if not apply:
            # оценка по текущему битрейту: уже сжатый файл не «похудеет вдвое» ещё раз
            probe = subprocess.run(
                ['ffprobe', '-v', 'error', '-show_entries', 'format=bit_rate', '-of', 'csv=p=0', f],
                capture_output=True, text=True, check=True,
            )
            kbps = int(probe.stdout.strip() or 0) / 1000
            after += round(size * MUSIC_KBPS / kbps) if kbps > MUSIC_KBPS else size
            continue
        tmp = os.path.join(tempfile.gettempdir(), os.path.basename(f))
        subprocess.run(
            ['ffmpeg', '-y', '-loglevel', 'error', '-i', f,
             '-c:a', 'libmp3lame', '-b:a', f'{MUSIC_KBPS}k', '-ar', '44100', tmp],
            check=True,
        )
        shutil.move(tmp, f)
        after += os.path.getsize(f)
    return before, after


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='записать .webp рядом с .png')
    ap.add_argument('--only', help='обработать только эту папку')
    ap.add_argument('--music', action='store_true', help='ещё и перекодировать фоновую музыку')
    args = ap.parse_args()

    total_before = total_after = 0
    for folder, (max_side, quality, alpha) in PROFILES.items():
        if args.only and args.only != folder:
            continue
        files = sorted(glob.glob(os.path.join(ROOT, 'src', 'assets', folder, '*.png')))
        if not files:
            print(f'{folder:<8} — PNG не найдены (уже сконвертированы?)')
            continue
        fb = fa = 0
        for f in files:
            b, a = convert(f, max_side, quality, alpha, args.apply)
            fb += b
            fa += a
        total_before += fb
        total_after += fa
        size = f'{max_side}px' if max_side else 'как есть'
        print(f'{folder:<8} {len(files):>4} файлов  {fb / 1024 / 1024:>7.1f} МБ → '
              f'{fa / 1024 / 1024:>6.1f} МБ  ({size}, q{quality})')

    if args.music:
        mb, ma = music(args.apply)
        if mb:
            total_before += mb
            total_after += ma
            print(f'{"музыка":<8} {len(glob.glob(os.path.join(ROOT, "src", "assets", "sounds", "background", "*.mp3"))):>4} файлов  '
                  f'{mb / 1024 / 1024:>7.1f} МБ → {ma / 1024 / 1024:>6.1f} МБ  ({MUSIC_KBPS} kbps)')

    if total_before:
        print(f'\nИТОГО: {total_before / 1024 / 1024:.1f} МБ → {total_after / 1024 / 1024:.1f} МБ '
              f'(−{(1 - total_after / total_before) * 100:.0f}%)')
    if not args.apply:
        print('\nDry-run. Запусти с --apply, чтобы записать.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
