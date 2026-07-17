# Арт-методичка v2 — 140 спрайтов пород (ComfyUI, локально)

Цель: **все 70 пород (≈140 спрайтов)** в едином милом стиле, без артефактов,
с узнаваемым обликом породы и различием кот ♂ / кошка ♀.

> **Источник истины по обликам — код:** `src/genetics/traits.ts`
> (`BREED_GENES` — гены строения, `BREED_LOOK` — окрас·рисунок·глаза по полу, рев.5)
> и дизайн-заметка «Система признаков» (артефакт, рев.5). Таблицы §6 — человекочитаемая
> копия; при расхождении прав код.
>
> Методичка v1 (SeaArt, слои под тинт, поза hang) удалена: перекраска тинтом в движке
> **отключена** (`catTextures.ts`), вис делается из той же sit-текстуры. История — в git.

---

## 0. Что генерим

| Что | Сколько | Куда |
|---|---|---|
| Породные спрайты (69 пород × 2 пола) | 138 | `src/assets/breeds/<key>__male.png` / `__female.png` |
| Дворовый (`moggie`) — варианты базы | 2–3 на пол | `src/assets/base/male__<n>.png` / `female__<n>.png` |

- **Одна поза — sit**, строго фронт. Отдельная hang-поза НЕ нужна (движок берёт ту же текстуру).
- Холст 1024×1024, **светло-серый** фон при генерации → фон вырезаем на пост-обработке (rembg).
- Окрасы рисуем **сразу финальные** (перекраска тинтом отключена) — по `BREED_LOOK`, у каждого пола свой.

---

## 1. Стиль-блок (позитив, общий) — ПРЕПЕНДИТЬ В КАЖДЫЙ ПРОМТ

```
(looking directly at the viewer:1.6), (direct eye contact:1.3), both eyes facing
forward, front view, game asset, masterpiece, best quality, single charming 3D cartoon
adult domestic cat, endearing sweet with natural adult cat proportions, normal rounded
cat body, normal muzzle, expressive eyes with bright catchlights, clean crisp details,
Pixar-style 3D cartoon look rendered as a clean flat 2D game sprite, soft volumetric
shading, smooth gradient shading, subtle ambient occlusion, soft studio lighting, high
detail, centered composition, full body in frame, symmetrical pose, (sitting calmly on
the ground facing the viewer head-on:1.3), hind legs folded down, front paws planted
flat on the ground, clear visible neck with natural neck fur, {TAIL}, (face pointed
straight at the camera:1.3), mobile game character art, sticker style, isolated on a
uniform flat light grey background
```

> ⚠️ **Взгляд в камеру** — ведущая фраза промта, с весом `1.4` (без неё много котов
> смотрят вбок). **Не писать `no collar` в ПОЗИТИВЕ** — токен «collar» из позитива, наоборот,
> добавляет ошейник; ошейники только в НЕГАТИВЕ (§2), с весом. **Против «котят»** — вместо
> `cute/young adult/adorable/big eyes` теперь `charming adult cat, adult proportions`
> (милота осталась, детскость убрана); анти-котёнок усилен весом в негативе.

Слот `{TAIL}` (страховка от двух хвостов):
- обычные породы → `one single tail curled neatly beside the body`
- ген «короткий хвост» (бобтейлы, пиксибоб) → `one short pom-pom bobtail`
- мэнкс → `tailless, no tail, rounded rump`

Изменения (важно, часть — из проверенного промта пользователя):
- `kitten` → **`young adult cat`** (кошки выходили котятами именно из-за этого слова);
- **anti-collar**: `visible bare neck with natural neck fur and no collar` в позитиве +
  взвешенные ошейники в негативе (§2) — SDXL сам «одевает» милых котов, это лечит;
- добавлены `game asset, looking at viewer, single …, studio lighting` (проверено даёт
  чистый игровой ассет); фон — **светло-серый** (чище кромка при вырезке, чем чистый белый);
- выражение морды убрано в пол-блок §3, мех — в ген длины (§5).

## 2. Негатив (общий) — В КАЖДЫЙ ПРОМТ

