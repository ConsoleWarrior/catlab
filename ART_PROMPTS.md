# Арт-пайплайн ИИ — промт-кит (Этап 3)

Универсальные промты для **SeaArt.ai** (и любого Stable Diffusion-генератора: SDXL / Flux / др.).
Цель — получить **слои-части** котика в едином стиле, из которых движок собирает любого кота.

> 📌 **Ключевой принцип.** ИИ рисует кота в **нейтрально-сером** окрасе (почти белый мех + мягкая серая тень) на **прозрачном фоне**. В игре мех красится **тинтом** в нужный генетический цвет. Так из ~6 картинок получаем все окрасы без перегенерации и без раздувания размера игры.

---

## 0. Как пользоваться (быстрый старт)

1. Открой SeaArt → генерация по тексту (txt2img).
2. Выбери модель (см. §3), вставь **позитив** (§1 + §4) и **негатив** (§2).
3. Сгенерируй 4–8 вариантов **позы sit** → выбери лучший = **эталон стиля** (style anchor).
4. **Зафиксируй seed и модель** этого эталона.
5. Все остальные ассеты (поза hang, уши, глаза) генерируй **от эталона**: img2img или ControlNet «Reference-only» с эталоном как референсом + тот же стиль-блок. Это держит пропорции и стиль.
6. Убери фон (инструмент **Remove Background**), обрежь, экспортируй PNG по §6.
7. Кинь файлы мне — подключу в движок (тинт по фенотипу).

---

## 1. Универсальный стиль-блок (anchor) — ПРЕПЕНДИТЬ В КАЖДЫЙ ПРОМТ

```
masterpiece, best quality, cute semi-realistic kitten, adorable, big round
expressive sparkling eyes, large glossy eyes with bright catchlights, soft
fluffy fur, gentle rounded chubby body, sweet friendly charming expression,
Pixar-style 3D cartoon look rendered as a clean flat 2D game sprite, soft
volumetric shading, smooth gradient shading, subtle ambient occlusion, soft
diffuse top-left key light, high detail, centered composition, full body in
frame, perfectly symmetrical front view, mobile game character art, sticker
style, isolated on a plain flat white background
```

Стиль: милый полуреализм, крупные выразительные глаза, тёплый, «3D-мультик» но плоский 2D. Расчёт на женскую аудиторию.

---

## 2. Универсальный негатив — В КАЖДЫЙ ПРОМТ

```
blurry, low quality, jpeg artifacts, deformed, mutated, extra limbs, extra
ears, extra eyes, missing limbs, fused body, ugly, creepy, scary, angry,
photorealistic photo, harsh shadows, dark, gloomy, busy background, scenery,
furniture, text, caption, watermark, signature, logo, multiple cats, two cats,
cropped, out of frame, side view, profile view, three-quarter view, tilted
head, rotated, motion blur, noise, oversaturated, neon colors, human hands,
collar, clothes, accessories
```

Для **нейтральной базы** добавь в негатив (чтобы мех был серым, без окраса):
```
, colored fur, colorful, saturated colors, tabby, stripes, spots, patches,
markings, brown, orange, ginger
```

---

## 3. Технический пресет (SeaArt)

| Параметр | Значение | Зачем |
|---|---|---|
| Модель | **Flux.1** или SDXL-чекпойнт «cute / 3D / soft» | связные пропорции, мягкий объём. Pony/Illustrious — это аниме, не наш стиль |
| Размер | **1024×1024** (квадрат) | единый холст для всех частей, удобно центрировать |
| Steps | 28–35 | качество |
| CFG | 4–7 | выше — строже к промту, ниже — мягче |
| Sampler | DPM++ 2M Karras / Euler a | стандарт |
| Seed | **зафиксировать** после выбора эталона | консистентность серии |
| Фон | прозрачный (LayerDiffusion / «transparent», если доступно) **или** белый → Remove Background | чистый альфа-канал для слоёв |
| ControlNet | **Reference-only** или img2img от эталона | держит стиль/пропорции между ассетами |

---

## 4. Промты по ассетам

База: 2 позы × 3 типа ушей = до 6 картинок. Начни с **sit + обычные уши** (эталон), остальное — от него.

### 4.1 Базовый кот — поза `sit` (нейтральный серый) — ЭТАЛОН

Позитив = **§1** + :
```
sitting upright and facing the viewer, calm relaxed cute pose, front paws
together in front, tail resting curled to one side, looking straight at the
camera, uniform plain light grey fur (almost white) with soft grey shading,
no markings, plain coat, normal upright pointed ears, short fur
```
Негатив = **§2 + нейтральная добавка**.

### 4.2 Базовый кот — поза `hang` (вис за шкирку)

