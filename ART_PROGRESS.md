# Реестр генерации спрайтов пород (v2)

Живой учёт: какие породы сгенерированы, где лежат кандидаты, какой сид выбран в игру.
Методичка — [ART_PROMPTS.md](ART_PROMPTS.md). Драйвер — `scratchpad/gen_breeds.sh`.

## Где файлы
- **Кандидаты (прод):** `Z:/AI/out/gen/<key>_<m|f>_seed<seed>.png`
- **Пилот:** `Z:/AI/out/pilot/<key>_<m|f>_seed<seed>.png`
- **Контакт-листы:** `Z:/AI/out/{gen,pilot}/contact_<key>.png`
- **Финал в игру:** `src/assets/breeds/<key>__<male|female>.png` (после вырезки фона + нормализации)

## Версии промта (чтобы понимать разброс стиля)
- **P1 (пилот):** первый стиль-блок. `cute young adult`, взгляд без веса. Чуть реалистичнее, местами взгляд вбок.
- **P2 (партия 2):** + фикс взгляда, collar-gotcha (убран `no collar` из позитива), вес ошейника 1.5. Стиль милее.
- **P3 (партия 3):** взгляд ведущей фразой с весом 1.4; убрана «детскость» (`charming adult cat`, анти-котёнок весом); +bandana/scarf в негатив; манчкину усилены лапы.

## Статус пород

Легенда: ⏳ ждёт ревью · ✅ есть чистые кандидаты · 🔁 перегенерён · ⭐ выбран в игру (сид)

| Порода (key) | Тир | Промт | Сиды | Статус | Выбор ♂ | Выбор ♀ |
|---|---|---|---|---|---|---|
| bombay | 3 | P1 | 1000–1002 | ⏳ (♀ сид1001 кулон) | — | — |
| maine_coon | 3 | P1 | 1000–1002 | ✅ (♂ сид1002 на подставке) | — | — |
| siamese | 2 | P1 | 1000–1002 | ✅ | — | — |
| sphynx | 3 | P3 | 1000–1002 | ✅ чистый (взгляд ок, без ошейников) | — | — |
| persian | 2 | P2 | 1000–1002 | ⏳ (♀ сид1001 бандана, вотермарк) | — | — |
| scottish_fold | 2 | P2 | 1000–1002 | ✅ без брака | — | — |
| munchkin | 3 | P3 | 1000–1002 | ✅ лапы ок (♂1002 ошейник; сид. ♂1000/1001, ♀1000/1002) | — | — |
| bengal | 3 | P2 | 1000–1002 | ✅ без брака | — | — |
| cornish_rex | 3 | P3 | 1000–1002 | ⚠️ кудри слабоваты (можно перегенерить) | — | — |
| kurilian_bobtail | 3 | P3 | 1000–1002 | ✅ помпон ок | — | — |
| russian_blue | 2 | P3 | 1000–1002 | ✅ эталон, без брака | — | — |
| savannah | 5 | P3 | 1000–1002 | ✅ (сид. ♂1001/1002, ♀1001/1002) | — | — |

**Готово пород: 12 из 70.** Столбцы «Выбор» заполняем, когда назовёшь номера.

## Осталось сгенерировать (по тирам)
- **T1:** moggie(база), domestic_shorthair, domestic_longhair
- **T2:** british_shorthair, thai, turkish_angora, siberian, neva_masquerade, american_shorthair, exotic_shorthair, abyssinian, birman, european_shorthair, russian_blue✅
- **T3:** norwegian_forest, ragdoll, donskoy, devon_rex, japanese_bobtail, burmese, somali, ocicat, chartreux, oriental_shorthair, tonkinese, himalayan, manx, balinese, turkish_van
- **T4:** american_curl, elf, bambino, skookum, minskin, lykoi, chausie, khao_manee, singapura, selkirk_rex, pixiebob, toyger, kinkalow, peterbald, egyptian_mau, laperm, american_wirehair, sokoke, burmilla, havana, ojos_azules
- **T5:** caracat, ashera, dwelf, serengeti, cheetoh, safari, california_spangled, khao_manee_diamond, lykoi_elf