```
(collar:1.5), (bell collar:1.5), (choker:1.3), (neck accessories:1.3), (necklace:1.3),
(pendant:1.4), (heart pendant:1.4), (bandana:1.4), (scarf:1.3), (neckerchief:1.3),
(bib:1.2), (bow tie:1.2), (clothes:1.1), pedestal, stand, base, statue, figurine, blurry,
low quality, jpeg artifacts, deformed, mutated, bad anatomy, deformed paws, extra limbs,
extra ears, extra eyes, missing limbs, fused body, double heads, two heads, two tails,
multiple tails, split tail, extra tail, (kitten:1.4), (baby cat:1.4), (chibi:1.3),
oversized head, huge head, oversized huge eyes, ugly, creepy, scary,
angry, photorealistic photo, sketch, monochrome, harsh shadows, dark, gloomy, busy
background, scenery, furniture, gradient background, shadow on background, text, caption,
watermark, signature, logo, multiple cats, two cats, cropped, out of frame, (side view:1.3),
(profile view:1.3), turned away, (looking away:1.4), (looking to the side:1.4),
(side glance:1.3), (averted eyes:1.3), (eyes looking sideways:1.4),
(head turned away:1.3), (three-quarter view:1.3), (tilted head:1.2), rotated,
(standing:1.3), (standing up on all fours:1.3), (walking pose:1.3), (jumping:1.2),
(standing on hind legs:1.4), (bipedal:1.4), (meerkat pose:1.4), (begging pose:1.3),
anthropomorphic, weasel, mongoose, squirrel, ferret, elongated body, motion blur, noise,
oversaturated, neon colors, human, hands, toys, accessories
```

> **P3.2 фикс (взгляд/поза/белая грудь):** вес взгляда поднят до `1.6` + добавлена
> вторая фраза-подкрепление `(face pointed straight at the camera:1.3)` в хвосте
> позитива; все термины «смотрит не туда»/«стоит» в негативе довешены до 1.3-1.4
> (раньше часть шла без веса — слабее давила); поза `sitting` тоже взвешена `1.3`.
> **Белая грудь не по породе:** SDXL по умолчанию тянет к «тюксидо»-пятну на груди —
> добавлен негатив-довесок `(white chest patch:1.3), (white chest fur:1.3), (white
> bib marking:1.2), (white belly patch:1.2), (tuxedo cat pattern:1.3), unwanted
> bicolor white patches`, добавляется КО ВСЕМ породам КРОМЕ реально белых/бело-пятнистых
> (turkish_angora, персидский белый и т.п. — им эту довеску пропускаем).

> Поза «стоя» вылезает у пород с акцентом на лапы/рост (саванна, манчкин) — держим
> сидячую позу через `standing, walking pose, jumping` в негативе + `sitting upright` в §1.
> **P3.1 «меркат»-фикс:** у стройных/атлетичных пород (абиссинская и т.п.) слово
> `slender` в стиль-блоке провоцировало стойку на задних лапах столбиком (как
> суриката/мангуст) — убрано из §1 (`slender` → `normal rounded cat body`), поза
> переформулирована явно через контакт с землёй (`sitting calmly on the ground,
> hind legs folded down, front paws planted flat on the ground`), в негатив добавлены
> `(standing on hind legs:1.4), (bipedal:1.4), (meerkat pose:1.4), (begging pose:1.3),
> anthropomorphic, weasel, mongoose, squirrel, ferret, elongated body`.

Добавлено (часть — из промта пользователя): **взвешенные ошейники**
`(collar:1.3),(bell collar:1.3),(neck accessories:1.2),(necklace:1.2)` — главный брак
его прошлых попыток; `two tails, split tail, extra tail, double heads` (брак прошлой
партии — два хвоста); `kitten, baby cat, chibi` (взрослый кот); `deformed paws, bad
anatomy, gradient background, shadow on background`. Для мэнкса дополнительно: `tail`.

## 3. Пол-блоки — ДОБАВЛЯТЬ ПОСЛЕ СТИЛЬ-БЛОКА

**Кот ♂** (нейтральный, без улыбки):
```
adult male cat, slightly sturdy broad-chested build, calm neutral composed
expression, mouth closed, dignified relaxed look
```
- в негатив ♂ добавить: `smiling, grinning, open mouth`

**Кошка ♀** (дружелюбная, лёгкая улыбка):
```
adult female cat, dainty graceful build, delicate soft features, subtle gentle
closed-mouth smile, friendly warm kind expression
```
- в негатив ♀ добавить: `grumpy, frowning`

**Размер ♀ = 92% от ♂ — НЕ в промте, а на экспорте** (§8): SD размер не контролирует,
а нормализация высоты при упаковке в холст даёт ровно −8% (середина требуемых 5–10%).