Генерировать **от эталона** (img2img/reference), позитив = **§1** + :
```
the kitten is gently hanging relaxed as if held by the scruff of its neck,
body stretched vertically downward, front legs dangling down loosely, hind
legs and tail hanging straight down, soft slightly pleading cute expression,
viewed from the front, uniform plain light grey fur with soft grey shading,
no markings, short fur
```
Негатив = **§2 + нейтральная добавка** + `holding hand, arm, fingers`.

### 4.3 Варианты ушей

Те же промты, что 4.1/4.2, но замени фразу про уши:
- **Вислоухие (fold):** `folded ears flattened against the head, Scottish Fold cat`
- **Кёрл (curl):** `ears curled backward and outward, American Curl cat`

### 4.4 Длинная шерсть (по желанию — отдельная база)

К 4.1/4.2 добавь: `long fluffy fur, fur tufts around the cheeks and chest, fluffy ruff, Maine Coon coat` и убери `short fur`.

### 4.5 Глаза (отдельный слой, чтобы красить радужку тинтом)

Два файла, генерировать как иконку крупно по центру:
- **`eyes-iris`** (красится тинтом): `a single round glossy cute cat eye iris, plain light grey iris, smooth gradient, no pupil, no highlight, centered, isolated on transparent background` + §2.
- **`eyes-frame`** (поверх, фиксированный): `a pair of big round cute cartoon cat eyes, white sclera, large round dark pupils, big bright white catchlight highlights, thin soft eyelid line, no iris color, centered, isolated on transparent background` + §2.

> Если возиться со слоями глаз не хочется — оставим **процедурные глаза** (они уже в движке и дают точный генетический цвет). ИИ-глаза подключим, когда база устроит.

### 4.6 Паттерны табби (ПОЗЖЕ, не на v1)

Регистрация ИИ-масок паттерна к телу — самая хрупкая часть. На v1 **паттерны рисует движок** (у нас уже есть mackerel/classic/spotted/ticked). Когда база зайдёт, сделаем маски так: img2img от базы с низким denoise + `tabby mackerel stripes` → вычтем базу → получим маску. Это отдельная итерация.

---

## 5. Консистентность (главный риск — решаем так)

1. **Один эталон** (4.1) → его seed+модель = канон серии.
2. Все части — **через Reference-only / img2img от эталона**, не «с нуля».
3. Один и тот же **стиль-блок §1 дословно** во всех промтах.
4. Одинаковый **свет** (soft top-left) и **ракурс** (строго фронт) — заложено в §1/§2.
5. Если части «плывут» — добавь в промт `same art style as reference, consistent proportions` и снизь denoise (0.4–0.6) в img2img.

---

## 6. Пост-обработка и экспорт (важно для движка)

- Холст **1024×1024**, кот **по центру по X**.
- Единая «линия пола»: у позы `sit` лапы внизу на одной высоте; у `hang` точка шкирки (верх) на одной высоте у всех. Тогда позы совпадут в игре.
- **Прозрачный фон** (alpha), без ореола (matting).
- Мех — **светло-серый, почти белый**, чтобы тинт-умножение дал чистый цвет (тёмные окрасы могут «съесть» тени — это поправим тинт-шейдером, не блокер).
- Имена файлов (под слоты движка):
  ```
  base-sit-normal.png   base-hang-normal.png
  base-sit-fold.png     base-hang-fold.png
  base-sit-curl.png     base-hang-curl.png
  base-sit-long.png     base-hang-long.png   (если делаем длинную шерсть)
  eyes-iris.png   eyes-frame.png
  ```
- Складывать в `src/assets/cat/`.

---

## 7. Как это ложится в движок

- Грузим базу как текстуру PixiJS, **тинтуем** по `phenotype.baseColor` (+ dilute) → любой окрас из одной картинки.
- Поверх — слой **белых пятен** (маска по `whiteAmount`) и **колор-пойнта** (тинт морды/лап/хвоста).
- **Паттерн** (v1) — процедурный поверх базы; позже заменим на ИИ-маску.
- **Глаза** — тинт радужки по `phenotype.eyeColor` (или процедурные).
- Уши/длина шерсти — выбор нужного `base-*` файла по фенотипу.
- Структура `фенотип → слои` уже есть в `src/render/catSprite.ts` — заменяем рисование примитивов на спрайты, логика та же.

---

### Чек-лист первого захода
- [ ] Сгенерить 4.1 (sit, нейтральный, обычные уши) → выбрать эталон, записать seed.
- [ ] От эталона: 4.2 (hang).
- [ ] Remove BG, экспорт 1024×1024 по §6 → `base-sit-normal.png`, `base-hang-normal.png`.
- [ ] Прислать мне 2 файла — подключу тинт и заменю процедурную базу. Дальше добьём уши/глаза/длинную шерсть.
