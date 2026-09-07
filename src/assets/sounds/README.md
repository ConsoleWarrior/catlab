# Звуки — источники и лицензии

Все файлы скачаны с Pixabay (pixabay.com). Лицензия — **Pixabay Content License**:
бесплатно, коммерческое использование разрешено, атрибуция не требуется.
Нельзя только перепродавать/раздавать сами файлы как стоковые звуки — использование
внутри игры разрешено. Файлы с автором `freesound_community` — импорт CC0 с Freesound.

Имена файлов сохранены как при скачивании: `<автор>-<название>-<id>.mp3` —
по ним звук находится на Pixabay (страница: `pixabay.com/sound-effects/<название>-<id>/`).

## meow/ — мяуканье (тап по коту, взятие «за шкирку»)

| Файл | Автор | Страница |
|---|---|---|
| dragon-studio-cat-meow-401729.mp3 | Dragon Studio | pixabay.com/sound-effects/cat-meow-401729/ |
| edr-cat-purr-meow-8327.mp3 | EDR | pixabay.com/sound-effects/cat-purr-meow-8327/ |
| freesound_community-cat-meow-1-80899.mp3 | freesound_community | pixabay.com/sound-effects/cat-meow-1-80899/ |
| freesound_community-cat-meow-81626.mp3 | freesound_community | pixabay.com/sound-effects/cat-meow-81626/ |
| freesound_community-cat-meow-99835.mp3 | freesound_community | pixabay.com/sound-effects/cat-meow-99835/ |
| sound_garage-cat-meow-1-fx-306178.mp3 | Sound Garage | pixabay.com/sound-effects/cat-meow-1-fx-306178/ |
| sound_garage-cat-meow-4-fx-306180.mp3 | Sound Garage | pixabay.com/sound-effects/cat-meow-4-fx-306180/ |
| sound_garage-cat-meow-7-fx-306186.mp3 | Sound Garage | pixabay.com/sound-effects/cat-meow-7-fx-306186/ |
| sound_garage-cat-meow-8-fx-306184.mp3 | Sound Garage | pixabay.com/sound-effects/cat-meow-8-fx-306184/ |
| sound_garage-cat-meow-9-fx-306185.mp3 | Sound Garage | pixabay.com/sound-effects/cat-meow-9-fx-306185/ |
| stu9-shrt-meow-352842.mp3 | stu9 | pixabay.com/sound-effects/shrt-meow-352842/ |

## purr/ — мурлыканье (хор спящих котов, случайная петля на кота)

Файлы обрезаны из длинных оригиналов (45–65 с) в **бесшовные петли по 24 с**
(ffmpeg: кроссфейд «хвост → начало» 1.5–3 с, моно, микрофейды 10 мс на краях) —
иначе WebAudio держал бы в памяти ~100 МБ декодированного звука (важно на
мобильных). Оригиналы — в `H:\звуки котолабы\мурлыкание и другие`.

| Файл | Автор | Страница |
|---|---|---|
| freesound_community-cat-purr-6164.mp3 | freesound_community | pixabay.com/sound-effects/cat-purr-6164/ |
| freesound_community-cat-purring-74746.mp3 | freesound_community | pixabay.com/sound-effects/cat-purring-74746/ |
| purr77-ronro-165115.mp3 | purr77 | pixabay.com/sound-effects/ronro-165115/ |

## background/ — фоновая музыка (Инкубатор · Генолаб · Крио-банк, по кругу)

| Файл | Автор | Страница |
|---|---|---|
| samuelfjohanns-aeolian-futuristics-emin-chord-02-119833.mp3 | SamuelFJohanns | pixabay.com/sound-effects/aeolian-futuristics-emin-chord-02-119833/ |
| samuelfjohanns-aeolian-futuristics-future-mystery-background-pattern-119818.mp3 | SamuelFJohanns | pixabay.com/sound-effects/aeolian-futuristics-future-mystery-background-pattern-119818/ |
| samuelfjohanns-aeolian-futuristics-future-mystery-g-minor-chord-119817.mp3 | SamuelFJohanns | pixabay.com/sound-effects/aeolian-futuristics-future-mystery-g-minor-chord-119817/ |
| samuelfjohanns-aeolian-futuristics-gmin-chord-pattern-119835.mp3 | SamuelFJohanns | pixabay.com/sound-effects/aeolian-futuristics-gmin-chord-pattern-119835/ |
| samuelfjohanns-aeolian-futuristics-music-from-the-freakn-future-01-119831.mp3 | SamuelFJohanns | pixabay.com/sound-effects/aeolian-futuristics-music-from-the-freakn-future-01-119831/ |