## 4. Технический пресет (локальный ComfyUI)

| Параметр | Значение |
|---|---|
| Сервер | `Z:\AI\ComfyUI` (`Запуск ComfyUI.bat`, API http://127.0.0.1:8188) |
| Модель | `realcartoonXL_v4.safetensors` (SDXL) + VAE fp16-fix |
| Скрипт | `Z:\AI\ComfyUI\art_gen.py` — txt2img, `--pos --neg --n --seed --steps --cfg` |
| Размер / Steps / CFG | 1024×1024 / 30 / 6, sampler dpmpp_2m + karras |
| Кандидаты | `--n 4` на спрайт, отбор по контакт-листу (`_contact.py`) |
| Seed | зафиксировать после пилота; сид серии + инкремент на кандидата |
| Фон | **светло-серый** (чище кромка), вырезка отдельно (rembg/BiRefNet на CPU) |

⚠️ Ограничения железа (16 ГБ RAM, ПК уже уходил в аварийное выключение):
- **только чистый txt2img** — БЕЗ LayerDiffusion, БЕЗ ControlNet (sit-позу SDXL держит сам), БЕЗ IP-Adapter (делает все породы одинаковыми);
- ОДИН запущенный сервер на всю сессию, генерить сериями с паузами, **никаких авто-перезапусков**;
- упал сервер → поднять вручную, продолжить с того же сида.

## 5. Словарь промт-термины (RU → EN)

### Гены строения (`BREED_GENES`)
| Ген | EN-фраза для промта |
|---|---|
| короткая шерсть | `short sleek coat` |
| длинная шерсть | `long fluffy coat, fluffy ruff around the chest` |
| лысый | `hairless cat, bald wrinkled soft skin, no fur` |
| кудрявая | `curly rex coat, soft wavy fur` |
| жёсткая | `wirehair coat, coarse springy crimped fur` |
| вислоухие | `folded ears flattened against the head, Scottish Fold ears` |
| уши-кёрл | `ears curled backwards like little horns, American Curl ears` |
| плоская морда (перс/экзот/гималай) | `flat brachycephalic face, very short muzzle` |
| приплюснутая морда (британец/шотландец/бурма) | `slightly flattened round face, short muzzle, chubby cheeks` |
| короткий хвост | `short pom-pom bobtail` (в слот `{TAIL}`) |
| короткие лапы | `very short dwarf legs, munchkin-like low body` |
| крупный | `large big-boned muscular body` |
| колор-пойнт | `colorpoint coat, pale cream body with dark points on face, ears, paws and tail` |
| тикинг | `ticked agouti coat, evenly ticked fur, no stripes` |
| пятнистость | `spotted tabby coat, leopard-like dark spots` |

### Окрасы (`BREED_LOOK.color`)
| Окрас | EN-фраза |
|---|---|
| чёрный | `solid jet-black glossy coat` |
| голубой | `solid bluish-grey coat` |
| белый | `pure snow-white coat` |
| рыжий | `solid red ginger coat` |
| кремовый | `pale cream buff coat` |
| коричневый | `warm brown coat` |
| соболиный | `dark seal-brown sable coat` |
| шоколадный | `rich chocolate-brown coat` |
| серебристый | `pale silver coat with black tipping` |
| бронзовый | `warm golden-bronze coat` |
| черепаховый | `tortoiseshell coat, mottled black and orange patches` |
| черепахово-белый (калико) | `calico coat, white with black and orange patches` |
| рыже-белый | `red and white bicolor coat` |
| чёрный роан | `black roan coat, sparse black fur mixed with grey` |
| розовая кожа | `pinkish bare skin` |
| серо-голубая кожа | `blue-grey bare skin` |
| сил | `seal-point, dark seal-brown points` |
| соррель | `sorrel cinnamon, warm reddish-brown coat` |
| дикий (ruddy) | `ruddy warm reddish-brown agouti coat` |
| сепия | `warm sepia-brown agouti coat` |

### Рисунки (`BREED_LOOK.pattern`)
| Рисунок | EN-фраза |
|---|---|
| тигровый | `mackerel tabby, bold vertical tiger stripes` |
| мраморный | `classic tabby, marbled swirls` |
| затушёванный | `shaded silver, dark-tipped shimmering coat` |
| пятнистый | `spotted tabby, leopard-like spots` |
| тикированный | `ticked agouti, no stripes` |
| колор-пойнт | см. ген «колор-пойнт» (не дублировать) |

### Глаза (`BREED_LOOK.eyes` + породные из «Особого»)
| Глаза | EN-фраза |
|---|---|
| гетерохромия | `odd-eyed cat: one blue eye and one amber eye` |
| голубые | `deep blue eyes` |
| зелёные / медные / золотые / аква (породное) | `emerald green eyes` / `copper eyes` / `golden eyes` / `aqua turquoise eyes` |

## 6. Облик пород по полу (69 пород, = `BREED_LOOK` рев.5)

Формат ячейки облика: окрас [+ рисунок] [+ глаза]. Пойнт/тикинг/пятна — ген,
одинаков у полов; различаются окрас и глаза. «Особое» — морфология, которую
обязательно запечь (это видимое выражение генов рецептов!).

### Tier 1 — Обычные
| Порода (key) | Гены строения | Облик ♂ | Облик ♀ | Особое (запечь) |
|---|---|---|---|---|
| Дворовый (`moggie`) | — (лотерея) | случайный | случайный | 2–3 варианта на пол, см. §7 |
| Домашняя к/ш (`domestic_shorthair`) | к/ш | рыжий тигровый | черепаховая | обычная |
| Домашняя д/ш (`domestic_longhair`) | д/ш | коричневый мраморный | черепаховая | пушистая |

### Tier 2 — Популярные
| Порода (key) | Гены строения | Облик ♂ | Облик ♀ | Особое (запечь) |
|---|---|---|---|---|
| Британская к/ш (`british_shorthair`) | к/ш · приплюсн. морда | голубой | серебристая мраморная | плюшевая шерсть, толстые щёки, медные глаза |
| Шотландская вислоухая (`scottish_fold`) | вислоухие · к/ш · приплюсн. морда | голубой | серебристая мраморная | круглая голова |
| Персидская (`persian`) | д/ш · плоская морда | белый + голубые глаза | калико | пышная шерсть |
| Сиамская (`siamese`) | к/ш · пойнт | сил-пойнт + голубые глаза | блю-пойнт + голубые глаза | клин-морда, большие уши |
| Тайская (`thai`) | к/ш · пойнт | сил-пойнт + голубые глаза | сил-пойнт + голубые глаза | морда «яблоко» (мягче сиама) |
| Русская голубая (`russian_blue`) | к/ш | голубой | голубая | серебристый типпинг, зелёные глаза |
| Турецкая ангора (`turkish_angora`) | д/ш | белый + гетерохромия | белая + гетерохромия | шёлковая полудлинная шерсть |
| Сибирская (`siberian`) | д/ш · крупный | коричневый тигровый | черепаховая мраморная | «лесной» вид |
| Невская маскарадная (`neva_masquerade`) | д/ш · крупный · пойнт | сил-пойнт + голубые глаза | блю-пойнт + голубые глаза | сибиряк в пойнте |
| Американская к/ш (`american_shorthair`) | к/ш | серебристый мраморный | коричневая тигровая | крепкая рабочая |
| Экзот (`exotic_shorthair`) | к/ш · плоская морда | рыжий тигровый | черепаховая | плюшевый к/ш перс |
| Абиссинская (`abyssinian`) | к/ш · тикинг | ruddy тикинг | соррель тикинг | стройная, большие уши, дикий вид |
| Священная бирма (`birman`) | д/ш · пойнт | сил-пойнт + голубые глаза | блю-пойнт + голубые глаза | **белые перчатки на лапах** |
| Европейская к/ш (`european_shorthair`) | к/ш | коричневый тигровый | черепаховая | «породистый дворовый» |

### Tier 3 — Редкие
| Порода (key) | Гены строения | Облик ♂ | Облик ♀ | Особое (запечь) |
|---|---|---|---|---|
| Мейн-кун (`maine_coon`) | д/ш · крупный | рыжий тигровый | чёрная мраморная | огромный, кисточки на ушах, пышный хвост, квадратная морда |
| Норвежская лесная (`norwegian_forest`) | д/ш · крупный | коричневый мраморный | черепаховая | треугольная морда |
| Рэгдолл (`ragdoll`) | д/ш · крупный · пойнт | сил-пойнт + голубые глаза | блю-пойнт + голубые глаза | расслабленный, шёлковая шерсть |
| Бенгальская (`bengal`) | к/ш · пятна | коричневый пятнистый | серебристая пятнистая | глянцевая шерсть, розетки |
| Донской сфинкс (`donskoy`) | лысый | розовая кожа | серо-голубая кожа | морщины, большие уши |
| Канадский сфинкс (`sphynx`) | лысый | розовая кожа | серо-голубая кожа | морщины, лимоновидные глаза |
| Корниш-рекс (`cornish_rex`) | к/ш · кудрявая | рыже-белый | голубая | стройный, яйце-голова, большие уши |
| Девон-рекс (`devon_rex`) | к/ш · кудрявая | коричневый тигровый | черепаховая | огромные низко посаженные уши, «эльф»-морда |
| Манчкин (`munchkin`) | к/ш · короткие лапы | рыжий тигровый | черепаховая | коротенькие лапы («такса») |
| Курильский бобтейл (`kurilian_bobtail`) | д/ш · короткий хвост | рыжий тигровый | черепаховая мраморная | хвост-помпон, дикий вид |
| Японский бобтейл (`japanese_bobtail`) | к/ш · короткий хвост | рыже-белый | калико | хвост-помпон, изящный |
| Бурманская (`burmese`) | к/ш · приплюсн. морда | соболиный | шоколадная | золотые глаза |
| Бомбейская (`bombay`) | к/ш | чёрный | чёрная | «мини-пантера», лаковая шерсть, медные глаза |
| Сомали (`somali`) | д/ш · тикинг | ruddy тикинг | соррель тикинг | лисий пышный хвост |
| Оцикет (`ocicat`) | к/ш · пятна | коричневый пятнистый | серебристая пятнистая | атлетичный |
| Шартрез (`chartreux`) | к/ш | голубой | голубая | медные глаза, крепкий |
| Ориентальная (`oriental_shorthair`) | к/ш | чёрный | голубая | очень длинное тело, огромные уши, зелёные глаза |
| Тонкинская (`tonkinese`) | к/ш · пойнт | коричневый минк-пойнт | шоколадная минк-пойнт | размытый пойнт, **аква-глаза** |
| Гималайская (`himalayan`) | д/ш · плоская морда · пойнт | сил-пойнт + голубые глаза | блю-пойнт + голубые глаза | перс в пойнте |
| Мэнкс (`manx`) | к/ш · короткий хвост | коричневый тигровый | черепаховая | **без хвоста**, круглый круп |
| Балинезийская (`balinese`) | д/ш · пойнт | сил-пойнт + голубые глаза | блю-пойнт + голубые глаза | сиам в длинной шерсти |
| Турецкий ван (`turkish_van`) | д/ш | рыже-белый + гетерохромия | рыже-белая + гетерохромия | ван-паттерн: цвет только на голове и хвосте |

### Tier 4 — Эксклюзивные
| Порода (key) | Гены строения | Облик ♂ | Облик ♀ | Особое (запечь) |
|---|---|---|---|---|
| Американский кёрл (`american_curl`) | кёрл · к/ш | коричневый тигровый | черепаховая | уши-«рожки» назад |
| Эльф (`elf`) | лысый · кёрл | розовая кожа | серо-голубая кожа | лысый + уши-рожки |
| Бамбино (`bambino`) | лысый · короткие лапы | розовая кожа | серо-голубая кожа | лысый + короткие лапы |
| Скукум (`skookum`) | к/ш · кудрявая · короткие лапы | рыжий | черепаховая | кудрявый + короткие лапы |
| Минскин (`minskin`) | лысый · короткие лапы | розовая кожа | серо-голубая кожа | шерсть только на лапах/морде/ушах/хвосте |
| Ликой (`lykoi`) | лысый (частично) | чёрный роан | чёрный роан | лысая маска вокруг глаз, «оборотень» |
| Чаузи (`chausie`) | к/ш · тикинг · крупный | ruddy тикинг | соболиная тикинг | высокий длинноногий, кисточки |
| Као-мани (`khao_manee`) | к/ш | белый + гетерохромия | белая + голубые глаза | «алмазный глаз» |
| Сингапура (`singapura`) | к/ш · тикинг | сепия тикинг | сепия тикинг | самая маленькая, огромные глаза и уши |
| Селкирк-рекс (`selkirk_rex`) | д/ш · кудрявая | голубой | черепаховая | «плюшевый медвежонок», круглый |
| Пиксибоб (`pixiebob`) | к/ш · пятна · кор. хвост · крупный | коричневый пятнистый | коричневая пятнистая | «домашняя рысь» |
| Тойгер (`toyger`) | к/ш | рыжий тигровый | коричневая тигровая | вертикальные тигриные полосы |
| Кинкалоу (`kinkalow`) | к/ш · кёрл · короткие лапы | голубой | черепаховая | короткие лапы + уши-рожки |
| Петерболд (`peterbald`) | лысый | розовая кожа | серо-голубая кожа | очень длинный восточный тип, большие уши |
| Египетская мау (`egyptian_mau`) | к/ш · пятна | серебристый пятнистый | бронзовая пятнистая | «макияж» у глаз, зелёные глаза |
| Лаперм (`laperm`) | д/ш · кудрявая | рыжий | черепаховая | локоны, кудрявые усы |
| Американская ж/ш (`american_wirehair`) | к/ш · жёсткая | рыжий тигровый | черепаховая | пружинистая жёсткая шерсть |
| Сококе (`sokoke`) | к/ш | коричневый мраморный | коричневая мраморная | мрамор «кора дерева», стройный |
| Бурмилла (`burmilla`) | к/ш | серебристый затушёванный | серебристая затушёванная | «подведённые» зелёные глаза |
| Гавана (`havana`) | к/ш | шоколадный | шоколадная | восточный тип, зелёные глаза |
| Охос азулес (`ojos_azules`) | к/ш | коричневый + голубые глаза | черепаховая + голубые глаза | голубые глаза при тёмном окрасе |

### Tier 5 — Легендарные
| Порода (key) | Гены строения | Облик ♂ | Облик ♀ | Особое (запечь) |
|---|---|---|---|---|
| Саванна (`savannah`) | к/ш · пятна · крупный | коричневый пятнистый | серебристая пятнистая | высокая длинноногая, огромные уши, сервал-вид |
| Каракет (`caracat`) | к/ш · крупный | ruddy (сплошной) | соррель (сплошная) | **кисточки каракала**; окрас без рисунка (рев.5) |
| Ашера (`ashera`) | к/ш · пятна · крупный | коричневый пятнистый | серебристая пятнистая | крупный «дизайнерский» леопард |
| Двэльф (`dwelf`) | лысый · кёрл · кор. лапы | розовая кожа | серо-голубая кожа | 3 мутации разом |
| Серенгети (`serengeti`) | к/ш · пятна · крупный | коричневый пятнистый | серебристая пятнистая | длинноногий, огромные уши |
| Чито (`cheetoh`) | к/ш · пятна | коричневый пятнистый | серебристая пятнистая | «мини-гепард» |
| Сафари (`safari`) | к/ш · пятна · крупный | коричневый пятнистый | коричневая пятнистая | дикий гибрид |
| Калифорнийская сияющая (`california_spangled`) | к/ш · пятна | коричневый пятнистый | серебристая пятнистая | атлетичная |
| Као-мани «Алмаз» (`khao_manee_diamond`) | к/ш | белый + голубые глаза | белая + голубые глаза | сверкающие глаза-«алмазы», вид чемпиона |
| Ликой-эльф (`lykoi_elf`) | лысый · кёрл | чёрный роан | чёрный роан | «оборотень» + уши-рожки |

## 7. Дворовый (`moggie`) — варианты базы

Облик в игре случайный (лотерея генов), поэтому спрайты — просто симпатичные
беспородные коты, НЕ совпадающие с фикс. обликами пород (чтобы не путались):

- ♂: 1) серый тигровый (`grey mackerel tabby`), 2) чёрно-белый «смокинг» (`black and white tuxedo`), 3) коричневый табби с белыми лапками
- ♀: 1) разбавленная черепаха (`dilute tortoiseshell, grey and cream`), 2) серая мраморная, 3) чёрно-белая

