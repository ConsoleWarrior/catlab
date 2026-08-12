/**
 * Краткие энциклопедические справки о породах (1–2 предложения: происхождение,
 * история или главная черта). Показываются в карточке породы Котодекса —
 * чистый контент, механики не касается. Полнота (запись на каждую породу
 * каталога) проверяется тестом.
 */

import { tx, type LocStr } from '../i18n.js';

export const BREED_DESC: Record<string, LocStr> = {
  // --- Tier 1 ---
  moggie: [
    'Беспородная домашняя кошка — самый распространённый кот на планете. Именно из вековой народной селекции дворовых и выросли все породы.',
    'A non-pedigree house cat - the most common cat on the planet. Centuries of folk selection among moggies gave rise to every breed there is.',
  ],
  domestic_shorthair: [
    'Не порода, а тип: короткошёрстная кошка смешанных кровей. За крепкое здоровье и лёгкий нрав её ценят не меньше родовитых.',
    'Not a breed but a type: a shorthaired cat of mixed ancestry. Valued for sturdy health and an easy temper no less than pedigreed cats.',
  ],
  domestic_longhair: [
    'Полудлинношёрстная беспородная кошка. Пышная шуба — наследие северных предков, что спасались ею от холода.',
    'A semi-longhaired cat of no particular breed. The lush coat is a legacy of northern ancestors who kept warm by it.',
  ],
  // --- Tier 2 ---
  british_shorthair: [
    'Потомок римских кошек Британских островов, признанный породой в XIX веке. Плюшевая шерсть и круглые щёки; классика окраса — «британский голубой».',
    'A descendant of the Roman cats of the British Isles, recognised as a breed in the 19th century. Plush fur and round cheeks; the classic colour is British blue.',
  ],
  scottish_fold: [
    'Порода началась с кошки Сьюзи с шотландской фермы (1961): мутация прижала уши к голове. Тот же ген затрагивает хрящи, поэтому двух вислоухих не вяжут.',
    'The breed began with Susie, a cat from a Scottish farm (1961): a mutation folded her ears flat. The same gene affects cartilage, so two folded cats are never bred together.',
  ],
  persian: [
    'Одна из старейших пород, привезённая в Европу из Персии в XVII веке. Длинная шерсть и приплюснутая мордочка — образ «дивана-аристократа».',
    'One of the oldest breeds, brought to Europe from Persia in the 17th century. Long fur and a flattened muzzle - the very image of a sofa aristocrat.',
  ],
  siamese: [
    'Священная кошка сиамских храмов, попавшая на Запад в конце XIX века. Колор-пойнт, сапфировые глаза и знаменитый «разговорчивый» характер.',
    'The sacred cat of Siamese temples, which reached the West in the late 19th century. Colourpoint, sapphire eyes and a famously talkative character.',
  ],
  thai: [
    'Сиамская кошка старого, «яблокоголового» типа — какой порода была до селекции на экстремальный силуэт. Более округлая голова и крепкое тело.',
    'The Siamese of the old apple-headed type - what the breed was before selection for an extreme silhouette. A rounder head and a sturdier body.',
  ],
  russian_blue: [
    'Родом из Архангельска, откуда её вывезли моряки. Голубая шерсть с серебристым типпингом, изумрудные глаза и сдержанный нрав.',
    'Hails from Arkhangelsk, from where sailors carried it across the seas. Blue fur with silver tipping, emerald eyes and a reserved temper.',
  ],
  turkish_angora: [
    'Древняя естественная порода из окрестностей Анкары (Ангоры). Шелковистая, чаще белоснежная шерсть и нередко разные по цвету глаза.',
    'An ancient natural breed from around Ankara (Angora). Silky, most often snow-white fur and frequently odd-coloured eyes.',
  ],
  siberian: [
    'Аборигенная кошка русской тайги с густой тройной шубой. Крупная и выносливая; считается условно гипоаллергенной.',
    'A native cat of the Russian taiga with a dense triple coat. Large and hardy; considered relatively hypoallergenic.',
  ],
  neva_masquerade: [
    'Колор-пойнтовая вариация сибирской кошки: тёмная «маска» на морде и ярко-голубые глаза при мощном лесном сложении.',
    'The colourpoint variety of the Siberian cat: a dark mask on the face and bright blue eyes on a powerful forest build.',
  ],
  american_shorthair: [
    'Потомок кошек-крысоловов, приплывших с первыми колонистами Нового Света. Крепкая рабочая порода; фирменный окрас — серебристый мрамор.',
    'Descended from the ratter cats that sailed with the first colonists of the New World. A sturdy working breed; its signature colour is silver marble.',
  ],
  exotic_shorthair: [
    '«Персидский кот в пижаме»: тот же тип, но с короткой плюшевой шерстью. Выведен в США в 1960-х от персов и американских к/ш.',
    'A Persian in pyjamas: the same type, but with short plush fur. Bred in the USA in the 1960s from Persians and American Shorthairs.',
  ],
  abyssinian: [
    'Одна из древнейших пород, будто сошедшая с египетских фресок. Отличается тикированным «заячьим» окрасом без полос.',
    'One of the most ancient breeds, as if it stepped off an Egyptian fresco. Known for its ticked hare coat without stripes.',
  ],
  birman: [
    'По легенде храмовые кошки Бирмы получили белые «носочки» от богини. Колор-пойнт с обязательными белыми перчатками на лапах.',
    'Legend says the temple cats of Burma received their white socks from a goddess. A colourpoint with obligatory white gloves on the paws.',
  ],
  european_shorthair: [
    'Естественная европейская кошка — тот самый архетип полосатого кота, признанный породой. Здоровая, неприхотливая и азартный охотник.',
    'The natural European cat - the archetypal tabby, recognised as a breed. Healthy, undemanding and an eager hunter.',
  ],
  // --- Tier 3 ---
  maine_coon: [
    'Аборигенная порода штата Мэн и одна из крупнейших домашних кошек. Кисточки на ушах, пышный хвост и нрав «нежного гиганта».',
    'A native breed of the state of Maine and one of the largest domestic cats. Ear tufts, a plumed tail and the temper of a gentle giant.',
  ],
  norwegian_forest: [
    'Кошка викингов из скандинавских лесов, героиня северных мифов. Водоотталкивающая двойная шуба выручает в суровом климате.',
    'The cat of the Vikings from the Scandinavian woods, a heroine of northern myths. A water-repellent double coat carries it through a harsh climate.',
  ],
  ragdoll: [
    'Выведена в Калифорнии в 1960-х; имя — «тряпичная кукла» за привычку обмякать на руках. Крупная, голубоглазая и удивительно ласковая.',
    'Bred in California in the 1960s; the name means rag doll, for the habit of going limp in your arms. Large, blue-eyed and remarkably affectionate.',
  ],
  bengal: [
    'Гибрид домашней кошки с азиатским леопардовым котом. Пятна-розетки и мерцающая шерсть — при полностью домашнем характере.',
    'A hybrid of the domestic cat and the Asian leopard cat. Rosette spots and a glittering coat - with a fully domestic character.',
  ],
  donskoy: [
    'Российская бесшёрстная порода из Ростова-на-Дону (1987). Здесь лысость доминантна — в отличие от канадского сфинкса.',
    'A Russian hairless breed from Rostov-on-Don (1987). Here hairlessness is dominant - unlike in the Canadian Sphynx.',
  ],
  sphynx: [
    'Бесшёрстная порода из Торонто (1966), плод естественной мутации. Кожа тёплая и морщинистая, на ощупь как замша.',
    'A hairless breed from Toronto (1966), the fruit of a natural mutation. The skin is warm and wrinkled, like suede to the touch.',
  ],
  cornish_rex: [
    'Появился на ферме в Корнуолле в 1950 году. Только волнистый подшёрсток, уложенный аккуратной «стиральной доской».',
    'Appeared on a farm in Cornwall in 1950. Only the wavy undercoat is left, laid out in a neat washboard.',
  ],
  devon_rex: [
    'Кудрявый «кот-эльф» из Девона с огромными ушами. Его мутация отличается от корниш-рекса, хотя внешне они схожи.',
    'A curly elf cat from Devon with enormous ears. Its mutation differs from the Cornish Rex, however alike the two look.',
  ],
  munchkin: [
    '«Кошачья такса» на коротких лапах — результат естественной мутации. Ножки не мешают ей бегать и играть наравне со всеми.',
    'A cat dachshund on short legs - the result of a natural mutation. The little legs do not stop it running and playing with the rest.',
  ],
  kurilian_bobtail: [
    'Аборигенная кошка Курильских островов с хвостом-помпоном. Каждый хвост уникален; отличные прыгуны и рыболовы.',
    'A native cat of the Kuril Islands with a pompom tail. Every tail is unique; excellent jumpers and fishers.',
  ],
  japanese_bobtail: [
    'Древняя японская порода с коротким закрученным хвостом. Прообраз манэки-нэко, «машущего лапой кота»; культовый окрас — ми-кэ.',
    'An ancient Japanese breed with a short curled tail. The model for maneki-neko, the beckoning cat; the iconic colour is mi-ke.',
  ],
  burmese: [
    'Ведёт род от кошки Вонг Мау, вывезенной из Бирмы в США в 1930-х. Плотная соболиная шерсть — «кирпич, завёрнутый в шёлк».',
    'Traces its line to Wong Mau, a cat brought from Burma to the USA in the 1930s. A dense sable coat - a brick wrapped in silk.',
  ],
  bombay: [
    'Создана как мини-пантера: угольно-чёрная шерсть и медные глаза. Получена скрещиванием бурмы с чёрной американской к/ш.',
    'Created as a miniature panther: coal-black fur and copper eyes. Obtained by crossing the Burmese with the black American Shorthair.',
  ],
  somali: [
    'Длинношёрстная версия абиссинки, прозванная «кошкой-лисой» за пышный хвост. Тот же тикированный окрас, только в полудлинной шубе.',
    'The longhaired version of the Abyssinian, nicknamed the fox cat for its plumed tail. The same ticked colour in a semi-long coat.',
  ],
  ocicat: [
    'Полностью домашняя порода, случайно похожая на дикого оцелота. Пятнистый окрас выведен без единой капли дикой крови.',
    'A fully domestic breed that happens to look like a wild ocelot. Its spotted coat was bred without a drop of wild blood.',
  ],
  chartreux: [
    'Древняя французская голубая кошка, которую предание связывает с монахами. Плотная сине-серая шерсть и знаменитая «улыбка».',
    'An ancient French blue cat that legend links with monks. A dense blue-grey coat and a famous smile.',
  ],
  oriental_shorthair: [
    '«Сиамка без маски»: тот же тип, но в сплошных окрасах и без пойнта. Стройное тело, огромные уши и сотни вариантов окраса.',
    'A Siamese without the mask: the same type, but in solid colours and no points. A slender body, huge ears and hundreds of colour variants.',
  ],
  tonkinese: [
    'Золотая середина между бурмой и сиамом: минковый окрас и аквамариновые глаза. Выведена в Канаде, славится общительностью.',
    'The golden mean between Burmese and Siamese: a mink coat and aquamarine eyes. Bred in Canada, famous for being sociable.',
  ],
  himalayan: [
    'Персидская кошка в сиамском колор-пойнте с голубыми глазами. Где-то её считают отдельной породой, где-то — окрасом перса.',
    'A Persian cat in Siamese colourpoint with blue eyes. Some count it a separate breed, others merely a Persian colour.',
  ],
  manx: [
    'Бесхвостая кошка с острова Мэн, где мутация закрепилась в изоляции. Полное отсутствие хвоста («рампи») — её визитная карточка.',
    'A tailless cat from the Isle of Man, where the mutation took hold in isolation. A complete absence of tail (a rumpy) is its calling card.',
  ],
  balinese: [
    'Длинношёрстная сиамская кошка, названная за грацию балийских танцовщиц. Колор-пойнт под шелковистой полудлинной шубой.',
    'A longhaired Siamese cat, named for the grace of Balinese dancers. Colourpoint under a silky semi-long coat.',
  ],
  turkish_van: [
    'Порода с озера Ван в Турции, знаменитая любовью к воде. «Ванский» рисунок: белое тело с цветными головой и хвостом.',
    'A breed from Lake Van in Turkey, famous for its love of water. The van pattern: a white body with a coloured head and tail.',
  ],
  // --- Tier 4 ---
  american_curl: [
    'Мутация 1981 года, при которой уши загибаются назад «рожками». Котята рождаются с прямыми ушами, а заворачиваются они за первые дни.',
    'A 1981 mutation in which the ears curl back into little horns. Kittens are born with straight ears that curl over their first days.',
  ],
  elf: [
    'Молодая порода: сфинкс с загнутыми ушами кёрла. Лысая кожа и «эльфийские» уши; выведена в США в 2000-х.',
    'A young breed: a Sphynx with the curled ears of a Curl. Hairless skin and elven ears; bred in the USA in the 2000s.',
  ],
  bambino: [
    'Гибрид сфинкса и манчкина — лысый и коротколапый. Имя по-итальянски означает «малыш».',
    'A hybrid of Sphynx and Munchkin - hairless and short-legged. The name is Italian for baby.',
  ],
  skookum: [
    'Коротколапый кот с кудрявой шерстью лаперма. Название взято из жаргона чинук и значит «сильный, крепкий».',
    'A short-legged cat with the curly coat of a LaPerm. The name comes from Chinook jargon and means strong, sturdy.',
  ],
  minskin: [
    'Лысое тело с шерстью лишь на «точках» — мордочке и лапах. Выведен в Бостоне от сфинкса и манчкина.',
    'A hairless body with fur only on the points - face and paws. Bred in Boston from the Sphynx and the Munchkin.',
  ],
  lykoi: [
    '«Кот-оборотень» с частичной лысостью и роановой шерстью. Спонтанная мутация домашних кошек; имя — от греческого «волк».',
    'The werewolf cat, with partial hairlessness and a roan coat. A spontaneous mutation of domestic cats; the name is Greek for wolf.',
  ],
  chausie: [
    'Гибрид домашней кошки с камышовым котом (Felis chaus). Высокие и атлетичные; классический окрас — тикированный табби.',
    'A hybrid of the domestic cat and the jungle cat (Felis chaus). Tall and athletic; the classic colour is ticked tabby.',
  ],
  khao_manee: [
    'Древняя тайская «алмазноглазая» кошка, любимица королей Сиама. Чисто-белая шерсть и нередко разноцветные глаза.',
    'An ancient Thai diamond-eyed cat, a favourite of the kings of Siam. Pure white fur and often odd-coloured eyes.',
  ],
  singapura: [
    'Самая маленькая породистая кошка в мире, родом из Сингапура. Единственный окрас — сепия-агути с тикингом.',
    'The smallest pedigree cat in the world, native to Singapore. Its only colour is sepia agouti with ticking.',
  ],
  selkirk_rex: [
    '«Кот в овечьей шкуре» — единственный рекс с плотными кудрями и подшёрстком. Породу начала кудрявая кошка из приюта (1987).',
    'A cat in a sheepskin coat - the only rex with dense curls and an undercoat. The breed began with a curly cat from a shelter (1987).',
  ],
  pixiebob: [
    'Порода под облик дикой рыси: пятна и куцый хвост. Нередко рождается полидактильной — с лишними пальцами.',
    'A breed shaped to look like a wild bobcat: spots and a stubby tail. Often born polydactyl, with extra toes.',
  ],
  toyger: [
    '«Игрушечный тигр»: селекция ради ярких вертикальных полос. Молодая дизайнерская порода на базе бенгала.',
    'A toy tiger: selection for bright vertical stripes. A young designer breed built on the Bengal.',
  ],
  kinkalow: [
    'Карликовая порода: короткие лапы манчкина и уши-рожки кёрла. Экспериментальный микс и большая редкость.',
    'A dwarf breed: the short legs of a Munchkin and the horn ears of a Curl. An experimental mix and a great rarity.',
  ],
  peterbald: [
    'Петербургский сфинкс — элегантный и длиннотелый. Выведен в 1994 году от донского сфинкса и ориентала.',
    'The Petersburg Sphynx - elegant and long-bodied. Bred in 1994 from the Donskoy and the Oriental.',
  ],
  egyptian_mau: [
    'Единственная естественно пятнистая домашняя порода, наследница кошек Древнего Египта. Одна из самых быстрых домашних кошек.',
    'The only naturally spotted domestic breed, heir to the cats of Ancient Egypt. One of the fastest domestic cats there is.',
  ],
  laperm: [
    'Кудрявая порода со спонтанной мутацией на ферме в Орегоне. Локоны появляются даже у котят, родившихся лысыми.',
    'A curly breed from a spontaneous mutation on a farm in Oregon. The curls appear even on kittens born bald.',
  ],
  american_wirehair: [
    'Уникальная мутация американской к/ш: жёсткая пружинистая «проволочная» шерсть. Возникла на ферме в Нью-Йорке в 1966 году.',
    'A unique mutation of the American Shorthair: springy, wiry fur. It arose on a farm in New York in 1966.',
  ],
  sokoke: [
    'Редкая порода из кенийского леса Сококе, потомок полудиких кошек. Отличается «древесным» мраморным окрасом.',
    'A rare breed from the Sokoke forest of Kenya, descended from half-wild cats. Notable for its woodgrain marbled coat.',
  ],
  burmilla: [
    'Случайный, но счастливый союз бурмы и персидской шиншиллы (1981). Серебристая шерсть с типпингом и «подведёнными» глазами.',
    'The accidental but happy union of a Burmese and a Persian chinchilla (1981). Silver tipped fur and eyeliner-rimmed eyes.',
  ],
  havana: [
    'Английская порода густого шоколадного окраса. Названа то ли за цвет сигар, то ли за кроликов гаванской породы.',
    'An English breed of deep chocolate colour. Named either for the colour of cigars or for Havana rabbits.',
  ],
  ojos_azules: [
    'Редчайшая порода с ярко-синими глазами при любом окрасе. По-испански её имя и значит «голубые глаза».',
    'The rarest breed, with vivid blue eyes on any coat colour. Its name is Spanish for blue eyes.',
  ],
  // --- Tier 5 ---
  savannah: [
    'Гибрид домашней кошки с африканским сервалом — самая рослая из домашних. Первое поколение бывает размером с небольшую собаку.',
    'A hybrid of the domestic cat and the African serval - the tallest of house cats. The first generation can be the size of a small dog.',
  ],
  caracat: [
    'Экзотический гибрид домашней кошки с каракалом. Крупный, с кисточками на ушах; крайне редок и сложен в разведении.',
    'An exotic hybrid of the domestic cat and the caracal. Large, with tufted ears; extremely rare and hard to breed.',
  ],
  ashera: [
    '«Порода-призрак», что продавалась как эксклюзив за баснословные деньги. Оказалась перемаркированной саванной — громкий скандал фелинологии.',
    'A ghost breed sold as an exclusive for fabulous money. It turned out to be a rebranded Savannah - a loud scandal in the cat fancy.',
  ],
  dwelf: [
    'Сплав трёх мутаций: лысость, короткие лапы и уши-рожки. Крошечный «дворф-эльф» и экспериментальная редкость.',
    'A fusion of three mutations: hairlessness, short legs and horn ears. A tiny dwarf elf and an experimental rarity.',
  ],
  serengeti: [
    'Выведена как копия дикого сервала, но без капли дикой крови. Длинные ноги, большие уши и пятнистый окрас.',
    'Bred as a copy of the wild serval, but without a drop of wild blood. Long legs, big ears and a spotted coat.',
  ],
  cheetoh: [
    'Помесь бенгала и оцикета — «домашний гепард». Молодая порода ради максимально дикого, но ласкового кота.',
    'A cross of Bengal and Ocicat - a domestic cheetah. A young breed aiming for the wildest look and the tamest heart.',
  ],
  safari: [
    'Редчайший гибрид домашней кошки с южноамериканской кошкой Жоффруа. Сложность в том, что у видов разное число хромосом.',
    'A very rare hybrid of the domestic cat and the South American Geoffroy cat. The difficulty is that the two species have different chromosome counts.',
  ],
  california_spangled: [
    'Дизайнерская порода 1980-х, созданная как символ защиты диких кошек. «Мини-леопард», едва не исчезнувший совсем.',
    'A designer breed of the 1980s, created as a symbol of wild cat conservation. A mini leopard that very nearly vanished for good.',
  ],
  khao_manee_diamond: [
    'Элитная линия као-мани с идеальными «алмазными» голубыми глазами. Вершина чистопородного разведения тайской белой кошки.',
    'An elite Khao Manee line with perfect diamond-blue eyes. The peak of pedigree breeding of the Thai white cat.',
  ],
  lykoi_elf: [
    'Экспериментальный микс ликоя и эльфа: облик оборотня плюс уши-рожки. Лабораторная диковинка на грани фантастики.',
    'An experimental mix of Lykoi and Elf: a werewolf look plus horn ears. A laboratory curiosity on the edge of fantasy.',
  ],
};

/** Справка о породе для Котодекса (пустая строка для незнакомых ключей). */
export function breedDescription(key: string): string {
  const d = BREED_DESC[key];
  return d ? tx(d) : '';
}