Не взято в проект: `scottishperson-sound-effect-cat-chirruping-and-meowing-282902.mp3`
(~8 секунд щебетания — слишком длинно для реакции на тап; лежит в `H:\звуки котолабы`).

## ui/ — звуки событий (`sfxEvent`)

Имя файла = ключ события в `SfxEvent` (`src/ui/sound.ts`). Оригиналы — в
`C:\Users\Oleg PK SSD\Documents\звуки`, подобраны автором игры.

Каждый файл **сведён заранее**, поэтому автонормализация по RMS (как у `meow/`)
к ним не применяется — она бы стёрла разницу «важности» между событиями:

1. обрезка лишнего (в оригиналах 3–7 с тишины и реверберационных хвостов);
2. микрофейд 12 мс на входе и фейд-аут на выходе — без щелчков;
3. приведение к −19.5 LUFS (ITU-R BS.1770) — столько же даёт мяуканье после
   своей нормализации, поэтому события не выбиваются из общего фона;
4. поправка «важности»: поздравления громче, рутинные подтверждения тише;
5. `libmp3lame -q:a 4`, 44.1 кГц. Битрейт выше обычного не от щедрости: на 112 кбит/с
   у ярких звуков (`adopt`) срезался верх и они теряли до 5 дБ громкости.

| Файл | Событие | Из оригинала | Обрезка | Уровень |
|---|---|---|---|---|
| levelup.mp3 | повышение уровня | поднятие уровня.mp3 | 0 → 2.50 с (было 8.10) | −17.5 LUFS |
| newbreed.mp3 | новая порода в Котодексе | новая порода выведена.mp3 | 0 → 2.80 с (было 7.32) | −17.5 LUFS |
| birth.mp3 | родился котёнок | рождение3.mp3 | 5.98→6.75 + 7.64→8.55 (было 8.62) | −18.5 LUFS |
| order.mp3 | заказ выполнен | выполнение заказа.mp3 | 0 → 0.80 с (было 2.59) | −19.5 LUFS |
| analyze.mp3 | генетический анализ готов | генетический анализ.mp3 | 0 → 0.96 с (было 1.08) | −19.5 LUFS |
| freeze.mp3 | заморозка в криокапсулу | заморозка в криобанк.mp3 | 0.05 → 1.55 с (было 8.04) | −19.5 LUFS |
| lab.mp3 | сдача в лабораторию | сдача на опыты.mp3 | 0.22 → 2.06 с (было 7.56) | −20.5 LUFS |
| breed.mp3 | вязка началась | начало вязки.mp3 | 0.15 → 2.35 с (было 4.80) | −20.5 LUFS |
| adopt.mp3 | отдан в добрые руки | сдача в добрые руки.mp3 | 0 → 0.62 с (было 0.89) | −20.5 LUFS |
| heal.mp3 | ветеринар вылечил | лечение.mp3 | 0.35 → 1.40 с (было 1.59) | −21.0 LUFS |

`analyze.mp3` и `breed.mp3` собраны из `zvuki/` в корне проекта (оригиналы там же).
В обоих — только обрезка тишины и хвоста: у анализа за 0.96 с звук кончается,
дальше пустота; у вязки после 2.35 с остаётся реверберационный хвост ниже −40 дБ,
он срезан фейдом 0.28 с — на слух обрыва нет. Исходник вязки был 24 кГц, при
сведении поднят до общих 44.1 кГц (выше исходной полосы это ничего не добавляет,
но формат у всех файлов один).

`birth.mp3` взят из `рождение3.mp3` — два мяуканья котёнка из концовки оригинала.
Единственное отклонение от «просто обрезки»: пауза между мяу сокращена с 1.0 с до
0.30 с (два куска склеены встык через `apad`, на стыке фейды 12/70 мс — щелчка нет),
иначе в игре звук тянулся почти три секунды. Итог — 1.98 с: мяу на 0.06–0.6 с и
1.1–1.8 с. Прежний вариант из `рождение котенка.mp3` (одиночный писк) заменён.