Финальный набор утверждается на пилоте. Файлы: `src/assets/base/<sex>__<n>.png`.

## 8. Формула промта + примеры

```
ПОЗИТИВ = §1 стиль-блок (с {TAIL} по породе)
        + пол-блок §3
        + "<Breed name> cat breed"
        + EN-фразы генов строения (§5, кроме длины хвоста — она в {TAIL})
        + EN-фраза окраса пола (+ рисунок, если есть)
        + EN-фраза глаз (из BREED_LOOK или «Особого»)
        + EN-фразы «Особого»
НЕГАТИВ = §2 + негатив-добавка пола §3 (+ `tail` для мэнкса)
```

Пример — Мейн-кун ♂ (`maine_coon__male`):
```
<§1 c {TAIL}=one single tail...>, adult male cat, slightly sturdy broad-chested build,
calm neutral composed expression, mouth closed, dignified relaxed look, Maine Coon cat
breed, long fluffy coat, fluffy ruff around the chest, large big-boned muscular body,
lynx-like ear tufts, bushy tail, square muzzle, solid red ginger coat with mackerel
tabby, bold vertical tiger stripes
```

Пример — Мейн-кун ♀ (`maine_coon__female`):
```
<§1 c {TAIL}=one single tail...>, adult female cat, dainty graceful build, delicate
soft features, subtle gentle closed-mouth smile, friendly warm kind expression, Maine
Coon cat breed, long fluffy coat, fluffy ruff around the chest, large big-boned body,
lynx-like ear tufts, bushy tail, solid jet-black coat with classic tabby marbled swirls
```

Промты НЕ пишем руками все 138: скрипт `scripts/breed_prompts.mjs` (см. план §10)
собирает их из `traits.ts` + словаря §5 + EN-фраз «Особого» и выдаёт manifest.

## 9. Пост-обработка и экспорт

1. Отбор кандидата по контакт-листу (по одному на спрайт).
2. Вырезать фон: rembg/BiRefNet (venv ComfyUI, CPU, truststore-фикс) — без ореола.
3. Обрезать по содержимому (trim) и **нормализовать высоту** на холсте 1024×1024:
   - обычный ♂ — высота кота ≈ 88% холста; ген «крупный» ♂ — ≈ 94%;
   - ♀ = **0.92 × высота своего ♂** (те самые −8%);
   - центр по X, лапы на фиксированной линии пола (низ холста − 40 px).
   Движок масштабирует по высоте текстуры (`catTextures.ts`), так что доля холста =
   видимый размер в игре — ничего в коде менять не надо.
4. Экспорт PNG с альфой → `src/assets/breeds/…`, `src/assets/base/…` (имена — §0).

## 10. Чеклист качества (перед приёмкой каждого спрайта)

- [ ] Один хвост (помпон у бобтейлов, отсутствие у мэнкса) — главный брак v1
- [ ] 4 лапы, 2 уха правильной формы (fold/curl где положено), глаза без артефактов
- [ ] Взрослый кот, не котёнок — второй брак v1 (особенно ♀)
- [ ] ♂ нейтрален (рот закрыт), ♀ — мягкая улыбка
- [ ] Порода узнаваема: гены строения и «Особое» читаются, окрас/рисунок/глаза = §6
- [ ] Строгий фронт, композиция по центру, стиль совпадает с эталоном серии
- [ ] После вырезки — чистая альфа без белого ореола

## 11. План производства (по шагам)

1. **Поднять ComfyUI** (`Z:\AI\ComfyUI`), smoke-тест `art_gen.py` — 1 генерация.
2. **Скрипт-генератор промтов** `scripts/breed_prompts.mjs`: читает `BREED_GENES`/`BREED_LOOK`
   из `traits.ts`, словарь §5 и EN-«Особое» → manifest (JSON: key, sex, pos, neg, файл).
3. **Пилот стиля** (⏸ одобрение пользователя): 4 контрастные породы —
   `bombay`, `maine_coon`, `sphynx`, `siamese` — × 2 пола × 4 сида → контакт-лист.
   Утверждаем стиль, сид серии и облик; правим §1/§3 при необходимости.
4. **Пакетная генерация по тирам** T1+T2 → T3 → T4 → T5 (+ moggie-база):
   один сервер, чистый txt2img, 4 кандидата на спрайт, паузы между сериями;
   после каждого тира — контакт-лист на одобрение (⏸).
5. **Отбор и добивка**: выбранные кандидаты в manifest; брак перегенерить точечно
   (новый сид / уточнение промта).
6. **Пост-обработка** (§9) скриптом: rembg → trim → нормализация → экспорт в `src/assets/`.
7. **Проверка в игре**: dev-сервер, живой пол, Котодекс, приют; чеклист §10;
   обновить GAME.md (арт-статус пород).

Объём: ~144 спрайта × 4 кандидата ≈ 580 генераций ≈ 4–5 ч GPU суммарно,
режем на несколько спокойных сессий.
